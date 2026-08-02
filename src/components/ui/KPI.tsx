"use client";

import type { ReactNode } from "react";
import { won } from "@/lib/utils/format";
import { Tag } from "./Tag";
import { Icons } from "./Icons";
import type { ScenarioVM } from "@/lib/adapters/view-model";

interface KPIProps {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  delta?: string;
  deltaKind?: "pos" | "neg" | "warn";
  sub?: string;
  src?: ReactNode;
}

export function KPI({ label, value, unit, delta, deltaKind, sub, src }: KPIProps) {
  return (
    <div className="ui-kpi">
      <div className="ui-kpi__label">
        {label}
        {src && <span className="ui-src" style={{ marginLeft: "auto" }}>{src}</span>}
      </div>
      <div className="ui-kpi__val mono">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {(delta || sub) && (
        <div className={"ui-kpi__delta" + (deltaKind ? " ui-kpi__delta--" + deltaKind : "")}>
          {delta && <strong>{delta}</strong>}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}

interface DecisionBannerProps {
  scenario: ScenarioVM;
  onCompare?: () => void;
  onDetail?: () => void;
}

export function DecisionBanner({ scenario, onCompare, onDetail }: DecisionBannerProps) {
  return (
    <div className="ui-decision">
      <div className="ui-decision__rec">
        <div>
          <div className="ui-decision__rec-label">권장 시나리오</div>
          <div className="ui-decision__rec-val">
            {scenario.id} · {scenario.name}
          </div>
        </div>
      </div>
      <div className="ui-decision__body">
        <div>
          <div className="ui-decision__stat-label">예상 이익</div>
          <div className="ui-decision__stat-val">{won(scenario.profit)}</div>
        </div>
        <div>
          <div className="ui-decision__stat-label">투입 자본</div>
          <div className="ui-decision__stat-val">{won(scenario.equity)}</div>
        </div>
        <div>
          <div className="ui-decision__stat-label">DSCR</div>
          <div className="ui-decision__stat-val">{scenario.dscr.toFixed(2)}</div>
        </div>
        <div>
          <div className="ui-decision__stat-label">IRR</div>
          <div className="ui-decision__stat-val">{scenario.irr.toFixed(1)}%</div>
        </div>
        <div>
          <div className="ui-decision__stat-label">규제 점수</div>
          <div className="ui-decision__stat-val" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {scenario.regulatory}
            <Tag kind={scenario.regulatory >= 85 ? "pos" : "warn"}>
              {scenario.regulatory >= 85 ? "정상" : "주의"}
            </Tag>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button className="ui-btn" onClick={onCompare}>
            {Icons.diff()}비교 보기
          </button>
          <button className="ui-btn ui-btn--primary" onClick={onDetail}>
            상세 분석 →
          </button>
        </div>
      </div>
    </div>
  );
}
