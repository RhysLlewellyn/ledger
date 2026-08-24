import {
  addDays,
  daysInMonth,
  intBetween,
  isoDay,
  monthIndex,
  monthStart,
  mulberry32,
  normal,
  poisson,
  uuid,
  utc,
  weighted,
  type Rng,
} from './rng.ts'

/**
 * The dataset generator.
 *
 * This file is pure. It opens no connection, reads no clock and writes
 * nothing — `generate()` takes a seed and returns rows. `seed.ts` is the only
 * thing that talks to Postgres.
 *
 * That split is worth the extra file. The interesting properties of this
 * dataset are properties of the *data*, not of the insert: that the churn
 * curve decays rather than being flat, that cohorts genuinely differ, that
 * every movement reconciles to the subscription that caused it. Those can be
 * asserted in a unit test in milliseconds, against arrays, with no database
 * anywhere near them — and they are, in `generate.test.ts`.
 *
 * What is being modelled is an invented SaaS observed over two complete
 * years. None of the companies exist.
 */

/* ------------------------------------------------------------ the window */

/**
 * The report period is fixed, and the dashboard says so.
 *
 * The alternative is anchoring the data to `now()` so the demo always looks
 * current. That would make the dataset different on every run, which costs
 * the reproducibility that §4 of the README depends on, and it would put
 * today's date in a dataset that is entirely invented. A printed analytical
 * report carries an as-at date; so does this one.
 */
export const AS_AT = utc(2026, 7, 31)
export const WINDOW_START = utc(2024, 8, 1)

/**
 * Eighteen months of history before the window opens, so that the series
 * starts from a going concern rather than from zero. A dashboard whose MRR
 * line begins at the origin is a dashboard nobody has ever had to read.
 */
export const HISTORY_START = utc(2023, 2, 1)

export const TOTAL_CUSTOMERS = 4_000
export const SEED = 20_260_824

const FIRST_MONTH = monthIndex(HISTORY_START)
const LAST_MONTH = monthIndex(AS_AT)
const WINDOW_FIRST_MONTH = monthIndex(WINDOW_START)
const MONTH_COUNT = LAST_MONTH - FIRST_MONTH + 1

/**
 * Signups are not flat. B2B software sells in September and January, and does
 * not sell in August or the second half of December. Without this the cohort
 * grid has 42 identical rows and proves nothing.
 */
const SEASONALITY = [1.16, 1.12, 1.1, 1.0, 0.94, 0.88, 0.78, 0.74, 1.22, 1.2, 1.04, 0.68]

/**
 * Month-on-month growth in acquisition, before seasonality — and it decays.
 *
 * A constant growth rate compounded over 42 months produces the hockey stick
 * that only ever appears in a pitch deck. Real acquisition slows as the
 * obvious market fills up, so the rate tapers from roughly 5.5% a month at the
 * start to a little over 1% by the end. The difference is visible on the
 * chart: the MRR line bends rather than accelerating away, and the
 * month-on-month growth figure on the overview falls over the window even
 * though revenue rises throughout. That is the more interesting thing for a
 * dashboard to have to show.
 */
const GROWTH_EARLY = 1.055
const GROWTH_LATE = 1.012

/* ------------------------------------------------------------------ plans */

export type PlanSeed = {
  id: string
  name: string
  slug: string
  monthlyPricePence: number
  active: boolean
  /** Ordering for upgrades. Not a column — the tier is implied by price. */
  tier: number
  seatsMean: number
  seatsSd: number
  seatsMin: number
  seatsMax: number
  /** Multiplier on the churn hazard. Bigger accounts leave more slowly. */
  churnFactor: number
}

/**
 * Five plans, one of them retired.
 *
 * `legacy-pro` is closed to new business from the thirteenth month and still
 * has customers on it two years later, which is what a real price list looks
 * like. It is also the reason `plan.active` exists: the plan filter on
 * `/customers` has to offer it, because customers are on it, while the
 * marketing site would not.
 */
