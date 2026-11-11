import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewVerificationResult } from "@/lib/handoff/review-verification-task";

const h = vi.hoisted(() => ({ fetch: vi.fn(), query: vi.fn(), mutation: vi.fn(), setQueryData: vi.fn(), invalidateQueries: vi.fn() }));
vi.mock("@/lib/auth/client-session", () => ({ sessionFetch: h.fetch }));
vi.mock("@tanstack/react-query", () => ({ useQuery: h.query, useMutation: h.mutation,
  useQueryClient: () => ({ setQueryData: h.setQueryData, invalidateQueries: h.invalidateQueries }) }));
import { useProjectReviewSnapshot } from "@/lib/hooks/use-project-review-snapshot";

const key = `PG-REVIEW-SHA256-${"A".repeat(64)}`;
// Only fields consumed by this hook are stubbed; full worker parity is separate.
const prepared = () => ({ kind: "saved", snapshotKey: key, payload: { projectId: "P" } }) as unknown as ReviewVerificationResult;
const useSubject = (value: ReviewVerificationResult | null = prepared()) => useProjectReviewSnapshot("P", value);
beforeEach(() => { vi.clearAllMocks(); h.query.mockReturnValue({ data: null }); h.mutation.mockReturnValue({}); });

describe("worker-prepared snapshot sealing", () => {
  it("uses the prepared key for the exact status query without rehashing", async () => {
    expect(useSubject().currentKey).toBe(key);
    const options = h.query.mock.calls[0][0];
    expect(options.queryKey).toEqual(["project-review-snapshot", "P", key]);
    expect(options.enabled).toBe(true);
    h.fetch.mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await options.queryFn()).toEqual({ sealed: false, snapshotKey: key });
    expect(h.fetch.mock.calls[0][0]).toContain(`snapshotKey=${key}`);
  });
  it.each(["missing", "preview", "foreign"])("blocks sealing without a current saved result: %s", async kind => {
    const value = kind === "missing" ? null : kind === "preview" ? { kind: "preview", report: {} } : prepared();
    if (kind === "foreign" && value && "payload" in value) value.payload.projectId = "OTHER";
    const subject = useSubject(value as ReviewVerificationResult | null);
    expect(subject).toMatchObject({ currentKey: null, sealed: false, metadata: null });
    expect(h.query.mock.calls[0][0].enabled).toBe(false);
    await expect(h.mutation.mock.calls[0][0].mutationFn()).rejects.toThrow("현재 대표안");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(["stale", "invalid-ledger"])("does not reuse %s cached seal", kind => {
    h.query.mockReturnValue({ data: { sealed: true, snapshotKey: kind === "stale" ? "old" : key,
      ledger: { integrity: { valid: kind !== "invalid-ledger" } } } });
    expect(useSubject()).toMatchObject({ sealed: false, metadata: null });
  });
  it("rejects a server response with a different SHA-256", async () => {
    useSubject();
    h.fetch.mockResolvedValue(new Response(JSON.stringify({ sealed: true, snapshotKey: "wrong" })));
    await expect(h.mutation.mock.calls[0][0].mutationFn()).rejects.toThrow("SHA-256");
    expect(h.setQueryData).not.toHaveBeenCalled();
  });
  it("stores a matching response under its original project and key", async () => {
    useSubject();
    const response = { sealed: true, projectId: "P", snapshotKey: key };
    h.fetch.mockResolvedValue(new Response(JSON.stringify(response)));
    const mutation = h.mutation.mock.calls[0][0];
    const result = await mutation.mutationFn(); mutation.onSuccess(result);
    expect(h.setQueryData).toHaveBeenCalledWith(["project-review-snapshot", "P", key], response);
    expect(h.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["project-review-ledger", "P"] });
  });
});
