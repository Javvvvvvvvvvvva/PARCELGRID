"use client";

/**
 * 실거래 비교 — PARCELGRID (PDF p5 재현, 정직판).
 *
 * MOLIT는 좌표를 안 줘서 거리/동심원 맵은 불가(가짜가 됨).
 * 대신 가진 데이터(평당가·거래일·면적·같은동)로 진짜 인사이트:
 *   좌측 테이블 + 우측 평당가×시간 산점도(대상지 기준선).
 * 데이터는 스토어 data.comps / data.parcel — layout이 hydration.
 */

import { use, useEffect, useMemo, useState } from "react";
import { KakaoMap, type CompMarker, type StationMarker } from "@/components/ui/KakaoMap";
import { useProjectStore } from "@/lib/stores/project-store";
import { num } from "@/lib/utils/format";
import type { CompVM } from "@/lib/adapters/view-model";

const SQM_PER_PYEONG = 3.305785;

type Period = 6 | 12 | 18 | 0; // 0 = 전체

export default function CompsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  use(params);
  const data = useProjectStore((s) => s.data);

  const [type, setType] = useState<string>("all");
  const [period, setPeriod] = useState<Period>(18);
  const [region, setRegion] = useState<'all' | 'gu' | 'dong'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);

  const allComps: CompVM[] = data?.comps ?? [];
  const parcel = data?.parcel;

  // 대상지 평당가 (인수가 ÷ 대지평수)
  const subjectPPP = useMemo(() => {
    if (!parcel?.acquiredPrice || !parcel?.lotArea) return null;
    return Math.round(parcel.acquiredPrice / (parcel.lotArea / SQM_PER_PYEONG));
  }, [parcel]);

  // 대상지 시군구 코드 (같은 동 거래의 lawdCd 앞5자리, 없으면 전체 최빈값)
  const subjectGu = useMemo(() => {
    const same = allComps.find((c) => c.sameDong);
    if (same) return same.lawdCd.slice(0, 5);
    if (allComps.length === 0) return null;
    const freq = new Map<string, number>();
    for (const c of allComps) {
      const gu = c.lawdCd.slice(0, 5);
      freq.set(gu, (freq.get(gu) ?? 0) + 1);
    }
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [allComps]);

  const types = useMemo(
    () => Array.from(new Set(allComps.map((c) => c.type))).sort(),
    [allComps]
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = period === 0 ? 0 : now - period * 30 * 24 * 3600 * 1000;
    return allComps
      .filter((c) => {
        if (type !== "all" && c.type !== type) return false;
        if (cutoff && new Date(c.date).getTime() < cutoff) return false;
        if (region === "dong" && !c.sameDong) return false;
        if (region === "gu" && subjectGu && c.lawdCd.slice(0, 5) !== subjectGu) return false;
        return true;
      })
      .map((c, i) => ({ ...c, _key: `${c.id}-${i}` }));
  }, [allComps, type, period, region, subjectGu]);

  const median = useMemo(() => {
    if (filtered.length === 0) return null;
    const s = [...filtered.map((c) => c.pricePerPyeong)].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }, [filtered]);

  // 주변 지하철역 (역세권)
  const [stations, setStations] = useState<StationMarker[]>([]);
  useEffect(() => {
    if (parcel?.lat == null || parcel?.lng == null) return;
    let cancelled = false;
    fetch(`/api/parcels/nearby-stations?lat=${parcel.lat}&lng=${parcel.lng}&radius=1000`)
      .then((r) => r.json())
      .then((res: { stations?: StationMarker[] }) => {
        if (!cancelled && res.stations) setStations(res.stations);
      })
      .catch(() => {
        if (!cancelled) setStations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [parcel?.lat, parcel?.lng]);

  // 실거래 지오코딩 → 지도 마커 (주소 → 좌표)
  const [compMarkers, setCompMarkers] = useState<CompMarker[]>([]);
  useEffect(() => {
    if (filtered.length === 0) {
      setCompMarkers([]);
      return;
    }
    let cancelled = false;
    const addresses = filtered.map((c) => c.address);
    fetch("/api/parcels/comps-geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses }),
    })
      .then((r) => r.json())
      .then((res: { coords: ({ lat: number; lng: number } | null)[] }) => {
        if (cancelled || !res.coords) return;
        // 매각가 알고리즘 참고 사례 매칭 (주소·거래일·평당 3중 키 — cases와 동일 생성식)
        const refSet = new Set(
          (data?.saleEstimate?.cases ?? []).map(
            (cs) => `${cs.address}|${cs.date}|${cs.pricePerPyeong}`
          )
        );
        const markers: CompMarker[] = [];
        filtered.forEach((c, i) => {
          const co = res.coords[i];
          if (co) {
            markers.push({
              id: c._key,
              lat: co.lat,
              lng: co.lng,
              pricePerPyeong: c.pricePerPyeong,
              lotArea: c.lotArea,
              date: c.date,
              address: c.address,
              type: c.type,
              referenced: refSet.has(
                `${c.address}|${c.date}|${c.pricePerPyeong}`
              ),
            });
          }
        });
        setCompMarkers(markers);
      })
      .catch(() => {
        if (!cancelled) setCompMarkers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filtered]);

  if (!data) return null;

  const selected = filtered.find((c) => c._key === selectedId) ?? null;

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 필터바 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Select label="유형" value={type} onChange={setType}
          options={[{ v: "all", l: "전체" }, ...types.map((t) => ({ v: t, l: t }))]} />
        <Select label="기간" value={String(period)} onChange={(v) => setPeriod(Number(v) as Period)}
          options={[{ v: "6", l: "6개월" }, { v: "12", l: "12개월" }, { v: "18", l: "18개월" }, { v: "0", l: "전체" }]} />
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
          {([["dong", "같은 동"], ["gu", "같은 구"], ["all", "전체"]] as const).map(([v, label], i) => (
            <button key={v} onClick={() => setRegion(v)}
              style={{
                padding: "6px 12px", fontSize: 12.5, cursor: "pointer", border: "none",
                borderLeft: i > 0 ? "1px solid var(--border)" : "none",
                background: region === v ? "var(--accent)" : "var(--bg-elev)",
                color: region === v ? "var(--accent-fg, #fff)" : "var(--fg-muted)",
                fontWeight: region === v ? 600 : 400,
              }}>
              {label}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 13, color: "var(--fg-muted)" }}>
          <b style={{ color: "var(--fg)" }}>{filtered.length}건</b> 매칭
          {median != null && <> · 중앙값 평당 <b style={{ color: "var(--fg)" }}>{num(median)}만</b></>}
        </div>
      </div>

      {/* 실거래 지도 (대지 중심 + 실거래 점) */}
      {parcel?.lat != null && parcel?.lng != null && (
        <KakaoMap
          centerLat={parcel.lat}
          centerLng={parcel.lng}
          subjectLabel={parcel.address?.split(" ").slice(-2).join(" ") ?? "대상 대지"}
          subjectPPP={subjectPPP}
          comps={compMarkers}
          stations={stations}
          selectedId={selectedId}
          onSelectComp={setSelectedId}
          height={400}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 480px", gap: 16, alignItems: "start" }}>
        {/* 좌측 테이블 */}
        <div className="ui-panel" style={{ overflow: "hidden" }}>
          <table className="ui-table">
            <thead>
              <tr>
                <th>거래일</th><th>주소</th><th>유형</th>
                <th className="num">대지</th><th className="num">평당</th><th>동</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c._key} onClick={() => setSelectedId(c._key)}
                  style={{ cursor: "pointer", background: c._key === selectedId ? "var(--bg-active)" : undefined }}>
                  <td>{c.date}</td>
                  <td>{c.address}</td>
                  <td>{c.type}</td>
                  <td className="num">{num(c.lotArea)} m²</td>
                  <td className="num">{num(c.pricePerPyeong)}만</td>
                  <td>{c.sameDong
                    ? <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "var(--accent-soft)", color: "var(--accent-fg)" }}>같은 동</span>
                    : <span style={{ fontSize: 11, color: "var(--fg-subtle)" }}>타 동</span>}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--fg-muted)" }}>
                  조건에 맞는 실거래가 없습니다
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 우측: 산점도 + 상세 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 16 }}>
          <div className="ui-panel">
            <div className="ui-panel__title">평당가 분포 · 최근 거래</div>
            <TypeDistChart comps={filtered} subjectPPP={subjectPPP}
              expandedType={expandedType} onToggleType={(t) => setExpandedType(expandedType === t ? null : t)}
              selectedId={selectedId} onSelect={setSelectedId} />
          </div>

          {selected ? (
            <div className="ui-panel" style={{ padding: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{selected.address}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
                <Cell k="거래가" v={`${(selected.priceWon / 1e8).toFixed(2)}억`} />
                <Cell k="평당" v={`${num(selected.pricePerPyeong)}만`} />
                <Cell k="대지" v={`${num(selected.lotArea)} m²`} />
                <Cell k="유형" v={selected.type} />
              </div>
              {subjectPPP != null && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--fg-muted)" }}>
                  대상지(평당 {num(subjectPPP)}만) 대비{" "}
                  <b style={{ color: selected.pricePerPyeong > subjectPPP ? "var(--neg-fg)" : "var(--pos-fg)" }}>
                    {selected.pricePerPyeong > subjectPPP ? "+" : ""}
                    {(((selected.pricePerPyeong - subjectPPP) / subjectPPP) * 100).toFixed(1)}%
                  </b>
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--fg-subtle)" }}>↳ 국토교통부 실거래가 · {selected.date}</div>
            </div>
          ) : (
            <div className="ui-panel" style={{ padding: 24, textAlign: "center", color: "var(--fg-muted)", fontSize: 13 }}>
              거래를 선택하면 상세가 표시됩니다
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TypeDistChart({ comps, subjectPPP, expandedType, onToggleType, selectedId, onSelect }: {
  comps: (CompVM & { _key: string })[];
  subjectPPP: number | null;
  expandedType: string | null;
  onToggleType: (t: string) => void;
  selectedId: string | null;
  onSelect: (k: string) => void;
}) {
  const W = 480, PAD = { t: 24, r: 20, b: 28, l: 76 };

  if (comps.length === 0) {
    return <div style={{ height: 200, display: "grid", placeItems: "center", color: "var(--fg-muted)", fontSize: 13 }}>표시할 거래 없음</div>;
  }

  // 유형별 그룹
  const groups = Array.from(
    comps.reduce((m, c) => {
      (m.get(c.type) ?? m.set(c.type, []).get(c.type))!.push(c);
      return m;
    }, new Map<string, (CompVM & { _key: string })[]>())
  ).map(([type, items]) => {
    const vals = items.map((i) => i.pricePerPyeong).sort((a, b) => a - b);
    return {
      type, items,
      min: vals[0], max: vals[vals.length - 1],
      median: vals[Math.floor(vals.length / 2)],
    };
  }).sort((a, b) => a.median - b.median);

  // x 도메인 (전체 평당가 + 대상지)
  const allV = comps.map((c) => c.pricePerPyeong).concat(subjectPPP != null ? [subjectPPP] : []);
  const xmin = Math.min(...allV), xmax = Math.max(...allV);
  const xpad = (xmax - xmin) * 0.08 || 100;
  const pw = W - PAD.l - PAD.r;
  const xOf = (v: number) => PAD.l + ((v - (xmin - xpad)) / ((xmax + xpad) - (xmin - xpad))) * pw;

  // 행 높이: 기본 행 + 펼친 유형은 개별 거래 행 추가
  const ROW = 34, ITEM = 20;
  let y = PAD.t;
  const layout = groups.map((g) => {
    const top = y;
    y += ROW;
    const expanded = expandedType === g.type;
    if (expanded) y += g.items.length * ITEM + 6;
    return { ...g, top, expanded };
  });
  const H = y + PAD.b;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* 대상지 세로선 */}
      {subjectPPP != null && (
        <g>
          <line x1={xOf(subjectPPP)} x2={xOf(subjectPPP)} y1={PAD.t - 8} y2={H - PAD.b} stroke="var(--neg)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={xOf(subjectPPP)} y={PAD.t - 12} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--neg-fg, var(--neg))">대상지 {num(subjectPPP)}</text>
        </g>
      )}

      {layout.map((g) => (
        <g key={g.type}>
          {/* 유형 라벨 (클릭 펼침) */}
          <text x={PAD.l - 10} y={g.top + 14} textAnchor="end" fontSize={11.5} fontWeight={g.expanded ? 700 : 500}
            fill="var(--fg)" style={{ cursor: "pointer" }} onClick={() => onToggleType(g.type)}>
            {g.expanded ? "▾ " : "▸ "}{g.type}
          </text>
          {/* 범위 막대 (min~max) */}
          <line x1={xOf(g.min)} x2={xOf(g.max)} y1={g.top + 10} y2={g.top + 10}
            stroke="var(--accent)" strokeWidth={8} strokeOpacity={0.22} strokeLinecap="round" />
          {/* 중앙값 */}
          <circle cx={xOf(g.median)} cy={g.top + 10} r={5} fill="var(--accent)" />
          <text x={xOf(g.median)} y={g.top + 1} textAnchor="middle" fontSize={10} fill="var(--fg-muted)">{num(g.median)}</text>
          <text x={W - PAD.r} y={g.top + 14} textAnchor="end" fontSize={10} fill="var(--fg-subtle, #aaa)">{g.items.length}건</text>

          {/* 펼침: 개별 거래 점 */}
          {g.expanded && g.items.map((it, i) => {
            const iy = g.top + ROW + i * ITEM + 4;
            const sel = it._key === selectedId;
            return (
              <g key={it._key} style={{ cursor: "pointer" }} onClick={() => onSelect(it._key)}>
                <circle cx={xOf(it.pricePerPyeong)} cy={iy} r={sel ? 6 : 4.5}
                  fill={sel ? "var(--accent)" : "var(--accent)"} fillOpacity={sel ? 1 : 0.45}
                  stroke={sel ? "var(--fg)" : "none"} strokeWidth={sel ? 2 : 0} />
                <text x={PAD.l - 10} y={iy + 3} textAnchor="end" fontSize={9.5} fill="var(--fg-subtle, #aaa)">{it.date.slice(2)}</text>
              </g>
            );
          })}
        </g>
      ))}

      {/* x축 */}
      <text x={PAD.l} y={H - 8} fontSize={9.5} fill="var(--fg-muted)">{num(Math.round(xmin))}만</text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize={9.5} fill="var(--fg-muted)">{num(Math.round(xmax))}만</text>
    </svg>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--fg-muted)" }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={{ height: 30, padding: "0 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--fg)", fontSize: 13 }}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ color: "var(--fg-muted)", marginBottom: 2 }}>{k}</div>
      <div style={{ fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>{v}</div>
    </div>
  );
}
