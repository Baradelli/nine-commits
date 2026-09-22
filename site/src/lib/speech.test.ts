import { describe, it, expect } from 'vitest'
import { parseSpeech, parseSpans, type Block, type Span } from './speech.ts'

/** The words of a block tree, flattened, for assertions about structure. */
function text(spans: Span[]): string {
  return spans.map((span) => span.text).join('')
}

describe('parseSpans', () => {
  it('returns one text span when there is no code', () => {
    expect(parseSpans('plain words')).toEqual([
      { kind: 'text', text: 'plain words' },
    ])
  })

  it('lifts inline code out of the surrounding text', () => {
    expect(parseSpans('run `ls -la` twice')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'ls -la' },
      { kind: 'text', text: ' twice' },
    ])
  })

  it('handles code at both ends', () => {
    expect(parseSpans('`a` and `b`')).toEqual([
      { kind: 'code', text: 'a' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'b' },
    ])
  })

  it('leaves an unpaired backtick as text', () => {
    expect(parseSpans('a ` b')).toEqual([{ kind: 'text', text: 'a ` b' }])
  })

  it('returns nothing for an empty string', () => {
    expect(parseSpans('')).toEqual([])
  })
})

describe('parseSpeech', () => {
  it('returns nothing for empty content', () => {
    expect(parseSpeech('')).toEqual([])
    expect(parseSpeech('   \n\n  ')).toEqual([])
  })

  it('keeps blank-line-separated paragraphs apart', () => {
    const blocks = parseSpeech('first\n\nsecond')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph'])
  })

  it('joins a wrapped paragraph into one block', () => {
    const blocks = parseSpeech('one\ntwo')
    expect(blocks).toHaveLength(1)
    expect(text((blocks[0] as { spans: Span[] }).spans)).toBe('one two')
  })

  it('reads a bullet list as a list', () => {
    const blocks = parseSpeech('- alpha\n- beta')
    expect(blocks).toHaveLength(1)
    const list = blocks[0] as Extract<Block, { kind: 'list' }>
    expect(list.kind).toBe('list')
    expect(list.ordered).toBe(false)
    expect(list.items.map((i) => text(i.spans))).toEqual(['alpha', 'beta'])
  })

  it('reads a numbered list as ordered', () => {
    const list = parseSpeech('1. one\n2) two')[0] as Extract<
      Block,
      { kind: 'list' }
    >
    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(2)
  })

  it('accepts every bullet marker', () => {
    const list = parseSpeech('- a\n* b\n+ c')[0] as Extract<
      Block,
      { kind: 'list' }
    >
    expect(list.items).toHaveLength(3)
  })

  it('does not mistake a hyphenated sentence for a bullet', () => {
    expect(parseSpeech('well-formed input')[0]?.kind).toBe('paragraph')
  })

  it('nests an indented list under the item above it', () => {
    const list = parseSpeech('- outer\n  - inner\n  - also\n- next')[0] as Extract<
      Block,
      { kind: 'list' }
    >
    expect(list.items).toHaveLength(2)
    const nested = list.items[0]?.blocks[0] as Extract<Block, { kind: 'list' }>
    expect(nested.kind).toBe('list')
    expect(nested.items.map((i) => text(i.spans))).toEqual(['inner', 'also'])
    expect(list.items[1]?.blocks).toEqual([])
  })

  it('closes a nested list when the indent goes back out', () => {
    const list = parseSpeech('- a\n  - b\n- c')[0] as Extract<
      Block,
      { kind: 'list' }
    >
    expect(list.items.map((i) => text(i.spans))).toEqual(['a', 'c'])
  })

  it('treats a blank line between items as one loose list', () => {
    const blocks = parseSpeech('- a\n\n- b')
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as Extract<Block, { kind: 'list' }>).items).toHaveLength(2)
  })

  it('folds an indented continuation into the item it belongs to', () => {
    const list = parseSpeech('- a claim\n  continued here')[0] as Extract<
      Block,
      { kind: 'list' }
    >
    expect(text(list.items[0]?.spans ?? [])).toBe('a claim continued here')
  })

  /*
   * The deliberate CommonMark deviation, and the reason it exists: the real
   * trace ends with a closing sentence on the line straight after a nested
   * bullet. Lazy continuation would swallow it into that bullet.
   */
  it('ends a list at a flush-left line rather than lazily continuing it', () => {
    const blocks = parseSpeech('- a\n  - b\nclosing sentence')
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'paragraph'])
    expect(text((blocks[1] as { spans: Span[] }).spans)).toBe(
      'closing sentence',
    )
  })

  it('parses inline code inside a list item', () => {
    const list = parseSpeech('- run `wc -l` now')[0] as Extract<
      Block,
      { kind: 'list' }
    >
    expect(list.items[0]?.spans).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'wc -l' },
      { kind: 'text', text: ' now' },
    ])
  })

  it('normalises CRLF', () => {
    expect(parseSpeech('- a\r\n- b')[0]?.kind).toBe('list')
  })

  it('never emits markup, whatever the model wrote', () => {
    const blocks = parseSpeech('- <img src=x onerror=alert(1)>\n\n<b>bold</b>')
    const all = JSON.stringify(blocks)
    expect(all).toContain('<img src=x onerror=alert(1)>')
    // Every leaf is data with a `kind`; nothing here is a string of HTML that
    // a renderer could be talked into injecting.
    for (const block of blocks) {
      expect(['paragraph', 'list']).toContain(block.kind)
    }
  })

  /*
   * The recorded run this component exists to typeset. If this ever stops
   * matching, post 1's transcript has changed shape and the post is wrong.
   */
  it('parses the first real recorded reply into the shape the model wrote', () => {
    const recorded = [
      'I can’t directly count files from the image alone. Please either:',
      '',
      '- Upload a listing of the project files (e.g., output of `find . -name "*.ts" | wc -l` or `tree -a`), or',
      '- Give me the repository or a screenshot that clearly shows all files and folders (with contents).',
      '',
      'If you can run commands, run one of these in the project root and paste the result:',
      '- Linux/macOS:',
      '  - Count TypeScript files:  find . -type f -name "*.ts" | wc -l',
      '  - Show list: find . -type f -name "*.ts"',
      '- Windows PowerShell:',
      '  - Count: Get-ChildItem -Recurse -Filter *.ts | Measure-Object | Select-Object -ExpandProperty Count',
      'I’ll tell you the number once you provide the output.',
    ].join('\n')

    const blocks = parseSpeech(recorded)

    expect(blocks.map((b) => b.kind)).toEqual([
      'paragraph',
      'list',
      'paragraph',
      'list',
      'paragraph',
    ])

    // The two options it offered, as two items rather than one run-on line.
    const options = blocks[1] as Extract<Block, { kind: 'list' }>
    expect(options.items).toHaveLength(2)
    expect(options.items[0]?.spans).toContainEqual({
      kind: 'code',
      text: 'find . -name "*.ts" | wc -l',
    })

    // Two platforms, each with its own commands nested underneath.
    const platforms = blocks[3] as Extract<Block, { kind: 'list' }>
    expect(platforms.items.map((i) => text(i.spans))).toEqual([
      'Linux/macOS:',
      'Windows PowerShell:',
    ])
    expect(
      (platforms.items[0]?.blocks[0] as Extract<Block, { kind: 'list' }>).items,
    ).toHaveLength(2)
    expect(
      (platforms.items[1]?.blocks[0] as Extract<Block, { kind: 'list' }>).items,
    ).toHaveLength(1)

    // The closing line is its own sentence, not the tail of a bullet.
    expect(text((blocks[4] as { spans: Span[] }).spans)).toBe(
      'I’ll tell you the number once you provide the output.',
    )
  })
})
