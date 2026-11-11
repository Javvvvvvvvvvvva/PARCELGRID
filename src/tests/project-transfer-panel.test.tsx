import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectTransferPanel } from "@/components/handoff/ProjectTransferPanel";
import type { ProjectTransferBundle } from "@/lib/handoff/project-transfer";
import type { DynamicProjectLoadResult } from "@/lib/hooks/use-dynamic-project";
import type { ProjectWorkspacePayload } from "@/lib/workspace/project-workspace";

type Props = React.ComponentProps<typeof ProjectTransferPanel>;
type Effect = { deps?: React.DependencyList; cleanup?: () => void; pending?: React.EffectCallback };
type TransferArgs = Parameters<typeof import("@/lib/handoff/project-transfer-client").prepareCurrentProjectTransfer>[0];
type QueryUpdater = (current: DynamicProjectLoadResult | undefined) => DynamicProjectLoadResult | undefined;
const harness = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as Effect[],
  stateCursor: 0, refCursor: 0, effectCursor: 0, running: false, changed: false, updates: 0,
  active: true, context: "session-a" as string | null, capabilities: [] as string[],
  activeProjectId: "P-100", sourceKey: "workspace-a",
  projectListeners: new Set<() => void>(), reviewListeners: new Set<() => void>(), sessionListeners: new Set<() => void>(),
  read: vi.fn<(file: File, signal: AbortSignal, projectId: string) => Promise<ProjectTransferBundle>>(),
  capture: vi.fn<(projectId: string, context: string | null) => ProjectTransferBundle>(),
  prepare: vi.fn<(args: TransferArgs) => void>(), apply: vi.fn<(args: TransferArgs) => ProjectWorkspacePayload>(),
  workspaceKey: vi.fn<(projectId: string) => string | null>(),
  setQueriesData: vi.fn<(filters: { queryKey: string[] }, updater: QueryUpdater) => void>(),
}));

vi.mock("react", async original => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      if (!harness.running) return actual.useState(initial);
      const index = harness.stateCursor++;
      if (!(index in harness.states)) harness.states[index] = typeof initial === "function" ? initial() : initial;
      return [harness.states[index], (next: unknown) => {
        harness.updates += 1;
        const value = typeof next === "function" ? next(harness.states[index]) : next;
        if (!Object.is(value, harness.states[index])) { harness.states[index] = value; harness.changed = true; }
      }];
    },
    useRef: (initial: unknown) => {
      if (!harness.running) return actual.useRef(initial);
      const index = harness.refCursor++;
      return harness.refs[index] ?? (harness.refs[index] = { current: initial });
    },
    useEffect: (callback: React.EffectCallback, deps?: React.DependencyList) => {
      if (!harness.running) return actual.useEffect(callback, deps);
      const index = harness.effectCursor++, previous = harness.effects[index];
      if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length ||
          deps.some((value, slot) => !Object.is(value, previous.deps![slot]))) {
        harness.effects[index] = { deps, cleanup: previous?.cleanup, pending: callback };
      }
    },
  };
});
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueriesData: harness.setQueriesData }) }));
vi.mock("@/lib/handoff/project-transfer-client", () => ({
  captureProjectTransferBundle: harness.capture,
  prepareCurrentProjectTransfer: harness.prepare,
  applyCurrentProjectTransfer: harness.apply,
  projectTransferWorkspaceKey: harness.workspaceKey,
}));
vi.mock("@/lib/handoff/project-transfer-import", () => ({ readProjectTransferFile: harness.read }));
vi.mock("@/lib/auth/client-session", () => ({ clientSession: {
  get active() { return harness.active; },
  get context() { return harness.context; },
  get principal() { return { capabilities: harness.capabilities }; },
  assertActive: () => { if (!harness.active) throw new Error("Session locked"); },
  subscribe: (listener: () => void) => {
    harness.sessionListeners.add(listener);
    return () => { harness.sessionListeners.delete(listener); };
  },
} }));
vi.mock("@/lib/stores/project-store", () => ({ useProjectStore: {
  subscribe: (listener: () => void) => {
    harness.projectListeners.add(listener);
    return () => { harness.projectListeners.delete(listener); };
  },
} }));
vi.mock("@/lib/stores/review-store", () => ({ useReviewStore: {
  subscribe: (listener: () => void) => {
    harness.reviewListeners.add(listener);
    return () => { harness.reviewListeners.delete(listener); };
  },
} }));

