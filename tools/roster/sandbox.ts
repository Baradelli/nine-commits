import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { WORKSPACE } from './workspace.ts'

/**
 * A fresh copy of the workspace, in scratch space, for one run.
 *
 * Under the system temporary directory and nowhere else, because that is the
 * only place `assertWritableRoot` will let the agent write. The two facts are
 * the same fact: the harness cannot hand the agent a directory the guard would
 * refuse, and the guard does not take the harness's word for it.
 */
export function materialise(): string {
  const root = mkdtempSync(join(tmpdir(), 'nine-workspace-'))
  for (const [path, content] of Object.entries(WORKSPACE)) {
    const target = join(root, ...path.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
  return root
}

/**
 * Every file under `root`, by path, with its contents.
 *
 * Nothing is skipped — not dotfiles, not `node_modules`, not anything the
 * agent's own tools refuse to walk. The tools' skip list decides what the model
 * can see; the grader has to see what the model did, and a run that wrote a
 * dotfile would otherwise be graded as a run that wrote nothing.
 */
export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {}

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        const key = relative(root, full).split(sep).join('/')
        try {
          out[key] = readFileSync(full, 'utf8')
        } catch {
          out[key] = '\u0000unreadable'
        }
      }
    }
  }

  walk(root)
  return out
}

export function dispose(root: string): void {
  rmSync(root, { recursive: true, force: true })
}
