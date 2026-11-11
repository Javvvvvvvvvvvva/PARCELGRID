import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import {
  resetCurrentPriceVerification,
  saveCurrentPriceVerification,
} from "@/lib/finance/price-verification-client";
import {
  buildFinancialSourceFromPriceVerification,
  calculatePriceVerification,
  priceVerificationRecordHash,
  type PriceVerificationRecord,
  type PriceVerificationTarget,
} from "@/lib/finance/price-verification";
import {
  applyFinancialSources,
  buildSourceDataGate,
  type FinancialSourceRecord,
} from "@/lib/finance/source-data-gate";
import { buildExpertReviewSummary } from "@/lib/handoff/review-workflow";
import { useProjectStore } from "@/lib/stores/project-store";
import { useReviewStore } from "@/lib/stores/review-store";
import { applyProjectWorkspace, captureProjectWorkspace } from "@/lib/workspace/project-workspace-client";
import { validateProjectWorkspacePayload, type ProjectWorkspacePayload } from "@/lib/workspace/project-workspace";
import { projectWorkspaceFixture } from "./helpers/project-workspace-fixture";
import { precisionFixture } from "./helpers/finance-precision-fixture";

const session = vi.hoisted(() => ({ active: true, context: "org/user", capabilities: ["project.read", "project.update"] }));
vi.mock("@/lib/auth/client-session", async original => ({
  ...await original<typeof import("@/lib/auth/client-session")>(),
  clientSession: {
    get active() { return session.active; }, get context() { return session.context; },
    get principal() { return { capabilities: session.capabilities }; },
    assertActive() { if (!session.active) throw new Error("Session inactive"); },
    invalidate() { session.active = false; },
    subscribe() { return () => {}; },
  },
}));

const P = "price-project", FOREIGN = "foreign-project";
const targets = ["acquisition", "sale"] as const;
const document = {
  pathname: "private/evidence.pdf", fileName: "evidence.pdf", contentType: "application/pdf",
  size: 120, sha256: "a".repeat(64), uploadedAt: "2026-11-11T00:00:00.000Z",
};

function record(target: PriceVerificationTarget = "acquisition", patch: Partial<PriceVerificationRecord> = {}): PriceVerificationRecord {
  const selectedComps = [1000, 1200, 1400].map((price, index) => ({
    id: `comp-${index}`, address: `Address ${index}`, date: "2026-10-01", type: "land",
    lotAreaSqm: 100, pricePerPyeongManwon: price,
  }));
  return {
    projectId: P, target, status: "verified", selectedComps,
    ...calculatePriceVerification(330.5785, selectedComps, 10), adjustmentPct: 10,
    reviewer: "Reviewer", organization: "Project team", rationale: "Comparable locations",
    sourceModelVersion: "model-1", verifiedAt: "2026-11-11", updatedAt: "2026-11-11T00:00:00.000Z",
    ...patch,
  };
}

function context() {
  return { projectId: P, sessionContext: session.context, expectedData: useProjectStore.getState().data! };
}

function save(value = record()) { return saveCurrentPriceVerification({ ...context(), record: value }); }
function reset(target: PriceVerificationTarget = "acquisition") { return resetCurrentPriceVerification({ ...context(), target }); }
function sources() { return useProjectStore.getState().financialSources[P] ?? {}; }
function reviews() { return useReviewStore.getState().priceVerifications[P] ?? {}; }
function generated(value = record()) { return buildFinancialSourceFromPriceVerification(value)!; }

function initialize() {
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useReviewStore.setState(useReviewStore.getInitialState(), true);
  session.active = true; session.context = "org/user"; session.capabilities = ["project.read", "project.update"];
  applyProjectWorkspace(projectWorkspaceFixture(P));
}

function expectNoWrites(action: () => unknown, error?: RegExp) {
  const project = useProjectStore.getState(), review = useReviewStore.getState();
  const changed = vi.fn();
  const offProject = useProjectStore.subscribe(changed), offReview = useReviewStore.subscribe(changed);
  try {
    expect(action).toThrow(error);
    expect(changed).not.toHaveBeenCalled();
    expect(useProjectStore.getState()).toBe(project);
    expect(useReviewStore.getState()).toBe(review);
  } finally { offProject(); offReview(); }
}

