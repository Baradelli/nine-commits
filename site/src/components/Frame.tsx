/*
 * One frame of a recorded run, typeset as a line of dialogue.
 *
 * The site's argument is that an agent is not magic, it is a conversation
 * history. So a frame is set the way a printed interview or a play script is
 * set: the speaker hangs in the left margin, and what was said is real prose
 * type with real leading. Monospace appears on `args` and `result`, which
 * genuinely are data, and on the spans a model itself marked as code —
 * a command it wrote in backticks is a command, and printing the backticks
 * instead would be typesetting the markup rather than the speech.
 *
 * Rendered by both the interactive player and the no-script transcript, so
 * there is exactly one typesetting of a trace on the site.
 */

import { parseSpeech, type Block, type List, type Span } from '../lib/speech.ts'

export type AnyFrame = { type: string; [key: string]: unknown }

/**
 * The semantic tone drives colour, but never alone: it also selects the
 * margin rule's line type (solid / dashed / dotted / heavy) and the label
 * weight, so a trace stays readable with no colour vision at all.
 */
type Tone = 'user' | 'assistant' | 'tool' | 'ok' | 'error' | 'compaction'

function tone(frame: AnyFrame): Tone {
  switch (frame.type) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'assistant'
    case 'tool_call':
      return 'tool'
    case 'tool_result':
      return frame.ok === true ? 'ok' : 'error'
    case 'compaction':
      return 'compaction'
    case 'approval':
      return frame.decision === 'allow' ? 'ok' : 'error'
    default:
      return 'user'
  }
}

/** Speaker attribution, in the voice of a stage direction. */
function label(frame: AnyFrame): string {
  switch (frame.type) {
    case 'user':
      return 'You'
    case 'assistant':
      return 'Model'
    case 'tool_call':
      return `Calls ${String(frame.name)}`
    case 'tool_result':
      return frame.ok === true ? 'Returns' : 'Fails'
    case 'compaction':
      return 'Compacts'
    case 'approval':
      return frame.decision === 'allow' ? 'Allows' : 'Denies'
    default:
      return frame.type
  }
}

function json(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function count(value: unknown): string {
  return typeof value === 'number'
    ? value.toLocaleString('en-GB')
    : String(value)
}

/** Backticked spans become code; everything else is plain text, escaped. */
function inline(spans: Span[]) {
  return spans.map((span, i) =>
    span.kind === 'code' ? <code key={i}>{span.text}</code> : span.text,
  )
}

function listing(list: List, key: number) {
  const items = list.items.map((item, i) => (
    <li key={i}>
      {inline(item.spans)}
      {render(item.blocks)}
    </li>
  ))

  return list.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
}

function render(blocks: Block[]) {
  return blocks.map((block, i) =>
    block.kind === 'list' ? (
      listing(block, i)
    ) : (
      <p class="frame__speech" key={i}>
        {inline(block.spans)}
      </p>
    ),
  )
}

/**
 * Prose keeps the structure it was written with: paragraph breaks, the lists
 * a model actually emits, and the spans it marked as code. It is not a log
 * line, and it is not one run-on paragraph with the markup left in.
 */
function speech(content: unknown) {
  return render(parseSpeech(String(content)))
}

function body(frame: AnyFrame) {
  switch (frame.type) {
    case 'user':
    case 'assistant':
      return speech(frame.content)

    case 'tool_call':
      return <pre class="payload">{json(frame.args)}</pre>

    case 'tool_result':
      return <pre class="payload">{json(frame.result)}</pre>

    case 'compaction':
      return (
        <>
          {speech(frame.summary)}
          <p class="frame__caption">
            The history was rewritten from {count(frame.before)} tokens down to{' '}
            {count(frame.after)}.
          </p>
        </>
      )

    case 'approval':
      return (
        <p class="frame__note">
          {frame.decision === 'allow'
            ? `${String(frame.tool)} was allowed to run.`
            : `${String(frame.tool)} was blocked before it ran.`}
        </p>
      )

    default:
      // Spec §5: an unknown variant prints its own JSON rather than crashing
      // the island.
      return <pre class="payload">{json(frame)}</pre>
  }
}

export function FrameView({ frame }: { frame: AnyFrame }) {
  return (
    <li class="frame" data-frame-type={frame.type} data-tone={tone(frame)}>
      <p class="frame__label">{label(frame)}</p>
      <div class="frame__body">{body(frame)}</div>
    </li>
  )
}
