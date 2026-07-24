"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/primitives";
import {
  sourceKindRequiresDocument,
  validateFinancialSource,
  validateFinancialSourceEvidence,
  type FinancialSourceKind,
  type FinancialSourceRecord,
} from "@/lib/finance/source-data-gate";
import {
  SOURCE_DOCUMENT_ACCEPT,
  type SourceDocumentMetadata,
} from "@/lib/finance/source-document";
import { num, won } from "@/lib/utils/format";

const SOURCE_KIND_LABELS: Record<FinancialSourceKind, string> = {
  "signed-contract": "매매계약서",
  appraisal: "감정평가서",
  "official-api": "공식 API·공공 원문",
  "professional-quote": "전문가 견적",
  "lender-term-sheet": "금융기관 Term Sheet",
  "approved-policy": "승인된 내부 기준",
};

interface AcquisitionEvidencePanelProps {
  projectId: string;
  lotAreaSqm: number;
  registeredValueManwon: number;
  estimatedValueManwon?: number | null;
  marketMedianPerPyeong?: number | null;
  record?: FinancialSourceRecord;
  onSave: (record: FinancialSourceRecord) => void;
  onRemove: () => void;
}

export function AcquisitionEvidencePanel({
  projectId,
  lotAreaSqm,
  registeredValueManwon,
  estimatedValueManwon,
  marketMedianPerPyeong,
  record,
  onSave,
  onRemove,
}: AcquisitionEvidencePanelProps) {
  const [value, setValue] = useState(record ? String(record.value) : "");
  const [sourceKind, setSourceKind] = useState<FinancialSourceKind>(
    record?.sourceKind ?? "signed-contract",
  );
  const [sourceName, setSourceName] = useState(record?.sourceName ?? "");
  const [documentRef, setDocumentRef] = useState(record?.documentRef ?? "");
  const [asOf, setAsOf] = useState(
    record?.asOf ?? new Date().toISOString().slice(0, 10),
  );
  const [verifiedBy, setVerifiedBy] = useState(record?.verifiedBy ?? "");
  const [sourceDocument, setSourceDocument] =
    useState<SourceDocumentMetadata | null>(record?.document ?? null);
  const [uploadKey, setUploadKey] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setValue(record ? String(record.value) : "");
    setSourceKind(record?.sourceKind ?? "signed-contract");
    setSourceName(record?.sourceName ?? "");
    setDocumentRef(record?.documentRef ?? "");
    setAsOf(record?.asOf ?? new Date().toISOString().slice(0, 10));
    setVerifiedBy(record?.verifiedBy ?? "");
    setSourceDocument(record?.document ?? null);
  }, [record]);

  const lotPyeong = lotAreaSqm > 0 ? lotAreaSqm / 3.305785 : 0;
  const activeValue = record?.value ?? registeredValueManwon;
  const activePerPyeong = lotPyeong > 0 ? activeValue / lotPyeong : null;
  const enteredValue = Number(value);
  const enteredPerPyeong =
    Number.isFinite(enteredValue) && enteredValue > 0 && lotPyeong > 0
      ? enteredValue / lotPyeong
      : null;

  const evidenceState = useMemo(
    () => (record ? validateFinancialSourceEvidence(record) : null),
    [record],
  );

  const uploadDocument = async () => {
    if (!selectedFile) {
      setError("업로드할 원문 파일을 선택하세요.");
      return;
    }
    if (!uploadKey.trim()) {
      setError("비공개 원문 보관함 접근 키가 필요합니다.");
      return;
    }
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("field", "acquisitionPrice");
      form.set("file", selectedFile);
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/source-documents`,
        {
          method: "POST",
          headers: { "x-parcelgrid-upload-key": uploadKey },
          body: form,
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { document?: SourceDocumentMetadata; error?: string }
        | null;
      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error ?? "원문 업로드에 실패했습니다.");
      }
      setSourceDocument(payload.document);
      setDocumentRef((current) => current.trim() || payload.document!.fileName);
      setNotice(
        `원문을 연결했습니다. SHA-256 ${payload.document.sha256.slice(0, 12)}…`,
      );
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "원문 업로드에 실패했습니다.",
      );
    } finally {
      setUploading(false);
    }
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue) || nextValue <= 0) {
      setError("부동산 총 취득대금은 0보다 큰 만원 단위 값이어야 합니다.");
      return;
    }
    const nextRecord: FinancialSourceRecord = {
      field: "acquisitionPrice",
      value: nextValue,
      sourceKind,
      sourceName: sourceName.trim(),
      documentRef: documentRef.trim(),
      asOf,
      verifiedBy: verifiedBy.trim(),
      recordedAt: new Date().toISOString().slice(0, 10),
      document: sourceDocument ?? undefined,
    };
    const validation = validateFinancialSource(nextRecord);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }
    onSave(nextRecord);
    setError(null);
    setNotice(
      sourceKindRequiresDocument(sourceKind) && !sourceDocument
        ? "현재 계산값에는 반영됐지만 원문 파일이 없어 전문가 인계는 차단됩니다."
        : "입력값과 원문 근거를 현재 계산값으로 반영했습니다.",
    );
  };

  return (
    <Panel
      title="⑥ 부동산 총 취득대금·원문 근거"
      source="사용자 입력 우선 · 주변 시세는 참고값"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 1,
          border: "1px solid var(--border)",
          borderRadius: 9,
          overflow: "hidden",
          background: "var(--border)",
          marginBottom: 14,
        }}
      >
        <PriceFact
          label="현재 계산 적용값"
          value={won(activeValue, { full: true })}
          note={record ? `${record.sourceName} · ${record.asOf}` : "부지 등록값 · 원문 미연결"}
        />
        <PriceFact
          label="알고리즘 참고 추정"
          value={
            estimatedValueManwon != null
              ? won(estimatedValueManwon, { full: true })
              : "참고 추정 없음"
          }
          note="자동 입력하지 않음 · 감정평가액 아님"
        />
        <PriceFact
          label="주변시장 참고"
          value={
            marketMedianPerPyeong != null
              ? `${num(marketMedianPerPyeong)}만원/평`
              : "표본 부족"
          }
          note="수집 사례 중앙값 · 계산 적용값 아님"
        />
        <PriceFact
          label="현재 적용 평당 환산"
          value={activePerPyeong != null ? `${num(activePerPyeong)}만원/평` : "환산 불가"}
          note="총 취득대금 ÷ 대지면적"
        />
      </div>

      <form onSubmit={save} style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
          }}
        >
          <Field label="총 취득대금 (만원)">
            <input
              type="number"
              min="1"
              step="1"
              required
              value={value}
              placeholder="예: 206000"
              onChange={(event) => setValue(event.target.value)}
              style={inputStyle}
            />
            <small style={hintStyle}>
              {enteredPerPyeong != null
                ? `입력값 환산 ${num(enteredPerPyeong)}만원/평 · 저장 즉시 Stage 3에 반영`
                : "계약상 토지·기존 건물을 포함한 총 취득대금"}
            </small>
          </Field>
          <Field label="원문 유형">
            <select
              value={sourceKind}
              onChange={(event) =>
                setSourceKind(event.target.value as FinancialSourceKind)
              }
              style={inputStyle}
            >
              {(["signed-contract", "appraisal", "official-api"] as FinancialSourceKind[]).map(
                (kind) => (
                  <option key={kind} value={kind}>
                    {SOURCE_KIND_LABELS[kind]}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="발급기관·출처명">
            <input
              required
              value={sourceName}
              placeholder="예: 매도인 계약서 / ○○감정평가법인"
              onChange={(event) => setSourceName(event.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="문서번호·파일 참조">
            <input
              required
              value={documentRef}
              placeholder="예: 매매계약서 2026-07-01"
              onChange={(event) => setDocumentRef(event.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="기준일">
            <input
              type="date"
              required
              value={asOf}
              onChange={(event) => setAsOf(event.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="확인자">
            <input
              required
              value={verifiedBy}
              placeholder="확인자 이름"
              onChange={(event) => setVerifiedBy(event.target.value)}
              style={inputStyle}
            />
          </Field>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(190px, 0.75fr) minmax(220px, 1fr) auto",
            gap: 10,
            alignItems: "end",
            padding: 12,
            border: "1px solid var(--border)",
            borderRadius: 9,
            background: "var(--bg-sunken)",
          }}
        >
          <Field label="비공개 원문 보관함 접근 키">
            <input
              type="password"
              autoComplete="off"
              value={uploadKey}
              placeholder="SOURCE_DOCUMENT_UPLOAD_KEY"
              onChange={(event) => setUploadKey(event.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="원문 파일 · PDF/XLSX/XLS/CSV · 최대 4MB">
            <input
              type="file"
              accept={SOURCE_DOCUMENT_ACCEPT}
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              style={{ ...inputStyle, padding: 7 }}
            />
          </Field>
          <button
            type="button"
            className="secondary-button"
            disabled={uploading || !selectedFile}
            onClick={uploadDocument}
          >
            {uploading ? "업로드 중…" : "원문 업로드"}
          </button>
        </div>

        {sourceDocument && (
          <div
            style={{
              padding: "9px 11px",
              borderRadius: 8,
              background: "var(--pos-soft)",
              color: "var(--pos-fg)",
              fontSize: 11,
              lineHeight: 1.5,
              overflowWrap: "anywhere",
            }}
          >
            원문 연결: <b>{sourceDocument.fileName}</b> · SHA-256{" "}
            {sourceDocument.sha256.slice(0, 16)}…
          </div>
        )}

        {error && (
          <p role="alert" style={{ ...messageStyle, background: "var(--neg-soft)", color: "var(--neg-fg)" }}>
            {error}
          </p>
        )}
        {notice && (
          <p role="status" style={{ ...messageStyle, background: "var(--pos-soft)", color: "var(--pos-fg)" }}>
            {notice}
          </p>
        )}

        <div style={{ display: "flex", gap: 9, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {record && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                onRemove();
                setNotice("원문 적용값을 제거했습니다. 부지 등록값으로 돌아갑니다.");
              }}
            >
              적용값 제거
            </button>
          )}
          <button type="submit" className="primary-button">
            {record ? "총 취득대금·근거 갱신" : "현재 계산값으로 적용"}
          </button>
        </div>
      </form>

      {record && (
        <div style={{ marginTop: 12, fontSize: 11, color: evidenceState?.valid ? "var(--pos-fg)" : "var(--warn-fg)" }}>
          {evidenceState?.valid
            ? "원문 근거 확보 · Stage 3 소스 데이터에 연결됨"
            : `값은 계산에 반영됨 · ${evidenceState?.errors.join(" ")}`}
        </div>
      )}
    </Panel>
  );
}

function PriceFact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div style={{ padding: "12px 13px", background: "var(--bg-elev)", minHeight: 78 }}>
      <div style={{ fontSize: 10.5, color: "var(--fg-subtle)", marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--fg-faint)", marginTop: 4, lineHeight: 1.4 }}>
        {note}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 5, fontSize: 11, fontWeight: 650, color: "var(--fg-muted)" }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 36,
  boxSizing: "border-box",
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--bg-elev)",
  color: "var(--fg)",
  padding: "0 9px",
  font: "inherit",
  fontSize: 11.5,
};

const hintStyle: React.CSSProperties = {
  color: "var(--fg-faint)",
  fontSize: 10,
  fontWeight: 400,
  lineHeight: 1.45,
};

const messageStyle: React.CSSProperties = {
  margin: 0,
  padding: "9px 11px",
  borderRadius: 8,
  fontSize: 11,
  lineHeight: 1.5,
};
