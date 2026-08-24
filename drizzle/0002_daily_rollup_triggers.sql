-- daily_rollup, maintained on write.
--
-- The table is a cache over the movement spine and the subscription table. It
-- is never the source of any number; `refreshRollup()` in src/db/rollup.ts
-- rebuilds it from scratch in one statement, and a test asserts that the
-- incrementally-maintained table and the rebuild agree row for row. A cache
-- whose agreement with its source is never checked is a cache that will be
-- wrong one day, silently, in a way a customer notices first.
--
-- Two triggers, because the columns have two different sources.
--
-- `mrr_pence`, `new_count` and `churn_count` come from `mrr_movement`. The
-- money column is a running total, so a movement on day D changes the value on
-- D and on every day after it. In a live system D is today, which is one row;
-- backfilling a year of history is the expensive case and is expensive
-- honestly, in proportion to how much of the past was changed.
--
-- `active_customers` comes from `subscription`, and cannot be derived from a
-- movement at all: a movement is money, and a paused account that stops paying
-- is a different fact from an account that has gone. So a second trigger
-- recomputes that column across the days a subscription actually spans.

--> statement-breakpoint

-- Extends daily_rollup forward to `target`, carrying the previous day's
-- balances into any day that has no row yet.
--
-- Without this a quiet fortnight leaves a fortnight-shaped hole in the series,
-- and a chart drawn from the rows that exist would join 1 August to 15 August
-- with a straight line as though nothing had been measured in between.
CREATE OR REPLACE FUNCTION daily_rollup_extend_to(target date)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  last_day date;
  last_mrr integer;
  last_active integer;
BEGIN
  SELECT day, mrr_pence, active_customers
    INTO last_day, last_mrr, last_active
    FROM daily_rollup
   ORDER BY day DESC
   LIMIT 1;

  IF last_day IS NULL THEN
    INSERT INTO daily_rollup (day, mrr_pence, active_customers, new_count, churn_count)
    VALUES (target, 0, 0, 0, 0)
    ON CONFLICT (day) DO NOTHING;
    RETURN;
  END IF;

  IF target <= last_day THEN
    RETURN;
  END IF;

  INSERT INTO daily_rollup (day, mrr_pence, active_customers, new_count, churn_count)
  SELECT d::date, last_mrr, last_active, 0, 0
    FROM generate_series(last_day + 1, target, interval '1 day') AS d
  ON CONFLICT (day) DO NOTHING;
END;
$$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION daily_rollup_apply_movement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- One statement-shaped body for insert, update and delete: an update is a
  -- delete of the old row plus an insert of the new one, and writing it that
  -- way means the three paths cannot drift apart.
  removed mrr_movement%ROWTYPE;
  added mrr_movement%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    removed := OLD;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    added := NEW;
  END IF;

  IF removed.id IS NOT NULL THEN
    PERFORM daily_rollup_extend_to(removed.occurred_on);
    UPDATE daily_rollup
       SET mrr_pence = mrr_pence - removed.amount_pence
     WHERE day >= removed.occurred_on;
    UPDATE daily_rollup
       SET new_count = new_count - (removed.kind = 'new')::int,
           churn_count = churn_count - (removed.kind = 'churn')::int
     WHERE day = removed.occurred_on;
  END IF;

  IF added.id IS NOT NULL THEN
    PERFORM daily_rollup_extend_to(added.occurred_on);
    UPDATE daily_rollup
       SET mrr_pence = mrr_pence + added.amount_pence
     WHERE day >= added.occurred_on;
    UPDATE daily_rollup
       SET new_count = new_count + (added.kind = 'new')::int,
           churn_count = churn_count + (added.kind = 'churn')::int
     WHERE day = added.occurred_on;
  END IF;

  RETURN NULL;
END;
$$;

--> statement-breakpoint

-- Recomputes active_customers across a range of days.
--
-- This one is a recompute rather than a delta because a customer can hold two
-- subscriptions at once -- a plan change ends one and starts another on the
-- same day -- and `count(distinct customer_id)` cannot be maintained by adding
-- and subtracting ones. Ending a subscription might reduce the count by one or
-- leave it alone, and which of those it is depends on rows the trigger has not
-- been handed.
CREATE OR REPLACE FUNCTION daily_rollup_recount_active(from_day date, to_day date)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE daily_rollup r
     SET active_customers = counted.n
    FROM (
      SELECT d::date AS day,
             (SELECT count(DISTINCT s.customer_id)
                FROM subscription s
               WHERE (s.started_at AT TIME ZONE 'UTC')::date <= d::date
                 AND (s.ended_at IS NULL
                      OR (s.ended_at AT TIME ZONE 'UTC')::date > d::date)) AS n
        FROM generate_series(from_day, to_day, interval '1 day') AS d
    ) counted
   WHERE r.day = counted.day
     AND r.active_customers IS DISTINCT FROM counted.n;
$$;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION daily_rollup_apply_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  first_day date;
  last_day date;
  rollup_end date;
BEGIN
  -- The affected window is the earliest day any version of this row touched,
  -- through to the last day the rollup covers. A subscription that is still
  -- running affects every day from its start onwards, and there is no cheaper
  -- true answer than that.
  SELECT least(
           (CASE WHEN TG_OP <> 'INSERT' THEN (OLD.started_at AT TIME ZONE 'UTC')::date END),
           (CASE WHEN TG_OP <> 'DELETE' THEN (NEW.started_at AT TIME ZONE 'UTC')::date END)
         )
    INTO first_day;

  SELECT day INTO rollup_end FROM daily_rollup ORDER BY day DESC LIMIT 1;
  IF first_day IS NULL OR rollup_end IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM daily_rollup_extend_to(first_day);
  SELECT day INTO rollup_end FROM daily_rollup ORDER BY day DESC LIMIT 1;
  last_day := rollup_end;

  PERFORM daily_rollup_recount_active(first_day, last_day);
  RETURN NULL;
END;
$$;

--> statement-breakpoint

CREATE TRIGGER mrr_movement_rollup
AFTER INSERT OR UPDATE OR DELETE ON mrr_movement
FOR EACH ROW EXECUTE FUNCTION daily_rollup_apply_movement();

--> statement-breakpoint

CREATE TRIGGER subscription_rollup
AFTER INSERT OR UPDATE OR DELETE ON subscription
FOR EACH ROW EXECUTE FUNCTION daily_rollup_apply_subscription();
