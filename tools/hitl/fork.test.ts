import { describe, expect, it } from 'vitest'
import { MockLanguageModelV3 } from 'ai/test'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import { runOnce } from '../../agent/src/run.ts'
import { ALWAYS_ALLOW } from '../../agent/src/approval.ts'
import { toRawTrace } from '../../agent/src/recorder.ts'
import { parseTrace } from '../trace/schema.ts'
import { materialise, snapshot, dispose } from '../roster/sandbox.ts'
import { attachGate, forkAtGate, NoGateReached } from './fork.ts'

/*
 * The fork, proved offline before it was ever paid for.
 *
 * Two claims are checked here that the published page makes in words: that the
 * two branches share one recorded prefix rather than two that agree, and that
 * saying *yes* at a gate costs nothing — not approximately nothing, but the
 * same bytes, which is a thing a test can assert and a tally cannot.
 */

const USAGE = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 40, text: 40, reasoning: 0 },
  totalTokens: 140,
}

type Generate = Awaited<ReturnType<MockLanguageModelV3['doGenerate']>>

const read = {
  type: 'tool-call',
  toolCallId: 'c0',
  toolName: 'read_file',
  input: JSON.stringify({ path: 'src/server.ts' }),
}
const write = {
  type: 'tool-call',
  toolCallId: 'c1',
  toolName: 'write_file',
  input: JSON.stringify({ path: 'notes/ports.md', content: 'port 8137\n' }),
}

function step(content: unknown[], unified: 'stop' | 'tool-calls'): Generate {
  return {
    content,
    finishReason: { unified },
    usage: USAGE,
    warnings: [],
  } as unknown as Generate
}

/**
 * A model that answers by what it is shown rather than by a fixed script.
 *
 * A scripted list would make the two branches the same by construction, which
 * is the thing under test. This one reads the conversation it is handed: if
 * the last tool message says the call was denied it says so, and otherwise it
 * reports the write. Both continuations therefore come out of the same
 * function and differ only because they were handed different bytes.
 */
function reactive() {
  const sent: LanguageModelV3CallOptions[] = []
  const model = new MockLanguageModelV3({
    modelId: 'mock-model',
    doGenerate: async (options) => {
      sent.push(options)
      const seen = JSON.stringify(options.prompt)
      if (!seen.includes('"c0"')) return step([read], 'tool-calls')
      if (!seen.includes('"c1"')) return step([write], 'tool-calls')
      return step(
        [
          {
            type: 'text',
            text: seen.includes('denied')
              ? 'I was not allowed to create notes/ports.md, so nothing was written.'
              : 'I created notes/ports.md with the port and its source file.',
          },
        ],
        'stop',
      )
    },
  })
  return { model, sent }
}

