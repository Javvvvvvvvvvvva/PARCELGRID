import { describe, expect, it } from "vitest";
import {
  vworldRequestsEnabled,
  vworldRuntimeState,
} from "@/lib/runtime/integration-mode";

describe("VWorld runtime mode", () => {
  it("disables all requests when the switch is explicitly off", () => {
    const environment = {
      NODE_ENV: "test",
      VWORLD_ENABLED: "false",
      VWORLD_API_KEY: "configured-key",
    } as NodeJS.ProcessEnv;

    expect(vworldRuntimeState(environment)).toEqual({
      mode: "disabled",
      configured: true,
      explicitlyDisabled: true,
    });
    expect(vworldRequestsEnabled(environment)).toBe(false);
  });

  it("enables requests when a key exists and the switch is not off", () => {
    expect(
      vworldRuntimeState({
        NODE_ENV: "test",
        VWORLD_API_KEY: "configured-key",
      } as NodeJS.ProcessEnv).mode,
    ).toBe("enabled");
  });

  it("reports an unconfigured optional integration without a key", () => {
    expect(vworldRuntimeState({ NODE_ENV: "test" } as NodeJS.ProcessEnv).mode).toBe(
      "unconfigured",
    );
  });
});
