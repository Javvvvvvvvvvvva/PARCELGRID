"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- Kakao SDK objects are confined to this adapter. */
import { useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Minus, Plus, RefreshCw } from "lucide-react";
import { loadKakaoSdk } from "@/lib/integrations/kakao-maps-sdk";
import SelectionContextLegend, { type ContextLegendProps, type ContextVisibility } from "./SelectionContextLegend";
import type { ContextLayerKey } from "@/lib/parcels/selection-context";

const CONTEXT_STYLE = {
  parcels: { strokeColor: "#76876b", strokeWeight: 1, fillColor: "#c5d7b8", fillOpacity: 0.08, zIndex: 1 },
  roads: { strokeColor: "#9b967e", strokeWeight: 1, fillColor: "#d5cda8", fillOpacity: 0.38, zIndex: 2 },
  buildings: { strokeColor: "#697c8d", strokeWeight: 1.5, fillColor: "#8ca1b5", fillOpacity: 0.38, zIndex: 3 },
};

export interface MapLocation { lat: number; lng: number }
export default function ParcelSelectionMap({ selected, pending, area, boundary, onSelect, disabled = false, ...contextProps }: {
  selected?: MapLocation; pending?: MapLocation; boundary?: [number, number][];
  area?: MapLocation;
  onSelect: (location: MapLocation) => void; disabled?: boolean;
} & ContextLegendProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null), marker = useRef<any>(null), outline = useRef<any>(null);
  const callback = useRef(onSelect); callback.current = onSelect;
  const blocked = useRef(disabled); blocked.current = disabled;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [satellite, setSatellite] = useState(false);
  const [visible, setVisible] = useState<ContextVisibility>({ parcels: true, buildings: true, roads: true });
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
      marker.current = new sdk.Marker({ zIndex: 6 });
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
    let selectedShape: any;
    const click = (event: any) => { sdk.event.preventMap(); selectPoint.current(event.latLng); };
    outline.current?.setMap(null); outline.current = null;
    if (!location) { marker.current?.setMap(null); return; }
    const position = new sdk.LatLng(location.lat, location.lng);
    marker.current.setPosition(position); marker.current.setMap(map.current);
    if (selected && !pending) {
      if (boundary && boundary.length >= 3) {
        const path = boundary.map(([lng, lat]) => new sdk.LatLng(lat, lng));
        selectedShape = new sdk.Polygon({ map: map.current, path, strokeWeight: 3, strokeColor: "#205b50", fillColor: "#4f9c7f", fillOpacity: 0.12, zIndex: 5 });
        outline.current = selectedShape;
        sdk.event.addListener(selectedShape, "click", click);
        const bounds = new sdk.LatLngBounds(); path.forEach((p: any) => bounds.extend(p));
        map.current.setBounds(bounds, 85, 65, 85, 65);
        if (map.current.getLevel() < 2) map.current.setLevel(2);
      } else { map.current.setCenter(position); map.current.setLevel(3); }
    }
    return () => { if (selectedShape) { sdk.event.removeListener(selectedShape, "click", click); selectedShape.setMap(null); } };
  }, [selected, pending, boundary, state]);
  useEffect(() => {
    if (state !== "ready" || !map.current || !contextProps.context) return;
    const sdk = window.kakao.maps, instance = map.current;
    const shapes: any[] = [], labels: { overlay: any; position: any; width: number }[] = [];
    const fontFamily = getComputedStyle(container.current!).fontFamily;
    const measure = document.createElement("canvas").getContext("2d");
    if (measure) measure.font = `600 10px ${fontFamily}`;
    const click = (event: any) => { sdk.event.preventMap(); selectPoint.current(event.latLng); };
    for (const key of ["roads", "parcels", "buildings"] as ContextLayerKey[]) {
      if (!visible[key]) continue;
      for (const feature of contextProps.context.layers[key].features) {
        for (const rings of feature.polygons) {
          const path = rings.map(ring => ring.map(([lng, lat]) => new sdk.LatLng(lat, lng)));
          const shape = new sdk.Polygon({ map: instance, path, ...CONTEXT_STYLE[key] });
          sdk.event.addListener(shape, "click", click); shapes.push(shape);
        }
        if (key === "parcels" && feature.label !== "지번 미제공" && labels.length < 40) {
          const content = document.createElement("span"); content.className = "picker-parcel-label"; content.textContent = feature.label;
          content.style.fontFamily = fontFamily;
          const position = new sdk.LatLng(feature.labelPosition[1], feature.labelPosition[0]);
          labels.push({ position, width: (measure?.measureText(feature.label).width ?? feature.label.length * 10) + 12,
            overlay: new sdk.CustomOverlay({ position, content, yAnchor: 0.5, zIndex: 4 }) });
        }
      }
    }
    const updateLabels = () => {
      const projection = instance.getProjection();
      const occupied: { x: number; y: number; width: number }[] = [];
      if (selected) { const p = projection.containerPointFromCoords(new sdk.LatLng(selected.lat, selected.lng)); occupied.push({ x: p.x, y: p.y, width: 36 }); }
      for (const label of labels) {
        const p = projection.containerPointFromCoords(label.position);
        const fits = instance.getLevel() <= 3 && p.x >= label.width / 2 && p.x <= container.current!.clientWidth - label.width / 2 &&
          p.y >= 12 && p.y <= container.current!.clientHeight - 12 &&
          !occupied.some(other => Math.abs(other.x - p.x) < (other.width + label.width) / 2 && Math.abs(other.y - p.y) < 22);
        label.overlay.setMap(fits ? instance : null);
        if (fits) occupied.push({ x: p.x, y: p.y, width: label.width });
      }
    };
    updateLabels(); sdk.event.addListener(instance, "zoom_changed", updateLabels); sdk.event.addListener(instance, "idle", updateLabels);
    return () => {
      sdk.event.removeListener(instance, "zoom_changed", updateLabels);
      sdk.event.removeListener(instance, "idle", updateLabels);
      shapes.forEach(shape => { sdk.event.removeListener(shape, "click", click); shape.setMap(null); });
      labels.forEach(label => label.overlay.setMap(null));
    };
  }, [contextProps.context, visible, state, selected]);
  useEffect(() => {
    if (state === "ready" && map.current && area) {
      map.current.setCenter(new window.kakao.maps.LatLng(area.lat, area.lng)); map.current.setLevel(5);
      setMessage("검색한 지역으로 이동했어요. 확대해서 원하는 필지를 선택하세요.");
    }
  }, [area, state]);
  const zoom = (delta: number) => { if (map.current) map.current.setLevel(Math.max(1, Math.min(14, map.current.getLevel() + delta))); };
  return <section className="picker-map" aria-label="부지 선택 지도">
    <div className="picker-map-surface">
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
    </div>
    <SelectionContextLegend {...contextProps} visible={visible} onToggle={key => setVisible(current => ({ ...current, [key]: !current[key] }))} />
  </section>;
}
