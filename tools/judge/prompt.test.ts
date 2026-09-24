import { describe, expect, it } from 'vitest'
import { parseTrace, type Trace } from '../trace/schema.ts'
import { MODEL_NAME_QUESTION, FILE_COUNT_QUESTION } from '../eval/question.ts'
import { buildJudgePrompt, renderTrace, UnrenderableFrame } from './prompt.ts'

function trace(frames: unknown[], outcome = 'success'): Trace {
  return parseTrace({
    id: 'fixture-run',
    commit: 'v-fixture',
    model: 'a-model',
    task: 'where is the port set',
    outcome,
    tokens: frames.map(() => 10),
    frames,
  })
}

const searched = trace([
  { type: 'user', content: 'where is the port set' },
  { type: 'tool_call', id: 'c1', name: 'search_files', args: { pattern: 'PORT' } },
  {
    type: 'tool_result',
    id: 'c1',
    ok: true,
    result: {
      ok: true,
      pattern: 'PORT',
      filesSearched: 3,
      truncated: false,
      matches: [
        { file: 'src/server.ts', line: 7, text: 'const PORT = 8080' },
        { file: 'README.md', line: 2, text: 'runs on port 8080' },
      ],
    },
  },
  { type: 'assistant', content: 'src/server.ts sets it to 8080.' },
])

