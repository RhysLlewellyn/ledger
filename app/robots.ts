import type {MetadataRoute} from 'next'

/**
 * The pages are for crawling; the CSV export and the filter permutations are
 * not. Every hit on `/api/export` streams the whole filtered table out of
 * Postgres, and `/customers?plan=…&country=…&sort=…&page=…` is an unbounded
 * URL space that a crawler will walk forever. Both are what took the
 * database through its monthly transfer allowance on 26 August 2026.
 *
 * `/customers` itself and every `/customers/[slug]` stay open. The crawl
 * delay is advisory (Bing honours it, Google does not) and costs nothing.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/customers?'],
      crawlDelay: 10,
    },
  }
}
