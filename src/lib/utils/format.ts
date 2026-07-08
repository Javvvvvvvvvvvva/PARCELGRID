/**
 * Korean real estate display formatters.
 *
 * All internal monetary values are in 만원. Display layer converts to
 * the convention an analyst would write by hand:
 *   1,234,000 만원 → "12.3억"
 *   34,500 만원   → "3.45억"
 *   8,200 만원    → "8,200만"
 *
 * Note: kor-style "억/만" mixing. We never use raw 원 for amounts > 10만원.
 */

export function won(manwon: number, opts: { full?: boolean; sign?: boolean } = {}): string {
  const { full = false, sign = false } = opts;
  const prefix = sign && manwon > 0 ? "+" : "";

  if (Math.abs(manwon) >= 10_000) {
    const eok = manwon / 10_000;
    if (full) {
      const formatted = eok.toLocaleString("ko-KR", {
        maximumFractionDigits: 2,
      });
      return `${prefix}${formatted}억`;
    }
    return `${prefix}${eok.toFixed(1)}억`;
  }

  return `${prefix}${manwon.toLocaleString("ko-KR")}만`;
}

export function pct(value: number, decimals = 1): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(decimals)}%`;
}

export function num(n: number, decimals = 0): string {
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function area(sqm: number): string {
  return `${sqm.toLocaleString("ko-KR")} m²`;
}

export function pyeong(sqm: number): string {
  return `${(sqm * 0.3025).toFixed(1)} 평`;
}

/** Format a 거래일 ISO string as 2024.11.08 */
export function koreanDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 시나리오 사업성 판정 — 손실(profit<0)이거나 viable=false면 부적합.
 * 세 화면(보고서·비교·대시보드)이 공유해 판정이 갈리지 않게 한다.
 */
export function scenarioViable(s: { profit: number; viable?: boolean }): {
  ok: boolean;
  label: string;
} {
  if (s.viable === false) return { ok: false, label: "분양면적 부족" };
  if (s.profit < 0) return { ok: false, label: "사업성 부족" };
  return { ok: true, label: "" };
}
