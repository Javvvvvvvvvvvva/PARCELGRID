"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- Kakao SDK objects are confined to this adapter. */
import { useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Minus, Plus, RefreshCw } from "lucide-react";
import { loadKakaoSdk } from "@/lib/integrations/kakao-maps-sdk";

export interface MapLocation { lat: number; lng: number }
export default function ParcelSelectionMap({ selected, pending, area, boundary, onSelect, disabled = false }: {
  selected?: MapLocation; pending?: MapLocation; boundary?: [number, number][];
  area?: MapLocation;
  onSelect: (location: MapLocation) => void; disabled?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null), marker = useRef<any>(null), outline = useRef<any>(null);
  const callback = useRef(onSelect); callback.current = onSelect;
  const blocked = useRef(disabled); blocked.current = disabled;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [satellite, setSatellite] = useState(false);
  const selectPoint = useRef<(p: any) => void>(() => undefined);
  useEffect(() => {
    const element = container.current;
    let cancelled = false, observer: ResizeObserver | undefined, click: ((event: any) => void) | undefined;
    setState("loading");
    loadKakaoSdk().then(() => {
      if (cancelled || !element) return;
      const sdk = window.kakao.maps;
      const instance = new sdk.Map(element, { center: new sdk.LatLng(37.5665, 126.978), level: 7, draggable: true, scrollwheel: true });
      map.current = instance;
      marker.current = new sdk.Marker({ zIndex: 3 });
      selectPoint.current = p => {
        if (blocked.current) return;
        if (instance.getLevel() > 4) {
          instance.setCenter(p); instance.setLevel(3);
          setMessage("확대했어요. 원하는 필지 안쪽을 한 번 더 눌러주세요."); return;
        }
        setMessage(""); callback.current({ lat: p.getLat(), lng: p.getLng() });
      };
      click = event => selectPoint.current(event.latLng);
      sdk.event.addListener(instance, "click", click);
      observer = new ResizeObserver(() => { const center = instance.getCenter(); instance.relayout(); instance.setCenter(center); });
      observer.observe(element);
      setSatellite(false); setState("ready");
    }).catch(error => { if (!cancelled) { setMessage(error.message); setState("error"); } });
    return () => {
      cancelled = true; observer?.disconnect();
      if (map.current && click) window.kakao.maps.event.removeListener(map.current, "click", click);
      marker.current?.setMap(null); outline.current?.setMap(null); map.current = null;
      element?.replaceChildren();
    };
  }, [attempt]);
  useEffect(() => {
    if (state !== "ready" || !map.current) return;
    const sdk = window.kakao.maps, location = pending ?? selected;
    outline.current?.setMap(null); outline.current = null;
    if (!location) { marker.current?.setMap(null); return; }
    const position = new sdk.LatLng(location.lat, location.lng);
    marker.current.setPosition(position); marker.current.setMap(map.current);
    if (selected && !pending) {
      if (boundary && boundary.length >= 3) {
        const path = boundary.map(([lng, lat]) => new sdk.LatLng(lat, lng));
        outline.current = new sdk.Polygon({ map: map.current, path, strokeWeight: 3, strokeColor: "#205b50", fillColor: "#4f9c7f", fillOpacity: 0.22 });
        const bounds = new sdk.LatLngBounds(); path.forEach((p: any) => bounds.extend(p));
        map.current.setBounds(bounds, 85, 65, 85, 65);
        if (map.current.getLevel() < 2) map.current.setLevel(2);
      } else { map.current.setCenter(position); map.current.setLevel(3); }
    }
  }, [selected, pending, boundary, state]);
  useEffect(() => {
    if (state === "ready" && map.current && area) {
      map.current.setCenter(new window.kakao.maps.LatLng(area.lat, area.lng)); map.current.setLevel(5);
      setMessage("검색한 지역으로 이동했어요. 확대해서 원하는 필지를 선택하세요.");
    }
  }, [area, state]);
  const zoom = (delta: number) => { if (map.current) map.current.setLevel(Math.max(1, Math.min(14, map.current.getLevel() + delta))); };
  return <section className="picker-map" aria-label="부지 선택 지도">
    <div ref={container} className="picker-map-canvas" />
    {state === "ready" ? <>
      <div className="picker-map-hint" role="status">{message || "드래그로 이동 · 스크롤로 확대 · 필지 안쪽을 클릭"}</div>
      <div className="picker-map-controls">
        <button type="button" aria-label="지도 확대" onClick={() => zoom(-1)}><Plus size={19} /></button>
        <button type="button" aria-label="지도 축소" onClick={() => zoom(1)}><Minus size={19} /></button>
        <button type="button" aria-label="선택한 부지로 이동" disabled={!selected} onClick={() => { if (selected) { map.current.setCenter(new window.kakao.maps.LatLng(selected.lat, selected.lng)); map.current.setLevel(3); } }}><MapPin size={18} /></button>
      </div>
      <button className="picker-map-type" type="button" aria-pressed={satellite} onClick={() => { map.current.setMapTypeId(satellite ? window.kakao.maps.MapTypeId.ROADMAP : window.kakao.maps.MapTypeId.HYBRID); setSatellite(!satellite); }}>{satellite ? "일반 지도" : "위성 지도"}</button>
      <span className="picker-crosshair" aria-hidden="true">+</span>
      <button className="picker-center-button" type="button" disabled={disabled} onClick={() => selectPoint.current(map.current.getCenter())}><Crosshair size={16} /> 지도 중심 선택</button>
    </> : <div className="picker-map-empty" role="status">
      <MapPin size={32} strokeWidth={1.3} /><strong>{state === "loading" ? "지도를 불러오고 있어요" : "주소 검색으로 시작할 수 있어요"}</strong>
      <p>{state === "loading" ? "찾고 싶은 주소를 먼저 입력해도 돼요." : message}</p>
      {state === "error" && <button type="button" onClick={() => setAttempt(x => x + 1)}><RefreshCw size={15} /> 지도 다시 연결</button>}
    </div>}
  </section>;
}
