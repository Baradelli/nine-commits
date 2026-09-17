# Nine Commits — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete Nine Commits system with one post live at `https://baradelli.github.io/nine-commits` — the agent, the trace recorder, the Astro site, the interactive trace player, the cover pipeline, and post 1 end to end.

**Architecture:** An npm-workspaces monorepo. `agent/` is a real TypeScript agent that writes raw execution traces to disk. `tools/` normalizes, redacts and validates those traces into the site's content directory. `site/` is Astro, shipping zero JavaScript except one Preact island that replays a trace frame by frame. Traces are validated at build time, so a malformed or unredacted trace fails the build rather than reaching production.

**Tech Stack:** Astro 7.3, `@astrojs/mdx` 8, `@astrojs/preact` 6, Preact 10, `astro/zod` (Zod 4, site side), `zod` 4.6 (agent side), `ai` 7 + `@ai-sdk/openai` 4, satori 0.33 + `@resvg/resvg-js` 2.6, vitest 5, Playwright 1.63, TypeScript 5.9, Node 20+.

**Spec:** `docs/superpowers/specs/2026-09-17-nine-commits-design.md`

## Global Constraints

- **Node >= 20.** Astro 7 and `@resvg/resvg-js` prebuilt binaries both assume it.
- **TypeScript pinned to `^5.9.3`** at the root, not TypeScript 7. TS 7 is published but untested against this toolchain; upgrading is a separate, deliberate task.
- **Published site language is English.** Every string that reaches a reader — post prose, UI labels, alt text, LinkedIn copy, README — is English. Code comments are English too.
- **Site URL is `https://baradelli.github.io/nine-commits`.** Astro config: `site: 'https://baradelli.github.io'`, `base: '/nine-commits'`. Every internal link and asset path must go through `import.meta.env.BASE_URL`; a hardcoded `/about` will 404 in production and work in dev.
- **Zod boundary.** Inside `site/`, import `z` from `astro/zod` only — never install `zod` into `site/`, to avoid two Zod instances. Inside `agent/` and `tools/`, use the separately installed `zod@^4.6.5` (required by the `ai` SDK peer range `^3.25.76 || ^4.1.8`).
- **Satori fonts must be TTF, OTF or WOFF. Never WOFF2** — satori cannot decode it, and it fails at render time, not install time.
- **Satori's default `display` is `flex`, not `block`.** Every element with more than one child must set `display: 'flex'` explicitly or its layout silently breaks.
- **No code from `Hendrixer/agents-v2` may be copied into this repository.** That repo carries no license. It may be read for reference; the implementation here is original. The README must credit Scott Moss and link the course.
- **No secret may reach `site/`.** A trace that still matches a secret pattern after redaction fails the build.
- **Commit after every task.** No task ends with uncommitted work.

## Phase 1 scoping note

The spec describes post 1's demo as "same task, chatbot vs agent, side by side." At commit `v1-not-an-agent` the agent *is* a single model call, so the agent half of that comparison does not exist yet. Phase 1 therefore ships the honest version: a single recorded run of the model being asked to do something it cannot do, failing in the specific way that motivates the whole series. The `TracePlayer` is built generic enough that the side-by-side comparison can be added at `v3-the-loop` without rework. This is a deliberate deviation, not an omission.

Two components from spec §4.3 are also deliberately out of Phase 1: `<TraceCompare>` (first needed by post 2) and `<ScrollScene>` (first needed by post 3). Building them now would mean designing an interface against a single hypothetical caller. They are Phase 2 work.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Workspace root; shared dev tooling and top-level scripts |
| `tsconfig.base.json` | Compiler options shared by `agent/` and `tools/` |
| `vitest.config.ts` | Unit test discovery for `tools/` and `agent/` |
| `README.md` | What the project is; attribution to the source course |
| `tools/trace/schema.ts` | The `Frame` and `Trace` types and their Zod schema. Single source of truth for the trace format |
| `tools/trace/redact.ts` | Pure redaction: given a string or object, remove secrets. Knows nothing about files |
| `tools/trace/redact.config.ts` | The author-maintained deny list of project-specific secrets |
| `tools/trace/normalize.ts` | Pure transform: raw recorder output → validated `Trace` |
| `tools/record-trace.ts` | CLI. The only file here that touches the filesystem |
| `tools/covers/layout.ts` | Pure: post metadata → satori element tree. No I/O |
| `tools/make-covers.ts` | CLI. Loads fonts, calls `layout`, rasterizes, writes PNGs |
| `agent/src/config.ts` | Model name and system instructions |
| `agent/src/run.ts` | The agent itself. At v1: one model call |
| `agent/src/recorder.ts` | Pure: agent result → raw trace object |
| `agent/src/cli.ts` | Entry point; wires run + recorder + disk |
| `site/astro.config.mjs` | Integrations, `site`, `base` |
| `site/src/content.config.ts` | The `posts` collection: loader, schema, slug derivation |
| `site/src/lib/player-state.ts` | Pure state machine for the trace player. Unit tested |
| `site/src/components/TracePlayer.tsx` | The Preact island. DOM only; logic lives in `player-state.ts` |
| `site/src/components/TraceTranscript.astro` | Static `<noscript>` fallback rendering of a trace |
| `site/src/layouts/PostLayout.astro` | Post chrome: title, cover, content slot, commit link |
| `site/src/pages/index.astro` | Series index |
| `site/src/content/posts/01-not-an-agent/` | Post 1: `index.mdx`, `linkedin.md`, `cover.png`, `cover-prompt.md`, `trace.json` |
| `e2e/post.spec.ts` | Playwright smoke test |
| `.github/workflows/deploy.yml` | Build `site/`, deploy to Pages |

The split that matters: **pure logic is separated from I/O everywhere** (`redact.ts` vs `record-trace.ts`, `layout.ts` vs `make-covers.ts`, `player-state.ts` vs `TracePlayer.tsx`). The pure halves are unit tested cheaply and exhaustively; the I/O halves are thin enough to verify by running them once.

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: npm workspaces `agent`, `site`, and root-level `tools/`; scripts `npm test`, `npm run typecheck`

- [ ] **Step 1: Verify Node version**

```bash
node --version
```
Expected: `v20.x` or higher. If lower, stop and upgrade before continuing.

- [ ] **Step 2: Write the root `package.json`**

```json
{
  "name": "nine-commits",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "workspaces": ["agent", "site"],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.base.json --noEmit",
    "validate": "tsx tools/validate-traces.ts",
    "record": "tsx tools/record-trace.ts",
    "covers": "tsx tools/make-covers.ts",
    "e2e": "playwright test"
  },
  "devDependencies": {
    "tsx": "^4.23.13",
    "typescript": "^5.9.3",
    "vitest": "^5.0.1",
    "zod": "^4.6.5"
  }
}
```

- [ ] **Step 3: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true
  },
  "include": ["tools/**/*.ts", "agent/src/**/*.ts"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tools/**/*.test.ts', 'agent/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5: Append build artifacts to `.gitignore`**

The file already ignores `node_modules/`, `dist/`, `.astro/`, `.env`, `agent/traces/`. Append:

```
test-results/
playwright-report/
```

- [ ] **Step 6: Write `README.md`**

```markdown
# Nine Commits

One AI agent, built in nine commits — with the real execution traces that
produced each post.

Every interactive demo on [the site](https://baradelli.github.io/nine-commits)
replays a run that actually happened on my machine, recorded from the agent in
`agent/` at the commit the post is tagged with.

## Layout

- `agent/` — the agent. Plain TypeScript, no agent framework.
- `site/` — the blog (Astro).
- `tools/` — trace normalization and cover generation.

## Attribution

Built while following **"Build an AI Agent from Scratch"** by
[Scott Moss](https://github.com/Hendrixer) — [course notes](https://publish.obsidian.md/agents-v2/course),
[reference repository](https://github.com/Hendrixer/agents-v2).

The agent implementation here is my own. The curriculum, the lesson structure
and the concepts are the instructor's.
```

- [ ] **Step 7: Install and verify the workspace resolves**

```bash
npm install
npm run typecheck
```
Expected: install succeeds; `typecheck` succeeds with no files matched yet (or reports no errors).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts README.md .gitignore
git commit -m "chore: monorepo scaffold with npm workspaces"
```

---

## Task 2: Trace schema

**Files:**
- Create: `tools/trace/schema.ts`
- Test: `tools/trace/schema.test.ts`

**Interfaces:**
- Consumes: `zod@^4.6.5` from the root workspace
- Produces:
  - `frameSchema`, `traceSchema` (Zod schemas)
  - `type Frame`, `type Trace` (inferred)
  - `parseTrace(value: unknown): Trace` — throws `ZodError` on invalid input

- [ ] **Step 1: Write the failing test**

Create `tools/trace/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseTrace } from './schema.ts'

