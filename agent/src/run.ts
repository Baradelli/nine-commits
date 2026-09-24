import { generateText, stepCountIs, type FinishReason, type ModelMessage } from 'ai'
import { openai } from '@ai-sdk/openai'
import { INSTRUCTIONS, MODEL_NAME } from './config.ts'
import { buildTools } from './tools/index.ts'
import { resolveStyle, type DescriptionStyle } from './tools/descriptions.ts'
import { resolveRoster, ROSTERS, type Roster } from './tools/roster.ts'
import { PROJECT_ROOT } from './tools/fs.ts'
import type { SandboxEscape } from './tools/sandbox.ts'
import type { ShellRefusal } from './tools/shell.ts'
import type { WebOptions } from './tools/web.ts'
import {
  budgetOf,
  canCompact,
  compact,
  ContextOverflow,
  estimateWithAnchor,
  MEASURED_MODEL_WINDOW,
  type ContextAnchor,
  SUMMARISER_INSTRUCTIONS,
  summariserPrompt,
  type CompactionEvent,
} from './context.ts'

export type ToolCallRecord = { id: string; name: string; args: unknown }
export type ToolResultRecord = { id: string; ok: boolean; result: unknown }

export type RunStep = {
  text: string
  toolCalls: ToolCallRecord[]
  toolResults: ToolResultRecord[]
  /** Context the model was handed for this step. */
  inputTokens: number
  /** That context plus what the model produced from it. */
  totalTokens: number
  /**
   * v7. The rewrite that happened immediately BEFORE this step, if one did.
   *
   * On the step rather than in a list of its own, because a compaction is not
   * an event in the conversation — it is a thing done to the conversation
   * between two requests, and the only fact about it a reader needs is which
   * request it happened in front of. The recorder puts the frame there.
   */
  compaction?: CompactionEvent
  /**
   * v7. What the program thought this step's context was worth before it sent
   * it, next to what the provider charged for it.
   *
   * Both, always, because the estimate is what the compaction decision is made
   * on and the count is what is true. A post that printed only the threshold
   * would be reporting a rule without saying whether the meter it reads works.
   */
  estimatedInputTokens?: number
}

/**
 * Which of the three things that can end a run ended this one.
 *
 * `model` is the one that is meant to fire: a step came back asking for no
 * tool, so there was nothing to feed forward and the loop ran out of work.
 * `step-cap` is the backstop firing instead, and it means the model was still
 * mid-task when the program took the pen away.
 *
 * v7 adds `context-overflow`: the next request would not have fitted, so there
 * was no next request. It is the only one of the three that is not a decision
 * about the work — it is the loop running out of room to think in.
 */
export type StopReason = 'model' | 'step-cap' | 'context-overflow'

export type RunResult = {
  model: string
  style: DescriptionStyle
  roster: Roster
  /** The tool names the model was actually handed, in order. */
  tools: string[]
  steps: RunStep[]
  stoppedBy: StopReason
  /**
   * Every path the sandbox guard refused during this run.
   *
   * It is on the result rather than only on the terminal because a refusal is
   * a fact about the run: a condition that produces them is a condition where
   * the model tried to leave the directory it was given, and a tally that
   * cannot show that is a tally reporting a safety property it never measured.
   */
  escapes: string[]
  /**
   * v8. Every command line the shell guard refused, and which rule refused it.
   *
   * Post 6's escape counter read zero across a hundred and fifty runs, which
   * meant everything that post could say about its guard came from a test file.
   * This is the same counter for a much larger surface, and it is on the result
   * for the same reason: a condition that produces refusals is a condition
   * where the model reached for something the program would not do, and a tally
   * that cannot show that is a tally reporting a safety property it never
   * measured.
   */
  refusals: { command: string; rule: string }[]
  /** v7. How many times the history was rewritten during this run. */
  compactions: number
  /**
   * v7. What the summariser cost.
   *
   * Kept apart from the step usage rather than added into it, because it is a
   * different bill: the steps are what the agent spent thinking, and this is
   * what the program spent making room for it to keep thinking. Folding the
   * two together would hide the price of compaction inside the saving.
   */
  summariserInputTokens: number
  summariserOutputTokens: number
  /** v7. Requests that actually left the machine, by URL. */
  fetched: string[]
  /** v7. The ceiling this run was held to. */
  contextLimit: number
  /** v7. The estimate that did not fit, when that is why the run ended. */
  overflowedAt?: number
  /**
   * v7. A rewrite that happened and was followed by nothing.
   *
   * The history was compacted, the rewrite was not enough, and the request it
   * was making room for never went. It belongs on the result because it
   * belongs in the trace: a run whose tally says it compacted once and whose
   * trace shows no compaction is a run whose record disagrees with itself.
   */
  trailingCompaction?: CompactionEvent
}

