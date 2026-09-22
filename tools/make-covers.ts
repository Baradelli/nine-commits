import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import matter from 'gray-matter'
import {
  buildCover,
  openingLine,
  COVER_HEIGHT,
  COVER_WIDTH,
} from './covers/layout.ts'
import { parseCoverFrontmatter } from './covers/frontmatter.ts'
import { POSTS_DIR } from './paths.ts'

const FONT_DIR = join('node_modules', '@fontsource', 'literata', 'files')

/**
 * Literata, so the card and the site are set in the same face.
 *
 * `.woff`, never `.woff2`: satori cannot decode woff2 and the failure
 * happens at render time, not at install time.
 */
function loadFonts() {
  return [
    {
      name: 'Literata',
      data: readFileSync(join(FONT_DIR, 'literata-latin-400-normal.woff')),
      weight: 400 as const,
      style: 'normal' as const,
    },
    {
      name: 'Literata',
      data: readFileSync(join(FONT_DIR, 'literata-latin-700-normal.woff')),
      weight: 700 as const,
      style: 'normal' as const,
    },
  ]
}

function firstAssistantLine(postDir: string): string {
  const tracePath = join(postDir, 'trace.json')
  if (!existsSync(tracePath)) return ''
  const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as {
    frames: Array<{ type: string; content?: string }>
  }
  const frame = trace.frames.find((f) => f.type === 'assistant')
  return openingLine(frame?.content ?? '')
}

async function main(): Promise<void> {
  // A9 — `validate-traces` already exits cleanly on a fresh clone with no
  // content collection yet; this died with a raw ENOENT. Two tools reading
  // the same directory must behave the same way when it is not there.
  if (!existsSync(POSTS_DIR)) {
    console.log('no posts directory yet — nothing to render')
    return
  }

  const fonts = loadFonts()
  const slugs = readdirSync(POSTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  for (const slug of slugs) {
    const postDir = join(POSTS_DIR, slug)
    const mdxPath = join(postDir, 'index.mdx')
    if (!existsSync(mdxPath)) continue

    const { data } = matter(readFileSync(mdxPath, 'utf8'))
    const { order, title, thesis } = parseCoverFrontmatter(data, postDir)

    const element = buildCover({
      order,
      title,
      thesis,
      traceLine: firstAssistantLine(postDir),
    })

    const svg = await satori(element as never, {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      fonts,
    })

    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: COVER_WIDTH },
    })
      .render()
      .asPng()

    const out = join(postDir, 'cover.png')
    writeFileSync(out, png)
    console.log(`wrote ${out}`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
