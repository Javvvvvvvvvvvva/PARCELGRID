"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight, Check, MapPin, Search, SquareDashed, X } from "lucide-react";
import { AddressAutocomplete } from "@/components/ui/AddressAutocomplete";
import ManualParcelIntake from "@/components/project/ManualParcelIntake";
import { SiteHeader } from "@/components/project/SiteProjectAccess";
import type { MapLocation } from "@/components/project/ParcelSelectionMap";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import { createSiteIntake } from "@/lib/parcels/site-intake";
import { useProjectStore } from "@/lib/stores/project-store";
import { writeStoredParcel } from "@/lib/hooks/use-dynamic-project";
import { boundaryContainsLocation } from "@/lib/parcels/selection";
import { useSelectionContext } from "@/lib/hooks/use-selection-context";
import SavedProjects from "@/components/project/SavedProjects";
import type { ParcelLookupComplete, ParcelLookupManualRequired, ParcelLookupResponse } from "@/lib/parcels/lookup-contract";
import { num, pyeong } from "@/lib/utils/format";
import "@/components/project/site-picker.css";

const ParcelSelectionMap = dynamic(() => import("@/components/project/ParcelSelectionMap"), { ssr: false,
  loading: () => <section className="picker-map"><div className="picker-map-empty" role="status">지도를 준비하고 있어요…</div></section> });
type SelectionInput = { address: string } | { location: MapLocation };

