/**
 * "왜 이 층수를 권장하는가" 타당성 분석 패널 (핵심 차별점).
 *
 * 권장안의 실제 판정값 + 최대안과 비교해 추천 근거를 설명.
 * 단순 계산기 → 의사결정 도구로 만드는 핵심 기능.
 * 모든 근거는 실제 판정값에서 도출 (추측 없음).
 */

import type {
  ScenarioComparison,
  ScenarioOption,
} from "@/lib/finance/scenario-verdict";

interface Reason {
  ok: boolean;
  text: string;
}

function buildReasons(
  rec: ScenarioOption,
  max: ScenarioOption
): Reason[] {
  const reasons: Reason[] = [];

  // ① 정북일조
  if (rec.sun.mark === "ok") {
    reasons.push({
      ok: true,
      text:
        rec.sun.remainDepthM !== null
          ? `정북일조 충족 — 이격 후 배치 깊이 ${rec.sun.remainDepthM.toFixed(1)}m 확보`
          : `정북일조 ${rec.sun.label}`,
    });
  } else if (rec.sun.mark === "warn") {
    reasons.push({
      ok: false,
      text:
        rec.sun.remainDepthM !== null
          ? `정북일조 검토 필요 — 배치 깊이 ${rec.sun.remainDepthM.toFixed(1)}m (7m 이상 권장)`
          : `정북일조 검토 필요`,
    });
  } else {
    reasons.push({ ok: false, text: `정북일조 불리 — 배치 공간 부족` });
  }

  // ② 용적률 활용
  reasons.push({
    ok: true,
    text: `용적률 ${rec.farUsedPct}% 활용 (정북일조 반영 실제 건축가능면적 기준)`,
  });

  // ③ 주차
  reasons.push({
    ok: true,
    text: `주차 ${rec.parking.requiredCars}대 필요 (${rec.parking.basis})`,
  });

  // ④ 최대안과 비교 — 왜 더 높은 층수를 권장하지 않는지
  if (max.floors > rec.floors) {
    if (max.sun.mark !== "ok") {
      reasons.push({
        ok: false,
        text: `${max.floors}층은 정북일조 ${max.sun.label} — 상층부 후퇴로 시공 복잡·설계 난이도 상승`,
      });
    } else {
      reasons.push({
        ok: false,
        text: `${max.floors}층까지 법적 가능하나 시공성·리스크 측면에서 ${rec.floors}층이 무리 없음`,
      });
    }
  }

  // ⑤ 시공성·리스크
  reasons.push({
    ok: rec.buildability.grade === "높음",
    text: `시공성 ${rec.buildability.grade} · 법적 리스크 ${rec.legalRisk.grade} — ${rec.buildability.note}`,
  });

  return reasons;
}

export function WhyRecommendPanel({
  comparison,
}: {
  comparison: ScenarioComparison;
}) {
  const { recommended: rec, max } = comparison;
  const reasons = buildReasons(rec, max);

  return (
    <div
      id="ai-why-panel"
      style={{
        border: "1px solid var(--pos)",
        borderRadius: 14,
        background: "var(--pos-soft)",
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--pos-fg)",
            border: "1px solid var(--pos)",
            background: "var(--bg-elev)",
            borderRadius: 5,
            padding: "3px 8px",
          }}
        >
          계산 근거
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>
          왜 {rec.floors}층을 권장하는가
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-subtle)", marginBottom: 14 }}>
        건축법·정북일조·주차 규칙을 수식으로 계산한 근거입니다. (추정 없음)
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {reasons.map((r, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              background: "var(--bg-elev)",
              border: "1px solid var(--border-faint)",
              borderRadius: 8,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: r.ok ? "var(--pos-soft)" : "var(--warn-soft, oklch(0.96 0.04 75))",
                color: r.ok ? "var(--pos-fg)" : "var(--warn)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 14, color: "var(--fg)", lineHeight: 1.5 }}>
              {r.text}
            </span>
          </div>
        ))}
      </div>

      {/* 결론 */}
      <div
        style={{
          marginTop: 14,
          padding: "12px 14px",
          background: "var(--pos)",
          borderRadius: 8,
          color: "var(--fg-onaccent)",
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1.5,
        }}
      >
        종합 판단: {rec.floors}층 {rec.farUsedPct}%가 정북일조·주차·시공성을
        모두 만족하는 가장 현실적인 안입니다.
        {max.floors > rec.floors
          ? ` ${max.floors}층은 법적으로 가능하나 추가 검토가 필요합니다.`
          : ""}
      </div>
    </div>
  );
}
