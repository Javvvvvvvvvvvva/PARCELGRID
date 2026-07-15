import type { CadastralContextSnapshot } from "@/lib/geo/cadastral-context";
import { buildCadastralLineworkPackage } from "@/lib/planning/cadastral-linework-export";
import {
  buildSketchupDaeExport,
  createStoredZip,
} from "@/lib/planning/sketchup-dae-export";
import type { SketchupExportPackageSnapshot } from "@/lib/planning/sketchup-export-package";
import {
  buildSketchupSiteExport,
  type SketchupSiteExportResult,
} from "@/lib/planning/sketchup-site-export";
import { buildSiteDeliveryAudit } from "@/lib/planning/site-delivery-audit";

export const SKETCHUP_SITE_DELIVERY_EXPORT_VERSION =
  "sketchup-site-delivery-export-v1" as const;

export interface SketchupSiteDeliveryExportResult
  extends SketchupSiteExportResult {
  combinedDaeFilename: string;
  combinedDaeText: string;
  preferredImportFilename: string;
}

function sectionContent(document: string, tag: string): string {
  const startToken = `<${tag}>`;
  const endToken = `</${tag}>`;
  const start = document.indexOf(startToken);
  const end = document.indexOf(endToken);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`COLLADA ${tag} section을 찾을 수 없습니다.`);
  }
  return document.slice(start + startToken.length, end);
}

function appendSection(
  document: string,
  tag: string,
  additionalContent: string
): string {
  const endToken = `</${tag}>`;
  const end = document.indexOf(endToken);
  if (end < 0) throw new Error(`COLLADA ${tag} section을 합칠 수 없습니다.`);
  return `${document.slice(0, end)}${additionalContent}${document.slice(end)}`;
}

function siteVisualSceneChildren(siteDaeText: string): string {
  const visualScene = sectionContent(siteDaeText, "visual_scene").trim();
  const firstTagEnd = visualScene.indexOf(">");
  const lastNodeClose = visualScene.lastIndexOf("</node>");
  if (firstTagEnd < 0 || lastNodeClose <= firstTagEnd) {
    throw new Error("사이트 COLLADA scene 계층을 읽을 수 없습니다.");
  }
  return visualScene.slice(firstTagEnd + 1, lastNodeClose);
}

function appendVisualSceneChildren(
  modelDaeText: string,
  children: string
): string {
  const marker = "</node></visual_scene>";
  const position = modelDaeText.lastIndexOf(marker);
  if (position < 0) {
    throw new Error("모델 COLLADA scene 계층을 합칠 수 없습니다.");
  }
  return `${modelDaeText.slice(0, position)}${children}${modelDaeText.slice(position)}`;
}

export function combineSketchupSiteDae(input: {
  modelDaeText: string;
  siteDaeText: string;
  siteHash: string;
}): string {
  let combined = input.modelDaeText;
  combined = appendSection(
    combined,
    "library_effects",
    sectionContent(input.siteDaeText, "library_effects")
  );
  combined = appendSection(
    combined,
    "library_materials",
    sectionContent(input.siteDaeText, "library_materials")
  );
  combined = appendSection(
    combined,
    "library_geometries",
    sectionContent(input.siteDaeText, "library_geometries")
  );
  combined = appendVisualSceneChildren(
    combined,
    siteVisualSceneChildren(input.siteDaeText)
  );
  return combined
    .replace(
      /<authoring_tool>PARCELGRID ([^<]+)<\/authoring_tool>/,
      `<authoring_tool>PARCELGRID ${SKETCHUP_SITE_DELIVERY_EXPORT_VERSION}</authoring_tool>`
    )
    .replace(
      /<comments>[^<]*<\/comments>/,
      `<comments>${input.siteHash} | combined planning mass, GIS buildings, cadastral and UPIS road context</comments>`
    );
}

function deliveryReadme(input: {
  combinedDaeFilename: string;
  modelDaeFilename: string;
  siteDaeFilename: string;
  dxfFilename: string;
  siteHash: string;
  audit: ReturnType<typeof buildSiteDeliveryAudit>;
  origin: [number, number];
}): string {
  return [
    "PARCELGRID SketchUp Site Delivery Package",
    "==========================================",
    `Site hash: ${input.siteHash}`,
    "",
    "권장 가져오기",
    `1. ${input.combinedDaeFilename} 파일 하나를 COLLADA 형식으로 가져옵니다.`,
    "2. 모델 단위는 meter이며 가져온 직후 이동·회전하지 마세요.",
    `3. 2D 지적선을 추가 확인할 때만 ${input.dxfFilename}를 가져옵니다.`,
    "",
    "분리 검증용 파일",
    `- ${input.modelDaeFilename}: 계획 매스·대상 필지·주변 건물·정북`,
    `- ${input.siteDaeFilename}: 인접 필지·도로 경계·중심선·접도·폭 샘플`,
    "통합 파일에 문제가 있을 때만 위 두 파일을 같은 SketchUp 문서에 순서대로 가져오세요.",
    "",
    "좌표 계약",
    "- 단위: meter",
    "- 동쪽: +X",
    "- 북쪽: -Z",
    "- 위쪽: +Y",
    `- WGS84 원점: ${input.origin.join(", ")}`,
    "",
    "설계 전달 점검",
    ...input.audit.checks.map(
      (check) =>
        `- [${check.status.toUpperCase()}] ${check.label}: ${check.message}`
    ),
    "",
    "주의",
    "- PG_PROPOSED_MASS만 Geometry Contract를 통과한 설계 시작 기준 매스입니다.",
    "- PG_ROAD_BOUNDARY_UPIS는 도시계획 도로 도형이며 현황측량이나 경계측량을 대체하지 않습니다.",
    "- REVIEW 항목은 export를 허용하지만 건축사와 측량 자료로 재확인해야 합니다.",
    "",
  ].join("\n");
}

