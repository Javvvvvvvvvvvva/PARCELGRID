"use client";

import Link from "next/link";
import { MassingView } from "@/components/ui/MassingView";
import { use, useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProjectStore } from "@/lib/stores/project-store";
import { calcEnvelope, sqmToPyeong } from "@/lib/finance/envelope";
import { calcSunFloors, checkFloorsByLaw, SUN_CHECK_CAVEAT } from "@/lib/finance/sun-envelope";
import { calcScenarioScale, pickScenarioTypes, gfaPyeong } from "@/lib/finance/scenario-envelope";
import { calcParking } from "@/lib/finance/parking";
import { recomputeFromEnvelope } from "@/lib/services/recompute-from-envelope";
import type { BuildingType } from "@/lib/finance/types";
import {
  UNIT_AREA_STANDARDS,
  UNIT_PRODUCT_ORDER,
  UNIT_AREA_SOURCE,
  DEFAULT_UNIT_PRODUCT,
  type UnitProductType,
} from "@/lib/finance/unit-area-standards";

export default function EnvelopePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((s) => s.data);
  const setData = useProjectStore((s) => s.setData);
  const setEnvelopePlan = useProjectStore((s) => s.setEnvelopePlan);
  const router = useRouter();
  const parcel = data?.parcel;

  // 슬라이더 상태 — 용적률 (상한 내 조정). 기본 = 상한.
  const [farPct, setFarPct] = useState<number | null>(null);
  // STEP 3 — 선택된 시나리오 + 세대수 + 층수
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [units, setUnits] = useState<number | null>(null);
  const [floors, setFloors] = useState<number | null>(null);
  // 신축 세대 상품 유형 (세대당 면적 기준) — 표준값 + 사용자 직접 수정 (C 확정)
  const [unitProduct, setUnitProduct] = useState<UnitProductType>(DEFAULT_UNIT_PRODUCT);
  const [unitAreaOverride, setUnitAreaOverride] = useState<number | null>(null);

  // 용도지역 규제 상한 (data 없으면 0 — 훅 순서 유지 위해 early return 전에)
  const maxFar = parcel?.maxFAR ?? 0;
  const maxBcr = parcel?.maxBCR ?? 0;
  const lotArea = parcel?.lotArea ?? 0;
  const appliedFar = farPct ?? maxFar;

  // 최대치 엔진 — 모든 훅은 early return 위에 (Rules of Hooks)
  const env = useMemo(
    () => calcEnvelope(lotArea, maxBcr, appliedFar),
    [lotArea, maxBcr, appliedFar]
  );

  // 정북일조 V1 — 북측 경계 기준 층수별 필요 이격
  const boundary = parcel?.boundary;
  const sun = useMemo(
    () => (boundary && boundary.length >= 3 ? calcSunFloors(boundary, 3, 5) : null),
    [boundary]
  );

  // 세대당 면적 (㎡) — 선택 상품 유형 표준값, 사용자 직접입력이 우선
  const unitAreaSqm = unitAreaOverride ?? UNIT_AREA_STANDARDS[unitProduct].areaSqm;
  const unitAreaLabel =
    unitAreaOverride !== null ? "직접입력" : UNIT_AREA_STANDARDS[unitProduct].label;

  // STEP 2 — 시나리오별 최대 규모 (envelope + 선택 상품 유형 세대당 면적 반영)
  const scenarios = useMemo(() => {
    const picks = pickScenarioTypes(lotArea, parcel?.zoning ?? "");
    return picks.map((p) => calcScenarioScale(p.type, env, p.tag, unitAreaSqm));
  }, [lotArea, parcel?.zoning, env, unitAreaSqm]);

  // STEP 3 — 선택된 시나리오
  const selected = useMemo(
    () => scenarios.find((s) => s.type === selectedType) ?? null,
    [scenarios, selectedType]
  );

  // STEP 3 — 층수별 가능 여부 (정북일조 + 용적률, boundary 기하)
  const floorChecks = useMemo(
    () =>
      boundary && boundary.length >= 3
        ? checkFloorsByLaw(boundary, env.maxBuildingAreaSqm, env.maxFarFloorAreaSqm, 3, 5)
        : [],
    [boundary, env.maxBuildingAreaSqm, env.maxFarFloorAreaSqm]
  );
  const appliedFloors = floors ?? selected?.floors ?? 2;
  const floorVerdict = floorChecks.find((c) => c.floors === appliedFloors) ?? null;

  // 세대수 — 현재 층수에서 가능한 연면적 기준 (C 로직: 층수→세대수 상한)
  const gfaAtFloors = Math.min(env.maxFarFloorAreaSqm, env.maxBuildingAreaSqm * appliedFloors);
  const maxUnitsAtFloors = Math.max(1, Math.floor(gfaAtFloors / unitAreaSqm));
  const appliedUnits = units ?? selected?.maxUnits ?? 1;
  const neededGfaSqm = appliedUnits * unitAreaSqm;
  const unitsOver = selected ? appliedUnits > maxUnitsAtFloors : false;
  // "이 세대수 넣으려면 최소 몇 층?"
  const minFloorsForUnits = (() => {
    for (let f = 1; f <= 5; f++) {
      const g = Math.min(env.maxFarFloorAreaSqm, env.maxBuildingAreaSqm * f);
      if (Math.floor(g / unitAreaSqm) >= appliedUnits) return f;
    }
    return null;
  })();
  // 세대당 평균 면적 + 주차 (parking.ts가 유일한 법규 엔진)
  const avgUnitPyeong =
    selected && appliedUnits > 0 ? sqmToPyeong(gfaAtFloors / appliedUnits) : 0;
  const parking = useMemo(
    () =>
      selected && !unitsOver
        ? calcParking(selected.type as BuildingType, gfaAtFloors, appliedUnits, 0)
        : null,
    [selected, unitsOver, gfaAtFloors, appliedUnits]
  );

  // 데이터 없으면 여기서 (모든 훅 호출 후)
  // store 동기화 — envelope 조정값을 단일 진실 소스로 저장
  useEffect(() => {
    if (!parcel || !selectedType) return;
    setEnvelopePlan({
      farPct: appliedFar,
      scenarioType: selectedType as "single-house" | "multi-family" | "retail" | null,
      floors: appliedFloors,
      units: appliedUnits,
      unitAreaSqm,
      avgUnitAreaSqm: appliedUnits > 0 ? gfaAtFloors / appliedUnits : 0,
      requiredCars: parking?.requiredCars ?? 0,
    });
  }, [parcel, selectedType, appliedFar, appliedFloors, appliedUnits, unitAreaSqm, gfaAtFloors, parking, setEnvelopePlan]);

  if (!data || !parcel) return null;

  const py = (sqm: number) => sqmToPyeong(sqm).toFixed(1);

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px 80px" }}>
      {/* 헤더 */}
      <div className="ui-crumb" style={{ marginBottom: 8 }}>
        <Link href={`/projects/${projectId}`} style={{ color: "var(--fg-subtle)" }}>
          ← 프로젝트
        </Link>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 4px" }}>건축 기획</h1>
      <p style={{ color: "var(--fg-subtle)", fontSize: 14, margin: "0 0 32px" }}>
        {parcel.address} · {parcel.zoning}
      </p>

      {/* ─── STEP 1 토지분석 (최대치) ─── */}
      <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span
            style={{
              fontSize: 11, fontWeight: 700, color: "var(--accent-fg, #c2410c)",
              background: "var(--accent-bg, #fff3ed)", padding: "3px 8px", borderRadius: 4,
            }}
          >
            STEP 1
          </span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>토지 분석 — 법적 최대치</h2>
        </div>

        {/* 최대치 그리드 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Metric label="대지면적" value={`${py(lotArea)}평`} sub={`${lotArea.toFixed(0)}㎡`} />
          <Metric label="건폐율 / 용적률" value={`${maxBcr}% / ${appliedFar}%`} sub="법정 상한" />
          <Metric label="최대 건축면적" value={`${py(env.maxBuildingAreaSqm)}평`} sub={`${env.maxBuildingAreaSqm.toFixed(0)}㎡ · 대지×건폐율`} />
          <Metric label="최대 용적률 연면적" value={`${py(env.maxFarFloorAreaSqm)}평`} sub={`${env.maxFarFloorAreaSqm.toFixed(0)}㎡ · 대지×용적률`} />
          <Metric label="이론 층수" value={`${env.theoreticalFloors}층`} sub={`용적률÷건폐율 = ${env.floorRatio.toFixed(1)}`} />
          <Metric label="추천 층수" value={env.recommendedFloors} sub="실무 사례 기준" accent />
        </div>
      </section>

      {/* ─── 정북일조 (V1) ─── */}
      {sun && (
        <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span
              style={{
                fontSize: 11, fontWeight: 700, color: "var(--fg-subtle)",
                background: "var(--bg-sunken)", padding: "3px 8px", borderRadius: 4,
              }}
            >
              일조
            </span>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>정북 일조 — 층수별 북측 이격</h2>
          </div>
          <p style={{ color: "var(--fg-subtle)", fontSize: 13, margin: "0 0 16px" }}>
            건축법 §86 · 북측 경계에서 띄워야 하는 거리. 층이 높을수록 더 띄워야 합니다.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {sun.floorSetbacks.map((fs) => (
              <div
                key={fs.floors}
                style={{
                  padding: "12px",
                  background: "var(--bg-sunken)",
                  borderRadius: 8,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{fs.floors}층</div>
                <div style={{ fontSize: 11, color: "var(--fg-subtle)", margin: "2px 0 6px" }}>
                  {fs.heightM}m
                </div>
                <div
                  style={{
                    fontSize: 16, fontWeight: 700,
                    color: fs.requiredSetbackM > 1.5 ? "var(--accent-fg, #c2410c)" : "var(--fg)",
                  }}
                >
                  {fs.requiredSetbackM.toFixed(1)}m
                </div>
                <div style={{ fontSize: 10, color: "var(--fg-subtle)", marginTop: 2 }}>북측 이격</div>
              </div>
            ))}
          </div>
          <p style={{ color: "var(--fg-subtle)", fontSize: 11, margin: "14px 0 0", lineHeight: 1.5 }}>
            {sun.caveat}
          </p>
        </section>
      )}

      {/* ─── 3D 매싱 (정북일조 계단식 매스) ─── */}
      <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "var(--accent-soft, #dbeafe)",
              color: "var(--accent, #2563eb)",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            3D
          </span>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>3D 매싱 — 층별 계단식 형상</h2>
            <p style={{ fontSize: 12.5, color: "var(--fg-muted)", margin: "2px 0 0" }}>
              정북일조로 상층부가 후퇴하는 실제 건축가능 형상 ({appliedFloors}층 기준)
            </p>
          </div>
        </div>
        <MassingView
          boundary={parcel.boundary}
          zoning={parcel.zoning ?? ""}
          floors={appliedFloors}
          units={appliedUnits}
          roads={parcel.roads}
          setback={parcel.setback}
          height={440}
        />
        <p style={{ fontSize: 11.5, color: "var(--fg-faint)", margin: "10px 0 0", lineHeight: 1.5 }}>
          마우스 드래그로 회전, 휠로 확대. 파란 매스는 정북일조와 변별 이격(전면·측면·후면)을
          반영한 층별 건축가능 영역입니다. 이격값은 실무 기본값(가정)이며 민법 0.5m 하한만
          법정입니다. 상층부가 좁아지는 것은 정북 일조권 확보를 위한 후퇴입니다.
        </p>
      </section>

      {/* ─── STEP 3 조정 (용적률 슬라이더) — 골격 ─── */}
      <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <span
            style={{
              fontSize: 11, fontWeight: 700, color: "var(--fg-subtle)",
              background: "var(--bg-sunken)", padding: "3px 8px", borderRadius: 4,
            }}
          >
            조정
          </span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>용적률 조정</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <input
            type="range"
            min={Math.round(maxFar * 0.5)}
            max={maxFar}
            step={5}
            value={appliedFar}
            onChange={(e) => setFarPct(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontWeight: 700, minWidth: 56, textAlign: "right" }}>
            {appliedFar}%
          </span>
        </div>
        <p style={{ color: "var(--fg-subtle)", fontSize: 12, margin: "10px 0 0" }}>
          상한 {maxFar}% 내에서 조정 — 위 최대치가 실시간 반영됩니다.
        </p>
      </section>

      {/* ─── 세대 상품 유형 (신축 세대당 면적 기준) ─── */}
      <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 11, fontWeight: 700, color: "var(--fg-subtle)",
              background: "var(--bg-sunken)", padding: "3px 8px", borderRadius: 4,
            }}
          >
            상품
          </span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>세대 상품 유형</h2>
        </div>
        <p style={{ color: "var(--fg-subtle)", fontSize: 13, margin: "0 0 16px" }}>
          신축 세대당 면적 기준입니다. 추천 시나리오·세대수·주차 산정에 동일하게 적용됩니다.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {UNIT_PRODUCT_ORDER.map((key) => {
            const std = UNIT_AREA_STANDARDS[key];
            const active = unitProduct === key && unitAreaOverride === null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => { setUnitProduct(key); setUnitAreaOverride(null); }}
                style={{
                  textAlign: "left",
                  padding: "14px 16px",
                  border: active
                    ? "2px solid var(--accent-fg, #c2410c)"
                    : "1px solid var(--border, #e8e6e1)",
                  borderRadius: 10,
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{std.label}</div>
                <div
                  style={{
                    fontSize: 18, fontWeight: 700,
                    color: "var(--accent-fg, #c2410c)", margin: "2px 0",
                  }}
                >
                  {std.areaSqm}㎡
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-subtle)" }}>{std.description}</div>
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <label style={{ fontSize: 13, color: "var(--fg-subtle)" }}>세대당 면적 직접 입력</label>
          <input
            type="number"
            min={15}
            max={200}
            value={Math.round(unitAreaSqm)}
            onChange={(e) => {
              const v = Number(e.target.value);
              setUnitAreaOverride(Number.isFinite(v) && v > 0 ? v : null);
            }}
            style={{
              width: 90, padding: "6px 10px", borderRadius: 6,
              border: "1px solid var(--border, #e8e6e1)", textAlign: "right",
            }}
          />
          <span style={{ fontSize: 13, color: "var(--fg-subtle)" }}>
            ㎡ ({sqmToPyeong(unitAreaSqm).toFixed(1)}평)
          </span>
        </div>
        <p style={{ color: "var(--fg-faint)", fontSize: 11, margin: "12px 0 0", lineHeight: 1.5 }}>
          {UNIT_AREA_SOURCE}
        </p>
      </section>

      {/* ─── STEP 2 추천 시나리오 ─── */}
      <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 11, fontWeight: 700, color: "var(--accent-fg, #c2410c)",
              background: "var(--accent-bg, #fff3ed)", padding: "3px 8px", borderRadius: 4,
            }}
          >
            STEP 2
          </span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>추천 시나리오 — 최대 규모</h2>
        </div>
        <p style={{ color: "var(--fg-subtle)", fontSize: 13, margin: "0 0 18px" }}>
          이 부지에 가능한 최대 규모입니다. 세대수·층수는 다음 단계에서 조정합니다.
        </p>
        <div style={{ display: "grid", gap: 12 }}>
          {scenarios.map((s) => (
            <div
              key={s.type}
              onClick={() => { setSelectedType(s.type); setUnits(null); }}
              style={{
                padding: "16px 18px",
                border: selectedType === s.type
                  ? "2px solid var(--accent-fg, #c2410c)"
                  : "1px solid var(--border, #e8e6e1)",
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                cursor: "pointer",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{s.label}</span>
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600, color: "var(--fg-subtle)",
                      background: "var(--bg-sunken)", padding: "2px 6px", borderRadius: 3,
                    }}
                  >
                    {s.tag}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-subtle)", marginTop: 4 }}>
                  {s.floors}층 · 최대 연면적 {gfaPyeong(s.maxGfaSqm)}평
                  {s.maxUnits > 0 && (
                    <>
                      {" · "}
                      {s.unitsAdjustable ? `최대 ${s.maxUnits}세대` : `${s.maxUnits}세대`}
                      {s.unitsEstimated && (
                        <span style={{ opacity: 0.6 }}> (추정)</span>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{s.floors}F</div>
                {s.maxUnits > 1 && (
                  <div style={{ fontSize: 11, color: "var(--fg-subtle)" }}>
                    ~{s.maxUnits}세대
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <p style={{ color: "var(--fg-subtle)", fontSize: 11, margin: "16px 0 0" }}>
          세대당 면적은 추정값입니다. STEP 3에서 실제 세대 계획으로 조정하세요.
        </p>
      </section>

      {/* ─── STEP 3 세대수 조정 ─── */}
      <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 11, fontWeight: 700, color: "var(--accent-fg, #c2410c)",
              background: "var(--accent-bg, #fff3ed)", padding: "3px 8px", borderRadius: 4,
            }}
          >
            STEP 3
          </span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>세대수 조정</h2>
        </div>

        {!selected && (
          <p style={{ color: "var(--fg-subtle)", fontSize: 13, margin: "8px 0 0" }}>
            위 시나리오를 선택하면 세대수를 조정할 수 있습니다.
          </p>
        )}

        {selected && !selected.unitsAdjustable && (
          <p style={{ color: "var(--fg-subtle)", fontSize: 13, margin: "8px 0 0" }}>
            {selected.label}은 세대수 조정이 없습니다 ({selected.maxUnits === 1 ? "1세대 고정" : "비주거"}).
          </p>
        )}

        {selected && selected.unitsAdjustable && (
          <>
            <p style={{ color: "var(--fg-subtle)", fontSize: 13, margin: "0 0 18px" }}>
              {selected.label} · 현재 {appliedFloors}층 기준 최대 {maxUnitsAtFloors}세대 (세대당 {unitAreaSqm}㎡ · {unitAreaLabel})
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <input
                type="range"
                min={1}
                max={maxUnitsAtFloors + 2}
                step={1}
                value={appliedUnits}
                onChange={(e) => setUnits(Number(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontWeight: 700, minWidth: 64, textAlign: "right" }}>
                {appliedUnits}세대
              </span>
            </div>
            <div
              style={{
                marginTop: 14, padding: "12px 14px", borderRadius: 8,
                background: unitsOver ? "var(--neg-bg, #fef2f2)" : "var(--bg-sunken)",
                color: unitsOver ? "var(--neg-fg, #dc2626)" : "var(--fg)",
                fontSize: 13,
              }}
            >
              {unitsOver ? (
                <>
                  ❌ {appliedFloors}층에서 {appliedUnits}세대 불가 — 연면적 {neededGfaSqm}㎡ 필요
                  {minFloorsForUnits
                    ? ` · 최소 ${minFloorsForUnits}층 필요`
                    : " · 5층으로도 불가"}
                </>
              ) : (
                <>✓ {appliedUnits}세대 가능 — 세대당 평균 {avgUnitPyeong.toFixed(1)}평</>
              )}
            </div>
            {parking && !unitsOver && (
              <div
                style={{
                  marginTop: 10, padding: "12px 14px", borderRadius: 8,
                  background: "var(--bg-sunken)", fontSize: 13,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}
              >
                <span>🚗 필요 주차 <strong>{parking.requiredCars}대</strong></span>
                <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>
                  {parking.basis}
                </span>
              </div>
            )}
          </>
        )}
      </section>

      {/* ─── STEP 3 층수 조정 ─── */}
      {selected && (
        <section className="ui-panel" style={{ padding: 24, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span
              style={{
                fontSize: 11, fontWeight: 700, color: "var(--accent-fg, #c2410c)",
                background: "var(--accent-bg, #fff3ed)", padding: "3px 8px", borderRadius: 4,
              }}
            >
              STEP 3
            </span>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>층수 조정</h2>
          </div>
          <p style={{ color: "var(--fg-subtle)", fontSize: 13, margin: "0 0 18px" }}>
            층고 3.0m 기준 · 층수를 올리면 정북일조·용적률을 자동 검토합니다.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={appliedFloors}
              onChange={(e) => setFloors(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ fontWeight: 700, minWidth: 48, textAlign: "right" }}>
              {appliedFloors}층
            </span>
          </div>
          {floorVerdict && (
            <div
              style={{
                marginTop: 14, padding: "12px 14px", borderRadius: 8,
                background:
                  floorVerdict.verdict === "infeasible"
                    ? "var(--neg-bg, #fef2f2)"
                    : floorVerdict.verdict === "marginal"
                    ? "var(--warn-bg, #fffbeb)"
                    : "var(--bg-sunken)",
                color:
                  floorVerdict.verdict === "infeasible"
                    ? "var(--neg-fg, #dc2626)"
                    : "var(--fg)",
                fontSize: 13,
              }}
            >
              {floorVerdict.verdict === "ok" && (
                <>✓ {appliedFloors}층 가능 — 높이 {floorVerdict.heightM}m · 북측 이격 {floorVerdict.requiredSetbackM.toFixed(1)}m (가능 {floorVerdict.availableSetbackM.toFixed(1)}m)</>
              )}
              {floorVerdict.verdict === "marginal" && (
                <>△ {appliedFloors}층 개략 불리 — {floorVerdict.reason}</>
              )}
              {floorVerdict.verdict === "infeasible" && (
                <>❌ {appliedFloors}층 불가/매우 불리 — {floorVerdict.reason}</>
              )}
            </div>
          )}
          <p style={{ color: "var(--fg-subtle)", fontSize: 11, margin: "14px 0 0", lineHeight: 1.5 }}>
            {SUN_CHECK_CAVEAT}
          </p>
        </section>
      )}

      {/* ─── 확정 요약 + 분석으로 ─── */}
      {selected && (
        <section
          className="ui-panel"
          style={{
            padding: 24, marginBottom: 20,
            border: "2px solid var(--accent-fg, #c2410c)",
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 16px" }}>
            내 계획 요약
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--fg-subtle)" }}>시나리오</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {selected.label} {appliedFloors}층
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--fg-subtle)" }}>용적률</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{appliedFar}%</div>
            </div>
            {selected.unitsAdjustable && appliedUnits > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--fg-subtle)" }}>세대수</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{appliedUnits}세대</div>
              </div>
            )}
            {parking && (
              <div>
                <div style={{ fontSize: 12, color: "var(--fg-subtle)" }}>주차 (최대치 기준)</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{parking.requiredCars}대</div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              if (!parcel || !selected) return;
              const plan = {
                farPct: appliedFar,
                scenarioType: selectedType as "single-house" | "multi-family" | "retail" | null,
                floors: appliedFloors,
                units: appliedUnits,
                unitAreaSqm,
                avgUnitAreaSqm: appliedUnits > 0 ? gfaAtFloors / appliedUnits : 0,
                requiredCars: parking?.requiredCars ?? 0,
              };
              const recomputed = recomputeFromEnvelope(parcel, plan, data);
              if (recomputed) setData(recomputed);
              router.push(`/projects/${projectId}`);
            }}
            style={{
              display: "block", width: "100%", textAlign: "center", padding: "14px",
              background: "var(--accent-fg, #c2410c)", color: "#fff", border: "none",
              borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: "pointer",
            }}
          >
            이 계획으로 분석하기 →
          </button>
          <p style={{ color: "var(--fg-subtle)", fontSize: 11, margin: "12px 0 0", textAlign: "center" }}>
            선택한 계획이 사이드바와 분석에 반영됩니다.
          </p>
        </section>
      )}
    </div>
  );
}

function Metric({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--fg-subtle)", marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontSize: 20, fontWeight: 700,
          color: accent ? "var(--accent-fg, #c2410c)" : "var(--fg)",
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--fg-subtle)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
