"use client";
import { RefreshCw } from "lucide-react";
import { CONTEXT_LAYER_LABELS, type ContextLayer, type ContextLayerKey, type SelectionContext } from "@/lib/parcels/selection-context";

export type ContextVisibility = Record<ContextLayerKey, boolean>;
export interface ContextLegendProps {
  context?: SelectionContext;
  contextRequested?: boolean;
  contextLoading?: boolean;
  contextError?: boolean;
  onRetryContext?: () => void;
}
const statusText = (layer: ContextLayer) => ({ available: `${layer.features.length}개`, partial: `${layer.features.length}개 · 일부`,
  empty: "수신 없음", error: "조회 실패", unavailable: "연결 안 됨" })[layer.status];

export default function SelectionContextLegend({ context, contextRequested, contextLoading, contextError, onRetryContext, visible, onToggle }: ContextLegendProps & {
  visible: ContextVisibility; onToggle: (key: ContextLayerKey) => void;
}) {
  const keys = Object.keys(CONTEXT_LAYER_LABELS) as ContextLayerKey[];
  const retry = contextError || (context && keys.some(key => context.layers[key].status === "error"));
  return <div className="picker-context" aria-label="주변 지도 레이어" aria-busy={contextLoading}>
    <div className="picker-context-heading"><strong>지도에서 함께 보기</strong><span className="picker-context-selected"><i />선택한 부지</span></div>
    <div className="picker-context-layers">
      {keys.map(key => <button key={key} type="button" className={`picker-context-toggle picker-context-${key}`} aria-label={`${CONTEXT_LAYER_LABELS[key]} 표시`}
        aria-pressed={visible[key]} onClick={() => onToggle(key)} disabled={!context?.layers[key].features.length}>
        <i aria-hidden="true" /><span>{CONTEXT_LAYER_LABELS[key]}</span><small>{context ? statusText(context.layers[key]) : contextLoading ? "조회 중" : "—"}</small>
      </button>)}
    </div>
    <p className="picker-context-note" role="status">{contextLoading ? "선택한 부지 주변의 도형을 확인하고 있어요…" : contextError ? "주변 도형을 불러오지 못했어요. 부지 확인은 계속할 수 있어요." : !contextRequested ? "필지 경계가 확인되면 선택 위치 주변 도형을 함께 보여드려요." : "선택 위치에서 동서남북 약 80m 범위 · 지도 이동 시 자동 재조회하지 않아요."}</p>
    {context && <>
      <p className="picker-context-note">건물 도형이 없어도 빈 땅으로 판단하지 않아요. 도로 필지는 실제 도로 폭·통행 가능 여부를 뜻하지 않아요.</p>
      <details className="picker-context-sources"><summary>자료 출처와 조회 상태</summary>
        {keys.map(key => { const layer = context.layers[key]; return <div key={key}>
          <strong>{CONTEXT_LAYER_LABELS[key]} · {statusText(layer)}</strong><p>{layer.message}</p>
          <p><a href={layer.sourceUrl} target="_blank" rel="noreferrer">{layer.source}</a> · {layer.dataset}<br />
            조회: {new Date(layer.queriedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false })} (한국 시간)<br />
            원자료 갱신일: {layer.sourceUpdatedAt ?? "제공되지 않음"}{layer.omittedCount > 0 && ` · 해석 제외 ${layer.omittedCount}개`}{layer.limited && " · 조회 상한 도달"}</p>
        </div>; })}
      </details>
    </>}
    {retry && <button type="button" className="picker-context-retry" disabled={contextLoading} onClick={onRetryContext}><RefreshCw size={13} /> 주변 도형 다시 조회</button>}
  </div>;
}