describe('the trace a judge is shown', () => {
  it('prints every match with the file and line it came from', () => {
    const rendered = renderTrace(searched)
    expect(rendered).toContain('src/server.ts:7  const PORT = 8080')
    expect(rendered).toContain('README.md:2  runs on port 8080')
  })

  it('prints the tool and the arguments it was called with', () => {
    expect(renderTrace(searched)).toContain(
      'called search_files with {"pattern":"PORT"}',
    )
  })

  it('prints every path a listing returned', () => {
    const listed = trace([
      { type: 'user', content: 'what is here' },
      { type: 'tool_call', id: 'c1', name: 'list_files', args: {} },
      {
        type: 'tool_result',
        id: 'c1',
        ok: true,
        result: { ok: true, directory: '.', truncated: false, files: ['a.ts', 'b.ts'] },
      },
      { type: 'assistant', content: 'two files' },
    ])
    const rendered = renderTrace(listed)
    expect(rendered).toContain('listed 2 path(s)')
    expect(rendered).toContain('a.ts')
    expect(rendered).toContain('b.ts')
  })

  it('says a call failed, and what it said', () => {
    const failed = trace([
      { type: 'user', content: 'look outside' },
      { type: 'tool_call', id: 'c1', name: 'list_files', args: { directory: '../..' } },
      {
        type: 'tool_result',
        id: 'c1',
        ok: false,
        result: { ok: false, error: '"../.." is outside the project.' },
      },
      { type: 'assistant', content: 'I cannot.' },
    ])
    expect(renderTrace(failed)).toContain('the call failed: "../.." is outside the project.')
  })

  /**
   * The grade the recorder wrote into the file is another grader's verdict on
   * the run, and handing it to a judge on the way to asking for its own would
   * make the answer meaningless. It is the one thing the renderer drops.
   */
  it('does not carry the recorded outcome, the run id or the commit', () => {
    const rendered = renderTrace(searched)
    expect(rendered).not.toContain('success')
    expect(rendered).not.toContain('fixture-run')
    expect(rendered).not.toContain('v-fixture')
  })

  /**
   * The same rule `observationsOf` applies. A result shape this file does not
   * understand renders as nothing, the judge is handed a run that looks like
   * it read the project and found it empty, and every verdict comes back
   * `unevidenced` from a harness that had stopped reading.
   */
  it('refuses a tool result it does not understand', () => {
    const odd = trace([
      { type: 'user', content: 'read a file' },
      { type: 'tool_call', id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
      { type: 'tool_result', id: 'c1', ok: true, result: { ok: true, contents: 'hello' } },
      { type: 'assistant', content: 'it says hello' },
    ])
    expect(() => renderTrace(odd)).toThrow(UnrenderableFrame)
  })

  /**
   * This case used to assert the opposite, with a `compaction` frame as its
   * example of a variant the renderer does not know. v7 makes that frame real,
   * so the assertion moves to the one variant that is still unbuilt — post 9's
   * `approval` — and this one becomes a test that a compaction is shown rather
   * than skipped.
   *
   * Skipping would be the worse failure of the two. A judge handed a trace
   * whose middle had silently vanished would grade a run on evidence that was
   * deleted without being told it had been, and would blame the run for it.
   */
  it('shows a compaction, including what the summary stood in for', () => {
    const compacted = trace([
      { type: 'user', content: 'a long task' },
      { type: 'compaction', before: 9000, after: 1200, summary: 'read two pages' },
      { type: 'assistant', content: 'done' },
    ])
    const rendered = renderTrace(compacted)
    expect(rendered).toContain('compacted')
    expect(rendered).toContain('9000')
    expect(rendered).toContain('1200')
    expect(rendered).toContain('read two pages')
  })

  it('refuses a frame type it does not understand', () => {
    const approved = trace([
      { type: 'user', content: 'delete it' },
      { type: 'approval', tool: 'run_shell', decision: 'allow' },
      { type: 'assistant', content: 'done' },
    ])
    expect(() => renderTrace(approved)).toThrow(UnrenderableFrame)
  })
})

describe('the question put to a judge', () => {
  const prompt = buildJudgePrompt(searched, MODEL_NAME_QUESTION)

  it('names the source of truth and the string that marks it', () => {
    expect(prompt).toContain('agent/src/config.ts')
    expect(prompt).toContain('is a copy of the answer, not the source')
  })

  it('offers all four verdicts, including the one that declines', () => {
    for (const verdict of ['grounded', 'from-copy', 'undecidable', 'unevidenced']) {
      expect(prompt).toContain(verdict)
    }
  })

  /**
   * The judge must not be able to read this post's conclusion off its own
   * prompt. No sentence tells it what to do when both the source and a copy
   * came back, which is the only case that is actually in question.
   */
  it('never says what to do when both the source and a copy were returned', () => {
    expect(prompt).not.toMatch(/both/i)
    expect(prompt).not.toMatch(/cannot tell/i)
    expect(prompt).not.toMatch(/if in doubt|when in doubt|prefer/i)
  })

  it('refuses a question with no source of truth rather than judging it', () => {
    expect(() => buildJudgePrompt(searched, FILE_COUNT_QUESTION)).toThrow(
      /no source of truth/,
    )
  })
})

describe('the trace a judge is shown, on the tools v6 added', () => {
  const wrote = trace([
    { type: 'user', content: 'change the timeout' },
    { type: 'tool_call', id: 'r1', name: 'read_file', args: { path: 'config.json' } },
    {
      type: 'tool_result',
      id: 'r1',
      ok: true,
      result: {
        ok: true,
        file: 'config.json',
        lines: 3,
        truncated: false,
        content: ['{', '  "timeoutMs": 4500', '}'].join('\n'),
      },
    },
    {
      type: 'tool_call',
      id: 'w1',
      name: 'edit_file',
      args: { path: 'config.json', old_text: '4500', new_text: '9000' },
    },
    {
      type: 'tool_result',
      id: 'w1',
      ok: true,
      result: { ok: true, file: 'config.json', bytes: 27, created: false },
    },
    { type: 'assistant', content: 'Done.' },
  ])

  it('prints a read line by line, with the file and line number on each', () => {
    const rendered = renderTrace(wrote)
    expect(rendered).toContain('read config.json — 3 line(s)')
    expect(rendered).toContain('config.json:2    "timeoutMs": 4500')
  })

  it('prints a write as the event it is, not as silence', () => {
    // Silence is the failure this renderer exists to avoid: a judge shown
    // nothing for a write would grade a run that changed a file as a run that
    // did not.
    expect(renderTrace(wrote)).toContain('wrote config.json — 27 byte(s) afterwards')
  })

  it('still refuses a result shape nobody taught it about', () => {
    const renamed = trace([
      { type: 'user', content: 'rename it' },
      { type: 'tool_call', id: 'x', name: 'rename_file', args: {} },
      { type: 'tool_result', id: 'x', ok: true, result: { ok: true, from: 'a', to: 'b' } },
    ])
    expect(() => renderTrace(renamed)).toThrow(UnrenderableFrame)
  })
})

describe('the trace a judge is shown, on the tool v8 added', () => {
  /*
   * Disabling this branch entirely left the whole suite green, which made the
   * line below — the one that stops a command result being rendered as
   * silence — a claim with no test under it. It is the same defect post 4 and
   * post 5 both shipped, one tool later.
   */
  const ran = trace([
    { type: 'user', content: 'which file is largest' },
    {
      type: 'tool_call',
      id: 'c1',
      name: 'run_command',
      args: { command: 'wc -c README.md' },
    },
    {
      type: 'tool_result',
      id: 'c1',
      ok: true,
      result: {
        ok: true,
        command: 'wc -c README.md',
        exitCode: 0,
        stdout: '191 README.md\n969 total',
        stderr: '',
        truncated: false,
        timedOut: false,
      },
    },
    { type: 'assistant', content: 'README.md, 191 bytes.' },
  ])

  it('renders a command result rather than raising on it', () => {
    expect(() => renderTrace(ran)).not.toThrow(UnrenderableFrame)
    expect(renderTrace(ran)).toContain('ran "wc -c README.md" — exit 0')
  })

  it('prints both streams, labelled, so a complaint is not read as a finding', () => {
    const rendered = renderTrace(ran)
    expect(rendered).toContain('out  191 README.md')
    expect(rendered).toContain('out  969 total')

    const failed = trace([
      { type: 'user', content: 'search' },
      { type: 'tool_call', id: 'c2', name: 'run_command', args: { command: 'grep -r x ..' } },
      {
        type: 'tool_result',
        id: 'c2',
        ok: true,
        result: {
          ok: true,
          command: 'grep -r x ..',
          exitCode: 2,
          stdout: '',
          stderr: 'grep: ..: No such file or directory',
          truncated: false,
          timedOut: false,
        },
      },
    ])
    const renderedFailure = renderTrace(failed)
    expect(renderedFailure).toContain('ran "grep -r x .." — exit 2')
    expect(renderedFailure).toContain('err  grep: ..: No such file or directory')
    expect(renderedFailure).not.toContain('out  ')
  })

  it('says when the output was cut off or the command was killed', () => {
    const killed = trace([
      { type: 'user', content: 'search' },
      { type: 'tool_call', id: 'c3', name: 'run_command', args: { command: 'grep -r x .' } },
      {
        type: 'tool_result',
        id: 'c3',
        ok: true,
        result: {
          ok: true,
          command: 'grep -r x .',
          exitCode: null,
          stdout: 'a',
          stderr: '',
          truncated: true,
          timedOut: true,
        },
      },
    ])
    const rendered = renderTrace(killed)
    expect(rendered).toContain('exit killed')
    expect(rendered).toContain('output cut off at the limit')
    expect(rendered).toContain('killed at the timeout')
  })
})