const valid = {
  id: 'post-01-explains-instead-of-doing',
  commit: 'v1-not-an-agent',
  model: 'gpt-5-mini',
  task: 'Count the TypeScript files in this project.',
  outcome: 'failure',
  tokens: [0, 412],
  frames: [
    { type: 'user', content: 'Count the TypeScript files in this project.' },
    { type: 'assistant', content: 'You can run `find . -name "*.ts" | wc -l`.' },
  ],
}

describe('parseTrace', () => {
  it('accepts a well-formed trace', () => {
    expect(parseTrace(valid).frames).toHaveLength(2)
  })

  it('rejects an unknown frame type', () => {
    const bad = { ...valid, frames: [{ type: 'telepathy', content: 'x' }] }
    expect(() => parseTrace(bad)).toThrow()
  })

  it('rejects an unknown outcome', () => {
    expect(() => parseTrace({ ...valid, outcome: 'maybe' })).toThrow()
  })

  it('rejects a trace whose tokens array is shorter than its frames', () => {
    const bad = { ...valid, tokens: [0] }
    expect(() => parseTrace(bad)).toThrow(/tokens/)
  })

  it('accepts every documented frame variant', () => {
    const frames = [
      { type: 'user', content: 'go' },
      { type: 'tool_call', id: 'c1', name: 'read_file', args: { path: 'a.ts' } },
      { type: 'tool_result', id: 'c1', ok: true, result: 'export const a = 1' },
      { type: 'assistant', content: 'done' },
      { type: 'compaction', before: 9000, after: 1200, summary: 'read one file' },
      { type: 'approval', tool: 'shell', decision: 'deny' },
    ]
    const t = parseTrace({ ...valid, frames, tokens: frames.map(() => 0) })
    expect(t.frames).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tools/trace/schema.test.ts
```
Expected: FAIL — cannot resolve `./schema.ts`.

- [ ] **Step 3: Write `tools/trace/schema.ts`**

```ts
import { z } from 'zod'

export const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), content: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    id: z.string(),
    name: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal('tool_result'),
    id: z.string(),
    ok: z.boolean(),
    result: z.unknown(),
  }),
  z.object({ type: z.literal('assistant'), content: z.string() }),
  z.object({
    type: z.literal('compaction'),
    before: z.number().int().nonnegative(),
    after: z.number().int().nonnegative(),
    summary: z.string(),
  }),
  z.object({
    type: z.literal('approval'),
    tool: z.string(),
    decision: z.enum(['allow', 'deny']),
  }),
])

export const traceSchema = z
  .object({
    id: z.string().min(1),
    commit: z.string().min(1),
    model: z.string().min(1),
    task: z.string().min(1),
    outcome: z.enum(['success', 'failure', 'partial']),
    tokens: z.array(z.number().int().nonnegative()),
    frames: z.array(frameSchema).min(1),
  })
  .refine((t) => t.tokens.length === t.frames.length, {
    message: 'tokens must have one entry per frame',
    path: ['tokens'],
  })

export type Frame = z.infer<typeof frameSchema>
export type Trace = z.infer<typeof traceSchema>