export const PLANS: readonly PlanSeed[] = [
  {
    id: '9e3b1a70-0000-4000-8000-000000000001',
    name: 'Starter',
    slug: 'starter',
    monthlyPricePence: 1_900,
    active: true,
    tier: 1,
    seatsMean: 2.1,
    seatsSd: 1.1,
    seatsMin: 1,
    seatsMax: 5,
    churnFactor: 1.38,
  },
  {
    id: '9e3b1a70-0000-4000-8000-000000000002',
    name: 'Team',
    slug: 'team',
    monthlyPricePence: 4_500,
    active: true,
    tier: 2,
    seatsMean: 8,
    seatsSd: 4,
    seatsMin: 3,
    seatsMax: 24,
    churnFactor: 1.0,
  },
  {
    id: '9e3b1a70-0000-4000-8000-000000000003',
    name: 'Pro (legacy)',
    slug: 'legacy-pro',
    monthlyPricePence: 5_900,
    active: false,
    tier: 3,
    seatsMean: 9,
    seatsSd: 4,
    seatsMin: 3,
    seatsMax: 30,
    churnFactor: 1.12,
  },
  {
    id: '9e3b1a70-0000-4000-8000-000000000004',
    name: 'Business',
    slug: 'business',
    monthlyPricePence: 8_900,
    active: true,
    tier: 4,
    seatsMean: 16,
    seatsSd: 8,
    seatsMin: 8,
    seatsMax: 60,
    churnFactor: 0.7,
  },
  {
    id: '9e3b1a70-0000-4000-8000-000000000005',
    name: 'Enterprise',
    slug: 'enterprise',
    monthlyPricePence: 11_900,
    active: true,
    tier: 5,
    seatsMean: 38,
    seatsSd: 20,
    seatsMin: 20,
    seatsMax: 160,
    churnFactor: 0.52,
  },
]

const PLAN_BY_SLUG = new Map(PLANS.map((p) => [p.slug, p]))

/** The month `legacy-pro` stopped being sold, as an offset from FIRST_MONTH. */
const LEGACY_CLOSED_FROM = 13

/* --------------------------------------------------------------- channels */

export type Channel = 'organic' | 'paid_search' | 'referral' | 'outbound' | 'partner'

/**
 * The acquisition mix shifts as the invented company grows: it starts on
 * word of mouth and ends up buying traffic and running a sales team. That
 * shift is most of why the cohort grid has a shape — paid search churns
 * roughly two and a half times as fast as a referral, so a later cohort that
 * is half paid search retains worse at month three and the grid shows it.
 */
const CHANNEL_MIX_EARLY: readonly (readonly [Channel, number])[] = [
  ['organic', 30],
  ['referral', 28],
  ['paid_search', 12],
  ['outbound', 8],
  ['partner', 6],
]
const CHANNEL_MIX_LATE: readonly (readonly [Channel, number])[] = [
  ['organic', 20],
  ['referral', 14],
  ['paid_search', 30],
  ['outbound', 24],
  ['partner', 12],
]

/** Monthly churn hazard in the first month after signup, before decay. */
const CHANNEL_BASE_HAZARD: Record<Channel, number> = {
  organic: 0.044,
  paid_search: 0.078,
  referral: 0.026,
  outbound: 0.056,
  partner: 0.029,
}

const CHANNEL_PLAN_BIAS: Record<Channel, readonly (readonly [string, number])[]> = {
  organic: [
    ['starter', 44],
    ['team', 34],
    ['legacy-pro', 8],
    ['business', 12],
    ['enterprise', 2],
  ],
  paid_search: [
    ['starter', 58],
    ['team', 30],
    ['legacy-pro', 4],
    ['business', 7],
    ['enterprise', 1],
  ],
  referral: [
    ['starter', 30],
    ['team', 38],
    ['legacy-pro', 8],
    ['business', 20],
    ['enterprise', 4],
  ],
  outbound: [
    ['starter', 12],
    ['team', 32],
    ['legacy-pro', 4],
    ['business', 38],
    ['enterprise', 12],
  ],
  partner: [
    ['starter', 14],
    ['team', 32],
    ['legacy-pro', 6],
    ['business', 34],
    ['enterprise', 11],
  ],
}

