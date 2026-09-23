import { tool } from 'ai'
import { z } from 'zod'
import { listFiles, searchFiles } from './fs.ts'
import { DESCRIPTIONS, type DescriptionStyle } from './descriptions.ts'

/*
 * Two tools that really run against the filesystem, and that genuinely
 * compete: one answers "what is here", the other answers "what does it say".
 * Plenty of questions sit in the overlap, and the description is the only
 * thing that tells the model which side of it a question is on.
 *
 * The input schemas carry no `.describe()` on purpose. A parameter
 * description is a description too, and leaving one in would leak the precise
 * wording into the thin run and quietly ruin the comparison.
 */

const listInput = z.object({ directory: z.string() })
const searchInput = z.object({ pattern: z.string() })

export function buildTools(style: DescriptionStyle) {
  const descriptions = DESCRIPTIONS[style]

  return {
    list_files: tool({
      description: descriptions.list_files,
      inputSchema: listInput,
      execute: ({ directory }) => listFiles(directory),
    }),
    search_files: tool({
      description: descriptions.search_files,
      inputSchema: searchInput,
      execute: ({ pattern }) => searchFiles(pattern),
    }),
  }
}