export function parseTrace(value: unknown): Trace {
  return traceSchema.parse(value)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- tools/trace/schema.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/trace/schema.ts tools/trace/schema.test.ts
git commit -m "feat(trace): add Frame and Trace schema with validation"
```

---

## Task 3: Redaction

This is the security-critical unit. It runs before any trace reaches `site/`.

**Files:**
- Create: `tools/trace/redact.ts`, `tools/trace/redact.config.ts`
- Test: `tools/trace/redact.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `redactString(input: string, opts: RedactOptions): string`
  - `redactDeep<T>(value: T, opts: RedactOptions): T`
  - `findSecrets(input: string, opts: RedactOptions): string[]` — returns remaining matches; `[]` means clean
  - `type RedactOptions = { homeDir: string; denyList: string[] }`
  - `defaultDenyList: string[]` (from `redact.config.ts`)

- [ ] **Step 1: Write the failing test**

Create `tools/trace/redact.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { redactString, redactDeep, findSecrets } from './redact.ts'

const opts = {
  homeDir: 'C:\\Users\\User',
  denyList: ['my-private-project'],
}

describe('redactString', () => {
  it('replaces a Windows home directory prefix', () => {
    const out = redactString('C:\\Users\\User\\Documents\\a.ts', opts)
    expect(out).toBe('~\\Documents\\a.ts')
  })

  it('replaces a POSIX home directory prefix', () => {
    const out = redactString('/home/user/projects/a.ts', {
      ...opts,
      homeDir: '/home/user',
    })
    expect(out).toBe('~/projects/a.ts')
  })

  it('redacts an OpenAI-style key', () => {
    expect(redactString('key is sk-abc123DEF456ghi789jkl', opts)).toBe(
      'key is [REDACTED:api-key]',
    )
  })

  it('redacts a bearer token', () => {
    expect(redactString('Authorization: Bearer abc.def.ghi', opts)).toBe(
      'Authorization: [REDACTED:bearer]',
    )
  })

  it('redacts a deny-list entry', () => {
    expect(redactString('see my-private-project/x', opts)).toBe(
      'see [REDACTED:denied]/x',
    )
  })

  it('leaves innocent text untouched', () => {
    expect(redactString('read src/run.ts', opts)).toBe('read src/run.ts')
  })
})

describe('redactDeep', () => {
  it('walks nested objects and arrays', () => {
    const input = {
      a: 'sk-abc123DEF456ghi789jkl',
      b: [{ c: 'C:\\Users\\User\\x.ts' }],
      n: 42,
    }
    expect(redactDeep(input, opts)).toEqual({
      a: '[REDACTED:api-key]',
      b: [{ c: '~\\x.ts' }],
      n: 42,
    })
  })

  it('redacts object keys as well as values', () => {
    const input = { 'C:\\Users\\User\\x.ts': 'ok' }
    expect(redactDeep(input, opts)).toEqual({ '~\\x.ts': 'ok' })
  })
})

describe('findSecrets', () => {
  it('returns nothing for clean text', () => {
    expect(findSecrets('read src/run.ts', opts)).toEqual([])
  })

  it('reports what is still leaking', () => {
    expect(findSecrets('sk-abc123DEF456ghi789jkl', opts)).toHaveLength(1)
  })

  it('reports nothing after redaction', () => {
    const dirty = 'C:\\Users\\User\\x sk-abc123DEF456ghi789jkl'
    expect(findSecrets(redactString(dirty, opts), opts)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tools/trace/redact.test.ts
```
Expected: FAIL — cannot resolve `./redact.ts`.

- [ ] **Step 3: Write `tools/trace/redact.config.ts`**

```ts
/**
 * Project-specific strings that must never appear in a published trace.
 * Add to this list whenever a run touches something private.
 */
export const defaultDenyList: string[] = []
```

- [ ] **Step 4: Write `tools/trace/redact.ts`**

```ts
export type RedactOptions = {
  /** Absolute path to the machine's home directory, e.g. "C:\\Users\\User". */
  homeDir: string
  /** Literal strings that must never be published. */
  denyList: string[]
}

const API_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function patterns(opts: RedactOptions): Array<[RegExp, string]> {
  const rules: Array<[RegExp, string]> = [
    [API_KEY, '[REDACTED:api-key]'],
    [BEARER, '[REDACTED:bearer]'],
    [new RegExp(escapeRegExp(opts.homeDir), 'gi'), '~'],
  ]
  for (const denied of opts.denyList) {
    if (denied.length > 0) {
      rules.push([new RegExp(escapeRegExp(denied), 'gi'), '[REDACTED:denied]'])
    }
  }
  return rules
}

export function redactString(input: string, opts: RedactOptions): string {
  let out = input
  for (const [pattern, replacement] of patterns(opts)) {
    out = out.replace(pattern, replacement)
  }
  return out
}

export function redactDeep<T>(value: T, opts: RedactOptions): T {
  if (typeof value === 'string') {
    return redactString(value, opts) as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, opts)) as T
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      out[redactString(key, opts)] = redactDeep(val, opts)
    }
    return out as T
  }
  return value
}

/** Returns every remaining secret-shaped substring. An empty array means clean. */
export function findSecrets(input: string, opts: RedactOptions): string[] {
  const found: string[] = []
  for (const [pattern] of patterns(opts)) {
    const matches = input.match(pattern)
    if (matches) found.push(...matches)
  }
  return found
}
```

Note on the `homeDir` rule: it is listed in `patterns()` so `findSecrets` treats a
leftover home path as a leak too, not only as something to rewrite.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- tools/trace/redact.test.ts
```
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/trace/redact.ts tools/trace/redact.config.ts tools/trace/redact.test.ts
git commit -m "feat(trace): add redaction with secret detection"
```

---

## Task 4: Normalizer

**Files:**
- Create: `tools/trace/normalize.ts`
- Test: `tools/trace/normalize.test.ts`

**Interfaces:**
- Consumes: `parseTrace`, `type Trace` from `tools/trace/schema.ts`; `redactDeep`, `findSecrets`, `type RedactOptions` from `tools/trace/redact.ts`
- Produces: `normalize(raw: unknown, opts: RedactOptions): Trace` — redacts, then validates, then re-scans; throws if anything still leaks

- [ ] **Step 1: Write the failing test**

Create `tools/trace/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalize } from './normalize.ts'

const opts = { homeDir: 'C:\\Users\\User', denyList: [] }

const raw = {
  id: 'r1',
  commit: 'v1-not-an-agent',
  model: 'gpt-5-mini',
  task: 'List files in C:\\Users\\User\\Documents',
  outcome: 'failure',
  tokens: [0, 120],
  frames: [
    { type: 'user', content: 'List files in C:\\Users\\User\\Documents' },
    { type: 'assistant', content: 'I cannot access C:\\Users\\User.' },
  ],
}

describe('normalize', () => {
  it('redacts before validating', () => {
    const trace = normalize(raw, opts)
    expect(trace.task).toBe('List files in ~\\Documents')
    expect(JSON.stringify(trace)).not.toContain('C:\\Users\\User')
  })

  it('throws on a structurally invalid trace', () => {
    expect(() => normalize({ ...raw, outcome: 'maybe' }, opts)).toThrow()
  })

  it('throws when a secret survives redaction', () => {
    // An empty homeDir would otherwise produce a catch-all pattern; guard it.
    expect(() => normalize(raw, { homeDir: '', denyList: [] })).toThrow(
      /homeDir/,
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- tools/trace/normalize.test.ts
```
Expected: FAIL — cannot resolve `./normalize.ts`.

- [ ] **Step 3: Write `tools/trace/normalize.ts`**

```ts
import { parseTrace, type Trace } from './schema.ts'
import { redactDeep, findSecrets, type RedactOptions } from './redact.ts'

export function normalize(raw: unknown, opts: RedactOptions): Trace {
  if (opts.homeDir.trim() === '') {
    throw new Error('normalize: homeDir must not be empty')
  }

  const redacted = redactDeep(raw, opts)
  const trace = parseTrace(redacted)

  const leaks = findSecrets(JSON.stringify(trace), opts)
  if (leaks.length > 0) {
    throw new Error(
      `normalize: ${leaks.length} secret(s) survived redaction: ${leaks.join(', ')}`,
    )
  }

  return trace
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- tools/trace/normalize.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add tools/trace/normalize.ts tools/trace/normalize.test.ts
git commit -m "feat(trace): add normalize pipeline (redact, validate, re-scan)"
```

---

## Task 5: `record-trace` CLI

**Files:**
- Create: `tools/record-trace.ts`

**Interfaces:**
- Consumes: `normalize` from `tools/trace/normalize.ts`; `defaultDenyList` from `tools/trace/redact.config.ts`
- Produces: the command `npm run record -- <raw.json> <post-slug>`, writing `site/src/content/posts/<post-slug>/trace.json`

- [ ] **Step 1: Write `tools/record-trace.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { normalize } from './trace/normalize.ts'
import { defaultDenyList } from './trace/redact.config.ts'

function main(): void {
  const [rawPath, slug] = process.argv.slice(2)

  if (!rawPath || !slug) {
    console.error('usage: npm run record -- <raw-trace.json> <post-slug>')
    process.exit(1)
  }

  const raw: unknown = JSON.parse(readFileSync(resolve(rawPath), 'utf8'))

  const trace = normalize(raw, {
    homeDir: homedir(),
    denyList: defaultDenyList,
  })

  const out = join('site', 'src', 'content', 'posts', slug, 'trace.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(trace, null, 2)}\n`, 'utf8')

  console.log(`wrote ${out} (${trace.frames.length} frames, ${trace.outcome})`)
}

main()
```

- [ ] **Step 2: Verify it rejects a bad trace**

```bash
mkdir -p /tmp/nc && echo '{"id":"x"}' > /tmp/nc/bad.json
npm run record -- /tmp/nc/bad.json 01-not-an-agent
```
Expected: non-zero exit with a Zod validation error. No file is written.

- [ ] **Step 3: Verify it accepts a good trace**

```bash
cat > /tmp/nc/good.json <<'JSON'
{
  "id": "smoke",
  "commit": "v1-not-an-agent",
  "model": "gpt-5-mini",
  "task": "smoke test",
  "outcome": "partial",
  "tokens": [0, 1],
  "frames": [
    { "type": "user", "content": "hi" },
    { "type": "assistant", "content": "hello" }
  ]
}
JSON
npm run record -- /tmp/nc/good.json 01-not-an-agent
```
Expected: `wrote site/src/content/posts/01-not-an-agent/trace.json (2 frames, partial)`

- [ ] **Step 4: Remove the smoke output**

```bash
rm -rf site/src/content/posts/01-not-an-agent
```
The real trace is recorded in Task 12.

- [ ] **Step 5: Write `tools/validate-traces.ts`**

Spec §5 requires that a malformed trace fails the build rather than reaching
production. `record-trace` validates on the way in, but a hand-edited
`trace.json` would bypass it. This script re-validates every committed trace and
is wired into CI in Task 14.

```ts
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseTrace } from './trace/schema.ts'
import { findSecrets } from './trace/redact.ts'
import { defaultDenyList } from './trace/redact.config.ts'

const POSTS_DIR = join('site', 'src', 'content', 'posts')

