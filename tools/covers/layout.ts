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

export const COVER_WIDTH = 1200
export const COVER_HEIGHT = 627
export const SERIES_LENGTH = 9

/*
 * The LinkedIn card and the site have to read as one system, so the cover
 * uses the site's own dark pair: blueprint navy ground, cool paper ink, and
 * the cyan the site gives to the model's own voice. The derived tones are
 * the same alpha steps as the stylesheet, flattened to hex because satori
 * is happier with opaque colours.
 */
const GROUND = '#0b1e2d' // --ground, dark
const INK = '#dce6ec' // --ink, dark
const INK_MUTED = '#8c9aa3' // ink at 0.62 over the ground
const INK_FAINT = '#7c8a94' // ink at 0.54 over the ground, 4.8:1
const RULE = '#2c3e4c' // ink at 0.16 over the ground
const ACCENT = '#5fd3e4' // --frame-assistant, dark

const RAIL_WIDTH = 8

/**
 * The trace line is background texture, so it is cut to fit — but cut at a
 * word boundary. A hard slice leaves the card ending mid-word, which reads
 * as a bug rather than as a fragment.
 */
function clip(line: string, max: number): string {
  const text = line.trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`
}

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
  const progress = Math.min(Math.max(input.order / SERIES_LENGTH, 0), 1)

  // The same measure that runs down the margin of every page on the site:
  // how far through a series of nine this post is.
  const rail = node(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      width: RAIL_WIDTH,
      height: '100%',
      backgroundColor: RULE,
    },
    node('div', {
      display: 'flex',
      width: RAIL_WIDTH,
      height: Math.round(COVER_HEIGHT * progress),
      backgroundColor: ACCENT,
    }),
  )

  const content = node(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      flexGrow: 1,
      height: '100%',
      padding: '64px',
    },
    [
      node('div', { display: 'flex', alignItems: 'baseline', gap: '14px' }, [
        node(
          'div',
          { display: 'flex', fontSize: 26, fontWeight: 700, color: ACCENT },
          number,
        ),
        node(
          'div',
          { display: 'flex', fontSize: 26, color: INK_MUTED },
          'Nine Commits',
        ),
      ]),
      node('div', { display: 'flex', flexDirection: 'column', gap: '22px' }, [
        node(
          'div',
          {
            display: 'flex',
            fontSize: 62,
            fontWeight: 700,
            lineHeight: 1.12,
            letterSpacing: '-0.015em',
            color: INK,
          },
          input.title,
        ),
        node(
          'div',
          { display: 'flex', fontSize: 28, color: INK_MUTED, lineHeight: 1.4 },
          input.thesis,
        ),
      ]),
      node(
        'div',
        {
          display: 'flex',
          fontSize: 19,
          color: INK_FAINT,
          borderTop: `1px solid ${RULE}`,
          paddingTop: '18px',
        },
        clip(input.traceLine, 96),
      ),
    ],
  )

  return node(
    'div',
    {
      display: 'flex',
      flexDirection: 'row',
      width: '100%',
      height: '100%',
      backgroundColor: GROUND,
      color: INK,
      fontFamily: 'Literata',
    },
    [rail, content],
  )
}
