import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/projects/[projectId]/concept-render/route";
import { resetConceptRenderQuotaForTests } from "@/lib/runtime/concept-render-quota";

const PROJECT_ID = "1132010500102810023";
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function context() {
  return { params: Promise.resolve({ projectId: PROJECT_ID }) };
}

describe("concept render API", () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_IMAGE_MODEL;
  const originalStorage = process.env.CONCEPT_RENDER_STORAGE_DIR;
  const originalSourceKey = process.env.SOURCE_DOCUMENT_UPLOAD_KEY;
  let storageDirectory = "";

  beforeEach(async () => {
    resetConceptRenderQuotaForTests();
    storageDirectory = await mkdtemp(path.join(os.tmpdir(), "parcelgrid-render-"));
    process.env.CONCEPT_RENDER_STORAGE_DIR = storageDirectory;
    delete process.env.SOURCE_DOCUMENT_UPLOAD_KEY;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(storageDirectory, { recursive: true, force: true });
    if (originalApiKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
    if (originalModel == null) delete process.env.OPENAI_IMAGE_MODEL;
    else process.env.OPENAI_IMAGE_MODEL = originalModel;
    if (originalStorage == null) delete process.env.CONCEPT_RENDER_STORAGE_DIR;
    else process.env.CONCEPT_RENDER_STORAGE_DIR = originalStorage;
    if (originalSourceKey == null) delete process.env.SOURCE_DOCUMENT_UPLOAD_KEY;
    else process.env.SOURCE_DOCUMENT_UPLOAD_KEY = originalSourceKey;
  });

  it("returns a configuration error before accepting image bytes without a key", async () => {
    delete process.env.OPENAI_API_KEY;
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/concept-render`,
      { method: "POST" },
    );

    const response = await POST(request, context());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.code).toBe("OPENAI_NOT_CONFIGURED");
  });

  it("sends a geometry-locked GPT Image edit and stores its audited PNG", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
    const captured: { upstream?: FormData } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        captured.upstream = init?.body as FormData;
        return new Response(
          JSON.stringify({
            data: [{ b64_json: Buffer.from(PNG).toString("base64") }],
            usage: { input_tokens: 11, output_tokens: 13, total_tokens: 24 },
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-request-id": "req_image_test_123",
            },
          },
        );
      }),
    );

    const form = new FormData();
    form.set("referenceImage", new File([PNG], "reference.png", { type: "image/png" }));
    form.set("prompt", "붉은 벽돌 외장과 짙은 금속 창호");
    form.set("quality", "high");
    form.set("geometryHash", "PG-LOCKED-123");
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/concept-render`,
      { method: "POST", body: form },
    );

    const response = await POST(request, context());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(captured.upstream?.get("model")).toBe("gpt-image-2");
    expect(captured.upstream?.get("size")).toBe("1536x1024");
    expect(captured.upstream?.get("quality")).toBe("high");
    expect(String(captured.upstream?.get("prompt"))).toContain(
      "absolute geometric source",
    );
    expect(payload.render.openAiRequestId).toBe("req_image_test_123");
    expect(payload.render.usage.totalTokens).toBe(24);

    const query = new URLSearchParams({ pathname: payload.render.pathname });
    const stored = await GET(
      new NextRequest(
        `http://localhost/api/projects/${PROJECT_ID}/concept-render?${query}`,
      ),
      context(),
    );
    expect(stored.status).toBe(200);
    expect(new Uint8Array(await stored.arrayBuffer())).toEqual(PNG);
  });
});
