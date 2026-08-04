import { describe, expect, it } from "vitest";
import { buildRuntimeReadiness } from "@/lib/runtime/readiness";

describe("local runtime readiness", () => {
  it("opens the local seed workflow while identifying missing public data keys", () => {
    const result = buildRuntimeReadiness(
      { NODE_ENV: "development" },
      new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(result.mode).toBe("development");
    expect(result.checks.find((check) => check.id === "seed-runtime")?.status).toBe(
      "ready",
    );
    expect(result.checks.find((check) => check.id === "site-access")?.status).toBe(
      "ready",
    );
    expect(result.checks.find((check) => check.id === "source-documents")?.status).toBe(
      "ready",
    );
    expect(result.checks.find((check) => check.id === "vworld")?.status).toBe(
      "review",
    );
    expect(
      result.checks.find((check) => check.id === "openai-images")?.status,
    ).toBe("optional");
  });

  it("requires security gates in production without exposing secret values", () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      VWORLD_API_KEY: "vworld-secret-value",
      SITE_ACCESS_PASSWORD: "short",
      SOURCE_DOCUMENT_UPLOAD_KEY: "also-short",
      OPENAI_API_KEY: "openai-secret-value",
      OPENAI_IMAGE_MODEL: "gpt-image-2",
    };
    const result = buildRuntimeReadiness(environment);
    const serialized = JSON.stringify(result);

    expect(result.checks.find((check) => check.id === "vworld")?.status).toBe(
      "ready",
    );
    expect(result.checks.find((check) => check.id === "site-access")?.status).toBe(
      "review",
    );
    expect(
      result.checks.find((check) => check.id === "source-documents")?.status,
    ).toBe("review");
    expect(serialized).not.toContain("vworld-secret-value");
    expect(
      result.checks.find((check) => check.id === "openai-images")?.status,
    ).toBe("ready");
    expect(serialized).not.toContain("also-short");
    expect(serialized).not.toContain("openai-secret-value");
  });
});
