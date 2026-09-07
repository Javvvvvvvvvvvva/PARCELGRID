"use client";

import { useState, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { Button, Panel } from "@/components/ui/primitives";
import {
  boundaryAreaDifferencePct,
  boundaryCenterDistanceM,
  parseManualParcelBoundaryGeoJson,
  type ParsedManualParcelBoundary,
} from "@/lib/geo/manual-parcel-boundary";
import type {
  ParcelLookupComplete,
  ParcelLookupManualRequired,
} from "@/lib/parcels/lookup-contract";
import {
  createRegulatoryReferenceSet,
  replaceConstraintEvidence,
} from "@/lib/regulatory/constraints";

interface ManualParcelIntakeProps {
  lookup: ParcelLookupManualRequired;
  onApply: (parcel: ParcelLookupComplete) => void;
}

const MAX_GEOJSON_BYTES = 5 * 1024 * 1024;

function numeric(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jimokCategory(
  jimok: string,
): ParcelLookupComplete["jimokCategory"] {
  if (jimok === "대" || jimok === "잡종지") return "buildable";
  if (jimok === "전" || jimok === "답" || jimok === "과수원") {
    return "farmland";
  }
  if (jimok === "임야") return "forest";
  return "other";
}

export default function ManualParcelIntake({
  lookup,
  onApply,
}: ManualParcelIntakeProps) {
  const [lotArea, setLotArea] = useState("");
  const [zoning, setZoning] = useState("");
  const [maxFAR, setMaxFAR] = useState("");
  const [maxBCR, setMaxBCR] = useState("");
  const [heightLimit, setHeightLimit] = useState("");
  const [jimok, setJimok] = useState("대");
  const [landPrice, setLandPrice] = useState("");
  const [landPriceYear, setLandPriceYear] = useState(
    String(new Date().getFullYear()),
  );
  const [boundary, setBoundary] =
    useState<ParsedManualParcelBoundary | null>(null);
  const [boundaryFileName, setBoundaryFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const officialArea = numeric(lotArea);
  const areaDifference = boundary
    ? boundaryAreaDifferencePct(officialArea ?? 0, boundary.measuredAreaSqm)
    : null;
  const centerDistance = boundary
    ? boundaryCenterDistanceM(
        { lat: lookup.lat, lng: lookup.lng },
        boundary.center,
      )
    : null;

  const loadBoundary = async (file: File | null) => {
    setError(null);
    setBoundary(null);
    setBoundaryFileName(null);
    if (!file) return;
    if (file.size > MAX_GEOJSON_BYTES) {
      setError("필지 GeoJSON은 5MB 이하여야 합니다.");
      return;
    }
    try {
      const parsed = parseManualParcelBoundaryGeoJson(await file.text());
      setBoundary(parsed);
      setBoundaryFileName(file.name);
      if (!lotArea.trim()) setLotArea(parsed.measuredAreaSqm.toFixed(2));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "필지 GeoJSON을 읽을 수 없습니다.",
      );
    }
  };

  const apply = () => {
    setError(null);
    const area = numeric(lotArea);
    const far = numeric(maxFAR);
    const bcr = numeric(maxBCR);
    const height = numeric(heightLimit);
    const price = numeric(landPrice);
    const priceYear = landPriceYear.trim();

    if (!area || area <= 0 || area > 100_000_000) {
      setError("공부상 대지면적을 ㎡ 단위의 양수로 입력하세요.");
      return;
    }
    if (!zoning.trim()) {
      setError("확인 중인 용도지역 명칭을 입력하세요.");
      return;
    }
    if (!far || far <= 0 || far > 10_000) {
      setError("용적률 입력값은 0% 초과 10,000% 이하여야 합니다.");
      return;
    }
    if (!bcr || bcr <= 0 || bcr > 100) {
      setError("건폐율 입력값은 0% 초과 100% 이하여야 합니다.");
      return;
    }
    if (height != null && (height < 0 || height > 10_000)) {
      setError("높이 입력값은 0m 이상 10,000m 이하여야 합니다.");
      return;
    }
    if (price != null && (price < 0 || price > 1_000_000_000_000)) {
      setError("공시지가 입력값을 확인하세요.");
      return;
    }
    if (
      price != null &&
      price > 0 &&
      (!/^\d{4}$/.test(priceYear) ||
        Number(priceYear) < 1900 ||
        Number(priceYear) > new Date().getFullYear() + 1)
    ) {
      setError("공시지가 기준연도를 네 자리 연도로 입력하세요.");
      return;
    }
    if (areaDifference != null && areaDifference > 10) {
      setError(
        `GeoJSON 계산면적과 공부상 면적 차이가 ${areaDifference.toFixed(1)}%입니다. 대상 필지 파일과 면적을 다시 확인하세요.`,
      );
      return;
    }
    if (centerDistance != null && centerDistance > 500) {
      setError(
        `GeoJSON 중심이 조회 주소에서 ${Math.round(centerDistance).toLocaleString("ko-KR")}m 떨어져 있습니다. 대상 필지 파일을 다시 확인하세요.`,
      );
      return;
    }

    const recordedAt = new Date().toISOString();
    const referenceSet = createRegulatoryReferenceSet({ retrievedAt: recordedAt });
    const manualSource = "사용자 수동 입력 · 원문 확인 전";
    const regulatoryConstraints = {
      ...referenceSet,
      zoningSource: {
        status: "unknown" as const,
        sourceName: manualSource,
        retrievedAt: recordedAt,
        note: "VWorld 비활성 상태에서 입력한 명칭입니다. 토지이용계획확인서 원문 대조가 필요합니다.",
      },
      far: replaceConstraintEvidence(referenceSet.far, {
        value: far,
        status: "user-entered",
        sourceName: manualSource,
        note: "관할 조례·지구단위계획 원문 확인 전 사용자 입력값입니다.",
      }),
      bcr: replaceConstraintEvidence(referenceSet.bcr, {
        value: bcr,
        status: "user-entered",
        sourceName: manualSource,
        note: "관할 조례·지구단위계획 원문 확인 전 사용자 입력값입니다.",
      }),
      height:
        height != null && height > 0
          ? replaceConstraintEvidence(referenceSet.height, {
              value: height,
              status: "user-entered",
              sourceName: manualSource,
              note: "가로구역·고도지구·일조 규정 원문 확인 전 사용자 입력값입니다.",
            })
          : referenceSet.height,
    };

    onApply({
      ...lookup,
      mode: "manual",
      lotArea: area,
      boundary: boundary?.boundary,
      roads: [],
      jimok,
      jimokCode: "",
      jimokCategory: jimokCategory(jimok),
      landPrice: price ?? 0,
      landPriceYear: price != null && price > 0 ? priceYear : "",
      zoning: zoning.trim(),
      zoneCode: "MANUAL",
      maxFAR: far,
      maxBCR: bcr,
      heightLimit: height ?? 0,
      regulatoryConstraints,
      overlays: [],
      inputProvenance: {
        mode: "manual",
        parcelFacts: "user-entered",
        geometry: boundary ? "user-geojson" : "unavailable",
        zoning: "user-entered",
        recordedAt,
        note: lookup.reason.message,
      },
    });
  };

  return (
    <div style={{ marginTop: "var(--s5)" }}>
      <Panel title="VWorld 없이 토지 정보 등록" source="Kakao · MOLIT · 사용자 입력">
        <div className="manual-alert" role="status">
          <strong>{lookup.reason.message}</strong>
          <span>
            사용자 입력값은 원문 확인 전 상태로 저장됩니다. 필지 경계가 없으면
            현황·사업성 예비 검토는 가능하지만 대표 Geometry 확정과 내보내기는
            제한됩니다.
          </span>
        </div>

        <div className="manual-fields">
          <Field label="공부상 대지면적" required>
            <div className="field-with-unit">
              <input
                value={lotArea}
                onChange={(event) => setLotArea(event.target.value)}
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
              />
              <span>㎡</span>
            </div>
          </Field>
          <Field label="용도지역" required>
            <input
              value={zoning}
              onChange={(event) => setZoning(event.target.value)}
              placeholder="예: 제2종일반주거지역"
            />
          </Field>
          <Field label="용적률 검토값" required>
            <div className="field-with-unit">
              <input
                value={maxFAR}
                onChange={(event) => setMaxFAR(event.target.value)}
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </Field>
          <Field label="건폐율 검토값" required>
            <div className="field-with-unit">
              <input
                value={maxBCR}
                onChange={(event) => setMaxBCR(event.target.value)}
                type="number"
                min="0"
                max="100"
                step="0.1"
                inputMode="decimal"
              />
              <span>%</span>
            </div>
          </Field>
          <Field label="높이 검토값">
            <div className="field-with-unit">
              <input
                value={heightLimit}
                onChange={(event) => setHeightLimit(event.target.value)}
                type="number"
                min="0"
                step="0.1"
                inputMode="decimal"
                placeholder="미확인"
              />
              <span>m</span>
            </div>
          </Field>
          <Field label="지목">
            <select value={jimok} onChange={(event) => setJimok(event.target.value)}>
              <option value="대">대</option>
              <option value="잡종지">잡종지</option>
              <option value="전">전</option>
              <option value="답">답</option>
              <option value="과수원">과수원</option>
              <option value="임야">임야</option>
              <option value="기타">기타</option>
            </select>
          </Field>
          <Field label="개별공시지가">
            <div className="field-with-unit">
              <input
                value={landPrice}
                onChange={(event) => setLandPrice(event.target.value)}
                type="number"
                min="0"
                step="1000"
                inputMode="numeric"
                placeholder="미확인"
              />
              <span>원/㎡</span>
            </div>
          </Field>
          <Field label="공시지가 기준연도">
            <input
              value={landPriceYear}
              onChange={(event) => setLandPriceYear(event.target.value)}
              inputMode="numeric"
              maxLength={4}
            />
          </Field>
        </div>

        <div className="boundary-row">
          <div>
            <strong>필지 경계 GeoJSON</strong>
            <span>
              WGS84 Polygon 한 개를 연결하면 Stage 2 형상 검토를 이어갈 수 있습니다.
            </span>
          </div>
          <label className="file-button">
            <FileUp size={15} aria-hidden="true" />
            <span>{boundaryFileName ?? "GeoJSON 선택"}</span>
            <input
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              onChange={(event) => void loadBoundary(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {boundary && (
          <p className={areaDifference != null && areaDifference > 3 ? "area-note warn" : "area-note"}>
            계산면적 {boundary.measuredAreaSqm.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}㎡
            {areaDifference != null
              ? ` · 공부상 면적과 ${areaDifference.toFixed(1)}% 차이`
              : ""}
            {centerDistance != null
              ? ` · 주소 좌표와 ${Math.round(centerDistance)}m`
              : ""}
          </p>
        )}
        {error && <p className="manual-error">{error}</p>}

        <div className="manual-actions">
          <Button type="button" variant="primary" onClick={apply}>
            수동 토지 정보 적용
          </Button>
        </div>
      </Panel>

      <style jsx>{`
        .manual-alert{display:grid;gap:4px;padding:11px 12px;border-left:3px solid var(--warn);background:var(--warn-soft);color:var(--warn-fg);font-size:11px;line-height:1.55}.manual-alert span{color:var(--fg-muted)}
        .manual-fields{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:16px}.field-with-unit{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:7px}.field-with-unit>span{font-size:10px;color:var(--fg-muted);white-space:nowrap}input,select{width:100%;height:36px;box-sizing:border-box;padding:0 9px;border:1px solid var(--border);border-radius:6px;background:var(--bg-elev);color:var(--fg);font:inherit;font-size:12px}
        .boundary-row{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)}.boundary-row>div{display:grid;gap:3px}.boundary-row strong{font-size:12px}.boundary-row span{font-size:10.5px;color:var(--fg-muted);line-height:1.5}.file-button{min-height:36px;max-width:260px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 11px;border:1px solid var(--border-strong);border-radius:6px;cursor:pointer;overflow:hidden}.file-button>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)}.file-button input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
        .area-note,.manual-error{margin:10px 0 0;padding:8px 10px;font-size:10.5px;line-height:1.5}.area-note{background:var(--pos-soft);color:var(--pos-fg)}.area-note.warn{background:var(--warn-soft);color:var(--warn-fg)}.manual-error{background:var(--neg-soft);color:var(--neg-fg)}.manual-actions{display:flex;justify-content:flex-end;margin-top:14px}
        @media(max-width:900px){.manual-fields{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:620px){.manual-fields{grid-template-columns:1fr}.boundary-row{align-items:stretch;flex-direction:column}.file-button{max-width:none;min-height:44px}.manual-actions button{width:100%;min-height:44px}}
      `}</style>
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-muted)" }}>
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
