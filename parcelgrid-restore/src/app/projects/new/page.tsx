"use client";

/**
 * /projects/new — 새 부지 분석 페이지
 *
 * 흐름:
 *   1. 주소 입력 → POST /api/parcels/lookup (Kakao + V월드 + MOLIT 건축물)
 *   2. lookup 성공 → POST /api/parcels/estimate-price (시군구별 인수가 추정)
 *   3. 결과 자동 표시, 인수가 자동 입력 (수정 가능)
 *   4. "분석 시작" → sessionStorage 저장 → /projects/${pnu} 이동
 *
 * 살아있는 어댑터들:
 *   - calculateDemolitionCost(buildings, signal) → 철거비 (만원)
 *   - won/pct/num/koreanDate/pyeong → 포맷터
 *   - Tag/Dot/Source → 디자인 토큰 컴포넌트
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Tag, Dot, Source } from "@/components/ui/Tag";
import { Icons } from "@/components/ui/Icons";
import { won, num, pyeong, koreanDate } from "@/lib/utils/format";
import { calculateDemolitionCost } from "@/lib/finance/demolition-cost";
import type { BuildingInfo, RedevelopmentSignal } from "@/lib/integrations/molit-building";

/* ─────────────────────────── 타입 ─────────────────────────── */

interface LookupResult {
  address: string;
  addressRoad: string | null;
  lat: number;
  lng: number;
  bCode: string;
  lawdCd: string;
  sido: string;
  sigungu: string;
  dong: string;
  jibun: string | null;
  mainAddressNo: string;
  subAddressNo: string;
  mountainYn: "Y" | "N" | "";

  pnu: string;
  lotArea: number;
  jimok: string;
  jimokCode: string;
  jimokCategory: "buildable" | "farmland" | "forest" | "other";
  landPrice: number;
  landPriceYear: string;

  zoning: string;
  zoneCode: string;
  maxFAR: number;
  maxBCR: number;
  heightLimit: number;
  overlays: Array<{ code: string; name: string; conflict: string }>;

  currentBuilding: {
    buildings: BuildingInfo[];
    hasBuilding: boolean;
    totalBuildingArea: number;
    redevelopmentSignal: RedevelopmentSignal;
    signalLabel: string;
    signalReasoning: string;
    oldestApprovalDate?: string;
    maxAgeYears?: number;
  } | null;
}

interface EstimateResult {
  estimatedPriceManwon: number;
  estimatedPricePerPyeong: number;
  method: "by-comps" | "by-publicvalue" | "hybrid";
  confidence: "high" | "medium" | "low";
  transactionCount?: number;
}

/* ─────────────────────────── 페이지 ─────────────────────────── */

