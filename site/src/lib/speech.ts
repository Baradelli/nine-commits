/*
 * What a model actually says, parsed into the shape it was written in.
 *
 * A recorded assistant turn is markdown — not because anyone asked for
 * markdown, but because that is what models emit. The first real trace in
 * this repository contains a two-level bullet list and two spans of inline
 * code, and the transcript was printing all of it as one run-on paragraph
 * with the backticks still in it.
 *
 * So this is a deliberately small block parser: paragraphs, bullet and
 * numbered lists with nesting, and inline code. Nothing else. A transcript is
 * not a CMS, and the output is a tree of plain data rather than a string of
 * HTML precisely because model output is untrusted text — `Frame.tsx` renders
 * these nodes through JSX, which escapes, and no path here produces markup.
 *
 * Emphasis, headings, links and fenced blocks are not handled on purpose: no
 * recorded run has needed them yet, and every construct added here is one
 * more way for a trace to render as something other than what the model said.
 */

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }

export type Paragraph = { kind: 'paragraph'; spans: Span[] }

export type List = { kind: 'list'; ordered: boolean; items: Item[] }

/** A list item: its own words, plus any list nested underneath it. */
export type Item = { spans: Span[]; blocks: Block[] }

export type Block = Paragraph | List

/** `- item`, `* item`, `+ item`, `1. item`, `2) item`, at any indent. */
const ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*)$/

/** Inline code, single backticks, never spanning a line. */
const CODE = /`([^`\n]+)`/g

export function parseSpans(text: string): Span[] {
  const spans: Span[] = []
  let cut = 0

  for (const match of text.matchAll(CODE)) {
    const at = match.index
    if (at > cut) spans.push({ kind: 'text', text: text.slice(cut, at) })
    spans.push({ kind: 'code', text: match[1] ?? '' })
    cut = at + match[0].length
  }

  if (cut < text.length) spans.push({ kind: 'text', text: text.slice(cut) })
  return spans
}

type Open = { indent: number; list: List }

export function parseSpeech(content: string): Block[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  const open: Open[] = []
  let paragraph: string[] = []

  function flush(): void {
    if (paragraph.length === 0) return
    blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ')) })
    paragraph = []
  }

  function item(indent: number, text: string, ordered: boolean): void {
    flush()

    // Close every list indented deeper than this line.
    while (open.length > 0 && (open[open.length - 1] as Open).indent > indent) {
      open.pop()
    }

    const top = open[open.length - 1]
    const next: Item = { spans: parseSpans(text), blocks: [] }

    if (top !== undefined && indent <= top.indent) {
      top.list.items.push(next)
      return
    }

    const list: List = { kind: 'list', ordered, items: [next] }

    if (top !== undefined) {
      // Deeper than the innermost open list: nest under its last item.
      const parent = top.list.items[top.list.items.length - 1]
      if (parent === undefined) {
        top.list.items.push(next)
        return
      }
      parent.blocks.push(list)
    } else {
      // A blank line between items makes a loose list, not two lists, so a
      // new top-level item rejoins the list immediately above it.
      const last = blocks[blocks.length - 1]
      if (last !== undefined && last.kind === 'list') {
        last.items.push(next)
        open.push({ indent, list: last })
        return
      }
      blocks.push(list)
    }

    open.push({ indent, list })
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flush()
      open.length = 0
      continue
    }

    const match = ITEM.exec(line)
    if (match !== null) {
      const indent = (match[1] ?? '').length
      item(indent, match[2] ?? '', /^\s*\d/.test(line))
      continue
    }

    const top = open[open.length - 1]
    const indent = line.length - line.trimStart().length

    if (top !== undefined && indent > top.indent) {
      // An indented plain line under an open item is that item continuing.
      const last = top.list.items[top.list.items.length - 1]
      if (last !== undefined) {
        last.spans.push({ kind: 'text', text: ' ' }, ...parseSpans(line.trim()))
        continue
      }
    }

    /*
     * A flush-left plain line ENDS the list. CommonMark would lazily fold it
     * into the last item instead, and that is wrong for a transcript: the
     * first real trace closes with "I'll tell you the number once you provide
     * the output" on the line straight after a nested bullet, and swallowing
     * a model's closing sentence into a list item misrepresents what it said.
     * Fidelity to the speaker beats fidelity to the spec here.
     */
    open.length = 0
    paragraph.push(line.trim())
  }

  flush()
  return blocks
}
