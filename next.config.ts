import type {NextConfig} from 'next'

const nextConfig: NextConfig = {
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
    ]
  },
}

export default nextConfig
