import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const posts = defineCollection({
  loader: glob({
    pattern: '**/index.mdx',
    base: './src/content/posts',
    // "01-not-an-agent/index.mdx" -> "01-not-an-agent"
    generateId: ({ entry }) => entry.split('/')[0] ?? entry,
  }),
  schema: ({ image }) =>
    z.object({
      order: z.number().int().positive(),
      title: z.string(),
      thesis: z.string(),
      pubDate: z.coerce.date(),
      commit: z.string(),
      cover: image(),
      coverAlt: z.string(),
      // Which recorded trace the cover card quotes. Absent means `trace.json`;
      // a post carrying several traces says which one, rather than letting the
      // cover generator infer it from the order the file names sort in.
      coverTrace: z.string().optional(),
      draft: z.boolean().default(false),
    }),
})

export const collections = { posts }
