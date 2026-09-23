import { test, expect } from '@playwright/test'

const SLUG = '02-hands'
const TITLE = 'Giving It Hands'

test('the index lists the second post', async ({ page }) => {
  await page.goto('')
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible()
})

test('the post renders with its cover', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE)
  await expect(page.locator('img.post__cover')).toBeVisible()
})

test('the comparison carries its own caveat, and the tally is downloadable', async ({
  page,
}) => {
  await page.goto(`posts/${SLUG}/`)

  // The caption has to live inside the compare block. This block travels —
  // screenshotted or scrolled past — and on its own it shows the thesis
  // reversed.
  const caption = page.locator('[data-trace-compare] [data-compare-caption]')
  await expect(caption).toBeVisible()
  await expect(caption).toContainText('One run per side')

  // And the table's claim is only checkable if the rows actually ship.
  const link = page.getByRole('link', { name: 'runs.tsv' })
  await expect(link).toBeVisible()
  const rows = await page.request.get((await link.getAttribute('href')) ?? '')
  expect(rows.ok()).toBe(true)
  const dataRows = (await rows.text())
    .split('\n')
    .filter((line) => /^\d+\t/.test(line))
  expect(dataRows).toHaveLength(42)
})

test('the compare switch changes which run is playing', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)

  const compare = page.locator('[data-trace-compare]')
  await expect(compare).toBeVisible()

  const precise = compare.locator('[data-run="precise-descriptions"]')
  const thin = compare.locator('[data-run="thin-descriptions"]')
  const player = compare.locator('[data-trace-player]')

  // The first run is selected on load, and the switch says so in a way a
  // screen reader gets too.
  await expect(precise).toHaveAttribute('aria-pressed', 'true')
  await expect(thin).toHaveAttribute('aria-pressed', 'false')

  // Step into the precise run's tool call: it reaches for list_files.
  const next = player.locator('[data-action="next"]')
  await next.scrollIntoViewIfNeeded()
  await next.click()
  await expect(player.locator('[data-frame-type="tool_call"]')).toContainText(
    'list_files',
  )
  await expect(player.locator('.player__count')).toHaveText('Frame 2 of 4')

  // Switching runs restarts at frame one rather than inheriting a position.
  await thin.click()
  await expect(thin).toHaveAttribute('aria-pressed', 'true')
  await expect(precise).toHaveAttribute('aria-pressed', 'false')
  await expect(player.locator('.player__count')).toHaveText('Frame 1 of 4')
  await expect(player.locator('.player__budget')).toContainText(
    '96 tokens in context',
  )

  // And the other run reached for the other tool.
  await next.scrollIntoViewIfNeeded()
  await next.click()
  await expect(player.locator('[data-frame-type="tool_call"]')).toContainText(
    'search_files',
  )
})

test('both runs are printed in full for a reader without scripting', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(`posts/${SLUG}/`)

  // Two <noscript> transcripts, each labelled with the run it belongs to.
  const transcripts = page.locator('.transcript-block')
  await expect(transcripts).toHaveCount(2)
  await expect(transcripts.first()).toContainText('Precise descriptions')
  await expect(transcripts.last()).toContainText('Thin descriptions')
  await expect(page.locator('.transcript-block .frame')).toHaveCount(8)

  await context.close()
})
