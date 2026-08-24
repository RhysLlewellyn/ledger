# Ledger

A subscription billing analytics dashboard for an invented SaaS. Four thousand
customers, two complete years of billing history, a quarter of a million product
events, and a claim that it stays fast and stays usable at that volume.

**Live:** https://ledger-rhys-llewellyn1.vercel.app

Ledger is not a real company and none of the four thousand customers exist. It is
one of my own demo builds, not client work, and nothing on the site is a photograph
or a generated image.

Next.js 16 (App Router) · TypeScript · Postgres · Drizzle with migrations checked in
· Tailwind v4 · Vitest · no charting library.

> **Status: in progress.** The data layer is finished and measured — the sections on
> query performance below are complete and every number in them was produced by
> `npm run measure`. The interface, the Lighthouse run and the accessibility pass are
> the rest of the build, and this notice comes out when they are done.

---

## Query performance

Every demo in this portfolio has one hard thing. Ledger's is that it stays fast
with real data, so this is the section worth reading.

### The dataset

`npm run seed` builds it in about fourteen seconds:

| | |
|---|---:|
| Customers | 4,000 |
| Subscriptions | 4,531 |
| MRR movements | 8,985 |
| Product events | 258,751 |
| Days of daily rollup | 1,275 |

Two complete years of report window (August 2024 to July 2026) on top of eighteen
months of prior history, so the MRR line starts from a going concern rather than
from the origin.

The generator is a pure function and nothing on the seed path reads
`Math.random()`, `Date.now()` or the system clock — one mulberry32 stream, one fixed
seed, and even the UUIDs come out of it. That is not tidiness. Every timing below is
a claim about one specific dataset, and a test asserts thresholds against the same
rows; if `npm run seed` produced a different dataset each time, a failing performance
test would be indistinguishable from an unlucky one.

It is also not uniform, because uniform data hides the bugs that matter. Acquisition
grows at a rate that decays from about 5.5% a month to a little over 1%, so the MRR
line bends instead of accelerating away. Signups are seasonal — B2B software sells in
September and January and does not sell in August or late December. The channel mix
shifts from word of mouth towards paid search and outbound as the invented company
grows, and paid search churns roughly three times as fast as a referral, which is why
the cohort grid has a shape to read. Churn hazard decays with tenure and bumps on each
annual renewal, because that is when somebody looks at the invoice. A retired
`legacy-pro` plan is closed to new business after the thirteenth month and still has
customers on it two years later.

### The method

`npm run measure -- <label>` writes `docs/measurements/<label>.md`. Nothing in this
section is typed by hand.

One connection, so every run sees the same backend and the same buffer cache. A
warm-up run that is discarded, then a set of timed runs reported as median and p95;
the sample size adapts to how slow the query turned out to be and **the table prints
what it was**, because a run count that quietly differed between the before and the
after would be a way to cheat the comparison. `explain (analyze, buffers)` is captured
separately from the timing, because `explain analyze` carries its own instrumentation
overhead and its "Execution Time" is not what a user waits for.

The before-and-after pair below is local Postgres 17 in Docker with 256MB of shared
buffers and 768MB of `effective_cache_size` — deliberately a small server. The third
table is the deployment's own database.

### Reading the tables

Two time columns, and against a remote database the gap between them is the point.

**Server** is planning plus execution inside Postgres, out of `explain (analyze)`.
It carries that statement's own per-node instrumentation overhead, so it is an upper
bound on the database's cost rather than the cost itself — which is why a few rows
below show a server figure slightly *above* the wall clock beside it.

**Median / p95** is wall clock from the machine running the harness: the database, plus
the round trip to it, plus the driver. It is what a caller actually waited.

### Before: no indexes beyond the primary keys

The first migration deliberately creates nothing but primary keys and two slug uniques.
An unindexed schema can only be measured before the indexes exist. Local Postgres, so
the network term is nil.

