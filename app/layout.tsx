import type {Metadata} from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: {default: 'Ledger', template: '%s — Ledger'},
  description:
    'Subscription billing analytics for an invented SaaS: MRR, movements, cohort ' +
    'retention and four thousand customers, over two complete years.',
}

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  )
}