function main(): void {
  if (!existsSync(POSTS_DIR)) {
    console.log('no posts directory yet — nothing to validate')
    return
  }

  const opts = { homeDir: homedir(), denyList: defaultDenyList }
  const failures: string[] = []
  let checked = 0

  for (const entry of readdirSync(POSTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(POSTS_DIR, entry.name, 'trace.json')
    if (!existsSync(path)) continue

    checked += 1
    try {
      const trace = parseTrace(JSON.parse(readFileSync(path, 'utf8')))
      const leaks = findSecrets(JSON.stringify(trace), opts)
      if (leaks.length > 0) {
        failures.push(`${path}: leaks ${leaks.join(', ')}`)
      }
    } catch (error: unknown) {
      failures.push(`${path}: ${String(error)}`)
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure)
    process.exit(1)
  }

  console.log(`validated ${checked} trace(s)`)
}

main()
```

- [ ] **Step 6: Verify validation passes on a clean tree**

```bash
npm run validate
```
Expected: `no posts directory yet — nothing to validate` (the smoke output was
removed in Step 4).

- [ ] **Step 7: Commit**

```bash
git add tools/record-trace.ts tools/validate-traces.ts package.json
git commit -m "feat(tools): add record-trace CLI and trace validation"
```

---

## Task 6: The agent at `v1-not-an-agent`

**Files:**
- Create: `agent/package.json`, `agent/tsconfig.json`, `agent/src/config.ts`, `agent/src/run.ts`, `agent/src/recorder.ts`, `agent/src/cli.ts`, `agent/.env.example`
- Test: `agent/src/recorder.test.ts`

**Interfaces:**
- Consumes: `type Trace`, `type Frame` from `tools/trace/schema.ts`
- Produces:
  - `runOnce(task: string): Promise<RunResult>` from `run.ts`, where
    `RunResult = { text: string; model: string; totalTokens: number }`
  - `toRawTrace(input: { id, commit, model, task, userMessage, assistantText, totalTokens }): unknown` from `recorder.ts`

- [ ] **Step 1: Write `agent/package.json`**

```json
{
  "name": "@nine-commits/agent",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx --env-file=.env src/cli.ts"
  },
  "dependencies": {
    "@ai-sdk/openai": "^4.0.69",
    "ai": "^7.0.105",
    "zod": "^4.6.5"
  }
}
```

- [ ] **Step 2: Write `agent/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `agent/.env.example`**

```
OPENAI_API_KEY=sk-replace-me
```

- [ ] **Step 4: Write the failing test for the recorder**

Create `agent/src/recorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toRawTrace } from './recorder.ts'
import { parseTrace } from '../../tools/trace/schema.ts'

describe('toRawTrace', () => {
  const input = {
    id: 'explains-instead-of-doing',
    commit: 'v1-not-an-agent',
    model: 'gpt-5-mini',
    task: 'Count the TypeScript files in this project.',
    userMessage: 'Count the TypeScript files in this project.',
    assistantText: 'You can run `find . -name "*.ts" | wc -l`.',
    totalTokens: 412,
  }

  it('produces a trace that passes the shared schema', () => {
    expect(() => parseTrace(toRawTrace(input))).not.toThrow()
  })

  it('emits exactly one user frame and one assistant frame', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.frames.map((f) => f.type)).toEqual(['user', 'assistant'])
  })

  it('records the run as a failure, because a single call cannot act', () => {
    expect(parseTrace(toRawTrace(input)).outcome).toBe('failure')
  })

  it('reports a token budget entry per frame', () => {
    const trace = parseTrace(toRawTrace(input))
    expect(trace.tokens).toEqual([0, 412])
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npm test -- agent/src/recorder.test.ts
```
Expected: FAIL — cannot resolve `./recorder.ts`.

- [ ] **Step 6: Write `agent/src/recorder.ts`**

```ts
export type RecorderInput = {
  id: string
  commit: string
  model: string
  task: string
  userMessage: string
  assistantText: string
  totalTokens: number
}

/**
 * At v1 the agent is a single model call: it can describe an action but never
 * take one, so every run is recorded as a failure. Later commits replace this
 * with a frame-per-step recorder driven by the loop.
 */
export function toRawTrace(input: RecorderInput): unknown {
  return {
    id: input.id,
    commit: input.commit,
    model: input.model,
    task: input.task,
    outcome: 'failure',
    tokens: [0, input.totalTokens],
    frames: [
      { type: 'user', content: input.userMessage },
      { type: 'assistant', content: input.assistantText },
    ],
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm test -- agent/src/recorder.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 8: Write `agent/src/config.ts`**

```ts
export const MODEL_NAME = 'gpt-5-mini'

export const INSTRUCTIONS = [
  'You are a helpful assistant running inside a developer terminal.',
  'Answer concisely.',
].join(' ')
```

- [ ] **Step 9: Write `agent/src/run.ts`**

```ts
import { generateText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { INSTRUCTIONS, MODEL_NAME } from './config.ts'

export type RunResult = {
  text: string
  model: string
  totalTokens: number
}

/**
 * v1: one model call. No tools, no loop, no history.
 * This is the thing the series argues is not an agent.
 */
export async function runOnce(task: string): Promise<RunResult> {
  const result = await generateText({
    model: openai(MODEL_NAME),
    instructions: INSTRUCTIONS,
    prompt: task,
  })

  return {
    text: result.text,
    model: MODEL_NAME,
    totalTokens: result.usage?.totalTokens ?? 0,
  }
}
```

- [ ] **Step 10: Write `agent/src/cli.ts`**

```ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runOnce } from './run.ts'
import { toRawTrace } from './recorder.ts'

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(' ').trim()
  const traceId = process.env.TRACE_ID ?? 'run'
  const commit = process.env.TRACE_COMMIT ?? 'v1-not-an-agent'

  if (task === '') {
    console.error('usage: npm start --workspace @nine-commits/agent -- "<task>"')
    process.exit(1)
  }

  const result = await runOnce(task)
  console.log(result.text)

  const raw = toRawTrace({
    id: traceId,
    commit,
    model: result.model,
    task,
    userMessage: task,
    assistantText: result.text,
    totalTokens: result.totalTokens,
  })

  mkdirSync('traces', { recursive: true })
  const out = join('traces', `${traceId}.json`)
  writeFileSync(out, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  console.error(`\n[recorded ${out}]`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 11: Install workspace dependencies and typecheck**

```bash
npm install
npm run typecheck
```
Expected: both succeed.

- [ ] **Step 12: Commit**

```bash
git add agent tsconfig.base.json package-lock.json
git commit -m "feat(agent): single-call agent at v1 with trace recorder"
```

---

## Task 7: Astro site scaffold

**Files:**
- Create: `site/` (scaffolded), `site/astro.config.mjs`
- Modify: `site/package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: a buildable Astro site with MDX and Preact, served under `base: '/nine-commits'`

- [ ] **Step 1: Scaffold Astro into `site/`**

```bash
npm create astro@latest site -- --template minimal --no-install --no-git --skip-houston
```
If the CLI prompts despite the flags, accept the minimal template and decline
sample content, git init, and dependency install.

- [ ] **Step 2: Add the integrations**

```bash
npm install --workspace site @astrojs/mdx@^8.0.1 @astrojs/preact@^6.0.5 preact@^10.29.8
```

- [ ] **Step 3: Write `site/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import preact from '@astrojs/preact'

export default defineConfig({
  site: 'https://baradelli.github.io',
  base: '/nine-commits',
  integrations: [mdx(), preact()],
})
```

- [ ] **Step 4: Confirm `site/package.json` has the standard scripts**

It must contain at least:

```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
}
```

- [ ] **Step 5: Verify the site builds**

```bash
npm install
npm run build --workspace site
```
Expected: build succeeds and writes `site/dist/`.

- [ ] **Step 6: Commit**

```bash
git add site package-lock.json
git commit -m "feat(site): scaffold Astro with MDX and Preact integrations"
```

---

## Task 8: Content collection and post layout

**Files:**
- Create: `site/src/content.config.ts`, `site/src/layouts/PostLayout.astro`, `site/src/pages/posts/[...slug].astro`, `site/src/pages/index.astro`
- Test: verified by `npm run build --workspace site`

**Interfaces:**
- Consumes: post folders at `site/src/content/posts/<slug>/index.mdx`
- Produces: a `posts` collection whose entry `id` is the folder name; routes at `/nine-commits/posts/<slug>/`

- [ ] **Step 1: Write `site/src/content.config.ts`**

```ts
import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const posts = defineCollection({
  loader: glob({
    pattern: '**/index.mdx',
    base: './src/content/posts',
    // "01-not-an-agent/index.mdx" -> "01-not-an-agent"
    generateId: ({ entry }) => entry.split('/')[0] ?? entry,
  }),
  schema: ({ image }) =>
    z.object({
      order: z.number().int().positive(),
      title: z.string(),
      thesis: z.string(),
      pubDate: z.coerce.date(),
      commit: z.string(),
      cover: image(),
      coverAlt: z.string(),
      draft: z.boolean().default(false),
    }),
})

export const collections = { posts }
```

- [ ] **Step 2: Write `site/src/layouts/PostLayout.astro`**

```astro
---
import type { CollectionEntry } from 'astro:content'
import { Image } from 'astro:assets'

interface Props {
  post: CollectionEntry<'posts'>
}

const { post } = Astro.props
const { title, thesis, commit, cover, coverAlt, order } = post.data
const repo = 'https://github.com/Baradelli/nine-commits'
const base = import.meta.env.BASE_URL
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} — Nine Commits</title>
    <meta name="description" content={thesis} />
  </head>
  <body>
    <a href={base}>Nine Commits</a>

    <article>
      <p>Commit {order} of 9</p>
      <h1>{title}</h1>
      <p>{thesis}</p>
      <Image src={cover} alt={coverAlt} />

      <slot />

      <footer>
        <a href={`${repo}/releases/tag/${commit}`}>
          Read the code at <code>{commit}</code>
        </a>
      </footer>
    </article>
  </body>
