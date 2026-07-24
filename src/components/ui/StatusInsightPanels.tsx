"use client";

import type { CSSProperties } from "react";
import { Panel } from "./primitives";
import type {
  DataCheckItem,
  DataReadinessInsight,
  ExistingReviewOption,
  MarketInsight,
  RoadOrientationInsight,
  ReviewTone,
} from "@/lib/analysis/status-insights";
import { num } from "@/lib/utils/format";

export function RoadOrientationPanel({ insight }: { insight: RoadOrientationInsight }) {
  return (
    <Panel title="⑤ 도로·방위 현황" source="필지 경계 · V월드 도로 중심선">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
          gap: 18,
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            position: "relative",
            minHeight: 218,
            borderRadius: 10,
            border: "1px solid var(--border)",
            background: "var(--bg-sunken)",
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 14,
              border: "1px dashed var(--border-strong)",
              borderRadius: "50%",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
            }}
          >
            N
          </div>
          <div
            style={{
              width: 88,
              height: 116,
              border: "2px solid #64748b",
              background: "#edf1f3",
              transform: "rotate(-8deg)",
              boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
            }}
          />
          {insight.frontageAvailable && (
            <div
              style={{
                position: "absolute",
                bottom: 18,
                left: "50%",
                transform: "translateX(-50%)",
                padding: "6px 10px",
                borderRadius: 999,
                background: "#334155",
                color: "white",
                fontSize: 11,
                fontWeight: 650,
                whiteSpace: "nowrap",
              }}
            >
              전면 {insight.frontDirection ?? "방향 미확인"}
            </div>
          )}
          <div
            style={{
              position: "absolute",
              top: 42,
              right: 12,
              fontSize: 10.5,
              color: "var(--fg-faint)",
              textAlign: "right",
              lineHeight: 1.45,
            }}
          >
            북측 변
            <br />
            {insight.northLengthM != null ? `${insight.northLengthM.toFixed(1)}m` : "미확인"}
          </div>
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              fontSize: 9.5,
              color: "var(--fg-faint)",
            }}
          >
            방위 개념도 · 실제 필지 형상 아님
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 1,
            background: "var(--border)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            overflow: "hidden",
          }}
        >
          <InsightRow
            label="전면 방향"
            value={insight.frontDirection ? `${insight.frontDirection}측` : "추가 확인 필요"}
            sub="도로 중심선과 필지 경계 근접도 기반"
          />
          <InsightRow
            label="접한 도로"
            value={insight.roadName || (insight.frontageAvailable ? "도로명 미제공" : "판정 불가")}
            sub={
              insight.roadCenterDistanceM != null
                ? `전면 중점에서 도로 중심선까지 약 ${insight.roadCenterDistanceM.toFixed(1)}m`
                : "도로 폭이 아니라 중심선까지의 거리"
            }
          />
          <InsightRow
            label="전면 길이"
            value={insight.frontLengthM != null ? `${insight.frontLengthM.toFixed(1)}m` : "미확인"}
            sub="주차 진입·배치 검토 참고"
          />
          <InsightRow
            label="북측 경계"
            value={
              insight.northDirection
                ? `${insight.northDirection}측 · ${
                    insight.northIsRoad === true
                      ? "도로 접면 추정"
                      : insight.northIsRoad === false
                        ? "인접 대지 추정"
                        : "접도 미확인"
                  }`
                : "방위 분석 불가"
            }
            sub={insight.sunReviewApplies ? "정북일조 검토 대상 용도지역" : "정북일조 적용 여부 낮음"}
          />
        </div>
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
        {insight.notes.map((note) => (
          <div
            key={note}
            style={{
              display: "flex",
              gap: 8,
              fontSize: 11.5,
              color: "var(--fg-faint)",
              lineHeight: 1.55,
            }}
          >
            <span style={{ marginTop: 1 }}>·</span>
            <span>{note}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function MarketSnapshotPanel({ insight }: { insight: MarketInsight }) {
  const median = insight.sameDongMedianPricePerPyeong ?? insight.medianPricePerPyeong;
  const medianLabel = insight.sameDongMedianPricePerPyeong != null ? "같은 동 중앙값" : "수집 거래 중앙값";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
        gap: 1,
        marginBottom: 14,
        border: "1px solid var(--border)",
        borderRadius: 9,
        overflow: "hidden",
        background: "var(--border)",
      }}
    >
      <MarketMetric label="수집 거래" value={`${num(insight.collectedCount)}건`} sub="전체 조회 결과" />
      <MarketMetric label="같은 동 거래" value={`${num(insight.sameDongCount)}건`} sub="법정동 기준" />
      <MarketMetric label="지도 표시" value={`${num(insight.mapDisplayCount)}건`} sub="지오코딩 성공 건수" />
      <MarketMetric label="최근 신축" value={`${num(insight.recentBuildCount)}건`} sub="최근 5년 준공" />
      <MarketMetric
        label={medianLabel}
        value={median != null ? `${num(median)}만/평` : "표본 없음"}
        sub="단순 중앙값 · 최종 비교사례 아님"
      />
      <MarketMetric
        label="가장 가까운 역"
        value={insight.nearestStation ? insight.nearestStation.name : "조회 없음"}
        sub={insight.nearestStation ? `직선거리 ${num(insight.nearestStation.distanceM)}m` : "1km 내 결과 없음"}
      />
      {insight.subjectPricePerPyeong != null && (
        <MarketMetric
          label="입력 인수가"
          value={`${num(insight.subjectPricePerPyeong)}만/평`}
          sub={
            insight.subjectVsMedianPct != null
              ? `수집 중앙값 대비 ${insight.subjectVsMedianPct >= 0 ? "+" : ""}${insight.subjectVsMedianPct.toFixed(1)}%`
              : "비교 표본 부족"
          }
        />
      )}
    </div>
  );
}

