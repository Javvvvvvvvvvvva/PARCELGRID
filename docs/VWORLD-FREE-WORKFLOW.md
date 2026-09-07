# VWorld 비활성 운영

VWorld가 VPN 또는 네트워크 정책으로 차단된 환경에서도 PARCELGRID의 주소, 건축물대장, 사업성, 계획 검토, 보고서와 AI 콘셉트 렌더 흐름을 분리해 사용할 수 있다.

## 로컬 설정

실제 비밀 값은 Git에 커밋하지 않고 `.env.local`에만 둔다.

```dotenv
VWORLD_ENABLED=false

KAKAO_REST_API_KEY=
NEXT_PUBLIC_KAKAO_JS_KEY=
MOLIT_SERVICE_KEY=

OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
```

| 변수 | 역할 | 없을 때 |
| --- | --- | --- |
| `KAKAO_REST_API_KEY` | 주소, 좌표, 법정동 코드, PNU 기초값, 역 거리 | 신규 주소 등록과 역 검색 제한 |
| `MOLIT_SERVICE_KEY` | 건축물대장, 실거래 | 기존 건물과 시장 원문이 미확인 상태로 남음 |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 지도 화면 | 지도만 제한, 계산은 계속 가능 |
| `OPENAI_API_KEY` | 기준 이미지 기반 외장 콘셉트 렌더 | AI 렌더만 비활성 |
| `OPENAI_IMAGE_MODEL` | 이미지 모델 선택 | `gpt-image-2` 사용 |

설정 상태는 `/system/readiness`에서 비밀 값 노출 없이 확인한다. 환경변수를 바꾼 뒤에는 개발 서버를 다시 시작한다.

## 신규 부지 등록

1. Kakao 주소 조회와 MOLIT 건축물대장 조회를 실행한다.
2. VWorld 요청은 보내지 않고 토지 수동 입력 화면으로 전환한다.
3. 공부상 대지면적, 용도지역, 검토 중인 건폐율·용적률을 입력한다.
4. 있으면 WGS84 Polygon GeoJSON 한 개를 연결한다.
5. 사용자 입력 규제값은 `user-entered`, GeoJSON 경계는 `user-geojson` 출처로 저장한다.

GeoJSON 계산면적과 공부상 면적 차이가 10%를 넘으면 잘못된 필지 연결을 막기 위해 등록을 차단한다. 3%를 넘는 차이는 검토 상태로 표시된다.

## 허용 범위

- 필지 경계가 없어도 현황과 사업성 예비 검토는 가능하다.
- 사용자 GeoJSON이 있으면 계획 매스와 3D 기준 이미지 검토를 진행할 수 있다.
- 사용자 입력 규제값은 원문 확인 전이므로 전문가 승인 전에는 필지별 법정 상한으로 취급하지 않는다.
- VWorld 지적·도로 경계가 없으면 주변 지적, 접도 폭 검증과 설계 전달 패키지 확정은 차단한다.
- AI 렌더는 대표 Geometry와 Stage 2 기준 이미지가 모두 있을 때만 실행한다.

## VWorld 복구 후

`VWORLD_ENABLED=true`로 바꾸고 `VWORLD_API_KEY`, `VWORLD_API_DOMAIN`을 설정한 뒤 서버를 다시 시작한다. 같은 주소를 다시 조회해 자동 원문 결과와 수동 입력값을 대조한다.