</html>
```

- [ ] **Step 3: Write `site/src/pages/posts/[...slug].astro`**

```astro
---
import { getCollection, render } from 'astro:content'
import PostLayout from '../../layouts/PostLayout.astro'

export async function getStaticPaths() {
  const posts = await getCollection('posts', ({ data }) => !data.draft)
  return posts.map((post) => ({ params: { slug: post.id }, props: { post } }))
}

const { post } = Astro.props
const { Content } = await render(post)
---

<PostLayout post={post}>
  <Content />
</PostLayout>
```

- [ ] **Step 4: Write `site/src/pages/index.astro`**

```astro
---
import { getCollection } from 'astro:content'

const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
  (a, b) => a.data.order - b.data.order,
)
const base = import.meta.env.BASE_URL
---

<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nine Commits</title>
    <meta
      name="description"
      content="One AI agent, built in nine commits, with the real traces that produced each post."
    />
  </head>
  <body>
    <h1>Nine Commits</h1>
    <p>
      One AI agent, built in nine commits. Every demo on this site replays a run
      that actually happened.
    </p>

    <ol>
      {
        posts.map((post) => (
          <li>
            <a href={`${base}/posts/${post.id}/`.replace(/\/+/g, '/')}>
              {post.data.title}
            </a>
            <p>{post.data.thesis}</p>
          </li>
        ))
      }
    </ol>
  </body>
</html>
```

- [ ] **Step 5: Verify the build succeeds with an empty collection**

```bash
npm run build --workspace site
```
Expected: build succeeds. The index renders with an empty list; no post routes exist yet.

- [ ] **Step 6: Commit**

```bash
git add site/src
git commit -m "feat(site): add posts collection, post layout and index"
```

---

## Task 9: Player state machine

Pure logic, separated from the DOM so it can be tested exhaustively without a browser.

**Files:**
- Create: `site/src/lib/player-state.ts`
- Test: `site/src/lib/player-state.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type PlayerState = { index: number; playing: boolean; total: number }`
  - `type PlayerAction = { type: 'next' | 'prev' | 'play' | 'pause' | 'reset' } | { type: 'seek'; index: number }`
  - `initialState(total: number): PlayerState`
  - `reduce(state: PlayerState, action: PlayerAction): PlayerState`
  - `visibleFrames<T>(frames: T[], state: PlayerState): T[]`

- [ ] **Step 1: Add the site lib to vitest discovery**

Modify `vitest.config.ts`, replacing the `include` line:

```ts
    include: [
      'tools/**/*.test.ts',
      'agent/**/*.test.ts',
      'site/src/lib/**/*.test.ts',
    ],
```

- [ ] **Step 2: Write the failing test**

Create `site/src/lib/player-state.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { initialState, reduce, visibleFrames } from './player-state.ts'