| Query | Server | Median | p95 | Scans |
|---|---:|---:|---:|---|
| `mrr-series (from movements)` | 1.25 s | 999.5 ms | 1.05 s | Seq Scan on subscription, Seq Scan on mrr_movement |
| `mrr-series (from rollup)` | 2.9 ms | 4.4 ms | 5.2 ms | Seq Scan on daily_rollup, Seq Scan on mrr_movement |
| `mrr-series (correlated subquery)` | 648.0 ms | 442.3 ms | 458.2 ms | Seq Scan on mrr_movement |
| `cohort-retention` | 71.8 ms | 64.1 ms | 70.2 ms | Seq Scan on customer, Seq Scan on subscription |
| `customer-table (page 1, unfiltered)` | 516.2 ms | 546.2 ms | 570.6 ms | **Seq Scan on event**, + 3 others |
| `customer-table (page 12, four filters)` | 541.0 ms | 568.5 ms | 579.8 ms | **Seq Scan on event**, + 3 others |
| `customer-table (sorted by last seen)` | 36.60 s | **33.72 s** | — | **Seq Scan on event**, + 3 others |
| `customer-events` | 30.5 ms | 31.0 ms | 38.2 ms | **Seq Scan on event** |

### After: five indexes

| Query | Server | Median | p95 | Change |
|---|---:|---:|---:|---:|
| `customer-table (sorted by last seen)` | 83.1 ms | 63.5 ms | 74.9 ms | **531×** |
| `customer-table (page 12, four filters)` | 20.5 ms | 13.9 ms | 18.9 ms | **41×** |
| `customer-table (page 1, unfiltered)` | 18.9 ms | 17.4 ms | 20.8 ms | **31×** |
| `customer-events` | 0.3 ms | 1.8 ms | 3.1 ms | **17×** |
| `mrr-series (correlated subquery)` | 484.3 ms | 280.0 ms | 333.4 ms | 1.6× |
| `cohort-retention` | 69.2 ms | 63.8 ms | 73.0 ms | — |
| `mrr-series (from rollup)` | 2.6 ms | 4.6 ms | 6.0 ms | — |
| `mrr-series (from movements)` | 1.25 s | 990.7 ms | 1.01 s | — |

The last four rows are the honest part of this table: three of them did not improve.

`cohort-retention` and the two series queries are not index-bound. The cohort grid's
cost is a cross join of every cohort against every month offset — CPU over a few
thousand rows, and no index changes it. Where the before and after differ by a few
milliseconds on those rows, that is run-to-run variance on a laptop, and it is left in
the table rather than quietly re-run until it looked tidier.

`mrr-series (correlated subquery)` is the shape you get from writing the obvious
subquery: for each of 730 days, re-sum every movement up to that day. An index takes it
from 442 ms to 280 ms, which is the least interesting improvement here, because the
problem with it is not the scan — it is quadratic in the life of the business. The
window-function version is `mrr-series (from movements)`, and it does the same
arithmetic over the money in single-digit milliseconds. Nothing renders from the
correlated version; it is kept as a measured baseline so this section can put a number
on a claim instead of asserting it.

### And on the deployment: Neon, London

Everything above is a laptop. This is the database the live site actually reads —
Neon on AWS `eu-west-2`, free tier, with the Vercel functions pinned to `lhr1` in
`vercel.json` so both halves are in the same city.

| Query | Server | Median | p95 |
|---|---:|---:|---:|
| `mrr-series (from rollup)` | 3.5 ms | 34.3 ms | 37.9 ms |
| `cohort-retention` | 83.2 ms | 94.3 ms | 100.6 ms |
| `customer-table (page 1, unfiltered)` | 19.5 ms | 44.0 ms | 48.1 ms |
| `customer-table (page 12, four filters)` | 16.3 ms | 40.2 ms | 42.2 ms |
| `customer-table (sorted by last seen)` | 80.3 ms | 83.6 ms | 87.3 ms |
| `customer-events` | 0.6 ms | 28.6 ms | 30.8 ms |

