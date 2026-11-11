import { expect, it, vi } from "vitest";
import { buildIntegratedVerification } from "@/lib/handoff/integrated-verification";
import { integratedVerificationFixture } from "./helpers/integrated-verification-fixture";
import * as rooms from "@/lib/planning/room-layout";
import * as topology from "@/lib/geo/parcel-topology-geometry";

it("does not charge room validation time to the separate floor/parcel containment deadline", () => {
  const input = integratedVerificationFixture();
  let time = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => time);
  const original = rooms.assessRoomLayout;
  const slowRooms = vi.spyOn(rooms, "assessRoomLayout").mockImplementation((...args) => {
    time += 2100;
    return original(...args);
  });
  try {
    const result = buildIntegratedVerification(input);
    expect(slowRooms).toHaveBeenCalled();
    const checks = result.checks.filter(check => /^binding\.floor\..+\.parcel-region$/.test(check.id));
    expect(checks).toHaveLength(3);
    expect(checks.every(check => check.status === "checked")).toBe(true);
    expect(result.approvalStatus).toBe("unverified");
  } finally { slowRooms.mockRestore(); clock.mockRestore(); }
});

it("still withholds containment when intersection work itself exceeds the budget", () => {
  const input = integratedVerificationFixture();
  let time = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => time);
  const original = topology.localParcelIntersectionArea;
  const slowIntersection = vi.spyOn(topology, "localParcelIntersectionArea").mockImplementation((...args) => {
    const area = original(...args); time += 2100; return area;
  });
  try {
    const result = buildIntegratedVerification(input);
    expect(slowIntersection).toHaveBeenCalled();
    const checks = result.checks.filter(check => /^binding\.floor\..+\.parcel-region$/.test(check.id));
    expect(checks).toHaveLength(3);
    expect(checks.every(check => check.status === "missing")).toBe(true);
    expect(result.approvalStatus).toBe("unverified");
  } finally { slowIntersection.mockRestore(); clock.mockRestore(); }
});
