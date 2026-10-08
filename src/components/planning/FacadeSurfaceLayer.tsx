"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { PlanningFloorMass } from "@/lib/planning/planning-massing";
import type { PlanningFacadeMaterial, PlanningMaterialSelection } from "@/lib/planning/types";
import { floorFacadeFaces, type FacadeFace } from "@/lib/planning/facade-quantities";
import { facadeSurfacePatches, usesFacadeSkin } from "@/lib/planning/facade-render";
import { planningMaterialAppearance, resolvePlanningMaterials } from "@/lib/planning/materials";

// Original procedural swatches. No downloaded textures, hidden network calls or asset licenses.
function texture(material: PlanningFacadeMaterial) {
  if (typeof document === "undefined" || material === "unselected") return null;
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
  const c = canvas.getContext("2d"); if (!c) return null;
  const appearance = planningMaterialAppearance({ ...resolvePlanningMaterials(), primaryFacadeMaterial: material });
  c.fillStyle = appearance?.primaryColor ?? "#cccccc"; c.fillRect(0, 0, 256, 256);
  c.strokeStyle = material === "brick-veneer" ? "#b8ac9e" : "#777777";
  c.lineWidth = material === "brick-veneer" ? 7 : 2;
  if (material === "brick-veneer") {
    c.lineWidth = 17; // ~10mm horizontal joint in a 0.15m-high tile.
    c.beginPath(); c.moveTo(0, 0); c.lineTo(256, 0); c.moveTo(0, 128); c.lineTo(256, 128); c.stroke();
    c.lineWidth = 6; // ~10mm vertical joint in a 0.44m-wide tile.
    c.beginPath();
    for (const x of [0, 128, 256]) { c.moveTo(x, 0); c.lineTo(x, 128); }
    for (const x of [64, 192]) { c.moveTo(x, 128); c.lineTo(x, 256); }
    c.stroke();
  } else if (material !== "standard-render") c.strokeRect(0, 0, 256, 256);
  // Deterministic fine mottling: changes appearance only, never geometry or costing.
  for (let i = 0; i < 1300; i++) { c.fillStyle = i % 2 ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)"; c.fillRect((i * 73) % 256, (i * 131 + Math.floor(i / 256) * 17) % 256, 2, 2); }
  const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
function Surface({ face, patch, active }: { face: FacadeFace; patch: ReturnType<typeof facadeSurfacePatches>[number]; active: boolean }) {
  const map = useMemo(() => texture(patch.material), [patch.material]);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([
      face.start.x, patch.base, face.start.z, face.end.x, patch.base, face.end.z,
      face.end.x, patch.top, face.end.z, face.start.x, patch.top, face.start.z,
    ], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, patch.vOffset, patch.u, patch.vOffset, patch.u, patch.vOffset + patch.v, 0, patch.vOffset + patch.v], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
  }, [face, patch]);
  useEffect(() => () => { geometry.dispose(); }, [geometry]);
  useEffect(() => () => { map?.dispose(); }, [map]);
  const appearance = planningMaterialAppearance({ ...resolvePlanningMaterials(), primaryFacadeMaterial: patch.material });
  return <mesh geometry={geometry} raycast={() => {}} renderOrder={2}>
    <meshStandardMaterial transparent opacity={1} map={map} color={active ? "#ffbbaa" : patch.material === "unselected" ? "#94a3b8" : "#ffffff"} roughness={appearance?.roughness} metalness={appearance?.metalness} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
  </mesh>;
}
export function FacadeSurfaceLayer({ mass, selection, active }: { mass: PlanningFloorMass; selection?: PlanningMaterialSelection; active: boolean }) {
  const materials = resolvePlanningMaterials(selection);
  if (!usesFacadeSkin(mass, selection)) return null;
  return <group>{floorFacadeFaces(mass).flatMap(face => facadeSurfacePatches(face, materials).map((patch, i) => <Surface key={`${face.id}-${i}`} face={face} patch={patch} active={active} />))}</group>;
}
