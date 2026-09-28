"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import { Shape, Vector2 } from "three";
import { spacePolygon, doorSegment } from "@/lib/planning/interior/geometry";
import { SPACE_COLORS, type InteriorLayout } from "@/lib/planning/interior/types";
import type { LocalPlanPoint } from "@/lib/planning/planning-massing";

export default function InteriorPreview3D({ outline, layout }: { outline: LocalPlanPoint[]; layout: InteriorLayout }) {
  const data = useMemo(() => {
    const center = outline.reduce((sum, p) => ({ x: sum.x + p.x / outline.length, z: sum.z + p.z / outline.length }), { x: 0, z: 0 });
    const extent = Math.max(5, ...outline.map(p => Math.hypot(p.x - center.x, p.z - center.z)));
    return { center, extent, ground: new Shape(outline.map(p => new Vector2(p.x, -p.z))), spaces: layout.spaces.map(space => ({ space, shape: new Shape(spacePolygon(space, layout.wallThicknessM / 2).map(p => new Vector2(p.x, -p.z))) })) };
  }, [outline, layout]);
  return <div style={{ height: 370, borderRadius: 12, background: "#f1f5f9", overflow: "hidden" }} aria-label="내부 공간 구획 3D 미리보기">
    <Canvas camera={{ position: [data.center.x + data.extent * 1.4, data.extent * 1.7, data.center.z + data.extent * 1.4], fov: 40, near: 0.05, far: 10000 }}>
      <ambientLight intensity={1.5} /><directionalLight position={[10, 30, 10]} intensity={1.5} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]}><extrudeGeometry args={[data.ground, { depth: 0.1, bevelEnabled: false }]} /><meshStandardMaterial color="#94a3b8" /></mesh>
      {data.spaces.map(({ space, shape }) => <group key={space.id}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}><extrudeGeometry args={[shape, { depth: space.kind === "core" ? 1.2 : 0.12, bevelEnabled: false }]} /><meshStandardMaterial color={SPACE_COLORS[space.kind]} /></mesh>
        <Line points={[...spacePolygon(space), spacePolygon(space)[0]].map(p => [p.x, 0.14, p.z] as [number, number, number])} color="#334155" lineWidth={1} />
      </group>)}
      {layout.doors.map(door => { const edge = doorSegment(layout, door); return edge ? <Line key={door.id} points={edge.map(p => [p.x, 0.17, p.z] as [number, number, number])} color="#059669" lineWidth={5} /> : null; })}
      <OrbitControls target={[data.center.x, 0, data.center.z]} makeDefault maxPolarAngle={Math.PI / 2} />
    </Canvas>
  </div>;
}
