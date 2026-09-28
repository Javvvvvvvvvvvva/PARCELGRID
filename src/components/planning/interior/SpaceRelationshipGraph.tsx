"use client";

import { useMemo, useState } from "react";
import { Background, Controls, ReactFlow, type Connection, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { SPACE_COLORS, type InteriorLayout } from "@/lib/planning/interior/types";

export default function SpaceRelationshipGraph({ layout, disabled, onChange }: { layout: InteriorLayout; disabled: boolean; onChange: (layout: InteriorLayout) => void }) {
  const [kind, setKind] = useState<"adjacent" | "separate">("adjacent");
  const nodes: Node[] = useMemo(() => layout.spaces.map((s, i) => ({
    id: s.id, position: { x: (i % 3) * 200, y: Math.floor(i / 3) * 100 },
    data: { label: s.label }, style: { background: SPACE_COLORS[s.kind], color: "#172033", border: "1px solid #94a3b8", borderRadius: 12 },
  })), [layout.spaces]);
  const edges: Edge[] = layout.relations.map(r => ({ id: r.id, source: r.from, target: r.to, label: r.kind === "adjacent" ? "인접 선호" : "분리 선호", style: { stroke: r.kind === "adjacent" ? "#2563eb" : "#dc2626", strokeDasharray: r.kind === "separate" ? "5 4" : undefined } }));
  const connect = (connection: Connection) => {
    if (disabled || !connection.source || !connection.target || connection.source === connection.target || layout.relations.length >= 256) return;
    const relation = { id: `relation-${crypto.randomUUID()}`, from: connection.source, to: connection.target, kind };
    onChange({ ...layout, relations: [...layout.relations.filter(r => !((r.from === relation.from && r.to === relation.to) || (r.from === relation.to && r.to === relation.from))), relation] });
  };
  return <div>
    <label>새 관계 <select value={kind} disabled={disabled} onChange={e => setKind(e.target.value as typeof kind)}><option value="adjacent">인접 선호</option><option value="separate">분리 선호</option></select></label>
    <p className="pg-interior-note">공간의 연결점 사이를 드래그해 관계를 추가합니다. 선호 관계는 아래 검사에 반영되며, 기존 평면을 자동으로 이동시키지는 않습니다. 관계선을 두 번 누르면 삭제합니다.</p>
    <div style={{ height: 310, background: "#f8fafc", borderRadius: 10 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={!disabled} onConnect={connect}
        onEdgeDoubleClick={(_, edge) => !disabled && onChange({ ...layout, relations: layout.relations.filter(r => r.id !== edge.id) })}
        ariaLabelConfig={{ "controls.zoomIn.ariaLabel": "확대", "controls.zoomOut.ariaLabel": "축소", "controls.fitView.ariaLabel": "전체 보기" }}>
        <Background /><Controls showInteractive={false} />
      </ReactFlow>
    </div>
  </div>;
}
