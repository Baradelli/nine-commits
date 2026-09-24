import { test, expect } from '@playwright/test'

const SLUG = '07-context'
const TITLE = 'Context Is the Real Constraint'

/*
 * The frame the schema has carried since commit 1 and no trace had ever
 * contained.
 *
 * Three things are asserted here and only one of them is about pixels. The
 * frame renders; the summary it stands in for is on the page; and the budget
 * meter **goes down** when you step over it, which is the behaviour the
 * player's own comment has promised for six commits and which no test could
 * check before there was a real compaction to step over.
 */

test('the index lists the seventh post', async ({ page }) => {
  await page.goto('')
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible()
})

test('the post renders with its cover', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE)
  await expect(page.locator('img.post__cover')).toBeVisible()
})

/** The compare block starts on the control; the compaction is the other run. */
async function openCompactedRun(page: import('@playwright/test').Page) {
  const compare = page.locator('[data-trace-compare]')
  await expect(compare).toBeVisible()
  const on = compare.locator('[data-run="on-1"]')
  await on.scrollIntoViewIfNeeded()
  await on.click()
  await expect(on).toHaveAttribute('aria-pressed', 'true')
  return compare.locator('[data-trace-player]')
}

test('the compare switch starts on the control', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  const compare = page.locator('[data-trace-compare]')
  await expect(compare.locator('[data-run="off-1"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // The uncompacted run has no compaction in it. That is the point of it.
  await expect(compare.locator('[data-frame-type="compaction"]')).toHaveCount(0)
})

test('stepping onto a compaction makes the budget retreat', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)

  const player = await openCompactedRun(page)
  await expect(player).toBeVisible()

  const budget = player.locator('.player__budget')
  const next = player.locator('[data-action="next"]')

  /** The "N tokens in context" figure, as a number. */
  const carried = async (): Promise<number> => {
    const text = (await budget.textContent()) ?? ''
    const match = /^([\d,]+) tokens in context/.exec(text.trim())
    if (match === null) throw new Error(`could not read the budget: ${text}`)
    return Number((match[1] ?? '').replace(/,/g, ''))
  }

  await next.scrollIntoViewIfNeeded()

  let previous = await carried()
  let peak = previous
  let retreats = 0
  let compactionsSeen = 0

  // Step the whole run. The transcript grows as it goes, which is why the
  // transport sits above it.
  for (let step = 0; step < 40; step += 1) {
    if (await next.isDisabled()) break
    await next.click()
    const now = await carried()
    if (now < previous) retreats += 1
    peak = Math.max(peak, now)
    previous = now
    compactionsSeen = await player.locator('[data-frame-type="compaction"]').count()
  }

  // The run compacted more than once, every compaction is on the page, and the
  // meter went backwards at least as often.
  expect(compactionsSeen).toBeGreaterThan(1)
  expect(retreats).toBeGreaterThanOrEqual(compactionsSeen)

  // And it went somewhere worth going back from.
  expect(peak).toBeGreaterThan(10_000)
})

test('a compaction frame says what it replaced and what it kept', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)

  // Scoped under the player. `TraceTranscript.astro` renders the same frames
  // inside a <noscript>, and a locator that reached into that would be
  // asserting the fallback while claiming to assert the island.
  const player = await openCompactedRun(page)
  const compaction = player.locator('[data-frame-type="compaction"]').first()
  const next = player.locator('[data-action="next"]')
  await next.scrollIntoViewIfNeeded()

  for (let step = 0; step < 40; step += 1) {
    if ((await compaction.count()) > 0) break
    if (await next.isDisabled()) break
    await next.click()
  }

  await expect(compaction).toHaveAttribute('data-tone', 'compaction')
  await expect(compaction.locator('.frame__label')).toHaveText('Compacts')
  await expect(compaction.locator('.frame__caption')).toContainText(
    'The history was rewritten from',
  )
  // The summary is the only thing standing in for everything it replaced, so
  // it is on the page in full rather than behind a toggle.
  await expect(compaction.locator('.frame__speech').first()).not.toBeEmpty()
})

test('the tally ships, and has a row per run', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  const link = page.getByRole('link', { name: 'runs.tsv' })
  await expect(link).toBeVisible()
  const rows = await page.request.get((await link.getAttribute('href')) ?? '')
  expect(rows.ok()).toBe(true)
  const dataRows = (await rows.text())
    .split('\n')
    .filter((line) => /^\d{4}-\d\d-\d\d/.test(line))
  expect(dataRows).toHaveLength(100)
})

test('the post page logs no console errors once the player is stepped', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto(`posts/${SLUG}/`)
  const player = await openCompactedRun(page)
  await player.waitFor()

  const next = player.locator('[data-action="next"]')
  await next.scrollIntoViewIfNeeded()
  await next.click()
  await player.locator('[data-action="prev"]').click()
  await player.locator('[data-action="play"]').click()
  await player.locator('[data-action="reset"]').click()

  expect(errors).toEqual([])
})
