"use client";

import { Tag, Dot } from "./Tag";
import { Icons } from "./Icons";
import { won, num, pyeong } from "@/lib/utils/format";
import type { ParcelVM } from "@/lib/adapters/view-model";
import { useProjectStore } from "@/lib/stores/project-store";

interface ParcelRailProps {
  parcel: ParcelVM;
  compact?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  syncedMinutesAgo?: number;
  version?: string;
}

const COLLAPSED_W = 40;

export function ParcelRail({
  parcel,
  compact = false,
  collapsed = false,
  onToggleCollapse,
  syncedMinutesAgo = 14,
  version = "v218",
}: ParcelRailProps) {
  const plan = useProjectStore((s) => s.envelopePlan);
  const scenarioLabel =
    plan?.scenarioType === "single-house"
      ? "단독주택"
      : plan?.scenarioType === "multi-family"
      ? "다가구주택"
      : plan?.scenarioType === "retail"
      ? "근린생활시설"
      : null;

  const expandedWidth = compact ? 232 : 260;

  return (
    <aside
      className={`pg-parcel-rail${collapsed ? " pg-parcel-rail--collapsed" : ""}`}
      style={{ width: collapsed ? COLLAPSED_W : expandedWidth }}
    >
      {/* 접힌 상태 UI */}
      <div className="pg-parcel-rail__collapsed" aria-hidden={!collapsed}>
        <button
          onClick={onToggleCollapse}
          title="부지 정보 펼치기"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            color: "var(--fg-muted)",
            cursor: "pointer",
          }}
        >
          <span className="pg-parcel-rail__toggle-icon">{Icons.chevR()}</span>
        </button>
        <div
          style={{
            writingMode: "vertical-rl",
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--fg-muted)",
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxHeight: "60vh",
          }}
        >
          PARCEL · {parcel.address}
        </div>
      </div>

      {/* 펼친 상태 UI */}
      <div
        className="pg-parcel-rail__expanded"
        style={{ width: expandedWidth }}
        aria-hidden={collapsed}
      >
        {/* Header */}
        <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10.5,
                color: "var(--fg-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
                minWidth: 0,
              }}
            >
              <span>PARCEL</span>
              <span style={{ color: "var(--fg-faint)" }}>·</span>
              <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>
                {parcel.id}
              </span>
            </div>
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                title="부지 정보 접기"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  border: 0,
                  background: "transparent",
                  color: "var(--fg-muted)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <span className="pg-parcel-rail__toggle-icon pg-parcel-rail__toggle-icon--collapse">
                  {Icons.chevR()}
                </span>
              </button>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {parcel.address}
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>
            도로명 · {parcel.addressRoad}
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
            <Tag kind="accent">{parcel.zoning}</Tag>
            <Tag>{parcel.zoneCode}</Tag>
          </div>
        </div>

        {/* Body */}
        <div className="scroll-host" style={{ flex: 1, padding: "10px 14px" }}>
          <div className="ui-sb-section" style={{ padding: "4px 0 6px" }}>대지 정보</div>
          <div className="ui-kv"><span className="ui-kv__k">대지면적</span><span className="ui-kv__v">{num(parcel.lotArea, 2)} m²</span></div>
          <div className="ui-kv"><span className="ui-kv__k">대지면적</span><span className="ui-kv__v">{pyeong(parcel.lotArea)}</span></div>
          <div className="ui-kv"><span className="ui-kv__k">건폐율 상한</span><span className="ui-kv__v">{parcel.maxBCR}%</span></div>
          <div className="ui-kv"><span className="ui-kv__k">용적률 상한</span><span className="ui-kv__v">{parcel.maxFAR}%</span></div>

          {plan && scenarioLabel && (
            <>
              <div className="ui-sb-section" style={{ padding: "14px 0 6px" }}>건축 기획</div>
              <div className="ui-kv"><span className="ui-kv__k">계획 용적률</span><span className="ui-kv__v">{plan.farPct}%</span></div>
              <div className="ui-kv"><span className="ui-kv__k">시나리오</span><span className="ui-kv__v">{scenarioLabel} {plan.floors}층</span></div>
              {plan.units > 1 && (
                <div className="ui-kv"><span className="ui-kv__k">세대수</span><span className="ui-kv__v">{plan.units}세대</span></div>
              )}
              <div className="ui-kv"><span className="ui-kv__k">필요 주차</span><span className="ui-kv__v">{plan.requiredCars}대</span></div>
            </>
          )}
          <div className="ui-sb-section" style={{ padding: "14px 0 6px" }}>이격거리 (건축법 기준)</div>
          <div className="ui-kv"><span className="ui-kv__k">정북 일조</span><span className="ui-kv__v">건물높이별 §86</span></div>
          <div className="ui-kv"><span className="ui-kv__k">측면·후면</span><span className="ui-kv__v">민법 0.5m+조례</span></div>
          <div className="ui-kv"><span className="ui-kv__k">도로후퇴</span><span className="ui-kv__v" style={{ opacity: 0.5 }}>실폭 데이터 필요</span></div>

          <div className="ui-sb-section" style={{ padding: "14px 0 6px" }}>인수 정보</div>
          <div className="ui-kv"><span className="ui-kv__k">인수일</span><span className="ui-kv__v">{parcel.acquired}</span></div>
          <div className="ui-kv"><span className="ui-kv__k">인수가</span><span className="ui-kv__v">{won(parcel.acquiredPrice)}</span></div>
          <div className="ui-kv"><span className="ui-kv__k">공시지가</span><span className="ui-kv__v">{num(parcel.landPrice / 10000)}만/m²</span></div>
          <div className="ui-kv"><span className="ui-kv__k">실거래 추정</span><span className="ui-kv__v">{num(parcel.estMarketPrice / 10000)}만/m²</span></div>

          <div className="ui-sb-section" style={{ padding: "14px 0 6px" }}>
            규제 체크 <span style={{ marginLeft: 6, color: "var(--fg-faint)", fontWeight: 500 }}>{parcel.risks.length}개 항목</span>
          </div>
          {parcel.risks.map((r) => (
            <div
              key={r.code}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "6px 0",
                borderBottom: "1px dashed var(--border-faint)",
              }}
            >
              <span style={{ marginTop: 5 }}>
                <Dot kind={r.level === "high" ? "neg" : r.level === "med" ? "warn" : "pos"} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span>{r.label}</span>
                  <span className="mono" style={{ color: "var(--fg-faint)", fontSize: 10.5 }}>
                    {r.code}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 1 }}>
                  {r.note}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11.5,
            color: "var(--fg-muted)",
          }}
        >
          <Dot kind="pos" />
          <span>최종 동기화 {syncedMinutesAgo}분 전</span>
          <span style={{ marginLeft: "auto" }} className="mono">{version}</span>
        </div>
      </div>
    </aside>
  );
}
