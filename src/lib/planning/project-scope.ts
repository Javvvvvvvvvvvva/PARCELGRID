import type { PlanningScenario } from "./types";

export function planningScenarioBelongsToProject(
  scenario: Pick<PlanningScenario, "projectId">,
  projectId: string | null | undefined,
): boolean {
  return Boolean(projectId && (!scenario.projectId || scenario.projectId === projectId));
}

export function findProjectPlanningScenario(
  scenarios: PlanningScenario[], id: string | null | undefined, projectId: string | null | undefined,
): PlanningScenario | undefined {
  const matches = scenarios.filter(scenario => scenario.id === id && planningScenarioBelongsToProject(scenario, projectId));
  return matches.length === 1 ? matches[0] : undefined;
}
