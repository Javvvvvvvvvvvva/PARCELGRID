import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicAccessPrincipal } from "@/lib/auth/client-session";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const PROJECT_ID = "workspace-draft-project";
const OTHER_PROJECT_ID = "workspace-draft-other-project";
const account: PublicAccessPrincipal = {
  userId: "user-a",
  orgId: "org-a",
  role: "analyst",
  reviewerRoles: [],
  name: "A",
  email: "a@example.com",
  organization: "Organization A",
  capabilities: ["project.read", "project.update"],
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

async function freshDocument(
  sessionStorage: ReturnType<typeof memoryStorage>,
  principal = account,
) {
  vi.resetModules();
  vi.stubGlobal("window", { sessionStorage });
  const { clientSession } = await import("@/lib/auth/client-session");
  clientSession.activate(principal);
  const drafts = await import("@/lib/workspace/workspace-draft");
  return { clientSession, ...drafts };
}

function persistedDraft(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    version: 1,
    draftId: "persisted-draft-id",
    baseRevision: 7,
    payload: projectWorkspaceFixture(PROJECT_ID),
    ...overrides,
  });
}

describe("workspace draft recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([0, 7])(
    "restores the complete snapshot and base revision %s after a document reload",
    async (baseRevision) => {
      const storage = memoryStorage();
      const first = await freshDocument(storage);
      expect(first.readWorkspaceDraft(PROJECT_ID)).toBeNull();

      const payload = projectWorkspaceFixture(PROJECT_ID);
      payload.draftAcquisitionPrice = 123_456;
      payload.draftAssumptions = { "FINANCE-S1": { salePricePerSqM: 8_800_000 } };
      const written = first.writeWorkspaceDraft(payload, baseRevision);
      expect(written).toEqual({
        version: 1,
        draftId: expect.any(String),
        baseRevision,
        payload,
      });
      expect(written.draftId).not.toBe("");
      expect(first.readWorkspaceDraft(PROJECT_ID)).toEqual(written);

      const reloaded = await freshDocument(storage);
      expect(reloaded.clientSession).not.toBe(first.clientSession);
      expect(reloaded.readWorkspaceDraft(PROJECT_ID)).toEqual(written);
      expect(reloaded.readWorkspaceDraft(PROJECT_ID)?.payload).not.toBe(payload);
    },
  );

  it("persists a replacement draft with its new base revision", async () => {
    const storage = memoryStorage();
    const document = await freshDocument(storage);
    const original = document.writeWorkspaceDraft(projectWorkspaceFixture(PROJECT_ID), 4);
    const payload = projectWorkspaceFixture(PROJECT_ID, "updated-model");
    payload.draftAcquisitionPrice = 654_321;
    const updated = document.writeWorkspaceDraft(payload, 5);

    expect(updated.draftId).not.toBe(original.draftId);
    const reloaded = await freshDocument(storage);
    expect(reloaded.readWorkspaceDraft(PROJECT_ID)).toEqual(updated);
    expect(reloaded.readWorkspaceDraft(PROJECT_ID)?.baseRevision).toBe(5);
  });

  it.each([
    ["user", { ...account, userId: "user-b" }],
    ["organization", { ...account, orgId: "org-b" }],
  ] satisfies [string, PublicAccessPrincipal][])(
    "isolates the same project across a different %s in the same tab",
    async (_dimension, otherAccount) => {
      const storage = memoryStorage();
      const first = await freshDocument(storage);
      const original = first.writeWorkspaceDraft(projectWorkspaceFixture(PROJECT_ID, "account-a"), 3);
      first.clientSession.invalidate();

      const second = await freshDocument(storage, otherAccount);
      expect(second.readWorkspaceDraft(PROJECT_ID)).toBeNull();
      const other = second.writeWorkspaceDraft(projectWorkspaceFixture(PROJECT_ID, "account-b"), 8);
      expect(second.readWorkspaceDraft(PROJECT_ID)).toEqual(other);
      second.clientSession.invalidate();

      const originalAccount = await freshDocument(storage);
      expect(originalAccount.readWorkspaceDraft(PROJECT_ID)).toEqual(original);
      originalAccount.clearWorkspaceDraft(PROJECT_ID);
      originalAccount.clientSession.invalidate();

      const otherAgain = await freshDocument(storage, otherAccount);
      expect(otherAgain.readWorkspaceDraft(PROJECT_ID)).toEqual(other);
    },
  );

  it("keeps separate tab storage independent for the same account and project", async () => {
    const firstStorage = memoryStorage();
    const secondStorage = memoryStorage();
    const firstTab = await freshDocument(firstStorage);
    const original = firstTab.writeWorkspaceDraft(projectWorkspaceFixture(PROJECT_ID, "first-tab"), 2);

    const secondTab = await freshDocument(secondStorage);
    expect(secondTab.readWorkspaceDraft(PROJECT_ID)).toBeNull();
    const other = secondTab.writeWorkspaceDraft(projectWorkspaceFixture(PROJECT_ID, "second-tab"), 6);

    const firstReloaded = await freshDocument(firstStorage);
    expect(firstReloaded.readWorkspaceDraft(PROJECT_ID)).toEqual(original);
    const secondReloaded = await freshDocument(secondStorage);
    expect(secondReloaded.readWorkspaceDraft(PROJECT_ID)).toEqual(other);
  });

  it("retains a readable memory draft when persistence fails and surfaces the storage error", async () => {
    const storage = memoryStorage();
    const document = await freshDocument(storage);
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const storageError = new DOMException("Storage is full", "QuotaExceededError");
    storage.setItem.mockImplementationOnce(() => { throw storageError; });

    expect(() => document.writeWorkspaceDraft(payload, 9)).toThrow(storageError);
    expect(storage.values.size).toBe(0);
    expect(document.readWorkspaceDraft(PROJECT_ID)).toMatchObject({ payload, baseRevision: 9 });
    expect(storage.getItem).not.toHaveBeenCalled();

    document.clientSession.invalidate();
    expect(document.readWorkspaceDraft(PROJECT_ID)).toBeNull();
    expect(() => document.writeWorkspaceDraft(payload, 10)).toThrow(expect.objectContaining({ name: "AbortError" }));
    const reloaded = await freshDocument(storage);
    expect(reloaded.readWorkspaceDraft(PROJECT_ID)).toBeNull();
  });

  it("blocks old document callbacks after invalidation without changing persisted recovery", async () => {
    const storage = memoryStorage();
    const document = await freshDocument(storage);
    const payload = projectWorkspaceFixture(PROJECT_ID);
    const original = document.writeWorkspaceDraft(payload, 11);
    const savedBytes = new Map(storage.values);
    storage.getItem.mockClear();
    storage.setItem.mockClear();
    storage.removeItem.mockClear();

    document.clientSession.invalidate();
    expect(document.readWorkspaceDraft(PROJECT_ID)).toBeNull();
    expect(() => document.writeWorkspaceDraft(payload, 12)).toThrow(expect.objectContaining({ name: "AbortError" }));
    document.clearWorkspaceDraft(PROJECT_ID);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.values).toEqual(savedBytes);

    const reloaded = await freshDocument(storage);
    expect(reloaded.readWorkspaceDraft(PROJECT_ID)).toEqual(original);
    expect(document.readWorkspaceDraft(PROJECT_ID)).toBeNull();
    expect(() => document.writeWorkspaceDraft(payload, 12)).toThrow(expect.objectContaining({ name: "AbortError" }));
    expect(reloaded.readWorkspaceDraft(PROJECT_ID)).toEqual(original);
  });

  it("evicts the memory-only snapshot when the session is invalidated", async () => {
    const storage = memoryStorage();
    storage.setItem.mockImplementation(() => undefined);
    const document = await freshDocument(storage);
    const written = document.writeWorkspaceDraft(projectWorkspaceFixture(PROJECT_ID), 2);
    expect(document.readWorkspaceDraft(PROJECT_ID)).toEqual(written);
    expect(storage.values.size).toBe(0);

    document.clientSession.invalidate();
    // Bypass only the read guard to distinguish cache eviction from access denial.
    const active = vi.spyOn(document.clientSession, "active", "get").mockReturnValue(true);
    try {
      expect(document.readWorkspaceDraft(PROJECT_ID)).toBeNull();
    } finally {
      active.mockRestore();
    }
  });

  it.each([
    ["malformed JSON", "{"],
    ["null record", "null"],
    ["unsupported version", persistedDraft({ version: 2 })],
    ["missing draft ID", persistedDraft({ draftId: undefined })],
    ["negative base revision", persistedDraft({ baseRevision: -1 })],
    ["fractional base revision", persistedDraft({ baseRevision: 1.5 })],
    ["unsafe base revision", persistedDraft({ baseRevision: Number.MAX_SAFE_INTEGER + 1 })],
    ["missing payload", persistedDraft({ payload: undefined })],
    ["invalid payload", persistedDraft({ payload: { projectId: PROJECT_ID } })],
    ["cross-project payload", persistedDraft({ payload: projectWorkspaceFixture(OTHER_PROJECT_ID) })],
  ])("rejects %s without deleting or overwriting the persisted bytes", async (_name, raw) => {
    const storage = memoryStorage();
    const document = await freshDocument(storage);
    const key = document.clientSession.storageKey(`parcelgrid:workspace-draft:${PROJECT_ID}`)!;
    storage.values.set(key, raw);

    expect(() => document.readWorkspaceDraft(PROJECT_ID)).toThrow();
    expect(() => document.readWorkspaceDraft(PROJECT_ID)).toThrow();
    expect(storage.values.get(key)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();

    const reloaded = await freshDocument(storage);
    expect(() => reloaded.readWorkspaceDraft(PROJECT_ID)).toThrow();
    expect(storage.values.get(key)).toBe(raw);
    expect(reloaded.readWorkspaceDraft(OTHER_PROJECT_ID)).toBeNull();
  });

  it("clears one project from memory and storage while preserving another across reload", async () => {
    const storage = memoryStorage();
    const document = await freshDocument(storage);
    document.writeWorkspaceDraft(projectWorkspaceFixture(PROJECT_ID), 1);
    const other = document.writeWorkspaceDraft(projectWorkspaceFixture(OTHER_PROJECT_ID), 4);

    document.clearWorkspaceDraft(PROJECT_ID);
    document.clearWorkspaceDraft(PROJECT_ID);
    expect(document.readWorkspaceDraft(PROJECT_ID)).toBeNull();
    expect(document.readWorkspaceDraft(OTHER_PROJECT_ID)).toEqual(other);

    const reloaded = await freshDocument(storage);
    expect(reloaded.readWorkspaceDraft(PROJECT_ID)).toBeNull();
    expect(reloaded.readWorkspaceDraft(OTHER_PROJECT_ID)).toEqual(other);
  });
});
