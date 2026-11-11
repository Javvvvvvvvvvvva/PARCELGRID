CREATE TYPE "public"."building_type" AS ENUM('officetel', 'urban-housing', 'retail', 'coliving', 'office', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'feasibility', 'permitting', 'construction', 'selling', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('ok', 'low', 'med', 'high');--> statement-breakpoint
CREATE TABLE "assumption_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"field" text NOT NULL,
	"base_value" numeric(18, 4) NOT NULL,
	"override_value" numeric(18, 4) NOT NULL,
	"reason" text,
	"evidence_url" text,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"ordinal" bigint NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"actor_organization" text NOT NULL,
	"actor_email" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"payload" jsonb,
	"payload_hash" text NOT NULL,
	"previous_hash" text NOT NULL,
	"entry_hash" text NOT NULL,
	"event_version" text DEFAULT 'audit-chain-2026.1' NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"txn_date" timestamp with time zone NOT NULL,
	"address" text NOT NULL,
	"type" text NOT NULL,
	"area_sqm" numeric(12, 2) NOT NULL,
	"gfa_sqm" numeric(12, 2),
	"price_manwon" numeric(14, 0) NOT NULL,
	"price_per_pyeong_manwon" numeric(10, 0),
	"far_pct" numeric(6, 2),
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parcel_id" text NOT NULL,
	"address" text NOT NULL,
	"address_road" text,
	"lat" numeric(10, 7),
	"lng" numeric(10, 7),
	"lot_area_sqm" numeric(12, 2) NOT NULL,
	"zoning" text NOT NULL,
	"zone_code" text NOT NULL,
	"max_far" numeric(6, 2) NOT NULL,
	"max_bcr" numeric(6, 2) NOT NULL,
	"height_limit_m" numeric(6, 2) NOT NULL,
	"setback_json" jsonb NOT NULL,
	"land_price_won" numeric(14, 0),
	"est_market_price_won" numeric(14, 0),
	"acquired_at" timestamp with time zone,
	"acquired_price_manwon" numeric(14, 0),
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"pdf_url" text,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"level" "risk_level" NOT NULL,
	"finding" text NOT NULL,
	"reference" text,
	"headroom_json" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tag" text,
	"building_type" "building_type" NOT NULL,
	"far" numeric(6, 2) NOT NULL,
	"bcr" numeric(6, 2) NOT NULL,
	"floors_above" integer NOT NULL,
	"floors_below" integer NOT NULL,
	"program_json" jsonb NOT NULL,
	"assumptions_json" jsonb NOT NULL,
	"result_json" jsonb,
	"profit_manwon" numeric(14, 0),
	"profit_margin_pct" numeric(6, 2),
	"irr_pct" numeric(6, 2),
	"dscr" numeric(6, 2),
	"compliance_score" integer,
	"is_recommended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"image" text,
	"role" text DEFAULT 'viewer' NOT NULL,
	"reviewer_roles_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assumption_overrides" ADD CONSTRAINT "assumption_overrides_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumption_overrides" ADD CONSTRAINT "assumption_overrides_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comps" ADD CONSTRAINT "comps_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_findings" ADD CONSTRAINT "risk_findings_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "overrides_scenario_idx" ON "assumption_overrides" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_org_ordinal_idx" ON "audit_log" USING btree ("org_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_entry_hash_idx" ON "audit_log" USING btree ("entry_hash");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "comps_org_idx" ON "comps" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comps_external_idx" ON "comps" USING btree ("org_id","external_id");--> statement-breakpoint
CREATE INDEX "comps_geo_idx" ON "comps" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "projects_status_idx" ON "projects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_parcel_idx" ON "projects" USING btree ("org_id","parcel_id");--> statement-breakpoint
CREATE INDEX "reports_project_idx" ON "reports" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_version_idx" ON "reports" USING btree ("project_id","version");--> statement-breakpoint
CREATE INDEX "risks_scenario_idx" ON "risk_findings" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "scenarios_project_idx" ON "scenarios" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_code_idx" ON "scenarios" USING btree ("project_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."parcelgrid_reject_immutable_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'PGRD_IMMUTABLE_LEDGER: % is append-only', TG_TABLE_NAME
		USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "audit_log_reject_update_delete"
BEFORE UPDATE OR DELETE ON "audit_log"
FOR EACH ROW EXECUTE FUNCTION "public"."parcelgrid_reject_immutable_mutation"();--> statement-breakpoint
CREATE TRIGGER "audit_log_reject_truncate"
BEFORE TRUNCATE ON "audit_log"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."parcelgrid_reject_immutable_mutation"();--> statement-breakpoint
CREATE TRIGGER "assumption_overrides_reject_update_delete"
BEFORE UPDATE OR DELETE ON "assumption_overrides"
FOR EACH ROW EXECUTE FUNCTION "public"."parcelgrid_reject_immutable_mutation"();--> statement-breakpoint
CREATE TRIGGER "assumption_overrides_reject_truncate"
BEFORE TRUNCATE ON "assumption_overrides"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."parcelgrid_reject_immutable_mutation"();
