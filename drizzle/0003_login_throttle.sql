CREATE TABLE "login_throttle" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "login_throttle_attempts_positive" CHECK ("login_throttle"."attempts" > 0)
);
--> statement-breakpoint
CREATE INDEX "login_throttle_window_idx" ON "login_throttle" USING btree ("window_started_at");