describe('player-state', () => {
  it('starts at the first frame, paused', () => {
    expect(initialState(5)).toEqual({ index: 0, playing: false, total: 5 })
  })

  it('advances with next', () => {
    expect(reduce(initialState(3), { type: 'next' }).index).toBe(1)
  })

  it('stops at the last frame and pauses there', () => {
    let s = initialState(2)
    s = reduce(s, { type: 'play' })
    s = reduce(s, { type: 'next' })
    s = reduce(s, { type: 'next' })
    expect(s).toEqual({ index: 1, playing: false, total: 2 })
  })

  it('does not go below the first frame', () => {
    expect(reduce(initialState(3), { type: 'prev' }).index).toBe(0)
  })

  it('clamps a seek beyond the end', () => {
    expect(reduce(initialState(3), { type: 'seek', index: 99 }).index).toBe(2)
  })

  it('clamps a negative seek', () => {
    expect(reduce(initialState(3), { type: 'seek', index: -4 }).index).toBe(0)
  })

  it('reset returns to the start and pauses', () => {
    const played = reduce(reduce(initialState(4), { type: 'play' }), {
      type: 'next',
    })
    expect(reduce(played, { type: 'reset' })).toEqual({
      index: 0,
      playing: false,
      total: 4,
    })
  })

  it('exposes frames up to and including the current index', () => {
    const frames = ['a', 'b', 'c']
    const at1 = reduce(initialState(3), { type: 'next' })
    expect(visibleFrames(frames, at1)).toEqual(['a', 'b'])
  })

  it('handles an empty trace without crashing', () => {
    const s = initialState(0)
    expect(visibleFrames([], s)).toEqual([])
    expect(reduce(s, { type: 'next' }).index).toBe(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test -- site/src/lib/player-state.test.ts
```
Expected: FAIL — cannot resolve `./player-state.ts`.

- [ ] **Step 4: Write `site/src/lib/player-state.ts`**

```ts
export type PlayerState = {
  index: number
  playing: boolean
  total: number
}

export type PlayerAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'seek'; index: number }

export function initialState(total: number): PlayerState {
  return { index: 0, playing: false, total }
}

function clamp(index: number, total: number): number {
  const last = Math.max(0, total - 1)
  return Math.min(Math.max(index, 0), last)
}

export function reduce(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'next': {
      const index = clamp(state.index + 1, state.total)
      const atEnd = index === Math.max(0, state.total - 1)
      return { ...state, index, playing: atEnd ? false : state.playing }
    }
    case 'prev':
      return { ...state, index: clamp(state.index - 1, state.total) }
    case 'play':
      return { ...state, playing: true }
    case 'pause':
      return { ...state, playing: false }
    case 'reset':
      return initialState(state.total)
    case 'seek':
      return { ...state, index: clamp(action.index, state.total) }
  }
}

export function visibleFrames<T>(frames: T[], state: PlayerState): T[] {
  if (frames.length === 0) return []
  return frames.slice(0, state.index + 1)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- site/src/lib/player-state.test.ts
```
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib vitest.config.ts
git commit -m "feat(site): add pure player state machine"
```

---

## Task 10: TracePlayer island and static transcript

**Files:**
- Create: `site/src/components/Frame.tsx`, `site/src/components/TracePlayer.tsx`, `site/src/components/TraceTranscript.astro`
- Modify: `site/tsconfig.json`

**Interfaces:**
- Consumes: `initialState`, `reduce`, `visibleFrames`, `type PlayerState` from `site/src/lib/player-state.ts`
- Produces:
  - `<TracePlayer trace={Trace} />` — Preact island, used in MDX with `client:visible`
  - `<TraceTranscript trace={Trace} />` — Astro component rendering the whole trace statically

- [ ] **Step 1: Configure Preact JSX in `site/tsconfig.json`**

Ensure `compilerOptions` contains:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
```
Keep whatever `extends` value `create-astro` wrote.

- [ ] **Step 2: Write `site/src/components/Frame.tsx`**

```tsx
type AnyFrame = { type: string; [key: string]: unknown }

function label(frame: AnyFrame): string {
  switch (frame.type) {
    case 'user':
      return 'You'
    case 'assistant':
      return 'Model'
    case 'tool_call':
      return `Tool call — ${String(frame.name)}`
    case 'tool_result':
      return frame.ok === true ? 'Tool result' : 'Tool error'
    case 'compaction':
      return 'Context compaction'
    case 'approval':
      return `Approval — ${String(frame.decision)}`
    default:
      return frame.type
  }
}

function body(frame: AnyFrame): string {
  switch (frame.type) {
    case 'user':
    case 'assistant':
      return String(frame.content)
    case 'tool_call':
      return JSON.stringify(frame.args, null, 2)
    case 'tool_result':
      return typeof frame.result === 'string'
        ? frame.result
        : JSON.stringify(frame.result, null, 2)
    case 'compaction':
      return `${String(frame.before)} tokens -> ${String(frame.after)} tokens: ${String(frame.summary)}`
    case 'approval':
      return `${String(frame.tool)} was ${String(frame.decision)}ed`
    default:
      // Unknown variants render as raw JSON rather than crashing the island.
      return JSON.stringify(frame, null, 2)
  }
}

export function FrameView({ frame }: { frame: AnyFrame }) {
  return (
    <li data-frame-type={frame.type}>
      <p>{label(frame)}</p>
      <pre>{body(frame)}</pre>
    </li>
  )
}
```

- [ ] **Step 3: Write `site/src/components/TracePlayer.tsx`**

```tsx
import { useEffect, useReducer } from 'preact/hooks'
import { initialState, reduce, visibleFrames } from '../lib/player-state.ts'
import { FrameView } from './Frame.tsx'

type AnyFrame = { type: string; [key: string]: unknown }

type Trace = {
  id: string
  commit: string
  model: string
  task: string
  outcome: 'success' | 'failure' | 'partial'
  tokens: number[]
  frames: AnyFrame[]
}

const STEP_MS = 1400

export default function TracePlayer({ trace }: { trace: Trace }) {
  // Generics are inferred from `reduce`; naming them explicitly breaks across
  // Preact hook typings.
  const [state, dispatch] = useReducer(reduce, initialState(trace.frames.length))

  useEffect(() => {
    if (!state.playing) return
    const timer = setTimeout(() => dispatch({ type: 'next' }), STEP_MS)
    return () => clearTimeout(timer)
  }, [state.playing, state.index])

  const shown = visibleFrames(trace.frames, state)
  const atEnd = state.index >= trace.frames.length - 1

  return (
    <section aria-label={`Recorded run: ${trace.task}`} data-trace-player>
      <header>
        <p>{trace.task}</p>
        <p>
          {trace.model} · {trace.commit} · outcome: {trace.outcome}
        </p>
      </header>

      <ol data-frames>
        {shown.map((frame, i) => (
          <FrameView key={i} frame={frame} />
        ))}
      </ol>

      <div role="group" aria-label="Playback controls">
        <button
          type="button"
          onClick={() => dispatch({ type: 'prev' })}
          disabled={state.index === 0}
        >
          Previous
        </button>
        <button
          type="button"
          data-action="next"
          onClick={() => dispatch({ type: 'next' })}
          disabled={atEnd}
        >
          Next
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: state.playing ? 'pause' : 'play' })}
          disabled={atEnd}
        >
          {state.playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => dispatch({ type: 'reset' })}>
          Reset
        </button>
        <p aria-live="polite">
          Frame {state.index + 1} of {trace.frames.length}
        </p>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Write `site/src/components/TraceTranscript.astro`**

```astro
---
interface Props {
  trace: {
    task: string
    model: string
    commit: string
    frames: Array<{ type: string; [key: string]: unknown }>
  }
}
const { trace } = Astro.props
---

<noscript>
  <section aria-label={`Recorded run transcript: ${trace.task}`}>
    <p>{trace.task}</p>
    <p>{trace.model} · {trace.commit}</p>
    <ol>
      {
        trace.frames.map((frame) => (
          <li data-frame-type={frame.type}>
            <p>{frame.type}</p>
            <pre>{JSON.stringify(frame, null, 2)}</pre>
          </li>
        ))
      }
    </ol>
  </section>
</noscript>
```

- [ ] **Step 5: Verify the site still builds**

```bash
npm run build --workspace site
```
Expected: build succeeds. The components are not referenced yet, so nothing renders.

- [ ] **Step 6: Commit**

```bash
git add site/src/components site/tsconfig.json
git commit -m "feat(site): add TracePlayer island and noscript transcript"
```

---

## Task 11: Cover pipeline

**Files:**
- Create: `tools/covers/layout.ts`, `tools/make-covers.ts`
- Test: `tools/covers/layout.test.ts`
- Modify: root `package.json` (dependencies)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `buildCover(input: CoverInput): SatoriNode` from `layout.ts`, where
    `CoverInput = { order: number; title: string; thesis: string; traceLine: string }`
  - `npm run covers` — writes `cover.png` into every post folder that has an `index.mdx`

- [ ] **Step 1: Install the cover dependencies**

```bash
npm install -D satori@^0.33.4 @resvg/resvg-js@^2.6.2 @fontsource/inter@^5.3.0 gray-matter@^4.0.3
```

- [ ] **Step 2: Confirm the font files exist and are WOFF, not WOFF2**

```bash
ls node_modules/@fontsource/inter/files/ | grep 'latin-\(400\|700\)-normal'
```
Expected to include `inter-latin-400-normal.woff` and `inter-latin-700-normal.woff`.
Satori cannot decode WOFF2 — if only `.woff2` is present, stop and source a TTF instead.

- [ ] **Step 3: Write the failing test**

Create `tools/covers/layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildCover } from './layout.ts'

const input = {
  order: 1,
  title: 'An LLM Is Not an Agent',
  thesis: 'Without a loop, it is a chatbot.',
  traceLine: 'assistant: You can run `find . -name "*.ts" | wc -l`.',
}

type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } }

function walk(node: Node, visit: (n: Node) => void): void {
  visit(node)
  const children = node.props.children
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    if (child && typeof child === 'object') walk(child as Node, visit)
  }
}

describe('buildCover', () => {
  it('returns a satori element tree with no React dependency', () => {
    const tree = buildCover(input)
    expect(tree.type).toBe('div')
    expect(tree.props.style).toBeDefined()
  })

  it('gives every multi-child node an explicit display, as satori requires', () => {
    const offenders: string[] = []
    walk(buildCover(input) as Node, (node) => {
      const children = node.props.children
      if (Array.isArray(children) && children.length > 1) {
        const display = node.props.style?.display
        if (display !== 'flex' && display !== 'none' && display !== 'contents') {
          offenders.push(node.type)
        }
      }
    })
    expect(offenders).toEqual([])
  })

  it('includes the post number and the title', () => {
    const text: string[] = []
    walk(buildCover(input) as Node, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    expect(text).toContain('01')
    expect(text).toContain('An LLM Is Not an Agent')
  })

  it('pads single-digit post numbers', () => {
    const text: string[] = []
    walk(buildCover({ ...input, order: 9 }) as Node, (node) => {
      if (typeof node.props.children === 'string') text.push(node.props.children)
    })
    expect(text).toContain('09')
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npm test -- tools/covers/layout.test.ts
```
Expected: FAIL — cannot resolve `./layout.ts`.

- [ ] **Step 5: Write `tools/covers/layout.ts`**

```ts
export type CoverInput = {
  order: number
  title: string
  thesis: string
  /** A single line lifted from the real trace, used as background texture. */
  traceLine: string
}

export type SatoriNode = {
  type: string
  props: {
    style?: Record<string, unknown>
    children?: SatoriNode | string | Array<SatoriNode | string>
  }
}

const INK = '#0b0f14'
const PAPER = '#f5f3ee'
const ACCENT = '#5ad1a0'
const MUTED = '#5c6874'

function node(
  type: string,
  style: Record<string, unknown>,
  children?: SatoriNode | string | Array<SatoriNode | string>,
): SatoriNode {
  return { type, props: { style, children } }
}

/**
 * Satori's default `display` is flex, and any node with more than one child
 * must declare it explicitly or its layout silently collapses.
 */
export function buildCover(input: CoverInput): SatoriNode {
  const number = String(input.order).padStart(2, '0')

  return node(
    'div',
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: '100%',
      height: '100%',
      padding: '64px',
      backgroundColor: INK,
      color: PAPER,
      fontFamily: 'Inter',
    },
    [
      node(
        'div',
        { display: 'flex', alignItems: 'center', gap: '16px' },
        [
          node(
            'div',
            { display: 'flex', fontSize: 28, fontWeight: 700, color: ACCENT },
            number,
          ),
          node(
            'div',
            { display: 'flex', fontSize: 24, color: MUTED, letterSpacing: '0.18em' },
            'NINE COMMITS',
          ),
        ],
      ),
      node(
        'div',
        { display: 'flex', flexDirection: 'column', gap: '20px' },
        [
          node(
            'div',
            { display: 'flex', fontSize: 68, fontWeight: 700, lineHeight: 1.1 },
            input.title,
          ),
          node(
            'div',
            { display: 'flex', fontSize: 30, color: MUTED, lineHeight: 1.35 },
            input.thesis,
          ),
        ],
      ),
      node(
        'div',
        {
          display: 'flex',
          fontSize: 20,
          color: MUTED,
          opacity: 0.55,
          borderTop: `2px solid ${MUTED}`,
          paddingTop: '20px',
        },
        input.traceLine.slice(0, 96),
      ),
    ],
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test -- tools/covers/layout.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 7: Write `tools/make-covers.ts`**

```ts
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import matter from 'gray-matter'
import { buildCover } from './covers/layout.ts'

const WIDTH = 1200
const HEIGHT = 627
const POSTS_DIR = join('site', 'src', 'content', 'posts')
const FONT_DIR = join('node_modules', '@fontsource', 'inter', 'files')

function loadFonts() {
  return [
    {
      name: 'Inter',
      data: readFileSync(join(FONT_DIR, 'inter-latin-400-normal.woff')),
      weight: 400 as const,
      style: 'normal' as const,
    },
    {
      name: 'Inter',
      data: readFileSync(join(FONT_DIR, 'inter-latin-700-normal.woff')),
      weight: 700 as const,
      style: 'normal' as const,
    },
  ]
}

function firstAssistantLine(postDir: string): string {
  const tracePath = join(postDir, 'trace.json')
  if (!existsSync(tracePath)) return ''
  const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as {
    frames: Array<{ type: string; content?: string }>
  }
  const frame = trace.frames.find((f) => f.type === 'assistant')
  return frame?.content?.replace(/\s+/g, ' ').trim() ?? ''
}

async function main(): Promise<void> {
  const fonts = loadFonts()
  const slugs = readdirSync(POSTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  for (const slug of slugs) {
    const postDir = join(POSTS_DIR, slug)
    const mdxPath = join(postDir, 'index.mdx')
    if (!existsSync(mdxPath)) continue

    const { data } = matter(readFileSync(mdxPath, 'utf8'))

    const element = buildCover({
      order: Number(data.order),
      title: String(data.title),
      thesis: String(data.thesis),
      traceLine: firstAssistantLine(postDir),
    })

    const svg = await satori(element as never, {
      width: WIDTH,
      height: HEIGHT,
      fonts,
    })

    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: WIDTH },
    })
      .render()
      .asPng()

    const out = join(postDir, 'cover.png')
    writeFileSync(out, png)
    console.log(`wrote ${out}`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 8: Commit**

```bash
git add tools/covers tools/make-covers.ts package.json package-lock.json
git commit -m "feat(tools): add satori cover generation pipeline"
```

---

## Task 12: Post 1, end to end

**Files:**
- Create: `site/src/content/posts/01-not-an-agent/index.mdx`, `linkedin.md`, `cover-prompt.md`, `trace.json` (recorded), `cover.png` (generated)

**Interfaces:**
- Consumes: the agent CLI (Task 6), `record-trace` (Task 5), `make-covers` (Task 11), the collection schema (Task 8), `TracePlayer` and `TraceTranscript` (Task 10)
- Produces: the first live post

- [ ] **Step 1: Record a real failing run**

Put a real key in `agent/.env` (copy from `.env.example`), then:

```bash
cd agent
TRACE_ID=explains-instead-of-doing TRACE_COMMIT=v1-not-an-agent \
  npm start -- "Count how many TypeScript files are in this project and tell me the number."
cd ..
```
Expected: the model describes a command to run instead of running it, and
`agent/traces/explains-instead-of-doing.json` is written. **That failure is the
content.** If the model happens to answer with a plausible fabricated number,
that is an even better trace — keep it and say so in the post.

- [ ] **Step 2: Normalize the trace into the site**

```bash
npm run record -- agent/traces/explains-instead-of-doing.json 01-not-an-agent
```
Expected: `wrote site/src/content/posts/01-not-an-agent/trace.json (2 frames, failure)`

- [ ] **Step 3: Read the recorded trace and confirm it is clean**

```bash
cat site/src/content/posts/01-not-an-agent/trace.json
```
Confirm by eye: no home directory, no key, nothing private. The pipeline
enforces this, but a human read of the first trace is worth the minute.

- [ ] **Step 4: Write `site/src/content/posts/01-not-an-agent/index.mdx`**

```mdx
---
order: 1
title: An LLM Is Not an Agent
thesis: Without a loop, it is a chatbot with better manners.
pubDate: 2026-09-17
commit: v1-not-an-agent
cover: ./cover.png
coverAlt: "Commit 01 of Nine Commits: An LLM Is Not an Agent"
---

import TracePlayer from '../../../components/TracePlayer.tsx'
import TraceTranscript from '../../../components/TraceTranscript.astro'
import trace from './trace.json'

Everyone calls things agents now. A prompt with a system message is an agent. A
chatbot with a retrieval step is an agent. The word has been stretched until it
means "LLM I am excited about."

Here is the definition I am building this series on:

**An agent is an LLM that can take actions in a loop until a task is complete.**

Three parts, and all three are load-bearing. A model that reasons. Actions it
can actually take. And a loop that keeps going until the work is done rather
than until the response is finished.

Drop any one of them and you have something else. Drop the loop specifically,
and you have a chatbot — which is exactly what this first commit is.

## What I built

Forty lines. One call to `generateText`, a model name, a system instruction, and
a `console.log`. No tools. No message history. No loop.

```ts
export async function runOnce(task: string): Promise<RunResult> {
  const result = await generateText({
    model: openai(MODEL_NAME),
    instructions: INSTRUCTIONS,
    prompt: task,
  })

  return { text: result.text, model: MODEL_NAME, totalTokens: result.usage?.totalTokens ?? 0 }
}
```

I am starting here on purpose. Everything the next eight commits add is easier
to argue for once you have watched this version fail.

## What broke

I asked it to count the TypeScript files in this project.

It cannot open a directory. It has no filesystem. What it does have is a very
strong prior that when a human asks this question, the useful reply is a shell
command. So it gave me one.

That is the failure mode worth internalizing: it did not refuse, and it did not
say it was unable. It produced something helpful-shaped. The gap between
"answered the question" and "did the work" is invisible in the output, and it is
the entire reason the rest of this series exists.

<TracePlayer trace={trace} client:visible />
<TraceTranscript trace={trace} />

Two frames. That is the whole run. A question went in, prose came out, and
nothing in the world changed.

## What is missing

Compare that to what the run would need to actually answer:

1. Decide that listing files is the next action
2. Call something that lists files
3. Read what came back
4. Decide whether that was enough
5. Repeat until it is

Steps 1 and 3 need **tools**. Steps 4 and 5 need a **loop**. The next commit
adds the first one.
```

- [ ] **Step 5: Write `site/src/content/posts/01-not-an-agent/linkedin.md`**

```markdown
I asked a language model to count the TypeScript files in my project.

It gave me a shell command.

Not a refusal. Not "I don't have filesystem access." A confident, correct,
completely useless answer — because a model without tools can only ever
describe the action, never take it.

That gap is the whole reason agents exist, and it is almost invisible in the
output. The reply looks helpful. Nothing happened.

I'm building an agent from scratch in nine commits and writing up each one —
with the real recorded runs, including the ones that fail like this. You can
step through this exact trace on the post.

Commit 1 of 9: An LLM Is Not an Agent.

https://baradelli.github.io/nine-commits/posts/01-not-an-agent/
```

- [ ] **Step 6: Write `site/src/content/posts/01-not-an-agent/cover-prompt.md`**

```markdown
# Cover image prompt — Post 01

Used only if replacing the generated typographic cover (`cover.png`) with
generative art. Output must be 1200x627.

## Prompt

> A dark editorial illustration, 1200x627, for a technical article titled
> "An LLM Is Not an Agent". Central image: a disembodied speech bubble hovering
> above a closed laptop, casting no shadow on it — the bubble is bright and
> detailed, the laptop is untouched and dark. Flat vector style, limited palette
> of near-black (#0b0f14), warm off-white (#f5f3ee) and a single mint accent
> (#5ad1a0). Generous negative space on the left third for a title overlay.
> No text in the image. No people. No glowing brains, no robots, no circuit
> board motifs.

## Why this image

The article's argument is that the model produces something helpful-shaped
without changing anything. A vivid speech bubble that casts no shadow on the
machine is that argument in one frame.

## Negative prompt

robots, humanoid AI, glowing brain, circuit board, neural network diagram,
stock-photo businessman, lens flare, text, watermark
```

- [ ] **Step 7: Generate the cover**

```bash
npm run covers
```
Expected: `wrote site/src/content/posts/01-not-an-agent/cover.png`

- [ ] **Step 8: Inspect the cover**

Open `site/src/content/posts/01-not-an-agent/cover.png`. Confirm it is
1200x627, the text is not clipped, and nothing overlaps. If text overflows,
shorten the thesis or reduce `fontSize` in `tools/covers/layout.ts` and re-run.

- [ ] **Step 9: Build and view the post**

```bash
npm run dev --workspace site
```
Open `http://localhost:4321/nine-commits/posts/01-not-an-agent/`. Confirm the
post renders, the cover appears, and the player steps through both frames.

- [ ] **Step 10: Verify the production build**

```bash
npm run build --workspace site
```
Expected: build succeeds, including the content collection schema validation.

- [ ] **Step 11: Commit**

```bash
git add site/src/content/posts/01-not-an-agent
git commit -m "content: post 1 — An LLM Is Not an Agent"
```

- [ ] **Step 12: Tag the agent commit the post refers to**

```bash
git tag -a v1-not-an-agent -m "Commit 1: a single model call, no tools, no loop"
```

---

## Task 13: Playwright smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/post.spec.ts`
- Modify: root `package.json` (dependency)

**Interfaces:**
- Consumes: the built site from Task 12
- Produces: `npm run e2e`

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test@^1.63.0
npx playwright install chromium
```

- [ ] **Step 2: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4321/nine-commits' },
  webServer: {
    command: 'npm run preview --workspace site -- --port 4321',
    url: 'http://localhost:4321/nine-commits/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

- [ ] **Step 3: Write `e2e/post.spec.ts`**

```ts
import { test, expect } from '@playwright/test'

const SLUG = '01-not-an-agent'

test('the index lists the post', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: /An LLM Is Not an Agent/ })).toBeVisible()
})

