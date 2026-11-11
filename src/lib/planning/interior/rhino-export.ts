import type rhino3dm from "rhino3dm";
import { inspectInteriorExport, type InteriorExportInput } from "./export";
import { doorSegment, spacePolygon } from "./geometry";

type RhinoModule = Awaited<ReturnType<typeof rhino3dm>>;
let browserModule: Promise<RhinoModule> | undefined;

function loadBrowserModule(): Promise<RhinoModule> {
  if (typeof window === "undefined") throw new Error("Node 호출은 초기화한 Rhino 모듈을 전달해야 합니다.");
  if (!browserModule) browserModule = new Promise<RhinoModule>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/rhino3dm/rhino3dm.js";
    script.async = true;
    script.onerror = () => { script.remove(); reject(new Error("Rhino 모듈을 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.")); };
    script.onload = () => {
      const factory = (window as typeof window & { rhino3dm?: typeof rhino3dm }).rhino3dm;
      if (!factory) { reject(new Error("Rhino 모듈을 초기화하지 못했습니다.")); return; }
      factory({ locateFile: file => `/vendor/rhino3dm/${file}` }).then(resolve, reject);
    };
    document.head.appendChild(script);
  }).catch(error => { browserModule = undefined; throw error; });
  return browserModule;
}
// Embind's delete() exists at runtime but is omitted from the package's declaration file.
function release(value: object) {
  // Table.delete(key) shadows Embind.delete(); invoke the common native handle destructor.
  let prototype = Object.getPrototypeOf(value);
  while (prototype) {
    if (Object.prototype.hasOwnProperty.call(prototype, "isDeleted")) { prototype.delete.call(value); return; }
    prototype = Object.getPrototypeOf(prototype);
  }
}

// The official UMD distribution is served unchanged, only when export is requested.
// Its Node-only imports never enter the browser bundler. Node callers supply a module.
export async function buildInterior3dm(input: InteriorExportInput, providedModule?: RhinoModule) {
  const { floor, assessment } = inspectInteriorExport(input);
  const rhino = providedModule ?? await loadBrowserModule();
  const model = new rhino.File3dm();
  try {
  const settings = model.settings();
  settings.modelUnitSystem = rhino.UnitSystem.Meters;
  release(settings);
  model.applicationName = "PARCELGRID";
  const strings = model.strings();
  strings.set("PARCELGRID", JSON.stringify({
    stage: "concept", geometryHash: input.planning.geometryHash, projectId: input.planning.projectId,
    scenarioId: input.planning.scenarioId, floorId: floor.id, level: floor.level,
    originLngLat: input.planning.coordinateSystem.originLngLat, unit: "meter", east: "+X", north: "+Y", up: "+Z", assessment,
  }));
  release(strings);
  const layerNames = ["층 외곽", "공간 구획 중심선", "추정 내부 경계", "문 개구"];
  const layers = model.layers();
  for (const name of layerNames) { const layer = new rhino.Layer(); layer.name = name; layers.add(layer); release(layer); }
  release(layers);
  const add = (points: Array<{ x: number; z: number }>, index: number, label: string, closed = true) => {
    const coords = points.map(p => [p.x, -p.z, floor.baseHeightM]);
    if (closed) coords.push([...coords[0]]);
    const curve = new rhino.PolylineCurve(coords);
    const attributes = new rhino.ObjectAttributes();
    attributes.layerIndex = index; attributes.name = label;
    attributes.setUserString("geometryHash", input.planning.geometryHash);
    attributes.setUserString("stage", "concept");
    const objects = model.objects();
    objects.addCurve(curve, attributes);
    release(objects); release(curve); release(attributes);
  };
  add(floor.shape, 0, floor.label);
  for (const space of input.layout.spaces) { add(spacePolygon(space), 1, space.label); add(spacePolygon(space, input.layout.wallThicknessM / 2), 2, space.label); }
  for (const door of input.layout.doors) { const segment = doorSegment(input.layout, door); if (segment) add(segment, 3, door.id, false); }
  return { filename: `PARCELGRID-${input.planning.geometryHash}-${floor.level}-interior.3dm`, bytes: model.toByteArray() };
  } finally { release(model); }
}
