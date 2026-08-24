import type {NextRequest} from 'next/server'

import {getSql} from '@/db/index.ts'
import {csvRow, customerExport, EXPORT_COLUMNS} from '@/metrics/export.ts'
import {activeFilterCount, parseCustomerParams} from '@/metrics/params.ts'

/**
 * The current filtered view as CSV.
 *
 * It reads the same query string the page does, through the same parser, so
 * the file and the screen can never disagree about what "the current view"
 * means. That is the reason the export link is just the page's own URL with a
 * different path — there is no separate export state to keep in step.
 *
 * It streams. Four thousand rows is only a few hundred kilobytes and buffering
 * them would work, but the cost of buffering is that the whole result set sits
 * in the function's memory at once and the download does not begin until the
 * last row has been read. A cursor and a `ReadableStream` mean the first bytes
 * leave while Postgres is still reading, memory stays flat whatever the row
 * count, and the same code is still correct if this table grows by two orders
 * of magnitude.
 */
export const dynamic = 'force-dynamic'

const CURSOR_ROWS = 500

export async function GET(request: NextRequest) {
  const raw = Object.fromEntries(request.nextUrl.searchParams)
  const params: Record<string, string | string[]> = {...raw}
  // `Object.fromEntries` keeps only the last value of a repeated parameter,
  // and every multi-select filter here is repeated. Put the arrays back.
  for (const key of ['plan', 'status', 'country', 'channel']) {
    const all = request.nextUrl.searchParams.getAll(key)
    if (all.length > 0) params[key] = all
  }

  const options = parseCustomerParams(params)
  const query = customerExport(options)
  const sql = getSql()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      controller.enqueue(encoder.encode(csvRow(EXPORT_COLUMNS)))

      try {
        const cursor = sql
          .unsafe(query.text, query.params as never[])
          .cursor(CURSOR_ROWS) as unknown as AsyncIterable<Record<string, unknown>[]>

        for await (const batch of cursor) {
          let chunk = ''
          for (const row of batch) chunk += csvRow(EXPORT_COLUMNS.map((c) => row[c]))
          controller.enqueue(encoder.encode(chunk))
        }
        controller.close()
      } catch (error) {
        // The headers are long gone by the time this can happen, so there is
        // no status code left to change. Erroring the stream truncates the
        // download rather than completing it with missing rows, which is the
        // honest failure: a short file that failed is recoverable, a complete
        // file that is quietly incomplete is not.
        controller.error(error)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename(options)}"`,
      // The rows are computed per request from live data; a cached CSV would
      // hand somebody yesterday's answer to today's filter.
      'cache-control': 'no-store',
    },
  })
}

function filename(options: ReturnType<typeof parseCustomerParams>): string {
  const applied = activeFilterCount(options)
  return applied === 0
    ? 'ledger-customers.csv'
    : `ledger-customers-${applied}-filter${applied === 1 ? '' : 's'}.csv`
}
