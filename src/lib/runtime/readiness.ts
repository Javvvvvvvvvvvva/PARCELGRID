import { vworldRuntimeState } from "@/lib/runtime/integration-mode";
import { siteAccessConfiguration } from "@/lib/site-access";

export type ReadinessStatus = "ready" | "review" | "optional";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessStatus;
  scope: string;
  message: string;
  environmentVariables?: string[];
}

export interface RuntimeReadiness {
  generatedAt: string;
  kind: "configuration-only";
  liveConnectivityVerified: false;
  deploymentGate: { status: "blocked" | "runtime-validation-required" | "local-only"; blockers: string[]; message: string };
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
  const access = siteAccessConfiguration(environment);
  const databaseConfigured = configured(environment, "DATABASE_URL");
  const vworld = vworldRuntimeState(environment);
  const kakaoRestConfigured = configured(environment, "KAKAO_REST_API_KEY");

  const checks: ReadinessCheck[] = [
    {
      id: "seed-runtime",
      label: "기본 분석 엔진",
      status: "ready",
      scope: "주소→계획→사업성→인계→보고서",
      message:
        "시드 실행 경로가 포함되어 있습니다. 실제 부지의 전체 흐름과 외부 API 연결은 별도 검증이 필요합니다.",
    },
    {
      id: "database",
      label: "PostgreSQL 영구 저장",
      status: databaseConfigured ? "ready" : production ? "review" : "optional",
      scope: "여러 PC 간 프로젝트·수정 이력 공유",
      message: databaseConfigured
        ? "DATABASE_URL이 설정됐습니다. 실제 연결은 첫 DB 요청에서 확인됩니다."
        : production
          ? "운영 역할·조직 멤버십과 DB 불변 감사 원장을 사용하려면 PostgreSQL이 필요합니다."
          : "미설정입니다. 로컬 데모는 동작하지만 여러 PC 간 자동 동기화는 되지 않습니다.",
      environmentVariables: ["DATABASE_URL"],
    },
    {
      id: "project-workspaces",
      label: "프로젝트 Workspace",
      status: databaseConfigured ? "ready" : production ? "review" : "ready",
      scope: "조직별 프로젝트 본문·낙관적 revision·감사 해시",
      message: databaseConfigured
        ? "PostgreSQL 불변 Workspace revision을 사용합니다. 배포 전에 최신 Drizzle migration 적용을 확인하세요."
        : production
          ? "운영·다중 인스턴스에서는 PostgreSQL migration이 필요합니다. 로컬 파일 저장은 인스턴스 간 동기화를 제공하지 않습니다."
          : "단일 Node 프로세스의 로컬 불변 revision 저장소를 사용합니다. 브라우저를 닫아도 같은 서버에서 다시 열 수 있습니다.",
      environmentVariables: [
        "DATABASE_URL",
        "PROJECT_WORKSPACE_STORAGE_DIR",
      ],
    },
    {
      id: "vworld",
      label: "V월드 지적·도로·건물",
      status: vworld.mode === "enabled" ? "ready" : "optional",
      scope: "실제 필지 외곽·도로 경계·주변 건물",
      message:
        vworld.mode === "enabled"
          ? `키 설정됨 · 호출 도메인 ${environment.VWORLD_API_DOMAIN?.trim() || "http://localhost:3000"}`
          : vworld.mode === "disabled"
            ? "명시적으로 꺼져 있습니다. 외부 요청을 보내지 않고 수동 토지 정보·GeoJSON 등록으로 전환합니다."
            : "키가 없습니다. 주소·건축물대장을 유지한 채 수동 토지 정보·GeoJSON 등록으로 전환합니다.",
      environmentVariables: [
        "VWORLD_ENABLED",
        "VWORLD_API_KEY",
        "VWORLD_API_DOMAIN",
      ],
    },
    {
      id: "manual-parcel",
      label: "VWorld 없는 부지 등록",
      status: kakaoRestConfigured ? "ready" : "review",
      scope: "Kakao 주소 + MOLIT 건축물 + 사용자 토지 정보",
      message: kakaoRestConfigured
        ? "주소 좌표를 확보한 뒤 면적·용도지역·법규값을 직접 입력하고 필지 GeoJSON을 선택 연결할 수 있습니다."
        : "주소와 PNU 기초값을 만들려면 KAKAO_REST_API_KEY가 필요합니다.",
      environmentVariables: ["KAKAO_REST_API_KEY", "MOLIT_SERVICE_KEY"],
    },
    {
      id: "molit",
      label: "국토교통부 공공데이터",
      status: configured(environment, "MOLIT_SERVICE_KEY") ? "ready" : "review",
      scope: "건축물대장·실거래 관측값",
      message: configured(environment, "MOLIT_SERVICE_KEY")
        ? "서비스 키가 설정됐습니다."
        : "키가 없어 공공 원문 조회가 제한되고 예비값으로 표시됩니다.",
      environmentVariables: ["MOLIT_SERVICE_KEY"],
    },
    {
      id: "kakao-rest",
      label: "카카오 주소·거리 조회",
      status: kakaoRestConfigured ? "ready" : "review",
      scope: "주소 검색·좌표·역세권 거리",
      message: kakaoRestConfigured
        ? "REST API 키가 설정됐습니다."
        : "키가 없어 신규 주소 검색과 거리 계산이 제한됩니다.",
      environmentVariables: ["KAKAO_REST_API_KEY"],
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
      environmentVariables: ["NEXT_PUBLIC_KAKAO_JS_KEY"],
    },
    {
      id: "openai-images",
      label: "AI 기준 이미지 외장 렌더",
      status: configured(environment, "OPENAI_API_KEY") ? "ready" : "optional",
      scope: "Stage 5 기준 이미지 기반 건축 콘셉트 시각화",
      message: configured(environment, "OPENAI_API_KEY")
        ? `서버 키 설정됨 · 모델 ${environment.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2"} · 기준 이미지 필수`
        : "선택 기능입니다. 키가 없어도 주소·계획·사업성·보고서와 수동 이미지 첨부는 사용할 수 있습니다.",
      environmentVariables: ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"],
    },
    {
      id: "site-access",
      label: "사용자 인증·역할 세션",
      status:
        !production ||
        (access.configured &&
          access.accountCount > 0 &&
          access.usesDedicatedSessionSecret)
          ? "ready"
          : "review",
      scope: "조직·사용자·API 권한",
      message:
        access.configured && access.accountCount > 0
          ? access.usesDedicatedSessionSecret
            ? `${access.accountCount}개 계정과 전용 세션 서명 비밀값이 설정됐습니다.`
            : "계정은 설정됐지만 32자 이상의 SITE_ACCESS_SESSION_SECRET이 필요합니다."
          : production
            ? "운영 모드에서는 사용자별 SITE_ACCESS_ACCOUNTS_JSON과 32자 이상의 SITE_ACCESS_SESSION_SECRET이 필요합니다."
            : "로컬 개발 주체로 실행 중입니다. 공유 배포 전 사용자별 계정을 설정하세요.",
      environmentVariables: [
        "SITE_ACCESS_ACCOUNTS_JSON",
        "SITE_ACCESS_SESSION_SECRET",
        "SITE_ACCESS_SESSION_HOURS",
      ],
    },
    {
      id: "source-documents",
      label: "원문 파일 보관함",
      status: !production || access.configured ? "ready" : "review",
      scope: "견적서·Term Sheet·계산 근거 PDF/Excel/CSV",
      message:
        !production || access.configured
          ? "조직별 저장 경로와 로그인 역할의 업로드·열람 권한을 사용합니다."
          : "사용자 인증을 설정해야 원문 업로드·열람 권한을 적용할 수 있습니다.",
      environmentVariables: [
        "SOURCE_DOCUMENT_STORAGE_DIR",
      ],
    },
    {
      id: "audit-ledger",
      label: "변경 불가 감사 원장",
      status: databaseConfigured ? "ready" : production ? "review" : "optional",
      scope: "가정 변경·원문 업로드·AI 생성·전문가 검토",
      message: databaseConfigured
        ? "PostgreSQL 조직별 해시 체인과 UPDATE·DELETE 차단 트리거를 사용합니다."
        : production
          ? "운영 배포에서는 PostgreSQL 불변 감사 원장이 필요합니다."
          : "단일 프로세스 로컬 append-only 원장으로 동작하며 변경 시 체인 검증이 실패합니다.",
      environmentVariables: ["DATABASE_URL", "AUDIT_LEDGER_STORAGE_DIR"],
    },
  ];

  const deploymentBlockers = production && !databaseConfigured ? ["production-database-required"] : [];
  return {
    deploymentGate: {
      status: deploymentBlockers.length ? "blocked" : production ? "runtime-validation-required" : "local-only",
      blockers: deploymentBlockers,
      message: deploymentBlockers.length
        ? "운영 출시 차단 조건: PostgreSQL 미설정. 현재 파일 fallback은 계속 동작하지만 멤버십·영구 저장·불변 감사 요건을 충족하지 않습니다. 기존 파일을 보존하고 별도 이관 검증 전에는 고객 운영 배포를 진행하지 마세요."
        : production
          ? "DB 설정만 확인했습니다. 연결·migration·복원·파일 영구 저장·권한 검증을 완료해야 출시할 수 있습니다."
          : "로컬 검증 모드입니다. 운영 배포 적합성을 보장하지 않습니다.",
    },
    generatedAt: now.toISOString(),
    kind: "configuration-only",
    liveConnectivityVerified: false,
    mode,
    summary: {
      ready: checks.filter((check) => check.status === "ready").length,
      review: checks.filter((check) => check.status === "review").length,
      optional: checks.filter((check) => check.status === "optional").length,
    },
    checks,
  };
}