const COUNTRIES: readonly (readonly [string, number])[] = [
  ['GB', 38],
  ['US', 22],
  ['IE', 7],
  ['DE', 7],
  ['NL', 5],
  ['FR', 5],
  ['ES', 3],
  ['SE', 3],
  ['AU', 5],
  ['CA', 5],
]

/* ------------------------------------------------------------------ names */

const NAME_A = [
  'Harlow', 'Northgate', 'Brightwater', 'Kestrel', 'Ardent', 'Beacon', 'Calder',
  'Dunmore', 'Everly', 'Fenwick', 'Glenmoor', 'Hartley', 'Ironbridge', 'Juniper',
  'Kingsford', 'Larkfield', 'Marchmont', 'Netherby', 'Oakhurst', 'Pentland',
  'Quarry', 'Redgrave', 'Stanmore', 'Thornbury', 'Uplands', 'Verity', 'Westmere',
  'Yarrow', 'Ashcombe', 'Blackthorn', 'Cranleigh', 'Dovedale', 'Eastwick',
  'Fairhaven', 'Greystone', 'Holloway', 'Inverness', 'Kelsington', 'Lyndhurst',
  'Mereside', 'Norwood', 'Orchardleigh', 'Pinewood', 'Ravensworth', 'Sandbourne',
  'Tallow', 'Ullswater', 'Vale', 'Wardley', 'Ferrers',
]

const NAME_B = [
  'Analytics', 'Logistics', 'Partners', 'Systems', 'Interactive', 'Instruments',
  'Foundry', 'Collective', 'Works', 'Studio', 'Group', 'Laboratories', 'Provisions',
  'Textiles', 'Freight', 'Chemicals', 'Diagnostics', 'Publishing', 'Robotics',
  'Surveying', 'Bindery', 'Joinery', 'Aggregates', 'Fabrication', 'Consulting',
  'Bureau', 'Registry', 'Assurance', 'Holdings', 'Supply',
]

const NAME_SUFFIX = ['Ltd', 'Ltd', 'Ltd', 'plc', 'LLP', 'GmbH', 'BV', 'Inc', 'AB', 'Pty']

/* ------------------------------------------------------------------ types */

export type CustomerSeed = {
  id: string
  name: string
  slug: string
  country: string
  signedUpAt: Date
  churnedAt: Date | null
  acquisitionChannel: Channel
}

export type SubscriptionSeed = {
  id: string
  customerId: string
  planId: string
  startedAt: Date
  endedAt: Date | null
  seats: number
  status: 'active' | 'cancelled' | 'paused'
}

export type MovementSeed = {
  id: string
  customerId: string
  occurredOn: string
  kind: 'new' | 'expansion' | 'contraction' | 'churn' | 'reactivation'
  amountPence: number
}

export type EventSeed = {
  id: string
  customerId: string
  occurredAt: Date
  kind: string
  metadata: Record<string, unknown>
}

export type Dataset = {
  plans: readonly PlanSeed[]
  customers: CustomerSeed[]
  subscriptions: SubscriptionSeed[]
  movements: MovementSeed[]
  events: EventSeed[]
}

/* -------------------------------------------------------------- event mix */

const EVENT_KINDS: readonly (readonly [string, number])[] = [
  ['session.started', 44],
  ['report.viewed', 20],
  ['integration.synced', 13],
  ['api.request', 9],
  ['report.exported', 6],
  ['invoice.paid', 3.6],
  ['seat.added', 1.6],
  ['support.ticket.opened', 1.6],
  ['invoice.payment_failed', 1.2],
]

/**
 * Events per active customer-month, before the per-account and tenure terms.
 * Tuned so the seed clears the quarter of a million the spec asks for without
 * being so far past it that the seed takes a coffee break.
 */
const EVENT_INTENSITY = 1.78

/* ------------------------------------------------------------------- main */

