'use client'

/**
 * The backstop, for anything the four routes did not catch themselves.
 *
 * Each page already wraps its own queries and renders `Unavailable` when
 * Postgres does not answer, which is the failure this deployment actually has.
 * This is for the rest: a bug in a component, a shape of data nobody expected,
 * anything that would otherwise reach the framework's own handler and put
 * "Application error: a server-side exception has occurred" on the screen.
 *
 * **This file only ever runs in a browser with JavaScript enabled, and the
 * comment here used to claim the opposite.** It said Next server-renders the
 * boundary for an error thrown during SSR, so the message and the link would
 * work with scripting off and only the button would be inert. That was wrong,
 * and it was wrong in the direction that flatters the build.
 *
 * Measured, against a route made to throw on the server:
 *
 * - The response is **200**, and none of the text below is in it. No "Something
 *   went wrong", no "Try again", no digest. The error crosses as an RSC error
 *   payload — `E{"digest":"..."}` in the flight stream — for the client to act
 *   on.
 * - With scripting **on**, React unwraps that payload and renders this. Works
 *   as intended.
 * - With scripting **off**, nothing unwraps it. The reader is left on the
 *   streamed `loading.tsx` fallback: ruled paper, `aria-busy="true"`, and a
 *   `role="status"` announcing "Loading the figures." — for figures that are
 *   never coming.
 *
 * That last case is a real defect and it is not this file's to fix. What
 * protects a reader without JavaScript is each route catching its own failure
 * and server-rendering `Unavailable`, which is why that exists and why every
 * route uses it. This is the layer below, and the honest description of it is a
 * backstop for readers who have JavaScript, not a fallback for readers who do
 * not.
 *
 * `'use client'` is here because Next requires it of `error.tsx`, not because
 * the file needs a browser. There is no state, nothing read from `window`, and
 * since the retry became a link there is no handler either.
 *
 * The retry is that link, and it is `href=""` — which resolves to the current
 * URL, query string and all, dropping only the fragment. `reset()` re-renders
 * the same tree that just threw, on the same server payload, so it tends to
 * throw again; a link re-requests the page and gets a fresh server render,
 * which is what actually recovers a transient failure. `Unavailable` already
 * made this argument for the case it handles — "a link back to the current
 * address is exactly what a retry is, and it is honest about being a reload" —
 * and there is no reason for this build to hold two different opinions about
 * what a retry is.
 *
 * The second link is not a retry. When the fault is in the build rather than in
 * the request, retrying cannot help, and a way out is the only control that
 * still does anything.
 */
export default function Error({error}: {error: Error & {digest?: string}}) {
  return (
    <>
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="mt-4 max-w-prose text-sm">
        This page could not be rendered. It is a fault in the build rather than anything you
        did, and nothing has been changed or lost — every page here is read-only.
      </p>
      {error.digest && (
        // The digest is the server-side hash of the real error. It is the only
        // thing that connects what the reader saw to what the logs recorded,
        // and it costs one line to show it rather than making them describe
        // the page to somebody.
        <p className="mt-4 text-sm text-(--color-muted)">
          Reference <span data-numeric>{error.digest}</span>
        </p>
      )}
      <p className="mt-6 flex flex-wrap gap-6 text-sm">
        <a href="" className="inline-block py-1 underline underline-offset-4">
          Try again
        </a>
        <a href="/" className="inline-block py-1 underline underline-offset-4">
          Back to the overview →
        </a>
      </p>
    </>
  )
}