export default function NewParcelPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Lookup 결과
  const [parcel, setParcel] = useState<LookupResult | null>(null);

  // 추정 결과
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);

  // 사용자 수정 가능한 인수가 (만원)
  const [acquiredPrice, setAcquiredPrice] = useState<number>(0);
  const [acquiredDate, setAcquiredDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  // ─── 부지 조회 ─────────────────────────────────────────────────────
  async function handleLookup() {
    if (!address.trim()) return;
    setIsLookingUp(true);
    setLookupError(null);
    setParcel(null);
    setEstimate(null);

    try {
      // 1. Lookup (Kakao + V월드 + MOLIT 건축물)
      const lookupRes = await fetch("/api/parcels/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim() }),
      });

      if (!lookupRes.ok) {
        const err = await lookupRes.json().catch(() => ({}));
        throw new Error(err.error ?? `lookup 실패 (${lookupRes.status})`);
      }

      const lookupData: LookupResult = await lookupRes.json();
      setParcel(lookupData);

      // 2. 인수가 추정 (시군구별 multiplier)
      const estRes = await fetch("/api/parcels/estimate-price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: lookupData.address,
          lotArea: lookupData.lotArea,
          landPrice: lookupData.landPrice,
          lawdCd: lookupData.lawdCd,
          jimokCategory: lookupData.jimokCategory,
        }),
      });

      if (estRes.ok) {
        const estData: EstimateResult = await estRes.json();
        setEstimate(estData);
        setAcquiredPrice(estData.estimatedPriceManwon);
      } else {
        // 추정 실패는 비치명적
        console.warn("인수가 추정 실패 — 사용자가 직접 입력해야 함");
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "알 수 없는 오류");
    } finally {
      setIsLookingUp(false);
    }
  }

  // ─── 철거비 자동 계산 ──────────────────────────────────────────────
  const demolitionCost = parcel?.currentBuilding
    ? calculateDemolitionCost(
        parcel.currentBuilding.buildings,
        parcel.currentBuilding.redevelopmentSignal
      )
    : 0;

  // ─── 분석 시작: sessionStorage 저장 + 대시보드 이동 ─────────────────
  function handleStart() {
    if (!parcel || !acquiredPrice) return;

    const storedParcel = {
      id: parcel.pnu,
      address: parcel.address,
      addressRoad: parcel.addressRoad,
      lat: parcel.lat,
      lng: parcel.lng,
      lawdCd: parcel.lawdCd,
      pnu: parcel.pnu,
      lotArea: parcel.lotArea,
      zoning: parcel.zoning,
      zoneCode: parcel.zoneCode,
      maxFAR: parcel.maxFAR,
      maxBCR: parcel.maxBCR,
      heightLimit: parcel.heightLimit,
      landPrice: parcel.landPrice,
      landPriceYear: parcel.landPriceYear,
      setback: { road: 3, side: 1.5, rear: 3 }, // 기본 이격거리 (시행 실무 기준)
      estMarketPrice: estimate
        ? Math.round((estimate.estimatedPriceManwon * 10_000) / parcel.lotArea)
        : parcel.landPrice * 2,
      acquired: acquiredDate,
      acquiredPrice,
      demolitionCost,
    };

    sessionStorage.setItem("parcelgrid:draft-parcel", JSON.stringify(storedParcel));
    router.push(`/projects/${parcel.pnu}`);
  }

  // ─── UI ───────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          height: 44,
          padding: "0 14px",
          background: "var(--bg-elev)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontSize: 12.5,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
            color: "var(--fg)",
          }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              background: "var(--fg)",
              color: "var(--bg)",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              borderRadius: 3,
            }}
          >
            PG
          </div>
          <span style={{ fontWeight: 600 }}>PARCELGRID</span>
          <span style={{ color: "var(--fg-subtle)", fontWeight: 500 }}>
            v2.4 · 한국
          </span>
        </Link>
        <div style={{ marginLeft: 16, color: "var(--fg-muted)" }}>
          <span>프로젝트</span>
          <span style={{ margin: "0 8px", color: "var(--fg-faint)" }}>/</span>
          <span style={{ color: "var(--fg)", fontWeight: 500 }}>새 부지 분석</span>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          maxWidth: 920,
          margin: "0 auto",
          padding: "32px 24px",
          width: "100%",
        }}
      >
        {/* Title */}
        <div style={{ marginBottom: 24 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: 0,
              marginBottom: 6,
            }}
          >
            새 부지 분석
          </h1>
          <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: 0 }}>
            지번 입력 → Kakao + V월드 + MOLIT 5개 API 자동 조회 → 시나리오 4종 자동 생성
          </p>
        </div>

        {/* Address input */}
        <Panel title="주소 검색">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              placeholder="예: 서울 도봉구 쌍문동 281-23"
              disabled={isLookingUp}
              style={{
                flex: 1,
                height: 36,
                padding: "0 12px",
                background: "var(--bg-elev)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                fontSize: 14,
                color: "var(--fg)",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={handleLookup}
              disabled={isLookingUp || !address.trim()}
              style={{
                height: 36,
                padding: "0 20px",
                background: isLookingUp || !address.trim() ? "var(--bg-active)" : "var(--fg)",
                color: isLookingUp || !address.trim() ? "var(--fg-muted)" : "var(--bg)",
                border: 0,
                borderRadius: 5,
                fontSize: 13,
                fontWeight: 500,
                cursor: isLookingUp || !address.trim() ? "not-allowed" : "pointer",
              }}
            >
              {isLookingUp ? "조회중..." : "조회 →"}
            </button>
          </div>

          {/* 진행 상태 / 에러 */}
          {isLookingUp && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                background: "var(--accent-soft)",
                border: "1px solid var(--accent)",
                borderRadius: 5,
                fontSize: 12.5,
                color: "var(--accent-fg)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Dot kind="accent" />
              <span>Kakao 좌표 → V월드 지적 → V월드 용도지역 → MOLIT 건축물 → 인수가 추정...</span>
            </div>
          )}
          {lookupError && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                background: "var(--neg-soft)",
                border: "1px solid var(--neg)",
                borderRadius: 5,
                fontSize: 12.5,
                color: "var(--neg-fg)",
              }}
            >
              {lookupError}
            </div>
          )}
        </Panel>

        {/* 결과 영역 */}
        {parcel && (
          <>
            {/* 부지 헤더 */}
            <div style={{ marginTop: 24, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
                  {parcel.sido} {parcel.sigungu} {parcel.dong} {parcel.jibun ?? ""}
                </h2>
                <span className="mono" style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                  PNU {parcel.pnu}
                </span>
              </div>
              {parcel.addressRoad && (
                <div style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 2 }}>
                  도로명 · {parcel.addressRoad}
                </div>
              )}
              <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                <Tag kind="accent">{parcel.zoning}</Tag>
                <Tag>{parcel.zoneCode}</Tag>
                {parcel.jimok && <Tag>{parcel.jimok}</Tag>}
              </div>
            </div>

            {/* 부지 정보 + 현재 건물 (2-column) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {/* 부지 정보 */}
              <Panel title="부지 정보" source="V월드">
                <KV label="대지면적" value={`${num(parcel.lotArea, 2)} m²`} />
                <KV label="대지면적" value={pyeong(parcel.lotArea)} />
                <KV label="건폐율 상한" value={`${parcel.maxBCR}%`} />
                <KV label="용적률 상한" value={`${parcel.maxFAR}%`} />
                <KV label="최고고도" value={`${parcel.heightLimit} m`} />
                <KV
                  label="공시지가"
                  value={`${num(parcel.landPrice / 10_000)}만원/m²`}
                  sub={`${parcel.landPriceYear}년 기준`}
                />
              </Panel>

              {/* 현재 건물 */}
              <Panel title="현재 건물" source="MOLIT 건축물대장">
                {parcel.currentBuilding && parcel.currentBuilding.hasBuilding ? (
                  <CurrentBuildingBox
                    info={parcel.currentBuilding}
                    demolitionCost={demolitionCost}
                  />
                ) : (
                  <div
                    style={{
                      padding: 14,
                      background: "var(--bg-sunken)",
                      borderRadius: 5,
                      fontSize: 13,
                      color: "var(--fg-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Dot kind="pos" />
                    빈 토지 — 신축 가능
                  </div>
                )}
              </Panel>
            </div>

            {/* 인수 정보 */}
            <div style={{ marginTop: 16 }}>
              <Panel
                title="인수 정보"
                source={estimate ? `시군구별 시장 추정 · ${estimate.method}` : "수동 입력"}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div>
                    <Label>인수가 (만원)</Label>
                    <input
                      type="number"
                      value={acquiredPrice || ""}
                      onChange={(e) => setAcquiredPrice(parseInt(e.target.value) || 0)}
                      style={{
                        width: "100%",
                        height: 32,
                        padding: "0 8px",
                        background: "var(--bg-elev)",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        fontFamily: "var(--font-mono)",
                        fontSize: 14,
                        color: "var(--fg)",
                      }}
                    />
                    {acquiredPrice > 0 && (
                      <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 4 }}>
                        ≈ {won(acquiredPrice)}
                        {estimate && (
                          <span style={{ marginLeft: 8 }}>
                            {confidenceLabel(estimate.confidence)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>인수일</Label>
                    <input
                      type="date"
                      value={acquiredDate}
                      onChange={(e) => setAcquiredDate(e.target.value)}
                      style={{
                        width: "100%",
                        height: 32,
                        padding: "0 8px",
                        background: "var(--bg-elev)",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        fontFamily: "var(--font-mono)",
                        fontSize: 14,
                        color: "var(--fg)",
                      }}
                    />
                    <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 4 }}>
                      {koreanDate(acquiredDate)}
                    </div>
                  </div>
                </div>

                {/* 추정 근거 */}
                {estimate && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      background: "var(--bg-sunken)",
                      borderRadius: 5,
                      fontSize: 12,
                      color: "var(--fg-muted)",
                    }}
                  >
                    <div style={{ fontWeight: 500, color: "var(--fg)", marginBottom: 4 }}>
                      추정 인수가 약 {won(estimate.estimatedPriceManwon)}
                    </div>
                    <div>
                      평당 {num(estimate.estimatedPricePerPyeong)}만원 ·{" "}
                      {methodLabel(estimate.method)}
                      {estimate.transactionCount != null &&
                        ` · 최근 12개월 토지 거래 ${estimate.transactionCount}건`}
                    </div>
                  </div>
                )}
              </Panel>
            </div>

            {/* 분석 시작 */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
              <button
                onClick={handleStart}
                disabled={!acquiredPrice}
                style={{
                  padding: "0 24px",
                  height: 40,
                  background: !acquiredPrice ? "var(--bg-active)" : "var(--accent)",
                  color: !acquiredPrice ? "var(--fg-muted)" : "var(--fg-onaccent)",
                  border: 0,
                  borderRadius: 5,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: !acquiredPrice ? "not-allowed" : "pointer",
                }}
              >
                분석 시작 → 시나리오 4종 생성
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── 헬퍼 컴포넌트 ─────────────────────────── */

function Panel({
  title,
  source,
  children,
}: {
  title: string;
  source?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 7,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 36,
          padding: "0 14px",
          borderBottom: "1px solid var(--border)",
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
          {title}
        </div>
        {source && (
          <div style={{ marginLeft: "auto" }}>
            <Source>{source}</Source>
          </div>
        )}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function KV({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        fontSize: 12.5,
        borderBottom: "1px dashed var(--border-faint)",
      }}
    >
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <div className="mono" style={{ color: "var(--fg)", fontWeight: 500 }}>{value}</div>
        {sub && (
          <div style={{ fontSize: 11, color: "var(--fg-faint)", marginTop: 1 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "var(--fg-muted)",
        fontWeight: 500,
        marginBottom: 6,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </div>
  );
}

function CurrentBuildingBox({
  info,
  demolitionCost,
}: {
  info: NonNullable<LookupResult["currentBuilding"]>;
  demolitionCost: number;
}) {
  const main = info.buildings.find((b) => b.isMainBuilding) ?? info.buildings[0];
  if (!main) return null;

  const signalKind: "pos" | "warn" | "neg" =
    info.redevelopmentSignal === "rebuild"
      ? "neg"
      : info.redevelopmentSignal === "renovate"
        ? "warn"
        : "pos";

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", marginBottom: 4 }}>
        {main.approvalDate.slice(0, 4)}년 {main.approvalDate.slice(5, 7)}월 준공
        {main.ageYears != null && (
          <span style={{ color: "var(--fg-muted)", marginLeft: 8 }}>
            ({main.ageYears}년 노후)
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-muted)", marginBottom: 10 }}>
        {main.mainPurpose} · 지상 {main.groundFloors}층
        {main.undergroundFloors > 0 && ` / 지하 ${main.undergroundFloors}층`}
        {" · "}
        연면적 {num(main.totalArea, 2)} m²
        {main.structure && ` · ${main.structure}`}
      </div>

      <div
        style={{
          padding: "8px 10px",
          background:
            signalKind === "neg"
              ? "var(--neg-soft)"
              : signalKind === "warn"
                ? "var(--warn-soft)"
                : "var(--pos-soft)",
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12.5,
          fontWeight: 500,
          color:
            signalKind === "neg"
              ? "var(--neg-fg)"
              : signalKind === "warn"
                ? "var(--warn-fg)"
                : "var(--pos-fg)",
        }}
      >
        <Dot kind={signalKind} />
        <span>{info.signalLabel}</span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 6, lineHeight: 1.5 }}>
        {info.signalReasoning}
      </div>

      {/* 철거비 */}
      {demolitionCost > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            background: "var(--bg-sunken)",
            borderRadius: 5,
            fontSize: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ color: "var(--fg-muted)" }}>예상 철거비</span>
          <span className="mono" style={{ fontWeight: 500 }}>
            약 {num(demolitionCost)}만원
            <span style={{ color: "var(--fg-faint)", marginLeft: 6, fontSize: 11 }}>
              ({pyeong(main.totalArea)})
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 헬퍼 함수 ─────────────────────────── */

function confidenceLabel(c: "high" | "medium" | "low"): string {
  if (c === "high") return "신뢰도 높음";
  if (c === "medium") return "신뢰도 중간";
  return "신뢰도 낮음 (참고용)";
}

function methodLabel(m: "by-comps" | "by-publicvalue" | "hybrid"): string {
  if (m === "by-comps") return "실거래 중앙값 기반";
  if (m === "by-publicvalue") return "공시지가 × 시군구 배율";
  return "실거래 + 공시지가 혼합";
}