export function generate(seed: number = SEED): Dataset {
  const rng = mulberry32(seed)

  const customers: CustomerSeed[] = []
  const subscriptions: SubscriptionSeed[] = []
  const movements: MovementSeed[] = []
  const events: EventSeed[] = []

  const usedSlugs = new Set<string>()
  const signupCounts = allocateSignups(rng)

  for (let offset = 0; offset < MONTH_COUNT; offset += 1) {
    const month = FIRST_MONTH + offset
    for (let n = 0; n < signupCounts[offset]!; n += 1) {
      buildCustomer({
        rng,
        month,
        offset,
        usedSlugs,
        customers,
        subscriptions,
        movements,
        events,
      })
    }
  }

  // Chronological order throughout. Nothing depends on it — every query sorts
  // for itself — but a seed that inserts in time order leaves the heap roughly
  // correlated with `occurred_on`, which is the state a real append-only table
  // would be in, and therefore the honest one to measure against.
  movements.sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0))
  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())

  return {plans: PLANS, customers, subscriptions, movements, events}
}

/**
 * How many customers sign up in each month, by largest remainder so the total
 * is exactly TOTAL_CUSTOMERS rather than approximately it.
 */
function allocateSignups(rng: Rng): number[] {
  const weights: number[] = []
  let level = 1
  for (let offset = 0; offset < MONTH_COUNT; offset += 1) {
    const calendarMonth = (FIRST_MONTH + offset) % 12
    // A little noise, so the acquisition line is not a smooth curve. Real
    // months are lumpy and a suspiciously smooth one reads as generated.
    const jitter = 0.86 + rng() * 0.28
    weights.push(level * SEASONALITY[calendarMonth]! * jitter)
    const t = offset / (MONTH_COUNT - 1)
    level *= GROWTH_EARLY + (GROWTH_LATE - GROWTH_EARLY) * t
  }

  const total = weights.reduce((a, b) => a + b, 0)
  const exact = weights.map((w) => (w / total) * TOTAL_CUSTOMERS)
  const counts = exact.map(Math.floor)
  let remaining = TOTAL_CUSTOMERS - counts.reduce((a, b) => a + b, 0)

  const order = exact
    .map((value, index) => ({index, fraction: value - Math.floor(value)}))
    .sort((a, b) => b.fraction - a.fraction)

  for (const {index} of order) {
    if (remaining <= 0) break
    counts[index] += 1
    remaining -= 1
  }
  return counts
}

type BuildContext = {
  rng: Rng
  month: number
  offset: number
  usedSlugs: Set<string>
  customers: CustomerSeed[]
  subscriptions: SubscriptionSeed[]
  movements: MovementSeed[]
  events: EventSeed[]
}

function buildCustomer(ctx: BuildContext): void {
  const {rng, month, offset} = ctx

  const signedUpAt = dayInMonth(rng, month)
  const channel = weighted(rng, blendChannelMix(offset))
  const plan = choosePlan(rng, channel, offset)
  const seats = drawSeats(rng, plan)

  const customerId = uuid(rng)
  const {name, slug} = uniqueName(rng, ctx.usedSlugs)

  const customer: CustomerSeed = {
    id: customerId,
    name,
    slug,
    country: weighted(rng, COUNTRIES),
    signedUpAt,
    churnedAt: null,
    acquisitionChannel: channel,
  }
  ctx.customers.push(customer)

  ctx.movements.push({
    id: uuid(rng),
    customerId,
    occurredOn: isoDay(signedUpAt),
    kind: 'new',
    amountPence: plan.monthlyPricePence * seats,
  })

  // Later cohorts churn a little less: the invented product got better, and a
  // cohort grid where every row is the same curve is a grid with nothing to
  // read. Capped so the effect is a trend, not a cliff.
  const cohortQuality = 1 - Math.min(offset, 36) * 0.0042

  const life = runLifecycle(ctx, {
    customerId,
    channel,
    cohortQuality,
    plan,
    seats,
    startedAt: signedUpAt,
    isReactivation: false,
  })

  // One shot at coming back. Reactivation is rare, and much less rare for
  // somebody who paused rather than cancelled outright.
  if (life.endedAt) {
    const pausedBonus = life.status === 'paused' ? 2.4 : 1
    if (rng() < 0.055 * pausedBonus) {
      const gap = intBetween(rng, 2, 9)
      const returnAt = addDays(life.endedAt, gap * 30 + intBetween(rng, 0, 20))
      if (returnAt < AS_AT) {
        const returnSeats = Math.max(
          plan.seatsMin,
          Math.round(life.seats * (0.6 + rng() * 0.5)),
        )
        ctx.movements.push({
          id: uuid(rng),
          customerId,
          occurredOn: isoDay(returnAt),
          kind: 'reactivation',
          amountPence: life.plan.monthlyPricePence * returnSeats,
        })
        const second = runLifecycle(ctx, {
          customerId,
          channel,
          cohortQuality,
          plan: life.plan,
          seats: returnSeats,
          startedAt: returnAt,
          isReactivation: true,
        })
        customer.churnedAt = second.endedAt
        return
      }
    }
    customer.churnedAt = life.endedAt
  }
}

