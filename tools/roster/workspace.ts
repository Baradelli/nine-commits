/**
 * The project the agent is given, as data.
 *
 * Every earlier commit in this series pointed the agent at this repository,
 * and every earlier post paid for it: the answer key to the question being
 * asked kept turning up in the corpus, because the corpus is the thing that
 * documents the experiment. A write tool makes that arrangement impossible
 * anyway — the agent may not have this repository under it — so the workspace
 * is a small invented project instead, materialised fresh for every run.
 *
 * Two properties it needs and this repository could not give it:
 *
 * - **Nothing in it is stated anywhere else.** The timeout is 4500 and the
 *   port is 8137 in exactly one file each. There is no README paraphrasing
 *   them, no post about them, and no plan document naming them.
 * - **It is the same for every run.** A run's grade is a comparison between
 *   the tree before and the tree after, and that is only a measurement if
 *   "before" is a constant.
 *
 * It is committed, so the tasks below can be read against the files they grade
 * — and it does put these values into this repository's own corpus, where a
 * later post's agent could find them. That is the trap posts 2, 3, 4 and 5
 * walked into, named early this time. It costs nothing here, because the agent
 * in this commit cannot read this repository at all.
 */
export const WORKSPACE: Readonly<Record<string, string>> = {
  'README.md': [
    '# parcel-relay',
    '',
    'A small service that accepts parcels from carriers and forwards them to the',
    'dispatch queue. Configuration lives under `config/`.',
    '',
    '## Running it',
    '',
    '    npm install',
    '    npm start',
    '',
  ].join('\n'),

  'package.json': [
    '{',
    '  "name": "parcel-relay",',
    '  "version": "0.4.1",',
    '  "private": true,',
    '  "scripts": {',
    '    "start": "node src/server.js"',
    '  }',
    '}',
    '',
  ].join('\n'),

  // The one file that sets the timeout, and the one file the edit tasks change.
  'config/settings.json': [
    '{',
    '  "region": "eu-west-2",',
    '  "timeoutMs": 4500,',
    '  "retries": 3,',
    '  "queueName": "parcel-inbound"',
    '}',
    '',
  ].join('\n'),

  // The one file that sets the port.
  'src/server.ts': [
    "import { dispatch } from './dispatch.ts'",
    '',
    'const PORT = 8137',
    '',
    'export function start(): void {',
    '  console.log(`parcel-relay listening on ${PORT}`)',
    '  dispatch()',
    '}',
    '',
  ].join('\n'),

  'src/dispatch.ts': [
    "import { enqueue } from './queue.ts'",
    '',
    'export function dispatch(): void {',
    "  enqueue({ kind: 'parcel' })",
    '}',
    '',
  ].join('\n'),

  'src/queue.ts': [
    'export type Job = { kind: string }',
    '',
    'const pending: Job[] = []',
    '',
    'export function enqueue(job: Job): void {',
    '  pending.push(job)',
    '}',
    '',
  ].join('\n'),

  'docs/CHANGELOG.md': [
    '# Changelog',
    '',
    '## 0.4.1',
    '',
    '- Renamed the inbound queue.',
    '',
    '## 0.4.0',
    '',
    '- First release of the relay.',
    '',
  ].join('\n'),

  'notes/todo.md': [
    '# Todo',
    '',
    '- [ ] decide on a retry policy',
    '- [ ] write the operator runbook',
    '',
  ].join('\n'),
}

/** Paths in the workspace, sorted, as a run sees them. */
export const WORKSPACE_FILES = Object.keys(WORKSPACE).sort()
