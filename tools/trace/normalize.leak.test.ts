import { describe, it, expect, vi } from 'vitest'

// F4: the leak-detection branch in normalize (the one that fires when
// findSecretsDeep still finds something after redaction) had zero test
// coverage anywhere in the batch — the test that claimed to cover it was
// actually exercising the unrelated empty-homeDir guard. By construction,
// redactDeep and findSecretsDeep share the exact same rule set, so nothing
// the current rules recognize can survive redactDeep and still be caught
// by findSecretsDeep afterwards (whatever slips past one slips past the
// other identically). Reaching this branch for real therefore requires
// forcing a redaction bypass — this is a deliberate, disclosed use of
// module mocking to exercise defensive code that the public API cannot
// otherwise drive, not a workaround for a flaky test.
//
// This same fixture also doubles as regression coverage for F1: the leaked
// value is a Windows home-directory path (with single backslashes), which
// is exactly the shape that a JSON.stringify-based scan (the old
// implementation) would miss because JSON escaping doubles backslashes.
vi.mock('./redact.ts', async () => {
  const actual = await vi.importActual<typeof import('./redact.ts')>(
    './redact.ts',
  )
  return {
    ...actual,
    redactDeep: <T,>(value: T): T => value,
  }
})

const { normalize } = await import('./normalize.ts')

const opts = { homeDir: 'C:\\Users\\User', denyList: [] }

const raw = {
  id: 'r1',
  commit: 'v1-not-an-agent',
  model: 'gpt-5-mini',
  task: 'note: C:\\Users\\User\\secret.ts',
  outcome: 'failure' as const,
  tokens: [0],
  frames: [
    { type: 'user' as const, content: 'note: C:\\Users\\User\\secret.ts' },
  ],
}

describe('normalize leak-detection branch', () => {
  it('throws when a secret survives (bypassed) redaction', () => {
    expect(() => normalize(raw, opts)).toThrow(/survived redaction/)
  })

  it('names the secret kind, never the value, in the thrown message', () => {
    expect.assertions(2)
    try {
      normalize(raw, opts)
    } catch (err) {
      const message = (err as Error).message
      expect(message).toContain('home-path')
      expect(message).not.toContain('C:\\Users\\User')
    }
  })
})