type LifecycleInput = {
  customerId: string
  channel: Channel
  cohortQuality: number
  plan: PlanSeed
  seats: number
  startedAt: Date
  isReactivation: boolean
}

type LifecycleResult = {
  endedAt: Date | null
  status: 'active' | 'cancelled' | 'paused'
  plan: PlanSeed
  seats: number
}

/**
 * One continuous run of a customer being a customer, month by month.
 *
 * The hazard decays with tenure — the month after signup is by far the most
 * dangerous one and the risk falls away from there — with a bump on each
 * annual renewal, because that is when somebody actually looks at the invoice.
 * A flat monthly probability produces an exponential retention curve that no
 * subscription business has ever had.
 */
function runLifecycle(ctx: BuildContext, input: LifecycleInput): LifecycleResult {
  const {rng} = ctx
  const {customerId, channel, cohortQuality, startedAt} = input

  let plan = input.plan
  let seats = input.seats
  let subscriptionStart = startedAt
  let subscriptionId = uuid(rng)

  const baseHazard =
    CHANNEL_BASE_HAZARD[channel] * cohortQuality * (input.isReactivation ? 1.25 : 1)

  const startMonth = monthIndex(startedAt)
  let endedAt: Date | null = null
  let status: 'active' | 'cancelled' | 'paused' = 'active'

  // The month somebody signs up is the busiest month they will ever have.
  emitEvents(ctx, customerId, startMonth, seats, plan, 1)

  for (let month = startMonth + 1; month <= LAST_MONTH; month += 1) {
    const tenure = month - startMonth
    const decayed = Math.max(baseHazard * 0.9 ** (tenure - 1), baseHazard * 0.2)
    const anniversary = tenure % 12 === 0 ? 2.1 : 1
    const hazard = decayed * plan.churnFactor * anniversary

    if (rng() < hazard) {
      const churnedOn = dayInMonth(rng, month)
      status = rng() < 0.17 ? 'paused' : 'cancelled'
      endedAt = churnedOn
      ctx.movements.push({
        id: uuid(rng),
        customerId,
        occurredOn: isoDay(churnedOn),
        kind: 'churn',
        amountPence: -(plan.monthlyPricePence * seats),
      })
      break
    }

    emitEvents(ctx, customerId, month, seats, plan, tenure)

    // Expansion is the second-largest line on the movement chart in any
    // healthy subscription business, and the one a dashboard built from a
    // signups table cannot show at all.
    const expansionChance = 0.055 * (plan.tier >= 4 ? 1.5 : 1) * (tenure <= 18 ? 1.2 : 0.75)
    if (rng() < expansionChance) {
      // The next tier up that is still being sold. Somebody on the retired
      // `legacy-pro` upgrades to Business, not to a plan the company no longer
      // has a price for.
      const next = PLANS.find((p) => p.tier > plan.tier && p.active)
      if (next && rng() < 0.16) {
        const changedOn = dayInMonth(rng, month)
        const before = plan.monthlyPricePence * seats
        const nextSeats = Math.max(next.seatsMin, seats)
        // A plan change is a subscription ending and another starting on the
        // same day. That is how billing systems model it, and it is why
        // `subscription` is not one row per customer.
        ctx.subscriptions.push({
          id: subscriptionId,
          customerId,
          planId: plan.id,
          startedAt: subscriptionStart,
          endedAt: changedOn,
          seats,
          status: 'cancelled',
        })
        plan = next
        seats = nextSeats
        subscriptionStart = changedOn
        subscriptionId = uuid(rng)
        ctx.movements.push({
          id: uuid(rng),
          customerId,
          occurredOn: isoDay(changedOn),
          kind: 'expansion',
          amountPence: plan.monthlyPricePence * seats - before,
        })
      } else {
        const added = Math.max(1, Math.round(seats * (0.1 + rng() * 0.35)))
        if (seats + added <= plan.seatsMax) {
          seats += added
          ctx.movements.push({
            id: uuid(rng),
            customerId,
            occurredOn: isoDay(dayInMonth(rng, month)),
            kind: 'expansion',
            amountPence: plan.monthlyPricePence * added,
          })
        }
      }
    } else if (rng() < 0.017 && seats > plan.seatsMin) {
      const removed = Math.max(1, Math.round(seats * (0.08 + rng() * 0.22)))
      const actual = Math.min(removed, seats - plan.seatsMin)
      seats -= actual
      ctx.movements.push({
        id: uuid(rng),
        customerId,
        occurredOn: isoDay(dayInMonth(rng, month)),
        kind: 'contraction',
        amountPence: -(plan.monthlyPricePence * actual),
      })
    }
  }

  ctx.subscriptions.push({
    id: subscriptionId,
    customerId,
    planId: plan.id,
    startedAt: subscriptionStart,
    endedAt,
    seats,
    status: endedAt ? status : 'active',
  })

  return {endedAt, status, plan, seats}
}