export function buildSketchupSiteDeliveryExport(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  targetBoundary: [number, number][];
  sourceParcels: Parameters<typeof buildCadastralLineworkPackage>[0]["sourceParcels"];
}): SketchupSiteDeliveryExportResult {
  const legacy = buildSketchupSiteExport(input);
  const modelExport = buildSketchupDaeExport(input.basePackage);
  const linework = buildCadastralLineworkPackage({
    snapshot: input.cadastral,
    targetBoundary: input.targetBoundary,
    sourceParcels: input.sourceParcels,
  });
  const audit = buildSiteDeliveryAudit({
    planning: input.basePackage.planning,
    context: input.basePackage.context,
    cadastral: input.cadastral,
  });
  if (!audit.exportable) {
    throw new Error(
      audit.checks.find((check) => check.status === "fail")?.message ??
        "설계 전달 점검을 통과하지 못했습니다."
    );
  }

  const base = legacy.filename.replace(/\.zip$/i, "");
  const combinedDaeFilename = `${base}-combined.dae`;
  const combinedDaeText = combineSketchupSiteDae({
    modelDaeText: modelExport.daeText,
    siteDaeText: legacy.siteDaeText,
    siteHash: base.match(/SITE-[A-F0-9]+/)?.[0] ?? "SITE-COMBINED",
  });
  const parsedMetadata = JSON.parse(legacy.metadataText) as Record<string, unknown>;
  const metadataText = `${JSON.stringify(
    {
      ...parsedMetadata,
      deliveryExportVersion: SKETCHUP_SITE_DELIVERY_EXPORT_VERSION,
      preferredImportFile: combinedDaeFilename,
      deliveryAudit: audit,
      files: {
        combinedDae: combinedDaeFilename,
        splitModelDae: legacy.modelDaeFilename,
        splitSiteContextDae: legacy.siteDaeFilename,
        dxf: linework.dxfFilename,
        geojson: linework.geojsonFilename,
      },
    },
    null,
    2
  )}\n`;
  const readmeText = deliveryReadme({
    combinedDaeFilename,
    modelDaeFilename: legacy.modelDaeFilename,
    siteDaeFilename: legacy.siteDaeFilename,
    dxfFilename: linework.dxfFilename,
    siteHash: base.match(/SITE-[A-F0-9]+/)?.[0] ?? "SITE-COMBINED",
    audit,
    origin: input.basePackage.planning.coordinateSystem.originLngLat,
  });
  const encoder = new TextEncoder();
  const zipBytes = createStoredZip([
    { name: combinedDaeFilename, bytes: encoder.encode(combinedDaeText) },
    { name: legacy.modelDaeFilename, bytes: encoder.encode(modelExport.daeText) },
    { name: legacy.siteDaeFilename, bytes: encoder.encode(legacy.siteDaeText) },
    { name: linework.dxfFilename, bytes: encoder.encode(linework.dxfText) },
    { name: linework.geojsonFilename, bytes: encoder.encode(linework.geojsonText) },
    { name: legacy.metadataFilename, bytes: encoder.encode(metadataText) },
    { name: legacy.readmeFilename, bytes: encoder.encode(readmeText) },
  ]);

  return {
    ...legacy,
    combinedDaeFilename,
    combinedDaeText,
    preferredImportFilename: combinedDaeFilename,
    metadataText,
    readmeText,
    zipBytes,
  };
}

export function downloadSketchupSiteDeliveryExport(input: {
  basePackage: SketchupExportPackageSnapshot;
  cadastral: CadastralContextSnapshot;
  targetBoundary: [number, number][];
  sourceParcels: Parameters<typeof buildCadastralLineworkPackage>[0]["sourceParcels"];
}): SketchupSiteDeliveryExportResult {
  const result = buildSketchupSiteDeliveryExport(input);
  const data = result.zipBytes.buffer.slice(
    result.zipBytes.byteOffset,
    result.zipBytes.byteOffset + result.zipBytes.byteLength
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return result;
}