export function DataReadinessPanel({ insight }: { insight: DataReadinessInsight }) {
  const confirmed = insight.availableCount + insight.derivedCount;
  return (
    <Panel title="⑦ 데이터 확인 상태" source="사실 데이터 · 파생 분석 · 미확인 구분">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <CountCard label="확보" value={insight.availableCount} tone="positive" />
        <CountCard label="파생 분석" value={insight.derivedCount} tone="neutral" />
        <CountCard label="추가 확인" value={insight.missingCount} tone="warning" />
      </div>
      <div style={{ fontSize: 11.5, color: "var(--fg-faint)", marginBottom: 12 }}>
        현재 화면에서 활용 가능한 항목 {confirmed}개 · 현장조사나 추가 API가 필요한 항목 {insight.missingCount}개
      </div>
      <div
        style={{
          display: "grid",
          gap: 1,
          background: "var(--border)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          overflow: "hidden",
        }}
      >
        {insight.items.map((item) => (
          <DataCheckRow key={item.label} item={item} />
        ))}
      </div>
    </Panel>
  );
}

export function ExistingReviewPanel({ options }: { options: ExistingReviewOption[] }) {
  return (
    <Panel title="⑧ 기존 건물 예비 검토" source="노후도·법규 사용 현황 기반 · 최종 추천 아님">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 10,
        }}
      >
        {options.map((option) => (
          <ReviewCard key={option.id} option={option} />
        ))}
      </div>
      <div
        style={{
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: 8,
          background: "var(--bg-sunken)",
          color: "var(--fg-muted)",
          fontSize: 11.5,
          lineHeight: 1.6,
        }}
      >
        구조 안전성·누수·설비 상태·임대 현황은 현재 데이터로 판단하지 않습니다. 유지·리모델링·철거 결정은 현장조사와 Stage 2 가능 규모, Stage 3 사업성을 함께 비교해야 합니다.
      </div>
    </Panel>
  );
}

function InsightRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: "var(--bg-elev)", padding: "12px 13px" }}>
      <div style={{ fontSize: 10.5, color: "var(--fg-subtle)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 650 }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 10.5, color: "var(--fg-faint)", marginTop: 4, lineHeight: 1.45 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MarketMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: "var(--bg-elev)", padding: "12px 13px", minHeight: 76 }}>
      <div style={{ fontSize: 10.5, color: "var(--fg-subtle)", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--fg-faint)", marginTop: 4, lineHeight: 1.4 }}>
        {sub}
      </div>
    </div>
  );
}

function CountCard({ label, value, tone }: { label: string; value: number; tone: ReviewTone }) {
  const style = toneStyle(tone);
  return (
    <div
      style={{
        padding: "12px 13px",
        borderRadius: 8,
        border: `1px solid ${style.border}`,
        background: style.background,
      }}
    >
      <div style={{ fontSize: 10.5, color: style.color }}>{label}</div>
      <div style={{ marginTop: 3, fontSize: 22, fontWeight: 750, color: style.color }}>{value}</div>
    </div>
  );
}

function DataCheckRow({ item }: { item: DataCheckItem }) {
  const labels = {
    available: { text: "확보", color: "var(--pos-fg)", bg: "var(--pos-soft)" },
    derived: { text: "파생", color: "var(--fg-muted)", bg: "var(--bg-sunken)" },
    missing: { text: "확인 필요", color: "var(--warn-fg)", bg: "var(--warn-soft)" },
  } as const;
  const status = labels[item.status];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 0.8fr) minmax(0, 1fr) auto",
        gap: 10,
        alignItems: "center",
        padding: "10px 12px",
        background: "var(--bg-elev)",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</div>
      <div style={{ fontSize: 11, color: "var(--fg-faint)", lineHeight: 1.45 }}>
        {item.source}
        {item.note ? ` · ${item.note}` : ""}
      </div>
      <span
        style={{
          justifySelf: "end",
          padding: "4px 7px",
          borderRadius: 999,
          background: status.bg,
          color: status.color,
          fontSize: 10.5,
          fontWeight: 650,
          whiteSpace: "nowrap",
        }}
      >
        {status.text}
      </span>
    </div>
  );
}

function ReviewCard({ option }: { option: ExistingReviewOption }) {
  const style = toneStyle(option.tone);
  return (
    <article
      style={{
        border: `1px solid ${style.border}`,
        borderRadius: 9,
        padding: 14,
        background: style.background,
        minHeight: 420,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{option.title}</h3>
        <span
          style={{
            marginLeft: "auto",
            padding: "4px 7px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.72)",
            color: style.color,
            border: `1px solid ${style.border}`,
            fontSize: 10.5,
            fontWeight: 650,
          }}
        >
          {option.status}
        </span>
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--fg-muted)" }}>
        {option.summary}
      </p>
      <div style={{ marginTop: 13, display: "grid", gap: 7 }}>
        {option.points.map((point) => (
          <div
            key={point}
            style={{
              display: "flex",
              gap: 7,
              fontSize: 11.5,
              color: "var(--fg-subtle)",
              lineHeight: 1.5,
            }}
          >
            <span>·</span>
            <span>{point}</span>
          </div>
        ))}
      </div>
      <ReviewDetail label="비용 영향" text={option.costImpact} />
      <ReviewDetail label="필수 확인" items={option.requiredChecks} />
      <ReviewDetail label="다음 단계" text={option.nextStep} />
    </article>
  );
}

function ReviewDetail({
  label,
  text,
  items,
}: {
  label: string;
  text?: string;
  items?: string[];
}) {
  return (
    <div style={{ marginTop: 13, paddingTop: 11, borderTop: "1px solid rgba(100,116,139,0.2)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 750, color: "var(--fg-subtle)", marginBottom: 5 }}>
        {label}
      </div>
      {text && (
        <div style={{ fontSize: 11.5, lineHeight: 1.55, color: "var(--fg-muted)" }}>{text}</div>
      )}
      {items && (
        <div style={{ display: "grid", gap: 4 }}>
          {items.map((item) => (
            <div key={item} style={{ display: "flex", gap: 6, fontSize: 11, lineHeight: 1.45, color: "var(--fg-muted)" }}>
              <span>·</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toneStyle(tone: ReviewTone): { background: string; color: string; border: string } {
  const styles: Record<ReviewTone, { background: string; color: string; border: string }> = {
    positive: { background: "var(--pos-soft)", color: "var(--pos-fg)", border: "var(--pos)" },
    warning: { background: "var(--warn-soft)", color: "var(--warn-fg)", border: "var(--warn)" },
    neutral: { background: "var(--bg-sunken)", color: "var(--fg-muted)", border: "var(--border)" },
  };
  return styles[tone];
}

export const responsiveInsightGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
  gap: "var(--s5)",
  alignItems: "start",
};
