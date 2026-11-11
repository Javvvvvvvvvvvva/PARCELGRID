import { describe, expect, it } from "vitest";
import { buildingRegistryEvidenceSchema } from "@/lib/building-registry/types";
import { summarizeRegistryAreas, registryEvidenceDownload, getBuildingRegistryStatus } from "@/lib/building-registry/evidence";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import { fixtureEvidence, fixtureRecord, SYNTHETIC_TITLE } from "./helpers/building-registry-fixture";

describe("building area provenance and reconciliation", () => {
  it("compares identical raw title PKs, excludes Y rows, and never adds unit/common areas to GFA", () => {
    const evidence = fixtureEvidence();
    const before = JSON.stringify(evidence);
    const result = summarizeRegistryAreas(evidence);
    expect(result.comparisons[0]).toMatchObject({ titleAreaSqm: 200.3, includedFloorAreaSqm: 200.3, differenceSqm: 0, comparable: true, excludedRows: 1 });
    expect(result.exclusiveObservedSqm).toBe(40.1);
    expect(result.commonObservedSqm).toBe(5.2);
    expect(JSON.stringify(evidence)).toBe(before);
  });

  it("does not invent PK migration or join same-named buildings across different IDs", () => {
    const evidence = fixtureEvidence();
    evidence.floors.rows.forEach((row) => { row.registryPk = `OLD:${row.registryPk}`; });
    const summary = summarizeRegistryAreas(evidence);
    expect(summary.unmatchedFloorRows).toBe(3);
    expect(summary.comparisons[0]).toMatchObject({ rowCount: 0, comparable: false, includedFloorAreaSqm: null, differenceSqm: null });
  });

  it("does not confirm an area match from partial pages or missing area exclusion flags", () => {
    const evidence = fixtureEvidence();
    evidence.floors.status = "partial";
    expect(summarizeRegistryAreas(evidence).comparisons[0].differenceSqm).toBeNull();
    evidence.floors.status = "complete";
    delete evidence.floors.rows[0].fields.areaExctYn;
    expect(summarizeRegistryAreas(evidence).comparisons[0]).toMatchObject({ comparable: false, unresolvedRows: 1, includedFloorAreaSqm: null });
  });

  it("keeps missing areas and unknown category codes visible instead of guessing zero or a category", () => {
    const evidence = fixtureEvidence();
    evidence.exclusiveCommon.rows[0].fields.area = "";
    evidence.exclusiveCommon.rows.push(fixtureRecord({ ...SYNTHETIC_TITLE, rnum: "3", area: "500", exposPubuseGbCd: "1" }));
    const summary = summarizeRegistryAreas(evidence);
    expect(summary).toMatchObject({ exclusiveObservedSqm: null, commonObservedSqm: 5.2, missingAreaRows: 1, unclassifiedAreaRows: 1 });
  });

  it("exports query scope, source row IDs, original dates and limitations without creating a drawing", () => {
    const registry = fixtureEvidence();
    const info = { registry } as BuildingLookupResult;
    const exported = JSON.parse(registryEvidenceDownload(info)!);
    expect(exported.registry.query.bun).toBe("0281");
    expect(exported.registry.exclusiveCommon.rows[0].registryPk).toBe("fixture-unit-01");
    expect(exported.registry.floors.rows[0].generatedDate).toBe("20260901");
    expect(exported.limitations.join(" ")).toContain("분양면적");
    expect(JSON.stringify(exported)).not.toContain("serviceKey");
  });

  it("rejects inconsistent complete snapshots at the dynamic project boundary", () => {
    const evidence = fixtureEvidence();
    expect(buildingRegistryEvidenceSchema.safeParse(evidence).success).toBe(true);
    evidence.title.totalCount = 0;
    expect(buildingRegistryEvidenceSchema.safeParse(evidence).success).toBe(false);
    evidence.title.totalCount = 1;
    evidence.title.requestUrl += "&serviceKey=never-persist";
    expect(buildingRegistryEvidenceSchema.safeParse(evidence).success).toBe(false);
    evidence.title.requestUrl = "not-a-url";
    expect(buildingRegistryEvidenceSchema.safeParse(evidence).success).toBe(false);
  });

  it("does not promote legacy hasBuilding=false to a verified 0-row query", () => {
    expect(getBuildingRegistryStatus({ hasBuilding: false, buildings: [] } as unknown as BuildingLookupResult)).toBe("unknown");
    expect(getBuildingRegistryStatus({ hasBuilding: true, buildings: [] } as unknown as BuildingLookupResult)).toBe("unknown");
  });
});
