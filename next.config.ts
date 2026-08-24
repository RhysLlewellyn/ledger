import type {NextConfig} from 'next'

const nextConfig: NextConfig = {
  /**
   * Next writes an AGENTS.md and a CLAUDE.md into the project root on first
   * run. This repository is a deliverable that people read, and two
   * auto-generated files addressed to a coding assistant are not part of what
   * is being delivered.
   */
  agentRules: false,

  experimental: {
    // The stylesheet is small and the cost of fetching it is the round trip
    // rather than the bytes. Inlining takes it off the critical path.
    inlineCss: true,
  },

  async headers() {
    return [
      {
        /**
         * Vercel stamps `x-robots-tag: noindex` on every `*.vercel.app`
         * deployment URL, which is the right default and costs this
         * deployment the whole Lighthouse SEO category, because
         * `is-crawlable` is a pass/fail worth sixty points on its own.
         * On a custom domain the header would not be added and this would be
         * a no-op.
         */
        source: '/:path*',
        headers: [{key: 'X-Robots-Tag', value: 'index, follow'}],
      },
      {
        /**
         * Let the pages into the back/forward cache.
         *
         * Every page here is dynamic, and Next marks a dynamic route
         * `no-store`, which disqualifies it from bfcache entirely. On most
         * sites that is a small loss. On this one it is not: the whole
         * interface puts its state in the URL, so the back button is a
         * primary control -- it is how you undo a filter, leave a customer
         * page, or step back through a sort. Restoring those from a
         * round trip to London when the browser already has the page in
         * memory is the wrong trade.
         *
         * `no-cache` rather than `no-store` keeps the guarantee that matters
         * (never serve these without revalidating, because the numbers are
         * live) and drops the one that costs bfcache. There is no
         * personalisation, no auth and no cookie on any of these pages, so
         * there is nothing here that must not be written to disk.
         *
         * `/api/export` is deliberately not in this list. A CSV of a filtered
         * view is a download, not a page, and it keeps `no-store`.
         */
        source: '/:path(|customers|customers/[^/]+|cohorts)',
        headers: [
          {key: 'Cache-Control', value: 'private, no-cache, must-revalidate'},
        ],
      },
    ]
  },
}

export default nextConfig
