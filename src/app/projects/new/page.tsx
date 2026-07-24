"use client";


import AcquisitionPriceInput from "@/components/AcquisitionPriceInput";
import { sqmToPyeong, type RawTransaction } from "@/lib/priceDistribution";
/**
 * /projects/new — 새 부지 분석 페이지
 *
 * 흐름:
 *   1. 주소 입력 → POST /api/parcels/lookup (Kakao + V월드 + MOLIT 건축물)
 *   2. 사용자가 알고 있는 부동산 총 취득대금을 직접 입력
 *   3. lookup 성공 → 주변 실거래·공시지가를 참고자료로 조회
 *   4. "분석 시작" → 입력값과 조회 사실을 분리 저장 → /projects/${pnu}/status 이동
 *
 * 살아있는 어댑터들:
 *   - calculateDemolitionCost(buildings, signal) → 철거비 (만원)
 *   - won/pct/num/koreanDate/pyeong → 포맷터
 *   - Tag/Dot/Source → 디자인 토큰 컴포넌트
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tag, Dot } from "@/components/ui/Tag";
import { TopBar } from "@/components/ui/TopBar";
import { Panel, DataRow, DateField, Button, SectionTitle } from "@/components/ui/primitives";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import { num, pyeong, koreanDate } from "@/lib/utils/format";
import { calculateDemolitionCost } from "@/lib/finance/demolition-cost";
import type { BuildingInfo, RedevelopmentSignal } from "@/lib/integrations/molit-building";
import type { AcquisitionEstimateSnapshot } from "@/lib/finance/types";

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
  /** 필지 경계 폴리곤 [lng, lat][] (WGS84). 3D 매싱용 */
  boundary?: [number, number][];
  roads?: { name: string | null; points: [number, number][] }[];
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

