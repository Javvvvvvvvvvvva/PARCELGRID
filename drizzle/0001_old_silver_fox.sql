CREATE TABLE "project_workspace_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"project_id" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"audit_entry_hash" text NOT NULL,
	"saved_by" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_workspace_versions" ADD CONSTRAINT "project_workspace_versions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workspace_versions" ADD CONSTRAINT "project_workspace_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_project_revision_idx" ON "project_workspace_versions" USING btree ("org_id","project_id","revision");--> statement-breakpoint
CREATE INDEX "workspace_project_latest_idx" ON "project_workspace_versions" USING btree ("org_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "workspace_payload_hash_idx" ON "project_workspace_versions" USING btree ("payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_audit_hash_idx" ON "project_workspace_versions" USING btree ("audit_entry_hash");--> statement-breakpoint
CREATE TRIGGER "project_workspace_versions_reject_update_delete"
BEFORE UPDATE OR DELETE ON "project_workspace_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."parcelgrid_reject_immutable_mutation"();--> statement-breakpoint
CREATE TRIGGER "project_workspace_versions_reject_truncate"
BEFORE TRUNCATE ON "project_workspace_versions"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."parcelgrid_reject_immutable_mutation"();