test('the post renders with its cover', async ({ page }) => {
  await page.goto(`/posts/${SLUG}/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'An LLM Is Not an Agent',
  )
  await expect(page.getByRole('img')).toBeVisible()
})

test('the player starts at frame 1 and advances', async ({ page }) => {
  await page.goto(`/posts/${SLUG}/`)
  const player = page.locator('[data-trace-player]')
  await expect(player).toBeVisible()

  await expect(player.locator('[data-frames] > li')).toHaveCount(1)
  await player.locator('[data-action="next"]').click()
  await expect(player.locator('[data-frames] > li')).toHaveCount(2)
})

test('the post page logs no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.goto(`/posts/${SLUG}/`)
  await page.locator('[data-trace-player]').waitFor()
  expect(errors).toEqual([])
})
```

- [ ] **Step 4: Build and run the tests**

```bash
npm run build --workspace site
npm run e2e
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json
git commit -m "test: add Playwright smoke tests for the post page"
```

---

## Task 14: Deploy

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the whole repository
- Produces: the site live at `https://baradelli.github.io/nine-commits`

- [ ] **Step 1: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v5
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      # Spec §5: a malformed or leaking trace must never reach production.
      - run: npm run validate

  build:
    needs: verify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: withastro/action@v6
        with:
          path: ./site
          node-version: 20

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

- [ ] **Step 2: Run the full verification suite locally before publishing**

```bash
npm run typecheck && npm test && npm run validate && npm run build --workspace site && npm run e2e
```
Expected: all five succeed. Do not continue otherwise.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy site to GitHub Pages"
```

- [ ] **Step 4: Create the public repository — ASK THE USER FIRST**

This publishes the repository and everything in it. Confirm with the user
before running it.

```bash
gh repo create Baradelli/nine-commits --public --source=. --remote=origin --push
git push origin v1-not-an-agent
```

- [ ] **Step 5: Enable GitHub Pages with the Actions source**

```bash
gh api -X POST repos/Baradelli/nine-commits/pages -f build_type=workflow
```
If it reports that Pages already exists, that is fine.

- [ ] **Step 6: Watch the deploy**

```bash
gh run watch
```
Expected: both jobs succeed.

- [ ] **Step 7: Verify production**

```bash
curl -sI https://baradelli.github.io/nine-commits/posts/01-not-an-agent/ | head -1
```
Expected: `HTTP/2 200`. Then open it in a browser and step through the player.

---

## Done when

- `https://baradelli.github.io/nine-commits/posts/01-not-an-agent/` is live
- The trace player steps through the real recorded run
- With JavaScript disabled, the transcript still renders
- `cover.png` exists in the post folder, ready to attach to a LinkedIn post
- `linkedin.md` holds the copy for that post
- `npm run typecheck && npm test && npm run validate && npm run e2e` all pass
- The tag `v1-not-an-agent` is pushed and linked from the post footer
