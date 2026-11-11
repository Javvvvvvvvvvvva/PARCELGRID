import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ReviewVerificationStatus } from "@/components/handoff/ReviewVerificationStatus";
import type { useReviewVerification } from "@/lib/hooks/use-review-verification";

type Work = ReturnType<typeof useReviewVerification>;
const work = (status: Work["status"]): Work => ({ status, report: null, payload: null, result: null,
  error: "현재 검증은 미완료입니다.", cancel: vi.fn(), retry: vi.fn() });
describe("review verification status", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());
  it("keeps the pending warning outside print-hidden controls", () => {
    const html = renderToStaticMarkup(React.createElement(ReviewVerificationStatus, { work: work("pending") }));
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("현재 검증 미완료");
    expect(html).toContain('aria-label="통합 재검사 취소"');
    expect(html).not.toContain("no-print");
  });
  it("shows an error and explicit retry without a completion claim", () => {
    const html = renderToStaticMarkup(React.createElement(ReviewVerificationStatus, { work: work("error") }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("현재 검증은 미완료입니다.");
    expect(html).toContain('aria-label="통합 재검사 다시 실행"');
    expect(html).not.toContain("검증 완료");
  });
  it.each(["ready", "idle"] as const)("renders no stale warning for %s", status => {
    expect(renderToStaticMarkup(React.createElement(ReviewVerificationStatus, { work: work(status) }))).toBe("");
  });
});
