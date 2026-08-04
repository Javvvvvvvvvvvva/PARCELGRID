export type ReadinessStatus = "ready" | "review" | "optional";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  scope: string;
  message: string;
}

export interface RuntimeReadiness {
  generatedAt: string;
  mode: "development" | "production" | "test";
  summary: {
    ready: number;
    review: number;
    optional: number;
  };
  checks: ReadinessCheck[];
}

function configured(environment: NodeJS.ProcessEnv, key: string): boolean {
  return Boolean(environment[key]?.trim());
}

function modeOf(environment: NodeJS.ProcessEnv): RuntimeReadiness["mode"] {
  return environment.NODE_ENV === "production"
    ? "production"
    : environment.NODE_ENV === "test"
      ? "test"
      : "development";
}

export function buildRuntimeReadiness(
  environment: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): RuntimeReadiness {
  const mode = modeOf(environment);
  const production = mode === "production";
  const accessPasswordLength = environment.SITE_ACCESS_PASSWORD?.trim().length ?? 0;
  const sourceKeyLength =
    environment.SOURCE_DOCUMENT_UPLOAD_KEY?.trim().length ?? 0;

  const checks: ReadinessCheck[] = [
    {
      id: "seed-runtime",
      label: "기본 분석 엔진",
      status: "ready",
      scope: "주소→계획→사업성→인계→보고서",
      message: "DB가 없어도 시드 데이터와 브라우저 프로젝트 저장으로 실행됩니다.",
    },
    {
      id: "database",
      label: "PostgreSQL 영구 저장",
      status: configured(environment, "DATABASE_URL") ? "ready" : "optional",
      scope: "여러 PC 간 프로젝트·수정 이력 공유",
      message: configured(environment, "DATABASE_URL")
        ? "DATABASE_URL이 설정됐습니다. 실제 연결은 첫 DB 요청에서 확인됩니다."
        : "미설정입니다. 로컬 데모는 동작하지만 여러 PC 간 자동 동기화는 되지 않습니다.",
    },
    {
      id: "vworld",
      label: "V월드 지적·도로·건물",
      status: configured(environment, "VWORLD_API_KEY") ? "ready" : "review",
      scope: "실제 필지 외곽·도로 경계·주변 건물",
      message: configured(environment, "VWORLD_API_KEY")
        ? `키 설정됨 · 호출 도메인 ${environment.VWORLD_API_DOMAIN?.trim() || "http://localhost:3000"}`
        : "키가 없어 실제 지적·도로·주변 건물 조회가 제한됩니다.",
    },
    {
      id: "molit",
      label: "국토교통부 공공데이터",
      status: configured(environment, "MOLIT_SERVICE_KEY") ? "ready" : "review",
      scope: "건축물대장·실거래 관측값",
      message: configured(environment, "MOLIT_SERVICE_KEY")
        ? "서비스 키가 설정됐습니다."
        : "키가 없어 공공 원문 조회가 제한되고 예비값으로 표시됩니다.",
    },
    {
      id: "kakao-rest",
      label: "카카오 주소·거리 조회",
      status: configured(environment, "KAKAO_REST_API_KEY") ? "ready" : "review",
      scope: "주소 검색·좌표·역세권 거리",
      message: configured(environment, "KAKAO_REST_API_KEY")
        ? "REST API 키가 설정됐습니다."
        : "키가 없어 신규 주소 검색과 거리 계산이 제한됩니다.",
    },
    {
      id: "kakao-map",
      label: "카카오 지도 화면",
      status: configured(environment, "NEXT_PUBLIC_KAKAO_JS_KEY")
        ? "ready"
        : "optional",
      scope: "지도 시각화",
      message: configured(environment, "NEXT_PUBLIC_KAKAO_JS_KEY")
        ? "브라우저 지도 키가 설정됐습니다."
        : "선택 기능입니다. 없어도 분석·3D·내보내기는 사용할 수 있습니다.",
    },
    {
      id: "openai-images",
      label: "AI 기준 이미지 외장 렌더",
      status: configured(environment, "OPENAI_API_KEY") ? "ready" : "optional",
      scope: "Stage 5 기준 이미지 기반 건축 콘셉트 시각화",
      message: configured(environment, "OPENAI_API_KEY")
        ? `서버 키 설정됨 · 모델 ${environment.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2"} · 기준 이미지 필수`
        : "선택 기능입니다. 키가 없어도 주소·계획·사업성·보고서와 수동 이미지 첨부는 사용할 수 있습니다.",
    },
    {
      id: "site-access",
      label: "공유 화면 접근 보호",
      status:
        accessPasswordLength >= 12 || !production ? "ready" : "review",
      scope: "사이트 전체",
      message:
        accessPasswordLength >= 12
          ? "12자 이상의 접근 비밀번호가 설정됐습니다."
          : production
            ? "운영 모드에서는 12자 이상의 SITE_ACCESS_PASSWORD가 필요합니다."
            : "로컬 개발 모드에서는 비밀번호 없이 열립니다. 공유 서버에서는 반드시 설정하세요.",
    },
    {
      id: "source-documents",
      label: "원문 파일 보관함",
      status: sourceKeyLength >= 16 || !production ? "ready" : "review",
      scope: "견적서·Term Sheet·계산 근거 PDF/Excel/CSV",
      message:
        sourceKeyLength >= 16
          ? "로컬 비공개 폴더와 16자 이상의 접근 키가 준비됐습니다."
          : production
            ? "운영 모드에서는 16자 이상의 SOURCE_DOCUMENT_UPLOAD_KEY가 필요합니다."
            : "로컬 개발 모드에서는 키 없이 저장하며 파일은 .parcelgrid-data에 보관됩니다.",
    },
  ];

  return {
    generatedAt: now.toISOString(),
    mode,
    summary: {
      ready: checks.filter((check) => check.status === "ready").length,
      review: checks.filter((check) => check.status === "review").length,
      optional: checks.filter((check) => check.status === "optional").length,
    },
    checks,
  };
}
