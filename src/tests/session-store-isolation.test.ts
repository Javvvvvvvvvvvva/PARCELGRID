import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicAccessPrincipal } from "@/lib/auth/client-session";
import { principalSessionContext } from "@/lib/auth/session-context";

const account: PublicAccessPrincipal = {
  userId: "user-a", orgId: "org-a", role: "analyst", reviewerRoles: [],
  name: "A", email: "a@example.com", organization: "A", capabilities: ["project.read"],
};

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

describe("persisted customer stores", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("quarantines legacy data, waits for authentication, and restores only this account", async () => {
    vi.resetModules();
    const localStorage = memoryStorage();
    const sessionStorage = memoryStorage();
    vi.stubGlobal("window", { localStorage, sessionStorage });
    const legacy = JSON.stringify({ state: { draftAcquisitionPrices: { parcel: 111 } }, version: 0 });
    localStorage.setItem("parcelgrid-envelope", legacy);
    const key = `parcelgrid:scoped:v1:${principalSessionContext(account)}:parcelgrid-envelope`;
    localStorage.setItem(key, JSON.stringify({ state: { draftAcquisitionPrices: { parcel: 222 } }, version: 0 }));
    const { clientSession, sessionLocalStorage, sessionDraftStorage } = await import("@/lib/auth/client-session");
    const { useProjectStore } = await import("@/lib/stores/project-store");
    const { useReviewStore } = await import("@/lib/stores/review-store");
    expect(useProjectStore.getState().draftAcquisitionPrices).toEqual({});
    expect(useProjectStore.persist.hasHydrated()).toBe(false);
    clientSession.activate(account);
    await useProjectStore.persist.rehydrate();
    await useReviewStore.persist.rehydrate();
    expect(useProjectStore.getState().draftAcquisitionPrices).toEqual({ parcel: 222 });
    useProjectStore.getState().setDraftAcquisitionPrice("parcel", 333);
    sessionLocalStorage.setItem("render:parcel", "image metadata");
    sessionDraftStorage.setItem("parcelgrid:draft-parcel", "draft");
    const saved = localStorage.getItem(key);
    expect(JSON.parse(saved!).state.draftAcquisitionPrices).toEqual({ parcel: 333 });
    clientSession.invalidate();
    useProjectStore.setState(useProjectStore.getInitialState(), true);
    useReviewStore.setState(useReviewStore.getInitialState(), true);
    sessionLocalStorage.setItem("render:parcel", "stale callback");
    expect(localStorage.getItem(key)).toBe(saved);
    expect(localStorage.getItem("parcelgrid-envelope")).toBe(legacy);
    expect(sessionLocalStorage.getItem("render:parcel")).toBeNull();
    expect(sessionDraftStorage.getItem("parcelgrid:draft-parcel")).toBeNull();

    // A fresh document for another customer shares browser storage, but not data.
    vi.resetModules();
    const next = await import("@/lib/auth/client-session");
    const nextProject = (await import("@/lib/stores/project-store")).useProjectStore;
    const nextReview = (await import("@/lib/stores/review-store")).useReviewStore;
    next.clientSession.activate({ ...account, userId: "user-b", orgId: "org-b" });
    await nextProject.persist.rehydrate();
    await nextReview.persist.rehydrate();
    expect(nextProject.getState().draftAcquisitionPrices).toEqual({});
    expect(nextReview.getState().expertReviews).toEqual({});
    expect(next.sessionLocalStorage.getItem("render:parcel")).toBeNull();
    expect(next.sessionDraftStorage.getItem("parcelgrid:draft-parcel")).toBeNull();
  });
});
