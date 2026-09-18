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
      draft: z.boolean().default(false),
    }),
})

export const collections = { posts }