/**
 * Everything the experiment varies, in one place.
 *
 * Each field falls back to the environment, so the CLI keeps working exactly
 * as it did at v3 and the roster harness can drive many runs in one process
 * without setting and unsetting variables around each of them.
 */
export type RunOptions = {
  root?: string
  roster?: Roster
  style?: DescriptionStyle
  /**
   * v7. Off by default, because the loop six commits shipped is the control
   * and a default that quietly rewrote the conversation would make every
   * earlier post's trace un-reproducible at this checkout.
   */
  compaction?: boolean
  /** v7. The context ceiling. Defaults to the largest one the model accepts. */
  contextLimit?: number
  /** v7. Raised for the research task, which needs more turns than v6's five. */
  maxSteps?: number
  /** v7. Cache policy for the two web tools. */
  web?: WebOptions
}

/**
 * The backstop, not the stop condition.
 *
 * What ends a run is the model declining to call a tool: the SDK goes round
 * again only while a step finishes with `tool-calls`. This number is what
 * stops a run in which that never happens, and there is nothing principled
 * about the value — high enough that this question does not reach it, low
 * enough that a loop which has stopped making progress costs ten requests
 * rather than an afternoon. v2's cap was 2, which is this same mechanism set
 * low enough to forbid the loop outright.
 */
export const MAX_STEPS = 10

/**
 * Which condition ended the run, read back off the steps.
 *
 * A step whose finish reason is `tool-calls` is a step that wanted a next one,
 * so a run whose last step says that was stopped by something other than the
 * model. With these two tools that something is the cap, and only because the
 * SDK's other exits cannot arise here: both tools have an `execute`, and
 * neither asks for approval. Approval is post 9, and when it lands this
 * function stops being a two-way answer.
 *
 * v7 adds a third exit that this function deliberately cannot see. A run that
 * overflowed never got a finish reason for the step it did not take, so there
 * is nothing in the array to read it off. `runOnce` knows, because it is the
 * thing that threw, and it says so rather than asking this function a question
 * it has no evidence for.
 *
 * Kept out of `runOnce` so it can be checked without a network call: "what
 * stopped it" is the question the loop introduces, and every recorded run has
 * to answer it.
 */
export function whatStopped(
  steps: readonly { finishReason: FinishReason }[],
): StopReason {
  return steps.at(-1)?.finishReason === 'tool-calls' ? 'step-cap' : 'model'
}

/** A tool that returned `{ ok: false }` reports itself as failed. */
function succeeded(output: unknown): boolean {
  return (
    typeof output !== 'object' ||
    output === null ||
    !('ok' in output) ||
    output.ok === true
  )
}

type SdkStep = {
  text: string
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[]
  toolResults: { toolCallId: string; output: unknown }[]
  usage: { inputTokens?: number; totalTokens?: number }
  finishReason: FinishReason
}

function toRunStep(step: SdkStep): RunStep {
  return {
    text: step.text,
    toolCalls: step.toolCalls.map((call) => ({
      id: call.toolCallId,
      name: call.toolName,
      args: call.input,
    })),
    toolResults: step.toolResults.map((toolResult) => ({
      id: toolResult.toolCallId,
      ok: succeeded(toolResult.output),
      result: toolResult.output,
    })),
    inputTokens: step.usage.inputTokens ?? 0,
    totalTokens: step.usage.totalTokens ?? 0,
  }
}

/**
 * v3: call the model, run whatever tool it asked for, append the call and the
 * result to the conversation, call it again with the longer conversation —
 * until it asks for no tool.
 *
 * `generateText` has been able to do that since the moment v2 handed it
 * `tools`. What v2 did was hold it to two steps and switch the tools off for
 * the second, so there was never a turn in which the model could act on what
 * it had just read. Deleting those two lines is the whole of the loop.
 *
 * v7 adds the one thing that happens *between* two turns of that loop.
 * `prepareStep` is handed the message array on its way to the provider, and it
 * is the only place a program gets to decide the conversation has grown too
 * big to send. Three outcomes, in order:
 *
 * 1. it fits — send it;
 * 2. it is over the trigger and compaction is on — rewrite it, then check again;
 * 3. it is over the ceiling and there is nothing left to do — throw, and let
 *    the run end where it ended.
 *
 * Steps are collected through `onStepFinish` rather than off the result,
 * because outcome 3 means there is no result. A run that overflowed still
 * happened, and a harness that could only record the runs that finished is a
 * harness that cannot see the thing this commit is about.
 */
