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
  "sketchup-site-delivery-export-v3" as const;

const CLEAN_HIDDEN_LAYER_NODE_IDS = [
  "PG_ADJACENT_PARCELS-node",
  "PG_ROAD_CENTERLINE_REFERENCE-node",
  "PG_ROAD_WIDTH_SAMPLES-node",
] as const;

export interface SketchupSiteDeliveryExportResult
  extends SketchupSiteExportResult {
  /** 모든 계획·GIS·지적 검토 레이어가 포함된 전체 컨텍스트 파일. */
  combinedDaeFilename: string;
  combinedDaeText: string;
  /** 건축가의 기본 설계 작업용. 혼란을 주는 보조선은 scene에서 제외한다. */
  cleanDaeFilename: string;
  cleanDaeText: string;
  /** full-context.dae의 PG_* 그룹을 SketchUp Tags로 자동 분류한다. */
  tagSetupFilename: string;
  tagSetupText: string;
  preferredImportFilename: string;
}

function sectionContent(document: string, tag: string): string {
  const start = document.indexOf(`<${tag}`);
  const openingEnd = start < 0 ? -1 : document.indexOf(">", start);
  const endToken = `</${tag}>`;
  const end = openingEnd < 0 ? -1 : document.indexOf(endToken, openingEnd);
  if (start < 0 || openingEnd < 0 || end < 0 || end < openingEnd) {
    throw new Error(`COLLADA ${tag} section을 찾을 수 없습니다.`);
  }
  return document.slice(openingEnd + 1, end);
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

/**
 * 중첩된 COLLADA node를 균형 있게 제거한다. geometry 라이브러리는 남겨도 scene에서
 * 참조되지 않으므로 SketchUp에는 표시되지 않는다.
 */
function removeVisualNodeById(document: string, nodeId: string): string {
  const marker = `<node id="${nodeId}"`;
  const start = document.indexOf(marker);
  if (start < 0) return document;

  const tokenPattern = /<node\b[^>]*>|<\/node>/g;
  tokenPattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(document))) {
    if (match[0].startsWith("</node")) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return `${document.slice(0, start)}${document.slice(tokenPattern.lastIndex)}`;
    }
  }
  throw new Error(`${nodeId} COLLADA node의 닫힘 태그를 찾을 수 없습니다.`);
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

export function buildCleanSketchupSiteDae(fullContextDaeText: string): string {
  const clean = CLEAN_HIDDEN_LAYER_NODE_IDS.reduce(
    (document, nodeId) => removeVisualNodeById(document, nodeId),
    fullContextDaeText
  );
  return clean.replace(
    /<comments>[^<]*<\/comments>/,
    "<comments>PARCELGRID design-base | proposed mass, parking geometry, site, context buildings, road boundary and frontage; optional guides excluded</comments>"
  );
}

export function buildSketchupTagSetupScript(): string {
  return `# frozen_string_literal: true
# PARCELGRID SketchUp Tag Setup
# Import the *-full-context.dae file first, then run this file from Window > Ruby Console:
# load 'C:/path/to/PARCELGRID-SKETCHUP-TAGS.rb'

module ParcelGridTagSetup
  TAG_PATTERN = /\\A(PG_[A-Z0-9_]+)/
  HIDDEN_BY_DEFAULT = %w[
    PG_ADJACENT_PARCELS
    PG_ROAD_CENTERLINE_REFERENCE
    PG_ROAD_WIDTH_SAMPLES
    PG_METADATA
    PG_SITE_METADATA
  ].freeze

  def self.container?(entity)
    entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
  end

  def self.child_entities(entity)
    return entity.entities if entity.is_a?(Sketchup::Group)
    return entity.definition.entities if entity.is_a?(Sketchup::ComponentInstance)

    nil
  end

  def self.assign_tags(entities, model, found, visited_definitions)
    entities.each do |entity|
      next unless container?(entity)

      tag_name = entity.name.to_s[TAG_PATTERN, 1]
      if tag_name
        tag = model.layers[tag_name] || model.layers.add(tag_name)
        entity.layer = tag
        found[tag_name] = tag
        next
      end

      if entity.is_a?(Sketchup::ComponentInstance)
        definition_key = entity.definition.persistent_id
        next if visited_definitions[definition_key]

        visited_definitions[definition_key] = true
      end
      nested = child_entities(entity)
      assign_tags(nested, model, found, visited_definitions) if nested
    end
  end

  def self.run
    model = Sketchup.active_model
    model.start_operation('PARCELGRID Tags', true)
    found = {}
    assign_tags(model.entities, model, found, {})

    found.each do |name, tag|
      tag.visible = !HIDDEN_BY_DEFAULT.include?(name)
    end

    model.commit_operation
    hidden = found.keys.select { |name| HIDDEN_BY_DEFAULT.include?(name) }
    UI.messagebox(
      "PARCELGRID Tags 설정 완료\\n" \\
      "생성/연결: #{found.length}개\\n" \\
      "기본 숨김: #{hidden.join(', ')}\\n\\n" \\
      "Window > Tags에서 각 레이어를 켜고 끌 수 있습니다."
    )
  rescue StandardError => error
    model.abort_operation if model
    UI.messagebox("PARCELGRID Tags 설정 실패: #{error.message}")
    raise error
  end
end

ParcelGridTagSetup.run
`;
}

