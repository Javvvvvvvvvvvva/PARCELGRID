import { describe, expect, it } from "vitest";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants.js";
import configForPhase from "../../next.config.mjs";

describe("Next output isolation", () => {
  it("keeps development output separate from production verification", () => {
    expect(configForPhase(PHASE_DEVELOPMENT_SERVER).distDir).toBe(".next-dev");
    expect(configForPhase(PHASE_DEVELOPMENT_SERVER).distDir).not.toBe(configForPhase(PHASE_PRODUCTION_BUILD).distDir);
  });

  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])("retains standard output for %s", phase => {
    expect(configForPhase(phase).distDir).toBe(".next");
  });

  it("preserves security headers and module resolution in both modes", async () => {
    const dev = configForPhase(PHASE_DEVELOPMENT_SERVER), prod = configForPhase(PHASE_PRODUCTION_BUILD);
    if (!dev.headers || !prod.headers) throw new Error("Both modes must retain security headers");
    expect(await dev.headers()).toEqual(await prod.headers());
    expect(dev.serverExternalPackages).toEqual(prod.serverExternalPackages);
    expect(dev.transpilePackages).toEqual(prod.transpilePackages);
    expect(dev.outputFileTracingRoot).toBe(prod.outputFileTracingRoot);
  });
});
