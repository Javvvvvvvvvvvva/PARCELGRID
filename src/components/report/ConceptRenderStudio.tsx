"use client";

import { useEffect, useState } from "react";
import {
  CONCEPT_RENDER_ACCEPT,
  type ConceptRenderMetadata,
  type ConceptRenderQuality,
} from "@/lib/ai/concept-render";
import {
  conceptReferenceStorageKey,
  parseConceptReferenceCapture,
} from "@/lib/ai/concept-reference-cache";

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
  const [referenceGeometryHash, setReferenceGeometryHash] = useState<
    string | null
  >(null);
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
  const [quota, setQuota] = useState<{
    limit: number;
    remaining: number;
    resetAt: string;
  } | null>(null);

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
    let cancelled = false;
    const savedRender = window.localStorage.getItem(storageKey(projectId));
    if (savedRender) {
      try {
        const parsed = JSON.parse(savedRender) as unknown;
        if (isRenderMetadata(parsed)) {
          setRender(parsed);
          if (!geometryHash || parsed.geometryHash === geometryHash) {
            void loadStoredRender(parsed, "", true);
          } else {
            replaceRenderUrl(null);
            setNotice(
              "저장된 렌더는 이전 Geometry 기준입니다. 현재 대표안으로 다시 생성하세요."
            );
          }
        }
      } catch {
        window.localStorage.removeItem(storageKey(projectId));
      }
    }

    const cachedReference = parseConceptReferenceCapture(
      window.localStorage.getItem(conceptReferenceStorageKey(projectId)),
      { projectId, geometryHash }
    );
    if (cachedReference) {
      fetch(cachedReference.dataUrl)
        .then((response) => response.blob())
        .then((blob) => {
          if (cancelled) return;
          const file = new File(
            [blob],
            `parcelgrid-3d-${cachedReference.geometryHash}.jpg`,
            { type: blob.type || "image/jpeg" }
          );
          setReferenceImage(file);
          setReferenceGeometryHash(cachedReference.geometryHash);
          setReferencePreviewUrl(cachedReference.dataUrl);
          setNotice(
            "Stage 2에서 저장한 검증 대표안 3D 기준 이미지를 자동으로 불러왔습니다."
          );
        })
        .catch(() => {
          if (!cancelled) {
            setError("저장된 3D 기준 이미지를 읽지 못했습니다.");
          }
        });
    }
    return () => {
      cancelled = true;
    };
    // 프로젝트·대표 Geometry가 바뀌면 저장된 기준과 렌더를 다시 검증합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometryHash, projectId]);

  const selectReferenceImage = (file: File | null) => {
    if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    setReferenceImage(file);
    setReferenceGeometryHash(null);
    setReferencePreviewUrl(file ? URL.createObjectURL(file) : null);
    setError(null);
    setNotice(
      file
        ? "수동 업로드 이미지는 현재 Geometry와 자동 연결되지 않습니다. Stage 2의 3D 컨텍스트에서 기준 이미지를 저장하세요."
        : null
    );
  };

  const generate = async () => {
    if (!geometryHash) {
      setError("검증된 대표안 Geometry가 없어 AI 렌더를 생성할 수 없습니다.");
      return;
    }
    if (!referenceImage || referenceGeometryHash !== geometryHash) {
      setError(
        "Stage 2 3D 컨텍스트에서 현재 대표안의 AI 기준 이미지를 먼저 저장하세요."
      );
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
        | {
            render?: ConceptRenderMetadata;
            error?: string;
            quota?: { limit: number; remaining: number; resetAt: string };
          }
        | null;
      if (!response.ok || !payload?.render) {
        throw new Error(payload?.error ?? "콘셉트 렌더 생성에 실패했습니다.");
      }
      setRender(payload.render);
      setQuota(payload.quota ?? null);
      window.localStorage.setItem(
        storageKey(projectId),
        JSON.stringify(payload.render),
      );
      await loadStoredRender(payload.render, uploadKey, true);
      setNotice(
        "기준 이미지 기반 렌더를 생성했습니다. 원본과 형상이 같은지 확인한 뒤 확정하세요.",
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

  const setGeometryReview = (
    status: "confirmed" | "rejected"
  ) => {
    if (!render || !geometryHash || render.geometryHash !== geometryHash) {
      setError("현재 대표 Geometry와 일치하는 렌더만 확인할 수 있습니다.");
      return;
    }
    const next: ConceptRenderMetadata = {
      ...render,
      geometryReview: {
        status,
        reviewedAt: new Date().toISOString(),
      },
    };
    setRender(next);
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(next));
    setNotice(
      status === "confirmed"
        ? "원본과 결과의 층수·외곽선·후퇴·배치·카메라 일치를 확인했습니다."
        : "형상 불일치로 표시했습니다. 이 결과는 보고서 확정 이미지로 사용하지 마세요."
    );
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
            {render.geometryHash !== geometryHash
              ? "이전 Geometry 렌더"
              : render.geometryReview?.status === "confirmed"
                ? "형상 확인 완료"
                : render.geometryReview?.status === "rejected"
                  ? "형상 불일치"
                  : "형상 검토 전"} · {new Date(render.createdAt).toLocaleString("ko-KR")}
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
          <span>
            형상 기준 원본 · {referenceGeometryHash === geometryHash ? "현재 Geometry 연결" : "연결 안 됨"}
          </span>
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
          <span>
            외장 콘셉트 결과 · {render?.geometryReview?.status === "confirmed" ? "육안 확인 완료" : "육안 확인 필요"}
          </span>
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
          {render && renderUrl && render.geometryHash === geometryHash && (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => setGeometryReview("confirmed")}
                disabled={working}
              >
                원본과 형상 일치 확인
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setGeometryReview("rejected")}
                disabled={working}
              >
                형상 불일치
              </button>
            </>
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
      {quota && (
        <p className="concept-notice">
          오늘 남은 생성 횟수 {quota.remaining}/{quota.limit} · 초기화 {new Date(quota.resetAt).toLocaleString("ko-KR")}
        </p>
      )}
      {render && (
        <dl className="concept-audit">
          <div><dt>모델</dt><dd>{render.model} · {render.quality}</dd></div>
          <div><dt>Geometry</dt><dd>{render.geometryHash ?? "기준 이미지 단독 잠금"}</dd></div>
          <div><dt>원본 SHA-256</dt><dd>{render.sourceImageSha256.slice(0, 16)}…</dd></div>
          <div><dt>결과 SHA-256</dt><dd>{render.sha256.slice(0, 16)}…</dd></div>
          <div><dt>형상 확인</dt><dd>{render.geometryReview?.status ?? "pending"}</dd></div>
          <div><dt>API 사용량</dt><dd>{render.usage ? `${render.usage.totalTokens} tokens` : "미제공"}</dd></div>
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
