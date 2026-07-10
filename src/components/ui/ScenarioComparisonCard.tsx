/**
 * 현재 계획 vs 권장 vs 법적 최대 — 재설계 (전문가 피드백 반영).
 *
 * 핵심 개선:
 *  · 카드 성격 분리 (현재 입력안 / 가장 현실적 / 도전 한계치)
 *  · 순서: 층수 → 용적률 → 연면적 (시행사는 용적률 먼저)
 *  · 권장안에 "내 계획 대비 변경점" 표시 (+N세대 등)
 *  · 법적 최대 = 주황(Warning), 회색 아님 (도전 한계안)
 *  · 정북일조·주차 항상 노출
 */

import type {
  ScenarioComparison,
  ScenarioOption,
} from "@/lib/finance/scenario-verdict";

function markColor(mark: string): string {
  return mark === "ok"
    ? "var(--pos-fg)"
    : mark === "warn"
    ? "var(--warn)"
    : "var(--neg-fg)";
}
function markIcon(mark: string): string {
  return mark === "ok" ? "✓" : mark === "warn" ? "⚠" : "✕";
}

type Variant = "input" | "recommended" | "max";

const THEME: Record<
  Variant,
  { border: string; bg: string; badge: string; badgeFg: string; label: string; sub: string }
> = {
  input: {
    border: "var(--border-strong)",
    bg: "var(--bg-sunken)",
    badge: "var(--bg-elev)",
    badgeFg: "var(--fg-muted)",
    label: "현재 계획",
    sub: "내 입력안",
  },
  recommended: {
    border: "var(--pos)",
    bg: "var(--pos-soft)",
    badge: "var(--bg-elev)",
    badgeFg: "var(--pos-fg)",
    label: "권장",
    sub: "가장 현실적",
  },
  max: {
    border: "var(--warn)",
    bg: "var(--warn-soft, oklch(0.96 0.04 75))",
    badge: "var(--bg-elev)",
    badgeFg: "var(--warn)",
    label: "법적 최대",
    sub: "도전 한계치",
  },
};

/** 권장안이 내 계획 대비 무엇을 바꿨는지 */
function changesFromInput(
  input: ScenarioOption | undefined,
  rec: ScenarioOption
): { text: string; positive: boolean }[] {
  if (!input) return [];
  const out: { text: string; positive: boolean }[] = [];
  const dUnits = rec.units - input.units;
  if (dUnits !== 0)
    out.push({ text: `세대수 ${dUnits > 0 ? "+" : ""}${dUnits}`, positive: dUnits > 0 });
  const dFloors = rec.floors - input.floors;
  if (dFloors !== 0)
    out.push({ text: `층수 ${dFloors > 0 ? "+" : ""}${dFloors}`, positive: true });
  // 정북일조 비교
  if (rec.sun.mark === input.sun.mark) out.push({ text: "일조 동일", positive: true });
  else if (rec.sun.mark === "ok") out.push({ text: "일조 개선", positive: true });
  // 주차
  if (rec.parking.requiredCars === input.parking.requiredCars)
    out.push({ text: "주차 동일", positive: true });
  return out;
}

