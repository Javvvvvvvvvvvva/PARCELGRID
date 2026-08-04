"use client";

import { useEffect, useState } from "react";
import {
  CONCEPT_RENDER_ACCEPT,
  type ConceptRenderMetadata,
  type ConceptRenderQuality,
} from "@/lib/ai/concept-render";

interface ConceptRenderStudioProps {
  projectId: string;
  geometryHash?: string | null;
  defaultPrompt: string;
}

function storageKey(projectId: string): string {
  return `parcelgrid-concept-render:${projectId}`;
}

function isRenderMetadata(value: unknown): value is ConceptRenderMetadata {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ConceptRenderMetadata>;
  return Boolean(
    item.pathname &&
      item.fileName &&
      item.sha256 &&
      item.sourceImageSha256 &&
      item.createdAt &&
      item.model,
  );
}

export default function ConceptRenderStudio({
  projectId,
  geometryHash,
  defaultPrompt,
}: ConceptRenderStudioProps) {
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState<string | null>(
    null,
  );
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [quality, setQuality] = useState<ConceptRenderQuality>("medium");
  const [uploadKey, setUploadKey] = useState("");
  const [render, setRender] = useState<ConceptRenderMetadata | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/concept-render`;

  const replaceRenderUrl = (next: string | null) => {
    setRenderUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return next;
    });
  };

  const loadStoredRender = async (
    metadata: ConceptRenderMetadata,
    key: string,
    quiet = false,
  ) => {
    try {
      const query = new URLSearchParams({ pathname: metadata.pathname });
      const response = await fetch(`${endpoint}?${query}`, {
        headers: key.trim()
          ? { "x-parcelgrid-upload-key": key.trim() }
          : undefined,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "저장된 렌더를 불러올 수 없습니다.");
      }
      replaceRenderUrl(URL.createObjectURL(await response.blob()));
      if (!quiet) setNotice("저장된 콘셉트 렌더를 불러왔습니다.");
    } catch (loadError) {
      if (!quiet) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "저장된 렌더를 불러올 수 없습니다.",
        );
      }
    }
  };

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey(projectId));
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as unknown;
      if (!isRenderMetadata(parsed)) return;
      setRender(parsed);
      void loadStoredRender(parsed, "", true);
    } catch {
      window.localStorage.removeItem(storageKey(projectId));
    }
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
      if (renderUrl) URL.revokeObjectURL(renderUrl);
    };
    // 저장 프로젝트가 바뀔 때만 초기 메타데이터를 읽습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const selectReferenceImage = (file: File | null) => {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceImage(file);
    setReferencePreviewUrl(file ? URL.createObjectURL(file) : null);
    setError(null);
    setNotice(null);
  };

  const generate = async () => {
    if (!referenceImage) {
      setError("형상 보존용 PARCELGRID 기준 이미지를 선택하세요.");
      return;
    }
    if (!prompt.trim()) {
      setError("외장 디자인 프롬프트가 필요합니다.");
      return;
    }
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set("referenceImage", referenceImage);
      form.set("prompt", prompt);
      form.set("quality", quality);
      if (geometryHash) form.set("geometryHash", geometryHash);

      const response = await fetch(endpoint, {
        method: "POST",
        headers: uploadKey.trim()
          ? { "x-parcelgrid-upload-key": uploadKey.trim() }
          : undefined,
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as
        | { render?: ConceptRenderMetadata; error?: string }
        | null;
      if (!response.ok || !payload?.render) {
        throw new Error(payload?.error ?? "콘셉트 렌더 생성에 실패했습니다.");
      }
      setRender(payload.render);
      window.localStorage.setItem(
        storageKey(projectId),
        JSON.stringify(payload.render),
      );
      await loadStoredRender(payload.render, uploadKey, true);
      setNotice(
        "기준 이미지 기반 렌더를 생성하고 로컬 비공개 저장소에 보관했습니다.",
      );
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "콘셉트 렌더 생성에 실패했습니다.",
      );
    } finally {
      setWorking(false);
    }
  };

  const download = async () => {
    if (!render) return;
    setError(null);
    try {
      const query = new URLSearchParams({ pathname: render.pathname });
      const response = await fetch(`${endpoint}?${query}`, {
        headers: uploadKey.trim()
          ? { "x-parcelgrid-upload-key": uploadKey.trim() }
          : undefined,
      });
      if (!response.ok) throw new Error("렌더 파일을 불러올 수 없습니다.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = render.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    } catch (downloadError) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "렌더 파일을 내려받을 수 없습니다.",
      );
    }
  };

  return (
    <section className="concept-studio" aria-labelledby="concept-render-title">
      <div className="concept-heading">
        <div>
          <span className="concept-kicker">AI CONCEPT RENDER</span>
          <h2 id="concept-render-title">기준 이미지 기반 외장 콘셉트</h2>
          <p>
            기준 이미지의 매스·층수·후퇴·대지 배치·도로 관계·카메라를
            잠그고 외장 표현만 편집합니다.
          </p>
        </div>
        {render && (
          <span className="concept-status">
            저장됨 · {new Date(render.createdAt).toLocaleString("ko-KR")}
          </span>
        )}
      </div>

      <div className="concept-grid">
        <div className="concept-reference">
          {referencePreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={referencePreviewUrl} alt="선택한 PARCELGRID 기준 이미지" />
          ) : (
            <div className="concept-placeholder">
              PARCELGRID 3D 기준 이미지를 선택하면 미리보기가 표시됩니다.
            </div>
          )}
          <span>형상 기준 원본</span>
        </div>
        <div className="concept-output">
          {renderUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={renderUrl} alt="AI가 생성한 건축 외장 콘셉트 렌더" />
          ) : (
            <div className="concept-placeholder">
              생성 결과는 보고서와 함께 인쇄되며 원본 해시를 보존합니다.
            </div>
          )}
          <span>외장 콘셉트 결과</span>
        </div>
      </div>

      <div className="concept-controls">
        <label>
          <span>기준 이미지 · 필수</span>
          <input
            type="file"
            accept={CONCEPT_RENDER_ACCEPT}
            onChange={(event) =>
              selectReferenceImage(event.target.files?.[0] ?? null)
            }
          />
        </label>
        <label>
          <span>생성 품질</span>
          <select
            value={quality}
            onChange={(event) =>
              setQuality(event.target.value as ConceptRenderQuality)
            }
          >
            <option value="low">Low · 빠른 검토</option>
            <option value="medium">Medium · 기본</option>
            <option value="high">High · 최종 콘셉트</option>
          </select>
        </label>
        <label>
          <span>로컬 보관함 접근 키 · 공유 서버만</span>
          <input
            type="password"
            value={uploadKey}
            onChange={(event) => setUploadKey(event.target.value)}
            autoComplete="off"
            placeholder="로컬 개발에서는 비워 둠"
          />
        </label>
        <label className="concept-prompt">
          <span>외장 디자인 지시</span>
          <textarea
            rows={5}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="concept-actions">
          <button type="button" onClick={generate} disabled={working}>
            {working ? "기준 형상 보존 렌더 생성 중…" : "AI 콘셉트 렌더 생성"}
          </button>
          {render && !renderUrl && (
            <button
              type="button"
              className="secondary"
              onClick={() => loadStoredRender(render, uploadKey)}
              disabled={working}
            >
              저장 렌더 불러오기
            </button>
          )}
          {render && (
            <button
              type="button"
              className="secondary"
              onClick={download}
              disabled={working}
            >
              PNG 다운로드
            </button>
          )}
        </div>
      </div>

      {error && <p className="concept-error">{error}</p>}
      {notice && <p className="concept-notice">{notice}</p>}
      {render && (
        <dl className="concept-audit">
          <div><dt>모델</dt><dd>{render.model} · {render.quality}</dd></div>
          <div><dt>Geometry</dt><dd>{render.geometryHash ?? "기준 이미지 단독 잠금"}</dd></div>
          <div><dt>원본 SHA-256</dt><dd>{render.sourceImageSha256.slice(0, 16)}…</dd></div>
          <div><dt>결과 SHA-256</dt><dd>{render.sha256.slice(0, 16)}…</dd></div>
        </dl>
      )}

      <p className="concept-disclaimer">
        AI 콘셉트 시각화이며 건축설계도서·인허가도면·시공도·감정평가 또는
        공사비 견적서가 아닙니다. 생성 결과는 원본과 육안 대조해야 합니다.
      </p>

      <style jsx>{`
        .concept-studio{margin:24px 0;padding:18px;border:1px solid var(--border);border-radius:10px;background:var(--bg-elev)}
        .concept-heading{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:14px}.concept-heading h2{margin:5px 0 4px;font-size:17px}.concept-heading p{margin:0;max-width:660px;color:var(--fg-muted);font-size:11px;line-height:1.55}.concept-kicker{font-size:9px;letter-spacing:.14em;color:var(--accent);font-weight:800}.concept-status{font-size:9.5px;color:var(--pos-fg);font-weight:700;white-space:nowrap}
        .concept-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.concept-reference,.concept-output{display:grid;gap:5px}.concept-reference>span,.concept-output>span{font-size:9px;color:var(--fg-muted)}img{width:100%;aspect-ratio:3/2;object-fit:contain;border:1px solid var(--border-faint);border-radius:8px;background:#f4f5f6}.concept-placeholder{display:grid;place-items:center;aspect-ratio:3/2;padding:20px;border:1px dashed var(--border);border-radius:8px;background:var(--bg-soft);color:var(--fg-muted);font-size:10px;text-align:center;line-height:1.55}
        .concept-controls{display:grid;grid-template-columns:1.1fr .7fr 1.2fr;gap:10px;margin-top:14px}.concept-controls label{display:grid;gap:5px}.concept-controls label>span{font-size:9.5px;font-weight:700;color:var(--fg-muted)}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--fg);padding:8px;font:inherit;font-size:10px}.concept-prompt{grid-column:1/-1}.concept-actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.concept-actions button{min-height:34px;padding:0 12px;border:1px solid var(--fg);border-radius:7px;background:var(--fg);color:var(--bg);font:inherit;font-size:10px;font-weight:800;cursor:pointer}.concept-actions button.secondary{background:var(--bg-elev);color:var(--fg);border-color:var(--border)}.concept-actions button:disabled{opacity:.55;cursor:wait}
        .concept-error,.concept-notice{margin:10px 0 0;padding:8px 10px;border-radius:7px;font-size:10px;line-height:1.5}.concept-error{background:var(--neg-soft);color:var(--neg-fg)}.concept-notice{background:var(--pos-soft);color:var(--pos-fg)}.concept-audit{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0 0}.concept-audit div{min-width:0;padding:8px;background:var(--bg-soft);border-radius:6px}.concept-audit dt{font-size:8.5px;color:var(--fg-muted)}.concept-audit dd{margin:3px 0 0;font-size:9px;font-family:var(--font-mono);overflow-wrap:anywhere}.concept-disclaimer{margin:12px 0 0;color:var(--fg-muted);font-size:9px;line-height:1.5}
        @media(max-width:760px){.concept-grid,.concept-controls{grid-template-columns:1fr}.concept-prompt,.concept-actions{grid-column:1}.concept-audit{grid-template-columns:repeat(2,minmax(0,1fr))}.concept-heading{display:grid}}
        @media print{.concept-controls,.concept-error,.concept-notice{display:none}.concept-studio{break-inside:avoid}.concept-grid{grid-template-columns:1fr 1fr}}
      `}</style>
    </section>
  );
}
