import { describe, expect, it, vi } from "vitest";
import { buildRuntimeReadiness } from "@/lib/runtime/readiness";
import { localDevelopmentPrincipal } from "@/lib/site-access";
import * as authorization from "@/lib/auth/request";

describe("local runtime readiness", () => {
  it("reports only configuration even with synthetic keys and never probes providers", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const result = buildRuntimeReadiness({ MOLIT_SERVICE_KEY: "synthetic-key", DATABASE_URL: "synthetic-db", NODE_ENV: "test" });
      expect(result).toMatchObject({ kind: "configuration-only", liveConnectivityVerified: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });
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
    expect(
      result.checks.find((check) => check.id === "project-workspaces")?.status,
    ).toBe("ready");
    expect(result.checks.find((check) => check.id === "vworld")?.status).toBe(
      "optional",
    );
    expect(
      result.checks.find((check) => check.id === "manual-parcel")?.status,
    ).toBe("review");
    expect(
      result.checks.find((check) => check.id === "openai-images")?.status,
    ).toBe("optional");
  });

  it("treats an explicitly disabled VWorld integration as a supported manual flow", () => {
    const result = buildRuntimeReadiness({
      NODE_ENV: "development",
      VWORLD_ENABLED: "false",
      VWORLD_API_KEY: "configured-but-disabled",
      KAKAO_REST_API_KEY: "kakao-key",
      MOLIT_SERVICE_KEY: "molit-key",
    });
    const vworld = result.checks.find((check) => check.id === "vworld");

    expect(vworld?.status).toBe("optional");
    expect(vworld?.message).toContain("명시적으로 꺼져");
    expect(
      result.checks.find((check) => check.id === "manual-parcel")?.status,
    ).toBe("ready");
    expect(JSON.stringify(result)).not.toContain("configured-but-disabled");
  });

  it("requires security gates in production without exposing secret values", () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      VWORLD_API_KEY: "vworld-secret-value",
      SITE_ACCESS_PASSWORD: "short",
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
    expect(
      result.checks.find((check) => check.id === "project-workspaces")?.status,
    ).toBe("review");
    expect(serialized).not.toContain("vworld-secret-value");
    expect(
      result.checks.find((check) => check.id === "openai-images")?.status,
    ).toBe("ready");
    expect(serialized).not.toContain("openai-secret-value");
  });
});

it("blocks the production deployment check without modifying local file fallback", async () => {
 const env={NODE_ENV:"production" as const};
 const result=buildRuntimeReadiness(env);
 expect(result.deploymentGate.status).toBe("blocked");
 expect(result.deploymentGate.blockers).toEqual(["production-database-required"]);
 expect(result.deploymentGate.message).toContain("파일 fallback은 계속 동작");
 expect(buildRuntimeReadiness({...env,DATABASE_URL:"synthetic"}).deploymentGate.status).toBe("runtime-validation-required");
 expect(buildRuntimeReadiness({NODE_ENV:"development"}).deploymentGate.status).toBe("local-only");
 const route=await import('@/app/api/system/readiness/route');
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('DATABASE_URL','');
 const authorize=vi.spyOn(authorization,'requireApiCapability').mockResolvedValue({
   ok:true, principal:localDevelopmentPrincipal(),
 });
 try {
   const request=new Request('http://localhost/api/system/readiness');
   const response=await route.GET(request);
   expect(response.status).toBe(503);
   expect(await response.json()).toMatchObject({kind:'configuration-only',deploymentGate:{status:'blocked'}});
   expect(authorize).toHaveBeenCalledWith(request,'project.read');
 } finally {authorize.mockRestore();vi.unstubAllEnvs();}
});
