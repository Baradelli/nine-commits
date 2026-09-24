import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertWritableRoot, resolveInside, SandboxEscape } from './sandbox.ts'

/**
 * The repository, and the default root for the read-only tools.
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
 *
 * At v6 it is doing a second job. `list_files` and `search_files` could only
 * put a file in front of the model; `read_file`, `write_file` and `edit_file`
 * can open one, and `.git` is a directory where writing a file rewrites
 * history rather than a document.
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

function walk(root: string, dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )

  for (const entry of entries) {
    if (skipped(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(root, full, out)
    else if (entry.isFile()) out.push(posix(relative(root, full)))
  }
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

export type ReadFileResult =
  | { ok: true; file: string; lines: number; truncated: boolean; content: string }
  | { ok: false; error: string }

/**
 * What a tool that changed the tree reports back.
 *
 * `bytes` is the size of the file afterwards and `created` says whether it
 * existed before. Neither is decoration: they are the only evidence in the
 * trace that the write happened, and post 4's eval reads tool results rather
 * than the model's account of them.
 */
export type WriteFileResult =
  | { ok: true; file: string; bytes: number; created: boolean }
  | { ok: false; error: string }

export const LIST_LIMIT = 300
export const SEARCH_LIMIT = 40
const LINE_LIMIT = 200

/** A read is capped so one enormous file cannot fill the context by itself. */
export const READ_LINE_LIMIT = 400

/**
 * And capped in characters too. Exported because `web.ts` holds a fetched page
 * to the same number deliberately, and a test has to be able to say so: a limit
 * only one of the two tools knows about is a limit that can drift.
 */
export const READ_CHAR_LIMIT = 24_000

/**
 * A write is capped too, for a different reason: a model that has started
 * repeating itself should cost a refusal rather than a full disk.
 */
export const WRITE_BYTE_LIMIT = 256 * 1024

export type Fs = ReturnType<typeof createFs>

/**
 * The filesystem tools, bound to one root.
 *
 * Every path the model supplies goes through `resolveInside`, which throws on
 * anything that would land outside `root`. That throw is converted here, once,
 * into a refusal the model can read and the trace can record — and `onEscape`
 * is called on the way past, so a blocked path is never something only the
 * guard knows about.
 *
 * `writable` is false unless the caller asks for write tools, and asking for
 * them runs `assertWritableRoot`. There is no argument to this function that
 * returns a `writeFile` bound to this repository.
 */
