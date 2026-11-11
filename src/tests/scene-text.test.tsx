import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { SceneText } from "@/components/ui/SceneText";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("does not require document or an external font during server rendering", () => {
  vi.stubGlobal("React", React);
  expect(renderToStaticMarkup(React.createElement(SceneText, null, "N"))).toBe("");
});

it("builds bounded local canvas labels with anchors and no network requests", () => {
  vi.stubGlobal("React", React);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const context = { font: "", fillStyle: "", textBaseline: "", measureText: vi.fn(() => ({ width: 50_000 })), fillText: vi.fn() };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
  const createElement = vi.fn(() => canvas), fetch = vi.fn();
  vi.stubGlobal("document", { createElement }); vi.stubGlobal("fetch", fetch);
  const text = "층".repeat(400);
  const html = renderToStaticMarkup(<SceneText fontSize={1} maxWidth={2} anchorX="left"
    anchorY="bottom" position={[1, 2, 3]} rotation={[-Math.PI / 2, 0, 0]}>{text}</SceneText>);
  expect(createElement).toHaveBeenCalledWith("canvas");
  expect(context.measureText).toHaveBeenCalledWith(text.slice(0, 256));
  expect(canvas.width).toBe(4096);
  expect(canvas.height).toBe(120);
  expect(context.fillText).toHaveBeenCalledWith(text.slice(0, 256), 12, 60, 4072);
  expect(html).toContain('position="1,2,3"');
  expect(html).toContain('args="2,0.05859375"');
  expect(fetch).not.toHaveBeenCalled();
});

it("fails locally without hiding other scene objects if a 2D context is unavailable", () => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("document", { createElement: () => ({ getContext: () => null }) });
  expect(renderToStaticMarkup(React.createElement(SceneText, null, "N"))).toBe("");
});
