import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4321/nine-commits/' },
  webServer: {
    command: 'npm run preview --workspace site -- --port 4321',
    url: 'http://localhost:4321/nine-commits/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Astro 7's `preview` command auto-detects being launched by an agent
    // and silently daemonizes itself in the background, which makes the
    // spawned process exit immediately and Playwright report
    // "Process from config.webServer exited early." Setting this variable
    // disables that auto-detection so the server stays in the foreground,
    // which is what Playwright's process-lifecycle tracking requires.
    env: { ASTRO_PREVIEW_BACKGROUND: '1' },
  },
})
