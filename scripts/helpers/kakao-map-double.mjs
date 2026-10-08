// Self-contained for Playwright addInitScript. Coordinates drive every SVG vertex.
// This checks our adapter, not Kakao's projection, basemap or live provider alignment.
export function installKakaoMapDouble() {
  const listeners = new WeakMap();
  const emit = (object, name, event) => { for (const fn of listeners.get(object)?.[name] ?? []) fn(event); };
  let prevented = false;
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    getLat() { return this.lat; } getLng() { return this.lng; }
  }
  class Bounds { constructor() { this.points = []; } extend(point) { this.points.push(point); } }
  class MapDouble {
    constructor(el, options) {
      this.el = el; this.center = options.center; this.level = options.level; this.layers = new Set();
      window.__map = this; window.__mapCount = (window.__mapCount || 0) + 1;
      el.innerHTML = '<div data-map-double="true" style="position:absolute;inset:0;background:#e4ebdf;background-image:linear-gradient(#b7c9b033 1px,transparent 1px),linear-gradient(90deg,#b7c9b033 1px,transparent 1px);background-size:80px 80px"><span style="position:absolute;bottom:8px;left:10px;font:11px sans-serif;color:#506446">합성 지도 · 좌표 기반 브라우저 검증용</span></div>';
      this.surface = el.firstElementChild;
      el.addEventListener('pointerdown', e => { this.start = [e.clientX, e.clientY]; this.dragged = false; });
      el.addEventListener('pointerup', e => {
        if (this.start && Math.hypot(e.clientX - this.start[0], e.clientY - this.start[1]) > 8) {
          this.dragged = true;
          this.setCenter(this.unproject({ x: el.clientWidth / 2 - (e.clientX - this.start[0]), y: el.clientHeight / 2 - (e.clientY - this.start[1]) }));
        }
      });
      el.addEventListener('wheel', e => { e.preventDefault(); this.setLevel(this.level + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
      el.addEventListener('click', e => {
        if (prevented) { prevented = false; return; }
        if (this.dragged) return;
        emit(this, 'click', { latLng: this.eventPoint(e) });
      });
    }
    metersPerPixel() { return 0.5 * 2 ** (this.level - 2); }
    project(p) {
      const scale = this.metersPerPixel();
      return { x: this.el.clientWidth / 2 + (p.lng - this.center.lng) * 111000 * Math.cos(this.center.lat * Math.PI / 180) / scale,
        y: this.el.clientHeight / 2 - (p.lat - this.center.lat) * 111000 / scale };
    }
    unproject(p) {
      const scale = this.metersPerPixel();
      return new LatLng(this.center.lat - (p.y - this.el.clientHeight / 2) * scale / 111000,
        this.center.lng + (p.x - this.el.clientWidth / 2) * scale / (111000 * Math.cos(this.center.lat * Math.PI / 180)));
    }
    eventPoint(e) { const box = this.el.getBoundingClientRect(); return this.unproject({ x: e.clientX - box.left, y: e.clientY - box.top }); }
    render() { for (const layer of this.layers) layer.render(); }
    getProjection() { return { containerPointFromCoords: point => this.project(point) }; }
    getCenter() { return this.center; } setCenter(point) { this.center = point; this.render(); }
    getLevel() { return this.level; }
    setLevel(level) { this.level = Math.max(1, Math.min(14, level)); this.render(); emit(this, 'zoom_changed'); }
    setMapTypeId(type) { this.type = type; } relayout() { this.render(); }
    setBounds(bounds, top = 0, right = 0, bottom = 0, left = 0) {
      if (!bounds.points.length) return;
      const lat = bounds.points.map(p => p.lat), lng = bounds.points.map(p => p.lng);
      const minLat = Math.min(...lat), maxLat = Math.max(...lat), minLng = Math.min(...lng), maxLng = Math.max(...lng);
      this.center = new LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
      const scale = Math.max((maxLat - minLat) * 111000 / Math.max(1, this.el.clientHeight - top - bottom),
        (maxLng - minLng) * 111000 * Math.cos(this.center.lat * Math.PI / 180) / Math.max(1, this.el.clientWidth - left - right));
      this.setLevel(Math.ceil(Math.log2(scale / 0.5)) + 2);
    }
  }
  class Layer {
    setMap(map) { this.map?.layers.delete(this); this.el?.remove(); this.map = map; if (map) { map.layers.add(this); this.render(); } }
    getMap() { return this.map; }
  }
  class Polygon extends Layer {
    constructor(options) { super(); this.options = options; this.setMap(options.map); }
    render() {
      this.el?.remove(); if (!this.map) return;
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
      const rings = Array.isArray(this.options.path[0]) ? this.options.path : [this.options.path];
      path.setAttribute('d', rings.map(ring => ring.map((point, i) => { const p = this.map.project(point); return `${i ? 'L' : 'M'}${p.x},${p.y}`; }).join(' ') + ' Z').join(' '));
      path.setAttribute('fill-rule', 'evenodd'); path.setAttribute('fill', this.options.fillColor); path.setAttribute('fill-opacity', this.options.fillOpacity ?? 0);
      path.setAttribute('stroke', this.options.strokeColor); path.setAttribute('stroke-width', this.options.strokeWeight ?? 1);
      path.style.pointerEvents = 'visiblePainted';
      svg.style.cssText = `position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;z-index:${this.options.zIndex || 0}`;
      svg.dataset.testBoundary = String(this.options.strokeColor === '#205b50'); svg.dataset.stroke = this.options.strokeColor;
      path.addEventListener('click', e => { if (!this.map.dragged) emit(this, 'click', { latLng: this.map.eventPoint(e) }); });
      svg.appendChild(path); this.el = svg; this.map.el.appendChild(svg);
    }
    getPath() { return this.options.path; }
  }
  class Marker extends Layer {
    constructor(options = {}) { super(); this.options = options; this.position = options.position; if (options.map) this.setMap(options.map); }
    setPosition(position) { this.position = position; if (this.map) this.render(); }
    render() {
      this.el?.remove(); if (!this.map || !this.position) return;
      const p = this.map.project(this.position), el = document.createElement('span');
      el.style.cssText = `position:absolute;left:${p.x}px;top:${p.y}px;transform:translate(-50%,-50%);width:12px;height:12px;border:2px solid white;border-radius:50%;background:#205b50;pointer-events:none;z-index:6`;
      this.el = el; this.map.el.appendChild(el);
    }
  }
  class Overlay extends Layer {
    constructor(options = {}) { super(); this.options = options; if (options.map) this.setMap(options.map); }
    render() {
      this.el?.remove(); if (!this.map || !this.options.position || !(this.options.content instanceof Node)) return;
      const p = this.map.project(this.options.position), el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${p.x}px;top:${p.y}px;transform:translate(-50%,-50%);pointer-events:none;z-index:${this.options.zIndex || 0}`;
      el.appendChild(this.options.content); this.el = el; this.map.el.appendChild(el);
    }
    open() {} close() { this.setMap(null); }
  }
  window.kakao = { maps: { Map: MapDouble, LatLng, LatLngBounds: Bounds, Marker, Polygon, Polyline: Overlay, CustomOverlay: Overlay, InfoWindow: Overlay,
    MapTypeId: { ROADMAP: 1, HYBRID: 3 }, load: fn => fn(), event: {
      addListener: (object, name, fn) => { const all = listeners.get(object) ?? {}; (all[name] ??= []).push(fn); listeners.set(object, all); },
      removeListener: (object, name, fn) => { const all = listeners.get(object); if (all) all[name] = (all[name] ?? []).filter(x => x !== fn); },
      preventMap: () => { prevented = true; }, trigger: emit,
    } } };
}
