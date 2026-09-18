type AnyFrame = { type: string; [key: string]: unknown }

function label(frame: AnyFrame): string {
  switch (frame.type) {
    case 'user':
      return 'You'
    case 'assistant':
      return 'Model'
    case 'tool_call':
      return `Tool call — ${String(frame.name)}`
    case 'tool_result':
      return frame.ok === true ? 'Tool result' : 'Tool error'
    case 'compaction':
      return 'Context compaction'
    case 'approval':
      return `Approval — ${String(frame.decision)}`
    default:
      return frame.type
  }
}

function body(frame: AnyFrame): string {
  switch (frame.type) {
    case 'user':
    case 'assistant':
      return String(frame.content)
    case 'tool_call':
      return JSON.stringify(frame.args, null, 2)
    case 'tool_result':
      return typeof frame.result === 'string'
        ? frame.result
        : JSON.stringify(frame.result, null, 2)
    case 'compaction':
      return `${String(frame.before)} tokens -> ${String(frame.after)} tokens: ${String(frame.summary)}`
    case 'approval':
      return `${String(frame.tool)} was ${String(frame.decision)}ed`
    default:
      // Unknown variants render as raw JSON rather than crashing the island.
      return JSON.stringify(frame, null, 2)
  }
}

export function FrameView({ frame }: { frame: AnyFrame }) {
  return (
    <li data-frame-type={frame.type}>
      <p>{label(frame)}</p>
      <pre>{body(frame)}</pre>
    </li>
  )
}
