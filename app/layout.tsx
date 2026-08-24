import type {Metadata} from 'next'
import Link from 'next/link'

import './globals.css'

export const metadata: Metadata = {
  title: {default: 'Ledger', template: '%s — Ledger'},
  description:
    'Subscription billing analytics for an invented SaaS: MRR, movements, cohort ' +
    'retention and four thousand customers, over two complete years.',
}

const NAV = [
  {href: '/', label: 'Overview'},
  {href: '/customers', label: 'Customers'},
  {href: '/cohorts', label: 'Cohorts'},
]

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en-GB">
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
            <Link href="/" className="text-sm tracking-[0.2em] uppercase">
              Ledger
            </Link>
            <nav aria-label="Sections">
              <ul className="flex gap-6 text-sm">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-ink)"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </header>

          <main id="main" className="py-10">
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
      </body>
    </html>
  )
}
