/**
 * PARCELGRID database schema (PostgreSQL via Drizzle ORM).
 *
 * Design principles:
 *   1. Append-only audit trail. Investment committee reports must be
 *      reproducible: a report cited in 2025 must produce the same numbers
 *      if re-run in 2030. We achieve this with versioned scenarios +
 *      assumption snapshots stored at report generation time.
 *
 *   2. Decimal storage for money. PostgreSQL numeric(20, 4). NEVER float.
 *
 *   3. JSONB for variable-shape inputs (program mix, sensitivity inputs).
 *      Hot fields (FAR, profit, IRR) get their own columns for filtering.
 *
 *   4. Soft delete via deleted_at instead of DELETE. Keeps audit clean.
 *
 *   5. Multi-tenant from day 1 — every row has org_id, every query filtered
 *      by org_id at the data layer.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─────────────────────────── Enums ───────────────────────────

export const buildingTypeEnum = pgEnum("building_type", [
  "officetel",
  "urban-housing",
  "retail",
  "coliving",
  "office",
  "mixed",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "feasibility",
  "permitting",
  "construction",
  "selling",
  "completed",
  "cancelled",
]);

export const riskLevelEnum = pgEnum("risk_level", ["ok", "low", "med", "high"]);

export const reportStatusEnum = pgEnum("report_status", [
  "draft",
  "review",
  "approved",
  "rejected",
]);

// ─────────────────────────── Tables ───────────────────────────

/** Organizations — top-level tenant. */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Users (future organization/role authentication compatible). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .references(() => orgs.id, { onDelete: "cascade" })
    .notNull(),
  email: text("email").notNull(),
  name: text("name"),
  image: text("image"),
  role: text("role").notNull().default("member"), // owner | admin | analyst | viewer
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  emailIdx: uniqueIndex("users_email_idx").on(t.email),
  orgIdx: index("users_org_idx").on(t.orgId),
}));

/** Projects = a parcel under analysis. Holds parcel facts + project meta. */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    name: text("name").notNull(),
    parcelId: text("parcel_id").notNull(), // PARCEL-2025-...

    // Address
    address: text("address").notNull(),
    addressRoad: text("address_road"),
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),

    // Geometry & zoning (snapshot from V월드/지적도 at project creation)
    lotAreaSqm: numeric("lot_area_sqm", { precision: 12, scale: 2 }).notNull(),
    zoning: text("zoning").notNull(),
    zoneCode: text("zone_code").notNull(),
    maxFar: numeric("max_far", { precision: 6, scale: 2 }).notNull(),
    maxBcr: numeric("max_bcr", { precision: 6, scale: 2 }).notNull(),
    heightLimitM: numeric("height_limit_m", { precision: 6, scale: 2 }).notNull(),
    setbackJson: jsonb("setback_json").notNull(), // { road, side, rear }

    // Acquisition
    landPriceWon: numeric("land_price_won", { precision: 14, scale: 0 }), // 공시지가 per m²
    estMarketPriceWon: numeric("est_market_price_won", { precision: 14, scale: 0 }), // estimated
    acquiredAt: timestamp("acquired_at", { withTimezone: true }),
    acquiredPriceManwon: numeric("acquired_price_manwon", { precision: 14, scale: 0 }),

    // Status & metadata
    status: projectStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index("projects_org_idx").on(t.orgId),
    statusIdx: index("projects_status_idx").on(t.status),
    parcelIdx: uniqueIndex("projects_parcel_idx").on(t.orgId, t.parcelId),
  })
);

/** Scenarios — one project has many. Each one is a building program. */
export const scenarios = pgTable(
  "scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),

    code: text("code").notNull(), // "S1", "S2", "S3", "S4"
    name: text("name").notNull(), // "오피스텔 + 근생"
    tag: text("tag"), // "고수익형"
    buildingType: buildingTypeEnum("building_type").notNull(),

    // Building program (denormalized for filtering)
    far: numeric("far", { precision: 6, scale: 2 }).notNull(),
    bcr: numeric("bcr", { precision: 6, scale: 2 }).notNull(),
    floorsAbove: integer("floors_above").notNull(),
    floorsBelow: integer("floors_below").notNull(),

    // Full program & assumption set as JSON (for replay)
    programJson: jsonb("program_json").notNull(),
    assumptionsJson: jsonb("assumptions_json").notNull(),

    // Cached calculation results — refreshed whenever inputs change
    resultJson: jsonb("result_json"),

    // Hot fields for sorting/filtering on the comparison screen
    profitManwon: numeric("profit_manwon", { precision: 14, scale: 0 }),
    profitMarginPct: numeric("profit_margin_pct", { precision: 6, scale: 2 }),
    irrPct: numeric("irr_pct", { precision: 6, scale: 2 }),
    dscr: numeric("dscr", { precision: 6, scale: 2 }),
    complianceScore: integer("compliance_score"),

    isRecommended: boolean("is_recommended").default(false).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("scenarios_project_idx").on(t.projectId),
    codeIdx: uniqueIndex("scenarios_code_idx").on(t.projectId, t.code),
  })
);

