import type { ModelMessage } from 'ai'
import type { ToolName } from './tools/descriptions.ts'

/*
 * The gate: before a tool that changes something runs, the run stops and asks.
 *
 * Two facts shape everything in this file, and both are properties of the AI
 * SDK's approval protocol rather than opinions of mine.
 *
 * 1. **The decision is made from the tool call, before the tool runs.** The
 *    only things in scope are the tool's name and the arguments the model
 *    wrote. There is no "what will this actually do" to consult, because
 *    nothing has done anything yet.
 * 2. **`user-approval` is not a pause, it is a suspension.** The loop returns,
 *    and what it returns is a conversation with an unanswered question in it.
 *    Answering it is a second call with the same conversation plus one more
 *    message — which means the same suspended run can be answered twice, from
 *    the same bytes, and both answers are real runs. That is the whole of how
 *    this post's two published branches were recorded, and it is the reason the
 *    schema's word for this frame is right: an approval *is* a branch.
 */

/** What a human (or a policy standing in for one) answered. */
export type Decision = 'allow' | 'deny'

/** Everything the gate can see at the moment it has to decide. */
export type ApprovalRequest = {
  tool: string
  /** The arguments the model wrote, unparsed and untrusted. */
  args: unknown
  toolCallId: string
}

/** Answers one request. Async because a real one waits for a person. */
export type Approver = (request: ApprovalRequest) => Decision | Promise<Decision>

/** What happened at one gate, in the order the gate happened. */
export type ApprovalRecord = {
  tool: string
  decision: Decision
  toolCallId: string
  args: unknown
}

/**
 * Which tools need an answer before they run.
 *
 * The rule is *does this change something that outlives the run*, which picks
 * out the three filesystem writes and the command runner and nothing else.
 * Reading a file, listing a directory, searching, and both v7 web tools are
 * outside it: a read that goes wrong wastes tokens, and a write that goes
 * wrong is a file that is now different.
 *
 * **The set is tool names, and that is the defect this post is about.** The
 * approval protocol hands the gate a name and the arguments the model wrote,
 * so gating by name is the only thing it can do without reading those
 * arguments — and reading them is post 8's allow-list one layer up: to know
 * that `wc -c README.md` changes nothing, the gate would have to know what
 * `wc` is, which is the knowledge an allow-list over a shell claims to have
 * and does not. So `run_command` is in the set as one entry, and one entry is
 * how a gate asks about `wc -c` in the same voice it asks about `cp a b`.
 * `tools/hitl/overask.ts` measures what that cost across post 8's committed
 * runs.
 */
export const GATED: readonly ToolName[] = [
  'write_file',
  'edit_file',
  'append_file',
  'run_command',
]

/**
 * What the model is told when the answer is no.
 *
 * Two properties, both deliberate. It is **factual**: it says the call did not
 * run and nothing changed, because a model that believes a denied write
 * happened will report it as done. And it carries **no instruction** — it does
 * not say try something else, do not retry, or tell the user. What an agent
 * does when it is told no is the thing this commit measures, and a denial that
 * told it what to do next would be measuring the denial's wording.
 *
 * This string reaches the model verbatim. The SDK turns a denied call into a
 * tool result whose output is `{ type: 'execution-denied', reason }`, and
 * `@ai-sdk/openai` sends `reason` as the tool message's content (falling back
 * to "Tool call execution denied." when there is none). So the gate is a guard
 * that refuses *out loud*, in the one channel the model is listening on —
 * which is exactly what post 8's shell guard was not.
 */
export const DENIAL_REASON =
  'The human operator denied this tool call. It did not run and nothing was changed.'

export type GateOptions = {
  /** Tool names that need an answer. Defaults to `GATED`. */
  gate?: readonly string[]
  /**
   * Who answers. Omitted means nobody is available to: the run suspends at
   * the first gated call and returns a conversation with the question in it.
   */
  decide?: Approver
  /** Called after every decision, so a run can record what it was asked. */
  onDecision?: (record: ApprovalRecord) => void
}

/**
 * Approval statuses, spelled the way the SDK spells them.
 *
 * Narrower than `ToolApprovalStatus` on purpose: this file never returns the
 * bare-string forms, so every status that leaves here can carry a reason and a
 * reader of a trace can be told why.
 */
