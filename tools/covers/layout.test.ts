import { describe, it, expect } from 'vitest'
import { buildCover, openingLine } from './layout.ts'

const input = {
  order: 1,
  title: 'An LLM Is Not an Agent',
  thesis: 'Without a loop, it is a chatbot.',
  traceLine: 'assistant: You can run `find . -name "*.ts" | wc -l`.',
}

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } }

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node)
  const children = node.props.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    if (child && typeof child === 'object') walk(child as Node, visit)
  }
}

describe('buildCover', () => {
  it('returns a satori element tree with no React dependency', () => {
    const tree = buildCover(input)
    expect(tree.type).toBe('div')
    expect(tree.props.style).toBeDefined()
  })

  it('gives every multi-child node an explicit display, as satori requires', () => {
    const offenders: string[] = []
    walk(buildCover(input) as Node, (node) => {
      const children = node.props.children
      if (Array.isArray(children) && children.length > 1) {
        const display = node.props.style?.display
        if (display !== 'flex' && display !== 'none' && display !== 'contents') {
          offenders.push(node.type)
        }
      }
    })
    expect(offenders).toEqual([])
  })

  it('includes the post number and the title', () => {
    const text: string[] = []
    walk(buildCover(input) as Node, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    expect(text).toContain('01')
    expect(text).toContain('An LLM Is Not an Agent')
  })

  it('pads single-digit post numbers', () => {
    const text: string[] = []
    walk(buildCover({ ...input, order: 9 }) as Node, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    expect(text).toContain('09')
  })
})

describe('openingLine', () => {
  it('takes only the first line, not the whole reply', () => {
    expect(openingLine('First sentence.\n- a bullet\n- another')).toBe(
      'First sentence.',
    )
  })

  it('does not drag a list marker inline behind the opening sentence', () => {
    // The defect this exists for: the first card generated from a real trace
    // read "...Please either: - Upload a listing of the...".
    expect(openingLine('Please either:\n\n- Upload a listing')).not.toContain(
      '-',
    )
  })

  it('strips a marker when the reply opens on a list', () => {
    expect(openingLine('- Upload a listing of the files')).toBe(
      'Upload a listing of the files',
    )
    expect(openingLine('1. Run the command')).toBe('Run the command')
  })

  it('collapses runs of whitespace inside that line', () => {
    expect(openingLine('Count  TypeScript   files:\tnow')).toBe(
      'Count TypeScript files: now',
    )
  })

  it('handles CRLF and empty content', () => {
    expect(openingLine('one\r\ntwo')).toBe('one')
    expect(openingLine('')).toBe('')
  })

  it('keeps a hyphenated word that is not a bullet', () => {
    expect(openingLine('well-formed output')).toBe('well-formed output')
  })
})
