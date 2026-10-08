"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import { buildSiteProject, hasAcquisitionPrice, readStoredParcel, writeStoredParcel, type StoredParcel } from "@/lib/hooks/use-dynamic-project";
import { useProjectStore } from "@/lib/stores/project-store";
import { DEMO_PROJECT_ID } from "@/lib/seed/demo-project-meta";
import type { ProjectComputed } from "@/lib/services/compute-project";
import "./site-picker.css";

const AcquisitionMarketReference = dynamic(() => import("./AcquisitionMarketReference"));

export function SiteHeader({ step = 1 }: { step?: number }) {
  return <header className="site-header"><Link href="/" className="site-brand"><MapPin size={22} /> PARCELGRID</Link>
    <nav aria-label="부지 검토 순서"><span aria-current={step === 1 ? "step" : undefined}>01 부지 선택</span><i>／</i><span aria-current={step === 2 ? "step" : undefined}>02 현황 확인</span><i>／</i><span aria-current={step === 3 ? "step" : undefined}>03 계획 검토</span></nav>
    <Link href="/system/readiness" className="site-header-help">연결 상태</Link></header>;
}

export function SiteProjectShell({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [stored, setStored] = useState<StoredParcel | null | undefined>(undefined);
  useEffect(() => { const read = () => setStored(readStoredParcel()); read(); window.addEventListener("parcelgrid:parcel-changed", read); return () => window.removeEventListener("parcelgrid:parcel-changed", read); }, [projectId]);
  const owned = stored?.id === projectId ? stored : null;
  const query = useQuery<ProjectComputed>({
    queryKey: ["site-project", projectId, owned?.intakeRevision ?? (owned ? JSON.stringify(owned) : "seed")],
    enabled: stored !== undefined, retry: false, staleTime: 30_000,
    queryFn: async () => {
      if (owned) return buildSiteProject(owned);
      if (projectId === DEMO_PROJECT_ID) { const res = await fetch(`/api/projects/${projectId}`); if (!res.ok) throw new Error("데모를 불러오지 못했습니다."); return res.json(); }
      throw new Error("저장한 계획에 부지 입력이 없습니다. 주소나 지도에서 같은 부지를 다시 확인하세요.");
    },
  });
  const setData = useProjectStore(s => s.setData), active = useProjectStore(s => s.data);
  useEffect(() => { if (query.data) setData(query.data); }, [query.data, setData]);
  return <div className="site-flow"><SiteHeader step={2} /><main>
    {query.error ? <div className="site-message" role="alert"><h1>부지를 다시 선택해주세요</h1><p>{query.error.message}</p><Link href="/projects/new">부지 선택으로 돌아가기</Link></div>
      : !query.data || active !== query.data ? <p className="site-message" role="status">선택한 부지의 현황을 불러오고 있어요…</p> : children}
  </main></div>;
}

/** Existing planning screens contain financial recommendations: require a real price before mounting them. */
export function AcquisitionAccess({ projectId, children }: { projectId: string; children: ReactNode }) {
  const [stored, setStored] = useState<StoredParcel | null | undefined>(undefined);
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState("");
  const [showReferences, setShowReferences] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setStored(readStoredParcel()); }, [projectId]);
  if (stored === undefined) return <p className="site-message">부지 입력을 확인하고 있어요…</p>;
  if (!stored || stored.id !== projectId || hasAcquisitionPrice(stored)) return <>{children}</>;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving) return; setError("");
    const value = Number(price), manwon = Math.round(value * 10_000);
    const instant = new Date(`${date}T00:00:00Z`);
    if (!price.trim() || !Number.isFinite(value) || manwon <= 0 || manwon > 1_000_000_000_000) { setError("총 취득대금을 억원 단위의 양수로 입력하세요."); return; }
    if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) { setError("취득 예정일을 확인하세요."); return; }
    try {
      setSaving(true);
      const next = { ...stored, acquiredPrice: manwon, acquired: date, intakeRevision: crypto.randomUUID() };
      await writeStoredParcel(next); setStored(next);
    } catch (error) { setError(`브라우저에 입력을 저장하지 못했습니다. ${error instanceof Error ? error.message : "저장 공간과 사이트 저장 권한을 확인하세요."}`); }
    finally { setSaving(false); }
  };
  return <div className="site-flow"><SiteHeader step={3} /><main className="site-price-gate">
    <Link href={`/projects/${projectId}/status`} className="site-back"><ArrowLeft size={15} /> 현황으로 돌아가기</Link>
    <p className="site-eyebrow">계획 검토 준비</p><h1>이제 가격을 더해<br />계획을 비교해볼까요?</h1>
    <p className="site-muted">{stored.address}</p><p>계획 스튜디오에는 예상 손익이 함께 표시돼요. 알고 있는 총 취득대금을 입력하면 계산을 시작합니다.</p>
    <form onSubmit={submit}>
      <label htmlFor="site-acquisition-price">토지와 기존 건물을 포함한 총 취득대금</label>
      <div className="site-price-field"><input id="site-acquisition-price" type="number" min="0.0001" step="any" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="예: 20.6" required /><span>억원</span></div>
      <button type="button" className="site-reference-toggle" aria-expanded={showReferences} onClick={() => setShowReferences(value => !value)}>{showReferences ? "주변 거래 참고 닫기 −" : "주변 거래 참고하기 +"}</button>
      {showReferences && <AcquisitionMarketReference stored={stored} value={price.trim() && Number.isFinite(Number(price)) ? Number(price) * 100_000_000 : null} onChange={won => setPrice(won === null ? "" : String(won / 100_000_000))} />}
      <label htmlFor="site-acquisition-date">취득 예정일 · 사업 일정 기준</label><input id="site-acquisition-date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
      <p className="site-muted">가격을 아직 모르면 현황 화면으로 돌아가서 계속 살펴볼 수 있어요.</p>
      {error && <p role="alert" className="site-error">{error}</p>}
      <button className="site-primary" type="submit" disabled={saving}>{saving ? "입력 저장 중…" : "입력한 가격으로 계속"} <ArrowRight size={17} /></button>
    </form>
  </main></div>;
}
