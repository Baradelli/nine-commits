import { test, expect } from '@playwright/test'

const SLUG = '08-shell'
const TITLE = "Shell Access, and Why That's Terrifying"

/*
 * The first post with two compare widgets on one page, and the first with a
 * refused tool call in a published trace.
 *
 * What is asserted here that no earlier spec could: a `tool_result` whose `ok`
 * is false renders as a failure rather than as a result, the refusal message
 * the guard wrote is on the page in full, and two `TraceCompare` blocks on one
 * page do not fight over the switch — which they would if the component keyed
 * its buttons by index instead of by trace id.
 */

test('the index lists the eighth post', async ({ page }) => {
  await page.goto('')
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible()
})

test('the post renders with its cover', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE)
  await expect(page.locator('img.post__cover')).toBeVisible()
})

test('both compare blocks are on the page and switch independently', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  const blocks = page.locator('[data-trace-compare]')
  await expect(blocks).toHaveCount(2)

  const first = blocks.nth(0)
  const second = blocks.nth(1)
  await expect(first.locator('[data-run="four-find-mentions-1"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(second.locator('[data-run="four-largest-file-1"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Switch the first block only. The second must not move.
  const shellRun = first.locator('[data-run="four-shell-find-mentions-1"]')
  await shellRun.scrollIntoViewIfNeeded()
  await shellRun.click()
  await expect(shellRun).toHaveAttribute('aria-pressed', 'true')
  await expect(second.locator('[data-run="four-largest-file-1"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('a refused command renders as a failure, with the guard’s own words', async ({
  page,
}) => {
  await page.goto(`posts/${SLUG}/`)
  const compare = page.locator('[data-trace-compare]').first()
  const shellRun = compare.locator('[data-run="four-shell-find-mentions-1"]')
  await shellRun.scrollIntoViewIfNeeded()
  await shellRun.click()

  const player = compare.locator('[data-trace-player]')
  const next = player.locator('[data-action="next"]')
  await next.scrollIntoViewIfNeeded()

  // The refusal is frame 2 of that run: call, then a failed result.
  await next.click()
  await next.click()

  const failed = player.locator('[data-frame-type="tool_result"][data-tone="error"]')
  await expect(failed).toHaveCount(1)
  await expect(failed.locator('.frame__label')).toHaveText('Fails')
  await expect(failed).toContainText('grep may not be given -R here')
})

test('the winning run is six frames long and its answer is 191 bytes', async ({
  page,
}) => {
  await page.goto(`posts/${SLUG}/`)
  const compare = page.locator('[data-trace-compare]').nth(1)
  const shellRun = compare.locator('[data-run="four-shell-largest-file-1"]')
  await shellRun.scrollIntoViewIfNeeded()
  await shellRun.click()

  const player = compare.locator('[data-trace-player]')
  await expect(player.locator('.player__count')).toHaveText('Frame 1 of 6')

  const next = player.locator('[data-action="next"]')
  await next.scrollIntoViewIfNeeded()
  for (let step = 0; step < 5; step += 1) await next.click()

  await expect(player.locator('[data-frame-type="assistant"]')).toContainText(
    '191 bytes',
  )
  await expect(next).toBeDisabled()
})

test('both tables ship, with a row per run and a row per attack', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)

  const runs = page.getByRole('link', { name: 'runs.tsv' })
  await expect(runs).toBeVisible()
  const runsFile = await page.request.get((await runs.getAttribute('href')) ?? '')
  expect(runsFile.ok()).toBe(true)
  const runRows = (await runsFile.text())
    .split('\n')
    .filter((line) => /^\d{4}-\d\d-\d\d/.test(line))
  expect(runRows).toHaveLength(140)

  const table = page.getByRole('link', { name: 'attacks.tsv' })
  await expect(table).toBeVisible()
  const attackFile = await page.request.get((await table.getAttribute('href')) ?? '')
  expect(attackFile.ok()).toBe(true)
  const attackRows = (await attackFile.text())
    .split('\n')
    .filter((line) => line.trim() !== '')
  // 97 attacks and a header.
  expect(attackRows).toHaveLength(98)
})

/*
 * Post 7 shipped a fix for horizontal overflow at phone width and a test to
 * hold it down. This page is the next thing likely to break it: a `tool_result`
 * frame here contains a whole `wc -c` listing and a command line a hundred and
 * thirty characters long, neither of which has a space anywhere useful.
 */
test.describe('at a phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('stepping every published run never makes the page scroll sideways', async ({
    page,
  }) => {
    await page.goto(`posts/${SLUG}/`)

    const sideways = async (): Promise<number> =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )

    let worst = await sideways()

    for (const run of [
      'four-find-mentions-1',
      'four-shell-find-mentions-1',
      'four-largest-file-1',
      'four-shell-largest-file-1',
    ]) {
      const button = page.locator(`[data-run="${run}"]`)
      await button.scrollIntoViewIfNeeded()
      await button.click()
      const player = button.locator('xpath=ancestor::*[@data-trace-compare]').locator(
        '[data-trace-player]',
      )
      const next = player.locator('[data-action="next"]')
      await next.scrollIntoViewIfNeeded()
      for (let step = 0; step < 30; step += 1) {
        if (await next.isDisabled()) break
        await next.click()
        worst = Math.max(worst, await sideways())
      }
    }

    expect(worst).toBe(0)
  })
})

test('the post page logs no console errors once both players are stepped', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto(`posts/${SLUG}/`)
  for (const run of ['four-shell-find-mentions-1', 'four-shell-largest-file-1']) {
    const button = page.locator(`[data-run="${run}"]`)
    await button.scrollIntoViewIfNeeded()
    await button.click()
    const player = button.locator('xpath=ancestor::*[@data-trace-compare]').locator(
      '[data-trace-player]',
    )
    const next = player.locator('[data-action="next"]')
    await next.scrollIntoViewIfNeeded()
    await next.click()
    await player.locator('[data-action="prev"]').click()
    await player.locator('[data-action="play"]').click()
    await player.locator('[data-action="reset"]').click()
  }

  expect(errors).toEqual([])
})