describe('forkAtGate', () => {
  it('records one prefix and two real continuations of it', async () => {
    const { model } = reactive()
    const fork = await forkAtGate({
      task: 'Create a file at notes/ports.md …',
      roster: 'four',
      materialise,
      snapshot,
      dispose,
      model,
    })

    expect(fork.suspended.stoppedBy).toBe('approval')
    expect(fork.question.tool).toBe('write_file')
    expect(fork.branches.map((branch) => branch.decision)).toEqual(['allow', 'deny'])

    const [allow, deny] = fork.branches
    if (allow === undefined || deny === undefined) throw new Error('two branches')

    // The prefix is one recording. Everything up to and including the step
    // that asked is the same object graph in both branches, bar the one fact
    // the fork itself attached.
    const prefixLength = fork.suspended.steps.length
    expect(allow.steps.slice(0, prefixLength).map((s) => s.toolCalls)).toEqual(
      deny.steps.slice(0, prefixLength).map((s) => s.toolCalls),
    )

    // And the continuations really differ.
    expect(allow.after.steps.at(-1)?.text).not.toBe(deny.after.steps.at(-1)?.text)
    expect(snapshot(allow.root)['notes/ports.md']).toBe('port 8137\n')
    expect(snapshot(deny.root)['notes/ports.md']).toBeUndefined()

    dispose(allow.root)
    dispose(deny.root)
  })

  it('refuses to call a run with no question a fork', async () => {
    const model = new MockLanguageModelV3({
      modelId: 'mock-model',
      doGenerate: async () => step([{ type: 'text', text: 'nothing to do' }], 'stop'),
    })
    await expect(
      forkAtGate({ task: 'nothing', roster: 'four', materialise, snapshot, dispose, model }),
    ).rejects.toBeInstanceOf(NoGateReached)
  })

  it('produces a trace whose branch point is an approval frame', async () => {
    const { model } = reactive()
    const fork = await forkAtGate({
      task: 'Create a file at notes/ports.md …',
      roster: 'four',
      materialise,
      snapshot,
      dispose,
      model,
    })

    const traces = fork.branches.map((branch) =>
      parseTrace(
        toRawTrace({
          id: `branch-${branch.decision}`,
          commit: 'v9-hitl',
          model: 'mock-model',
          task: 'Create a file at notes/ports.md …',
          userMessage: 'Create a file at notes/ports.md …',
          steps: branch.steps,
          expected: ['notes/ports.md'],
        }),
      ),
    )

    const [allow, deny] = traces
    if (allow === undefined || deny === undefined) throw new Error('two traces')

    const gate = allow.frames.findIndex((frame) => frame.type === 'approval')
    expect(gate).toBeGreaterThan(0)
    expect(deny.frames.findIndex((frame) => frame.type === 'approval')).toBe(gate)

    // Identical up to the gate, different from the gate on. This is the
    // property the page's branching player rests on, and it is asserted
    // against the same function that writes the published files.
    expect(JSON.stringify(allow.frames.slice(0, gate))).toBe(
      JSON.stringify(deny.frames.slice(0, gate)),
    )
    expect(allow.frames[gate]).toEqual({
      type: 'approval',
      tool: 'write_file',
      decision: 'allow',
    })
    expect(deny.frames[gate]).toEqual({
      type: 'approval',
      tool: 'write_file',
      decision: 'deny',
    })

    // The regression the first recorded fork found. An approved call is
    // executed before the continuation's first step, so it lands in no
    // `StepResult`, and the allowed branch shipped with no evidence that the
    // write ever happened: call, approval, and then the model claiming
    // success. The denied branch is right to have none — nothing ran.
    expect(allow.frames[gate + 1]).toMatchObject({ type: 'tool_result', ok: true })
    expect(deny.frames[gate + 1]?.type).not.toBe('tool_result')

    for (const branch of fork.branches) dispose(branch.root)
  })
})

describe('what a gate costs when the answer is yes', () => {
  it('is nothing: the provider is sent the same bytes', async () => {
    const roots = [materialise(), materialise()]
    const [gatedRoot, plainRoot] = roots as [string, string]

    const gated = reactive()
    await runOnce('Create a file at notes/ports.md …', {
      root: gatedRoot,
      model: gated.model,
      approval: { decide: ALWAYS_ALLOW },
    })

    const plain = reactive()
    await runOnce('Create a file at notes/ports.md …', {
      root: plainRoot,
      model: plain.model,
    })

    // The SDK strips `tool-approval-request` and `tool-approval-response`
    // parts on their way to the provider, so an approved gate leaves no trace
    // in the conversation at all. Every request of the gated run is
    // byte-identical to the same request of the ungated one.
    expect(gated.sent).toHaveLength(plain.sent.length)
    for (let i = 0; i < gated.sent.length; i += 1) {
      expect(JSON.stringify(gated.sent[i]?.prompt)).toBe(
        JSON.stringify(plain.sent[i]?.prompt),
      )
    }

    for (const root of roots) dispose(root)
  })
})

describe('attachGate', () => {
  it('puts the decision on the step that made the call and nowhere else', () => {
    const steps = [
      { text: '', toolCalls: [{ id: 'a', name: 'read_file', args: {} }], toolResults: [], inputTokens: 1, totalTokens: 2 },
      { text: '', toolCalls: [{ id: 'b', name: 'write_file', args: {} }], toolResults: [], inputTokens: 3, totalTokens: 4 },
    ]
    const out = attachGate(steps, 'b', 'write_file', 'deny', { path: 'x' })
    expect(out[0]?.approvals).toBeUndefined()
    expect(out[1]?.approvals).toEqual([
      { tool: 'write_file', decision: 'deny', toolCallId: 'b', args: { path: 'x' } },
    ])
    expect(out[1]?.toolResults).toEqual([])
  })

  it('puts back a result the continuation executed and no step recorded', () => {
    const steps = [
      { text: '', toolCalls: [{ id: 'b', name: 'write_file', args: {} }], toolResults: [], inputTokens: 3, totalTokens: 4 },
    ]
    const out = attachGate(steps, 'b', 'write_file', 'allow', {}, [
      { id: 'b', ok: true, result: { ok: true } },
      { id: 'other', ok: true, result: {} },
    ])
    expect(out[0]?.toolResults).toEqual([{ id: 'b', ok: true, result: { ok: true } }])
  })
})