type Status =
  | { type: 'not-applicable' }
  | { type: 'approved'; reason?: string }
  | { type: 'denied'; reason?: string }
  | { type: 'user-approval'; reason?: string }

/**
 * The `toolApproval` configuration handed to `generateText`.
 *
 * One generic function rather than a per-tool map, because the set of gated
 * tools is data that the experiment varies and a map would have to be rebuilt
 * from it anyway — and because the generic form is the one that gets to see
 * the tool call, which is what any gate cleverer than this one would need.
 */
export function gateConfig(options: GateOptions = {}) {
  const gate = new Set(options.gate ?? GATED)
  const { decide, onDecision } = options

  return async ({
    toolCall,
  }: {
    toolCall: { toolName: string; toolCallId: string; input: unknown }
    messages?: ModelMessage[]
  }): Promise<Status> => {
    if (!gate.has(toolCall.toolName)) return { type: 'not-applicable' }

    const request: ApprovalRequest = {
      tool: toolCall.toolName,
      args: toolCall.input,
      toolCallId: toolCall.toolCallId,
    }

    // Nobody to ask. The SDK stops the loop and hands the caller a
    // conversation with the question unanswered in it.
    if (decide === undefined) return { type: 'user-approval' }

    const decision = await decide(request)
    onDecision?.({
      tool: request.tool,
      decision,
      toolCallId: request.toolCallId,
      args: request.args,
    })

    return decision === 'allow'
      ? { type: 'approved' }
      : { type: 'denied', reason: DENIAL_REASON }
  }
}

/** Answers yes to everything. The gate is on; the human never objects. */
export const ALWAYS_ALLOW: Approver = () => 'allow'

/** Answers no to everything. */
export const ALWAYS_DENY: Approver = () => 'deny'

/**
 * A question the model asked and nobody has answered.
 *
 * `toolCallId` is what the approval is *about*; `approvalId` is what the
 * answer has to quote. They are different identifiers and the SDK checks the
 * second one, which is worth stating because the first is the one that looks
 * like the obvious key.
 */
export type PendingApproval = {
  approvalId: string
  toolCallId: string
  tool: string
  args: unknown
}

type MaybePart = {
  type?: unknown
  approvalId?: unknown
  toolCallId?: unknown
  toolName?: unknown
  input?: unknown
}

function parts(message: ModelMessage): MaybePart[] {
  const content: unknown = message.content
  return Array.isArray(content) ? (content as MaybePart[]) : []
}

/**
 * Every unanswered approval request in a conversation.
 *
 * Read off the messages rather than off the result object, because the
 * messages are what a resumed run is built from: if the question is not in
 * there, answering it is answering something that no longer exists. A request
 * is unanswered when no later message carries a response quoting its
 * `approvalId`.
 */
export function pendingApprovals(
  messages: readonly ModelMessage[],
): PendingApproval[] {
  const answered = new Set<string>()
  for (const message of messages) {
    for (const part of parts(message)) {
      if (part.type === 'tool-approval-response' && typeof part.approvalId === 'string') {
        answered.add(part.approvalId)
      }
    }
  }

  const pending: PendingApproval[] = []
  for (const message of messages) {
    for (const part of parts(message)) {
      if (part.type !== 'tool-approval-request') continue
      const { approvalId } = part
      if (typeof approvalId !== 'string' || answered.has(approvalId)) continue
      // The request part carries only the ids; the call it is about is a
      // sibling part in the same message.
      const call = parts(message).find(
        (sibling) =>
          sibling.type === 'tool-call' && sibling.toolCallId === part.toolCallId,
      )
      pending.push({
        approvalId,
        toolCallId: typeof part.toolCallId === 'string' ? part.toolCallId : '',
        tool: typeof call?.toolName === 'string' ? call.toolName : 'unknown',
        args: call?.input,
      })
    }
  }
  return pending
}

/**
 * The one message that answers a suspended run, and the whole of a branch.
 *
 * Both published traces in post 9 are the same suspended conversation with a
 * different one of these appended. Nothing else differs, and nothing is
 * edited: the prefix is one recording and each continuation is a real call.
 */
export function answer(
  pending: PendingApproval,
  decision: Decision,
): ModelMessage {
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-approval-response',
        approvalId: pending.approvalId,
        approved: decision === 'allow',
        ...(decision === 'deny' ? { reason: DENIAL_REASON } : {}),
      },
    ],
  } as ModelMessage
}
