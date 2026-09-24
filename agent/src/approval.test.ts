import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import {
  ALWAYS_ALLOW,
  ALWAYS_DENY,
  answer,
  DENIAL_REASON,
  GATED,
  gateConfig,
  pendingApprovals,
  type ApprovalRecord,
} from './approval.ts'
import { approvalsIn, runOnce, whatStopped } from './run.ts'
import { toRawTrace } from './recorder.ts'
import { parseTrace } from '../../tools/trace/schema.ts'
import { materialise, dispose } from '../../tools/roster/sandbox.ts'

/*
 * The approval path, end to end, with no network and no money.
 *
 * Post 7 debugged the first real `compaction` frame against recorded runs and
 * paid for four discarded batches to find three defects that a fixture would
 * have caught for nothing; its own concern 11 says the fixture should have
 * come first. This file is that fixture. Everything below ran green before a
 * single request was sent to a provider: the gate, the denial the model is
 * handed, the suspension, the resume, the two branches sharing one prefix, and
 * the frame the schema has carried unused since commit 1.
 *
 * The model is `MockLanguageModelV3`, scripted per call. The tools are the
 * real ones, in a real scratch sandbox, so a write that is allowed really
 * writes and a write that is denied really does not.
 */

const WRITE = {
  type: 'tool-call' as const,
  toolCallId: 'call-1',
  toolName: 'write_file',
  input: JSON.stringify({ path: 'notes/gate.md', content: 'port 8137\n' }),
}

const READ = {
  type: 'tool-call' as const,
  toolCallId: 'call-0',
  toolName: 'read_file',
  input: JSON.stringify({ path: 'src/server.ts' }),
}

/** The provider's own usage shape at LanguageModelV3, which is nested. */
const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 40, text: 40, reasoning: 0 },
  totalTokens: 140,
}

type Generate = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>

function says(text: string): Generate {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop' },
    usage: USAGE,
    warnings: [],
  } as unknown as Generate
}

function calls(...toolCalls: { toolCallId: string }[]): Generate {
  return {
    content: toolCalls,
    finishReason: { unified: 'tool-calls' },
    usage: USAGE,
    warnings: [],
  } as unknown as Generate
}

/** A model that plays a fixed script, and remembers what it was sent. */
function scripted(script: Generate[]) {
  const sent: LanguageModelV3CallOptions[] = []
  let at = 0
  const model = new MockLanguageModelV3({
    modelId: 'mock-model',
    doGenerate: async (options) => {
      sent.push(options)
      const next = script[at] ?? says('done')
      at += 1
      return next
    },
  })
  return { model, sent }
}

function sandboxed<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = materialise()
  return body(root).finally(() => dispose(root))
}

describe('the gate decides from a name and nothing else', () => {
  const call = (toolName: string) => ({
    toolCall: { toolName, toolCallId: 'x', input: { path: 'a' } },
  })

  it('is not applicable to a tool outside the set', async () => {
    const gate = gateConfig({ decide: ALWAYS_ALLOW })
    expect(await gate(call('read_file'))).toEqual({ type: 'not-applicable' })
    expect(await gate(call('list_files'))).toEqual({ type: 'not-applicable' })
    expect(await gate(call('fetch_page'))).toEqual({ type: 'not-applicable' })
  })

  it('asks about every tool that changes something that outlives the run', async () => {
    const gate = gateConfig({ decide: ALWAYS_ALLOW })
    for (const tool of GATED) {
      expect(await gate(call(tool))).toEqual({ type: 'approved' })
    }
  })

  it('carries the denial sentence, which is what the model is handed', async () => {
    const gate = gateConfig({ decide: ALWAYS_DENY })
    expect(await gate(call('write_file'))).toEqual({
      type: 'denied',
      reason: DENIAL_REASON,
    })
  })

  it('suspends when there is nobody to ask', async () => {
    const gate = gateConfig({})
    expect(await gate(call('write_file'))).toEqual({ type: 'user-approval' })
    expect(await gate(call('read_file'))).toEqual({ type: 'not-applicable' })
  })

  it('reports every decision to its caller', async () => {
    const seen: ApprovalRecord[] = []
    const gate = gateConfig({ decide: ALWAYS_DENY, onDecision: (r) => seen.push(r) })
    await gate(call('edit_file'))
    await gate(call('read_file'))
    expect(seen).toEqual([
      { tool: 'edit_file', decision: 'deny', toolCallId: 'x', args: { path: 'a' } },
    ])
  })

  it('takes the gated set as data, so an experiment can vary it', async () => {
    const gate = gateConfig({ gate: ['read_file'], decide: ALWAYS_ALLOW })
    expect(await gate(call('read_file'))).toEqual({ type: 'approved' })
    expect(await gate(call('write_file'))).toEqual({ type: 'not-applicable' })
  })
})

