/**
 * The site is served from `/nine-commits`, so every internal link and asset
 * has to go through `BASE_URL`. A hardcoded `/favicon.ico` works in dev and
 * 404s in production, which is exactly the class of bug that only shows up
 * after deploy — so the join lives in one place rather than at each call
 * site, and normalises the duplicate slash that `BASE_URL`'s trailing slash
 * otherwise produces.
 */
const BASE: string = import.meta.env.BASE_URL

function join(path: string): string {
  return `${BASE}/${path}`.replace(/\/{2,}/g, '/')
}

/** A file under `site/public`, e.g. `asset('favicon.svg')`. */
export function asset(path: string): string {
  return join(path)
}

/** An internal page, always with a trailing slash. */
export function href(path: string): string {
  const url = join(path)
  return url.endsWith('/') ? url : `${url}/`
}

/** The site root. */
export const home: string = href('')
