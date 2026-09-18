export type CoverInput = {
  order: number
  title: string
  thesis: string
  /** A single line lifted from the real trace, used as background texture. */
  traceLine: string
}

export type SatoriNode = {
  type: string
  props: {
    style?: Record<string, unknown>
    children?: SatoriNode | string | Array<SatoriNode | string>
  }
}

const INK = '#0b0f14'
const PAPER = '#f5f3ee'
const ACCENT = '#5ad1a0'
const MUTED = '#5c6874'

function node(
  type: string,
  style: Record<string, unknown>,
  children?: SatoriNode | string | Array<SatoriNode | string>,
): SatoriNode {
  return { type, props: { style, children } }
}

/**
 * Satori's default `display` is flex, and any node with more than one child
 * must declare it explicitly or its layout silently collapses.
 */
export function buildCover(input: CoverInput): SatoriNode {
  const number = String(input.order).padStart(2, '0')

  return node(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '100%',
      height: '100%',
      padding: '64px',
      backgroundColor: INK,
      color: PAPER,
      fontFamily: 'Inter',
    },
    [
      node(
        'div',
        { display: 'flex', alignItems: 'center', gap: '16px' },
        [
          node(
            'div',
            { display: 'flex', fontSize: 28, fontWeight: 700, color: ACCENT },
            number,
          ),
          node(
            'div',
            { display: 'flex', fontSize: 24, color: MUTED, letterSpacing: '0.18em' },
            'NINE COMMITS',
          ),
        ],
      ),
      node(
        'div',
        { display: 'flex', flexDirection: 'column', gap: '20px' },
        [
          node(
            'div',
            { display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.1 },
            input.title,
          ),
          node(
            'div',
            { display: 'flex', fontSize: 30, color: MUTED, lineHeight: 1.35 },
            input.thesis,
          ),
        ],
      ),
      node(
        'div',
        {
          display: 'flex',
          fontSize: 20,
          color: MUTED,
          opacity: 0.55,
          borderTop: `2px solid ${MUTED}`,
          paddingTop: '20px',
        },
        input.traceLine.slice(0, 96),
      ),
    ],
  )
}
