import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIntegratedVerification, verificationApprovalBlockers, type IntegratedVerificationInput } from "@/lib/handoff/integrated-verification";
import { DEFAULT_VEHICLE_PROFILE } from "@/lib/planning/vehicle-circulation";
import { planningGeometryInputBasis } from "@/lib/planning/planning-geometry";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";
import { computeProject } from "@/lib/services/compute-project";
import { projectParcelPolygons } from "@/lib/geo/parcel-envelope";
import { PROJECT_LEDGER_AUDIT_VERSION } from "@/lib/finance/project-ledger-audit";

const disciplines = ["architect", "developer", "finance-tax", "insurance-risk", "sales-marketing"] as const;
const fixture = integratedVerificationFixture();
const fresh = () => structuredClone(fixture);
const check = (input: IntegratedVerificationInput, id: string) => {
  const result = buildIntegratedVerification(input).checks.find(c => c.id === id);
  expect(result, `missing check ${id}`).toBeDefined();
  return result!;
};

afterEach(() => vi.useRealTimers());

describe("integrated bounded verification", () => {
  it("binds separate monthly arithmetic checks without granting expert approval", () => {
    const report = buildIntegratedVerification(fresh());
    expect(report.version).toBe("integrated-verification-2026.18");
    expect(report.modelVersions.ledgerArithmetic).toBe(PROJECT_LEDGER_AUDIT_VERSION);
    expect(report.checks.find(c => c.id === "binding.ledger-arithmetic")).toMatchObject({ status: "checked" });
    expect(report.approvalStatus).toBe("unverified");
  });

  it("does not apply arithmetic success to a changed stored result", () => {
    const input = fresh(); input.data.scenarios[0].profit += 100;
    expect(check(input, "binding.ledger-arithmetic").status).toBe("fail");
  });

  it.each(["v223", "", undefined])("requires recalculation of saved model %s even with matching amounts", version => {
    const input = fresh();
    Object.assign(input.data.meta, { version });
    expect(check(input, "binding.monthly-finance").status).toBe("missing");
  });

  it("recalculates displayed parcel risks rather than accepting stale labels", () => {
    const input = fresh();
    input.data.parcelRisks[0].note = "stale or altered risk description";
    expect(check(input, "binding.monthly-finance").status).toBe("fail");
  });

  it("checks the complete synthetic model without granting any external approval", () => {
    const report = buildIntegratedVerification(fresh());
    expect(verificationApprovalBlockers(report, "architect")).toEqual([]);
    expect(report.checks.filter(c => c.status === "fail")).toEqual([]);
    expect(report.checks.filter(c => c.id.endsWith(".interior"))).toHaveLength(3);
    expect(report.checks.filter(c => c.id.includes(".rooms.") && c.status === "checked")).toHaveLength(2);
    expect(report.checks.find(c => c.id === "egress.core")?.status).toBe("checked");
    expect(report.checks.find(c => c.id === "parking.layout")?.status).toBe("checked");
    expect(report.approvalStatus).toBe("unverified");
    expect(report.status).toBe("incomplete");
    expect(report.limitations.join(" ")).toContain("공식 경계");
    expect(report.limitations.join(" ")).toContain("인허가");
    expect(report.limitations.join(" ")).toContain("전문가 신원·자격");
    expect(report.checks.some(c => /official|credential|legal-approval|permit/.test(c.id))).toBe(false);
  });

  it("is JSON serializable, repeatable, non-mutating and independent of the wall clock", () => {
    const input = fresh(), before = structuredClone(input);
    const original = buildIntegratedVerification(input);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2035-01-01T00:00:00Z"));
    expect(buildIntegratedVerification(input)).toEqual(original);
    expect(input).toEqual(before);
    input.geometry!.generatedAt = "2040-01-01T00:00:00Z";
    input.planningScenario!.updatedAt = "2040-01-01T00:00:00Z";
    input.data.meta.lastSyncedAt = "2040-01-01T00:00:00Z";
    expect(buildIntegratedVerification(input)).toEqual(original);
    expect(JSON.parse(JSON.stringify(original))).toEqual(original);
    expect(JSON.stringify(original)).not.toMatch(/generatedAt|updatedAt|lastSyncedAt|2035-01-01|2040-01-01/);
  });

  it("keeps quantity cost coverage missing for both cost-owning disciplines", () => {
    const report = buildIntegratedVerification(fresh());
    for (const discipline of ["developer", "finance-tax"] as const) {
      expect(verificationApprovalBlockers(report, discipline)).toContainEqual(expect.objectContaining({
        id: `quantity-cost.${discipline}`, discipline, status: "missing",
      }));
    }
    expect(verificationApprovalBlockers(report, "sales-marketing")).toEqual([]);
    expect(verificationApprovalBlockers(report, "insurance-risk")).toEqual([]);
  });

  it.each(["planningScenario", "geometry"] as const)("blocks all disciplines when %s is absent", field => {
    const input = fresh(); input[field] = null;
    const report = buildIntegratedVerification(input);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)
      .some(c => c.id.startsWith("binding.") && c.status === "missing")).toBe(true);
  });

  it.each(["project", "id", "version", "hash", "basis", "finance"])("blocks every discipline on mismatched %s binding", field => {
    const input = fresh();
    if (field === "project") input.geometry!.projectId = "another-project";
    if (field === "id") input.planningScenario!.id = "another-plan";
    if (field === "version") input.planningScenario!.version++;
    if (field === "hash") input.geometry!.geometryHash = "changed";
    if (field === "basis") input.planningScenario!.placement.offsetXM++;
    if (field === "finance") input.data.scenarios[0]._raw.program.areaContract!.sourceScenarioVersion++;
    const report = buildIntegratedVerification(input);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)
      .some(c => c.id.startsWith("binding.") && c.status === "fail")).toBe(true);
  });

  it("treats absent bindings as missing, rather than a mismatched provided binding", () => {
    const input = fresh(); delete input.geometry!.scenarioInputBasis;
    expect(check(input, "binding.geometry-input-basis").status).toBe("missing");
    input.geometry!.scenarioInputBasis = "wrong";
    expect(check(input, "binding.geometry-input-basis").status).toBe("fail");
  });

  it("requires reverification of geometry from the previous intersection validator", () => {
    const input = fresh();
    Object.assign(input.geometry!, { version: "planning-geometry-v2" });
    const report = buildIntegratedVerification(input);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline))
      .toContainEqual(expect.objectContaining({ id: "binding.geometry-model", status: "fail" }));
    expect(input.geometry!.version).toBe("planning-geometry-v2");
  });

  it.each(["empty", "extra-component", "missing", "no-parking"])("checks the whole source parcel even with unchanged stored approval flags: %s", kind => {
    const input = fresh();
    if (kind === "missing") delete input.data.parcel.boundary;
    else if (kind === "extra-component") {
      const boundary = input.data.parcel.boundary!;
      input.data.parcel.boundaryPolygons = [{ outer: boundary, holes: [] },
        { outer: boundary.map(([lng, lat]) => [lng + 0.01, lat]), holes: [] }];
    } else input.data.parcel.boundaryPolygons = [];
    if (kind === "no-parking") {
      input.planningScenario!.parking.strategy = "none";
      input.planningScenario!.parking.providedCars = 0;
      input.data.scenarios[0]._raw.program.areaContract!.requiredParkingSpaces = 0;
      input.data.scenarios[0]._raw.program.areaContract!.providedParkingSpaces = 0;
    }
    const report = buildIntegratedVerification(input);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
      expect.objectContaining({ id: "binding.parcel-region", status: kind === "missing" ? "missing" : "fail" }));
    expect(input.geometry!.validation.representativeEligible).toBe(true);
  });

  it.each(["multiple", "hole"])("recomputes all target area despite matched source and stale pass flags: %s", kind => {
    const input = fresh(), boundary = input.data.parcel.boundary!;
    const center = boundary.reduce((p, q) => [p[0] + q[0] / boundary.length, p[1] + q[1] / boundary.length], [0, 0]);
    input.data.parcel.boundaryPolygons = kind === "multiple"
      ? [{ outer: boundary, holes: [] }, { outer: boundary.map(([lng, lat]) => [lng + 0.001, lat]), holes: [] }]
      : [{ outer: boundary, holes: [boundary.map(([lng, lat]) => [center[0] + (lng - center[0]) * 0.1, center[1] + (lat - center[1]) * 0.1])] }];
    input.data.parcel.boundary = [];
    input.geometry!.parcel.polygons = projectParcelPolygons(input.data.parcel.boundaryPolygons, input.geometry!.coordinateSystem.originLngLat);
    input.geometry!.parcel.polygon = [];
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "binding.parcel-region")?.status).toBe("checked");
    expect(report.checks.find(c => c.id === "binding.geometry-eligibility")?.status).toBe("checked");
    expect(report.checks.find(c => c.id === "binding.parcel-support")?.status).toBe("checked");
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
      expect.objectContaining({ id: "binding.parcel-area", status: "fail" }));
  });

  it.each(["coordinate", "name", "missing-source", "missing-snapshot", "empty", "invalid", "no-parking"])("blocks every discipline on stale or missing roads: %s", kind => {
    const input = fresh();
    if (kind === "missing-source") delete input.data.parcel.roads;
    else if (kind === "missing-snapshot") Reflect.deleteProperty(input.geometry!, "roads");
    else if (kind === "empty") input.data.parcel.roads = [];
    else if (kind === "invalid") input.data.parcel.roads![0].points[0][0] = Number.NaN;
    else if (kind === "name") input.data.parcel.roads![0].name = "Changed road";
    else input.data.parcel.roads![0].points[0][0] += 0.00001;
    if (kind === "no-parking") {
      input.planningScenario!.parking.strategy = "none";
      input.planningScenario!.parking.providedCars = 0;
      input.data.scenarios[0]._raw.program.areaContract!.requiredParkingSpaces = 0;
      input.data.scenarios[0]._raw.program.areaContract!.providedParkingSpaces = 0;
      input.geometry!.scenarioInputBasis = planningGeometryInputBasis(input.planningScenario!);
    }
    const report = buildIntegratedVerification(input);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)
      .some(c => c.id.startsWith("binding.road") && ["fail", "missing"].includes(c.status))).toBe(true);
  });

  it("accepts an explicitly empty but matching road source as binding, not permission", () => {
    const input = fresh(); input.data.parcel.roads = []; input.geometry!.roads = [];
    const report = buildIntegratedVerification(input);
    expect(report.checks.filter(c => c.id.startsWith("binding.road")).every(c => c.status === "checked")).toBe(true);
    expect(report.approvalStatus).toBe("unverified");
    expect(verificationApprovalBlockers(report, "architect").some(c => c.id.startsWith("parking."))).toBe(true);
  });

  it.each(["status", "representativeEligible", "exportable"] as const)("blocks every discipline on absent or ineligible stored geometry %s", field => {
    const input = fresh();
    Object.assign(input.geometry!.validation, { [field]: undefined });
    expect(check(input, "binding.geometry-eligibility").status).toBe("missing");
    Object.assign(input.geometry!.validation, { [field]: field === "status" ? "review" : false });
    const report = buildIntegratedVerification(input);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline))
      .toContainEqual(expect.objectContaining({ id: "binding.geometry-eligibility", status: "fail" }));
  });

  it("checks stored raw rooms on every upper floor even when summary checks are stale", () => {
    const input = fresh(), floor = input.planningScenario!.floorPrograms[2];
    const room = floor.interiorLayout!.roomLayouts![0];
    room.spaces[2].center = { ...room.spaces[3].center };
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === `floor.${floor.id}.rooms.${room.unitId}`)).toMatchObject({ status: "fail" });
    expect(verificationApprovalBlockers(report, "architect").some(c => c.id.includes(".rooms."))).toBe(true);
    expect(verificationApprovalBlockers(report, "sales-marketing")).toEqual([]);
  });

  it.each(["room", "unit"])("detects changed raw %s doors", kind => {
    const input = fresh(), floor = input.planningScenario!.floorPrograms[1];
    const room = floor.interiorLayout!.roomLayouts![0];
    if (kind === "room") room.doors[0].center.x += 1;
    else floor.interiorLayout!.doors.find(d => d.from === room.unitId || d.to === room.unitId)!.widthM += 0.1;
    const result = check(input, `floor.${floor.id}.rooms.${room.unitId}`);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain(kind === "room" ? "room-door" : "stale-parent");
  });

  it("checks raw core settings and ground exit bindings", () => {
    const input = fresh(); input.planningScenario!.egressPlan!.settings.landingDepthM = 2;
    expect(check(input, "egress.core").status).toBe("fail");
    expect(check(input, "egress.link.floor-2.floor-3").status).toBe("fail");
    const exit = fresh(); exit.planningScenario!.egressPlan!.exit!.layoutBasis = "stale";
    expect(check(exit, "egress.core").detail).toContain("exit-stale");
  });

  it("reruns the vehicle model when raw vehicle dimensions change", () => {
    const input = fresh();
    input.planningScenario!.parking.vehicleProfile = { ...DEFAULT_VEHICLE_PROFILE, widthM: 2.6 };
    const report = buildIntegratedVerification(input);
    expect(report.checks.some(c => c.id.startsWith("parking.vehicle.") && c.status === "fail")).toBe(true);
    expect(verificationApprovalBlockers(report, "architect").some(c => c.id.startsWith("parking.vehicle."))).toBe(true);
    expect(verificationApprovalBlockers(report, "sales-marketing")).toEqual([]);
  });

  it("rejects mismatched parking supply globally, and agreed supply shortfalls for architect review", () => {
    const input = fresh();
    input.planningScenario!.parking.providedCars = 0;
    const unbound = buildIntegratedVerification(input);
    for (const discipline of disciplines) expect(verificationApprovalBlockers(unbound, discipline))
      .toContainEqual(expect.objectContaining({ id: "binding.parking-supply", status: "fail" }));
    input.data.scenarios[0]._raw.program.areaContract!.providedParkingSpaces = 0;
    const agreed = buildIntegratedVerification(input);
    expect(agreed.checks.find(c => c.id === "binding.parking-supply")?.status).toBe("checked");
    expect(verificationApprovalBlockers(agreed, "architect"))
      .toContainEqual(expect.objectContaining({ id: "parking.supply", status: "fail" }));
    expect(agreed.checks.find(c => c.id === "parking.layout")?.status).toBe("fail");
    expect(verificationApprovalBlockers(agreed, "sales-marketing")).toEqual([]);
    expect(input.planningScenario!.parking.providedCars).toBe(0);
  });

  it("never fills missing outlines, rooms, core settings or road observations with fabricated evidence", () => {
    const input = fresh();
    input.geometry!.building.floors[2].shape = [];
    input.planningScenario!.floorPrograms[1].interiorLayout!.roomLayouts = [];
    delete input.planningScenario!.egressPlan;
    delete input.data.parcel.roads;
    const report = buildIntegratedVerification(input);
    expect(report.checks.find(c => c.id === "floor.floor-3.outline")?.status).toBe("missing");
    expect(report.checks.find(c => c.id === "floor.floor-2.rooms.zone-2-0")?.status).toBe("missing");
    expect(report.checks.find(c => c.id === "egress.core")?.status).toBe("missing");
    expect(report.checks.find(c => c.id === "parking.coverage")?.status).toBe("missing");
  });

  it("accepts a legacy representative VM as incomplete without throwing or substituting zero totals", () => {
    const input = { projectId: "P1", representativeScenarioId: "S1", representativeScenarioVersion: 3, geometryHash: "G1",
      data: { parcel: { id: "P1" }, scenarios: [{ id: "S1", _raw: { id: "S1", program: { floorsAbove: 4 } } }], meta: { version: "legacy" } },
      planningScenario: null, geometry: null } as unknown as IntegratedVerificationInput;
    const report = buildIntegratedVerification(input);
    expect(report.status).toBe("incomplete");
    expect(report.checks.find(c => c.id === "finance.profit")?.status).toBe("missing");
    expect(report.checks.filter(c => c.status === "fail")).toEqual([]);
    expect(() => buildIntegratedVerification(undefined as unknown as IntegratedVerificationInput)).not.toThrow();
  });

  it.each(["room", "floor", "geometry", "vehicle", "cycle", "oversized"])("bounds malformed %s data before unsafe calculation", kind => {
    const input = fresh();
    if (kind === "room") (input.planningScenario!.floorPrograms[2].interiorLayout!.roomLayouts![0] as unknown as { spaces: unknown }).spaces = null;
    if (kind === "floor") (input.planningScenario!.floorPrograms[0] as unknown as { zones: unknown }).zones = "invalid";
    if (kind === "geometry") input.geometry!.building.floors[1].shape[0].x = NaN;
    if (kind === "vehicle") input.planningScenario!.parking.stallWidthM = Number.MIN_VALUE;
    if (kind === "cycle") Object.assign(input.planningScenario!, { cycle: input.planningScenario });
    if (kind === "oversized") input.geometry!.parcel.polygon = Array.from({ length: 10000 }, () => ({ x: 0, z: 0 }));
    let report: ReturnType<typeof buildIntegratedVerification> | undefined;
    expect(() => { report = buildIntegratedVerification(input); }).not.toThrow();
    expect(report!.checks.some(c => c.status === "missing" || c.status === "fail")).toBe(true);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("checks stored arithmetic independently of the monthly finance binding", () => {
    const input = fresh(), vm = input.data.scenarios[0];
    expect(check(input, "finance.profit").status).toBe("checked");
    vm.profit += 100;
    expect(check(input, "finance.profit").status).toBe("fail");
    vm.revenue += 100;
    expect(check(input, "finance.revenue").status).toBe("fail");
    vm.cost += 100;
    expect(check(input, "finance.cost").status).toBe("fail");
    vm.financingCost += 100;
    expect(check(input, "finance.financing").status).toBe("fail");
    vm._raw.program.areaContract!.constructionAreaSqm += 10;
    expect(check(input, "finance.area.construction").status).toBe("fail");
    vm._raw.assumptions.salePricePerSqM = Infinity;
    expect(check(input, "finance.raw-numbers").status).toBe("fail");
  });

  it.each(["high-profit", "monthly-flow", "interest", "legacy-scalar", "base-profit", "raw-rate", "land-price", "decision", "selected"])(
    "blocks all disciplines on a forged or stale monthly-finance %s", field => {
      const input = fresh(), vm = input.data.scenarios[0], stress = vm.constructionCostSensitivity!;
      if (field === "high-profit" && stress.high.status === "calculated") stress.high.result.profit++;
      if (field === "monthly-flow" && stress.low.status === "calculated") stress.low.result.equityCashFlowsManwon[1]++;
      if (field === "interest") stress.base.result.interestCost++;
      if (field === "legacy-scalar") vm.profitAtHighCost!++;
      if (field === "base-profit") { vm.profit++; vm.revenue++; vm.revenueSale++; vm.revenueByPool.residentialSale++; }
      if (field === "raw-rate") vm._raw.assumptions.constCostPerSqM += 10000;
      if (field === "land-price") input.data.parcel.acquiredPrice++;
      if (field === "decision") input.data.decisionSupport.focusMode = "least-loss-fallback";
      if (field === "selected") vm.recommended = false;
      const report = buildIntegratedVerification(input);
      for (const discipline of disciplines) expect(verificationApprovalBlockers(report, discipline)).toContainEqual(
        expect.objectContaining({ id: "binding.monthly-finance", status: "fail" }));
    },
  );

  it("never uses old approximate ranges or omitted comparison candidates as monthly proof", () => {
    const legacy = fresh(); delete legacy.data.scenarios[0].constructionCostSensitivity;
    expect(check(legacy, "binding.monthly-finance").status).toBe("missing");
    const many = fresh(); many.data.scenarios = Array.from({ length: 33 }, () => structuredClone(many.data.scenarios[0]));
    expect(check(many, "binding.monthly-finance").status).toBe("missing");
    const malformed = fresh(); malformed.data.scenarios[0]._raw.assumptions.constructionMonths = Infinity;
    expect(check(malformed, "binding.monthly-finance").status).toBe("fail");
  });

  it("rechecks the downside ledger of non-representative comparison candidates too", () => {
    const input = fresh(), representative = input.data.scenarios[0]._raw;
    const other = structuredClone(representative);
    other.id = "OTHER";
    other.program.areaContract!.sourceScenarioId = other.id;
    input.data = computeProject(input.data.parcel, [representative, other], { recommendedId: representative.id });
    expect(check(input, "binding.monthly-finance").status).toBe("checked");
    const high = input.data.scenarios[1].constructionCostSensitivity!.high;
    if (high.status !== "calculated") throw new Error("Invalid fixture");
    high.result.profit += 100;
    input.data.scenarios[1].profitAtHighCost! += 100;
    expect(check(input, "binding.monthly-finance").status).toBe("fail");
  });

  it.each(["equity", "pf", "profitMargin", "equityMultiple", "pfCommitment", "dscr", "ltc", "taxIncludedInPretax"] as const)(
    "reconciles displayed %s against the engine instead of only the cost summary", field => {
      const input = fresh(); input.data.scenarios[0][field] += 1;
      expect(check(input, "binding.monthly-finance").status).toBe("fail");
    },
  );

  it.each(["outflow", "inflow", "net", "cumulative"] as const)("reconciles the displayed quarterly %s", field => {
    const input = fresh(); input.data.pfSchedule[0][field] += 1;
    expect(check(input, "binding.monthly-finance").status).toBe("fail");
  });

  it("binds the actual schedule start date and rejects a missing or mismatched quarterly basis", () => {
    const input = fresh();
    expect(input.data.meta.calculationStartDate).toBe("2026-10-01");
    expect(check(input, "binding.monthly-finance").status).toBe("checked");
    input.data.meta.calculationStartDate = "2026-11-01";
    expect(check(input, "binding.monthly-finance").status).toBe("fail");
    delete input.data.meta.calculationStartDate;
    expect(check(input, "binding.monthly-finance").status).toBe("missing");
    expect(() => computeProject(input.data.parcel, input.data.scenarios.map(s => s._raw), { startDate: "not-a-date" })).toThrow();
  });

  it("uses 0.01 sqm for finance/program reconciliation even below the geometry tolerance", () => {
    const input = fresh();
    input.data.scenarios[0]._raw.program.areaContract!.constructionAreaSqm += 0.02;
    expect(check(input, "finance.area.construction").status).toBe("fail");
  });

  it("reports every unit beyond the per-floor template limit as missing rather than skipping units", () => {
    const input = fresh();
    input.planningScenario!.floorPrograms[2].zones[0].unitCount = 21;
    const report = buildIntegratedVerification(input);
    const rooms = report.checks.filter(c => c.id.startsWith("floor.floor-3.rooms."));
    expect(rooms).toHaveLength(21);
    expect(rooms.every(c => c.status === "missing")).toBe(true);
  });

  it("does not bridge absent floors or ignore duplicate geometry floor identifiers", () => {
    const input = fresh(); input.geometry!.building.floors.splice(1, 1);
    expect(check(input, "binding.geometry-floor-coverage").status).toBe("missing");
    const duplicate = fresh(); duplicate.geometry!.building.floors.push(structuredClone(duplicate.geometry!.building.floors[0]));
    expect(check(duplicate, "binding.geometry-floor-ids").status).toBe("fail");
  });

  it("does not call unsupported retail layouts a proven physical conflict", () => {
    const input = fresh(); input.planningScenario!.floorPrograms[1].zones[0].useType = "retail";
    input.geometry!.scenarioInputBasis = planningGeometryInputBasis(input.planningScenario!);
    expect(check(input, "floor.floor-2.interior").status).toBe("missing");
  });
});
