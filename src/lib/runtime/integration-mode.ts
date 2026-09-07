export type IntegrationRuntimeMode =
  | "enabled"
  | "disabled"
  | "unconfigured";

export interface VworldRuntimeState {
  mode: IntegrationRuntimeMode;
  configured: boolean;
  explicitlyDisabled: boolean;
}

const DISABLED_VALUES = new Set(["0", "false", "off", "disabled"]);

export function vworldRuntimeState(
  environment: NodeJS.ProcessEnv = process.env,
): VworldRuntimeState {
  const configured = Boolean(environment.VWORLD_API_KEY?.trim());
  const switchValue = environment.VWORLD_ENABLED?.trim().toLowerCase() ?? "";
  const explicitlyDisabled = DISABLED_VALUES.has(switchValue);

  return {
    mode: explicitlyDisabled
      ? "disabled"
      : configured
        ? "enabled"
        : "unconfigured",
    configured,
    explicitlyDisabled,
  };
}

export function vworldRequestsEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return vworldRuntimeState(environment).mode === "enabled";
}
