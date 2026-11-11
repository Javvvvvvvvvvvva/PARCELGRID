import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectTransferFile } from "@/lib/handoff/project-transfer-import";
import {
  createProjectTransferBundle, MAX_PROJECT_TRANSFER_BYTES, serializeProjectTransferBundle,
  type ProjectTransferPayload,
} from "@/lib/handoff/project-transfer";
import { projectWorkspaceFixture } from "@/tests/helpers/project-workspace-fixture";

const PROJECT = "transfer-reader";
const signal = () => new AbortController().signal;
function source() {
  const payload: ProjectTransferPayload = { ...projectWorkspaceFixture(PROJECT), expertReviews: {} };
  return createProjectTransferBundle({ projectId: PROJECT, payload, exportedAt: "2026-08-21T00:00:00.000Z" });
}
const file = (text: string, name = "project.json") => new File([text], name, { type: "application/json" });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("bounded project transfer reader", () => {
  it("reads a BOM/uppercase-extension export without normalizing optional omissions", async () => {
    const bundle = source(), before = structuredClone(bundle);
    const result = await readProjectTransferFile(file(`\ufeff${serializeProjectTransferBundle(bundle)}`, "project.JSON"), signal(), PROJECT);
    expect(result).toEqual(bundle);
    expect(result.payload).not.toHaveProperty("leaseRollDrafts");
    expect(result.payload).not.toHaveProperty("operatingBudgetDrafts");
    expect(bundle).toEqual(before);
  });

  it("rejects foreign project packages and checksum tampering", async () => {
    const bundle = source();
    await expect(readProjectTransferFile(file(serializeProjectTransferBundle(bundle)), signal(), "foreign")).rejects.toThrow("프로젝트 ID");
    bundle.payload.draftAcquisitionPrice = 55;
    await expect(readProjectTransferFile(file(JSON.stringify(bundle)), signal(), PROJECT)).rejects.toThrow("체크섬");
  });

  it.each([
    ["project.json.exe", 10], ["project", 10], ["project.json", 0], ["project.json", -1],
    ["project.json", .5], ["project.json", NaN], ["project.json", Infinity], ["project.json", MAX_PROJECT_TRANSFER_BYTES + 1],
  ])("rejects filename/declared size before opening a stream: %s %s", async (name, size) => {
    const stream = vi.fn();
    await expect(readProjectTransferFile({ name, size, stream }, signal(), PROJECT)).rejects.toThrow("20 MiB");
    expect(stream).not.toHaveBeenCalled();
  });

  it("requires a target project before opening a stream", async () => {
    const stream = vi.fn();
    await expect(readProjectTransferFile({ name: "project.json", size: 10, stream }, signal(), "")).rejects.toThrow("프로젝트 ID");
    expect(stream).not.toHaveBeenCalled();
  });

  it("counts actual streamed bytes independently of file metadata", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_PROJECT_TRANSFER_BYTES + 1));
    }, cancel });
    await expect(readProjectTransferFile({ name: "project.json", size: 1, stream: () => body }, signal(), PROJECT)).rejects.toThrow("허용 크기");
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  });

  it("rejects structural depth, node count, malformed JSON and overflowing numbers", async () => {
    let deep: unknown = 0;
    for (let i = 0; i < 49; i++) deep = [deep];
    for (const raw of ["null", "[]", "{", "1e400", JSON.stringify(deep), JSON.stringify(Array(250_000).fill(null))]) {
      await expect(readProjectTransferFile(file(raw), signal(), PROJECT)).rejects.toThrow();
    }
  });

  it("rejects invalid UTF-8 and describes stream-open failures", async () => {
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) {
      controller.enqueue(new Uint8Array([0xff])); controller.close();
    } });
    await expect(readProjectTransferFile({ name: "project.json", size: 1, stream: () => body }, signal(), PROJECT)).rejects.toThrow("UTF-8");
    await expect(readProjectTransferFile({ name: "project.json", size: 1, stream() { throw new Error("private detail"); } }, signal(), PROJECT))
      .rejects.toThrow("인계 파일의 내용을 읽을 수 없습니다");
  });

  it("does not open an already-aborted read", async () => {
    const controller = new AbortController(); controller.abort(); const stream = vi.fn();
    await expect(readProjectTransferFile({ name: "project.json", size: 1, stream }, controller.signal, PROJECT))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(stream).not.toHaveBeenCalled();
  });

  it("aborts a stalled read without waiting for stream cancellation", async () => {
    const controller = new AbortController(), cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = readProjectTransferFile({ name: "project.json", size: 10, stream: () => body }, controller.signal, PROJECT);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  });

  it("uses the fixed five-second deadline and releases its reader/timer", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({ pull: () => new Promise(() => {}), cancel });
    const reading = expect(readProjectTransferFile({ name: "project.json", size: 10, stream: () => body }, signal(), PROJECT)).rejects.toThrow("시간");
    await vi.advanceTimersByTimeAsync(5_000); await reading;
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
});
