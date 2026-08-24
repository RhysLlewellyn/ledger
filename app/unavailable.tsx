/**
 * What every page shows when Postgres does not answer.
 *
 * This existed twice, written out by hand in `page.tsx` and `cohorts/page.tsx`,
 * and not at all in the two routes most likely to be opened from a link. Two
 * copies of a message is how the third route ends up without one.
 *
 * It keeps the page's own heading rather than replacing the screen with a
 * generic error. A reader who followed a link to Customers should still be
 * looking at a page called Customers; losing that as well as the data turns a
 * slow database into a wrong address.
 *
 * The retry is a plain link to the same URL. There is no client JavaScript in
 * this build to re-run a fetch with, and there does not need to be — a link
 * back to the current address is exactly what a retry is, it works with
 * JavaScript switched off, and it is honest about being a reload.
 */
export function Unavailable({title, retry}: {title: string; retry: string}) {
  return (
    <>
      <h1 className="text-2xl">{title}</h1>
      <p className="mt-4 max-w-prose text-sm">
        The database is not answering at the moment, so the figures are not shown. This
        deployment runs on a free tier that suspends its compute when idle, and waking it
        takes a few seconds.
      </p>
      <p className="mt-4 text-sm">
        <a href={retry} className="inline-block py-1 underline underline-offset-4">
          Try again
        </a>
      </p>
    </>
  )
}