The two columns come apart here, and `customer-events` is the clearest case: 0.6 ms
inside Postgres, 28.6 ms measured from my desk. Twenty-eight of those milliseconds are
the round trip from a domestic connection to London and back. The deployed function
does not pay them — it is in the same region as the database — which is the entire
reason `vercel.json` pins the region. A function in Washington reading this database
would add roughly eighty milliseconds to every row in that table, and the 100 ms p95
target would be gone before Postgres had done any work.

Neon's free tier suspends compute after five minutes idle, so the first request after a
quiet period pays a cold start of several hundred milliseconds. That is a property of
the tier, not of the queries, and any Lighthouse number quoted here will say whether it
was measured warm.

### The one that mattered: `event (customer_id, occurred_at desc)`

A customer page shows the last fifty things that happened to one account. Before:

```
Limit  (actual time=23.788..30.352 rows=50 loops=1)
  Buffers: shared hit=3419
  ->  Gather Merge  (Workers Launched: 2)
        ->  Sort  (Sort Key: occurred_at DESC, id)
              ->  Parallel Seq Scan on event e  (actual time=0.006..4.180 rows=103 loops=3)
                    Filter: (customer_id = '090dd5f5-…'::uuid)
                    Rows Removed by Filter: 86148
Execution Time: 30.402 ms
```

Three workers between them read every one of 258,751 rows and threw away 258,443 of
them. After:

```
Limit  (actual time=0.231..0.236 rows=50 loops=1)
  Buffers: shared hit=300
  ->  Sort  (Sort Key: occurred_at DESC, id)
        ->  Bitmap Heap Scan on event e  (actual time=0.052..0.177 rows=308 loops=1)
              ->  Bitmap Index Scan on event_customer_occurred_idx  (actual time=0.034..0.034)
                    Index Cond: (customer_id = '090dd5f5-…'::uuid)
                    Buffers: shared hit=5
Execution Time: 0.295 ms
```

3,419 buffers to 300, of which the index itself is five. 30.4 ms to 0.3 ms. The descending second column is
not decoration: the query is `order by occurred_at desc limit 50`, and a matching
index order is the difference between reading fifty rows and reading every row for
that account and sorting them.

There is deliberately **no** index on `customer.country` or
`customer.acquisition_channel`, both of which are filters on the customer table. They
are low-cardinality columns on a four-thousand-row table, where a sequential scan
genuinely is the cheaper plan and the planner will pick it whatever the schema
declares. An index the planner ignores still costs a write on every insert; it is not
free just because it is unused.

### Filter and paginate first, decorate afterwards

This is the shape that produced the 699× row, and it is a design decision rather than
an index.

A page of the customer table is fifty rows, and each row carries a last-seen timestamp
and an event count out of the quarter-of-a-million-row `event` table. The obvious query
joins that aggregate in alongside everything else and lets `limit 50` throw away 98.75%
of the work at the very end. It reads well and it is correct.

Here the filtering, sorting and pagination happen first, against `customer`,
`subscription` and a small aggregate over the movement spine, and the lateral join that
touches `event` runs afterwards — fifty times, against an index, instead of once against
the whole table.

The exception is sorting by last seen, which cannot happen after the rows are chosen
because it is what chooses them. That one sort pays for a full aggregate over `event`;
every other sort does not. It is measured separately in both tables above for exactly
that reason, and at 47 ms it is still the slowest thing a page here does.

### What `daily_rollup` is actually for

The rollup is a cache over the movement spine. It is never the source of any number, it
can be dropped at any time, and `refreshRollup()` rebuilds it from scratch in one
statement.

At this volume it does **not** earn its place on the money. Nine thousand movements is
nothing, and the window-function version of the MRR series computes the running total in
about six milliseconds. If that were all the overview needed, the honest answer would be
to delete the table.

It earns its place on the active-customer count. A customer is active on a day if any of
their subscriptions spans it, so computing that honestly means checking every
subscription against every day in the window and counting distinct customers:
999 ms against 4.4 ms, which is 227× and is the whole gap between the two series
queries in the tables above. That is what the column is for.

