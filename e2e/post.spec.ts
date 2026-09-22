import { test, expect } from '@playwright/test'

const SLUG = '01-not-an-agent'
const TITLE = 'An LLM Is Not an Agent'

test('the index lists the post', async ({ page }) => {
  await page.goto('')
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible()
})

test('the post renders with its cover', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE)
  await expect(page.locator('img.post__cover')).toBeVisible()
})

test('the player starts on the user frame and advances to the assistant reply', async ({
  page,
}) => {
  await page.goto(`posts/${SLUG}/`)
  const player = page.locator('[data-trace-player]')
  await expect(player).toBeVisible()

  // Scoped under the player: `TraceTranscript.astro` renders an identical
  // `<ol class="transcript full">` inside a <noscript> block, and an
  // unscoped locator would silently match that too.
  const frames = player.locator('[data-frame-type]')
  const userFrame = player.locator('[data-frame-type="user"]')
  const assistantFrame = player.locator('[data-frame-type="assistant"]')

  await expect(frames).toHaveCount(1)
  await expect(userFrame).toBeVisible()
  await expect(assistantFrame).not.toBeVisible()
  await expect(player.locator('.player__count')).toHaveText('Frame 1 of 2')
  await expect(player.locator('.player__budget')).toContainText('0 tokens in context')

  // The island hydrates with `client:visible`, and this player sits well
  // below the fold in a default viewport. Scrolling it into view starts the
  // IntersectionObserver, but hydration finishes on a later tick than the
  // scroll itself, so the very first click can land on the pre-hydration
  // static markup and do nothing. Retry the click rather than sleeping an
  // arbitrary amount: this waits exactly as long as hydration takes.
  const nextButton = player.locator('[data-action="next"]')
  await nextButton.scrollIntoViewIfNeeded()
  await expect(async () => {
    await nextButton.click()
    await expect(frames).toHaveCount(2, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  await expect(userFrame).toBeVisible()
  await expect(assistantFrame).toBeVisible()
  await expect(player.locator('.player__count')).toHaveText('Frame 2 of 2')
  await expect(player.locator('.player__budget')).toContainText('245 tokens in context')
})

test('the post page logs no console errors once the player is stepped', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto(`posts/${SLUG}/`)
  const player = page.locator('[data-trace-player]')
  await player.waitFor()

  // A hydration error in the reducer surfaces on interaction, not on mount,
  // so the check has to happen after stepping through the controls rather
  // than right after the player appears. The retry below is only to get past
  // the `client:visible` hydration race (see the previous test); once one
  // click has registered, the island is confirmed hydrated and the rest can
  // run without retrying.
  const nextButton = player.locator('[data-action="next"]')
  const frames = player.locator('[data-frame-type]')
  await nextButton.scrollIntoViewIfNeeded()
  await expect(async () => {
    await nextButton.click()
    await expect(frames).toHaveCount(2, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  await player.locator('[data-action="prev"]').click()
  await player.locator('[data-action="play"]').click()
  await player.locator('[data-action="reset"]').click()

  expect(errors).toEqual([])
})
