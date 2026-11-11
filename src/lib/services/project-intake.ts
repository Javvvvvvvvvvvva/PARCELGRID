import type { ProjectComputed } from "./compute-project";

/** A saved calculation belongs to one parcel intake, including older unversioned projects. */
export function matchesProjectIntake(
  saved: ProjectComputed | null | undefined,
  current: ProjectComputed | null | undefined,
): boolean {
  return Boolean(saved && current && current.meta.mode !== "site-only" &&
    saved.parcel.id === current.parcel.id &&
    saved.meta.intakeRevision === current.meta.intakeRevision);
}
