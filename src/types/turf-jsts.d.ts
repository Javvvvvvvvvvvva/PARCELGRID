declare module "@turf/jsts" {
  import type { Geometry } from "geojson";
  interface JstsGeometry { isEmpty(): boolean }
  const jsts: {
    GeoJSONReader: new () => { read(geometry: Geometry): JstsGeometry };
    GeoJSONWriter: new () => { write(geometry: JstsGeometry): Geometry };
    BufferOp: { bufferOp(geometry: JstsGeometry, distance: number, quadrantSegments: number): JstsGeometry };
  };
  export default jsts;
}
