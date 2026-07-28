export type EvidenceStatus =
  | "system-confirmed"
  | "expert-review"
  | "missing";

export type HandoffDiscipline =
  | "architect"
  | "developer"
  | "finance-tax"
  | "sales-marketing";

export interface EvidenceGateInput {
  projectId: string;
  address: string;
  geometryHash?: string | null;
  roadReferenceCount: number;
  regulatorySourceBacked?: boolean;
  saleCompCount: number;
  saleEstimateVersion?: string | null;
  acquisitionEstimateVersion?: string | null;
  financeModelVersion?: string | null;
  taxComplete: boolean;
  hasConstructionQuote?: boolean;
  hasTermSheet?: boolean;
  hasExternalPriceOpinion?: boolean;
}

export interface EvidenceItem {
  id: string;
  label: string;
  status: EvidenceStatus;
  critical: boolean;
  source: string;
  nextAction: string;
}

export interface EvidenceLane {
  discipline: HandoffDiscipline;
  title: string;
  owner: string;
  description: string;
  items: EvidenceItem[];
}

export interface EvidenceGate {
  projectId: string;
  address: string;
  status: "blocked" | "expert-review" | "ready";
  confirmedCount: number;
  reviewCount: number;
  missingCount: number;
  criticalBlockerCount: number;
  lanes: EvidenceLane[];
}

function sourceStatus(
  available: boolean,
  reviewSource: string,
  missingSource: string
): Pick<EvidenceItem, "status" | "source"> {
  return available
    ? { status: "expert-review", source: reviewSource }
    : { status: "missing", source: missingSource };
}

/**
 * Stage 4 evidence gate.
 *
 * "system-confirmed" only means the application can reproduce the referenced
 * snapshot or calculation version. Observed data and internal estimates remain
 * "expert-review" until a responsible professional accepts the evidence.
 */
