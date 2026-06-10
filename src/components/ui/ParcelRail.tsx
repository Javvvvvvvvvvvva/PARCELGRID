"use client";

import { Tag, Dot } from "./Tag";
import { won, num, pyeong } from "@/lib/utils/format";
import type { ParcelVM } from "@/lib/adapters/view-model";

interface ParcelRailProps {
  parcel: ParcelVM;
  compact?: boolean;
  syncedMinutesAgo?: number;
  version?: string;
}

export function ParcelRail({
  parcel,
  compact = false,
  syncedMinutesAgo = 14,
  version = "v218",
}: ParcelRailProps) {
  return (
    <aside
      style={{
        width: compact ? 232 : 260,
        borderRight: "1px solid var(--border)",
        background: "var(--bg-rail)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--border)" }}>
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
            marginBottom: 6,
          }}
        >
          <span>PARCEL</span>
          <span style={{ color: "var(--fg-faint)" }}>·</span>
          <span className="mono" style={{ textTransform: "none", letterSpacing: 0 }}>
            {parcel.id}
          </span>
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
        <div className="ui-kv"><span className="ui-kv__k">최고고도</span><span className="ui-kv__v">{parcel.heightLimit} m</span></div>

        <div className="ui-sb-section" style={{ padding: "14px 0 6px" }}>이격거리</div>
        <div className="ui-kv"><span className="ui-kv__k">전면도로</span><span className="ui-kv__v">{parcel.setback.road} m</span></div>
        <div className="ui-kv"><span className="ui-kv__k">측면</span><span className="ui-kv__v">{parcel.setback.side} m</span></div>
        <div className="ui-kv"><span className="ui-kv__k">후면</span><span className="ui-kv__v">{parcel.setback.rear} m</span></div>

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
    </aside>
  );
}