function installFailingPersistence() {
  const projectStorage = useProjectStore.persist.getOptions().storage;
  const reviewStorage = useReviewStore.persist.getOptions().storage;
  const disk = new Map<string, string>([["unrelated-customer-storage", "preserve"]]);
  const writes: string[] = [];
  const failures = new Set<number>();
  const storage = {
    getItem: (key: string) => disk.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(key);
      if (failures.has(writes.length)) throw new DOMException("Storage full", "QuotaExceededError");
      disk.set(key, value);
    },
    removeItem: vi.fn(),
  };
  useProjectStore.persist.setOptions({ storage: createJSONStorage(() => storage) });
  useReviewStore.persist.setOptions({ storage: createJSONStorage(() => storage) });
  const project = useProjectStore.getState(), review = useReviewStore.getState();
  useProjectStore.setState(project, true);
  useReviewStore.setState(review, true);
  const beforeDisk = new Map(disk);
  writes.length = 0;
  return {
    project, review, disk, beforeDisk, writes, failures, storage,
    projectKey: useProjectStore.persist.getOptions().name!,
    reviewKey: useReviewStore.persist.getOptions().name!,
    restore() {
      useProjectStore.persist.setOptions({ storage: projectStorage });
      useReviewStore.persist.setOptions({ storage: reviewStorage });
    },
  };
}

function seedRollbackEvidence(target: PriceVerificationTarget, withPrevious: boolean) {
  if (withPrevious) save(Object.assign(record(target), { metadata: { evidenceNotes: ["Keep raw metadata"] } }));
  save(record(target === "acquisition" ? "sale" : "acquisition"));
  const foreign = record(target, { projectId: FOREIGN });
  useReviewStore.getState().setPriceVerification(FOREIGN, foreign);
  useProjectStore.getState().setFinancialSource(FOREIGN, { ...generated(foreign), document });
  useReviewStore.setState({ expertReviews: { [FOREIGN]: {} } });
}

