"use client";

import Link from "next/link";
import { MassingView } from "@/components/ui/MassingView";
import { use, useState, useMemo, useEffect, useRef } from "react";
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
  UNIT_AREA_BASIS_NOTE,
  DEFAULT_UNIT_PRODUCT,
  type UnitProductType,
} from "@/lib/finance/unit-area-standards";
import { Panel, SectionTitle, Button, DataRow } from "@/components/ui/primitives";
import { WhyRecommendPanel } from "@/components/ui/WhyRecommendPanel";
import { ScenarioComparisonCard } from "@/components/ui/ScenarioComparisonCard";
import { ScenarioComparisonTable } from "@/components/ui/ScenarioComparisonTable";
import {
  applyEnvelopePlan,
  envelopePlanFromRecommended,
  recommendedMatchesInput,
} from "@/lib/services/apply-envelope-plan";
import { buildScenarioComparison } from "@/lib/finance/scenario-verdict";
import type { ScenarioType } from "@/lib/finance/scenario-envelope";
import { estimateFloorHeightM } from "@/lib/integrations/molit-building";

type StudioTab = "recommend" | "profit" | "max" | "custom";

const STUDIO_TABS: { id: StudioTab; label: string; hint?: string }[] = [
  { id: "recommend", label: "알고리즘 추천", hint: "규칙 기반 권장안" },
  { id: "profit", label: "수익 최적", hint: "준비 중" },
  { id: "max", label: "법규 최대", hint: "용적률·건폐율 상한" },
  { id: "custom", label: "직접 설계", hint: "슬라이더·3D 매싱" },
];