function deliveryReadme(input: {
  cleanDaeFilename: string;
  combinedDaeFilename: string;
  modelDaeFilename: string;
  siteDaeFilename: string;
  dxfFilename: string;
  tagSetupFilename: string;
  siteHash: string;
  audit: ReturnType<typeof buildSiteDeliveryAudit>;
  origin: [number, number];
}): string {
  return [
    "PARCELGRID SketchUp Site Delivery Package",
    "==========================================",
    `Site hash: ${input.siteHash}`,
    "",
    "권장 가져오기 — 설계 작업",
    `1. ${input.cleanDaeFilename} 파일 하나를 COLLADA 형식으로 가져옵니다.`,
    "2. 이 파일은 계획 매스·실제 주차면·차량 통로·대상 필지·주변 건물·도로 경계·접도선을 표시합니다.",
    "3. 인접 필지선·도로 중심선·폭 샘플은 혼란을 줄이기 위해 제외했습니다.",
    "4. 모델 단위는 meter이며 가져온 직후 이동·회전하지 마세요.",
    "",
    "전체 지적 검토 및 필터",
    `1. 모든 검토선을 보려면 ${input.combinedDaeFilename}를 새 SketchUp 문서에 가져옵니다.`,
    `2. Window > Ruby Console을 열고 load '파일경로/${input.tagSetupFilename}'를 실행합니다.`,
    "3. Window > Tags에서 PG_ADJACENT_PARCELS, PG_ROAD_CENTERLINE_REFERENCE,",
    "   PG_ROAD_WIDTH_SAMPLES 등을 필터처럼 켜고 끌 수 있습니다.",
    "4. 인접 필지·중심선·폭 샘플은 Tag 설정 직후 기본 숨김 처리됩니다.",
    "",
    "분리 검증용 파일",
    `- ${input.modelDaeFilename}: 계획 매스·대상 필지·주변 건물·정북`,
    `- ${input.siteDaeFilename}: 인접 필지·도로 경계·중심선·접도·폭 샘플`,
    `- ${input.dxfFilename}: 2D 지적선 및 도로 선형`,
    "",
    "45도로 보이는 이유",
    "- 매스나 지적 데이터가 회전된 것이 아니라 SketchUp 조감 카메라의 시점 때문입니다.",
    "- 동쪽 +X, 북쪽 -Z 좌표를 유지하며 지적선을 별도로 회전하면 안 됩니다.",
    "- 지도와 비교할 때는 Camera > Standard Views > Top 후 Parallel Projection을 사용하세요.",
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
    "- PG_PARKING_STALLS와 PG_PARKING_AISLE은 화면·CAD와 같은 Parking Geometry Hash 좌표입니다.",
    "- PG_PARKING_COLUMNS_REFERENCE는 구조설계 확정 기둥이 아닙니다.",
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
  const combinedDaeFilename = `${base}-full-context.dae`;
  const cleanDaeFilename = `${base}-design-base.dae`;
  const tagSetupFilename = "PARCELGRID-SKETCHUP-TAGS.rb";
  const fullContextDaeText = combineSketchupSiteDae({
    modelDaeText: modelExport.daeText,
    siteDaeText: legacy.siteDaeText,
    siteHash: base.match(/SITE-[A-F0-9]+/)?.[0] ?? "SITE-COMBINED",
  });
  const cleanDaeText = buildCleanSketchupSiteDae(fullContextDaeText);
  const tagSetupText = buildSketchupTagSetupScript();
  const parsedMetadata = JSON.parse(legacy.metadataText) as Record<string, unknown>;
  const metadataText = `${JSON.stringify(
    {
      ...parsedMetadata,
      deliveryExportVersion: SKETCHUP_SITE_DELIVERY_EXPORT_VERSION,
      parkingGeometryHash: input.basePackage.parkingGeometryHash,
      parking: input.basePackage.parking,
      preferredImportFile: cleanDaeFilename,
      fullContextImportFile: combinedDaeFilename,
      tagSetupFile: tagSetupFilename,
      defaultHiddenGuideLayers: CLEAN_HIDDEN_LAYER_NODE_IDS.map((id) =>
        id.replace(/-node$/, "")
      ),
      deliveryAudit: audit,
      files: {
        designBaseDae: cleanDaeFilename,
        fullContextDae: combinedDaeFilename,
        sketchupTagSetup: tagSetupFilename,
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
    cleanDaeFilename,
    combinedDaeFilename,
    modelDaeFilename: legacy.modelDaeFilename,
    siteDaeFilename: legacy.siteDaeFilename,
    dxfFilename: linework.dxfFilename,
    tagSetupFilename,
    siteHash: base.match(/SITE-[A-F0-9]+/)?.[0] ?? "SITE-COMBINED",
    audit,
    origin: input.basePackage.planning.coordinateSystem.originLngLat,
  });
  const encoder = new TextEncoder();
  const zipBytes = createStoredZip([
    { name: cleanDaeFilename, bytes: encoder.encode(cleanDaeText) },
    { name: combinedDaeFilename, bytes: encoder.encode(fullContextDaeText) },
    { name: tagSetupFilename, bytes: encoder.encode(tagSetupText) },
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
    combinedDaeText: fullContextDaeText,
    cleanDaeFilename,
    cleanDaeText,
    tagSetupFilename,
    tagSetupText,
    preferredImportFilename: cleanDaeFilename,
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