export async function runOnce(
  task: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const style = options.style ?? resolveStyle()
  const roster = options.roster ?? resolveRoster()
  const root = options.root ?? PROJECT_ROOT
  const compaction = options.compaction ?? false
  const contextLimit = options.contextLimit ?? MEASURED_MODEL_WINDOW
  const maxSteps = options.maxSteps ?? MAX_STEPS
  const budget = budgetOf(contextLimit)

  const escapes: SandboxEscape[] = []
  const refusals: ShellRefusal[] = []
  const fetched: string[] = []
  const steps: RunStep[] = []
  const finishReasons: FinishReason[] = []

  /** Waiting to be attached to the next step the SDK finishes. */
  let pending: CompactionEvent | undefined
  let pendingEstimate: number | undefined
  /** How many messages the last counted request carried, and what it cost. */
  let anchor: ContextAnchor | undefined
  let sentCount = 0
  let compactions = 0
  let summariserInputTokens = 0
  let summariserOutputTokens = 0
  let overflowedAt: number | undefined

  async function summarise(dropped: readonly ModelMessage[]): Promise<string> {
    const result = await generateText({
      model: openai(MODEL_NAME),
      instructions: SUMMARISER_INSTRUCTIONS,
      prompt: summariserPrompt(dropped),
    })
    summariserInputTokens += result.usage?.inputTokens ?? 0
    summariserOutputTokens += result.usage?.outputTokens ?? 0
    return result.text
  }

  const tools = buildTools({
    root,
    roster,
    style,
    web: {
      ...options.web,
      onFetch: (url) => {
        fetched.push(url)
        options.web?.onFetch?.(url)
      },
    },
    onEscape: (error) => {
      escapes.push(error)
      // Loud, and on the terminal rather than only in the trace: a blocked
      // path is the one event in this run that is about the program's
      // safety rather than about the model's answer.
      console.error(`[sandbox] ${error.message}`)
    },
    onRefusal: (error) => {
      refusals.push(error)
      console.error(`[shell] ${error.rule}: ${error.message}`)
    },
  })

  try {
    await generateText({
      model: openai(MODEL_NAME),
      instructions: INSTRUCTIONS,
      prompt: task,
      tools,
      stopWhen: stepCountIs(maxSteps),
      prepareStep: async ({ messages }) => {
        let current = messages
        let estimate = estimateWithAnchor(current, anchor)

        if (compaction && estimate > budget.compactAt && canCompact(current)) {
          const event = await compact(current, summarise, estimate)
          current = event.messages
          pending = event.event
          compactions += 1
          // The counted prefix is gone with the messages it counted, so the
          // next request is estimated from scratch and re-anchors after it.
          anchor = undefined
          estimate = event.event.after
          console.error(
            `[compaction] ${event.event.before} -> ${event.event.after} tokens, ` +
              `${event.event.dropped} message(s) summarised`,
          )
        }

        if (estimate > budget.limit) {
          overflowedAt = estimate
          throw new ContextOverflow(estimate, budget.limit)
        }

        pendingEstimate = estimate
        sentCount = current.length
        return { messages: current }
      },
      onStepFinish: (step) => {
        const sdkStep = step as unknown as SdkStep
        const recorded = toRunStep(sdkStep)
        if (recorded.inputTokens > 0) {
          anchor = { messages: sentCount, tokens: recorded.inputTokens }
        }
        if (pending !== undefined) {
          recorded.compaction = pending
          pending = undefined
        }
        if (pendingEstimate !== undefined) {
          recorded.estimatedInputTokens = pendingEstimate
          pendingEstimate = undefined
        }
        steps.push(recorded)
        finishReasons.push(sdkStep.finishReason)
      },
    })
  } catch (error: unknown) {
    // Only the overflow is caught here, and only because it is an outcome of
    // the experiment rather than a fault. Everything else reaches the caller:
    // a run that threw for some other reason and was written down as a run
    // that ran out of context would be a row in the tally saying something
    // that did not happen.
    if (!(error instanceof ContextOverflow)) throw error
    console.error(`[context] ${error.message}`)
  }

  return {
    model: MODEL_NAME,
    style,
    roster,
    tools: [...ROSTERS[roster]],
    steps,
    stoppedBy:
      overflowedAt === undefined
        ? whatStopped(finishReasons.map((finishReason) => ({ finishReason })))
        : 'context-overflow',
    escapes: escapes.map((error) => error.attempted),
    refusals: refusals.map((error) => ({ command: error.attempted, rule: error.rule })),
    compactions,
    summariserInputTokens,
    summariserOutputTokens,
    fetched,
    contextLimit,
    ...(overflowedAt === undefined ? {} : { overflowedAt }),
    ...(pending === undefined ? {} : { trailingCompaction: pending }),
  }
}
