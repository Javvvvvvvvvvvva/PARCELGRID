import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "PARCELGRID · 한국 도시 타당성 분석",
  description:
    "한국 시행사·건축·투자팀을 위한 부지 분석 / 시나리오 비교 / PF·세무·리스크 / 실거래 / 보고서 워크플로우.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