type Input = { files: File[]; value: string };
type Node = React.ReactElement<{
  children?: React.ReactNode; "aria-label"?: string; "data-transfer-preview"?: boolean;
  type?: string; disabled?: boolean; role?: string;
  onClick?: () => void; onChange?: (event: { target: Input; currentTarget: Input }) => void;
}>;
function nodes(node: React.ReactNode): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement(node)) return [];
  const element = node as Node;
  return [element, ...nodes(element.props.children)];
}
function content(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(content).join("");
  if (React.isValidElement(node)) return content((node.props as { children?: React.ReactNode }).children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
function findButton(tree: React.ReactNode, label: string) {
  return nodes(tree).find(node => node.type === "button" && content(node) === label);
}
function button(tree: React.ReactNode, label: string) {
  const found = findButton(tree, label);
  expect(found, `button: ${label}`).toBeDefined();
  return found!;
}
function click(tree: React.ReactNode, label: string) {
  const node = button(tree, label);
  expect(node.props.disabled).not.toBe(true);
  node.props.onClick!();
}
function fileInput(tree: React.ReactNode) {
  const found = nodes(tree).find(node => node.type === "input" && node.props["aria-label"] === "프로젝트 인계 JSON 파일");
  expect(found).toBeDefined();
  return found!;
}
function chooseFile(node: Node, name = "handoff.json") {
  const file = new File(["{}"], name, { type: "application/json" });
  const input: Input = { files: [file], value: name };
  node.props.onChange!({ target: input, currentTarget: input });
  expect(input.value).toBe("");
  return file;
}
function preview(tree: React.ReactNode) { return nodes(tree).find(node => node.props["data-transfer-preview"]); }
function messages(tree: React.ReactNode, role: string) {
  return nodes(tree).filter(node => node.props.role === role).map(content).join(" ");
}
function emit(listeners: Set<() => void>) { for (const listener of listeners) listener(); }
function unmount() {
  for (const effect of harness.effects) effect.cleanup?.();
  harness.states = []; harness.refs = []; harness.effects = [];
}
function render(props: Props): React.ReactElement {
  // Match the existing panel harness: invoke the keyed editor and flush dependency-aware effects.
  for (let pass = 0; pass < 12; pass++) {
    harness.stateCursor = 0; harness.refCursor = 0; harness.effectCursor = 0;
    harness.changed = false; harness.running = true;
    let tree: React.ReactElement;
    try {
      const wrapper = ProjectTransferPanel(props);
      tree = (wrapper.type as (props: Props) => React.ReactElement)(wrapper.props as Props);
    } finally { harness.running = false; }
    for (const effect of harness.effects) {
      if (!effect.pending) continue;
      effect.cleanup?.();
      const callback = effect.pending; effect.pending = undefined;
      effect.cleanup = callback() || undefined;
    }
    if (!harness.changed) return tree;
  }
  throw new Error("Transfer panel effects did not settle");
}

const PROJECT = "P-100", EXPORT = "인계 패키지 저장", IMPORT = "패키지 가져오기";
const APPLY = "패키지 적용", CANCEL = "가져오기 취소", BUSY = "인계 패키지 확인 중";
function bundle(): ProjectTransferBundle {
  return {
    format: "parcelgrid-project-transfer", version: 2, projectId: PROJECT,
    exportedAt: "2026-11-11T00:00:00.000Z", checksum: "AB12CD34",
    payload: {
      projectData: null, envelopePlan: null, planningScenarios: [], selectedScenarioId: null,
      representativeScenarioId: null, representativeGeometry: null, draftAssumptions: {},
      draftAcquisitionPrice: null, financialSources: {}, expertTaxContracts: [], stage3Snapshot: null,
      priceVerifications: {}, expertReviews: {}, leaseRollDrafts: [], operatingBudgetDrafts: [],
      revenuePricingDrafts: [], pendingOverrides: [],
    },
  };
}
function setup() {
  const draw = () => render({ projectId: PROJECT });
  const imported = bundle();
  const applied: ProjectWorkspacePayload = {
    ...imported.payload, version: "project-workspace-2026.1", projectId: PROJECT,
    // Only parcel identity is consumed at this mocked client/query boundary.
    projectData: { parcel: { id: PROJECT, address: "Imported parcel" }, scenarios: [] } as unknown as ProjectWorkspacePayload["projectData"],
    representativeParcelBasisHash: null, revenuePricingDrafts: [], pendingOverrides: [],
  };
  harness.capture.mockReturnValue(imported);
  harness.apply.mockReturnValue(applied);
  draw();
  return { draw, imported, applied, args: { bundle: imported, projectId: PROJECT, sessionContext: "session-a", expectedWorkspaceKey: "workspace-a" } };
}
type Fixture = ReturnType<typeof setup>;
async function importPreview(f: Fixture, imported = f.imported, name = "handoff.json") {
  harness.read.mockResolvedValueOnce(imported);
  const input = fileInput(f.draw());
  expect(input.props.disabled).toBe(false);
  chooseFile(input, name);
  await Promise.resolve();
  return f.draw();
}
function pendingRead(f: Fixture, name = "handoff.json", input = fileInput(f.draw())) {
  let resolve!: (value: ProjectTransferBundle) => void, reject!: (error: unknown) => void;
  harness.read.mockImplementationOnce(() => new Promise((accept, fail) => { resolve = accept; reject = fail; }));
  const file = chooseFile(input, name);
  const signal = harness.read.mock.calls.at(-1)![1];
  expect(signal.aborted).toBe(false);
  expect(harness.read).toHaveBeenLastCalledWith(file, signal, PROJECT);
  expect(messages(f.draw(), "status")).toContain(BUSY);
  return { resolve, reject, signal };
}
function invalidate(kind: "active project" | "project source" | "review source") {
  if (kind === "active project") harness.activeProjectId = "P-200";
  else harness.sourceKey = "workspace-b";
  emit(kind === "review source" ? harness.reviewListeners : harness.projectListeners);
}
function expectNoApply() {
  expect(harness.apply).not.toHaveBeenCalled(); expect(harness.setQueriesData).not.toHaveBeenCalled();
}
function expectNoServerSaveClaim(tree: React.ReactNode) {
  expect(messages(tree, "status")).not.toMatch(/서버(?:에|로)?\s*(?:자동(?:으로)?\s*)?저장(?:이|을)?\s*(?:됐|되었|완료|성공|했습니다)|server[- ]saved|saved (?:automatically )?to (?:the )?server/i);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("window", { confirm: vi.fn(() => true) });
  vi.stubGlobal("document", { createElement: vi.fn(() => ({ href: "", download: "", click: vi.fn() })) });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:handoff");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  harness.active = true; harness.context = "session-a"; harness.capabilities = ["project.read", "project.update"];
  harness.activeProjectId = PROJECT; harness.sourceKey = "workspace-a";
  harness.workspaceKey.mockImplementation(projectId => projectId === harness.activeProjectId ? harness.sourceKey : null);
  harness.projectListeners.clear(); harness.reviewListeners.clear(); harness.sessionListeners.clear();
  harness.states = []; harness.refs = []; harness.effects = [];
  harness.running = false; harness.changed = false; harness.updates = 0;
});
afterEach(() => { unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("ProjectTransferPanel explicit local workflow", () => {
  it("keeps a validated preview inert and discards it on cancellation", async () => {
    const f = setup();
    expect(preview(f.draw())).toBeUndefined();
    expect(content(f.draw())).toContain("저장된 초안 기준");
    const tree = await importPreview(f);
    expect(harness.prepare.mock.calls).toEqual([[f.args]]);
    expect(content(preview(tree))).toContain("handoff.json");
    expect(content(preview(tree))).toContain(PROJECT);
    expect(content(preview(tree))).toContain(f.imported.exportedAt);
    expect(content(preview(tree))).toContain("아직 적용되지 않았습니다");
    expect(content(preview(tree))).toContain("출처 진위나 전문가 승인이 아닙니다");
    expect(messages(tree, "note")).toBe("");
    expect(window.confirm).not.toHaveBeenCalled(); expectNoApply(); expectNoServerSaveClaim(tree);
    click(tree, CANCEL);
    expect(preview(f.draw())).toBeUndefined();
    expect(findButton(f.draw(), APPLY)).toBeUndefined();
    expect(messages(f.draw(), "status")).toBe(""); expectNoApply();
  });

  it("applies only after explicit confirmation and reports local application with server status unverified", async () => {
    const f = setup();
    const tree = await importPreview(f);
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click(tree, APPLY);
    expect(window.confirm).toHaveBeenCalledOnce(); expectNoApply();
    expect(preview(f.draw())).toBeDefined();
    expect(messages(f.draw(), "status")).toBe("");
    vi.mocked(window.confirm).mockImplementationOnce(() => { expectNoApply(); return true; });
    click(f.draw(), APPLY);
    expect(window.confirm).toHaveBeenCalledTimes(2);
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining("패키지에 없는 초안은 삭제"));
    expect(harness.prepare).toHaveBeenCalledTimes(3);
    expect(harness.prepare).toHaveBeenLastCalledWith(f.args);
    expect(harness.apply.mock.calls).toEqual([[f.args]]);
    const applied = f.draw();
    expect(preview(applied)).toBeUndefined();
    expect(messages(applied, "status")).toContain("로컬 프로젝트에 적용했습니다. 서버 저장 상태를 확인하세요.");
    expect(messages(applied, "status")).toContain("원문 파일은 다시 업로드해야");
    expect(messages(applied, "status")).toContain("공식 경계·허가·전문가 승인은 확정되지 않습니다");
    expectNoServerSaveClaim(applied);
  });

  it("updates only matching cached project data while preserving the workspace revision baseline and local draft", async () => {
    const f = setup(), tree = await importPreview(f);
    click(tree, APPLY);
    expect(harness.apply.mock.calls).toEqual([[f.args]]);
    expect(harness.setQueriesData.mock.calls).toEqual([[{ queryKey: ["dynamic-project", PROJECT] }, expect.any(Function)]]);
    const updater = harness.setQueriesData.mock.calls[0][1];
    const previousData = { ...f.applied.projectData, parcel: { ...f.applied.projectData.parcel, address: "Previous parcel" } };
    const baseline = { ...f.applied, projectData: previousData };
    const current: DynamicProjectLoadResult = {
      data: previousData, source: "server-workspace",
      workspace: {
        version: baseline.version, projectId: PROJECT, revision: 7, payloadHash: "server-payload",
        payload: baseline, savedAt: "2026-11-10T00:00:00.000Z", savedBy: "owner",
        auditHash: "server-audit", backend: "postgresql",
      },
      localDraft: { version: 1, draftId: "local-draft", baseRevision: 7, payload: baseline },
    };
    const before = structuredClone(current), updated = updater(current);
    expect(updated).toEqual({ ...current, data: f.applied.projectData });
    expect(updated).not.toBe(current); expect(updated?.data).toBe(f.applied.projectData);
    expect(updated?.workspace).toBe(current.workspace);
    expect(updated?.workspace?.payload).toBe(baseline); expect(updated?.workspace?.revision).toBe(7);
    expect(updated?.localDraft).toBe(current.localDraft); expect(updated?.localDraft?.baseRevision).toBe(7);
    expect(updated?.source).toBe("server-workspace"); expect(current).toEqual(before);
    const foreign = { ...current, data: { ...previousData, parcel: { ...previousData.parcel, id: "P-200" } } };
    const foreignBefore = structuredClone(foreign);
    expect(updater(foreign)).toBe(foreign); expect(foreign).toEqual(foreignBefore);
    expect(updater(undefined)).toBeUndefined(); expectNoServerSaveClaim(f.draw());
  });

  it("warns that omitted legacy collections will be cleared only when applied", async () => {
    const f = setup();
    delete f.imported.payload.leaseRollDrafts;
    delete f.imported.payload.operatingBudgetDrafts;
    delete f.imported.payload.revenuePricingDrafts;
    delete f.imported.payload.pendingOverrides;
    const tree = await importPreview(f);
    expect(messages(tree, "note")).toContain("구형 패키지의 누락 항목: 임대차, 운영비, 단가, 미반영 가정");
    expect(messages(tree, "note")).toContain("적용하면 현재 프로젝트의 해당 항목은 비워집니다");
    expect(button(tree, APPLY).props.disabled).toBe(false); expectNoApply();
  });

  it.each(["read", "prepare"] as const)("reports %s errors without exposing an applicable preview and permits retry", async stage => {
    const f = setup(), message = stage === "read" ? "Invalid transfer checksum" : "Workspace changed";
    if (stage === "read") harness.read.mockRejectedValueOnce(new Error(message));
    else {
      harness.read.mockResolvedValueOnce(f.imported);
      harness.prepare.mockImplementationOnce(() => { throw new Error(message); });
    }
    chooseFile(fileInput(f.draw()));
    await Promise.resolve();
    const tree = f.draw();
    expect(messages(tree, "alert")).toBe(message);
    expect(messages(tree, "status")).toBe("");
    expect(preview(tree)).toBeUndefined(); expect(findButton(tree, APPLY)).toBeUndefined();
    expect(button(tree, IMPORT).props.disabled).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled(); expectNoApply();
    const retried = await importPreview(f);
    expect(preview(retried)).toBeDefined(); expect(messages(retried, "alert")).toBe(""); expectNoApply();
  });

  it("reports an apply helper failure without claiming a successful save", async () => {
    const f = setup(), tree = await importPreview(f);
    harness.apply.mockImplementationOnce(() => { throw new Error("Replacement rejected"); });
    click(tree, APPLY);
    expect(harness.apply.mock.calls).toEqual([[f.args]]);
    expect(messages(f.draw(), "alert")).toBe("Replacement rejected");
    expect(messages(f.draw(), "status")).toBe("");
    expect(harness.setQueriesData).not.toHaveBeenCalled();
    expect(preview(f.draw())).toBeDefined(); expectNoServerSaveClaim(f.draw());
  });

  it("allows read-only export while disabling both import controls", async () => {
    harness.capabilities = ["project.read"];
    const f = setup(), tree = f.draw();
    expect(button(tree, EXPORT).props.disabled).toBe(false);
    expect(button(tree, IMPORT).props.disabled).toBe(true); expect(fileInput(tree).props.disabled).toBe(true);
    click(tree, EXPORT);
    expect(harness.capture.mock.calls).toEqual([[PROJECT, "session-a"]]);
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json"); expect(JSON.parse(await blob.text())).toEqual(f.imported);
    expect(vi.mocked(document.createElement).mock.calls).toEqual([["a"]]);
    const anchor = vi.mocked(document.createElement).mock.results[0].value;
    expect(anchor).toMatchObject({ href: "blob:handoff", download: `parcelgrid-${PROJECT}-handoff.json` });
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls).toEqual([["blob:handoff"]]);
    expect(messages(f.draw(), "status")).toContain("원문 첨부와 서버 승인 기록은 제외됩니다");
    expect(harness.read).not.toHaveBeenCalled(); expectNoApply(); expectNoServerSaveClaim(f.draw());
    chooseFile(fileInput(tree));
    await Promise.resolve();
    expect(harness.read).not.toHaveBeenCalled();
    expect(messages(f.draw(), "alert")).toContain("프로젝트 인계 권한이 없습니다"); expectNoApply();
  });

  it("disables export as well when project read access is absent", () => {
    harness.capabilities = [];
    const f = setup(), tree = f.draw();
    expect(button(tree, EXPORT).props.disabled).toBe(true);
    expect(button(tree, IMPORT).props.disabled).toBe(true); expect(fileInput(tree).props.disabled).toBe(true);
    expect(harness.capture).not.toHaveBeenCalled(); expect(harness.read).not.toHaveBeenCalled(); expectNoApply();
  });

  it.each([new Error("Export unavailable"), "unexpected failure"])("reports export errors safely (%s)", error => {
    const f = setup();
    harness.capture.mockImplementationOnce(() => { throw error; });
    click(f.draw(), EXPORT);
    expect(messages(f.draw(), "alert")).toBe(error instanceof Error ? error.message : "인계 패키지를 처리하지 못했습니다.");
    expect(messages(f.draw(), "status")).toBe("");
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expectNoApply(); expectNoServerSaveClaim(f.draw());
  });

  it("rejects an import when the panel's project is no longer available", async () => {
    const f = setup();
    harness.activeProjectId = "P-200";
    chooseFile(fileInput(f.draw()));
    await Promise.resolve();
    expect(harness.read).not.toHaveBeenCalled();
    expect(messages(f.draw(), "alert")).toContain("현재 프로젝트를 먼저 불러와야"); expectNoApply();
  });
});

describe("ProjectTransferPanel read and confirmation races", () => {
  it("cancels an in-flight read and ignores its late completion", async () => {
    const f = setup(), pending = pendingRead(f), tree = f.draw();
    expect(button(tree, EXPORT).props.disabled).toBe(true);
    expect(button(tree, IMPORT).props.disabled).toBe(true); expect(fileInput(tree).props.disabled).toBe(true);
    click(tree, CANCEL);
    expect(pending.signal.aborted).toBe(true);
    expect(messages(f.draw(), "status")).toBe("");
    pending.resolve(f.imported);
    await Promise.resolve();
    expect(preview(f.draw())).toBeUndefined(); expect(messages(f.draw(), "alert")).toBe("");
    expect(button(f.draw(), IMPORT).props.disabled).toBe(false);
    expect(harness.prepare).not.toHaveBeenCalled(); expectNoApply();
  });

  it.each(["expiry", "account change"] as const)("aborts a streaming read on session %s without a late preview", async kind => {
    const f = setup(), pending = pendingRead(f), abort = vi.fn();
    pending.signal.addEventListener("abort", abort, { once: true });
    if (kind === "expiry") { harness.active = false; harness.context = null; }
    else harness.context = "session-b";
    emit(harness.sessionListeners);
    expect(pending.signal.aborted).toBe(true); expect(abort).toHaveBeenCalledOnce();
    pending.resolve(f.imported);
    await Promise.resolve();
    const tree = f.draw();
    expect(messages(tree, "alert")).toBe("로그인 세션이 만료됐습니다.");
    expect(preview(tree)).toBeUndefined(); expect(messages(tree, "status")).toBe("");
    expect(findButton(tree, IMPORT)).toBeUndefined();
    expect(harness.prepare).not.toHaveBeenCalled(); expectNoApply();
  });

  it.each(["resolve", "reject"] as const)("aborts and unsubscribes on unmount without late %s state updates", async outcome => {
    const f = setup(), pending = pendingRead(f);
    expect(harness.projectListeners.size).toBe(1); expect(harness.reviewListeners.size).toBe(1);
    expect(harness.sessionListeners.size).toBe(1);
    unmount();
    const updates = harness.updates;
    expect(pending.signal.aborted).toBe(true);
    expect(harness.projectListeners.size).toBe(0); expect(harness.reviewListeners.size).toBe(0);
    expect(harness.sessionListeners.size).toBe(0);
    if (outcome === "resolve") pending.resolve(f.imported);
    else pending.reject(new Error("Late read failure"));
    await Promise.resolve();
    expect(harness.updates).toBe(updates);
    expect(harness.prepare).not.toHaveBeenCalled(); expectNoApply();
  });

  it.each(["active project", "project source", "review source"] as const)("invalidates an in-flight read after an %s change", async kind => {
    const f = setup(), pending = pendingRead(f);
    invalidate(kind);
    expect(pending.signal.aborted).toBe(true);
    expect(messages(f.draw(), "status")).toBe("");
    pending.resolve(f.imported);
    await Promise.resolve();
    expect(preview(f.draw())).toBeUndefined(); expect(messages(f.draw(), "alert")).toBe("");
    expect(harness.prepare).not.toHaveBeenCalled(); expectNoApply();
  });

  it.each(["active project", "project source", "review source"] as const)("clears a visible preview after an %s change", async kind => {
    const f = setup();
    expect(preview(await importPreview(f))).toBeDefined();
    invalidate(kind);
    const tree = f.draw();
    expect(preview(tree)).toBeUndefined(); expect(findButton(tree, APPLY)).toBeUndefined();
    expect(messages(tree, "status")).toBe(""); expect(messages(tree, "alert")).toBe("");
    expect(window.confirm).not.toHaveBeenCalled(); expectNoApply();
  });

  it("preserves the preview for store notifications that do not change its workspace key", async () => {
    const f = setup();
    await importPreview(f);
    emit(harness.projectListeners); emit(harness.reviewListeners);
    expect(preview(f.draw())).toBeDefined();
    click(f.draw(), APPLY);
    expect(harness.apply.mock.calls).toEqual([[f.args]]);
  });

  it.each(["resolve", "reject"] as const)("keeps the newer preview when a superseded read completes out of order with %s", async outcome => {
    const f = setup(), handler = fileInput(f.draw());
    const first = pendingRead(f, "older.json", handler);
    // Invoke the captured handler directly to exercise overlapping events despite the busy control.
    const second = pendingRead(f, "newer.json", handler);
    expect(first.signal.aborted).toBe(true); expect(second.signal.aborted).toBe(false);
    const newer = { ...bundle(), exportedAt: "2026-11-12T00:00:00.000Z" };
    second.resolve(newer);
    await Promise.resolve();
    expect(content(preview(f.draw()))).toContain("newer.json");
    if (outcome === "resolve") first.resolve(f.imported);
    else first.reject(new Error("Stale read failed"));
    await Promise.resolve();
    const tree = f.draw();
    expect(content(preview(tree))).toContain("newer.json");
    expect(content(preview(tree))).not.toContain("older.json");
    expect(content(preview(tree))).toContain(newer.exportedAt);
    expect(messages(tree, "alert")).toBe(""); expect(messages(tree, "status")).toBe("");
    expect(harness.prepare.mock.calls).toEqual([[{ ...f.args, bundle: newer }]]); expectNoApply();
    click(tree, APPLY);
    expect(harness.apply.mock.calls).toEqual([[{ ...f.args, bundle: newer }]]);
  });

  it("keeps the newer read busy when a superseded read settles first", async () => {
    const f = setup(), handler = fileInput(f.draw());
    const first = pendingRead(f, "older.json", handler), second = pendingRead(f, "newer.json", handler);
    first.resolve(f.imported);
    await Promise.resolve();
    expect(messages(f.draw(), "status")).toBe(BUSY);
    expect(fileInput(f.draw()).props.disabled).toBe(true); expect(preview(f.draw())).toBeUndefined();
    expect(harness.prepare).not.toHaveBeenCalled();
    second.resolve(bundle());
    await Promise.resolve();
    expect(content(preview(f.draw()))).toContain("newer.json"); expectNoApply();
  });

  it("rechecks capability through the prepare helper even for a previously enabled apply handler", async () => {
    const f = setup(), tree = await importPreview(f), apply = button(tree, APPLY).props.onClick!;
    harness.capabilities = ["project.read"];
    harness.prepare.mockImplementationOnce(() => { throw new Error("프로젝트 인계 권한이 없습니다."); });
    expect(button(f.draw(), APPLY).props.disabled).toBe(true);
    apply();
    expect(harness.prepare).toHaveBeenCalledTimes(2); expect(harness.prepare).toHaveBeenLastCalledWith(f.args);
    expect(window.confirm).not.toHaveBeenCalled(); expectNoApply();
    expect(messages(f.draw(), "alert")).toBe("프로젝트 인계 권한이 없습니다.");
    expectNoServerSaveClaim(f.draw());
  });

  it("surfaces apply helper rejection when capability is lost during confirmation", async () => {
    const f = setup(), tree = await importPreview(f);
    vi.mocked(window.confirm).mockImplementationOnce(() => { harness.capabilities = ["project.read"]; return true; });
    harness.apply.mockImplementationOnce(() => {
      expect(harness.capabilities).not.toContain("project.update");
      throw new Error("프로젝트 인계 권한이 없습니다.");
    });
    click(tree, APPLY);
    expect(harness.apply.mock.calls).toEqual([[f.args]]);
    expect(messages(f.draw(), "alert")).toBe("프로젝트 인계 권한이 없습니다.");
    expect(messages(f.draw(), "status")).toBe("");
    expect(harness.setQueriesData).not.toHaveBeenCalled(); expectNoServerSaveClaim(f.draw());
  });

  it.each(["project source", "review source"] as const)("blocks the stale apply callback when the %s changes during confirmation", async kind => {
    const f = setup(), tree = await importPreview(f);
    vi.mocked(window.confirm).mockImplementationOnce(() => { invalidate(kind); return true; });
    click(tree, APPLY);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(harness.prepare).toHaveBeenCalledTimes(2); expectNoApply();
    const changed = f.draw();
    expect(preview(changed)).toBeUndefined();
    expect(messages(changed, "alert")).toContain("계정 또는 프로젝트 내용이 변경됐습니다");
    expect(messages(changed, "status")).toBe(""); expectNoServerSaveClaim(changed);
  });
});