/**
 * Product usage for one active customer-month.
 *
 * Only months inside the report window produce events. Everything before
 * August 2024 is history the dashboard never reads, and generating a hundred
 * thousand rows nothing queries would inflate the volume table without
 * inflating anything the volume claim is about.
 */
function emitEvents(
  ctx: BuildContext,
  customerId: string,
  month: number,
  seats: number,
  plan: PlanSeed,
  tenure: number,
): void {
  if (month < WINDOW_FIRST_MONTH) return

  const {rng} = ctx
  const calendarMonth = month % 12
  // Bigger accounts are busier, but sub-linearly: a sixty-seat account does
  // not generate thirty times a two-seat account's traffic.
  const size = Math.log2(seats + 1)
  // Usage settles after the first few months rather than growing forever.
  const tenureFactor = tenure <= 3 ? 1.25 : tenure <= 12 ? 1 : 0.88
  const mean =
    EVENT_INTENSITY * size * tenureFactor * SEASONALITY[calendarMonth]! * (0.6 + rng() * 0.9)

  const count = poisson(rng, Math.max(mean, 0.2))
  const days = daysInMonth(month)
  const start = monthStart(month)

  for (let i = 0; i < count; i += 1) {
    const occurredAt = businessHours(rng, addDays(start, intBetween(rng, 0, days - 1)))
    if (occurredAt > AS_AT) continue
    const kind = weighted(rng, EVENT_KINDS)
    ctx.events.push({
      id: uuid(rng),
      customerId,
      occurredAt,
      kind,
      metadata: eventMetadata(rng, kind, plan, seats),
    })
  }
}

