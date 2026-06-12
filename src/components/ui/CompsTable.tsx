"use client";

/**
 * 실거래 비교 테이블 (PDF p1, p5).
 *
 * 헤더: 반경 X km · 최근 N개월 · M건
 * 행: 거래일 | 주소 | 유형 | 대지 | 거래가 | 평당 | 거리
 *
 * 본인 도구는 살아있는 어댑터들에서 거래 가져옴 (MolitTransaction).
 * 이 컴포넌트는 그 데이터를 받아 표시만.
 */

import Link from "next/link";
import { num } from "@/lib/utils/format";

/* 표시용 거래 타입 — MolitTransaction 받아서 표시할 수 있는 형태 */
export interface CompTransactionVM {
  id?: string;
  date: string;          // ISO yyyy-mm-dd or "yyyy.mm.dd"
  address: string;
  type: string;          // 오피스텔 / 도시형생활 / 근린생활 등
  lotArea: number;       // m²
  priceWon: number;      // 원 단위
  pricePerPyeong: number; // 만원/평
  distanceKm?: number | null;
}

interface CompsTableProps {
  comps: CompTransactionVM[];
  radiusKm?: number;
  rangeMonths?: number;
  projectId?: string;
  /** 더 보기 버튼 라우팅용. 없으면 버튼 숨김 */
  showViewMore?: boolean;
}

export function CompsTable({
  comps,
  radiusKm = 1.2,
  rangeMonths = 18,
  projectId,
  showViewMore = true,
}: CompsTableProps) {
  // 중앙값 계산
  const sortedPrices = [...comps]
    .filter((c) => c.pricePerPyeong > 0)
    .sort((a, b) => a.pricePerPyeong - b.pricePerPyeong);
  const median =
    sortedPrices.length > 0
      ? sortedPrices[Math.floor(sortedPrices.length / 2)].pricePerPyeong
      : 0;

  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 7,
      }}
    >
      {/* Header */}
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
          실거래 비교
        </div>
        <span style={{ fontSize: 11.5, color: "var(--fg-subtle)" }}>
          반경 {radiusKm}km · 최근 {rangeMonths}개월 · {comps.length}건
        </span>
        {showViewMore && projectId && (
          <Link
            href={`/projects/${projectId}/comps`}
            style={{
              marginLeft: "auto",
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
            전체 보기 →
          </Link>
        )}
      </div>

      {/* 빈 상태 */}
      {comps.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--fg-faint)",
            fontSize: 13,
          }}
        >
          실거래 데이터 없음 (MOLIT 응답 0건)
        </div>
      ) : (
        <>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12.5,
            }}
          >
            <thead>
              <tr>
                <Th width={100}>거래일</Th>
                <Th width="auto">주소</Th>
                <Th width={100}>유형</Th>
                <Th width={70} align="right">대지</Th>
                <Th width={80} align="right">거래가</Th>
                <Th width={80} align="right">평당</Th>
                <Th width={70} align="right">거리</Th>
              </tr>
            </thead>
            <tbody>
              {comps.slice(0, 8).map((c, i) => (
                <tr key={`${c.id ?? c.address}-${c.date}-${i}`}>
                  <Td mono>{formatDate(c.date)}</Td>
                  <Td>
                    <span style={{ color: "var(--fg)", fontWeight: 500 }}>{c.address}</span>
                  </Td>
                  <Td>
                    <span style={{ color: "var(--fg-muted)" }}>{c.type}</span>
                  </Td>
                  <Td align="right" mono>
                    {num(c.lotArea, 0)} m²
                  </Td>
                  <Td align="right" mono>
                    <span style={{ color: "var(--fg)", fontWeight: 500 }}>
                      {(c.priceWon / 100_000_000).toFixed(1)}억
                    </span>
                  </Td>
                  <Td align="right" mono>
                    <span style={{ color: "var(--accent-fg)", fontWeight: 500 }}>
                      {num(c.pricePerPyeong, 0)}만
                    </span>
                  </Td>
                  <Td align="right" mono>
                    {c.distanceKm != null ? `${c.distanceKm.toFixed(2)}km` : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer with stats */}
          <div
            style={{
              padding: "8px 14px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 11.5,
              color: "var(--fg-muted)",
            }}
          >
            <span>
              모든 거래는 국토교통부 실거래가 공개시스템 기준 · API 동기화
            </span>
            {median > 0 && (
              <span style={{ marginLeft: "auto" }}>
                중앙값{" "}
                <span className="mono" style={{ color: "var(--fg)", fontWeight: 500 }}>
                  평당 {num(median, 0)}만
                </span>
              </span>
            )}
          </div>
        </>
      )}
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
        padding: "8px 10px",
        borderBottom: "1px solid var(--border-faint)",
        whiteSpace: "nowrap",
        fontFamily: mono ? "var(--font-mono)" : "inherit",
        fontVariantNumeric: mono ? "tabular-nums" : "normal",
        fontSize: 12,
      }}
    >
      {children}
    </td>
  );
}

function formatDate(iso: string): string {
  // "2024-11-08" or "2024.11.08" → "2024.11.08"
  return iso.replace(/-/g, ".").slice(0, 10);
}
