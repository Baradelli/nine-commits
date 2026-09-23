/**
 * What the model is told each tool is for.
 *
 * Post 2's experiment lives here and is unchanged in shape: both sets are
 * data, selected at run time by `TOOL_DESCRIPTIONS`, so two runs come from one
 * checkout of one program rather than from two versions of the code.
 *
 * `thin` is not sabotage. It is what the descriptions look like on the day you
 * add a tool and mean to come back to it: true, short, and no help at all in
 * telling the tools apart.
 *
 * v6 adds four entries to each set. The precise ones are written to post 2's
 * standard — what the tool is for, and what it cannot do — and that standard
 * is applied to `append_file` exactly as it is to the other four. A comparison
 * whose extra tool is described worse than its neighbours is not measuring the
 * extra tool.
 */

export type DescriptionStyle = 'precise' | 'thin'

export type ToolName =
  | 'list_files'
  | 'search_files'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'append_file'

export type ToolDescriptions = Record<ToolName, string>

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
    read_file:
      'Read the whole text of one file, exactly as it is on disk. ' +
      'Returns the contents verbatim, with nothing trimmed or renumbered, so text taken from it ' +
      'can be handed back to edit_file unchanged. ' +
      'Use it when you need what a file says rather than what it is called. ' +
      'It reads one file at a time and cannot find a file for you.',
    write_file:
      'Create a file, or replace an existing one entirely. ' +
      'The content you supply becomes the whole file: anything that was in it before is gone. ' +
      'Use it for a file that does not exist yet, or one you mean to rewrite from nothing. ' +
      'It cannot change part of a file while keeping the rest.',
    edit_file:
      'Replace one exact span of text inside an existing file, leaving every other byte as it was. ' +
      'The old text must appear in the file exactly once, so read the file first and copy the span you mean. ' +
      'Use it to change part of a file you want to keep. ' +
      'It cannot create a file, and it refuses rather than guesses if the old text is missing or appears twice.',
    append_file:
      'Add text to the end of a file, keeping everything already in it. ' +
      'Creates the file if it does not exist, and starts a new line first if the file did not end with one. ' +
      'Use it when the change is purely an addition at the end. ' +
      'It cannot change anything already in the file, and it cannot insert anywhere but the end.',
  },
  thin: {
    list_files: 'Lists files.',
    search_files: 'Searches files.',
    read_file: 'Reads a file.',
    write_file: 'Writes a file.',
    edit_file: 'Edits a file.',
    append_file: 'Appends to a file.',
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
