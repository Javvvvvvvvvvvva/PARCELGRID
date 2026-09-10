"use client";

import { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { safeEvidenceUrl } from "./presentation";

export interface EvidenceItem {
  title: string;
  value: string;
  status: string;
  note: string;
  rows: Array<{ label: string; value: string; url?: string }>;
  href: string;
  action: string;
}
export function EvidenceSheet({ item, onClose }: { item: EvidenceItem | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (item && element && !element.open) element.showModal();
    if (!item && element?.open) element.close();
  }, [item]);
  return <dialog ref={dialog} className="pg-evidence" aria-labelledby={titleId} onClose={onClose}>
    {item && <><header><div><p>원본과 확인 범위</p><h2 id={titleId}>{item.title}</h2></div><button type="button" aria-label="근거 패널 닫기" onClick={() => dialog.current?.close()}>×</button></header>
      <div className="pg-evidence-body"><p className="pg-evidence-status">{item.status}</p><strong className="pg-evidence-value">{item.value}</strong><p>{item.note}</p>
        <dl>{item.rows.map((row, i) => {
          const url = safeEvidenceUrl(row.url);
          return <div key={`${row.label}-${i}`}><dt>{row.label}</dt><dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{row.value} ↗</a> : row.value}</dd></div>;
        })}</dl><Link className="pg-button pg-button-solid" href={item.href} onClick={() => dialog.current?.close()}>{item.action} →</Link>
      </div></>}
  </dialog>;
}
