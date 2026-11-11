"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

interface SceneTextProps {
  children: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  fontSize?: number;
  color?: string;
  anchorX?: "left" | "center" | "right";
  anchorY?: "top" | "middle" | "bottom";
  maxWidth?: number;
}

/** Local canvas labels keep the scene usable when external font services are unavailable. */
export function SceneText({ children, position, rotation, fontSize = 1, color = "#111827",
  anchorX = "center", anchorY = "middle", maxWidth }: SceneTextProps) {
  const label = useMemo(() => {
    if (typeof document === "undefined" || !children || !(fontSize > 0) || !Number.isFinite(fontSize)) return null;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    const px = 96, padding = 12;
    const font = `600 ${px}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
    context.font = font;
    const text = children.slice(0, 256);
    const measured = Math.max(1, context.measureText(text).width);
    canvas.width = Math.min(4096, Math.ceil(measured + padding * 2));
    canvas.height = px + padding * 2;
    context.font = font;
    context.fillStyle = color;
    context.textBaseline = "middle";
    context.fillText(text, padding, canvas.height / 2, canvas.width - padding * 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const naturalWidth = canvas.width / px * fontSize;
    const scale = maxWidth != null && maxWidth > 0 ? Math.min(1, maxWidth / naturalWidth) : 1;
    return { texture, width: naturalWidth * scale, height: canvas.height / px * fontSize * scale };
  }, [children, color, fontSize, maxWidth]);
  useEffect(() => () => label?.texture.dispose(), [label]);
  if (!label) return null;
  const offsetX = anchorX === "left" ? label.width / 2 : anchorX === "right" ? -label.width / 2 : 0;
  const offsetY = anchorY === "top" ? -label.height / 2 : anchorY === "bottom" ? label.height / 2 : 0;
  return <group position={position} rotation={rotation}>
    <mesh position={[offsetX, offsetY, 0]}>
      <planeGeometry args={[label.width, label.height]} />
      <meshBasicMaterial map={label.texture} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  </group>;
}
