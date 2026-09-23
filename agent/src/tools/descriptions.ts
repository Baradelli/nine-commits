/**
 * The only thing that differs between run A and run B.
 *
 * Both sets are data, selected at run time by `TOOL_DESCRIPTIONS`, so the two
 * recorded runs come from one checkout of one program rather than from two
 * versions of the code. Everything else — model, instructions, task, the tools
 * themselves, the input schemas — is held fixed.
 *
 * `thin` is not sabotage. It is what the descriptions look like on the day you
 * add a tool and mean to come back to it: true, short, and no help at all in
 * telling the two apart.
 */

export type DescriptionStyle = 'precise' | 'thin'

export type ToolDescriptions = {
  list_files: string
  search_files: string
}

export const DESCRIPTIONS: Record<DescriptionStyle, ToolDescriptions> = {
  precise: {
    list_files:
      'List the paths of the files in the project, optionally under one directory. ' +
      'Returns paths only, never the contents of a file. ' +
      'Use it to find out what files exist, or to locate something you can recognise from its name. ' +
      'It cannot tell you anything about what is written inside a file.',
    search_files:
      'Search the text inside the project files for a regular expression. ' +
      'Returns every matching line with its file path and line number. ' +
      'Use it when the answer depends on what a file contains rather than on what it is called — ' +
      'a value assigned in code, an import, a string.',
  },
  thin: {
    list_files: 'Lists files.',
    search_files: 'Searches files.',
  },
}

export const DEFAULT_STYLE: DescriptionStyle = 'precise'

const STYLES = Object.keys(DESCRIPTIONS) as DescriptionStyle[]

/**
 * Reads the style out of the environment, and refuses anything it does not
 * recognise. A typo here would silently run the experiment twice with the same
 * descriptions and produce two traces that look like a result.
 */
export function resolveStyle(
  env: Record<string, string | undefined> = process.env,
): DescriptionStyle {
  const raw = env.TOOL_DESCRIPTIONS?.trim()
  if (raw === undefined || raw === '') return DEFAULT_STYLE

  const style = STYLES.find((candidate) => candidate === raw)
  if (style === undefined) {
    throw new Error(
      `TOOL_DESCRIPTIONS must be one of ${STYLES.join(', ')} — got "${raw}"`,
    )
  }
  return style
}