export default function EnvelopePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const data = useProjectStore((s) => s.data);
  const setData = useProjectStore((s) => s.setData);
  const setEnvelopePlan = useProjectStore((s) => s.setEnvelopePlan);
  const storedPlan = useProjectStore((s) => s.envelopePlan);
  const router = useRouter();
  const hydratedFromStore = useRef(false);
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
  const [tab, setTab] = useState<StudioTab>("recommend");
  const [whyOpen, setWhyOpen] = useState(true);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  // 비교 화면 "권장안 적용" 등 외부에서 store가 갱신되면 슬라이더 초기값 동기화 (1회/마운트)
  useEffect(() => {
    if (hydratedFromStore.current || !storedPlan?.scenarioType) return;
    hydratedFromStore.current = true;
    setSelectedType(storedPlan.scenarioType);
    setFloors(storedPlan.floors);
    setUnits(storedPlan.units);
    setFarPct(storedPlan.farPct);
    const match = UNIT_PRODUCT_ORDER.find(
      (p) => UNIT_AREA_STANDARDS[p].areaSqm === storedPlan.unitAreaSqm
    );
    if (match) {
      setUnitProduct(match);
      setUnitAreaOverride(null);
    } else {
      setUnitAreaOverride(storedPlan.unitAreaSqm);
    }
  }, [storedPlan]);

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

  const studioComparison = useMemo(() => {
    if (!parcel || !selectedType) return data?.scenarioComparison ?? null;
    const floorHeight =
      parcel.currentBuilding != null
        ? estimateFloorHeightM(parcel.currentBuilding) ?? undefined
        : undefined;
    return buildScenarioComparison(
      selectedType as ScenarioType,
      parcel,
      appliedFloors,
      appliedUnits,
      unitAreaSqm,
      floorHeight
    );
  }, [parcel, selectedType, appliedFloors, appliedUnits, unitAreaSqm, data?.scenarioComparison]);

  const maxEnv = useMemo(
    () => calcEnvelope(lotArea, maxBcr, maxFar),
    [lotArea, maxBcr, maxFar]
  );

  if (!data || !parcel) return null;

  const py = (sqm: number) => sqmToPyeong(sqm).toFixed(1);

  const panelWrap = { marginBottom: "var(--s5)" } as const;
  const panelBody = { padding: "var(--s6)" } as const;
  const rangeStyle = { flex: 1, accentColor: "var(--fg)" } as const;

  const sc = studioComparison;
  const applyRecommendedEnabled =
    Boolean(sc && selectedType && storedPlan?.scenarioType) &&
    !(sc?.input && recommendedMatchesInput(sc.input, sc.recommended));

  const handleApplyRecommended = () => {
    if (!sc || !selectedType || !storedPlan?.scenarioType) return;
    const plan = envelopePlanFromRecommended(
      storedPlan,
      sc.recommended,
      sc.unitAreaSqm
    );
    const ok = applyEnvelopePlan(parcel, plan, data, setEnvelopePlan, setData);
    if (!ok) return;
    setSelectedType(plan.scenarioType);
    setFloors(plan.floors);
    setUnits(plan.units);
    setFarPct(plan.farPct);
    setApplyMsg(
      `권장안 적용 — ${sc.recommended.floors}층 · ${sc.recommended.units > 0 ? `${sc.recommended.units}세대` : `${sc.recommended.farUsedPct}%`}`
    );
    setTab("custom");
  };

  const maxFloors = sc?.max.floors ?? maxEnv.theoreticalFloors;
  const maxUnits = sc?.max.units ?? 0;

  return (
    <div style={{ maxWidth: 1160, margin: "0 auto", padding: "var(--s6) var(--s5) 80px" }}>
      {/* Stage indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: "var(--s5)",
          fontSize: 11.5,
          color: "var(--fg-muted)",
        }}
      >
        <Link href={`/projects/${projectId}/status`} style={{ color: "var(--fg-muted)", textDecoration: "none" }}>
          Stage 1 현황 분석
        </Link>
        <span style={{ color: "var(--fg-faint)" }}>→</span>
        <span style={{ fontWeight: 600, color: "var(--fg)" }}>Stage 2</span>
        <span>계획 스튜디오</span>
      </div>

      <SectionTitle
        size="lg"
        title="계획 스튜디오"
        desc={`Planning Studio — ${parcel.address} · ${parcel.zoning}`}
        style={{ marginBottom: "var(--s4)" }}
      />

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: "var(--s5)",
        }}
      >
        {STUDIO_TABS.map((t) => (
          <StudioTabChip
            key={t.id}
            label={t.label}
            hint={t.hint}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          />
        ))}
      </div>

      {applyMsg && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--pos-fg)",
            background: "var(--pos-soft)",
            border: "1px solid var(--pos)",
            borderRadius: 8,
            marginBottom: "var(--s4)",
          }}
        >
          <span style={{ fontWeight: 600 }}>{applyMsg}</span>
          <button
            type="button"
            onClick={() => setApplyMsg(null)}
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--fg-muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            닫기
          </button>
        </div>
      )}

      {tab === "recommend" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s5)" }}>
          {!selectedType ? (
            <Panel bodyStyle={panelBody}>
              <SectionTitle
                title="시나리오를 먼저 선택하세요"
                desc="직접 설계 탭에서 건물 유형을 고르면 알고리즘이 권장안을 계산합니다."
              />
              <Button variant="primary" onClick={() => setTab("custom")}>
                직접 설계로 이동 →
              </Button>
            </Panel>
          ) : sc ? (
            <>
              <ScenarioComparisonCard
                comparison={sc}
                whyOpen={whyOpen}
                onWhyClick={() => setWhyOpen((v) => !v)}
                onApplyRecommended={handleApplyRecommended}
                applyButtonEnabled={applyRecommendedEnabled}
                recommendedApplied={false}
                applyRecommendedLabel={
                  !storedPlan?.scenarioType
                    ? "계획 저장 중…"
                    : sc.input && recommendedMatchesInput(sc.input, sc.recommended)
                      ? "이미 권장안과 동일합니다"
                      : undefined
                }
              />
              <ScenarioComparisonTable comparison={sc} />
              {whyOpen && <WhyRecommendPanel comparison={sc} />}
            </>
          ) : null}
        </div>
      )}

      {tab === "profit" && (
        <Panel bodyStyle={panelBody}>
          <SectionTitle
            badge="준비 중"
            title="수익 최적안"
            desc="건축 타당성과 IRR·매각 수익을 함께 고려한 최적 규모 — Stage 3 대시보드와 연동 예정"
          />
          <p style={{ color: "var(--fg-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
            현재는 알고리즘 추천(건축 규칙)과 직접 설계로 계획을 확정한 뒤, 대시보드에서 투자
            시나리오·IRR을 확인할 수 있습니다.
          </p>
          {sc && (
            <div style={{ marginTop: "var(--s5)" }}>
              <Button variant="ghost" onClick={() => setTab("recommend")}>
                알고리즘 추천 보기 →
              </Button>
            </div>
          )}
        </Panel>
      )}

      {tab === "max" && (
        <div className="env-grid">
          <aside style={{ display: "flex", flexDirection: "column", gap: "var(--s4)" }}>
            <Panel bodyStyle={{ padding: "var(--s4)" }}>
              <SectionTitle
                badge="한계"
                title="법규 최대 규모"
                desc="용적률·건폐율 상한까지 채운 도전 한계치 (정북일조·시공 리스크 별도 검토)"
                style={{ marginBottom: "var(--s3)" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s3)" }}>
                <Metric label="법정 용적률" value={`${maxFar}%`} sub="상한 100%" />
                <Metric label="법정 건폐율" value={`${maxBcr}%`} />
                <Metric
                  label="최대 연면적"
                  value={`${py(maxEnv.maxFarFloorAreaSqm)}평`}
                  sub={`${maxEnv.maxFarFloorAreaSqm.toFixed(0)}㎡`}
                />
                <Metric
                  label="최대 건축면적"
                  value={`${py(maxEnv.maxBuildingAreaSqm)}평`}
                  sub={`${maxEnv.maxBuildingAreaSqm.toFixed(0)}㎡`}
                />
                <Metric label="이론 층수" value={`${maxEnv.theoreticalFloors}층`} />
                <Metric
                  label="법규 최대안"
                  value={sc ? `${sc.max.floors}층` : `${maxFloors}층`}
                  sub={sc ? `정북일조·배치 반영 · ${sc.max.units}세대` : "시나리오 선택 후 상세 표시"}
                />
              </div>
              {sc && (
                <p
                  style={{
                    margin: "var(--s4) 0 0",
                    padding: "var(--s3)",
                    background: "var(--warn-soft, oklch(0.96 0.04 75))",
                    borderRadius: "var(--r)",
                    fontSize: 12,
                    color: "var(--fg-muted)",
                    lineHeight: 1.5,
                  }}
                >
                  정북일조 {sc.max.sun.label} · 주차 {sc.max.parking.requiredCars}대 필요
                </p>
              )}
            </Panel>
            <Panel bodyStyle={{ padding: "var(--s4)" }}>
              <SectionTitle
                badge="3D"
                title="법규 최대 매싱"
                desc={`${maxFloors}층 · 정북일조 후퇴 반영`}
                style={{ marginBottom: "var(--s3)" }}
              />
              <MassingView
                boundary={parcel.boundary}
                zoning={parcel.zoning ?? ""}
                floors={maxFloors}
                units={maxUnits || appliedUnits}
                roads={parcel.roads}
                setback={parcel.setback}
                height={400}
              />
            </Panel>
          </aside>
          <div>
            <Panel bodyStyle={panelBody}>
              <SectionTitle title="법규 최대 vs 권장" desc="도전 한계치는 시공·일조 리스크가 클 수 있습니다." />
              {sc ? (
                <>
                  <ScenarioComparisonTable comparison={sc} />
                  <div style={{ marginTop: "var(--s5)", display: "flex", gap: 12 }}>
                    <Button variant="ghost" onClick={() => setTab("recommend")}>
                      권장안 보기
                    </Button>
                    <Button variant="primary" onClick={() => setTab("custom")}>
                      직접 설계로 조정 →
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="primary" onClick={() => setTab("custom")}>
                  시나리오 선택하러 가기 →
                </Button>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === "custom" && (
      <div className="env-grid">
        {/* ─── 좌: 3D + 실시간 요약 ─── */}
        <aside
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--s4)",
          }}
        >
          <Panel bodyStyle={{ padding: "var(--s4)" }}>
            <SectionTitle
              badge="현재"
              title="실시간 계획"
              desc="오른쪽 조정값이 즉시 반영됩니다."
              style={{ marginBottom: "var(--s3)" }}
            />
            <DataRow
              label="시나리오"
              value={selected?.label ?? "—"}
              divider
            />
            <DataRow label="층수" value={`${appliedFloors}층`} divider />
            <DataRow
              label="세대수"
              value={
                selected
                  ? selected.unitsAdjustable
                    ? `${appliedUnits}세대`
                    : `${selected.maxUnits}세대`
                  : "—"
              }
              divider
            />
            <DataRow label="용적률" value={`${appliedFar}%`} divider />
            <DataRow
              label="세대당 연면적"
              value={`${unitAreaSqm}㎡`}
              sub={unitAreaLabel}
              divider
            />
            <DataRow
              label="현재 연면적"
              value={`${py(gfaAtFloors)}평`}
              sub={`${gfaAtFloors.toFixed(0)}㎡`}
              divider
            />
            <DataRow
              label="필요 주차"
              value={parking ? `${parking.requiredCars}대` : "—"}
              divider={false}
            />
            {selected && unitsOver && (
              <p
                style={{
                  margin: "var(--s3) 0 0",
                  padding: "var(--s2) var(--s3)",
                  borderRadius: "var(--r)",
                  background: "var(--neg-soft)",
                  color: "var(--neg-fg)",
                  fontSize: "var(--t-xs)",
                }}
              >
                현재 층수·세대 조합은 불가합니다.
              </p>
            )}
          </Panel>

          {/* 토지 분석 — 법적 최대치 (현재값, 용적률에 따라 변동) */}
          <Panel bodyStyle={{ padding: "var(--s4)" }}>
            <SectionTitle
              badge="현재"
              title="토지 분석 — 법적 최대치"
              style={{ marginBottom: "var(--s3)" }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s3)" }}>
              <Metric label="대지면적" value={`${py(lotArea)}평`} sub={`${lotArea.toFixed(0)}㎡`} />
              <Metric label="건폐율 / 용적률" value={`${maxBcr}% / ${appliedFar}%`} sub="법정 상한" />
              <Metric label="최대 건축면적" value={`${py(env.maxBuildingAreaSqm)}평`} sub={`${env.maxBuildingAreaSqm.toFixed(0)}㎡ · 대지×건폐율`} />
              <Metric label="최대 용적률 연면적" value={`${py(env.maxFarFloorAreaSqm)}평`} sub={`${env.maxFarFloorAreaSqm.toFixed(0)}㎡ · 대지×용적률`} />
              <Metric label="이론 층수" value={`${env.theoreticalFloors}층`} sub={`용적률÷건폐율 = ${env.floorRatio.toFixed(1)}`} />
              <Metric label="추천 층수" value={env.recommendedFloors} sub="실무 사례 기준" />
            </div>
          </Panel>

          {/* 정북일조 (정보) */}
          {sun && (
            <Panel bodyStyle={{ padding: "var(--s4)" }}>
              <SectionTitle
                badge="일조"
                title="정북 일조 — 층수별 북측 이격"
                desc="건축법 §86 · 북측 경계에서 띄워야 하는 거리. 층이 높을수록 더 띄워야 합니다."
                style={{ marginBottom: "var(--s3)" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--s2)" }}>
                {sun.floorSetbacks.map((fs) => (
                  <div
                    key={fs.floors}
                    style={{
                      padding: "var(--s2)",
                      background: "var(--bg-sunken)",
                      borderRadius: "var(--r-lg)",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>{fs.floors}층</div>
                    <div style={{ fontSize: "var(--t-micro)", color: "var(--fg-subtle)", margin: "2px 0 6px" }}>
                      {fs.heightM}m
                    </div>
                    <div
                      style={{
                        fontSize: "var(--t-md)", fontWeight: 700,
                        color: fs.requiredSetbackM > 1.5 ? "var(--fg)" : "var(--fg-muted)",
                      }}
                    >
                      {fs.requiredSetbackM.toFixed(1)}m
                    </div>
                    <div style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 2 }}>북측 이격</div>
                  </div>
                ))}
              </div>
              <p style={{ color: "var(--fg-faint)", fontSize: "var(--t-micro)", margin: "var(--s3) 0 0", lineHeight: 1.5 }}>
                {sun.caveat}
              </p>
            </Panel>
          )}

          <Panel bodyStyle={{ padding: "var(--s4)" }}>
            <SectionTitle
              badge="3D"
              title="매싱 — 층별 계단식 형상"
              desc={`정북일조·도로 이격 반영 (${appliedFloors}층 기준)`}
              style={{ marginBottom: "var(--s3)" }}
            />
            <MassingView
              boundary={parcel.boundary}
              zoning={parcel.zoning ?? ""}
              floors={appliedFloors}
              units={appliedUnits}
              roads={parcel.roads}
              setback={parcel.setback}
              height={400}
            />
            <p
              style={{
                fontSize: "var(--t-micro)",
                color: "var(--fg-faint)",
                margin: "var(--s3) 0 0",
                lineHeight: 1.5,
              }}
            >
              드래그로 회전, 휠로 확대. 상층부 후퇴는 정북 일조·변별 이격을 반영한
              건축가능 영역입니다.
            </p>
          </Panel>
        </aside>

        {/* ─── 우: 조작 패널 (STEP) ─── */}
        <div>
          {/* STEP 1 추천 시나리오 */}
          <Panel style={panelWrap} bodyStyle={panelBody}>
            <SectionTitle
              badge="STEP 1"
              title="추천 시나리오 — 건물 유형"
              desc="무엇을 지을지 먼저 선택합니다. 추천 층수 기준 규모이며(법적 최대 아님), 세부는 다음 단계에서 조정합니다."
            />
            <div style={{ display: "grid", gap: "var(--s3)" }}>
              {scenarios.map((s) => (
                <div
                  key={s.type}
                  onClick={() => { setSelectedType(s.type); setUnits(null); }}
                  style={{
                    padding: "var(--s4)",
                    border: selectedType === s.type
                      ? "1.5px solid var(--fg)"
                      : "1px solid var(--border)",
                    borderRadius: "var(--r-lg)",
                    background: selectedType === s.type ? "var(--bg-sunken)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--s4)",
                    cursor: "pointer",
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                      <span style={{ fontSize: "var(--t-md)", fontWeight: 600 }}>{s.label}</span>
                      <span className="ui-tag">{s.tag}</span>
                    </div>
                    <div style={{ fontSize: "var(--t-xs)", color: "var(--fg-subtle)", marginTop: "var(--s1)" }}>
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
                    <div style={{ fontSize: "var(--t-xl)", fontWeight: 700 }}>{s.floors}F</div>
                    {s.maxUnits > 1 && (
                      <div style={{ fontSize: "var(--t-micro)", color: "var(--fg-subtle)" }}>
                        ~{s.maxUnits}세대
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p style={{ color: "var(--fg-subtle)", fontSize: "var(--t-micro)", margin: "var(--s4) 0 0", lineHeight: 1.5 }}>
              층수(단독 2층·다가구 3층)와 세대당 연면적은 초기 추천값입니다. 법적 최대가 아니며,
              실제 층수는 STEP 5에서 정북일조·용적률로, 세대수는 STEP 4에서 조정하세요.
            </p>
          </Panel>

          {/* STEP 2 용적률 조정 */}
          <Panel style={panelWrap} bodyStyle={panelBody}>
            <SectionTitle badge="STEP 2" title="용적률 조정" />
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s4)" }}>
              <input
                type="range"
                min={Math.round(maxFar * 0.5)}
                max={maxFar}
                step={5}
                value={appliedFar}
                onChange={(e) => setFarPct(Number(e.target.value))}
                style={rangeStyle}
              />
              <span style={{ fontWeight: 700, minWidth: 56, textAlign: "right" }}>
                {appliedFar}%
              </span>
            </div>
            <p style={{ color: "var(--fg-subtle)", fontSize: "var(--t-xs)", margin: "var(--s3) 0 0" }}>
              상한 {maxFar}% 내에서 조정 — 좌측 요약·법적 최대치·3D에 실시간 반영됩니다.
            </p>
          </Panel>

          {/* STEP 3 세대 상품 유형 */}
          <Panel style={panelWrap} bodyStyle={panelBody}>
            <SectionTitle
              badge="STEP 3"
              title="세대 상품 유형"
              desc="세대당 연면적 배분 기준(공용부 포함)입니다. 세대수·주차 산정에 동일하게 적용됩니다."
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--s3)" }}>
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
                      padding: "var(--s3) var(--s4)",
                      border: active
                        ? "1.5px solid var(--fg)"
                        : "1px solid var(--border)",
                      borderRadius: "var(--r-lg)",
                      background: active ? "var(--bg-sunken)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: "var(--t-sm)", fontWeight: 600 }}>{std.label}</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, margin: "2px 0" }}>
                      <span style={{ fontSize: "var(--t-lg)", fontWeight: 700, color: "var(--fg)" }}>
                        {std.areaSqm}㎡
                      </span>
                      <span style={{ fontSize: 10, color: "var(--fg-faint)" }}>연면적</span>
                    </div>
                    <div style={{ fontSize: "var(--t-micro)", color: "var(--fg-subtle)" }}>{std.netAreaLabel}</div>
                    <div style={{ fontSize: "var(--t-micro)", color: "var(--fg-faint)", marginTop: 1 }}>{std.description}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", marginTop: "var(--s4)", flexWrap: "wrap" }}>
              <label style={{ fontSize: "var(--t-sm)", color: "var(--fg-subtle)" }}>세대당 연면적 직접 입력</label>
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
                  width: 90, padding: "6px 10px", borderRadius: "var(--r)",
                  border: "1px solid var(--border)", textAlign: "right",
                  fontFamily: "inherit", color: "var(--fg)", background: "var(--bg-elev)",
                }}
              />
              <span style={{ fontSize: "var(--t-sm)", color: "var(--fg-subtle)" }}>
                ㎡ ({sqmToPyeong(unitAreaSqm).toFixed(1)}평)
              </span>
            </div>
            <p style={{ color: "var(--fg-faint)", fontSize: "var(--t-micro)", margin: "var(--s3) 0 0", lineHeight: 1.5 }}>
              {UNIT_AREA_SOURCE}
            </p>
            <p style={{ color: "var(--fg-faint)", fontSize: "var(--t-micro)", margin: "var(--s1) 0 0", lineHeight: 1.5 }}>
              {UNIT_AREA_BASIS_NOTE}
            </p>
          </Panel>

          {/* STEP 4 세대수 조정 */}
          <Panel style={panelWrap} bodyStyle={panelBody}>
            <SectionTitle badge="STEP 4" title="세대수 조정" />

            {!selected && (
              <p style={{ color: "var(--fg-subtle)", fontSize: "var(--t-sm)", margin: 0 }}>
                위 시나리오를 선택하면 세대수를 조정할 수 있습니다.
              </p>
            )}

            {selected && !selected.unitsAdjustable && (
              <p style={{ color: "var(--fg-subtle)", fontSize: "var(--t-sm)", margin: 0 }}>
                {selected.label}은 세대수 조정이 없습니다 ({selected.maxUnits === 1 ? "1세대 고정" : "비주거"}).
              </p>
            )}

            {selected && selected.unitsAdjustable && (
              <>
                <p style={{ color: "var(--fg-subtle)", fontSize: "var(--t-sm)", margin: "0 0 var(--s4)" }}>
                  {selected.label} · 현재 {appliedFloors}층 기준 최대 {maxUnitsAtFloors}세대 (세대당 연면적 {unitAreaSqm}㎡ · {unitAreaLabel})
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--s4)" }}>
                  <input
                    type="range"
                    min={1}
                    max={maxUnitsAtFloors + 2}
                    step={1}
                    value={appliedUnits}
                    onChange={(e) => setUnits(Number(e.target.value))}
                    style={rangeStyle}
                  />
                  <span style={{ fontWeight: 700, minWidth: 64, textAlign: "right" }}>
                    {appliedUnits}세대
                  </span>
                </div>
                <div
                  style={{
                    marginTop: "var(--s3)", padding: "var(--s3) var(--s4)", borderRadius: "var(--r-lg)",
                    background: unitsOver ? "var(--neg-soft)" : "var(--bg-sunken)",
                    color: unitsOver ? "var(--neg-fg)" : "var(--fg)",
                    fontSize: "var(--t-sm)",
                  }}
                >
                  {unitsOver ? (
                    <>
                      <strong>불가</strong> · {appliedFloors}층 {appliedUnits}세대 — 연면적 {neededGfaSqm}㎡ 필요
                      {minFloorsForUnits
                        ? ` · 최소 ${minFloorsForUnits}층 필요`
                        : " · 5층으로도 불가"}
                    </>
                  ) : (
                    <><strong>가능</strong> · {appliedUnits}세대 — 세대당 평균 {avgUnitPyeong.toFixed(1)}평</>
                  )}
                </div>
                {parking && !unitsOver && (
                  <div
                    style={{
                      marginTop: "var(--s2)", padding: "var(--s3) var(--s4)", borderRadius: "var(--r-lg)",
                      background: "var(--bg-sunken)", fontSize: "var(--t-sm)",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: "var(--s3)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span>필요 주차 <strong>{parking.requiredCars}대</strong></span>
                    <span style={{ fontSize: "var(--t-micro)", color: "var(--fg-subtle)" }}>
                      {parking.basis}
                    </span>
                  </div>
                )}
              </>
            )}
          </Panel>

          {/* STEP 5 층수 조정 */}
          {selected && (
            <Panel style={panelWrap} bodyStyle={panelBody}>
              <SectionTitle
                badge="STEP 5"
                title="층수 조정"
                desc="층고 3.0m 기준 · 층수를 올리면 정북일조·용적률을 자동 검토합니다."
              />
              <div style={{ display: "flex", alignItems: "center", gap: "var(--s4)" }}>
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={appliedFloors}
                  onChange={(e) => setFloors(Number(e.target.value))}
                  style={rangeStyle}
                />
                <span style={{ fontWeight: 700, minWidth: 48, textAlign: "right" }}>
                  {appliedFloors}층
                </span>
              </div>
              {floorVerdict && (
                <div
                  style={{
                    marginTop: "var(--s3)", padding: "var(--s3) var(--s4)", borderRadius: "var(--r-lg)",
                    background:
                      floorVerdict.verdict === "infeasible"
                        ? "var(--neg-soft)"
                        : "var(--bg-sunken)",
                    color:
                      floorVerdict.verdict === "infeasible"
                        ? "var(--neg-fg)"
                        : "var(--fg)",
                    fontSize: "var(--t-sm)",
                  }}
                >
                  {floorVerdict.verdict === "ok" && (
                    <><strong>가능</strong> · {appliedFloors}층 — 높이 {floorVerdict.heightM}m · 북측 이격 {floorVerdict.requiredSetbackM.toFixed(1)}m (가능 {floorVerdict.availableSetbackM.toFixed(1)}m)</>
                  )}
                  {floorVerdict.verdict === "marginal" && (
                    <><strong>개략 불리</strong> · {appliedFloors}층 — {floorVerdict.reason}</>
                  )}
                  {floorVerdict.verdict === "infeasible" && (
                    <><strong>불가</strong> · {appliedFloors}층 — {floorVerdict.reason}</>
                  )}
                </div>
              )}
              <p style={{ color: "var(--fg-subtle)", fontSize: "var(--t-micro)", margin: "var(--s4) 0 0", lineHeight: 1.5 }}>
                {SUN_CHECK_CAVEAT}
              </p>
            </Panel>
          )}

          {/* 확정 요약 + 분석으로 */}
          {selected && (
            <Panel
              style={{ ...panelWrap, border: "1.5px solid var(--fg)" }}
              bodyStyle={panelBody}
            >
              <SectionTitle title="내 계획 요약" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s3)", marginBottom: "var(--s5)" }}>
                <Metric label="시나리오" value={`${selected.label} ${appliedFloors}층`} />
                <Metric label="용적률" value={`${appliedFar}%`} />
                {selected.unitsAdjustable && appliedUnits > 0 && (
                  <Metric label="세대수" value={`${appliedUnits}세대`} />
                )}
                {parking && (
                  <Metric label="주차 (최대치 기준)" value={`${parking.requiredCars}대`} />
                )}
              </div>
              <Button
                variant="primary"
                size="lg"
                block
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
              >
                이 계획으로 분석하기 →
              </Button>
              <p style={{ color: "var(--fg-subtle)", fontSize: "var(--t-micro)", margin: "var(--s3) 0 0", textAlign: "center" }}>
                선택한 계획이 사이드바와 분석에 반영됩니다.
              </p>
            </Panel>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

function StudioTabChip({
  label,
  active,
  onClick,
  hint,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--fg)" : "var(--border)"}`,
        background: active ? "var(--fg)" : "transparent",
        color: active ? "var(--bg)" : "var(--fg-muted)",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Metric({
  label, value, sub,
}: {
  label: string; value: string | number; sub?: string; accent?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: "var(--t-xs)", color: "var(--fg-subtle)", marginBottom: "var(--s1)" }}>{label}</div>
      <div style={{ fontSize: "var(--t-xl)", fontWeight: 700, color: "var(--fg)" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "var(--t-micro)", color: "var(--fg-subtle)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