interface EstimateResult extends AcquisitionEstimateSnapshot {
  /** 추정 C: 구축 단독/다가구 토지 proxy (사례·근거) */
  houseEstimate?: import("@/lib/finance/land-price-from-comps").LandPriceEstimate;
  marketMedianPerPyeong?: number;
  marketMedianManwon?: number;
  details?: AcquisitionEstimateSnapshot["details"];
  transactionCount?: number;
  transactions?: Array<{
    priceManwon: number;
    areaSqm: number;
    date: string;
    address: string;
  }>;
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
        // Round H: 자동 pre-fill 제거 — 추정값은 참고 칩으로만
        // setAcquiredPrice(estData.estimatedPriceManwon);
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
  const demolitionResult = parcel?.currentBuilding
    ? calculateDemolitionCost(
        parcel.currentBuilding.buildings,
        parcel.currentBuilding.redevelopmentSignal
      )
    : null;
  const demolitionCost: number = demolitionResult?.totalManwon ?? 0;

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
      boundary: parcel.boundary,
      roads: parcel.roads,
      zoning: parcel.zoning,
      zoneCode: parcel.zoneCode,
      maxFAR: parcel.maxFAR,
      maxBCR: parcel.maxBCR,
      heightLimit: parcel.heightLimit,
      landPrice: parcel.landPrice,
      landPriceYear: parcel.landPriceYear,
      // 법적 최대 외곽선과 분리된 사용자 설계 여유거리. 새 프로젝트는 추가 여유 0m.
      setback: { road: 0, side: 0, rear: 0 },
      estMarketPrice: estimate
        ? Math.round((estimate.estimatedPriceManwon * 10_000) / parcel.lotArea)
        : parcel.landPrice * 2,
      acquisitionEstimate: estimate
        ? {
            modelVersion: estimate.modelVersion,
            modelStatus: estimate.modelStatus,
            warnings: estimate.warnings,
            estimatedPriceManwon: estimate.estimatedPriceManwon,
            estimatedPricePerPyeong: estimate.estimatedPricePerPyeong,
            method: estimate.method,
            confidence: estimate.confidence,
            marketMedianPerPyeong: estimate.marketMedianPerPyeong,
            marketMedianManwon: estimate.marketMedianManwon,
            houseProxy: estimate.houseEstimate
              ? {
                  sampleSize: estimate.houseEstimate.count,
                  medianPricePerPyeong: estimate.houseEstimate.medianPPPLand,
                  estimatedPriceManwon: estimate.houseEstimate.estimateManwon,
                  basis: estimate.houseEstimate.basis,
                }
              : undefined,
            transactionCount: estimate.transactionCount,
            details: estimate.details,
          }
        : undefined,
      acquired: acquiredDate,
      acquiredPrice,
      demolitionCost,
      currentBuilding: parcel.currentBuilding ?? null,
    };

    sessionStorage.setItem("parcelgrid:draft-parcel", JSON.stringify(storedParcel));
    router.push(`/projects/${parcel.pnu}/status`);
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
      <TopBar crumb={["새 부지 분석"]} />

      {/* Content */}
      <div
        style={{
          flex: 1,
          maxWidth: 1160,
          margin: "0 auto",
          padding: "var(--s8) var(--s6)",
          width: "100%",
        }}
      >
        <SectionTitle
          size="lg"
          title="새 부지 분석"
          desc="주소와 알고 있는 총 취득대금을 입력하면 토지·건물·법규·주변 시장 현황을 분석합니다."
          style={{ marginBottom: "var(--s6)" }}
        />

        {/* Address input */}
        <Panel title="주소와 총 취득대금">
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <AddressAutocomplete
              value={address}
              onChange={setAddress}
              onSubmit={handleLookup}
              disabled={isLookingUp}
              placeholder="예: 서울 도봉구 쌍문동 281-23"
            />
            <Button
              variant="primary"
              onClick={handleLookup}
              disabled={isLookingUp || !address.trim()}
              style={{ height: 36, flexShrink: 0 }}
            >
              {isLookingUp ? "조회중..." : "조회 →"}
            </Button>
          </div>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 11.5,
              color: "var(--fg-faint)",
            }}
          >
            2글자 이상 입력 시 주소 후보가 표시됩니다. 목록에서 선택하거나 Enter로 조회하세요.
          </p>

          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: "1px solid var(--border)",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 0.45fr)",
              gap: 18,
              alignItems: "end",
            }}
          >
            <div>
              <label
                htmlFor="initial-acquisition-price"
                style={{ display: "block", fontSize: 13, fontWeight: 700 }}
              >
                현재 알고 있는 부동산 총 취득대금
              </label>
              <p
                style={{
                  margin: "5px 0 0",
                  fontSize: 11.5,
                  color: "var(--fg-muted)",
                  lineHeight: 1.55,
                }}
              >
                토지와 기존 건물을 함께 취득하는 금액입니다. 주변 시세나 알고리즘 추정값으로 자동 입력하지 않습니다.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                id="initial-acquisition-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={acquiredPrice > 0 ? acquiredPrice / 10_000 : ""}
                onChange={(event) => {
                  const eok = Number(event.target.value);
                  setAcquiredPrice(Number.isFinite(eok) && eok > 0 ? Math.round(eok * 10_000) : 0);
                }}
                placeholder="예: 20.6"
                aria-label="부동산 총 취득대금 억원"
                style={{
                  width: "100%",
                  height: 40,
                  padding: "0 12px",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 8,
                  background: "var(--bg-elev)",
                  color: "var(--fg)",
                  font: "inherit",
                  fontSize: 16,
                  fontWeight: 700,
                  textAlign: "right",
                }}
              />
              <span style={{ flexShrink: 0, fontSize: 12.5, color: "var(--fg-muted)" }}>억원</span>
            </div>
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
              <span>Kakao 좌표 → V월드 지적·용도지역 → MOLIT 건축물 → 주변 시장 참고자료...</span>
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
            <div style={{ marginTop: "var(--s6)", marginBottom: "var(--s4)" }}>
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

            {/* 좌: 이 땅의 사실(부지·건물) / 우: 인수 의사결정 — 한 화면 2단 */}
            <div className="newp-grid">
              {/* 좌 컬럼 — 사실 정보 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--s4)" }}>
                <Panel title="부지 정보" source="V월드">
                  <DataRow
                    label="대지면적"
                    value={`${num(parcel.lotArea, 2)} m²`}
                    sub={pyeong(parcel.lotArea)}
                  />
                  <DataRow label="건폐율 상한" value={`${parcel.maxBCR}%`} />
                  <DataRow label="용적률 상한" value={`${parcel.maxFAR}%`} />
                  <DataRow label="최고고도" value={`${parcel.heightLimit} m`} />
                  <DataRow
                    label="공시지가"
                    value={`${num(parcel.landPrice / 10_000)}만원/m²`}
                    sub={`${parcel.landPriceYear}년 기준`}
                    divider={false}
                  />
                </Panel>

                <Panel title="현재 건물" source="MOLIT 건축물대장">
                  {parcel.currentBuilding && parcel.currentBuilding.hasBuilding ? (
                    <CurrentBuildingBox
                      info={parcel.currentBuilding}
                      demolitionCost={demolitionCost}
                    />
                  ) : (
                    <div
                      style={{
                        padding: "var(--s3)",
                        background: "var(--bg-sunken)",
                        borderRadius: "var(--r)",
                        fontSize: "var(--t-sm)",
                        color: "var(--fg-muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--s2)",
                      }}
                    >
                      <Dot kind="pos" />
                      빈 토지 — 신축 가능
                    </div>
                  )}
                </Panel>
              </div>

              {/* 우 컬럼 — 인수 의사결정 */}
              <Panel
                title="입력값 확인과 주변 시장"
                source={
                  estimate
                    ? estimate.method === "house-comps"
                      ? "구축 다가구 실거래 참고"
                      : `주변 실거래·공시지가 참고 · ${estimate.method}`
                    : "사용자 직접 입력"
                }
              >
                <AcquisitionPriceInput
                  subjectAreaPyeong={sqmToPyeong(parcel.lotArea)}
                  chartHeight={200}
                  transactions={
                    estimate?.transactions?.map<RawTransaction>((t) => ({
                      amount: t.priceManwon * 10_000,
                      areaSqm: t.areaSqm,
                      date: t.date,
                      label: t.address,
                    })) ?? []
                  }
                  value={acquiredPrice > 0 ? acquiredPrice * 10_000 : null}
                  onChange={(won) =>
                    setAcquiredPrice(won == null ? 0 : Math.round(won / 10_000))
                  }
                  estimatedTotalWon={null}
                />
                {estimate?.marketMedianManwon != null && estimate.marketMedianManwon > 0 && (
                  <div
                    style={{
                      marginTop: "var(--s3)",
                      padding: "10px 12px",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--bg-sunken)",
                    }}
                  >
                    <strong style={{ display: "block", fontSize: 11.5 }}>주변 토지 거래 중앙값 참고</strong>
                    <span style={{ display: "block", marginTop: 3, color: "var(--fg-muted)", fontSize: 10.5 }}>
                      {(estimate.marketMedianManwon / 10_000).toFixed(1)}억 · {Math.round(estimate.marketMedianPerPyeong ?? 0).toLocaleString()}만원/평
                    </span>
                    <small style={{ display: "block", marginTop: 4, color: "var(--fg-faint)", fontSize: 9.5 }}>
                      대상 부지와 동일한 매입가가 아닙니다. 현재 입력값을 바꾸지 않는 주변 시장 참고자료입니다.
                    </small>
                  </div>
                )}
                {estimate && (
                  <div
                    role="note"
                    style={{
                      marginTop: "var(--s3)",
                      padding: "10px 12px",
                      border: "1px solid #d8a92e",
                      borderRadius: 8,
                      background: "#fff8dc",
                      color: "#5f4600",
                      fontSize: 11,
                      lineHeight: 1.55,
                    }}
                  >
                    <strong>주변 시장 참고자료</strong>
                    <div>
                      아래 값은 사용자가 입력한 총 취득대금이 아닙니다. 거래 표본의 위치와 분포를 이해하는 용도로만 사용합니다.
                    </div>
                    <div className="mono" style={{ marginTop: 3 }}>
                      {estimate.method === "house-comps" && estimate.houseEstimate
                        ? `활성 추정 · 구축 단독/다가구 ${estimate.houseEstimate.count}건 · ${estimate.houseEstimate.medianPPPLand.toLocaleString()}만원/평`
                        : `활성 추정 · 동일 지목 ${estimate.details?.sampleSize ?? 0}건`}
                    </div>
                    <div className="mono" style={{ marginTop: 2 }}>
                      토지 분포 {estimate.transactionCount ?? 0}건 · 중앙값 {Math.round(estimate.marketMedianPerPyeong ?? 0).toLocaleString()}만원/평
                    </div>
                  </div>
                )}
                <div style={{ marginTop: "var(--s4)", maxWidth: 220 }}>
                  <DateField
                    label="인수일"
                    value={acquiredDate}
                    onChange={setAcquiredDate}
                    hint={koreanDate(acquiredDate)}
                  />
                </div>
              </Panel>
            </div>

            {/* 분석 시작 */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--s6)" }}>
              <Button
                variant="primary"
                size="lg"
                onClick={handleStart}
                disabled={!parcel || !acquiredPrice}
              >
                분석 시작 → 현황 분석
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── 헬퍼 컴포넌트 ─────────────────────────── */

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
  if (c === "high") return "표본 근거 충분";
  if (c === "medium") return "표본 근거 보통";
  return "표본 근거 부족";
}

function methodLabel(
  m: "house-comps" | "by-comps" | "by-publicvalue" | "hybrid"
): string {
  if (m === "house-comps") return "구축 단독·다가구 사례 기반 참고";
  if (m === "by-comps") return "토지 실거래 기반 참고";
  if (m === "by-publicvalue") return "공시지가 자체 보정 참고";
  return "실거래·공시지가 혼합 참고";
}