describe("price verification client lifecycle", () => {
  beforeEach(initialize);
  afterEach(() => {
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useReviewStore.setState(useReviewStore.getInitialState(), true);
  });

  it.each([
    { action: "save", failAt: 1 }, { action: "save", failAt: 2 },
    { action: "reset", failAt: 1 }, { action: "reset", failAt: 2 },
  ] as const)("restores both memory and persisted stores after $action write $failAt fails", ({ action, failAt }) => {
    const variants = action === "save" ? ["new", "replace", "request"] as const : ["reset"] as const;
    for (const target of targets) for (const variant of variants) {
      initialize();
      seedRollbackEvidence(target, variant !== "new");
      const persistence = installFailingPersistence();
      try {
        const next = record(target, { rationale: "New evidence", status: variant === "request" ? "review-requested" : "verified" });
        const act = () => action === "save" ? save(next) : reset(target);
        persistence.failures.add(failAt);
        expect(act).toThrow(/저장하지 못해 이전 상태로 되돌렸습니다/);
        expect(useProjectStore.getState()).toBe(persistence.project);
        expect(useReviewStore.getState()).toBe(persistence.review);
        expect(persistence.disk).toEqual(persistence.beforeDisk);
        expect(persistence.writes).toEqual([
          persistence.projectKey, ...(failAt === 2 ? [persistence.reviewKey] : []),
          persistence.projectKey, persistence.reviewKey,
        ]);
        expect(persistence.storage.removeItem).not.toHaveBeenCalled();
        expect(session.active).toBe(true);
        expect(validateProjectWorkspacePayload(captureProjectWorkspace(P)).errors).toEqual([]);
        persistence.failures.clear();
        expect(act).not.toThrow();
        expect(() => reset(target)).not.toThrow();
        expect(save(record(target))).toEqual({ sourceAction: "applied" });
        expect(validateProjectWorkspacePayload(captureProjectWorkspace(P)).errors).toEqual([]);
      } finally { persistence.restore(); }
    }
  });

  it.each(["save", "reset"] as const)("attempts both rollbacks and locks after %s rollback persistence fails", action => {
    for (const failedRollbacks of [[3], [4], [3, 4]]) {
      initialize();
      seedRollbackEvidence("acquisition", true);
      const persistence = installFailingPersistence();
      try {
        const next = record("acquisition", { rationale: "Changed evidence" });
        const act = () => action === "save" ? save(next) : reset();
        for (const index of [2, ...failedRollbacks]) persistence.failures.add(index);
        let failure: unknown;
        try { act(); } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(AggregateError);
        expect((failure as AggregateError).errors).toHaveLength(1 + failedRollbacks.length);
        expect((failure as Error).message).toMatch(/세션을 잠갔습니다.*저장소 복구 여부를 확인할 수 없습니다/);
        expect(useProjectStore.getState()).toBe(persistence.project);
        expect(useReviewStore.getState()).toBe(persistence.review);
        expect(persistence.writes).toEqual([
          persistence.projectKey, persistence.reviewKey, persistence.projectKey, persistence.reviewKey,
        ]);
        expect(persistence.disk.get(persistence.reviewKey)).toBe(persistence.beforeDisk.get(persistence.reviewKey));
        if (failedRollbacks.includes(3)) {
          expect(persistence.disk.get(persistence.projectKey)).not.toBe(persistence.beforeDisk.get(persistence.projectKey));
        } else {
          expect(persistence.disk).toEqual(persistence.beforeDisk);
        }
        expect(persistence.disk.get("unrelated-customer-storage")).toBe("preserve");
        expect(persistence.storage.removeItem).not.toHaveBeenCalled();
        expect(session.active).toBe(false);
        persistence.failures.clear();
        expectNoWrites(() => save(next), /Session inactive/);
        expectNoWrites(() => reset(), /Session inactive/);
        expect(persistence.writes).toHaveLength(4);
      } finally { persistence.restore(); }
    }
  });

  it.each(targets)("withdraws %s A on request B, then permits re-verification", target => {
    const a = record(target), field = generated(a).field;
    expect(save(a)).toEqual({ sourceAction: "applied" });
    expect(sources()[field]).toEqual(generated(a));
    const { parcel, scenario: baseScenario } = precisionFixture();
    const scenario = { ...baseScenario, program: { ...baseScenario.program, areaContract: undefined } };
    expect(buildSourceDataGate(scenario, sources()).validRecords.map(source => source.field)).toContain(field);
    expect(applyFinancialSources(parcel, scenario, sources()).applied).toContain(field);

    const b = { ...a, status: "review-requested" as const, rationale: "Updated evidence B",
      ...calculatePriceVerification(330.5785, a.selectedComps, 20), adjustmentPct: 20 };
    expect(save(b)).toEqual({ sourceAction: "removed" });
    expect(reviews()[target]).toEqual(b);
    expect(sources()).not.toHaveProperty(field);
    expect(buildSourceDataGate(scenario, sources()).missingFields).toContain(field);
    expect(applyFinancialSources(parcel, scenario, sources()).applied).not.toContain(field);

    const verifiedB = { ...b, status: "verified" as const };
    expect(save(verifiedB)).toEqual({ sourceAction: "applied" });
    expect(sources()[field]).toEqual(generated(verifiedB));
    expect(save({ ...verifiedB, rationale: "New verified evidence C" })).toEqual({ sourceAction: "applied" });
    expect(sources()[field]?.priceReviewOrigin?.recordHash).not.toBe(priceVerificationRecordHash(verifiedB));
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(P)).errors).toEqual([]);
  });

  it.each(targets)("resets only the owned %s source and permits a fresh verification", target => {
    save(record(target));
    expect(reset(target)).toEqual({ sourceAction: "removed" });
    expect(reviews()).not.toHaveProperty(target);
    expect(sources()).not.toHaveProperty(generated(record(target)).field);
    expect(reset(target)).toEqual({ sourceAction: "none" });
    expect(save(record(target))).toEqual({ sourceAction: "applied" });
  });

  it("reports none for requests and resets with no source", () => {
    expect(save(record("sale", { status: "review-requested" }))).toEqual({ sourceAction: "none" });
    expect(reset("sale")).toEqual({ sourceAction: "none" });
  });

  it("preserves foreign projects, the other target and expert authority without granting approval", () => {
    save(record("sale"));
    const sale = reviews().sale, saleSource = sources().salePricePerSqM;
    const foreignReview = record("acquisition", { projectId: FOREIGN });
    const foreignSource = generated(foreignReview);
    useReviewStore.getState().setPriceVerification(FOREIGN, foreignReview);
    useProjectStore.getState().setFinancialSource(FOREIGN, foreignSource);
    const expertReviews = { [P]: {}, [FOREIGN]: {} };
    useReviewStore.setState({ expertReviews });
    save(); save(record("acquisition", { status: "review-requested" })); save(); reset();
    expect(reviews().sale).toBe(sale);
    expect(sources().salePricePerSqM).toBe(saleSource);
    expect(useReviewStore.getState().priceVerifications[FOREIGN].acquisition).toBe(foreignReview);
    expect(useProjectStore.getState().financialSources[FOREIGN].acquisitionPrice).toBe(foreignSource);
    expect(useReviewStore.getState().expertReviews).toBe(expertReviews);
    expect(buildExpertReviewSummary(expertReviews[P])).toMatchObject({ approvedCount: 0, ready: false });
  });

  it("preserves differing independent sources, including attached sources sharing the generated label", () => {
    for (const target of targets) for (const attached of [false, true]) {
      const a = record(target), source = { ...generated(a), value: 123, documentRef: "independent-evidence" };
      delete source.priceReviewOrigin;
      if (attached) source.document = document;
      useReviewStore.getState().setPriceVerification(P, a);
      useProjectStore.getState().setFinancialSource(P, source);
      expectNoWrites(() => save(a), /별도 재무 원문 근거/);
      expect(save({ ...a, status: "review-requested" })).toEqual({ sourceAction: "preserved" });
      expect(sources()[source.field]).toBe(source);
      expect(reset(target)).toEqual({ sourceAction: "preserved" });
      expect(reset(target)).toEqual({ sourceAction: "preserved" });
      expect(sources()[source.field]).toBe(source);
    }
  });

  it("reads current financial sources at action time even when the rendered data reference is unchanged", () => {
    const input = { ...context(), record: record() };
    const source = { ...generated(), value: 456, documentRef: "added-after-render" };
    delete source.priceReviewOrigin;
    useProjectStore.getState().setFinancialSource(P, source);
    expectNoWrites(() => saveCurrentPriceVerification(input), /별도 재무 원문 근거/);
    expect(sources().acquisitionPrice).toBe(source);
  });

  it("blocks changes that would replace or orphan a valid linked attachment", () => {
    save();
    const source = { ...sources().acquisitionPrice!, document };
    useProjectStore.getState().setFinancialSource(P, source);
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(P)).errors).toEqual([]);
    expectNoWrites(() => save(), /첨부 또는 별도 메타데이터/);
    expectNoWrites(() => save(record("acquisition", { status: "review-requested" })), /첨부 또는 별도 메타데이터/);
    expectNoWrites(() => reset(), /첨부 또는 별도 메타데이터/);
    expect(sources().acquisitionPrice).toBe(source);
  });

  it("protects extra independent metadata on either the source or its marker", () => {
    for (const location of ["source", "marker"] as const) {
      initialize(); save();
      const source = structuredClone(sources().acquisitionPrice!);
      Object.assign(location === "source" ? source : source.priceReviewOrigin!, { independentMemo: "Retain this evidence" });
      useProjectStore.getState().setFinancialSource(P, source);
      expectNoWrites(() => save(), /별도 메타데이터/);
      expectNoWrites(() => save(record("acquisition", { status: "review-requested" })), /별도 메타데이터/);
      expectNoWrites(() => reset(), /별도 메타데이터/);
    }
  });

  it("rejects legacy exact generated matches as ambiguous without migration or deletion", () => {
    for (const target of targets) {
      const a = record(target), source = generated(a);
      delete source.priceReviewOrigin;
      useReviewStore.getState().setPriceVerification(P, a);
      useProjectStore.getState().setFinancialSource(P, source);
      expectNoWrites(() => save(a), /소유권 표식이 없어/);
      expectNoWrites(() => save({ ...a, status: "review-requested" }), /소유권 표식이 없어/);
      expectNoWrites(() => reset(target), /소유권 표식이 없어/);
      expect(sources()[source.field]).toBe(source);
      expect(source).not.toHaveProperty("priceReviewOrigin");
    }
  });

  it("rejects invalid or orphaned markers and markers stored on another field before any writes", () => {
    const changes: Array<(source: FinancialSourceRecord) => void> = [
      source => { source.priceReviewOrigin!.recordHash = "0".repeat(64); },
      source => { source.priceReviewOrigin!.projectId = FOREIGN; },
      source => { source.value += 1; },
      source => { source.priceReviewOrigin!.target = "sale"; },
      source => { Object.assign(source, { priceReviewOrigin: null }); },
      () => { useReviewStore.getState().removePriceVerification(P, "acquisition"); },
      source => { source.field = "salePricePerSqM"; },
    ];
    for (const change of changes) {
      initialize(); save();
      const source = structuredClone(sources().acquisitionPrice!);
      change(source);
      useProjectStore.getState().setFinancialSource(P, source);
      expectNoWrites(() => save(), /출처 연결/);
      expectNoWrites(() => save(record("acquisition", { status: "review-requested" })), /출처 연결/);
      expectNoWrites(() => reset(), /출처 연결/);
    }
  });

  it("rejects role, session, foreign-project and stale-reference changes for both actions", () => {
    for (const kind of ["inactive", "session", "missing-session", "readonly", "no-capability", "foreign", "stale", "missing-data"]) {
      initialize(); save();
      const input = context();
      if (kind === "inactive") session.active = false;
      if (kind === "session") session.context = "other/user";
      if (kind === "missing-session") Object.assign(input, { sessionContext: null });
      if (kind === "readonly") session.capabilities = ["project.read"];
      if (kind === "no-capability") session.capabilities = [];
      if (kind === "foreign") useProjectStore.setState({ data: projectWorkspaceFixture(FOREIGN).projectData });
      if (kind === "stale") useProjectStore.setState({ data: structuredClone(input.expectedData) });
      if (kind === "missing-data") useProjectStore.setState({ data: null });
      expectNoWrites(() => saveCurrentPriceVerification({ ...input, record: record() }));
      expectNoWrites(() => resetCurrentPriceVerification({ ...input, target: "acquisition" }));
    }
  });

  it("rejects a foreign requested project even with its matching record", () => {
    const input = { ...context(), projectId: FOREIGN };
    expectNoWrites(() => saveCurrentPriceVerification({ ...input, record: record("acquisition", { projectId: FOREIGN }) }));
    expectNoWrites(() => resetCurrentPriceVerification({ ...input, target: "acquisition" }));
  });

  it("rejects foreign owners and unsafe record shapes without withdrawing the old source", () => {
    save();
    for (const patch of [
      { projectId: FOREIGN }, { target: "other" }, { status: "approved" },
      { selectedComps: null }, { selectedComps: [{ id: "incomplete" }] },
      { adjustmentPct: NaN }, { verifiedTotalManwon: Infinity }, { updatedAt: "invalid" },
    ]) {
      expectNoWrites(() => save({ ...record(), ...patch } as PriceVerificationRecord), /필수 필드/);
    }
    expectNoWrites(() => reset("other" as PriceVerificationTarget), /대상/);
  });

  it("rejects foreign or malformed records already stored under the requested target", () => {
    for (const patch of [{ projectId: FOREIGN }, { target: "sale" as const }, { selectedComps: null }]) {
      useReviewStore.setState({ priceVerifications: { [P]: { acquisition: { ...record(), ...patch } as PriceVerificationRecord } } });
      expectNoWrites(() => save(), /기존 가격 검토/);
      expectNoWrites(() => reset(), /기존 가격 검토/);
    }
  });

  it("keeps the existing readiness requirement for every save status", () => {
    save();
    for (const status of ["draft", "review-requested", "verified", "rejected"] as const) {
      for (const patch of [{ reviewer: "" }, { organization: "" }, { rationale: "" }, { selectedComps: [] },
        { adjustmentPct: 31 }, { verifiedAt: "invalid" }, { verifiedPricePerPyeongManwon: 0 }]) {
        expectNoWrites(() => save(record("acquisition", { status, ...patch })));
      }
    }
  });

  it("preserves accepted raw record metadata and isolates it from later caller mutations", () => {
    const value = Object.assign(record(), { metadata: { evidenceNotes: ["Keep this"] } });
    Object.assign(value.selectedComps[0], { providerMetadata: { sourceId: "raw-id" } });
    save(value);
    expect(reviews().acquisition).toEqual(value);
    expect(reviews().acquisition).not.toBe(value);
    value.metadata.evidenceNotes.push("Caller edit");
    value.selectedComps[0].address = "Caller changed address";
    expect(reviews().acquisition).toMatchObject({ metadata: { evidenceNotes: ["Keep this"] },
      selectedComps: [{ address: "Address 0", providerMetadata: { sourceId: "raw-id" } }, {}, {}] });
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(P)).errors).toEqual([]);
  });

  it("hashes known review fields deterministically regardless of object property order", () => {
    const a = record();
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as PriceVerificationRecord;
    reordered.selectedComps = a.selectedComps.map(comp => Object.fromEntries(Object.entries(comp).reverse()) as unknown as typeof comp);
    expect(priceVerificationRecordHash(reordered)).toBe(priceVerificationRecordHash(a));
    expect(priceVerificationRecordHash(a)).toMatch(/^[0-9a-f]{64}$/);
    for (const [key, value] of Object.entries(a)) {
      if (key === "selectedComps") continue;
      const changed = { ...a, [key]: typeof value === "number" ? value + 1 : `${value}-changed` };
      expect(priceVerificationRecordHash(changed), key).not.toBe(priceVerificationRecordHash(a));
    }
    for (const [key, value] of Object.entries(a.selectedComps[0])) {
      const changed = structuredClone(a);
      Object.assign(changed.selectedComps[0], { [key]: typeof value === "number" ? value + 1 : `${value}-changed` });
      expect(priceVerificationRecordHash(changed), key).not.toBe(priceVerificationRecordHash(a));
    }
  });

  it("roundtrips both provenance links and attachments through workspace capture and apply", () => {
    for (const target of targets) save(record(target));
    useProjectStore.getState().setFinancialSource(P, { ...sources().salePricePerSqM!, document });
    const captured = captureProjectWorkspace(P)!;
    const restored = JSON.parse(JSON.stringify(captured));
    expect(validateProjectWorkspacePayload(restored, P).errors).toEqual([]);
    initialize(); applyProjectWorkspace(restored);
    expect(captureProjectWorkspace(P)).toEqual(captured);
    expectNoWrites(() => reset("sale"), /첨부/);
    expect(reset("acquisition")).toEqual({ sourceAction: "removed" });
    expect(validateProjectWorkspacePayload(captureProjectWorkspace(P)).errors).toEqual([]);
  });

  it("rejects malformed workspace markers, stale hashes, wrong owners and mismatched derived core fields", () => {
    save();
    const base = captureProjectWorkspace(P)!;
    const changes: Array<(workspace: ProjectWorkspacePayload) => void> = [
      workspace => { Object.assign(workspace.financialSources.acquisitionPrice!, { priceReviewOrigin: null }); },
      workspace => { Object.assign(workspace.financialSources.acquisitionPrice!, { priceReviewOrigin: {} }); },
      workspace => { Object.assign(workspace.financialSources.acquisitionPrice!.priceReviewOrigin!, { version: "future" }); },
      workspace => { workspace.financialSources.acquisitionPrice!.priceReviewOrigin!.projectId = FOREIGN; },
      workspace => { workspace.financialSources.acquisitionPrice!.priceReviewOrigin!.target = "sale"; },
      workspace => { workspace.financialSources.acquisitionPrice!.priceReviewOrigin!.recordHash = "0".repeat(64); },
      workspace => { delete workspace.priceVerifications.acquisition; },
      workspace => { workspace.priceVerifications.acquisition!.status = "review-requested"; },
      workspace => { workspace.priceVerifications.acquisition!.rationale = "Changed but same price"; },
      workspace => { workspace.priceVerifications.acquisition!.projectId = FOREIGN; },
      workspace => { workspace.priceVerifications.acquisition!.reviewer = ""; },
    ];
    for (const key of Object.keys(generated()).filter(key => key !== "priceReviewOrigin")) {
      changes.push(workspace => {
        const source = workspace.financialSources.acquisitionPrice!;
        Object.assign(source, { [key]: key === "value" ? source.value + 1 : "changed" });
      });
    }
    for (const change of changes) {
      const workspace = structuredClone(base); change(workspace);
      const result = validateProjectWorkspacePayload(workspace, P);
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toMatch(/가격 검토 출처/);
    }
  });

  it("accepts incomplete persisted drafts and old unmarked sources unchanged without global repair", () => {
    const workspace = projectWorkspaceFixture(P);
    const draft = record("acquisition", { status: "draft", selectedComps: [], reviewer: "", organization: "", rationale: "", verifiedAt: "" });
    const legacy = generated(record("sale")); delete legacy.priceReviewOrigin;
    workspace.priceVerifications = { acquisition: draft, sale: record("sale") };
    workspace.financialSources = { salePricePerSqM: legacy };
    const before = structuredClone(workspace);
    expect(validateProjectWorkspacePayload(workspace, P).errors).toEqual([]);
    expect(workspace).toEqual(before);
    applyProjectWorkspace(workspace);
    expect(captureProjectWorkspace(P)?.financialSources.salePricePerSqM).toBe(legacy);
    expect(reset()).toEqual({ sourceAction: "none" });
    expect(reviews().sale).toBe(workspace.priceVerifications.sale);
    expect(sources().salePricePerSqM).toBe(legacy);
    expect(legacy).not.toHaveProperty("priceReviewOrigin");
  });
});
