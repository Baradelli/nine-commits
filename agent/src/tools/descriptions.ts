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
 *
 * v7 adds two more, and they are the first descriptions in this file for tools
 * that touch something outside the machine. Both say what the tool costs as
 * well as what it does: `fetch_page` returns a whole article, and a model that
 * cannot see the size of what it is about to pull into its own context will
 * pull three of them. Whether saying so changes anything is not measured here
 * — post 2's experiment is about that, and this commit does not re-run it.
 *
 * Both of those two v7 strings are also **wider than the tools underneath
 * them**, and they are left that way on purpose. `web_search` says "the public
 * web" and searches one encyclopaedia (`PROVIDER_HOST` in `web.ts`).
 * `fetch_page` says it "only accepts URLs that web_search returned" and in fact
 * accepts any `https://en.wikipedia.org/wiki/<article>` URL, whether a search
 * returned it or not. The post is accurate about both where it describes the
 * tools; these strings are not. They are frozen because the model read these
 * exact bytes in all one hundred runs, and they are part of the 708-token
 * baseline that post 7's "2.12% of the window" is measured against — so
 * correcting them would be tuning the instrument after seeing the result. They
 * get fixed in the commit that changes the roster anyway.
 */

export type DescriptionStyle = 'precise' | 'thin'

export type ToolName =
  | 'list_files'
  | 'search_files'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'append_file'
  | 'web_search'
  | 'fetch_page'

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
    web_search:
      'Search the public web for a query and get back a handful of matching pages. ' +
      'Returns a title, a URL and a one-line snippet for each result, and nothing else. ' +
      'Use it to find the page that answers a question you cannot answer from this project. ' +
      'It cannot tell you what a page says: the snippet is an extract chosen by the search engine, not the article.',
    fetch_page:
      'Read the full text of one page found by web_search, given the URL from its result. ' +
      'Returns the whole article as plain text, which is long — often several thousand words — and all of it stays in your context for the rest of the run. ' +
      'Use it when the snippet is not enough, and read one page at a time rather than everything that looked relevant. ' +
      'It only accepts URLs that web_search returned, and it cannot search.',
  },
  thin: {
    list_files: 'Lists files.',
    search_files: 'Searches files.',
    read_file: 'Reads a file.',
    write_file: 'Writes a file.',
    edit_file: 'Edits a file.',
    append_file: 'Appends to a file.',
    web_search: 'Searches the web.',
    fetch_page: 'Fetches a page.',
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
