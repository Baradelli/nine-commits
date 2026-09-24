import { tool, type Tool } from 'ai'
import { z } from 'zod'
import { createFs, PROJECT_ROOT, type Fs } from './fs.ts'
import { createShell, type Shell, type ShellRefusal } from './shell.ts'
import type { SandboxEscape } from './sandbox.ts'
import {
  DESCRIPTIONS,
  type DescriptionStyle,
  type ToolName,
} from './descriptions.ts'
import { ROSTERS, type Roster } from './roster.ts'
import { fetchPage, webSearch, type WebOptions } from './web.ts'

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
const queryInput = z.object({ query: z.string() })
const urlInput = z.object({ url: z.string() })
const commandInput = z.object({ command: z.string() })

export type BuildOptions = {
  root?: string
  roster?: Roster
  style?: DescriptionStyle
  /** Called whenever the guard refused a path, so a block is never silent. */
  onEscape?: (error: SandboxEscape) => void
  /**
   * v8. Called whenever the shell guard refused a command line.
   *
   * Separate from `onEscape` rather than folded into it, because the two
   * guards answer different questions and a tally with one column could not
   * tell them apart. `onEscape` counts paths a filesystem tool would have
   * opened outside the sandbox; this counts command lines the shell would not
   * run at all, most of which never got as far as having a path in them.
   */
  onRefusal?: (error: ShellRefusal) => void
  /**
   * How the two v7 tools treat the on-disk cache, and who is told about a
   * request that actually left the machine.
   *
   * Passed through rather than read from the environment here, because a
   * harness running fifty runs has to be able to say "cache only" once and be
   * sure none of the fifty went to the network — and because a tool that
   * decides its own network policy from an environment variable is a tool
   * whose policy is not in the trace.
   */
  web?: WebOptions
}

function define(
  name: ToolName,
  fs: Fs,
  style: DescriptionStyle,
  web: WebOptions,
  shell: Shell | undefined,
): Tool {
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
    case 'web_search':
      return tool({
        description,
        inputSchema: queryInput,
        execute: ({ query }) => webSearch(query, web),
      })
    case 'fetch_page':
      return tool({
        description,
        inputSchema: urlInput,
        execute: ({ url }) => fetchPage(url, web),
      })
    case 'run_command':
      return tool({
        description,
        inputSchema: commandInput,
        execute: ({ command }) => {
          if (shell === undefined) {
            // Unreachable through `buildTools`, which builds the shell before
            // it builds this tool. It is a throw rather than a refusal for the
            // same reason `requireWritable` is one in `fs.ts`: a roster that
            // hands the model a tool with nothing behind it is a programming
            // mistake, and a refusal the model can read would hide it inside
            // the experiment.
            throw new Error('buildTools: run_command was built without a shell')
          }
          return shell.runCommand(command)
        },
      })
  }
}

/** Whether a roster contains the shell. */
export function rosterShells(roster: Roster): boolean {
  return ROSTERS[roster].includes('run_command')
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

  // Built before any tool, so a roster with a shell in it refuses an unsafe
  // root at the same moment a roster with a write in it does. `createShell`
  // runs `assertWritableRoot` even though nothing it can run authors content:
  // the four filesystem tools skip dotfiles and `cat` does not, so a shell
  // rooted at this checkout is a tool that can read `agent/.env` — and `cp`,
  // `mv`, `touch` and `mkdir` would be rearranging it.
  const shell = rosterShells(roster) ? createShell(root, { onRefusal: options.onRefusal }) : undefined

  return Object.fromEntries(
    ROSTERS[roster].map((name) => [
      name,
      define(name, fs, style, options.web ?? {}, shell),
    ]),
  )
}
