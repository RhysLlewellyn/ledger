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
 * It is the only `'use client'` file in the build, and it is one because React
 * error boundaries are client components by construction — there is no server
 * equivalent. It holds no state and reads nothing from the browser; the whole
 * of its client-side behaviour is the reset button. Next still renders it on
 * the server for an error thrown during SSR, so with JavaScript switched off
 * the message and the link below both work and only the button is inert. That
 * is why there is a link as well as a button.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & {digest?: string}
  reset: () => void
}) {
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
        <button
          type="button"
          onClick={reset}
          className="inline-block border border-(--color-field) px-3 py-1 underline-offset-4 hover:underline"
        >
          Try again
        </button>
        <a href="/" className="inline-block py-1 underline underline-offset-4">
          Back to the overview →
        </a>
      </p>
    </>
  )
}
