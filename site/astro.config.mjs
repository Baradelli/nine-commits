// @ts-check
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import preact from '@astrojs/preact'

// https://astro.build/config
export default defineConfig({
  site: 'https://baradelli.github.io',
  base: '/nine-commits',
  integrations: [mdx(), preact()],
  markdown: {
    shikiConfig: {
      // Two quiet themes rather than one, and no default colour. With a
      // default, Shiki inlines `color` and `background-color` on every block,
      // and an inline style beats any class — which is how a black slab ended
      // up in the middle of a light page. `defaultColor: false` makes it emit
      // `--shiki-light` / `--shiki-dark` custom properties instead, so the
      // stylesheet chooses per scheme and the block keeps the site's own
      // `--wash` surface like every other filled surface here.
      themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
      defaultColor: false,
    },
  },
})