function eventMetadata(
  rng: Rng,
  kind: string,
  plan: PlanSeed,
  seats: number,
): Record<string, unknown> {
  switch (kind) {
    case 'report.viewed':
    case 'report.exported':
      return {report: weighted(rng, [['mrr', 5], ['cohorts', 3], ['churn', 3], ['revenue', 2]])}
    case 'invoice.paid':
      return {amount_pence: plan.monthlyPricePence * seats, currency: 'GBP'}
    case 'invoice.payment_failed':
      return {amount_pence: plan.monthlyPricePence * seats, reason: 'card_declined'}
    case 'seat.added':
      return {seats}
    case 'integration.synced':
      return {provider: weighted(rng, [['stripe', 6], ['xero', 3], ['quickbooks', 2]])}
    case 'api.request':
      return {path: weighted(rng, [['/v1/mrr', 5], ['/v1/customers', 4], ['/v1/events', 2]])}
    case 'support.ticket.opened':
      return {priority: weighted(rng, [['low', 5], ['normal', 4], ['high', 1]])}
    default:
      return {}
  }
}

/* --------------------------------------------------------------- helpers */

function blendChannelMix(offset: number): (readonly [Channel, number])[] {
  const t = Math.min(offset / (MONTH_COUNT - 1), 1)
  return CHANNEL_MIX_EARLY.map(([channel, early], i) => {
    const late = CHANNEL_MIX_LATE[i]![1]
    return [channel, early + (late - early) * t] as const
  })
}

function choosePlan(rng: Rng, channel: Channel, offset: number): PlanSeed {
  const bias = CHANNEL_PLAN_BIAS[channel].filter(
    ([slug]) => slug !== 'legacy-pro' || offset < LEGACY_CLOSED_FROM,
  )
  return PLAN_BY_SLUG.get(weighted(rng, bias))!
}

function drawSeats(rng: Rng, plan: PlanSeed): number {
  const drawn = Math.round(normal(rng, plan.seatsMean, plan.seatsSd))
  return Math.min(plan.seatsMax, Math.max(plan.seatsMin, drawn))
}

/**
 * A day inside a calendar month, biased towards weekdays and clipped to the
 * as-at date. Business software is not bought on a Sunday.
 */
function dayInMonth(rng: Rng, month: number): Date {
  const days = daysInMonth(month)
  const start = monthStart(month)
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = addDays(start, intBetween(rng, 0, days - 1))
    const weekday = candidate.getUTCDay()
    if (weekday !== 0 && weekday !== 6) return clip(businessHours(rng, candidate))
    if (rng() < 0.12) return clip(businessHours(rng, candidate))
  }
  return clip(businessHours(rng, addDays(start, intBetween(rng, 0, days - 1))))
}

function businessHours(rng: Rng, day: Date): Date {
  const hour = weighted(rng, [
    [8, 3], [9, 8], [10, 11], [11, 11], [12, 7], [13, 8],
    [14, 11], [15, 10], [16, 9], [17, 6], [18, 3], [20, 2], [22, 1],
  ])
  return new Date(day.getTime() + hour * 3_600_000 + intBetween(rng, 0, 59) * 60_000)
}

function clip(date: Date): Date {
  return date > AS_AT ? AS_AT : date
}

function uniqueName(rng: Rng, used: Set<string>): {name: string; slug: string} {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const a = NAME_A[Math.floor(rng() * NAME_A.length)]!
    const b = NAME_B[Math.floor(rng() * NAME_B.length)]!
    const suffix = NAME_SUFFIX[Math.floor(rng() * NAME_SUFFIX.length)]!
    const name = `${a} ${b} ${suffix}`
    const slug = `${a}-${b}-${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    if (!used.has(slug)) {
      used.add(slug)
      return {name, slug}
    }
  }
  // The name space is ~15,000 combinations against 4,000 customers, so this
  // is reached occasionally and is not an error. A numeric disambiguator is
  // what a real registry does with a duplicate company name too.
  let n = 2
  for (;;) {
    const a = NAME_A[Math.floor(rng() * NAME_A.length)]!
    const b = NAME_B[Math.floor(rng() * NAME_B.length)]!
    const slug = `${a}-${b}-${n}`.toLowerCase()
    if (!used.has(slug)) {
      used.add(slug)
      return {name: `${a} ${b} ${n}`, slug}
    }
    n += 1
  }
}
