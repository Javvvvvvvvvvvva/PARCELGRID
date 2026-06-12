"use client";

/**
 * 시나리오 4종 비교 테이블 — 대시보드 메인 (PDF p1).
 *
 * 행 구조 (PDF p1 기준):
 *   권장(태그) | 유형(시나리오명/tag) | 빌딩타입 | 용적률 | 연면적 | 이익 | DSCR | IRR | 규제 (mini bar)
 *
 * 본인 도구 데이터:
 *   ScenarioVM (id, name, shortName, typeKr, far, gfa, profit, dscr, irr, regulatory, recommended)
 */

import Link from "next/link";
import type { ScenarioVM } from "@/lib/adapters/view-model";
import { won, num, pct } from "@/lib/utils/format";
import { Tag } from "@/components/ui/Tag";

interface ScenarioTableProps {
  scenarios: ScenarioVM[];
  projectId: string;
  /** 선택된 시나리오. 클릭 시 자세히 보기 */
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function ScenarioTable({
  scenarios,
  projectId,
  selectedId,
  onSelect,
}: ScenarioTableProps) {
  // 규제점수 정상화 — 최대값 100 가정, 최소값 60 정도
  const maxRegulatory = Math.max(100, ...scenarios.map((s) => s.regulatory));

  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflow: "hidden",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 36,
          padding: "0 14px",
          borderBottom: "1px solid var(--border)",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--fg-muted)",
          }}
        >
          시나리오
        </div>
        <span style={{ fontSize: 11.5, color: "var(--fg-subtle)" }}>
          {scenarios.length}개 안 · 최종 갱신{" "}
          {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\. /g, ".").replace(".", "")}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <Link
            href={`/projects/${projectId}/comparison`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              height: 22,
              padding: "0 7px",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--fg)",
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              textDecoration: "none",
            }}
          >
            비교
          </Link>
          <button
            style={{
              height: 22,
              padding: "0 7px",
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--fg)",
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            + 새 안
          </button>
        </div>
      </div>

      {/* Table */}
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12.5,
        }}
      >
        <thead>
          <tr>
            <Th width={50}>안</Th>
            <Th width="auto">유형</Th>
            <Th width={120}>빌딩타입</Th>
            <Th width={70} align="right">용적률</Th>
            <Th width={90} align="right">연면적</Th>
            <Th width={70} align="right">이익</Th>
            <Th width={50} align="right">DSCR</Th>
            <Th width={50} align="right">IRR</Th>
            <Th width={100}>규제</Th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((s) => {
            const isRec = s.recommended;
            const isSelected = selectedId === s.id;

            return (
              <tr
                key={s.id}
                onClick={() => onSelect?.(s.id)}
                style={{
                  cursor: onSelect ? "pointer" : "default",
                  background: isSelected ? "var(--accent-soft)" : "transparent",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "var(--bg-sunken)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* 권장 라벨 */}
                <Td>
                  {isRec ? (
                    <span
                      style={{
                        display: "inline-block",
                        padding: "1px 6px",
                        background: "var(--fg)",
                        color: "var(--bg)",
                        fontSize: 10,
                        fontWeight: 600,
                        borderRadius: 3,
                        letterSpacing: "0.04em",
                      }}
                    >
                      권장
                    </span>
                  ) : (
                    <span className="mono" style={{ color: "var(--fg-muted)", fontSize: 11 }}>
                      {s.shortName}
                    </span>
                  )}
                </Td>

                {/* 시나리오명 */}
                <Td>
                  <div style={{ fontWeight: 500, color: "var(--fg)" }}>{s.name}</div>
                  {s.tag && (
                    <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 1 }}>
                      {s.tag}
                    </div>
                  )}
                </Td>

                {/* 빌딩 타입 */}
                <Td>
                  <span style={{ color: "var(--fg-muted)" }}>{s.typeKr}</span>
                </Td>

                {/* 용적률 */}
                <Td align="right" mono>
                  {pct(s.far, 0)}
                </Td>

                {/* 연면적 */}
                <Td align="right" mono>
                  {num(s.gfa, 0)} m²
                </Td>

                {/* 이익 */}
                <Td align="right" mono>
                  <span
                    style={{
                      color: s.profit > 0 ? "var(--fg)" : "var(--neg-fg)",
                      fontWeight: 500,
                    }}
                  >
                    {won(s.profit)}
                  </span>
                </Td>

                {/* DSCR */}
                <Td align="right" mono>
                  {s.dscr > 0 ? s.dscr.toFixed(2) : "—"}
                </Td>

                {/* IRR */}
                <Td align="right" mono>
                  {s.irr ? pct(s.irr, 1) : "—"}
                </Td>

                {/* Regulatory mini bar */}
                <Td>
                  <RegulatoryBar value={s.regulatory} max={maxRegulatory} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────── 헬퍼 ─────────────────────────── */

function Th({
  children,
  width,
  align = "left",
}: {
  children: React.ReactNode;
  width?: number | string;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        width,
        textAlign: align,
        padding: "0 10px",
        height: 32,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--fg-muted)",
        background: "var(--bg-sunken)",
        borderBottom: "1px solid var(--border)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: "10px",
        borderBottom: "1px solid var(--border-faint)",
        whiteSpace: "nowrap",
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        fontVariantNumeric: mono ? "tabular-nums" : "normal",
      }}
    >
      {children}
    </td>
  );
}

function RegulatoryBar({ value, max }: { value: number; max: number }) {
  const pctVal = Math.min(100, (value / max) * 100);

  // 색상: 90+ = green, 70-89 = warn, < 70 = red
  const kind: "pos" | "warn" | "neg" =
    value >= 90 ? "pos" : value >= 70 ? "warn" : "neg";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "var(--bg-sunken)",
          borderRadius: 999,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            right: `${100 - pctVal}%`,
            background:
              kind === "pos"
                ? "var(--pos)"
                : kind === "warn"
                  ? "var(--warn)"
                  : "var(--neg)",
          }}
        />
      </div>
      <span
        className="mono"
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--fg)",
          minWidth: 24,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
