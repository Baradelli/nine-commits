import type { ToolName } from './descriptions.ts'

/**
 * Which tools the agent is holding.
 *
 * The thesis this commit has to earn names four primitives — list, read,
 * write, edit — and says a fifth makes the agent worse. So the roster is data,
 * exactly as the descriptions are, and a condition of the experiment is one
 * value of this type. Nothing else about the program changes between
 * conditions.
 *
 * Two fifths, because a single choice of fifth tool would make the result a
 * fact about that choice:
 *
 * - `five-append` adds `append_file`, which adds no capability at all.
 *   Everything it does, `write_file` and `edit_file` can already do. It is
 *   the redundant fifth the thesis is actually about, and it is a tool
 *   people ship: appending a line to a changelog through a read, a
 *   concatenation and a whole-file write is worse code than appending it.
 * - `five-search` adds `search_files`, which is the tool this agent carried
 *   from commit 2 to commit 5 and the one a competent engineer would reach
 *   for first. It does add a capability, so it tests a different question,
 *   and the post says so rather than folding the two together.
 *
 * The four come first and in the same order in every roster. A fifth tool is
 * appended, so the only difference a model can see between two conditions is
 * that there is one more definition after the ones it already had.
 */
export type Roster = 'four' | 'five-append' | 'five-search' | 'web'

const FOUR: readonly ToolName[] = [
  'list_files',
  'read_file',
  'write_file',
  'edit_file',
]

export const ROSTERS: Record<Roster, readonly ToolName[]> = {
  four: FOUR,
  'five-append': [...FOUR, 'append_file'],
  'five-search': [...FOUR, 'search_files'],
  /**
   * v7. The four, plus the two that reach outside the machine.
   *
   * It is a sixth and seventh tool rather than a replacement because post 7's
   * question is about the context and not about the roster: the agent still
   * has to write its answer to a file, so `write_file` and `edit_file` are
   * still the product, and what changes is that one tool result can now be
   * larger than everything else in the run put together.
   */
  web: [...FOUR, 'web_search', 'fetch_page'],
}

export const DEFAULT_ROSTER: Roster = 'four'

const NAMES = Object.keys(ROSTERS) as Roster[]

/**
 * Reads the roster out of the environment, and refuses one it does not know.
 *
 * Same rule as `resolveStyle`, for the same reason: a typo that quietly fell
 * back would run two conditions of the experiment with one tool set and
 * produce a table that looks like a result.
 */
export function resolveRoster(
  env: Record<string, string | undefined> = process.env,
): Roster {
  const raw = env.AGENT_TOOLS?.trim()
  if (raw === undefined || raw === '') return DEFAULT_ROSTER

  const roster = NAMES.find((candidate) => candidate === raw)
  if (roster === undefined) {
    throw new Error(`AGENT_TOOLS must be one of ${NAMES.join(', ')} — got "${raw}"`)
  }
  return roster
}
