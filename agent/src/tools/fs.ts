import { readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Everything the two tools can see.
 *
 * Resolved from this module's own location rather than from `process.cwd()`,
 * so the tools reach the same files whether the agent is started from the
 * repository root, from `agent/`, or by a test runner.
 */
export const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

/**
 * What the tools refuse to look at: dependencies, build output, and anything
 * whose name starts with a dot.
 *
 * The dot rule is doing real work. `agent/.env` holds this project's one real
 * secret, and a tool that can read it is a tool that can put it in a trace.
 * The same rule keeps `.git`, `.astro` and the working notes in `.superpowers`
 * out, which is also why a recorded run never contains the brief describing
 * the run.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'test-results',
  'playwright-report',
  // The agent's own recordings. Without this, the first run of a comparison
  // writes a file that the second run then finds, and the two runs are no
  // longer looking at the same project. That happened; both traces were
  // thrown away and both runs redone.
  'traces',
])

/** Files whose bytes are not text, so searching them is noise. */
const BINARY = /\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|eot|pdf|zip)$/i

function skipped(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

/** POSIX separators, so a trace recorded on Windows reads the same as one recorded on Linux. */
function posix(path: string): string {
  return path.split(sep).join('/')
}

function walk(dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  for (const entry of entries) {
    if (skipped(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile()) out.push(posix(relative(PROJECT_ROOT, full)))
  }
}

/**
 * Resolves a caller-supplied directory inside the project, or explains why it
 * cannot. The model chooses this string, so it is untrusted input: `..` and
 * absolute paths have to be rejected rather than trusted to be harmless.
 */
function inProject(directory: string): { path: string } | { error: string } {
  const target = resolve(PROJECT_ROOT, directory)
  const rel = relative(PROJECT_ROOT, target)

  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { error: `"${directory}" is outside the project.` }
  }
  return { path: target }
}

export type ListFilesResult =
  | { ok: true; directory: string; files: string[]; truncated: boolean }
  | { ok: false; error: string }

export type SearchMatch = { file: string; line: number; text: string }

export type SearchFilesResult =
  | {
      ok: true
      pattern: string
      filesSearched: number
      matches: SearchMatch[]
      truncated: boolean
    }
  | { ok: false; error: string }

export const LIST_LIMIT = 300
export const SEARCH_LIMIT = 40
const LINE_LIMIT = 200

/** Every file path under `directory`, recursively. Paths only, never contents. */
export function listFiles(directory = '.', limit = LIST_LIMIT): ListFilesResult {
  const target = inProject(directory)
  if ('error' in target) return { ok: false, error: target.error }

  const files: string[] = []
  try {
    walk(target.path, files)
  } catch {
    // Deliberately not the thrown error: a Node fs error carries the absolute
    // path it failed on, and that is exactly the string this project spends a
    // redaction pipeline keeping out of published traces.
    return { ok: false, error: `could not read "${directory}"` }
  }

  files.sort()
  return {
    ok: true,
    directory: posix(relative(PROJECT_ROOT, target.path)) || '.',
    files: files.slice(0, limit),
    truncated: files.length > limit,
  }
}

/** Every line in every text file that matches `pattern`, with its file and line number. */
export function searchFiles(
  pattern: string,
  limit = SEARCH_LIMIT,
): SearchFilesResult {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch {
    return { ok: false, error: `"${pattern}" is not a valid regular expression` }
  }

  const files: string[] = []
  try {
    walk(PROJECT_ROOT, files)
  } catch {
    return { ok: false, error: 'could not read the project' }
  }

  const matches: SearchMatch[] = []
  let filesSearched = 0
  let truncated = false

  for (const file of files) {
    if (BINARY.test(file)) continue
    filesSearched += 1

    let contents: string
    try {
      contents = readFileSync(join(PROJECT_ROOT, file), 'utf8')
    } catch {
      continue
    }

    const lines = contents.split(/\r\n|\r|\n/)
    for (const [index, line] of lines.entries()) {
      if (!regex.test(line)) continue
      if (matches.length >= limit) {
        truncated = true
        break
      }
      matches.push({
        file,
        line: index + 1,
        text: line.trim().slice(0, LINE_LIMIT),
      })
    }
    if (truncated) break
  }

  return { ok: true, pattern, filesSearched, matches, truncated }
}
