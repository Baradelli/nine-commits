import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { createFs, PROJECT_ROOT, type Fs } from './fs.ts'
import type { SandboxEscape } from './sandbox.ts'
import {
  DESCRIPTIONS,
  type DescriptionStyle,
  type ToolName,
} from './descriptions.ts'
import { ROSTERS, type Roster } from './roster.ts'

/*
 * The tools the model is handed, built from three pieces of data: which root
 * they are bound to, which roster is in play, and which set of descriptions is
 * selected. Nothing here decides anything; the experiment is entirely in the
 * arguments.
 *
 * The input schemas carry no `.describe()` on purpose. A parameter description
 * is a description too, and leaving one in would leak the precise wording into
 * the thin run and quietly ruin post 2's comparison.
 */

const listInput = z.object({ directory: z.string() })
const searchInput = z.object({ pattern: z.string() })
const pathInput = z.object({ path: z.string() })
const writeInput = z.object({ path: z.string(), content: z.string() })
const editInput = z.object({
  path: z.string(),
  old_text: z.string(),
  new_text: z.string(),
})

export type BuildOptions = {
  root?: string
  roster?: Roster
  style?: DescriptionStyle
  /** Called whenever the guard refused a path, so a block is never silent. */
  onEscape?: (error: SandboxEscape) => void
}

function define(name: ToolName, fs: Fs, style: DescriptionStyle): Tool {
  const description = DESCRIPTIONS[style][name]

  switch (name) {
    case 'list_files':
      return tool({
        description,
        inputSchema: listInput,
        execute: ({ directory }) => fs.listFiles(directory),
      })
    case 'search_files':
      return tool({
        description,
        inputSchema: searchInput,
        execute: ({ pattern }) => fs.searchFiles(pattern),
      })
    case 'read_file':
      return tool({
        description,
        inputSchema: pathInput,
        execute: ({ path }) => fs.readFile(path),
      })
    case 'write_file':
      return tool({
        description,
        inputSchema: writeInput,
        execute: ({ path, content }) => fs.writeFile(path, content),
      })
    case 'edit_file':
      return tool({
        description,
        inputSchema: editInput,
        execute: ({ path, old_text, new_text }) =>
          fs.editFile(path, old_text, new_text),
      })
    case 'append_file':
      return tool({
        description,
        inputSchema: writeInput,
        execute: ({ path, content }) => fs.appendFile(path, content),
      })
  }
}

/** Whether a roster contains a tool that can change a file. */
export function rosterWrites(roster: Roster): boolean {
  return ROSTERS[roster].some((name) =>
    name === 'write_file' || name === 'edit_file' || name === 'append_file',
  )
}

/**
 * Builds the tool object handed to `generateText`.
 *
 * The root defaults to this repository and is read-only, which is what
 * commits 2 to 5 shipped. Write tools are built only when the roster asks for
 * them, and `createFs` then refuses any root that is not scratch space — so a
 * caller who forgets to point the agent at a sandbox gets an exception before
 * the model is called, rather than an agent with a write and a public
 * repository under it.
 */
export function buildTools(options: BuildOptions = {}): Record<string, Tool> {
  const roster = options.roster ?? 'four'
  const style = options.style ?? 'precise'
  const root = options.root ?? PROJECT_ROOT

  const fs = createFs(root, {
    writable: rosterWrites(roster),
    onEscape: options.onEscape,
  })

  return Object.fromEntries(
    ROSTERS[roster].map((name) => [name, define(name, fs, style)]),
  )
}
