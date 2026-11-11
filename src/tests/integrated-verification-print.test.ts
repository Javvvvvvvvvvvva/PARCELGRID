import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { IntegratedVerificationPanel } from "@/components/handoff/IntegratedVerificationPanel";
import { INTEGRATED_VERIFICATION_VERSION, type IntegratedVerificationReport } from "@/lib/handoff/integrated-verification";
import { buildReviewSnapshotPayload, type ReviewSnapshotPayload } from "@/lib/handoff/review-snapshot";
import { constructionQuoteFixture } from "./helpers/construction-quote-fixture";

const report: IntegratedVerificationReport = {
  version: INTEGRATED_VERIFICATION_VERSION,
  checks: [], modelVersions: { integrated: INTEGRATED_VERIFICATION_VERSION, rooms: "synthetic-room-version" },
  approvalStatus: "unverified", status: "incomplete",
  limitations: ["Official approval is unverified.", "Synthetic geometry is not a permit."],
};
function render(value: IntegratedVerificationReport | null, packet: ReviewSnapshotPayload | null = null) {
  return renderToStaticMarkup(React.createElement(IntegratedVerificationPanel, {
    projectId: "synthetic", report: value, packet, snapshotKey: null, sealed: false,
  }));
}
function savedPacket(version: string) {
  const f = constructionQuoteFixture();
  const packet = buildReviewSnapshotPayload({ snapshot: { projectId: f.projectId, representativeScenarioId: f.representativeScenarioId,
    representativeScenarioVersion: f.representativeScenarioVersion, geometryHash: f.geometryHash, savedAt: "2026-11-04T00:00:00Z", data: f.data },
  financialSources: {}, priceVerifications: {}, planningScenario: f.scenario, geometry: f.geometry });
  packet.data.meta.version = version;
  return packet;
}
function printed(html: string) {
  return html.split('<section class="iv-limits iv-limits-print">')[1]?.split("</section>")[0] ?? "";
}

describe("integrated report print scope", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());
  it("includes every limitation and model version outside the closed screen disclosure", () => {
    const html = render(report);
    expect(html).toContain('<details class="iv-limits">');
    expect(html).not.toContain('<details open=""');
    const print = printed(html);
    for (const text of [...report.limitations, ...Object.values(report.modelVersions)]) expect(print).toContain(text);
  });

  it("updates both copies from the current report without retaining old limitations", () => {
    const html = render({ ...report, limitations: ["New scope"], modelVersions: { rooms: "new-version" } });
    expect(printed(html)).toContain("New scope");
    expect(printed(html)).toContain("new-version");
    expect(html).not.toContain("Synthetic geometry is not a permit.");
    expect(html).not.toContain("synthetic-room-version");
  });

  it("escapes scope text in both render paths", () => {
    const html = render({ ...report, limitations: ['<script>alert("not markup")</script>'] });
    expect(html).not.toContain("<script>");
    expect(printed(html)).toContain("&lt;script&gt;");
  });

  it.each(["v225", "v226", "v227", "historical-calculation-build"])("prints the actual saved %s calculation identifier outside closed details", version => {
    const packet = savedPacket(version), before = structuredClone(packet);
    const html = render(report, packet);
    expect(html.split("<details")[0]).toContain(`aria-label="저장 계산 모델">저장 계산 모델: ${version}</p>`);
    expect(packet).toEqual(before);
  });

  it("does not substitute a current calculation constant for missing saved metadata", () => {
    for (const packet of [null, savedPacket("")]) {
      expect(render(report, packet)).toContain('aria-label="저장 계산 모델">저장 계산 모델: 미확정</p>');
    }
  });

  it("escapes saved calculation identifiers", () => {
    const html = render(report, savedPacket('<script>alert("version")</script>'));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;version&quot;)&lt;/script&gt;");
  });

  it("does not invent a printable verification report when no report exists", () => {
    expect(render(null)).toBe("");
  });
});
