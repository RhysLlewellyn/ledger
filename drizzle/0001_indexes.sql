CREATE INDEX "customer_signed_up_idx" ON "customer" USING btree ("signed_up_at");--> statement-breakpoint
CREATE INDEX "event_customer_occurred_idx" ON "event" USING btree ("customer_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "mrr_movement_occurred_on_idx" ON "mrr_movement" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX "mrr_movement_customer_idx" ON "mrr_movement" USING btree ("customer_id","occurred_on");--> statement-breakpoint
CREATE INDEX "subscription_customer_started_idx" ON "subscription" USING btree ("customer_id","started_at" DESC NULLS LAST);