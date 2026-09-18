import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import matter from 'gray-matter'
import { buildCover } from './covers/layout.ts'
import { parseCoverFrontmatter } from './covers/frontmatter.ts'

const WIDTH = 1200
const HEIGHT = 627
const POSTS_DIR = join('site', 'src', 'content', 'posts')
const FONT_DIR = join('node_modules', '@fontsource', 'inter', 'files')

function loadFonts() {
  return [
    {
      name: 'Inter',
      data: readFileSync(join(FONT_DIR, 'inter-latin-400-normal.woff')),
      weight: 400 as const,
      style: 'normal' as const,
    },
    {
      name: 'Inter',
      data: readFileSync(join(FONT_DIR, 'inter-latin-700-normal.woff')),
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
  return frame?.content?.replace(/\s+/g, ' ').trim() ?? ''
}

async function main(): Promise<void> {
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
      width: WIDTH,
      height: HEIGHT,
      fonts,
    })

    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: WIDTH },
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
