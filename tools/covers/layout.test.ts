import { describe, it, expect } from 'vitest'
import { buildCover } from './layout.ts'

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