describe('an allowed call runs and a denied call does not', () => {
  it('writes the file when the answer is yes', async () => {
    await sandboxed(async (root) => {
      const { model } = scripted([calls(WRITE), says('I created notes/gate.md.')])
      const result = await runOnce('write a note', {
        root,
        model,
        approval: { decide: ALWAYS_ALLOW },
      })

      expect(readFileSync(join(root, 'notes', 'gate.md'), 'utf8')).toBe('port 8137\n')
      expect(result.approvals).toEqual([
        { tool: 'write_file', decision: 'allow', toolCallId: 'call-1', args: expect.anything() },
      ])
      expect(result.stoppedBy).toBe('model')
      expect(result.pending).toEqual([])
    })
  })

  it('leaves the disk alone when the answer is no', async () => {
    await sandboxed(async (root) => {
      const { model } = scripted([calls(WRITE), says('I was not allowed to write it.')])
      const result = await runOnce('write a note', {
        root,
        model,
        approval: { decide: ALWAYS_DENY },
      })

      expect(() => readFileSync(join(root, 'notes', 'gate.md'), 'utf8')).toThrow()
      expect(result.approvals.map((a) => a.decision)).toEqual(['deny'])
    })
  })

  it('hands the model the denial sentence verbatim, not a silent failure', async () => {
    await sandboxed(async (root) => {
      const { model, sent } = scripted([calls(WRITE), says('denied')])
      await runOnce('write a note', { root, model, approval: { decide: ALWAYS_DENY } })

      // The second request is the one that carries what happened to the first
      // call. `execution-denied` is the SDK's output type for a refused call,
      // and `reason` is the string a provider turns into the tool message.
      const second = JSON.stringify(sent[1]?.prompt ?? [])
      expect(second).toContain('execution-denied')
      expect(second).toContain(DENIAL_REASON)
    })
  })

  it('does not ask about a tool outside the set', async () => {
    await sandboxed(async (root) => {
      const { model } = scripted([calls(READ), says('read it')])
      const result = await runOnce('read a file', {
        root,
        model,
        approval: { decide: ALWAYS_DENY },
      })
      expect(result.approvals).toEqual([])
      expect(result.steps[0]?.toolResults[0]?.ok).toBe(true)
    })
  })
})

describe('a suspended run is a conversation with a question in it', () => {
  it('stops, says why, and can be answered twice from the same bytes', async () => {
    await sandboxed(async (root) => {
      const { model } = scripted([calls(WRITE)])
      const suspended = await runOnce('write a note', { root, model, approval: {} })

      expect(suspended.stoppedBy).toBe('approval')
      expect(suspended.pending).toHaveLength(1)
      expect(suspended.pending[0]?.tool).toBe('write_file')
      expect(suspended.approvals).toEqual([])
      // Nothing ran.
      expect(() => readFileSync(join(root, 'notes', 'gate.md'), 'utf8')).toThrow()

      const question = suspended.pending[0]
      if (question === undefined) throw new Error('no pending approval')

      const allowed = await runOnce('write a note', {
        root,
        model: scripted([says('I created notes/gate.md.')]).model,
        approval: { decide: ALWAYS_ALLOW },
        messages: [...suspended.messages, answer(question, 'allow')],
      })
      expect(readFileSync(join(root, 'notes', 'gate.md'), 'utf8')).toBe('port 8137\n')
      // **A resumed run does not know it was ever gated.** `approvals` counts
      // the gates this call answered, and this call answered none: the answer
      // arrived in the conversation it was handed. The decision belongs to the
      // step that asked, which is in the suspended run, and stitching it back
      // onto that step is `tools/hitl/fork.ts`'s job rather than `runOnce`'s.
      // Asserted rather than worked around, because a counter that quietly
      // read zero is how post 6's escape column read zero.
      expect(allowed.approvals).toEqual([])
      expect(allowed.stoppedBy).toBe('model')

      dispose(root)
      const second = materialise()
      const denied = await runOnce('write a note', {
        root: second,
        model: scripted([says('I was told no.')]).model,
        approval: { decide: ALWAYS_DENY },
        messages: [...suspended.messages, answer(question, 'deny')],
      })
      expect(() => readFileSync(join(second, 'notes', 'gate.md'), 'utf8')).toThrow()
      expect(denied.approvals).toEqual([])
      dispose(second)

      // The point of the whole exercise: one prefix, two continuations.
      expect(allowed.steps[0]?.toolCalls).toEqual(denied.steps[0]?.toolCalls)
    })
  })

  it('finds the question in the conversation, and stops finding it once answered', () => {
    const asked = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'write_file', input: { path: 'x' } },
          { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' },
        ],
      },
    ] as Parameters<typeof pendingApprovals>[0]

    expect(pendingApprovals(asked)).toEqual([
      { approvalId: 'a1', toolCallId: 'c1', tool: 'write_file', args: { path: 'x' } },
    ])
    expect(pendingApprovals([...asked, answer(pendingApprovals(asked)[0]!, 'deny')])).toEqual([])
  })

  it('answers with the approval id, not the call id', () => {
    const message = answer(
      { approvalId: 'a1', toolCallId: 'c1', tool: 'write_file', args: {} },
      'deny',
    )
    expect(message).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-approval-response',
          approvalId: 'a1',
          approved: false,
          reason: DENIAL_REASON,
        },
      ],
    })
  })
})

