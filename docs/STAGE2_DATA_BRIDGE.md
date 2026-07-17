# Stage 2 → Stage 3 data bridge

The representative `PlanningScenario` is the source of truth for downstream finance.

## Mapping

- `primaryUse` → finance building type
- calculated preliminary FAR/BCR → planned FAR/BCR
- actual above/below floor levels → floor counts
- residential/commercial zone unit counts → finance units
- zone revenue models and saleable/rentable areas → normalized revenue mix

The bridge must never replace realized values with the parcel's legal maximum FAR/BCR.

## Hydration precedence

1. Representative `PlanningScenario`
2. Legacy `EnvelopePlan`
3. API baseline scenarios

Only saved plans plus the representative plan are exposed as downstream comparison scenarios.
