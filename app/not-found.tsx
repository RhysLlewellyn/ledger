import Link from 'next/link'

/**
 * A real 404.
 *
 * Next ships a default one — an unstyled black-on-white line with no
 * navigation — and it is easy to never see, because you have to guess a URL
 * wrong to find it. It is also the page a stranger is most likely to land on
 * from a stale link, and shipping the framework's placeholder there says the
 * build stopped at the happy path.
 *
 * The two ways to arrive here are a mistyped customer slug and a link to
 * something that has moved, so both routes out are offered by name rather than
 * a single "go home".
 */
export default function NotFound() {
  return (
    <>
      <h1 className="text-2xl">Not found</h1>
      <p className="mt-4 max-w-prose text-sm">
        There is nothing at this address. If you followed a link to a customer, the reference
        may be wrong — customer pages are addressed by a slug like{' '}
        <code className="text-(--color-ink-2)">/customers/harlow-analytics-ltd</code>, and the
        table is the reliable way to reach one.
      </p>
      <ul className="mt-6 flex flex-wrap gap-6 text-sm">
        <li>
          <Link
            href="/customers"
            className="inline-block py-1 underline underline-offset-4"
          >
            Search the customer table →
          </Link>
        </li>
        <li>
          <Link
            href="/"
            className="inline-block py-1 underline underline-offset-4"
          >
            Back to the overview →
          </Link>
        </li>
      </ul>
    </>
  )
}
