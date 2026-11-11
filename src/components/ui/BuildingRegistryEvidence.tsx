"use client";

import { useState } from "react";
import type { BuildingLookupResult } from "@/lib/integrations/molit-building";
import {
  buildingRegistryLabel, registryDatasetLabel, registryEvidenceDownload, summarizeRegistryAreas,
} from "@/lib/building-registry/evidence";
import {
  BUILDING_REGISTRY_SOURCE, REGISTRY_ISSUE_LABELS, registryNumber,
  type RegistryDataset, type RegistryRecord,
} from "@/lib/building-registry/types";
import "./building-registry.css";

function sqm(value: number | null) {
  return value == null ? "미제공" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 4 })}㎡`;
}

function EvidenceRows({ dataset, kind, printMode }: {
  dataset: RegistryDataset; kind: "floor" | "area"; printMode: boolean;
}) {
  const [limit, setLimit] = useState(20);
  const displayed = dataset.rows.slice(0, printMode ? 8 : limit);
  const floor = (row: RegistryRecord) => [row.fields.flrGbCdNm, row.fields.flrNoNm || row.fields.flrNo].filter(Boolean).join(" ") || "미제공";
  return <>
    <p className="pg-registry-meta">
      {registryDatasetLabel(dataset)} · 수신 {dataset.fetchedCount.toLocaleString()} / 원문 전체 {dataset.totalCount?.toLocaleString() ?? "미확인"}건 · 보존 {dataset.rows.length}행
      {` · ${dataset.pagesFetched}페이지 · 조회 ${dataset.retrievedAt.replace("T", " ").slice(0, 19)} UTC`}
    </p>
    {dataset.issues.length > 0 && <p className="pg-registry-warning">{dataset.issues.map((code) => REGISTRY_ISSUE_LABELS[code] || "자료 추가 확인 필요").join(" · ")}</p>}
    {displayed.length > 0 && <div className="pg-registry-table-wrap">
      <table className="pg-registry-table">
        <thead><tr><th>동 / 층{kind === "area" ? " / 호" : ""}</th><th>용도 / 구분</th><th>원문 면적</th><th>원본 PK / 생성일</th></tr></thead>
        <tbody>{displayed.map((row, index) => <tr key={`${row.registryPk}-${row.rowNumber}-${index}`}>
          <td>{row.fields.dongNm || row.fields.bldNm || "동명 미제공"}<br />{floor(row)}{kind === "area" ? ` / ${row.fields.hoNm || "호명 미제공"}` : ""}</td>
          <td>{row.fields.etcPurps || row.fields.mainPurpsCdNm || "용도 미제공"}<br />
            {kind === "floor" ? `면적제외: ${row.fields.areaExctYn || "미제공"}` : `${row.fields.exposPubuseGbCdNm || "전유/공용 미확인"} (${row.fields.exposPubuseGbCd || "코드 없음"})`}</td>
          <td>{sqm(registryNumber(row.fields.area))}</td>
          <td className="pg-registry-id">{row.registryPk || "PK 미제공"}<br />{row.generatedDate || "생성일 미제공"}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {dataset.rows.length > displayed.length && <p className="pg-registry-meta">
      화면에 {displayed.length} / {dataset.rows.length}행 표시 · 전체 보존 행은 근거 JSON에 포함
      {!printMode && <button type="button" onClick={() => setLimit((value) => value + 50)}>50행 더 보기</button>}
    </p>}
    {dataset.status === "complete" && dataset.totalCount === 0 && <p>해당 요청에서 0건 응답. 이 구분의 면적이 실제로 0이라는 뜻은 아닙니다.</p>}
  </>;
}

export function BuildingRegistryEvidencePanel({ info, printMode = false }: {
  info: BuildingLookupResult | null | undefined; printMode?: boolean;
}) {
  const evidence = info?.registry;
  const summary = evidence ? summarizeRegistryAreas(evidence) : null;
  function download() {
    if (!info) return;
    const json = registryEvidenceDownload(info);
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "parcelgrid-building-evidence.json";
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="pg-registry" aria-label="건축물대장 조회 근거">
    <div className="pg-registry-heading"><strong>건축물대장 조회 근거</strong>
      {evidence && !printMode && <button type="button" onClick={download}>대장 근거 JSON 저장</button>}
    </div>
    <p>{buildingRegistryLabel(info)}</p>
    {!evidence ? <p className="pg-registry-warning">조회 상태·페이지·원본 ID가 없는 이전 자료입니다. 새 부지 분석에서 주소를 다시 조회하면 근거를 함께 저장합니다.</p> : <>
      <p className="pg-registry-meta">
        표제부: {registryDatasetLabel(evidence.title)} · 수신 {evidence.title.fetchedCount} / 원문 전체 {evidence.title.totalCount ?? "미확인"}건 · {evidence.title.pagesFetched}페이지<br />
        조회 {evidence.title.retrievedAt.replace("T", " ").slice(0, 19)} UTC · 지번 조건 {evidence.query.sigunguCd}/{evidence.query.bjdongCd} · {evidence.query.platGbCd === "1" ? "산 " : ""}{Number(evidence.query.bun)}-{Number(evidence.query.ji)}
      </p>
      {evidence.title.issues.length > 0 && <p className="pg-registry-warning">{evidence.title.issues.map((code) => REGISTRY_ISSUE_LABELS[code] || "자료 추가 확인 필요").join(" · ")}</p>}
      {info?.source === "vworld-gis" && <p className="pg-registry-warning">현재 건물 표시는 GIS 속성으로 보완했습니다. 표제부 조회 결과와 실제 동일 건물인지 확인해야 합니다.</p>}
      <details open={printMode}>
        <summary>층별개요 · 면적 대조 ({evidence.floors.rows.length}행)</summary>
        <EvidenceRows dataset={evidence.floors} kind="floor" printMode={printMode} />
        {summary?.comparisons.map((item) => <p className="pg-registry-meta" key={item.registryPk}>
          {item.name} · PK {item.registryPk}<br />
          표제부 {sqm(item.titleAreaSqm)} / 동일 PK 층별 합 {sqm(item.includedFloorAreaSqm)}
          {item.comparable ? ` / 차이 ${sqm(item.differenceSqm)}` : " / 대조 미완료"}
          {` · 연결 ${item.rowCount}행 · 면적제외 Y ${item.excludedRows}행 · 면적·제외여부 미확인 ${item.unresolvedRows}행`}
        </p>)}
        {(summary?.unmatchedFloorRows ?? 0) > 0 && <p className="pg-registry-warning">표제부 PK와 연결되지 않은 층별 행 {summary?.unmatchedFloorRows}건. 동명으로 임의 병합하지 않습니다.</p>}
        <p className="pg-registry-meta">면적제외 N인 행만 더합니다. 차이는 누락·작성 기준 확인 대상이며 적합성 판정이 아닙니다.</p>
      </details>
      <details open={printMode}>
        <summary>전유·공용 면적 원문 ({evidence.exclusiveCommon.rows.length}행)</summary>
        <EvidenceRows dataset={evidence.exclusiveCommon} kind="area" printMode={printMode} />
        <p className="pg-registry-meta">수신 행 참고 합계: 전유 {sqm(summary?.exclusiveObservedSqm ?? null)} · 공용 {sqm(summary?.commonObservedSqm ?? null)}
          {` · 구분 미확인 ${summary?.unclassifiedAreaRows ?? 0}행 · 면적 미제공 ${summary?.missingAreaRows ?? 0}행`}</p>
        <p className="pg-registry-warning">호별 공용 배분·대장 범위가 달라 동 연면적과 단순 합산·대조하지 않습니다. 기존 건물 속성이며 신축 계획·분양 면적에 자동 반영하지 않습니다.</p>
      </details>
    </>}
    <p className="pg-registry-meta"><a href={BUILDING_REGISTRY_SOURCE} target="_blank" rel="noreferrer">국토교통부 건축HUB · 공식 API 안내</a>
      {" · 자료 생성일(crtnDay)은 법적 효력일·현장 확인일이 아닙니다. API 속성은 발급 대장과 실내 도면을 대체하지 않습니다."}</p>
  </section>;
}
