import type {Metadata} from 'next'
import {Analytics} from '@vercel/analytics/next'
import {IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif} from 'next/font/google'
import './globals.css'

/**
 * Three faces from one superfamily, and a narrow weight selection.
 *
 * IBM Plex was drawn for technical documentation and data, its mono has
 * genuine tabular figures, and the three cut together — which matters here
 * because a table row mixes all three on one baseline. It is also not the face
 * every generated interface arrives wearing.
 *
 * Four files: serif at 600 for headings, sans at 400 and 600 for text,
 * mono at 400 for every number. `next/font` self-hosts them, so there is no
 * request to a third party on the critical path, and it generates a
 * metric-matched fallback so swapping the face in costs no layout shift. CLS
 * is one of the numbers this build is judged on, and a webfont is the usual
 * way to lose it.
 */
const serif = IBM_Plex_Serif({
  subsets: ['latin'],
  weight: ['600'],
  display: 'swap',
  variable: '--font-serif',
})

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
  variable: '--font-sans',
})

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-mono',
})

import {SectionNav} from './nav.tsx'

export const metadata: Metadata = {
  title: {default: 'Ledger', template: '%s — Ledger'},
  description:
    'Subscription billing analytics for an invented SaaS: MRR, movements, cohort ' +
    'retention and four thousand customers, over two complete years.',
}

export default function RootLayout({children}: {children: React.ReactNode}) {

  return (
    <html lang="en-GB" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        {/*
          The first thing in the tab order, visible only once it has focus.
          Nine sortable column headings and six filter fieldsets sit between
          the top of a page and its table, and without this a keyboard user
          walks all of them on every navigation.
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus:border focus:border-(--color-ink) focus:bg-(--color-paper) focus:px-3 focus:py-2"
        >
          Skip to content
        </a>

        <div className="mx-auto max-w-6xl px-6">
          <header className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-(--color-ink) py-4">
            <a href="/" className="inline-block py-1 text-sm tracking-[0.2em] uppercase">
              Ledger
            </a>
            <SectionNav />
          </header>

          {/*
            tabIndex={-1} is what makes the skip link work. Without it <main>
            is not focusable, so the browser scrolls to it and leaves focus at
            the top of the document -- the next Tab goes back to the second
            item in the header and the link has done nothing for the person it
            exists for. The sweep caught this on all seven pages.
          */}
          <main id="main" tabIndex={-1} className="py-10 focus-visible:outline-none">
            {children}
          </main>

          <footer className="border-t border-(--color-rule-2) py-6 text-xs text-(--color-ink-2)">
            <p className="max-w-prose">
              Ledger is an invented subscription business. The four thousand companies, their
              plans and their billing history are generated data, and none of them exist. It
              is a demonstration build, not a real product and not client work.
            </p>
          </footer>
        </div>
        <Analytics />
      </body>
    </html>
  )
}