describe('what stopped it', () => {
  const step = (finishReason: 'tool-calls' | 'stop') => ({ finishReason }) as const

  it('is approval whatever the finish reason says', () => {
    expect(whatStopped([step('tool-calls')], 1)).toBe('approval')
    expect(whatStopped([step('stop')], 1)).toBe('approval')
  })

  it('is the old two-way answer when nothing is pending', () => {
    expect(whatStopped([step('tool-calls')], 0)).toBe('step-cap')
    expect(whatStopped([step('stop')], 0)).toBe('model')
  })
})

describe('approvalsIn reads the step the SDK produced', () => {
  it('reads answers and ignores unanswered requests', () => {
    expect(
      approvalsIn([
        { type: 'tool-call', toolCallId: 'c1', toolName: 'write_file' },
        { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' },
        {
          type: 'tool-approval-response',
          approvalId: 'a1',
          approved: false,
          toolCall: { toolCallId: 'c1', toolName: 'write_file', input: { path: 'x' } },
        },
      ]),
    ).toEqual([
      { tool: 'write_file', decision: 'deny', toolCallId: 'c1', args: { path: 'x' } },
    ])
  })

  it('finds nothing in a step that never reached a gate', () => {
    expect(approvalsIn([{ type: 'text', text: 'hello' }])).toEqual([])
    expect(approvalsIn()).toEqual([])
  })
})

describe('the frame the schema has carried since commit 1', () => {
  it('goes between the call and the result, and costs nothing', () => {
    const raw = toRawTrace({
      id: 't',
      commit: 'v9-hitl',
      model: 'mock-model',
      task: 'write a note',
      userMessage: 'write a note',
      expected: ['notes/gate.md'],
      steps: [
        {
          text: '',
          toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'notes/gate.md' } }],
          toolResults: [{ id: 'c1', ok: true, result: { ok: true } }],
          approvals: [
            { tool: 'write_file', decision: 'allow', toolCallId: 'c1', args: {} },
          ],
          inputTokens: 100,
          totalTokens: 140,
        },
        {
          text: 'I created notes/gate.md.',
          toolCalls: [],
          toolResults: [],
          inputTokens: 160,
          totalTokens: 180,
        },
      ],
    })

    const trace = parseTrace(raw)
    expect(trace.frames.map((frame) => frame.type)).toEqual([
      'user',
      'tool_call',
      'approval',
      'tool_result',
      'assistant',
    ])
    expect(trace.frames[2]).toEqual({
      type: 'approval',
      tool: 'write_file',
      decision: 'allow',
    })
    // Flat across the gate: the call and the approval carry the same figure.
    expect(trace.tokens[1]).toBe(trace.tokens[2])
  })

  it('pairs a gate with its own call when a step made several', () => {
    const raw = toRawTrace({
      id: 't',
      commit: 'v9-hitl',
      model: 'mock-model',
      task: 'two things',
      userMessage: 'two things',
      expected: ['done'],
      steps: [
        {
          text: 'done',
          toolCalls: [
            { id: 'c1', name: 'read_file', args: {} },
            { id: 'c2', name: 'write_file', args: {} },
          ],
          toolResults: [{ id: 'c1', ok: true, result: {} }],
          approvals: [
            { tool: 'write_file', decision: 'deny', toolCallId: 'c2', args: {} },
          ],
          inputTokens: 10,
          totalTokens: 20,
        },
      ],
    })

    const trace = parseTrace(raw)
    expect(trace.frames.map((frame) => frame.type)).toEqual([
      'user',
      'tool_call',
      'tool_call',
      'approval',
      'tool_result',
      'assistant',
    ])
  })

  it('produces no approval frame in a run that never reached a gate', () => {
    const raw = toRawTrace({
      id: 't',
      commit: 'v9-hitl',
      model: 'mock-model',
      task: 'read',
      userMessage: 'read',
      expected: ['done'],
      steps: [
        {
          text: 'done',
          toolCalls: [{ id: 'c1', name: 'read_file', args: {} }],
          toolResults: [{ id: 'c1', ok: true, result: {} }],
          inputTokens: 10,
          totalTokens: 20,
        },
      ],
    })
    expect(
      parseTrace(raw).frames.filter((frame) => frame.type === 'approval'),
    ).toEqual([])
  })
})