/** Assumption overrides — every user edit to base assumptions is logged. */
export const assumptionOverrides = pgTable(
  "assumption_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .references(() => scenarios.id, { onDelete: "cascade" })
      .notNull(),
    field: text("field").notNull(), // "salePricePerSqM"
    baseValue: numeric("base_value", { precision: 18, scale: 4 }).notNull(),
    overrideValue: numeric("override_value", { precision: 18, scale: 4 }).notNull(),
    reason: text("reason"),
    evidenceUrl: text("evidence_url"),
    changedBy: uuid("changed_by")
      .references(() => users.id)
      .notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    scenarioIdx: index("overrides_scenario_idx").on(t.scenarioId),
  })
);

/** Comparables — recent transactions used for price estimation. */
export const comps = pgTable(
  "comps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .references(() => orgs.id, { onDelete: "cascade" })
      .notNull(),
    externalId: text("external_id").notNull(), // e.g. 국토교통부 거래 ID
    txnDate: timestamp("txn_date", { withTimezone: true }).notNull(),
    address: text("address").notNull(),
    type: text("type").notNull(),
    areaSqm: numeric("area_sqm", { precision: 12, scale: 2 }).notNull(),
    gfaSqm: numeric("gfa_sqm", { precision: 12, scale: 2 }),
    priceManwon: numeric("price_manwon", { precision: 14, scale: 0 }).notNull(),
    pricePerPyeongManwon: numeric("price_per_pyeong_manwon", { precision: 10, scale: 0 }),
    farPct: numeric("far_pct", { precision: 6, scale: 2 }),
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    source: text("source").notNull(), // "국토교통부 실거래가"
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index("comps_org_idx").on(t.orgId),
    externalIdx: uniqueIndex("comps_external_idx").on(t.orgId, t.externalId),
    geoIdx: index("comps_geo_idx").on(t.lat, t.lng),
  })
);

/** Risk findings — output of the compliance engine, cached per scenario. */
export const riskFindings = pgTable(
  "risk_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scenarioId: uuid("scenario_id")
      .references(() => scenarios.id, { onDelete: "cascade" })
      .notNull(),
    code: text("code").notNull(), // "GFA-01", ...
    label: text("label").notNull(),
    level: riskLevelEnum("level").notNull(),
    finding: text("finding").notNull(),
    reference: text("reference"),
    headroomJson: jsonb("headroom_json"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    scenarioIdx: index("risks_scenario_idx").on(t.scenarioId),
  })
);

/** Reports — investment committee deliverables. Immutable once signed. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    version: text("version").notNull(), // "v3.2"
    title: text("title").notNull(),
    status: reportStatusEnum("status").notNull().default("draft"),

    // Snapshot of every input at the time of report generation —
    // this is what makes the report reproducible.
    snapshotJson: jsonb("snapshot_json").notNull(),

    pdfUrl: text("pdf_url"),
    signedBy: uuid("signed_by").references(() => users.id),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("reports_project_idx").on(t.projectId),
    versionIdx: uniqueIndex("reports_version_idx").on(t.projectId, t.version),
  })
);

/** Generic audit log — append-only. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(), // "scenario.update", "report.sign", ...
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orgIdx: index("audit_org_idx").on(t.orgId, t.createdAt),
    resourceIdx: index("audit_resource_idx").on(t.resourceType, t.resourceId),
  })
);

// ─────────────────────────── Relations ───────────────────────────

export const orgsRelations = relations(orgs, ({ many }) => ({
  users: many(users),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  org: one(orgs, { fields: [projects.orgId], references: [orgs.id] }),
  scenarios: many(scenarios),
  reports: many(reports),
  creator: one(users, { fields: [projects.createdBy], references: [users.id] }),
}));

export const scenariosRelations = relations(scenarios, ({ one, many }) => ({
  project: one(projects, { fields: [scenarios.projectId], references: [projects.id] }),
  overrides: many(assumptionOverrides),
  risks: many(riskFindings),
}));
