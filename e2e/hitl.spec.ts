import { test, expect } from '@playwright/test'

const SLUG = '09-hitl'
const TITLE = 'The Human in the Loop'

/*
 * The last post, and the first interactive block on this site that is not a
 * switch between two recordings.
 *
 * What is asserted here that no earlier spec could: the approval frame renders
 * at all (no trace before this one contains one); the choice is refused until
 * the run has actually reached the question; answering it opens the chosen
 * branch *at* the question rather than back at the start; the other branch is
 * one click away and lands in the same place; and the shared prefix really is
 * shared, which the page shows by presenting identical frames whichever answer
 * you give.
 */

test('the index lists the ninth post, and says the series is complete', async ({ page }) => {
  await page.goto('')
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible()
  await expect(page.locator('.standfirst')).toContainText('All nine are published')
  await expect(page.locator('.entry--planned')).toHaveCount(0)
})

test('the post renders with its cover', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE)
  await expect(page.locator('img.post__cover')).toBeVisible()
})

test('the fork is disabled until the run reaches the question', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  const branch = page.locator('[data-trace-branch]')
  await expect(branch).toHaveCount(1)
  await branch.scrollIntoViewIfNeeded()

  const allow = branch.locator('[data-decision="allow"]')
  const deny = branch.locator('[data-decision="deny"]')
  await expect(allow).toBeDisabled()
  await expect(deny).toBeDisabled()

  // No approval frame yet: the prefix stops before it.
  await expect(branch.locator('[data-frame-type="approval"]')).toHaveCount(0)

  await branch.locator('[data-decision="skip"]').click()
  await expect(allow).toBeEnabled()
  await expect(deny).toBeEnabled()
})

test('answering opens the branch at the question, not at the start', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  const branch = page.locator('[data-trace-branch]')
  await branch.scrollIntoViewIfNeeded()
  await branch.locator('[data-decision="skip"]').click()
  await branch.locator('[data-decision="allow"]').click()

  const approval = branch.locator('[data-frame-type="approval"]')
  await expect(approval).toHaveCount(1)
  await expect(approval).toContainText('write_file was allowed to run')
  await expect(approval).toHaveAttribute('data-tone', 'ok')

  // Opened at the gate, so the whole run up to it is on the page and the
  // transport is not back at frame 1.
  await expect(branch.locator('.player__count')).toContainText('Frame 15 of 17')
})

test('the other answer is one click away and lands in the same place', async ({ page }) => {
  await page.goto(`posts/${SLUG}/`)
  const branch = page.locator('[data-trace-branch]')
  await branch.scrollIntoViewIfNeeded()
  await branch.locator('[data-decision="skip"]').click()
  await branch.locator('[data-decision="allow"]').click()
  await branch.locator('[data-decision="deny"]').click()

  const approval = branch.locator('[data-frame-type="approval"]')
  await expect(approval).toHaveCount(1)
  await expect(approval).toContainText('write_file was blocked before it ran')
  await expect(approval).toHaveAttribute('data-tone', 'error')
  await expect(branch.locator('.player__count')).toContainText('Frame 15 of 18')
})

test('the denied branch asks again, and ends by handing over a shell command', async ({
  page,
}) => {
  await page.goto(`posts/${SLUG}/`)
  const branch = page.locator('[data-trace-branch]')
  await branch.scrollIntoViewIfNeeded()
  await branch.locator('[data-decision="skip"]').click()
  await branch.locator('[data-decision="deny"]').click()

  const next = branch.locator('[data-action="next"]')
  for (let i = 0; i < 3; i += 1) await next.click()

  await expect(branch.locator('[data-frame-type="approval"]')).toHaveCount(2)
  await expect(branch.locator('.transcript')).toContainText(
    "mkdir -p notes && cat > notes/ports.md <<'EOF'",
  )
})

test.describe('in dark mode', () => {
  test.use({ colorScheme: 'dark' })

  /*
   * Checked here rather than by eye. The approval frame is the first new frame
   * type since post 7, it carries the `ok` and `error` tones, and those tones
   * are the ones a reader has to tell apart to know which answer they gave —
   * so the two labels must not render in the same ink, in either scheme.
   */
  test('the two answers are drawn in different ink, and the page is dark', async ({
    page,
  }) => {
    await page.goto(`posts/${SLUG}/`)
    const branch = page.locator('[data-trace-branch]')
    await branch.scrollIntoViewIfNeeded()
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 30, 45)')

    await branch.locator('[data-decision="skip"]').click()
    await branch.locator('[data-decision="allow"]').click()
    const allowed = await branch
      .locator('[data-frame-type="approval"] .frame__label')
      .evaluate((node) => getComputedStyle(node).color)

    await branch.locator('[data-decision="deny"]').click()
    const denied = await branch
      .locator('[data-frame-type="approval"] .frame__label')
      .evaluate((node) => getComputedStyle(node).color)

    expect(allowed).not.toBe(denied)
    // The pressed answer is drawn solid and the other dashed, so the switch
    // reads with no colour vision at all.
    await expect(branch.locator('[data-decision="deny"]')).toHaveCSS(
      'border-style',
      'solid',
    )
    await expect(branch.locator('[data-decision="allow"]')).toHaveCSS(
      'border-style',
      'dashed',
    )
  })
})

test.describe('at phone width', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('stepping either branch never produces a pixel of horizontal scroll', async ({
    page,
  }) => {
    await page.goto(`posts/${SLUG}/`)
    const branch = page.locator('[data-trace-branch]')
    await branch.scrollIntoViewIfNeeded()

    const overflow = async () =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )

    expect(await overflow()).toBe(0)
    await branch.locator('[data-decision="skip"]').click()
    expect(await overflow()).toBe(0)

    for (const decision of ['allow', 'deny']) {
      await branch.locator(`[data-decision="${decision}"]`).click()
      const next = branch.locator('[data-action="next"]')
      // Step to the end of whichever branch is showing.
      for (;;) {
        expect(await overflow()).toBe(0)
        if (await next.isDisabled()) break
        await next.click()
      }
      // "Back to the question" puts the prefix player back at its last
      // frame, so the answers are live again with no second skip.
      await branch.locator('[data-decision="rewind"]').click()
      expect(await overflow()).toBe(0)
    }
  })
})
