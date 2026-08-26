import type {MetadataRoute} from 'next'

/**
 * The pages are for crawling; the CSV export is not. Every hit on
 * `/api/export` streams the whole filtered table out of Postgres, and a
 * crawler following that link from 4,000 customer pages is how the database's
 * monthly transfer allowance disappeared in a week.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {userAgent: '*', allow: '/', disallow: ['/api/']},
  }
}