export function createFs(
  root: string,
  options: { writable?: boolean; onEscape?: (error: SandboxEscape) => void } = {},
) {
  const writable = options.writable === true
  if (writable) assertWritableRoot(root)

  const onEscape = options.onEscape ?? ((): void => {})

  /** Runs `body` with a resolved path, or turns a refused path into a result. */
  function guarded<T>(
    path: unknown,
    body: (absolute: string, relativePath: string) => T,
  ): T | { ok: false; error: string } {
    let absolute: string
    try {
      absolute = resolveInside(root, path)
    } catch (error: unknown) {
      if (error instanceof SandboxEscape) {
        onEscape(error)
        return { ok: false, error: error.message }
      }
      throw error
    }
    return body(absolute, posix(relative(root, absolute)) || '.')
  }

  function requireWritable(): void {
    if (!writable) {
      throw new Error(
        'createFs: this root is read-only — write tools were not built for it',
      )
    }
  }

  /** Every file path under `directory`, recursively. Paths only, never contents. */
  function listFiles(directory = '.', limit = LIST_LIMIT): ListFilesResult {
    return guarded(directory, (absolute, rel) => {
      const files: string[] = []
      try {
        walk(root, absolute, files)
      } catch {
        // Deliberately not the thrown error: a Node fs error carries the
        // absolute path it failed on, and that is exactly the string this
        // project spends a redaction pipeline keeping out of published traces.
        return { ok: false as const, error: `could not read "${directory}"` }
      }

      files.sort()
      return {
        ok: true as const,
        directory: rel,
        files: files.slice(0, limit),
        truncated: files.length > limit,
      }
    })
  }

  /** Every line in every text file that matches `pattern`, with its file and line number. */
  function searchFiles(pattern: string, limit = SEARCH_LIMIT): SearchFilesResult {
    let regex: RegExp
    try {
      regex = new RegExp(pattern)
    } catch {
      return { ok: false, error: `"${pattern}" is not a valid regular expression` }
    }

    const files: string[] = []
    try {
      walk(root, root, files)
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
        contents = readFileSync(join(root, file), 'utf8')
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

  /**
   * The whole text of one file.
   *
   * Contents come back verbatim — not trimmed, not line-numbered. Both would
   * be friendlier to read and both would break `edit_file`, which matches the
   * text it is given against the bytes on disk. A read whose output cannot be
   * pasted into an edit is a read that quietly makes the edit tool unusable.
   */
  function readFile(path: string): ReadFileResult {
    return guarded(path, (absolute, rel) => {
      let raw: string
      try {
        if (statSync(absolute).isDirectory()) {
          return { ok: false as const, error: `"${rel}" is a directory` }
        }
        raw = readFileSync(absolute, 'utf8')
      } catch {
        return { ok: false as const, error: `could not read "${rel}"` }
      }

      const lines = raw.split(/\r\n|\r|\n/)
      const cut = lines.length > READ_LINE_LIMIT || raw.length > READ_CHAR_LIMIT
      const content = lines
        .slice(0, READ_LINE_LIMIT)
        .join('\n')
        .slice(0, READ_CHAR_LIMIT)

      return { ok: true as const, file: rel, lines: lines.length, truncated: cut, content }
    })
  }

  /** Creates a file, or replaces one entirely. */
  function writeFile(path: string, content: string): WriteFileResult {
    requireWritable()
    return guarded(path, (absolute, rel) => {
      if (typeof content !== 'string') {
        return { ok: false as const, error: 'content must be a string' }
      }
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > WRITE_BYTE_LIMIT) {
        return {
          ok: false as const,
          error: `refusing to write ${bytes} bytes to "${rel}" — the limit is ${WRITE_BYTE_LIMIT}`,
        }
      }

      const existed = existsSync(absolute)
      try {
        if (existed && statSync(absolute).isDirectory()) {
          return { ok: false as const, error: `"${rel}" is a directory` }
        }
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, content, 'utf8')
      } catch {
        return { ok: false as const, error: `could not write "${rel}"` }
      }

      return { ok: true as const, file: rel, bytes, created: !existed }
    })
  }

  /**
   * Replaces one exact span of text in a file with another.
   *
   * It insists on exactly one occurrence. Zero means the model is editing a
   * file it has not read; more than one means it does not know which line it
   * is changing, and picking the first would be the tool deciding that for it.
   * Both are refusals rather than a best effort, because the failure mode of a
   * best effort is a file that changed in a way nobody asked for.
   */
  function editFile(path: string, oldText: string, newText: string): WriteFileResult {
    requireWritable()
    return guarded(path, (absolute, rel) => {
      if (typeof oldText !== 'string' || typeof newText !== 'string') {
        return { ok: false as const, error: 'old_text and new_text must be strings' }
      }
      if (oldText === '') {
        return {
          ok: false as const,
          error: 'old_text must not be empty — use write_file to create a file',
        }
      }

      let raw: string
      try {
        raw = readFileSync(absolute, 'utf8')
      } catch {
        return { ok: false as const, error: `could not read "${rel}"` }
      }

      const first = raw.indexOf(oldText)
      if (first === -1) {
        return {
          ok: false as const,
          error: `old_text does not appear in "${rel}" — read the file and copy the text exactly`,
        }
      }
      if (raw.indexOf(oldText, first + oldText.length) !== -1) {
        return {
          ok: false as const,
          error: `old_text appears more than once in "${rel}" — include enough surrounding text to make it unique`,
        }
      }

      const updated = raw.slice(0, first) + newText + raw.slice(first + oldText.length)
      const bytes = Buffer.byteLength(updated, 'utf8')
      if (bytes > WRITE_BYTE_LIMIT) {
        return {
          ok: false as const,
          error: `refusing to grow "${rel}" past ${WRITE_BYTE_LIMIT} bytes`,
        }
      }

      try {
        writeFileSync(absolute, updated, 'utf8')
      } catch {
        return { ok: false as const, error: `could not write "${rel}"` }
      }

      return { ok: true as const, file: rel, bytes, created: false }
    })
  }

  /**
   * Adds text to the end of a file, creating it if it is not there.
   *
   * This is the fifth tool, and it is built to win rather than to lose: it
   * inserts the newline the caller forgot, so appending a line to a file that
   * does not end in one produces a new last line instead of a corrupted one.
   * A fifth tool that fails at its own best task would prove nothing.
   */
  function appendFile(path: string, content: string): WriteFileResult {
    requireWritable()
    return guarded(path, (absolute, rel) => {
      if (typeof content !== 'string') {
        return { ok: false as const, error: 'content must be a string' }
      }

      const existed = existsSync(absolute)
      let existing = ''
      if (existed) {
        try {
          if (statSync(absolute).isDirectory()) {
            return { ok: false as const, error: `"${rel}" is a directory` }
          }
          existing = readFileSync(absolute, 'utf8')
        } catch {
          return { ok: false as const, error: `could not read "${rel}"` }
        }
      }

      const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
      const updated = existing + separator + content
      const bytes = Buffer.byteLength(updated, 'utf8')
      if (bytes > WRITE_BYTE_LIMIT) {
        return {
          ok: false as const,
          error: `refusing to grow "${rel}" past ${WRITE_BYTE_LIMIT} bytes`,
        }
      }

      try {
        mkdirSync(dirname(absolute), { recursive: true })
        writeFileSync(absolute, updated, 'utf8')
      } catch {
        return { ok: false as const, error: `could not write "${rel}"` }
      }

      return { ok: true as const, file: rel, bytes, created: !existed }
    })
  }

  return {
    root,
    writable,
    listFiles,
    searchFiles,
    readFile,
    writeFile,
    editFile,
    appendFile,
  }
}

/**
 * The read-only pair bound to this repository, which is what commits 2 to 5
 * shipped and what `fs.test.ts` and the eval corpus still exercise.
 */
const projectFs = createFs(PROJECT_ROOT)

export function listFiles(directory = '.', limit = LIST_LIMIT): ListFilesResult {
  return projectFs.listFiles(directory, limit)
}

export function searchFiles(
  pattern: string,
  limit = SEARCH_LIMIT,
): SearchFilesResult {
  return projectFs.searchFiles(pattern, limit)
}
