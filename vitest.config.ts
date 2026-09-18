import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tools/**/*.test.ts',
      'agent/**/*.test.ts',
      'site/src/lib/**/*.test.ts',
    ],
    environment: 'node',
  },
})
