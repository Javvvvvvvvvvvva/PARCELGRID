"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import AcquisitionPriceInput from "@/components/AcquisitionPriceInput";
import type { StoredParcel } from "@/lib/hooks/use-dynamic-project";
import { sqmToPyeong, type RawTransaction } from "@/lib/priceDistribution";

const responseSchema = z.object({ transactions: z.array(z.object({
  priceManwon: z.number().finite().positive(),
  areaSqm: z.number().finite().positive(),
  date: z.string().optional(), address: z.string().optional(),
})) });

/** Mounted only after the user asks for nearby transaction references. */
export default function AcquisitionMarketReference({ stored, value, onChange }: {
  stored: StoredParcel; value: number | null; onChange: (won: number | null) => void;
}) {
  const [rows, setRows] = useState<RawTransaction[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setRows(null);
    void (async () => {
      try {
        const response = await fetch("/api/parcels/estimate-price", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ address: stored.address, lotArea: stored.lotArea, landPrice: stored.landPrice,
            lawdCd: stored.lawdCd, jimokCategory: stored.jimokCategory }),
        });
        if (!response.ok) throw new Error("거래 참고자료를 불러오지 못했습니다.");
        const body = responseSchema.parse(await response.json());
        if (!controller.signal.aborted) setRows(body.transactions.map(row => ({
          amount: row.priceManwon * 10_000, areaSqm: row.areaSqm, date: row.date, label: row.address,
        })));
      } catch {
        if (!controller.signal.aborted) setError("거래 참고자료를 불러오지 못했습니다. 취득대금은 직접 입력할 수 있어요.");
      }
    })();
    return () => controller.abort();
  }, [stored.address, stored.lotArea, stored.landPrice, stored.lawdCd, stored.jimokCategory, attempt]);
  return <section className="site-market-reference" aria-label="주변 토지 거래 참고">
    <p className="site-muted">같은 시군구·지목 분류의 최근 토지 거래예요. 기존 건물 가치나 개별 입지 차이를 보정한 감정평가가 아니며, 취득대금을 자동 입력하지 않습니다.</p>
    {error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>거래 조회 다시 시도</button></div>
      : rows === null ? <p role="status">주변 거래를 조회하고 있어요…</p>
      : <><p className="site-muted">{rows.length ? `${rows.length}건 수신 · 분포는 극단값을 제외해 표시합니다.` : "표시할 거래가 없습니다. 자료 없음과 조회 실패를 구분할 수 없으므로 시세로 해석하지 마세요."}</p>
        <AcquisitionPriceInput subjectAreaPyeong={sqmToPyeong(stored.lotArea)} transactions={rows} value={value} onChange={onChange} chartHeight={180} />
      </>}
  </section>;
}