function OptionCard({
  option,
  variant,
  input,
  onApplyRecommended,
  applyButtonEnabled,
  recommendedApplied,
  applyRecommendedLabel,
}: {
  option: ScenarioOption;
  variant: Variant;
  input?: ScenarioOption;
  /** 권장안 적용 / 되돌리기 토글 */
  onApplyRecommended?: () => void;
  applyButtonEnabled?: boolean;
  recommendedApplied?: boolean;
  applyRecommendedLabel?: string;
}) {
  const t = THEME[variant];
  const changes =
    variant === "recommended" ? changesFromInput(input, option) : [];

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        background: t.bg,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* 헤더 — 성격 라벨 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: t.badgeFg,
            border: `1px solid ${t.border}`,
            background: t.badge,
            borderRadius: 5,
            padding: "3px 8px",
            alignSelf: "flex-start",
          }}
        >
          {t.label}
        </span>
        <span style={{ fontSize: 11, color: "var(--fg-subtle)", marginTop: 2 }}>
          {t.sub}
        </span>
      </div>

      {/* 규모 — 층수 → 용적률 → 연면적 (C 순서) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--fg)" }}>
            {option.floors}층
          </span>
          <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: t.badgeFg }}>
            {option.farUsedPct}%
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>
          <span className="mono">{option.gfaPyeong}평</span>
          {option.units > 0 ? ` · ${option.units}세대` : ""}
        </div>
      </div>

      {/* AI가 바꾼 것 (권장만) */}
      {changes.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: "8px 0",
            borderTop: "1px dashed var(--border)",
          }}
        >
          {changes.map((c, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                color: c.positive ? "var(--pos-fg)" : "var(--fg-muted)",
                background: "var(--bg-elev)",
                border: "1px solid var(--border-faint)",
                borderRadius: 4,
                padding: "2px 6px",
              }}
            >
              {c.positive ? "✓ " : ""}
              {c.text}
            </span>
          ))}
        </div>
      )}

      {/* 정북일조·주차 — 항상 노출 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ color: markColor(option.sun.mark), fontWeight: 700, width: 14 }}>
            {markIcon(option.sun.mark)}
          </span>
          <span style={{ color: "var(--fg-muted)" }}>정북일조</span>
          <span style={{ color: markColor(option.sun.mark), fontWeight: 600 }}>
            {option.sun.label}
          </span>
          {option.sun.remainDepthM !== null && (
            <span style={{ color: "var(--fg-faint)", fontSize: 12 }}>
              (배치 {option.sun.remainDepthM.toFixed(1)}m)
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <span style={{ color: "var(--fg-muted)", fontWeight: 700, width: 14 }}>🅿</span>
          <span style={{ color: "var(--fg-muted)" }}>주차</span>
          <span style={{ color: "var(--fg)", fontWeight: 600 }}>
            {option.parking.requiredCars}대
            {option.piloti?.recommended && (
              <span
                title={option.piloti.reason}
                style={{
                  marginLeft: 6,
                  fontSize: 10.5,
                  padding: "1px 6px",
                  borderRadius: 3,
                  border: "1px solid var(--border)",
                  color: "var(--fg-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                주차 전략: 필로티형 ★ 추천
              </span>
            )}
          </span>
        </div>
      </div>

      {variant === "recommended" && onApplyRecommended && (
        <div style={{ marginTop: "auto", paddingTop: 8 }}>
          <button
            type="button"
            onClick={onApplyRecommended}
            disabled={!applyButtonEnabled}
            title={
              applyButtonEnabled
                ? recommendedApplied
                  ? "적용 전 내 계획으로 되돌립니다"
                  : "권장안을 내 계획(Envelope)에 반영합니다"
                : applyRecommendedLabel
            }
            style={{
              width: "100%",
              height: 32,
              fontSize: 12,
              fontWeight: 600,
              color: applyButtonEnabled ? "var(--pos-fg)" : "var(--fg-faint)",
              background: applyButtonEnabled ? "var(--bg-elev)" : "var(--bg-sunken)",
              border: `1px solid ${applyButtonEnabled ? "var(--pos)" : "var(--border-faint)"}`,
              borderRadius: 6,
              cursor: applyButtonEnabled ? "pointer" : "not-allowed",
            }}
          >
            {recommendedApplied ? "내 계획 되돌리기" : "권장안 적용"}
          </button>
          {applyRecommendedLabel && (
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 10.5,
                color: applyButtonEnabled ? "var(--fg-subtle)" : "var(--fg-faint)",
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              {applyRecommendedLabel}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ScenarioComparisonCard({
  comparison,
  whyOpen,
  onWhyClick,
  onApplyRecommended,
  applyButtonEnabled = false,
  recommendedApplied = false,
  applyRecommendedLabel,
}: {
  comparison: ScenarioComparison;
  /** 근거 패널 펼침 상태 (버튼 라벨 화살표 반영) */
  whyOpen?: boolean;
  /** 근거 패널 토글 핸들러 — 없으면 기존 스크롤 동작 */
  onWhyClick?: () => void;
  /** 권장안 적용 / 되돌리기 토글 */
  onApplyRecommended?: () => void;
  applyButtonEnabled?: boolean;
  recommendedApplied?: boolean;
  applyRecommendedLabel?: string;
}) {
  const { input, recommended, max } = comparison;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        background: "var(--bg-elev)",
        padding: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--fg)" }}>
          {comparison.label} — {input ? "현재 계획 vs 권장 vs 법적 최대" : "권장 vs 법적 최대"}
        </div>
        <button
          onClick={
            onWhyClick ??
            (() => {
              const el = document.getElementById("ai-why-panel");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            })
          }
          aria-expanded={onWhyClick ? whyOpen : undefined}
          style={{
            fontSize: 12,
            color: "var(--pos-fg)",
            background: whyOpen ? "var(--pos-soft)" : "transparent",
            border: "1px solid var(--pos)",
            borderRadius: 6,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          왜 {recommended.floors}층을 권장하는가{" "}
          {onWhyClick ? (whyOpen ? "▲" : "▼") : "→"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        {input && <OptionCard option={input} variant="input" />}
        <OptionCard
          option={recommended}
          variant="recommended"
          input={input}
          onApplyRecommended={onApplyRecommended}
          applyButtonEnabled={applyButtonEnabled}
          recommendedApplied={recommendedApplied}
          applyRecommendedLabel={applyRecommendedLabel}
        />
        <OptionCard option={max} variant="max" />
      </div>
    </div>
  );
}
