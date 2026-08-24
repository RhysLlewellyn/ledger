import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Ledger is a subscription billing analytics product for an invented SaaS.
 * Everything on every screen is an aggregate over these six tables, and the
 * point of the build is that those aggregates stay fast at volume: ~4,000
 * customers, ~9,000 MRR movements and a quarter of a million events.
 *
 * Two conventions run through the whole schema.
 *
 * Money is integer pence, signed. Never a float, never a numeric that some
 * driver hands back as a string for some other code to parse. A contraction
 * is a negative number rather than a positive number with a flag, so a
 * month's net movement is a sum() and not a case expression.
 *
 * Instants are `timestamptz`; calendar days are `date`. The distinction is
 * load-bearing. `event.occurred_at` is an instant — a thing happened at a
 * point in time. `mrr_movement.occurred_on` is a day, because billing runs on
 * a calendar and "which month did this churn land in?" must not depend on the
 * reader's timezone. Storing that as a timestamp is how a January number
 * becomes a December number for anybody east of UTC.
 */

/** Cheap to add to, and the seed leans on the order for its channel mix. */
export const acquisitionChannel = pgEnum('acquisition_channel', [
  'organic',
  'paid_search',
  'referral',
  'outbound',
  'partner',
])

export const subscriptionStatus = pgEnum('subscription_status', [
  'active',
  'cancelled',
  'paused',
])

/**
 * The five things that can happen to recurring revenue. Every headline number
 * in this product is a sum over `mrr_movement` sliced by this enum.
 *
 * `reactivation` is deliberately its own kind rather than a second `new`. A
 * returning customer and a first-time one are the same money and very
 * different news, and a cohort chart that cannot tell them apart will quietly
 * flatter a bad month.
 */
export const movementKind = pgEnum('movement_kind', [
  'new',
  'expansion',
  'contraction',
  'churn',
  'reactivation',
])

export const plan = pgTable(
  'plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Pence, per seat, per month. */
    monthlyPricePence: integer('monthly_price_pence').notNull(),
    /**
     * A retired plan still has customers on it and still appears in two years
     * of history, so this is a soft delete rather than a row that goes away.
     */
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('plan_slug_key').on(t.slug)],
)

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** ISO 3166-1 alpha-2, so the country filter is an equality. */
    country: text('country').notNull(),
    signedUpAt: timestamp('signed_up_at', {withTimezone: true, mode: 'date'}).notNull(),
    /**
     * Null while they are a customer. Set when the last subscription ends and
     * cleared again on reactivation — which is why the cohort query derives
     * retention from `subscription` and `mrr_movement` rather than from this
     * column. It exists so the customer table can answer "churned?" without a
     * join, and for no stronger reason than that.
     */
    churnedAt: timestamp('churned_at', {withTimezone: true, mode: 'date'}),
    acquisitionChannel: acquisitionChannel('acquisition_channel').notNull(),
  },
  (t) => [
    uniqueIndex('customer_slug_key').on(t.slug),
    /**
     * The signed-up date range filter, and the default sort on the customer
     * table.
     *
     * There is deliberately no index on `country` or `acquisition_channel`.
     * Both are low-cardinality columns on a four-thousand-row table, where a
     * sequential scan is genuinely the cheaper plan and Postgres will pick it
     * whatever is declared here. An index that the planner ignores still costs
     * a write on every insert — it is not free just because it is unused.
     */
    index('customer_signed_up_idx').on(t.signedUpAt),
  ],
)

export const subscription = pgTable(
  'subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, {onDelete: 'cascade'}),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plan.id),
    startedAt: timestamp('started_at', {withTimezone: true, mode: 'date'}).notNull(),
    /** Null means running. */
    endedAt: timestamp('ended_at', {withTimezone: true, mode: 'date'}),
    seats: integer('seats').notNull(),
    status: subscriptionStatus('status').notNull(),
  },
  (t) => [
    /**
     * "Which plan is this customer on?" is `distinct on (customer_id) … order
     * by customer_id, started_at desc`, because a plan change ends one
     * subscription and starts another on the same day. Without this index that
     * is a sort of every subscription in the business on every page of the
     * customer table; with it, it is a scan in the order the query already
     * wanted.
     */
    index('subscription_customer_started_idx').on(t.customerId, t.startedAt.desc()),
  ],
)

