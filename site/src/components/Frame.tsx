/*
 * One frame of a recorded run, typeset as a line of dialogue.
 *
 * The site's argument is that an agent is not magic, it is a conversation
 * history. So a frame is set the way a printed interview or a play script is
 * set: the speaker hangs in the left margin, and what was said is real prose
 * type with real leading. Monospace appears only on `args` and `result`,
 * which genuinely are data.
 *
 * Rendered by both the interactive player and the no-script transcript, so
 * there is exactly one typesetting of a trace on the site.
 */

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

/** Prose keeps its paragraph breaks; it is not a log line. */
function speech(content: unknown) {
  return String(content)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph, i) => (
      <p class="frame__speech" key={i}>
        {paragraph}
      </p>
    ))
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