export default function NewParcelPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [parcel, setParcel] = useState<ParcelLookupComplete | null>(null);
  const [manual, setManual] = useState<ParcelLookupManualRequired | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<MapLocation>();
  const [pendingLocation, setPendingLocation] = useState<MapLocation>();
  const [area, setArea] = useState<MapLocation>();
  const [origin, setOrigin] = useState<SelectionInput | null>(null);
  const [phase, setPhase] = useState<"idle" | "searching" | "confirming">("idle");
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState("");
  const contextTarget = parcel?.mode === "vworld" && selectedLocation && selectionRevision
    ? { pnu: parcel.pnu, center: selectedLocation, revision: selectionRevision } : null;
  const context = useSelectionContext(contextTarget);
  const requestId = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { requestId.current++; controller.current?.abort(); }, []);

  function resetSelection() {
    requestId.current++; controller.current?.abort();
    setParcel(null); setManual(null); setOrigin(null); setSelectedLocation(undefined); setPendingLocation(undefined);
    setError(""); setPhase("idle"); setManualOpen(false);
    setArea(undefined);
    setSelectionRevision("");
  }
  function changeAddress(value: string) { resetSelection(); setAddress(value); }
  async function request(input: SelectionInput, nextPhase: "selection" | "details", signal: AbortSignal, expectedPnu?: string): Promise<ParcelLookupResponse> {
    const response = await fetch("/api/parcels/lookup", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, phase: nextPhase, expectedPnu }), signal });
    const result = await response.json();
    if (!response.ok) throw new Error([result.error || "부지를 확인하지 못했습니다.", result.nextAction].filter(Boolean).join(" "));
    return result as ParcelLookupResponse;
  }
  async function select(input: SelectionInput) {
    resetSelection(); const id = ++requestId.current;
    setSelectionRevision(crypto.randomUUID());
    const ac = new AbortController(); controller.current = ac;
    setPhase("searching"); setOrigin(input);
    if ("location" in input) setPendingLocation(input.location);
    try {
      const result = await request(input, "selection", ac.signal);
      if (id !== requestId.current) return;
      if (result.mode === "area") { setAddress(result.address); setArea({ lat: result.lat, lng: result.lng }); return; }
      setAddress(result.address); setSelectedLocation({ lat: result.lat, lng: result.lng }); setPendingLocation(undefined);
      if (result.mode === "manual-required") setManual(result); else setParcel(result);
    } catch (err) {
      if (id === requestId.current && !ac.signal.aborted) setError(err instanceof Error ? err.message : "다시 선택해주세요.");
    } finally { if (id === requestId.current) setPhase("idle"); }
  }
  function applyManual(next: ParcelLookupComplete) {
    if (origin && "location" in origin && next.boundary?.length && !boundaryContainsLocation(next.boundary, origin.location)) {
      setError("입력한 경계 안에 지도에서 선택한 위치가 없습니다. 경계 또는 선택 위치를 확인하세요."); return;
    }
    setParcel(next); setManual(null); setManualOpen(false); setError("");
  }
  async function confirm() {
    if (!parcel || !origin || phase !== "idle") return;
    const current = parcel, id = ++requestId.current;
    controller.current?.abort(); const ac = new AbortController(); controller.current = ac;
    setPhase("confirming"); setError("");
    try {
      const result = await request(origin, "details", ac.signal, current.pnu);
      if (id !== requestId.current) return;
      if (result.mode === "area") throw new Error("정확한 필지를 다시 선택해주세요.");
      if (result.pnu !== current.pnu) throw new Error("선택한 필지가 변경됐습니다. 다시 선택해주세요.");
      let complete: ParcelLookupComplete;
      if (current.mode === "manual") {
        complete = { ...current, currentBuilding: result.currentBuilding, existingUnitArea: result.existingUnitArea };
      } else if (result.mode === "manual-required") {
        setParcel(null); setManual(result); setError("토지 정보를 다시 확인하지 못했습니다. 확인된 자료로 직접 입력하거나 다시 조회해주세요."); return;
      } else complete = result;
      const stored = createSiteIntake(complete, crypto.randomUUID(), new Date().toISOString());
      try { await writeStoredParcel(stored); } catch (error) { throw new Error(`부지를 브라우저에 저장하지 못했습니다. ${error instanceof Error ? error.message : "사이트 저장 권한과 남은 공간을 확인해주세요."}`); }
      if (id !== requestId.current) return;
      // Keep saved plans/history, but revalidate the representative against this new intake.
      const workspace = useProjectStore.getState();
      workspace.setRepresentativePlanningScenarioId(null);
      workspace.clearEnvelopePlan();
      workspace.resetDraftAcquisitionPrice(complete.pnu);
      router.push(`/projects/${complete.pnu}/status`);
    } catch (err) {
      if (id === requestId.current && !ac.signal.aborted) setError(err instanceof Error ? err.message : "현황을 불러오지 못했습니다.");
    } finally { if (id === requestId.current) setPhase("idle"); }
  }

  const selected = parcel ?? manual;
  return <div className="site-flow site-picker"><a className="site-skip" href="#site-search">주소 검색으로 이동</a><SiteHeader />
    <main className="picker-grid">
      <section className="picker-search" id="site-search">
        <p className="site-eyebrow">SITE EXPLORER · 부지 탐색</p>
        <h1>어떤 땅을 <br />살펴볼까요?</h1>
        <p className="picker-intro">주소로 찾거나, 지도를 움직여<br className="picker-desktop-break" /> 원하는 부지를 선택하세요.</p>
        <form className="picker-search-form" onSubmit={event => { event.preventDefault(); if (address.trim().length >= 2) void select({ address: address.trim() }); }}>
          <label htmlFor="site-address">주소 검색</label>
          <div className="picker-search-field"><Search size={18} aria-hidden="true" />
            <AddressAutocomplete inputId="site-address" value={address} onChange={changeAddress} onSelect={item => void select({ address: item.address })}
              onSubmit={() => { if (address.trim().length >= 2) void select({ address: address.trim() }); }} disabled={phase === "confirming"} placeholder="동 이름, 지번 또는 도로명 주소" />
            {address && <button type="button" className="picker-clear" aria-label="주소 지우기" disabled={phase === "confirming"} onClick={() => changeAddress("")}><X size={16} /></button>}
          </div>
          <button type="submit" className="picker-search-submit" disabled={phase === "confirming" || address.trim().length < 2}>주소로 찾기 <ArrowRight size={15} /></button>
        </form>
        <p className="picker-search-note">2글자 이상 입력하면 주소 후보가 나와요.</p>
      </section>
      <ParcelSelectionMap selected={selectedLocation} pending={pendingLocation} area={area} boundary={parcel?.boundary} onSelect={location => void select({ location })} disabled={phase === "confirming"}
        context={context.isError ? undefined : context.data} contextRequested={contextTarget !== null}
        contextLoading={contextTarget !== null && context.isFetching} contextError={context.isError}
        onRetryContext={() => void context.refetch()} />
      <section className="picker-selection" aria-label="선택한 부지" aria-busy={phase !== "idle"}>
        {phase === "searching" && <div className="picker-progress" role="status"><span className="picker-spinner" />주소와 필지 경계를 확인하고 있어요…<button type="button" onClick={resetSelection}>취소</button></div>}
        {error && <div className="site-error" role="alert">{error}</div>}
        {area && <p className="picker-boundary" role="status">검색한 지역에는 여러 필지가 있어요. 지번을 더 입력하거나 지도에서 한 곳을 선택하세요.</p>}
        {selected ? <article className="picker-result">
          <span className="picker-result-label"><MapPin size={15} /> 선택한 부지</span>
          <h2>{selected.address}</h2>{selected.addressRoad && <p className="site-muted">{selected.addressRoad}</p>}
          {parcel ? <>
            <div className="picker-facts"><div><span>대지면적</span><strong>{num(parcel.lotArea, 2)}<small>㎡</small></strong><p>{pyeong(parcel.lotArea)}</p></div><div><span>용도지역</span><strong className="picker-zoning">{parcel.zoning}</strong><p>{parcel.mode === "manual" ? "사용자 입력" : "조회된 지역 구분"}</p></div></div>
            <p className="picker-boundary"><SquareDashed size={16} />{parcel.boundary?.length ? parcel.mode === "manual" ? "사용자가 제공한 경계 · 원문 확인 필요" : "선택한 필지 경계를 지도에 표시했어요" : "필지 경계 미확인 · 주소 기준으로 살펴봅니다"}</p>
            <button type="button" className="site-primary" onClick={() => void confirm()} disabled={phase !== "idle"}>{phase === "confirming" ? "현재 건물 자료를 불러오는 중…" : "이 부지 살펴보기"}<ArrowRight size={17} /></button>
            {phase === "confirming" && <button type="button" className="site-text-button" onClick={() => { requestId.current++; controller.current?.abort(); setPhase("idle"); }}>조회 취소</button>}
            <p className="picker-next-note"><Check size={14} /> 가격 입력 없이 현황부터 확인해요</p>
          </> : <>
            <p className="picker-boundary">주소를 찾았지만 토지 면적과 경계를 확인하지 못했어요. 확인된 자료가 있으면 직접 입력할 수 있어요.</p>
            <button type="button" className="site-primary" onClick={() => setManualOpen(!manualOpen)} aria-expanded={manualOpen}>토지 정보 직접 입력 <ArrowRight size={16} /></button>
            {manualOpen && manual && <ManualParcelIntake key={manual.pnu} lookup={manual} onApply={applyManual} />}
          </>}
        </article> : phase !== "searching" && <div className="picker-empty-card"><span className="picker-empty-icon"><SquareDashed size={28} strokeWidth={1.3} /></span><h2>부지 한 곳에서 시작하세요</h2><p>선택한 주소와 경계를 확인한 다음,<br />현재 토지와 건물 상태를 살펴볼 수 있어요.</p></div>}
        <SavedProjects disabled={phase === "confirming"} />
        <div className="picker-footer"><span>처음 사용하시나요?</span><Link href={`/projects/${DEMO_PROJECT_ID}/status`}>예시 부지 살펴보기 <ArrowRight size={14} /></Link></div>
      </section>
    </main>
  </div>;
}