Both implementations are kept and a test asserts they return identical rows across all
730 days — not spot-checked at the ends. A cache whose agreement with its source is
never checked is a cache that will be wrong one day, silently, in a way a customer
notices first.

The table is maintained on write by two triggers, because its columns have two
different sources. Money and the new/churn counts come from `mrr_movement`; a movement
on day D changes the running total on D and every day after it, which in a live system
is one row and when backfilling a year is expensive in proportion to how much of the
past was changed. `active_customers` cannot be derived from a movement at all — a
paused account that stops paying is a different fact from an account that has gone — so
a second trigger recounts it across the days a subscription spans. That one is a
recount rather than a delta because a customer can hold two subscriptions at once (a
plan change ends one and starts another on the same day), and
`count(distinct customer_id)` cannot be maintained by adding and subtracting ones.

The seed disables both triggers for the bulk load and rebuilds afterwards, which is
what a loader does.

### The test that guards it

Performance that isn't tested is performance that regresses. `performance.test.ts`
asserts two different kinds of thing, because each catches what the other cannot.

**A plan assertion.** Every dashboard query is run through `explain (analyze)` and
checked for a sequential scan of `event`. That is the regression that actually happens:
somebody drops an index, or adds a column that turns an index-only scan into a heap
fetch, or writes a filter the index cannot serve. A plan assertion is a claim about the
*shape* of the work, so it means the same thing on a laptop, on a build server and on
the free tier of Neon. It is the assertion that matters.

**A wall-clock ceiling**, at roughly five times the measured p95, and deliberately
loose. The point is not to pin a millisecond figure to hardware nobody else has; it is
to fail when a query goes from tens of milliseconds to tens of seconds, which is what
every regression here has actually looked like. The unindexed customer table took 32
seconds and its ceiling is 400 ms. Nothing in between is ambiguous.

Against the spec's target of every dashboard query under 100 ms at p95, on this machine:

```
  ✓     4.8 ms  overview: MRR series from the rollup
  ✓    66.2 ms  cohorts: retention grid
  ✓    19.6 ms  customers: page 1, unfiltered
  ✓    17.9 ms  customers: page 12, four filters
  ✓    50.2 ms  customers: sorted by last seen
  ✓     1.8 ms  customer: event feed
```

The cohort grid is the one with the least headroom, and it is CPU rather than IO. On
Neon it is 83 ms inside Postgres against a 100 ms budget, which is close enough that
it is the next thing to fix rather than a thing that is fixed. The answer when it comes
will not be another index: it will be to stop expanding every cohort against every
month offset in SQL and compute the grid from a single pass over subscription
intervals.

---

## Why there is no chart library

Recharts is the default reach. It brings its own look, its own DOM, and accessibility
behaviour you do not control.

The charts here are a line with movement bars beneath it, a stacked bar series, and a
cohort grid. All three are straightforward in SVG, all three are lighter than the
library that would draw them, and — the part that decided it — all three need keyboard
and screen-reader behaviour that has to be designed rather than inherited. Every chart
sits in a `<figure>` with a `<figcaption>` that states the finding in words, carries
`role="img"` and an `aria-label` summarising the shape with its internals
`aria-hidden`, and offers a "view as table" toggle to the underlying numbers in a real
`<table>`. That last one is not a fallback. It is a first-class view, and it is the
path somebody using a screen reader will take.

None of that is hard to add to a chart library. All of it is hard to add *correctly* to
a chart library, because the DOM it produces is not yours.

---

## Running it

```bash
npm install
cp .env.example .env          # DATABASE_URL
npm run db:up                 # Postgres 17 in Docker, on 5434
npm run db:migrate
npm run seed                  # deterministic, ~14s, 258,751 events
npm run dev                   # http://localhost:3003
```

```bash
npm test                      # 42 tests; most of them need the database
npm run measure -- before     # writes docs/measurements/before.md
```

The tests that need Postgres skip loudly rather than failing when there is no container
running, naming what went unproven — and `CI=1` turns the skip off entirely, because on
a build server an unreachable database is a broken pipeline rather than a local
convenience.
