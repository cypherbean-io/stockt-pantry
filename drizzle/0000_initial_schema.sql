CREATE TYPE "public"."dimension" AS ENUM('mass', 'volume', 'count');--> statement-breakpoint
CREATE TABLE "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"density_g_per_ml" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_household_name_unique" UNIQUE("household_id","name"),
	CONSTRAINT "ingredient_household_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "ingredient_density_positive" CHECK ("ingredient"."density_g_per_ml" > 0 AND "ingredient"."density_g_per_ml" < 'Infinity'::float8)
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "pantry_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" double precision NOT NULL,
	"unit_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pantry_item_household_ingredient_unique" UNIQUE("household_id","ingredient_id"),
	CONSTRAINT "pantry_item_quantity_positive" CHECK ("pantry_item"."quantity" > 0 AND "pantry_item"."quantity" < 'Infinity'::float8)
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_servings" integer NOT NULL,
	"steps" text[] DEFAULT '{}' NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_household_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "recipe_base_servings_positive" CHECK ("recipe"."base_servings" > 0)
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"quantity" double precision NOT NULL,
	"unit_id" text NOT NULL,
	CONSTRAINT "recipe_ingredient_recipe_ingredient_unique" UNIQUE("recipe_id","ingredient_id"),
	CONSTRAINT "recipe_ingredient_quantity_positive" CHECK ("recipe_ingredient"."quantity" > 0 AND "recipe_ingredient"."quantity" < 'Infinity'::float8)
);
--> statement-breakpoint
CREATE TABLE "unit" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dimension" "dimension" NOT NULL,
	"to_base" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"household_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_household_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "user_email_lowercase" CHECK ("user"."email" = lower("user"."email"))
);
--> statement-breakpoint
ALTER TABLE "ingredient" ADD CONSTRAINT "ingredient_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_household_created_by_fk" FOREIGN KEY ("household_id","created_by") REFERENCES "public"."user"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_item" ADD CONSTRAINT "pantry_item_household_ingredient_fk" FOREIGN KEY ("household_id","ingredient_id") REFERENCES "public"."ingredient"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_household_recipe_fk" FOREIGN KEY ("household_id","recipe_id") REFERENCES "public"."recipe"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredient" ADD CONSTRAINT "recipe_ingredient_household_ingredient_fk" FOREIGN KEY ("household_id","ingredient_id") REFERENCES "public"."ingredient"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invite_household_idx" ON "invite" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredient_household_recipe_idx" ON "recipe_ingredient" USING btree ("household_id","recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_ingredient_household_ingredient_idx" ON "recipe_ingredient" USING btree ("household_id","ingredient_id");--> statement-breakpoint
CREATE INDEX "user_household_idx" ON "user" USING btree ("household_id");