import Link from "next/link";

export default async function CompsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <>
      <div style={{ margin: "18px 20px 0", padding: "13px 15px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
        <div>
          <strong style={{ display: "block", fontSize: 12 }}>실거래를 확인한 다음 검토 가격을 확정하세요</strong>
          <span style={{ display: "block", marginTop: 3, color: "var(--fg-muted)", fontSize: 9.5 }}>비교 사례 선택·보정 사유·검토자를 기록해야 Stage 3에 검증값으로 반영됩니다.</span>
        </div>
        <Link href={`/projects/${projectId}/price-review`} style={{ display: "inline-flex", alignItems: "center", minHeight: 34, padding: "0 13px", border: "1px solid var(--fg)", borderRadius: 8, background: "var(--fg)", color: "var(--bg)", textDecoration: "none", fontSize: 10.5, fontWeight: 800, whiteSpace: "nowrap" }}>
          가격 검증 시작
        </Link>
      </div>
      {children}
    </>
  );
}
