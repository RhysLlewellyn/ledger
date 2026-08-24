/**
 * A holding page, so the URL exists from the first day of the build rather
 * than from the last one.
 *
 * It says what is actually here, which at the moment is a measured data layer
 * and no interface. A deployment that showed a skeleton dashboard with no
 * numbers in it would be a worse first impression than an honest paragraph.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-2xl">Ledger</h1>
      <p className="mt-4 max-w-prose text-sm">
        Subscription billing analytics for an invented SaaS. Four thousand customers, two
        complete years of billing history and a quarter of a million product events.
      </p>
      <p className="mt-4 max-w-prose text-sm">
        The data layer is built and measured; the interface is not here yet. The
        query-performance work — the seeded dataset, the plans before and after the
        indexes, and the test that guards them — is written up in the README.
      </p>
    </main>
  )
}