export function buildEvidenceGate(input: EvidenceGateInput): EvidenceGate {
  const geometryReady = Boolean(input.geometryHash);
  const roadReferenceReady = input.roadReferenceCount > 0;
  const saleEvidenceReady = input.saleCompCount > 0;
  const acquisitionEvidenceReady = Boolean(input.acquisitionEstimateVersion);
  const financeLedgerReady = Boolean(input.financeModelVersion);

  const lanes: EvidenceLane[] = [
    {
      discipline: "architect",
      title: "건축가",
      owner: "매스·법규·도면",
      description:
        "대표 매스와 대지·도로·일조·주차 조건을 실시설계 전 기준으로 검토합니다.",
      items: [
        {
          id: "geometry-snapshot",
          label: "대표 Geometry Snapshot",
          status: geometryReady ? "system-confirmed" : "missing",
          critical: true,
          source: geometryReady
            ? `Geometry hash ${input.geometryHash}`
            : "대표 계획안 Geometry Snapshot 없음",
          nextAction: geometryReady
            ? "건축가가 배치·층별 프로그램과 원본 좌표를 대조"
            : "Stage 2에서 대표 계획안을 다시 확정",
        },
        {
          id: "regulatory-source",
          label: "건폐율·용적률·높이 원문",
          status: input.regulatorySourceBacked ? "expert-review" : "missing",
          critical: true,
          source: input.regulatorySourceBacked
            ? "원문 번호·기준일·확인자와 함께 등록된 규제 수치"
            : "VWorld 용도지역과 전국 상한 참고만 있음",
          nextAction: input.regulatorySourceBacked
            ? "건축사가 적용 조례·지구단위계획·높이 지정과 최신성을 재확인"
            : "Stage 2 법규 원장에 적용 조례·고시 원문과 수치를 기록",
        },
        {
          id: "road-boundary",
          label: "도로·접도·후퇴 기준",
          critical: true,
          ...sourceStatus(
            roadReferenceReady,
            `도로 참고선 ${input.roadReferenceCount}개 · 현장측량 아님`,
            "도로 참고선 없음"
          ),
          nextAction:
            "건축사가 지적도·도로대장·현황측량으로 경계와 유효 도로폭을 확인",
        },
        {
          id: "sunlight-parking",
          label: "정북일조·주차 배치",
          status: geometryReady ? "expert-review" : "missing",
          critical: true,
          source: geometryReady
            ? "계획 스튜디오 자동 검토 결과"
            : "검토할 대표 매스 없음",
          nextAction:
            "건축사가 적용 조문, 완화 여부, 실제 주차 동선을 도면 기준으로 확인",
        },
      ],
    },
    {
      discipline: "developer",
      title: "시행사",
      owner: "토지·원가·일정",
      description:
        "토지 검토가, 공사비와 사업 일정을 실제 계약 가능 조건으로 치환합니다.",
      items: [
        {
          id: "land-price",
          label: "토지 가격 외부 의견",
          critical: true,
          ...(input.hasExternalPriceOpinion
            ? {
                status: "expert-review" as const,
                source: "사용자 등록 외부 가격 의견",
              }
            : sourceStatus(
                acquisitionEvidenceReady,
                `${input.acquisitionEstimateVersion} · 자체 참고 추정`,
                "토지 가격 근거 없음"
              )),
          nextAction:
            "중개사 의견·감정평가·매도인 조건을 첨부하고 검토 매입가를 확정",
        },
        {
          id: "construction-quote",
          label: "시공사 견적",
          status: input.hasConstructionQuote ? "expert-review" : "missing",
          critical: true,
          source: input.hasConstructionQuote
            ? "사용자 등록 견적"
            : "현재 공사비는 내부 가정값",
          nextAction:
            "연면적·구조·마감·철거 범위를 맞춘 시공사 견적 또는 QS 내역을 첨부",
        },
        {
          id: "delivery-schedule",
          label: "인허가·공사·매각 일정",
          status: geometryReady ? "expert-review" : "missing",
          critical: false,
          source: geometryReady ? "Stage 3 사용자 일정 가정" : "일정 기준 없음",
          nextAction:
            "인허가 협의와 시공사 공정표로 월별 기간 가정을 갱신",
        },
      ],
    },
    {
      discipline: "finance-tax",
      title: "금융·회계·세무",
      owner: "PF·현금흐름·세금",
      description:
        "동일 원장으로 계산된 손익을 실제 대출 조건과 세무 사실관계로 대사합니다.",
      items: [
        {
          id: "finance-ledger",
          label: "통합 금융 원장",
          status: financeLedgerReady ? "system-confirmed" : "missing",
          critical: true,
          source: financeLedgerReady
            ? `${input.financeModelVersion} · 자동검사 대상`
            : "금융 원장 버전 없음",
          nextAction:
            "회계사가 월별 유입·유출, 자기자본 투입과 PF 상환 순서를 검산",
        },
        {
          id: "term-sheet",
          label: "금융기관 Term Sheet",
          status: input.hasTermSheet ? "expert-review" : "missing",
          critical: true,
          source: input.hasTermSheet
            ? "사용자 등록 금융조건"
            : "현재 LTC·금리는 사용자 가정",
          nextAction:
            "브릿지·PF 한도, 금리, 수수료, 선행조건과 상환순서를 첨부",
        },
        {
          id: "tax-memo",
          label: "세무 검토 메모",
          status: input.taxComplete ? "expert-review" : "missing",
          critical: true,
          source: input.taxComplete
            ? "사용자 등록 세무 검토"
            : "재산세·부가세·세무조정 일부 미산정",
          nextAction:
            "세무사가 사업주체·과면세 안분·취득/보유/처분 세액을 검토",
        },
      ],
    },
    {
      discipline: "sales-marketing",
      title: "분양·홍보",
      owner: "상품·가격·근거",
      description:
        "관측된 거래와 목표 고객을 연결해 매각·분양 가정을 검증 가능한 언어로 만듭니다.",
      items: [
        {
          id: "sale-comps",
          label: "매각·분양 사례",
          critical: true,
          ...sourceStatus(
            saleEvidenceReady,
            `${input.saleEstimateVersion ?? "버전 미기록"} · 실거래 ${input.saleCompCount}건`,
            "채택 가능한 실거래 사례 없음"
          ),
          nextAction:
            "중개사·분양대행사가 상품·준공연도·입지 차이를 반영해 채택 사례를 승인",
        },
        {
          id: "product-positioning",
          label: "상품·고객·가격 포지셔닝",
          status: saleEvidenceReady ? "expert-review" : "missing",
          critical: false,
          source: saleEvidenceReady
            ? "대표 계획안과 실거래 비교"
            : "상품 포지셔닝 근거 없음",
          nextAction:
            "타깃 고객, 평면 장점, 경쟁 공급과 가격 안전마진을 문서화",
        },
        {
          id: "claim-boundary",
          label: "홍보 문구 근거 경계",
          status: "expert-review",
          critical: false,
          source: "예비 모델 표기 원칙",
          nextAction:
            "확정·예상·참고·미산정 표현을 구분하고 법적·수익 보장 문구를 배제",
        },
      ],
    },
  ];

  const items = lanes.flatMap((lane) => lane.items);
  const confirmedCount = items.filter(
    (item) => item.status === "system-confirmed"
  ).length;
  const reviewCount = items.filter(
    (item) => item.status === "expert-review"
  ).length;
  const missingCount = items.filter((item) => item.status === "missing").length;
  const criticalBlockerCount = items.filter(
    (item) => item.critical && item.status === "missing"
  ).length;

  return {
    projectId: input.projectId,
    address: input.address,
    status:
      criticalBlockerCount > 0
        ? "blocked"
        : reviewCount > 0
          ? "expert-review"
          : "ready",
    confirmedCount,
    reviewCount,
    missingCount,
    criticalBlockerCount,
    lanes,
  };
}

export function buildHandoffBrief(gate: EvidenceGate): string {
  const header = [
    `[ParcelGrid Stage 4 전문가 검토 요청]`,
    `대상: ${gate.address}`,
    `상태: ${gate.status} · 필수 미확인 ${gate.criticalBlockerCount}건`,
  ];

  const sections = gate.lanes.map((lane) => {
    const items = lane.items.map(
      (item) =>
        `- [${item.status}] ${item.label}: ${item.source}\n  다음 확인: ${item.nextAction}`
    );
    return `\n${lane.title} · ${lane.owner}\n${items.join("\n")}`;
  });

  return [...header, ...sections].join("\n");
}
