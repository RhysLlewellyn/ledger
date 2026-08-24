'use client'

import {usePathname} from 'next/navigation'

/**
 * The section nav, with the current section marked.
 *
 * `aria-current="page"` was missing entirely: three links that announce
 * identically and never say which one you are already on. There was no visual
 * current state either, so this failed everybody, not only a screen reader.
 *
 * It is a client component because the pathname is not available to a server
 * layout. That was checked rather than assumed — Next exposes no path header
 * to `headers()`, so there is nothing to read on the server. What makes the
 * cost acceptable is that `usePathname` resolves during server rendering too,
 * so `aria-current` and the rule under the current label are both in the HTML
 * that arrives. Nothing here depends on hydration; with JavaScript off the
 * current section is still marked.
 */
const NAV = [
  {href: '/', label: 'Overview'},
  {href: '/customers', label: 'Customers'},
  {href: '/cohorts', label: 'Cohorts'},
]

export function SectionNav() {
  const pathname = usePathname()

  return (
    <nav aria-label="Sections">
      <ul className="flex gap-6 text-sm">
        {NAV.map((item) => {
          // A customer page is inside Customers. Exact match on "/" only,
          // because every path starts with it.
          const current =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={current ? 'page' : undefined}
                // WCAG 2.2 2.5.8 wants 24x24 of target. A nav link at the
                // text's own height is 18. The current section is underlined
                // rather than coloured, because colour is for data here.
                className={`inline-block py-1 underline-offset-4 hover:underline ${
                  current ? 'underline decoration-2' : ''
                }`}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