/**
 * The spine. Every headline number is a sum over this table; nothing is stored
 * pre-computed except `daily_rollup`, which is derived from it and can be
 * rebuilt from it at any time.
 *
 * One row is one signed change to recurring revenue on one day. MRR at any
 * instant is the running total of every row up to that day — which is why
 * there is no `mrr` column anywhere in this schema. A stored balance is a
 * second source of truth, and the first thing that happens to a second source
 * of truth is that it stops agreeing with the first.
 */
export const mrrMovement = pgTable(
  'mrr_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, {onDelete: 'cascade'}),
    occurredOn: date('occurred_on', {mode: 'string'}).notNull(),
    kind: movementKind('kind').notNull(),
    /**
     * Signed pence. `new`, `expansion` and `reactivation` are positive;
     * `contraction` and `churn` are negative. The sign is not decoration —
     * sum(amount_pence) over any window is that window's net movement, with no
     * case expression and no chance of a sign convention diverging between two
     * queries that ought to agree.
     */
    amountPence: integer('amount_pence').notNull(),
  },
  (t) => [
    /**
     * The MRR series reads a date range off this table twice — once for the
     * balance carried into the window, once for the days inside it.
     */
    index('mrr_movement_occurred_on_idx').on(t.occurredOn),
    /** One account's revenue history, on its own page. */
    index('mrr_movement_customer_idx').on(t.customerId, t.occurredOn),
  ],
)

/**
 * The volume table. A quarter of a million rows across 24 months, and the
 * reason the customer detail page needs an index rather than good intentions.
 *
 * `metadata` is jsonb because product events genuinely have no fixed shape.
 * Nothing on any screen queries inside it; if something did it would want a
 * GIN index, and that is a different build.
 */
export const event = pgTable(
  'event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, {onDelete: 'cascade'}),
    occurredAt: timestamp('occurred_at', {withTimezone: true, mode: 'date'}).notNull(),
    kind: text('kind').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    /**
     * The index that matters most in this repository.
     *
     * Two queries read this table by account: the fifty-row event feed on a
     * customer page, and the lateral join that decorates each row of the
     * customer table with a last-seen timestamp. Both are a handful of rows
     * out of a quarter of a million, and without this index both are a
     * sequential scan of all of them — fifty sequential scans, in the second
     * case, one per row on the page.
     *
     * The descending second column is not decoration. The feed is
     * `order by occurred_at desc limit 50`, and a matching index order is the
     * difference between reading fifty rows and reading every row for that
     * customer and sorting them.
     */
    index('event_customer_occurred_idx').on(t.customerId, t.occurredAt.desc()),
  ],
)

/**
 * The one pre-computed table, and it earns its place rather than existing
 * because rollups are what dashboards have.
 *
 * The overview asks for a daily MRR series over 24 months. Computed honestly
 * that is a running total over every movement ever recorded, re-summed for
 * each of 730 days — a window function over the whole spine on every request.
 * It is fast enough at this volume and it is the wrong shape: the cost grows
 * with the life of the business, and the answer for a day in the past cannot
 * change once that day is over.
 *
 * So: one row per day, maintained on write, and rebuildable from scratch. The
 * unique index on `day` is what makes that maintenance an upsert.
 */
export const dailyRollup = pgTable(
  'daily_rollup',
  {
    day: date('day', {mode: 'string'}).primaryKey(),
    /** Running total to the end of this day, not the day's own movement. */
    mrrPence: integer('mrr_pence').notNull(),
    activeCustomers: integer('active_customers').notNull(),
    newCount: integer('new_count').notNull(),
    churnCount: integer('churn_count').notNull(),
  },
  (t) => [uniqueIndex('daily_rollup_day_key').on(t.day)],
)
