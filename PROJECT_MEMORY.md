# PARCELGRID 현재 작업 기준

최종 갱신: 2026-11-10 (America/Chicago)

이 파일은 다음 작업자가 오래된 세션 메모를 현재 요구사항으로 오해하지 않도록 실제 코드의 핵심 계약과 다음 우선순위만 유지한다. 전체 방향은 `docs/ASTRA-MASTER-PROMPT-KO.md`, 계산 세부는 각 버전 문서를 따른다.

## 최종 Goal · 재개

- 최신 지시(2026-11-10): "이번 작업은 별도 잔여량 제한 없이 진행". 이전50%/30% 보존 조건을 이번 작업에 적용하지 않는다. 아래 보류 기록은 회신 전의 과거 상태이며 현재 중단 사유가 아니다. 외부 비용·계약·고객자료 제공·실제 게시의 별도 승인 조건은 그대로다.

- 회신 전 기록(2026-11-10): 기존 Final Goal 재개 시 사용49%/잔여51%, 좁은 수정 후50%/50%였다. 이전 보존 조건 변경 여부를 질문하고 큰 확장을 보류했으나 최신 회신으로 해제됐다. 앱 메타데이터는 blocked이며 도구로 재개 변경할 수 없어 중복 Goal/완료 선언을 하지 않았다.
- 회신 전 완료 범위: 불완전한 견적의 기본 공사비 차액을 미확정으로 처리하고 신규8회귀 포함107테스트·타입검사·대상lint를 통과했다. 당시 전체verify/빌드/실제브라우저 검증은 미실행이었다. 첫 localhost3000 접속은 sandbox 안에서 실패했으며 서버 부재를 입증하지 않는다. 이후 기존 서버에서 HTTP200과 합성 UI 검증을 확인했다.
- 당시 후속 항목이던 보유 입력 검증과17공종 배분 원장은 아래 v227 배치에서 구현·검증했다. 전체 견적의 사업비 채택과 임대차별 일정 원장은 남아 있다.

- 이전 사용자 지시(2026-11-04): "지금까지한거 final goal에 적용하고 50%남길떄가지 작업 계속이어가자". 당시의 성능 개선·빌드 분리·월별 원장 산술 검산과 사용량 보존 기록은 아래 v226 배치에 있다. 당시50% 보존은 최신 회신으로 이번 작업에서 해제됐다. 예비 분석과 공식 승인은 계속 분리한다.
- 외부 검토자/실제 도면/견적이 아직 없다는 사용자 회신을 받았다. `docs/EXTERNAL-VALIDATION-BRIEF-2026.1.md`에 1필지 파일럿의 발주 순서, 분야별 납품·검수, 우선 준비 서류/권한/사업 조건, 공식 발급 경로, 견적 요청문을 추가했다. 외부 발송·계약·결제0건. 미확보 자료를 전문가 승인으로 대체하지 않는다.

- 사용자 확정 방향: 모든 과정을 검증하고 외부 도구·위임·전문 검토를 활용해 선두 서비스급의 실제 사용 가능한 제품으로 완성한다.
- 최종 완료 기준은 `docs/PARCELGRID-FINAL-GOAL-2026-10-26.md`를 따른다. 단위 테스트·개별 기능 완료와 제품 인수 완료를 구분한다.
- 계산·설계·승인·보고서·운영·디자인·홍보 자동화까지 포함한다. 기능·검증·운영 이후 전체 디자인을 정비한다.
- 동일 과제 벤치마크, 독립 전문가 검산, 실제 DB·복구·보안·성능, 역할별 사용자 평가, 승인된 실제 게시 시험과 사용자 인수가 필요하다.
- 공식 경계·허가·전문가 승인은 만들어내지 않는다. 비용·계약·외부 자료 제공·실제 게시에는 필요한 사용자 승인을 받는다.

## 제품 기준

### 최신 계산 배치 (2026-11-10, 공종 배분 원장·보유 입력 검증 v227)

- `hold-period-ledger-2026.4`: NaN 운영비를0으로 계산하던 경로, 비정상/희소 개발현금흐름, 누락·비유한 장기대출 금액·조건, 계산 overflow를 차단한다. 부호 있는 정상 현금흐름을 유지하며 합계·누적·회수시점은 Decimal로 대사한다. 실패5재현 후 신규55회귀 포함66보유테스트 통과. `docs/HOLD-PERIOD-INPUT-VALIDATION-2026.1.md` 참조. 임대차별 만기·대손·중도해지는 아직 미구현이다.
- `construction-scope-ledger-2026.1`: 기존견적에 공종별 원문 배분 금액/근거(행17개·전체256개)를 선택적으로 저장한다. 일괄 견적은 자동 균등배분하지 않고 정확합계·부가세·누락·중복 참조를 대사한다. 교차검토의 중복행 순서 의존을 수정하여 중복그룹 전부를 배분에서 제외했다. 54원장 회귀 통과. 명시적 초안·대사·저장·복원·보고서 연결, 사업비·면적·주차 자동변경 없음. 전체물량·견적 명시적 사업비 채택·QS검산은 미완료다. `docs/CONSTRUCTION-SCOPE-LEDGER-2026.1.md` 참조.
- 계산v227/통합검증2026.16: 과거 계산·검토는 보존하되 재계산/재검토를 요구하며 원문 배분 변경은 검토 키를 변경한다. 최종 `pnpm verify` 3008통과+실제DB opt-in1제외, lint·타입·production build 통과. 실제Next개발UI1440/390의 합성 메모리Workspace 배분입력·1원불일치·명시저장/복원·기존재무/면적/주차불변·가로넘침0/pageerror0 확인. 최종 Worker/인쇄 증빙과 제한은 `artifacts/scope-ledger-2026-11-10/report.md` 참조.
- 실제 production Worker6조건×3회 전체결과/SHA256 서버일치. 저장 견적 컴포넌트 PDF2개 각4페이지, Poppler/PDFium 페이지별 PC·모바일 이미지 동일 및 시각 검수, PDF당 한글1104개 위치의 잉크 검사 통과. 축소 미리보기의 글자 누락 의심은 확대 원본에서 재현하지 못해 제품 폰트를 수정하지 않았다. 전체 실제 보고서/로그인/DB 인수나 성능P95 증거는 아니다. 합성 검증 프로세스 종료, 기존 개발서버 유지·쌍문동envelope HTTP200 확인.
- 다음은 전체 견적의 사업비 명시 채택 계약(기존 포함액/외장·세대 가산비/부가세/누락 중복 동시대사), 임대차별 월별 일정·대손·중도해지 원장, 실제도면/견적·전문가 파일럿이다. 전체구조·공용부·MEP·소방 물량, 실제DB/배포 재인수와 최종제품 인수는 이번 배치 완료가 아니다.

### 이전 계산 배치 (2026-11-04, 금융 판정 정밀도 v226)

- 취득대금/구제안/스트레스/손익분기/대안 순위의 판정은 표시 반올림값과 분리했다. 원시 손익·NPV·IRR, 월별 현금흐름 보존, 정확한 반환가격 재검사, nullable 미산정, 독립 현재가 검사와 탐색한계 표시를 연결했다. 세전/세후 Pareto의 누락IRR·허용오차 순환·순서 의존을 수정했다. `docs/FINANCIAL-DECISION-PRECISION-2026.1.md` 참조.
- 교차 검토의 Decimal 합산 전 부동소수 오차와 비교표 반올림/미산정 녹색 표시까지 수정했다. 최종전체2873테스트+DB opt-in1제외/lint/타입/build 및diff-check통과. 실제개발UI의 격리메모리Workspace PC/390px10검사통과: 실제14.979959326031883%/표시15%는15%목표미달, 미산정후보는0원아님, 명시적저장/복원·주차/미승인보존. `artifacts/finance-decision-v226-2026-11-04/report.md`.
- v225 실제production/PG/브라우저2경로는통과했지만PDF의계산버전누락은실패로보존했다. 보고서에저장당시버전/전체견적sourceBasis를추가한v226은새실제PG/로그인/견적저장/봉인/무효화/로그아웃2경로및PDF2개각19페이지모두통과했다.38페이지시각검수,8견적행/17공종/금액/키/미승인표시확인.22Workspace revision/26감사행/4봉인,검토자쓰기403·로그아웃401. `artifacts/quote-production-v226-2026-11-04/report.md`. 실측/전문가·운영HTTPS/RPO/RTO인수는아니다.
- 실제v226productionWorker69회전체결과/키SSR일치.3규모각20회P95 164.1/746.1/1198.4ms(공유M2/Chrome156·동시QA존재,실제휴대폰/SLA아님). 과거v225봉인2건의원본키일치·원래재무값보존·현재재검토필요확인. `artifacts/finance-decision-v226-2026-11-04/worker-report.md`.
- 소스/배포해시동결검증후해제,모든검증프로세스/DB/리스너정리. 재현용비실행PG런타임/v225·v226동결복사본은증빙에경로기록. 사용자3000/4318서버미변경,쌍문동envelopeHTTP200확인. 종료조회사용47%/잔여53%로50%보존여유를남긴다. 새작업/자동검증예약없음,외부계약/유료API/고객자료전송/게시/commit/push없음. 최종제품Goal은미완료이며앱메타데이터의기존blocked는도구로재개변경할수없어유지했다.

### 이전 계산 배치 (2026-11-04, 견적 대사·금융 수학 검산)

- `construction-quote-2026.1`: 견적 문서·원문 행·17개 선언 공종·부가세·합계·지원 수량 대사를 추가했다. 증빙 저장은 사업비/수익/면적/주차 채택과 분리된다. 파일 원문 진위·전체 BOQ·전문가 승인은 미확정이다. 견적 편집/명시적 대사/저장/기준 갱신/잠금/세션 격리 및 보고서 원문 행을 연결했다.
- 별도 Number/BigInt 참조 검산으로 IRR -99% 경계와 미소 금액 수렴 오류를 재현·수정했다. `[-100,1]`은 -0.99, `[-4e-12,5e-12]`는0.25다. 보통 입력의 결과 동등성과 성능 최적화는 유지한다. 계산v225/통합검증2026.14로 갱신하며 이전 저장본은 보존하고 명시적 재계산이 필요하다.
- 전체2692테스트+DB opt-in1제외/lint/타입/production build 통과. 교차 검토의 수량 태그 없는 추가 견적 행 우회도 수정·회귀 추가. 실제 개발 앱1440/390px의 격리 메모리 Workspace 저장/복원/충돌보존/잠금/모의 세션 무효화 및 보고서25행/print 표시/가로넘침0 확인. 실제 DB/로그인 전체경로·PDF 증거는 별도다.
- 실제 production Worker3규모×20회 P95 105.4/766.2/994.3ms, 전체 결과/키 서버 일치·이전 정상 재무 숫자 동일. Apple M2/Chrome156/390px이며 실제휴대폰/동시부하/SLA 인수는 아니다. `artifacts/construction-quote-2026-11-04/report.md`, `docs/CONSTRUCTION-QUOTE-2026.1.md`, `docs/FINANCE-IRR-VALIDATION-2026.1.md` 참조.
- 격리 실제 PostgreSQL18.6에서 기존 opt-in종합시험과 새 견적시험을 최초/재시작/논리복구 각2개씩 총6회 통과(생략0). 견적 JSONB 순서 변화·2작성자경합·조직격리·원문행/금액/재무불변·불변이력·과거봉인2건·11테이블 해시/권한보존 확인. 견적은 최초만 저장하고 재시작/복구 때 재주입하지 않았다.84개 실행소스해시일치, 임시DB/프로세스/덤프정리. `artifacts/postgres-quote-2026-11-04/db-report.md` 참조. HTTP/브라우저/PDF나 운영RPO/RTO 인수는 아니다.
- 로컬 견적JSON 가져오기는8MiB/깊이8/노드12000/5초, 명시적미리보기·초안적용/별도저장, 원래기준·금액보존과취소·계정격리를추가했다. 신규36개와관련60개 및 실제개발UI1440/390합성16검사통과. 전체2728테스트+DB opt-in1제외/lint/타입/build통과 후, 독립 검토가 발견한2MiB입력/최대내보내기불일치를8MiB로 수정했다. 최대한글·JSON이스케이프2회귀포함38개·ESLint·최종production재빌드통과. 저장본/사업비자동채택없음. `artifacts/construction-quote-import-2026-11-04/report.md` 참조.
- 후속 진행: 실제로그인·PostgreSQL·견적화면·봉인·PDF까지 연결 검증. 재개 후 최근 계정 사용량18%/잔여82% 확인, 잔여50% 보존 기준 유지. 최대취득대금의 반올림 경계·탐색실패0표시도 독립 재현 조사 중이다. 외부자료/전문가/최종 인수는 미완료다.

#### v226 수정의 출발점인 금융 경계 결함 (당시 재현 기록)

- 독립 실제엔진 재현: 최대취득대금 판정이 표시용 반올림 IRR을 사용해 실제9.95025875484114%를10% 목표 통과로 표시했다. 최종가격 반올림으로 확인자본한도 초과, 해 없음의0원/0%와UI안전표시, 확장/반복상한을최댓값처럼표시, IRR미산정을실패상한으로오인하는문제도 확인. `artifacts/max-acquisition-2026-11-04/`의 통과한 재현 시험은 현결함재현이며수정완료가아니다.
- 메인 실제엔진9사례 확인: 월별현금흐름을만원정수로반올림후세후계산에넘겨 추가세금0시험에서도14/36개월사례손익2만원차이. `artifacts/cashflow-precision-2026-11-04/report.md`. 원시월별값보존/최종표시만반올림, 기존세무basis stale보호를검증해야한다.
- 세전/세후 Pareto의 미산정IRR 쌍별 생략과 허용오차 순환도 격리 재현했다. 당시 사용량26%/잔여74%에서 v225 증빙 소스 분리를 준비했고, 현재 상태는 위 v226 배치를 따른다. 과거 재현 파일은 변경하지 않는다.

### 이전 계산 배치 (2026-11-04, 월별 원장 별도 산술 검산)

- `project-ledger-arithmetic-2026.1`은 계산기/Decimal/원장 생성기를 호출하지 않는 별도 식으로 입력 비용·수입의 월별 배분, PF 인출/상환/평균잔액 이자, 자기자본·현금 보존, 지원 합계를 검사한다. 최대1361행/오류32건 표시, 전체 오류 수 보존, 입력 변경 없음. 모든 원장은 반환 전 검사하며 실패 시 결과 생성을 차단한다. 0원 입력의 실제 타당성은 미확정이다.
- 통합 검증을 `integrated-verification-2026.13`으로 올리고 `binding.ledger-arithmetic`/모델 버전을 보고서에 연결했다. 기준·공사비 민감도 재계산과 저장 결과 일치 후에만 내부 확인하며 누락/실패는 구분한다. 계산v224/원장2026.6 및 유효 재무 숫자는 그대로다. 새 검토 키가 이전과 달라짐을 확인했으며 과거 이력을 삭제하거나 이번에 실제DB의 구봉인 거부를 재실행한 것은 아니다.
- 손계산3개월 수익/손실 사례와 별도 BigInt 이자식, 월별 필드/합계 변조·누락·한도·실패 강제 회귀 포함 신규55개 통과. 최종 전체2545테스트+실제DB opt-in1제외, lint·타입·production build 통과. `docs/MONTHLY-LEDGER-AUDIT-2026.1.md`, `artifacts/ledger-audit-2026-11-04/report.md` 참조.
- 실제 Next production Worker 3규모×20회(각warmup1제외) 전체결과 SSR일치/기존 재무payload동일. Apple M2/Chrome156/390px P95 107.6/511.1/833.9ms. 실제 보고서 패널1440/390px 및 print 표시/미확정/가로넘침0 확인·PNG검수. 격리된 실제 컴포넌트이며 로그인/저장/봉인 전체경로·PDF·실제휴대폰/동시부하 시험은 아니다. G04/G09 인수 아님.
- dev3000서버 변경 없이 빌드 후 쌍문동envelope HTTP200 확인. 임시 검증 프로세스 종료. 공식 경계·허가·전문가 승인 미확정, 기존사업성/주차/승인이력 자동변경 없음, 외부전송·계약·유료호출·게시·commit/push 없음.
- 다음 우선순위: 실제 견적의 공종별 포함/누락/중복과 수량 대사, 전체 금융 IRR/NPV 등의 독립 참조 검산, 실제 필지 파일럿 및 전문가 자료 연결. 이번 산술 검산은 원가 입력 자체·세금 적용·대출 약정·시장가격·외부 전문가 검산을 입증하지 않는다.

### 이전 계산 배치 (2026-11-04, 성능 및 빌드 분리)

- 도형 교차의 검증된 작은 링(8점 이하) 분리 bounds 검사와 IRR Decimal 거듭제곱 재사용을 적용했다. 겹침·복잡/불량 도형은 Turf 유지, 정밀도·허용오차·반복 상한·금액·승인 계약은 변경하지 않았다. 전역 캐시도 없다.
- 동일 합성 입력의 Chrome156/Apple M2/390px Worker 각20회 P95: 2층4세대115.2→97.9ms,32층120세대830.4→496.4ms,32재무비교안1320.3→826.6ms. 모든 전체 결과/봉인 키가 변경 전과 일치했다. esbuild 반복 비교와 실제 Next 빌드 Worker 3규모×2회 일치 검사를 분리 기록했다. 실제 휴대폰·동시부하·전체 업무 성능/G09 인수는 아니다.
- 전체2484테스트+DB opt-in1제외/lint/타입/build 통과 후 빌드 분리 설정4회귀 추가 통과. 최종타입/lint/분리production build도 통과했다. `artifacts/review-performance-2026-11-04/report.md` 참조. 실제DB/전문가 검산·실제게시/외부계약/유료API/commit/push없음.
- 실행 중 dev와 첫 production build의 공용.next 충돌로500이 발생해 개발.next-dev/배포.next를 분리했다. 기존3000서버가 설정 변경으로 자동 재시작했고 분리 빌드 전·중·후 쌍문동envelope HTTP200 확인. 프로세스 강제종료·데이터삭제·인증환경변경없음. 타입검사와 빌드는 생성 타입파일 경합을 피하도록 순차 실행한다.
- 다음은 실제 기기/동시부하 성능과 독립 원가·현금흐름 검산/실제 필지 파일럿 준비다. 이번 결과 동등성은 기존 계산과의 회귀 비교이며 독립 전문가 검산을 대체하지 않는다.

### 이전 계산 배치 (2026-10-29, 당시 기록)

- 자동후속에서잔여31%(사용69%)를확인하고제품코드변경없이읽기전용CPU프로파일만추가했다. `artifacts/review-worker-2026-10-29/profile-node.mjs`/`node-profile.json`/`node-verification.cpuprofile`.32층120세대32비교안5회모두동일키,검증1539.7~1707.6ms/정규JSON11.2~20.5ms/인코딩2.5~3.2ms/SHA1.2~2.9ms.가장가까운앱호출자에귀속한샘플시간합계는planIntersectionArea4114ms,irr2297ms,npv662ms로다음조사범위를좁혔다(Node SSR/프로파일러오버헤드포함,브라우저지연원인확정이나P95아님).계산정밀도·승인·기한변경없음,프로파일job60099종료.최소30%보존요청은계속유효하다.
- 이번 배치 종료 시 사용량68%/잔여32% 확인으로 요청한 최소30%를 보존한다. 최종Goal은active이며 제품완료/인수통과로 변경하지 않았다. 모든검증job·임시PG/production서버는종료·정리,dev만session46528/port3000복원(기존/tmp작업자료경로,VWorld/MOLIT/DB비활성).쌍문동envelope HTTP200확인,사용자4318서버미변경. 실제게시/유료호출/외부계약/commit/push없음. 다음은아래대규모반복성능병목의원인분리부터재개한다.
- 검토/보고서의 통합 재검사·SHA-256을 별도 Worker로 연결했다.20초 hard stop/취소/입력 변경/페이지 이동/세션 변경 시 결과·봉인 키 해제, 명시적 재시도, 미완료 인쇄 경고 유지. 전체2444테스트+DB opt-in1제외/lint/타입/build통과. 실제 production+임시PG+Chrome1440/390의 키·전체결과 대사, 키보드취소/이동/20초기한/실제로그아웃401/재로그인/저장·봉인·수정무효화 통과. `docs/REVIEW-VERIFICATION-WORKER-2026.1.md`, `artifacts/review-worker-2026-10-29/report.md`.
- 반복 성능은 미완료: 3규모×2화면×20회(각1회warmup제외),PC P95 198/1422/1451ms,390px P95 227/1245/4363ms. 마지막120세대·32재무비교안은2초목표초과이며 직전PC120세대·1비교안4922ms도보존했다. 전체결과·키일치와취소가능은확인했지만G09인수아님. 실제휴대폰/동시부하/운영SLA도미검증. 다음우선순위는Worker시작·전송·통합검증·해시 단계별프로파일과부하/메모리기록후동일결과를유지한최적화다. 기준이나기한을낮추지않는다.
- 최신PDF재검증17페이지/17제목/35숫자셀/3단가열/봉인키/승인0/5/9한계/13모델버전통과,전체페이지PNG검수·PC/모바일15페이지동일·2페이지키/해시차이만확인. 도구의networkidle대기는명시적준비검사로,직전테스트screen매체잔존은명시적print선택으로보완했고실패자료를보존했다. production의공식승인게이트를변경하지않았다. 최신production의존성공개권고0건,전체보안인수아님.
- 규제 위험 요약 `regulatory-risk-summary-2026.1`/계산v224/통합.12: FAR÷최대BCR를 최대층수로 취급한 오류 제거, 별도 층수 입력만 예비 대사. ENV의3만㎡ 단일 경계·CUL의100/500m 의무 확정을 제거하고 공식 적용 범위 미확인 유지. 구버전 저장본은 보존하되 현재 표시/검토 기준에서 제외, 명시적 재저장 필요. 통합 검증에 위험 문구 재계산 대사를 추가했다. 위험 ViewModel/배지에 근거 상태 유지, 미확정을 녹색 확인으로 바꾸지 않는다. `docs/REGULATORY-RISK-SUMMARY-2026.1.md` 참조. 최종full2397+DB opt-in1제외/lint/타입/build통과. 실제 production/PG/Chrome1440·390에서 v223 보존·오래된 결과 표시 차단·명시적v224재저장·봉인·PDF까지 통과했다. 양쪽 모두 저장 충돌의 로컬 사본을 내려받고 서버 최신본을 명시적으로 열어 대사했다.
- 도면 Worker 실제 검증 완료: production+임시PG+Chrome1440/390에서 취소/이동/실제로그아웃→Worker종료·늦은다운로드0, 정상56객체ZIP 및 저장/봉인/편집무효화 통과. 모바일숨김CSS로 없던 로그아웃을44px로 복원,320/390/1440프로젝트 및390/1440신규헤더 검수. 단일사례Worker273/200ms·heartbeat최대18/21ms, P95아님. 정확한PC/모바일ZIP 각각FreeCAD56객체/32레이어/198재출력선분·높이/폐합/재열기보존 통과,재출력레이어명손실은유지. `artifacts/interior-drawing-worker-2026-10-29/report.md`.
- 보고서 실제 PDF 검증: 화면용 표 최소너비 때문에 단가/규제 근거가 A4 오른쪽에서 잘리는 문제와 접힌 details의 검토 한계 누락을 수정했다. 최신v224/통합.12 production+임시PG+Chrome1440/390 각각17페이지,17제목/35숫자 셀 금액/3단가 열/봉인키/승인0/5/9한계/13모델 버전 대사, 인쇄영역1463개 텍스트범위 넘침0 및 의도적 초과47검출. 전체 페이지 Poppler PNG 시각 검수,15페이지 픽셀 동일·나머지2페이지 프로젝트 키/형상해시 차이만 확인했다. `artifacts/report-print-2026-10-29/report.md` 참조. 단일 합성사례이며 실제 필지/타 브라우저/전문가 인수 아님.
- 도면 생성 Worker: UI 스레드의 통합 검증·DXF/ZIP 생성을 별도 Worker로 옮기고20초 hard stop/취소/원본·선택·세션·페이지 변경 차단을 추가했다. 당시 full verify2343통과+DB opt-in1제외/lint/타입/build통과. 실제 브라우저/다운로드 후속 결과는 위 완료 기록을 따른다. 마지막에는 dev3000 복원 필요.
- 전체 층 구획 자동화 `interior-automation-2026.1`: 기존 층/실/출구 기본 보존, 명시적 교체 옵션, 6개 코어 크기 템플릿·층고 기반 계단 예약 공간, 방/주방/욕실·층간/지상출구·주차면/통로/기둥 간섭 재검사. 생성8초/Worker12초, 적용 전 재검사도 Worker, 취소·세션/원본/대표/선택 변경 시 쓰기 금지. 미리보기·층별 평면 후 명시적 적용만 허용하고 면적/수익/주차 공급·승인은 자동 변경하지 않는다.
- `integrated-verification-2026.11`: 전체 테스트 중 32층 검증의 대지 포함2초 기한이 방/문 검사 시간까지 포함하던 오류를 발견해 독립 선행 pass로 분리했다. 한도는 유지, 실제 clipping 초과는 여전히 미검증. 이전 .10 검토는 새 검토 필요. 미완료 추천에도 복합 대지 지원 범위/공식 경계 경고를 유지한다. Vitest 동시작업2개 제한으로 검증 자체의 과도한 CPU 경쟁을 줄였으며 운영 한도를 완화하지 않았다.
- 최신 `pnpm verify` 2,310통과+DB opt-in1제외, lint/타입/build 및 diff-check 통과. 실제 임시 PG+production+Chrome1440/390에서 빈 실내→Worker 생성/평면 미리보기(저장0)→명시적 적용→별도 예비 채택→사업성 저장/재열기→봉인/보고서→CAD 다운로드→편집 무효화 통과. 생성145~147ms·재검사68~69ms인 단일 합성사례이며 운영P95 아님. 승인0/5·공급4 유지·3D픽셀/회전/넘침0/pageerror0, 임시DB/서버 정리완료.
- 자동화13변형 검증 완료: 침실0~3·회전17/90도·비균등층고·6층 공급6/8/9대·명시적 주차전용면적·공용면적부족·간섭. 6층요구9대에서6/8공급은 채택차단,9대별도입력은131객체인계. PC/모바일실제다운로드/회전/비균등층고/6층5조건 FreeCAD검사통과(3층56객체/32레이어/198선분,6층131/71/468). 재열기JSON비트동등실패는 최대7.1e-12mm 길이차이로 확인하여 비트동등false/기하보존true를 별도로 기록했다. 기존허용오차는 유지, 재출력레이어명손실제한도 유지. `artifacts/interior-automation-2026-10-29/report.md` 참조. 다음은 실제보고서PDF의 화면숫자/미확정표시/전체페이지인쇄 검증이다. 마지막에는 dev3000 복원 필요.
- 상세 실/문/코어/피난 후보 CAD 패키지 `interior-drawing-export-2026.1`을 추가했다. 동일 원본의 통합 검증/수량을 재검사하고 3D POLYLINE·원본 JSON·수량·미확정 범위를 내려받는다. 전체2,258테스트+DB opt-in1제외/lint/타입/build 통과. 실제 production/PG의 PC1440/모바일390 다운로드와 각 ZIP의 FreeCAD1.1.4 56객체/32레이어/층 높이/폐합/FCStd 재열기 검증 통과. 재출력198선분 기하는 보존되나 FreeCAD 기본 재출력의 레이어명 손실은 제한으로 남긴다. `artifacts/interior-drawing-2026-10-29/report.md` 참조. 다음은 전체 층 구획·상세 실·코어의 취소 가능한 일괄 후보 생성/검토/명시적 적용이다.
- 기존 엄격 대표안 경로는 실내/피난/차량 검사 결과가 예비 review여서 주거 계획의 정상 사업성 연결까지 막고 있었다. `analysis-reference-2026.1`은 별도 목적/미승인 선택 기록과 원시 대지·평면·문·주차·피난·형상 SHA-256 입력 연결값을 저장한다. 모든 실제 예비 공간 검사와 입력 상한/주차 공급을 만족한 경우에만 명시적 채택으로 사업성을 재계산하며 공급/면적은 자동 증가하지 않는다.
- 예비 선택을 Stage3/Workspace/검토 봉인/보고서에 연결하고 `integrated-verification-2026.10`에서 원본 연결을 재검사한다. 기존 대표안 엄격 검사와 별도 공식자료/전문가/자금 근거 제한은 유지한다. 피난 검사에는 주차면·통로·기둥 장애물을 함께 전달한다.
- 전체 lint/타입/2237테스트+DB opt-in1제외/production build 통과. 이후 버튼 연결4회귀 추가와 관련82회귀·production build 통과. 실제 production + 임시PG + 합성계정 Chrome1440/390에서 명시적 채택→사업성 버튼→저장→새로고침→봉인→보고서→주차 편집→기준안 해제/과거 봉인 이력 보존 통과. 원본 면적/공급 불변, 승인0/5, 3D 픽셀/회전 및 가로넘침0/pageerror0. `artifacts/analysis-reference-2026-10-29/` 참조. 합성 자료는 쌍문동 실자료나 전문가 검산이 아니다.
- 첫 브라우저 비교는 JSON의 undefined 제거 때문에 실패해 저장형식 비교로 수정했다. 후속 화면 검수에서 사업성 이동 버튼의 엄격 경로 잔존을 발견해 Stage3의 공통 판정으로 통합했고 최종 시험은 주소 직접 이동 대신 버튼을 사용한다. 임시PG/Next 정리 완료, 실제 외부 자료·유료 API·발송·게시·승인 없음. 다음은 동일 원본의 상세 실/문/코어/피난 후보·수량 CAD 인계 강화다.

### 최신 계산 배치 (2026-10-28, 내부 검증 완료·제품 인수 미완료)

- `artifacts/target-workflow-2026-10-28/`에 실제 multipart/holes 대상 등록·계산·저장·3D·CAD·서버 봉인 증빙을 기록 중이다. 아래 2026-10-27의 복합 대상 blanket hold는 이번 변경으로 제거했으며 source/area/geometry/approval 개별 검사는 유지한다. 단일 연속 건물 floor만 자동 생성하며 다동 최적화·합필·허가 완료는 아니다.
- `planning-geometry-v6`, 추천 v5 bounded search/input-v5, parking-v3-ground-binding, integrated2026.9. 전체 대상 원형을 추천·수동 등록·dynamic API·저장·부모 UI·지도·legacy3D·cadastral/site/CAD 내보내기에 연결했다. 생성 불능을 대지·건폐율 추정값으로 복구하지 않는다.
- 전체 대지 순면적과 층 포함 검사, 전체/지상/지하 층 형상 일치를 전 분야 binding으로 재검사한다. 존재하지 않거나 대지 밖·홀 안의 1층을 빈 땅으로 취급해 주차·피난 검사를 통과시키던 경로를 차단했다. 출처 변경/미확정/허가/전문가 승인과 자동 후보 공급은 분리한다.
- 추천 계산은 Web Worker로 이동했다. 전체 탐색15초 cooperative deadline/worker25초 hard stop, 개별 형상·주차 계산 미완료도 전체 미완료로 전파한다. 미완료 순위/상한 재구성 금지, 입력·대표안·기존 추천 수정·세션·페이지 이동·취소 시 기존 계획 보호. 독립 검토에서 inner budget 실패를 후보 탈락으로 오인해 낮은 최적안을 선택하는 경로를 재현·수정했다.
- 실제2조각/1홀 입력의 PC1440/모바일390 업로드→dynamic200→임시workspace저장/복원→추천worker/3D orbit 통과. 첫 화면 검사에서 SiteContext 대지 바닥·카메라의 legacy ring 잔존을 발견·수정했다. 모든 external font 요청 차단 시험에서 Drei Text 오류가 드러나 로컬 CanvasTexture SceneText로 전환했고 최신 production/offline 브라우저 회귀도 통과했다.
- FreeCAD1.1.4 실제 production export(no validation override) DAE/DXF→FCStd 저장·재열기·STL/DXF 재출력: 순면적391+400=791㎡, hole overlap0, DXF외곽2/홀1/후보주차19, 채택주차2 유지·approval unverified. 실제HTTP5조건 봉인/재조회 및 변조422/키404 통과. 합성10조각/10홀 추천은15.46초 미완료/순위0, 화면 heartbeat 최대101ms, 취소352ms. 이는 단일기기 사례이며 P95/운영SLA 인수 아님.
- 최신 full verify는2217통과+실제DB opt-in1제외/lint·타입·build통과다. CAD README의 잘못 남은 단일 대상 제한 문구 및 구형 검토 버전 거부 회귀도 포함한다. 최신 CAD 재생성/FreeCAD 재검증도 통과했다. 모든 기존 agent는 작업을 마치고 종료했다. Lovelace 부모4패널 일조/옥탑 입력 일치49회귀, Sartre 임시PG18.6 현재 통합/복합대지 테스트 초기·재시작·복구6/6통과,11테이블·54불변변경·9우회거부. 별도 DB 증빙은 `artifacts/postgres-revalidation-2026-10-28/report.md`.
- 실제 production build + NODE_ENV=production + 새 임시PostgreSQL·합성계정 로그인으로 PC/모바일 등록·저장/복원·추천·3D 및 미확정 차단 흐름을 통과했다. 대표안null유지, 외부요청 전부 차단한3D/pixel/orbit/넘침/errors 검사통과. 최신 실제worker 취소/이동/세션잠금30/72/2ms, 이후6초쓰기0. 10조각/10홀15.46초 미완료/순위0. production-result와관련JSON참조. 초기prod시도는DB가없어정상차단됐으며 인증완화로 통과시킨것이아니다. 도로·주차 부족 자료의 대표안 확정 성공을 잘못 기대한 harness 실패를 보존하고, 미확정 차단 검사로 명시 분리했다. 적정 근거를 가진 실제 대표안 채택→Stage3 저장→봉인 성공 경로는 이번 fixture로 검증하지 않았다.
- 새 형상 무결성 보강: 층고3m를저장형상1.5m로압축해도코어검사통과하던경로를재현후원시층고누적대사로차단했다. 2026.9는실제좌표/면적/도로/용도지역으로기존v6식별값을재생성하고층별면적·합계·FAR/BCR을독립검산한다. 부정확한메타데이터를갖는모델은모든분야승인차단및피난/주차입력제외. 원본형상해시포맷은유지하며법적승인/전자서명은아니다.
- 최신 production 검증 session83914는 성공 종료했고 임시Next/DB/클러스터를 자동 정리했다. 권한비활성/역할하향/조직변경/전문역할변경×PC모바일8조건의 실제DB변경+nativefocus 반환 통과, stale401/409·viewer쓰기403·회수후쓰기0·원장이력수불변. PC/모바일 미확정 대표안/Stage3저장/봉인 차단 및 예비보고서·승인0/5 유지도 통과했다. port4318미변경, 외부승인/유료호출/게시/commit/push없음.
- 개발서버만 session47705로 port3000에 복원해 Ready 및 /api/access/login 정상 응답을 확인했다. VWORLD_ENABLED=false, MOLIT_SERVICE_KEY=, DATABASE_URL=, SITE_ACCESS_PASSWORD=, SITE_ACCESS_ACCOUNTS_JSON= 및 /tmp/parcelgrid-dwelling-qa/{workspaces,audit}를 사용한다. 실제 고객DB가 아닌 로컬 개발 상태이며 배포 인수로 간주하지 않는다. 모든 테스트 프로세스와 agent는 종료했다.
- 다음 우선순위: 근거가 충분한 별도 합성 fixture로 대표안 채택→Stage3저장→봉인→원본변경 무효화→복원 성공 경로를 검사한다. 이후 상세 실·문·코어 CAD 인계와 수량 대사, 실제 첫 필지 외부 검토 패키지를 진행한다. 기존 mass/site/parking CAD가 상세 시공도면을 내보낸다고 설명하지 않는다. 모바일 거래조회 실패 상세 목록이 첫 화면을 크게 차지하는 사용성 문제도 기록했다. 관련 상세·외부 의존성은 최신 report.md의 Next Work를 따른다.

### 직전 계산 배치 (2026-10-27)

`artifacts/parking-topology-2026-10-27/report.md`가 최신 증빙이다. component별 도로·주차/동선·피난, 저장 원자료 검증, 전 분야 승인 결속과 세션 race를 보강했다. Ohm/Pasteur/Aquinas의 분담 작업과 Hegel의 독립 binding 검토를 메인이 통합했다. 모두 종료했으며 자격 전문가 검산으로 간주하지 않는다.

- `planning-geometry-v5`/`planning-parking-geometry-v2`: 전체 조각·홀을 공통 원점으로 보존하고 순면적·형상 해시에 결속한다. 도로 접면은 component/ring/edge 식별자, winding 법선과 전체 접근 구간 교차로 검사한다. 내부 홀·사이 조각을 관통하는 가짜 접면을 배제한다. 단일 외곽선 fallback은 명시 topology가 없을 때만 허용한다.
- 주차·차량·지상 출구는 소속 component와 전체 경계를 사용한다. component별 주차면·통로·코어·기둥·접근 경로를 2D/3D/DAE/DXF에 보존한다. 기둥 참고 폭도 차량 제원과 일치시킨다. 접근 없는 조각의 주차 공급은0, 생성 실패/예비 검사/공식 승인은 구분한다. 계획 공급·사업성 면적·수익·기존 이력을 자동 수정하지 않는다.
- 주차 per-call geometry cache와 증명 가능한 볼록 포함/분리 bounds 검사로 반복 Turf clipping을 줄였다. 단일 worker 추천 사례12,838→3,149ms,6배치clipping9,015→902는 동일 결과의 제한된 비교이며 P95/SLA 인수 아님. 오목/홀 포함은 전체 도형 검사 유지.
- Workspace/transfer는 bounded 전체 경계 검사를 재사용한다. 정상 복합 원형을 저장할 수 있어도 전체 업무 지원 또는 승인으로 승격하지 않는다. 비어 있는 명시 topology·모순된 legacy·교차·잘못된 홀·한도 초과는 거부한다. null parcel 인계 예외도 처리했다.
- `integrated-verification-2026.5`: 모든 분야에서 경계·도로 원자료와 형상을 비교한다. 독립 재현으로 발견한 복합 대지 보류 및 도로 변경의 타 분야 승인 누락2건을 수정·재검토했다. 주차 미대상/저장된 pass flag가 있어도 global binding 차단 유지. 실제 localhost 봉인201·조회200·변조검사422/변조키404, 전 분야 차단을 합성 자료로 확인했다.
- SessionBoundary는 blur/pagehide 뒤 늦은 응답으로 고객 화면이 다시 표시되지 않고, focus 복귀 중 요청이 있으면 새 확인을 대기시킨다.13개 새 회귀 및 PC/모바일 최종16/16실제Chrome 합성세션 검사 통과(초기/지연/native blur/중첩/조직 변경/만료). native hidden visibility와 실제운영 권한회수는 남았다. 과거 메뉴30초 timeout의 원인은 여전히 미확정이며 별도문제로 분리(`artifacts/session-load-2026-10-27/report.md`).
- 최종 `pnpm verify`:1978통과+실제DB opt-in1제외/lint·타입·production build통과. 실제Chrome1440/390×정상/자료실패 앱4조건,2조각/1홀 실제컴포넌트 화면2조건, pixel/orbit/가로넘침/pageerror 및 실제FreeCAD1.1.4 DAE/DXF 저장·재열기·재출력 검증. CAD 합성 순면적782㎡,홀중첩0,주차4/통로2/코어2/기둥3/경로4 일치. 통제된 emitter fixture이며 복합 대상 전체 인계 지원 증거 아님.
- 복합 대상 UI/API intake 및 대표/인계 보류는 유지한다. 다음은 추천 생성·대상 cadastral/site-package/GeoJSON·부모 UI guards·복구/승인 consumers를 전부 연결하고 실제 업무를 완주하는 작업이다. 단일 floor는 연속 footprint 후보이며 복합 다동 최적화 완성 아님. 실제 provider/최신DB·운영/전문가·사용자·경쟁제품/디자인·홍보 인수도 남았다.
- main dev port3000/session89901 복원, VWorld/DB 비활성 및 임시 workspace/audit 경로 유지. 합성 봉인3건만 임시 감사 저장소에 추가했고 고객자료·실제승인·유료API·외부전송·계약·게시0건. port4318 미변경, commit/push 없음.

### 직전 계산 배치 (2026-10-27)

`artifacts/envelope-topology-2026-10-27/report.md`가 최신 증빙이다. 중단된 McClintock/Copernicus 변경을 메인이 마무리·검증했고 Lagrange는 읽기 전용 전체 영향 목록을 제공했다. 세 에이전트 모두 종료. 독립 최종 재검토나 외부 전문 검산으로 표시하지 않는다.

- `planar-ring.ts`로 기초 수치 연산을 분리해 geometry/massing 순환 의존성을 제거했다. `@turf/jsts`2.7.2 직접 pin(기존 Turf 전이 의존), `parcel-envelope.ts`의 로컬 미터 버퍼·유한 정북 경계 sweep은 조각/홀을 유지한다. 같은1e-8m precision grid로 사선 경계 미세 슬리버를 방지한다. 접하는 조각은 병합/경계 정책 검토 필요로 보류한다.
- `calcBuildableArea.geometryStatus`: available+polygons[]는 계산된0, unavailable+undefined는 미확인. 원형 topology 우선, legacy ring은 단일 무홀만. 결과 면적을 중간 소수1자리로 반올림하지 않는다. 원점·면적은 planning 근사값이며 공식 측량 아님.
- `planning/envelope-steps.ts`가 4개 설계/미리보기 경로를 통일한다. 빈 층·없는 층을 다른 층/대지로 대체하지 않는다. massing은 실제 교차면적으로 hole/틈을 검사하고 bounded contiguous 후보, 하층 지지, 실패 사유를 보존한다. 유한 탐색 실패는 법적 불가능 확정 아님. 프로그램 면적·수익·주차를 자동 채택하지 않는다.
- legacy 비교의0㎡→최대면적 복원 제거, 미확인/복합 층 gfa는null, 실제빈층0유지. 추천 profile의 truthy fallback 제거. `planning-geometry-v4`, `planning-recommendation-v3-envelope`, input-v3, representative-basis2026.2. Stage3는 구형 geometry version·재무 geometryHash 누락을 차단한다.
- 수동 parser는 전체 GeoJSON/원형 보존·유한숫자·1.5MB/깊이16/점10000/조각200/2초 한도. dynamic API는 전체 topology 구조·교차·legacy일치 검사. **복합 대상의 UI/API 등록은 명시 보류**: 아직 모든 downstream source·frontage·주차/동선·저장/복원·승인·export에 연결하지 못했으며 이 제한을 완료로 간주하지 않는다. helper 기반·생성된 복합 envelope 지원과 실제 복합 target 지원을 구별한다.
- 최종 `pnpm verify`:1869통과+실제DB opt-in1제외/lint·타입·build통과. 실제Chrome1440/390×정상/자료실패의 3D pixel·orbit·경고·2D path·가로넘침/pageerror 검사 기록, 합성 자료·외부자료/쓰기차단. Native CAD/DB 이번 재실행 없음. 다음은 full target input/source binding→component/ring/edge frontage→주차·차량/피난→저장·승인·export의 실제 전체 연결과 적대적회귀다.
- 최종코드 브라우저 첫 재검사에서 메뉴 selector 30초 timeout1회(`browser.log`). 원인 DOM 미수집이므로 해결로 단정하지 않는다. 실패 시 화면/본문/errors 수집을 harness에 추가했고 전체 재시도4조건 통과(`browser-retry.log`, 최신browser-result/PNG). SessionBoundary focus/visibility·로딩 반복 검증을 G08/G09 후속으로 남긴다. Main dev session43464, port3000, 기존 VWorld/DB-disabled 명령으로 복원. 테스트 프로세스 종료, 개발서버만 유지, port4318미변경.

- 대상 사용자: 건축사, 시행사·건축대행사, 보험사, 일반 사용자
- 핵심 흐름: 조직 프로젝트 목록 → 주소·부지 입력 → 현황 → 계획 → 사업성 → 전문가 검토 → 보고서
- 기준 회귀 부지: 서울 도봉구 쌍문동 281-23, PNU `1132010500102810023`
- 계산 가능, 공공 원문 확인, 전문가 승인과 투자 확정을 서로 다른 상태로 표시한다.
- 계획·3D·DAE·DXF·Stage 3·검토 Snapshot은 같은 대표 계획안과 Geometry Hash를 사용한다.
- 하나의 종합 점수 대신 실행 가능한 Pareto 후보와 세전이익·IRR·NPV·자기자본·하방손실 등 목적별 선두를 표시한다.
- VWorld가 꺼져도 Kakao·MOLIT·수동 토지 정보·GeoJSON으로 핵심 흐름을 계속한다.

## 현재 핵심 계약

| 영역 | 구현 기준 |
|---|---|
| 법규·주차 | `parking-rules-2026.1`, `sunlight-rules-2026.1`, `building-use-catalog-2026.1`, `zoning-use-screening-2026.2` |
| Stage 2·3 면적/수익 | `stage2-finance-area-2026.2`, `revenue-pricing-2026.3`, `revenue-valuation-2026.2` |
| 개발·보유 금융 | `project-ledger-2026.6`, `takeout-underwriting-2026.2`, `hold-period-ledger-2026.3` |
| 세후 | `expert-tax-input-2026.3`, `after-tax-ledger-2026.3` |
| 다목적 추천 | `scenario-decision-pareto-2026.5`, `after-tax-decision-pareto-2026.2` |
| 인증·검토 | `AUTH-RBAC-AUDIT-2026.1.md`, `ROLE-REVIEW-WORKFLOW-2026.3.md` |
| 수량·원가 | `quantity-takeoff-2026.1`, `quantity-cost-2026.1`, `QUANTITY-COST-2026.1.md` |
| 월별 원가 민감도 | `construction-cost-ledger-2026.2`, 프로젝트 계산 `v226`, `regulatory-risk-summary-2026.1` |
| 검토 봉인 | `review-snapshot-2026.6`, `integrated-verification-2026.15`, `server-review-snapshot-2026.1` |
| 신축 견적 대사 | `construction-quote-2026.1`, 선언 범위·지원 수량의 입력 대사, 원문/전문가 미확정·재무 미반영 |
| 월별 원장 산술 검산 | `project-ledger-arithmetic-2026.1` (내부 식 대사, 외부 승인 아님) |
| 프로젝트 저장 | `project-workspace-2026.1`, `PROJECT-WORKSPACE-2026.1.md` |
| 브라우저 세션 격리 | `CLIENT-SESSION-ISOLATION-2026.1.md` |

## 프로젝트 저장

- `/api/projects`는 현재 조직의 최신 Workspace 목록만 반환한다.
- `/api/projects/[projectId]/workspace`는 `project.read`와 `project.update` 권한, SHA-256, 감사 원장 참조와 낙관적 revision을 강제한다.
- PostgreSQL은 Workspace row와 감사 이벤트를 한 transaction에 append하고 migration trigger로 UPDATE·DELETE·TRUNCATE를 막는다.
- DB가 없으면 `.parcelgrid-data/project-workspaces`의 단일 프로세스 versioned 파일 저장소를 사용한다.
- 저장 충돌은 자동 병합하거나 덮어쓰지 않는다. 로컬 JSON을 내보내고 서버 최신본을 다시 연 뒤 사용자가 대사한다.
- 서버 전문가 승인, 검토 Snapshot 봉인, 원문·AI 바이너리는 Workspace에 복제하지 않는다.
- 고객 화면은 세션 확인·scoped hydrate 뒤 마운트한다. 계정/조직/역할 전환은 기존 문서를 잠그고 Query·메모리·진행 중 요청을 제거한다. raw 고객 API fetch 대신 `sessionFetch`를 사용한다.
- 소유권 없는 구형 공통 localStorage 키는 보존하지만 자동 이관하지 않는다. 소유 확인 후 명시적 복구가 필요하며 새 로그인에 임의 귀속시키지 않는다.
- 미저장 Workspace는 계정별·탭별 복구 초안으로 보존한다. 재진입 시 최신 서버 revision을 조회하고 로컬 초안을 우선 복원하며, 기준 revision 불일치는 충돌로 표시한다. 이전 저장 응답으로 후속 편집을 저장 완료 처리하지 않는다.

## 수익 단가

- 여섯 수익 풀은 각각 독립 기준단가와 `용도·입지·층·면적·신축` 보정축을 가진다.
- Stage 3는 Scenario 단가, Stage 2 잠금 단가, 구형 공통 가정 순으로 가격을 해석한다.
- 활성 풀마다 독립 원문 필드를 요구하며, 공통 매각·임대 원문은 구형 fallback으로만 적용한다.
- 민감도·손익분기·Deal Stress·Deal Rescue는 면적가중 실효 단가를 사용하면서 풀 간 상대 가격을 보존한다.
- 단가·보정 초안은 Workspace에 저장되고 Stage 3 저장본의 단가 변경은 검토 Snapshot Key를 변경한다.

## 법정 용도 후보

- 상품명과 건축법 시행령 별표 1 세부 용도코드를 분리한다. 도시형 생활주택과 소매시설은 자동 후보가 각각 아파트형과 일용품 소매점 코드를 명시한다.
- 다가구는 주택 사용층 3개 이하, 주택 용도면적 660㎡ 이하, 19가구 이하를 모두 통과해야 한다.
- 자동 후보 FAR는 `건폐율 × 지상층수`를 넘지 않으며 제1종일반주거 4층, 제2종일반주거(7층 이하) 표시를 검사한다.
- 서울 조례 Snapshot 기준일은 2026-07-13, 통합 규칙 적용 시작일은 2026-09-08이다. 서울 외 조례 의존 후보는 해당 관할 Snapshot 전까지 중단한다.
- 모든 후보 선별 결과는 `decisionGrade: false`이며 지구단위계획·중첩 규제·허가권자 확인을 대체하지 않는다.

## 세후 다목적 비교

- 세무 계약은 세전 자기자본 월별 현금흐름, 기존 취득세와 요구수익률의 `PG-TAX-BASIS-*` Snapshot을 저장한다.
- 현재 세전 기준이 달라지면 계약은 `stale`이 되고 세후 수치와 모든 세후 순위에서 제외된다.
- 안정화 매각의 `expert-confirmed`만 확정 세후 Pareto에 들어간다. 완결 `draft`는 별도 예비 Pareto에만 들어가며 대표안과 확정 집합을 바꾸지 않는다.
- 세전 비교에서 물리·조달·법규·손실로 제외된 계획안은 세후 수치로 복구하지 않는다.
- 장기보유 세후 값은 적용 가능한 상품만의 별도 원장이며 공통 세후 Pareto에는 아직 포함하지 않는다.

## 다음 우선순위

1. 고객자료 격리와 통합 검토에 이어 지원하는 주거 내부 수량·견적 교체를 연결했다. 전체 구조·공용부·설비·방재 물량 및 독립 견적 검산은 아직 누락으로 차단한다. 실제 DB·권한 회수·운영 보안과 전문가 자격·공식 승인 검증은 별도 남아 있다.
2. 실제 도면·견적의 독립 검산 사례를 확보하고 수량의 미지원 공종을 확장한다. 원문 견적의 진위·포함액 근거는 입력 텍스트만으로 확인 완료 처리하지 않는다.
3. 실제 DB·운영·보안·복구 및 역할별 사용자 업무를 검증한다.
4. 기능 검증 뒤 디자인 정비와 공개용 결과·홍보 생성·승인·게시·성과 측정을 연결한다.
5. 기존 후속 과제인 lease-by-lease 만기·중도해지·대손 원장, 역할별 홈·보험 실무 화면, 서울 외 관할별 공식 규칙 Snapshot도 최종 범위표에서 추적한다.
6. Low/High 월별 재계산, 지원규모32층/120세대·재무32후보의봉인/Worker대사와격리DB재시작/복구를확인했다. 남은 것은 실제휴대폰·동시사용자·운영배포의성능/복구인수다. 현재 월별 봉인 재검사는 비교안32개한도이며유한후보를전역최적이라고표시하지않는다.

후속 작업은 이미 통과한 합성 시험을 반복해 사용량을 소진하지 않는다. 이번 v226 변경의 새 결함이 없다면 실제 견적/세무/도면을 받을 1필지 외부 검산과 운영 배포 인수 조건을 우선하고, 위 미지원 전체 공종·임대차별 원장·역할별 업무를 증빙 가능한 단위로 확장한다. 공식자료/승인·전체공종이 미확정인 상태를 UI 디자인이나 홍보 문구로 숨기지 않는다.

## 수동 확인

2026-10-26 내부 검증: 자동 테스트 818개 통과, DB 통합 1개 제외, 인증된 임시 계정의 브라우저 격리/복구 시험 통과. 상세 증빙은 `artifacts/session-isolation-2026-10-26/`다. 기존 PostgreSQL VM이 SSH 연결 실패하여 최신 실제 DB 재검증은 미완료이며 운영 인수로 승격하지 않는다.

- 새 브라우저에서 실제 주소 등록부터 보고서까지 완주
- 두 브라우저의 Workspace 충돌, 로컬 사본, 서버 최신본 복구
- PostgreSQL migration과 불변 trigger, 서버 재시작 후 복원
- DAE SketchUp, DXF AutoCAD 호환 프로그램, A4 인쇄 미리보기
- 실제 API 키의 성공·실패 안내와 VWorld 비활성 흐름

## 완료 명령

```bash
pnpm verify
```

형상·재무·저장 계약을 바꾸면 정상, 경계, 실패 회귀와 사용자 문구를 함께 갱신한다.

## 기능 고도화 3차 추가 기록 (2026-10-20 한국 기준)

- 기존 디자인 유지. `PlanningLayoutVerification`에서 층별 실내 구획과 차량 후보 궤적을 검토한다.
- `interior-layout.ts`: 주거·공용부 구획 후보/수치 편집/문 재연결, 실제 층 외곽·겹침·유효폭·연결·계획 전용면적 부족 검증. `FloorProgram.interiorLayout`에 저장한다.
- `vehicle-circulation.ts`: 입력 제원·후륜축 회전반경에 따른 직선/원호 후보와 차체 swept envelope 검사. 차량 제원은 `PlanningParking.vehicleProfile`에 저장한다.
- 실내/차량 예비 검사 결과는 허가·전문가 승인으로 승격하지 않는다. 사업성 면적·법정 및 제공 주차대수를 자동 수정하지 않는다.
- 상세 실내 방/주방/욕실/피난, 층간 코어, 실측 기둥, 외부 도로 진입, 공식 경계 및 승인은 후속 범위다.
- 계약: `docs/LAYOUT-VERIFICATION-2026.1.md`. QA: `src/tests/layout-verification.test.ts`, `artifacts/layout-verification-2026-10-20/`.

## 기능 고도화 4차 추가 기록 (2026-10-22, America/Chicago)

- 기존 디자인 유지. 상세 실과 피난·코어 탭을 추가했다. 3차 기록의 방/주방/욕실/층간 코어는 이번 단계에서 예비 구획·연결 검사로 확장됐다.
- `room-layout.ts`: 부모 세대·현관 기준의 실 구획, 독립 통로 연결, 겹침/폭/면적/문 검사. 저장 위치는 `interiorLayout.roomLayouts`.
- `egress-core.ts`: 실제 층 높이 차에 따른 계단·참 예약공간, 인접 코어 정합, 지상 출구와 대지 내 여유 공간, 실별 연결 그래프. 저장 위치는 `scenario.egressPlan`.
- 지상 필로티/주차층의 공용부 구획을 지원하며 공용면적 예산을 검사한다. 실측 기둥 대신 가정 기둥/주차면 간섭만 추가 검사한다.
- 상세 실·출구 stale 검증, Workspace 형식 검사, 잠금 데이터 계층 보호, 복제 참조 초기화. 금융 입력·전용면적·주차대수 자동 변경 없음.
- 공식 경계·허가·전문가 승인 및 법정 피난 적합성은 계속 미확정. 창호·설비·방화·계단 상세/실제 출입 접속·외부 안전 통로는 후속 범위.
- 계약: `docs/ROOM-EGRESS-2026.1.md`. 회귀: `src/tests/room-egress.test.ts`. 합성 브라우저 QA: `artifacts/room-egress-2026-10-22/`.

## 기능 고도화 5차 추가 기록 (2026-10-24, America/Chicago)

- 기존 UI 유지. 사업성 연결 탭에서 저장 평면의 세대 유효/상세 실 합계로 면적·필요 주차·공사비·수익 비교안을 자동 계산한다.
- 총 층면적·외곽·세대수·제공 주차대수는 유지한다. 수익/주차 전용 입력은 가정값이고 잔여는 공용·벽체 여유다. 실제 벽체·설비 상세 견적 증감은 미반영이다.
- 최신 비교를 확인한 뒤 명시적으로 반영한다. 묶음 세대는 개별 구역으로 분리하고 유효한 부모·상세 실·출구 참조만 재연결한다.
- 이력 10건, 순차 되돌리기, 후속 편집 덮어쓰기 방지, Workspace 보존·검사, 잠금 보호, 복제 이력 초기화를 추가했다.
- 투영/회전 좌표의 맞닿은 다각형 clipping 오류를 1e-8 m 입력 정규화로 수정했다. 저장 도형과 기존 판정 허용오차는 그대로다.
- 공식 경계·법정 피난 적합성·허가·전문가 승인은 계속 미확정이다. 기존 3/4차의 금융 자동 변경 없음은 '비교 자동화 + 명시적 반영'으로 확장됐다.
- 계약: `docs/LAYOUT-FINANCE-2026.1.md`. 회귀: `src/tests/layout-finance.test.ts`. 합성 브라우저 QA: `artifacts/layout-finance-2026-10-24/`.

## 통합 검토 자료 (2026-10-26, America/Chicago)

- `review-snapshot-2026.4`: 원본 계획(방·문·피난·차량 제원), 전체 형상, Stage 3 계산, 모든 표시 비교안의 세무 계약과 가격·재무 근거, 통합 검사 결과를 같은 SHA-256으로 봉인한다.
- `integrated-verification.ts`는 기존 공간 엔진을 재사용하고 층·세대·방·문·코어·주차·차량·면적 및 저장 재무 산술을 검사한다. 범위·누락·충돌을 분리하며 원본 입력을 수정하지 않는다.
- 서버가 검사 결과를 재계산하여 조작된 목록을 거부한다. 분야별 승인 API도 결속 누락 및 해당 검사 실패를 차단한다. 원가 물량 누락은 시행/재무 승인 차단으로 남긴다.
- 인계와 보고서의 통합 목록·자료 다운로드가 같은 본문과 키를 사용한다. 원본 변경 시 이전 키를 즉시 무효화하며, 다른 키로 재요청할 때 이전 진행 이력은 유지한다.
- 2026.3 이하 봉인·승인은 감사 이력에 보존하되 현재 승인의 근거로 승계하지 않는다. 새로운 봉인과 검토가 필요하다. 검토자 앱 역할은 전문 자격 증명이 아니며 공식 경계·관할 허가·전문 승인은 미확정이다.
- 계약과 범위: `docs/INTEGRATED-REVIEW-2026.1.md`. 검증 증빙: `artifacts/integrated-review-2026-10-26/`.
- 전체 `pnpm verify`: 862개 통과, PostgreSQL 통합 1개 제외, lint·타입·production build 통과. 실제 임시 서버에서 봉인·다운로드·보고서 동일 키·차량 변경 재검토 및 PC/모바일을 확인했다. 실제 DB·전문가·제품 인수 통과가 아니다.
- Next 서버의 `concaveman`/`RBush` 로딩 문제를 실제 봉인 시험으로 발견·수정했다. `serverExternalPackages`의 `concaveman` 설정과 실제 브라우저 봉인 회귀를 유지한다.

## 주거 내부 수량·원가 연결 (2026-10-26, America/Chicago)

- `quantity-takeoff-2026.1`: 실 사이 공유 칸막이 선분 합집합, 실간 문·세대 현관문, 건식/욕실 유효 바닥, 주방/욕실 개수를 산출한다. 누락·충돌이면 전체 합계를 null로 반환한다. 실제 설비 배관 길이나 전체 BOQ를 산출한 것은 아니다.
- `quantity-cost-2026.1`: 공종별 미확정/기본단가 포함/기존 포함액 차감 후 교체, 단가·포함액 출처와 범위 확인을 저장한다. 명시적 반영만 사업비를 변경하며 면적·수익·주차대수는 그대로다. 주방/욕실과 추가 세대 가산비의 중복을 차단한다.
- Stage 2/3에 동일 원가를 연결한다. 소수 면적 원본을 보존하고 Stage 3 단가 민감도는 교체 견적을 고정해 기본 공종의 남은 비율만 증감한다. 오래된 수량·단가·계산 결과, 기준 공사비 조작, null/문자열 수치, 기존 세대·재료비 불일치를 거부한다.
- 원가 기준 변경 시 이익·추천 표시와 Stage 3 변환을 보류한다. 잠금 보호, 복제 초기화, Workspace 보존/검사 및 면적 반영과의 충돌 방지를 추가했다.
- `review-snapshot-2026.5`, `integrated-verification-2026.2`: 서버가 수량·원가 원본과 저장 계약을 대사한다. 인계·보고서·JSON에 같은 내역과 키를 표시한다. 2026.4 이하 봉인은 현재 검사 기준으로 재봉인·재검토해야 하며 이력은 삭제하지 않는다.
- 전체 공종·독립 견적 검산은 계속 missing으로 시행/재무 승인을 차단한다. 공식 경계·허가·전문가 승인은 미확정이다. 유료 외주/고객 자료 제공/실제 게시를 실행하지 않았다.
- 전체 `pnpm verify`: 985개 통과, PostgreSQL 통합 1개 제외, lint·TypeScript·production build 통과. 전용 수량 50개, 원가 28개, 원가 결속 45개 회귀를 포함한다. 보조 에이전트 3개 작업과 독립 코드 검토 후 4가지 계산 경계 문제를 수정했다.

## 월별 원가·하방 비교 연결 (2026-10-26, America/Chicago)

- 단순 Low/High 손익과 직접/간접 공사비 정의 불일치를 제거했다. 최종 프로젝트 계산에서 기본 공사단가 -15%/기준/+20%의 월별 금융·자금 부족·세전 손익·IRR/NPV를 재계산한다. 상세 교체 견적·재료/세대 가산액은 고정하며 반복 탐색의 단일 계산은 유지한다.
- 계산 불가 스트레스는 기준 손익 또는 0원으로 대체하지 않는다. High 누락 후보는 Pareto 자격에서 제외한다. 음수 최종 공사비도 0원으로 숨기지 않는다.
- 보고서는 원시 입력으로 저장 결과를 재검증한다. `binding.monthly-finance`는 모든 표시 후보(32개 이하)의 원장과 순위를 재검사하며 누락·불일치는 분야 공통 승인 차단이다. 현재 봉인은 2026.6이고 이전 이력은 재작성하지 않는다.
- 전체 `pnpm verify`: 1064개 통과, PostgreSQL 통합 1개 제외, lint·TypeScript·production build 통과. 민감도 44개와 통합 검증 58개 회귀를 포함한다. 합성 실제 브라우저에서 PC/모바일 금액 대사, 구버전·stale·단가 초과, 실제 서버 봉인과 보고서/인계 동일 키를 확인했다.
- 독립 코드 검토 후 전체 재무 VM·PF 분기표와 실제 시작일(`meta.calculationStartDate`)까지 서버 대사를 확장했다. 자재비 차감이 있는 정상안의 0원 단가 탐색 오류는 공통 원가 계산의 유효 하한으로 해결했다. 스트레스·구조 개선 오류는 화면에 표시하고 실행 상태를 해제한다. 월말 시작일의 달 넘김/분기 오배분도 수정·회귀 검증했다.
- 작은 3층·2세대 합성 사례에서 후보 1/8/32개와 봉인 크기 측정은 `benchmark.json`에 보존한다. 최대 형상·실서비스 부하 인수는 아니다. 실제 스트레스 실행 오류 화면 시험은 이 합성 계획의 BCR 준비 조건이 없어 미수행이며 별도 준비 완료 fixture가 필요하다.
- DB 재검증은 미실행이다. 기존 VM Running과 SSH `Host is down`이 함께 확인됐고 로컬 libpq에 서버 바이너리가 없다. 기존 VM/고객 DB를 변경하지 않았다. `artifacts/postgres-revalidation-2026-10-26/`의 증빙과 다음 안전한 복구 단계를 따른다.
- 계약: `docs/CONSTRUCTION-COST-SENSITIVITY-2026.1.md`. 브라우저 증빙: `artifacts/cost-sensitivity-2026-10-26/`. 제품 인수 및 최종 Goal은 계속 미완료다.
- 합성 실제 브라우저에서 미확정 차단, 250만원 테스트 증감, 확인 무효화, 적용/복구/삭제, 형상 변경 후 무효화, 실제 서버 봉인, 인계/보고서 동일 키를 확인했다. 1440px/390px 가로 넘침·page error 0건. 실제 견적/쌍문동 검산 사례가 아니다.
- 계약: `docs/QUANTITY-COST-2026.1.md`. 증빙: `artifacts/quantity-cost-2026-10-26/`. 최종 Goal은 활성이고 외부 검산·실제 DB·역할별 인수·경쟁 제품 동등성 검증은 남아 있다.

## 최대 모델·실제 DB 재검증 (2026-10-26, America/Chicago)

- `quantity-takeoff-2026.2`: 정규화한 전체 원본을 `@noble/hashes` 2.4.0 SHA-256으로 연결한다. 원본은 계획/봉인에 유지하고 입력량 한도도 유지한다. 32층·120세대의 긴 원본 중복 문자열로 인한 통합 검사 거부를 재현·수정했다. 구형 원가 원문 기준은 stale이며 새 범위 확인·미리보기·명시 반영이 필요하다.
- 회귀: 7종 수량의 30개 반복층 비례, 마지막 세대 변경 감지, 원본 보존, 구형 기준 무효화. 독립 코드 검토에서 지적 없음. 실제 브라우저에서 120세대 다운로드/봉인, 32개 재무 비교안 봉인 201·재시도 200·변조 422, 구형 견적 재작성/적용과 면적/주차 불변을 확인했다. page error/가로 넘침 0건, 1440/390 화면 검수.
- `artifacts/scale-validation-2026-10-26/`: 초기 fixture 주방 오류는 `before.json`, 실제 재현은 `baseline.json`, 수정 결과는 `after.json`. 검토 자료 약 1.36MB→0.55MB. 32 비교안 포함 1.27MB. Node24/M2 반복 P95: 수량472ms, 재무667ms, 검토자료1567ms, 서버준비1581ms(각 단계, 합계 아님). 최대 꼭짓점/32개 상세 평면/동시 사용자/모바일 계산 응답성/운영 SLA는 미검증.
- 최신 `pnpm verify`: 1065개 통과 + DB opt-in 1개 제외, lint·타입·Next.js15.5.28 production build 통과. DB 테스트는 별도로 실제 PG18.6에서 초기/재시작/복구 후 각1개 통과했다. 이전 DB 재검증 미실행 상태는 후속 실제 실행으로 진전됐다.
- 공식 소스/checksum을 확인한 PG18.6 임시 빌드, 제한된 앱 역할, migration 멱등성, 11테이블 내용 해시와 복구, 9종 불변 변경과 3종 우회 거부를 검사했다. 기존 잘못된 SQL SET 두 곳의 거짓 통과를 수정하고 causal SQLSTATE55000/정확 메시지·9종 행렬·각각 롤백/전체 내용 불변을 테스트한다. `PARCELGRID_POSTGRES_DISPOSABLE_DATABASE`와 localhost/`pg_native_*`를 확인하는 테스트 안전장치 추가.
- 원본 `artifacts/postgres-native-2026-10-26/`는 보존, 강화 후 증빙은 `artifacts/postgres-native-regression-2026-10-26/`. 두 harness 모두 임시 데이터/서버/백업 정리 완료. 남은 비실행 런타임 `/private/tmp/parcelgrid-pg-native-khvk5Y/install`로 새 격리 환경을 재현 가능하다. 기존 VM/고객 DB는 손대지 않는다. 운영 failover/PITR/RPO/RTO 미완료.
- 보안 patch: Next/eslint-config-next15.5.28, sharp0.35.5, source-map-js1.2.2. native sharp 처리 통과. production audit 8건→High1건. **다음 우선 작업: Zod3.25.76의 GHSA-mrhx-c7xc-m3w5 해결, 수정판4.6.6 이상 전환 및 전체 입력 오류/대용량 회귀 검증.** 모델 사전 한도만으로 모든 API 안전성을 주장하지 않는다. `security-before.json`/`security-after.json` 참조. 출시·보안 완료 아님.
- 최종 Goal 계속 활성. 공식 경계·허가·전문가 승인, 외부 검산/실제 사례10건/역할별 사용자/경쟁 제품 실계정 비교/최종 디자인/실제 홍보 게시 인수는 별도로 남는다.

## JSON 입력·실제 저장 복원 검증 (2026-10-27, America/Chicago)

- 직전 Zod 보안 후속을 처리했다. Zod4.6.6 pin, `z.record`/오류 issue 계약 전환. 누락 숫자/enum은 missing, 제공된 잘못된 값은 conflict/fail로 유지한다. production audit 공개 권고 0건(전체 보안 완료 아님).
- `src/lib/http/bounded-json.ts` 및 `json-request.ts`: 실제 UTF-8 byte 제한, 절대10초 읽기 제한, abort/취소 정리, 깊이48/노드250000 기본값(Workspace500000), 객체 root, 원문 없는 정적 오류. 로그인16KiB/깊이4/노드32, 11개 인증 JSON 경로는 권한 검사 후 읽는다. 기존 도메인/저장 한도 유지. 주소/좌표/취득 입력의 강제 변환과 런타임 형식 오류 보완.
- 실제 HTTP slow-body 시험이 Next15 미들웨어 clone/finalize 대기를 발견했다. API namespace는 matcher에서 제외, 기존 route 권한 검사 유지, readiness에도 명시적 project.read 검사 추가. 21개 private route 모듈의 전체 핸들러 비인증 거부와 `/api`/일반 페이지 matcher 회귀. 로그인/Workspace 실제 중단 스트림 약10.03초에408.
- 실제 Workspace 저장은 canonical key 정렬을 한다. `planningGeometryInputBasis`가 원시 placement 객체를 직렬화해 새로고침만으로 오인 stale이 되는 결함을 발견했다. 다섯 필드를 기존 생성 순서로 명시해 정상 원본 기준과 호환하고 실제 값 변경은 계속 무효화한다. 원본·기존 봉인·승인 이력 재작성 없음.
- 최신 `pnpm verify`: 1313통과+DB opt-in1제외, lint·타입·Next15.5.28 build통과. 이 패스에서 실제 DB 재실행은 없으며 직전 PG18.6 실증은 별도 기록이다. 실제 격리 dev서버 인증·과대/잘못된입력·120세대 저장/재조회/봉인/원본다운로드·32비교안 봉인/재시도·1440/390뷰 통과. 공식 경계·허가·전문 자격 unverified, page error/가로 넘침0. 좁은 모바일 인계 패널 문구는 G07 정비 대상이며 전체 UX 인수 아님.
- 증빙 `artifacts/input-validation-2026-10-26/`: 시작일 경로 유지, 완료일27일. `report.md`, `verify-output.log`, `security-audit.json`, `server-result.json` 및 전후 실패로그/스크린샷. 최종 `verify-server.cjs`는 route mock 없이 임시 credential/file stores 사용·정리. 미들웨어 추가 독립 재검토는 agent quota로 중단됐고 메인이 수정 및 회귀 검증했다.
- 다음 우선순위: source-documents/concept-render의 multipart 선행 `formData()` 버퍼링 제거, 외부 provider 응답 byte/time 제한, JSON exponent overflow가 unknown metadata에서 canonical null로 바뀌기 전 거부 여부 검토, 동시 메모리·reverse proxy 경계 검증. `JSON.parse` 자체는 byte 한도 안의 동기 처리이고 깊이/노드 검사는 그 뒤다. 공개 권고0으로 전체 안전을 주장하지 않는다.
- Main dev 실행 명령은 기존 임시 로컬 작업 경로 유지: `env VWORLD_ENABLED=false DATABASE_URL= SITE_ACCESS_PASSWORD= SITE_ACCESS_ACCOUNTS_JSON= PROJECT_WORKSPACE_STORAGE_DIR=/tmp/parcelgrid-dwelling-qa/workspaces AUDIT_LEDGER_STORAGE_DIR=/tmp/parcelgrid-dwelling-qa/audit pnpm dev --hostname 127.0.0.1 --port 3000`. 보안 QA server3107은 종료. 사용자 소유 기존4318서버는 변경하지 않았다. 목표는 계속 활성, 외부 검산/운영/경쟁 제품/사용자/홍보 인수 미완료.

## 업로드·외부 응답 검증 (2026-10-27, America/Chicago)

- `bounded-body.ts`로 실제 바이트·절대 기한·중단 처리 공통화. JSON exponent overflow는 null 정규화 전에 거부한다. Busboy1.6.0의 `bounded-multipart.ts`로 문서4MiB/참고 이미지10MiB와30초, 허용 필드/중복/형식/전체 전송 한도를 수신 중 적용한다. 기존 auth·도메인 검사·저장·감사 계약을 유지한다.
- `provider-body.ts`: Kakao1MiB, MOLIT 건축물3,000,000bytes/실거래8,000,000bytes 수신 한도와 fetch/body 동일 중단 신호. `concept-render-response.ts`: 본문24MiB/이미지16MiB, base64·PNG 서명·사용량 검사 및 원문 없는 오류. VWorld는 비활성, 이관 미완료다.
- CSV4096바이트 한글 경계의 거짓 거부와 그 이후 잘못된 UTF-8/NUL 누락을 전체 제한 파일 검사로 수정했다. Node24.19 native FormData 스트림 취소의 undici 미처리 오류는 최소 재현으로 확인했고, 제한된 외부 이미지 요청은 native 인코더로 완전한 ArrayBuffer를 만든 뒤 전송한다. 테스트도 실제 수신 바이트를 사용하며 취소/오류를 숨기지 않는다.
- 최신 `pnpm verify`: 1389통과+실제DB opt-in1제외, lint·타입·build통과. DB는 이번에 재실행하지 않았고 직전 PG18.6 실증은 별도다. production audit 공개 권고0건, 보안 완료 아님. 추가 독립 에이전트 검토는 사용량 한도로 미실행.
- 실제 Next3108 업로드: chunked 정상 CSV201/원본다운로드 일치, 크기초과413, 중단문서30.030초/참고이미지30.058초408, 실패 후 문서·렌더·감사 불변 및 provider 요청0건. 실제 로컬 provider HTTP는 gzip 해제 바이트 한도와 시간초과/오류 취소 연결 종료 통과. 유료 이미지 생성 없음.
- 공통 reader 변경 후 실제 Next3107에서120세대 저장/복원/봉인/원본다운로드,32비교안 봉인201·재시도200,1440/390뷰 재확인. 공식 경계·허가·전문 자격 unverified, page error/가로넘침0. 모바일 인계 설명 열은 G07 개선 대상으로 남김.
- 증빙 `artifacts/upload-provider-validation-2026-10-27/report.md`, 자동검증/실제HTTP/브라우저결과 및스크린샷. QA서버·임시데이터 정리, 기존3000개발서버 복원과status200확인, 사용자4318서버 미변경.
- 외부 검산 준비서 `docs/EXTERNAL-VALIDATION-BRIEF-2026.1.md`: 분야별 산출물·자료·검산표·권한/발주 조건. 사용자에게 보유 검토자/자료 여부를 물었으나 아직 답 없음. 계약/자료 외부전송/전문가 검산을 실행한 것으로 표시하지 않는다.
- 다음 우선순위: 남은 VWorld 어댑터 한도 및 XML 구조 제한 검토, 동시 요청 메모리/CPU·운영 gateway 검증. 파일 의미/악성코드/픽셀검사, 다중인스턴스 제한, 실제 provider계약·전체공종·전문가·경쟁제품·사용자·디자인·홍보 인수는 별도 남음. 최종 Goal 활성 유지.

## Provider 구조·동시 처리 검증 (2026-10-27, America/Chicago)

최신 후속은 주변 복합 경계 전체 연결이다. `artifacts/context-topology-2026-10-27/report.md` 참조. shared `parcel-topology.ts`/`parcel-topology-geometry.ts`, optional authoritative polygons(명시적 invalid일 때 legacy fallback 금지), provider 전체 조각/홀·순면적·최단거리, cadastral-context-v3·alignment-v2·delivery-audit-v3. 실제 full topology로 도로 간격/침범/폭, union 기반 건물 포함률, 3D 및 DXF/GeoJSON/DAE 처리. target 자체는 여전히 단일 외곽선/manual-review이며 이 제한을 최종 범위 축소로 보지 않는다. 원본/출력 source binding과 invalid export 차단, 1e-6m grid triangulation+float32 receiver/watertight checks. 계산별2초 cooperative budget은 Turf 선점/전체SLA 보장이 아님. API request.signal/12초budget, 실패null-count·정상empty 분리, 경고 표시/잘못된 source default·UPIS metadata·미확인 clearance·download 오류 보완. 독립 agent3개 모두 종료. 전체1818통과+DB opt-in1제외/lint·타입·build통과. 합성 FreeCAD1.1.4 실제 import/FCStd/재출력 통과, 도로4mesh 순면적274㎡/퇴화0/solid, DXF3neighbor그룹각outer2/hole3/net137㎡. 최신 실제DB 재실행 없음. PC1440/모바일390 정상·실패3D검증은 browser-result.json/PNG; public font GET만 허용, 외부데이터/쓰기차단. source/filehash와 native evidence 보존. 다음: 대상 복합 필지 intake/planning/3D/면적·사업성/CAD전체 지원 및 provider pagination/완전성. 실제provider·실사례10·외부검산·사용자/경쟁제품·운영/디자인/홍보 인수 미완료. 공식경계·허가·전문가승인미확정,Goal활성. 아래는직전기록이다.

최신 후속: `artifacts/cadastral-runtime-2026-10-27/report.md`. PNU 전체 식별/미확인 산 여부와0본번 거부, 후보 모호성·좌표 포함 검사, 속성/단가 검증, 전체2D조각·holes 보존/manual-required GeoJSON, 분리도로 유지/동일XY 도로 거부. nearby는 대상PNU를 topology검사 전에 제외하고 경도검색폭 보정. registry 처리6/대기24/페이지8초/lookup25초, nearby worker3/최대12/전체35초·caller cancel·부분/미조회 증빙. 독립검토에서5건(교차점 메모리/CPU폭증, 산 여부 오인, 제외순서, 퇴화도로 성공, 미세교차수치비교)을 수정·재검토. 기존 first-crossing 검사 재사용+1024쌍마다 monotonic deadline, epsilon 개별 부호 비교. `planning-geometry-v3`로 hash/모델 변경: 구v2 전분야 재검토, 기존 원본/재무/이력 미변경. 전체1648통과+DB opt-in1제외/lint·타입·build통과. 실제localhost HTTP33요청/registry peak6/잔여0/35.013초 종료, 외부0; PC1440/모바일390 다운로드/공식면적미반영/재업로드보류/가로넘침·pageerror0. 합성geometry8probe와sourcehash 보존; 10000점 smooth O(n²)는부하따라1.81초,100ms기한100.52ms로 중단(운영SLA아님). Main3000복원, Helmholtz닫음. 다음: 복수조각·holes를 intake/planning/context/3D/재무면적대사/CAD전체지원, 타context/UPIS첫링선택제거, 조회pagination/완전성, malformed source와network분류. 거부/보존만으로최종범위를축소하지않음. 실제provider/전문가/사용자/경쟁제품/운영/디자인/홍보인수남음. 공식경계·허가·전문가승인미확정,Goal활성. 아래는직전기록이다.

후속 완료 기록: `artifacts/provider-runtime-2026-10-27/report.md`. MOLIT 처리6/대기64/동일페이지 구독64, LRU256개·직렬화16MiB, 페이지15초/범위30초·60개월·월worker3·5만행/32MiB. 캐시 원본 수집시각 유지, 취소 구독 삭제/마지막 구독 upstream abort, 4개 API request.signal 연결. Kakao8초·registry페이지8초/전체25초 절대기한. provider 페이지번호/페이지크기/정확한 행수 검증 후 캐시, cross-page 불일치 월 캐시 무효화. 독립 검토의 반복페이지 거짓완료/오류캐시 복구차단/취소콜백 누적3건 수정 및 최종재검토 지적없음. VWorld 선택적 도로 실패는 cadastral 성공+unavailable/null count, 주변필지 실패502/비활성503/정상빈결과200. 등록 경고와 DataRow 최소 열 너비 보완. 전체1592테스트 통과+DB opt-in1제외, lint·타입·build통과. 실제localhost HTTP 취소·포화·15초기한·복구 및1440/390합성UI 통과, 실제외부호출0. 운영전체heap·다중인스턴스/route admission·nearby최대12개 순차대장 전체기한·다중polygon/holes/속성·조회완전성·전문가/사용자/경쟁제품/디자인/홍보 인수는 남음. 공식경계·허가·전문승인 미확정, Goal활성. 아래는 직전 단계 기록이다.

- VWorld 모든 서버 경로(실사용 `vworld-buildings-client.ts` 포함)를 `vworld-response.ts`에 연결. 본문4MiB/NED1MiB, JSON 구조, 데이터셋별 도형·유한 위치·폐합·feature200/geometry꼭짓점10000 한도. WFS OUTPUT/BBOX·축 반전 호환 유지. 네트워크/provider 원문·cause 반사 없음.
- `provider-concurrency.ts`: VWorld 프로세스 로컬 처리4개+대기16개, 포화 거부/대기 만료 제거/실패 슬롯 복구. 진입 시점 monotonic deadline을 대기·헤더·본문·스키마에 연결. 동기JS 선점 중단·다중인스턴스 공유 quota 아님.
- MOLIT XML: UTF-8 8,000,000바이트/element100000/root-inclusive깊이32. fast-xml-parser MatcherView/콜백 제한 후 syntax validator. 건축물대장 unknown필드 JSON 구조/숫자 검사, 기존 정상페이지partial 유지.
- 독립 Godel 검토의4개 P2를 수정: 잘못된 좌표→성공빈결과, timer 정체시기한초과성공, XML사전validator 무제한stack, 다른dataset도형→성공빈결과. 회귀추가·최종재검토 잔여지적없음, agent종료. 전체보안/전문가검산 대체아님.
- 최종 `pnpm verify`:1464통과+실제DB opt-in1제외, lint·타입·build통과. 신규75개(VWorld50/XML·registry15/admission10). 이번 실제DB/새 브라우저UI QA 미실행, 직전증빙 별도.
- 실제 localhost HTTP1/6/16동시·포화·만료·후속복구·잘못된도형거부 통과, 외부provider요청0. 16동시4MiB근접응답 표본 RSS497.92→374.25MiB/P95149.06→130.34ms. 중간성공 RSS392~437MiB 변동도있으며 Vite/서버포함5ms샘플·명시GC 단일기기표본, 운영상한/개선율보장아님.100000중첩XML은syntaxvalidator전에거부.
- 증빙 `artifacts/provider-structure-load-2026-10-27/report.md`, baseline/after-admission/result/during-verification JSON, `verify-load.mjs`, `verify-final.log`. 마지막result는전체verify종료후, during-verification은성능비교제외. Main dev3000복원(VWorld비활성), 사용자4318미변경.
- 다음: MOLIT 기존무제한대기열/캐시와 다른provider절대기한·실패증빙, optional도로/주변필지 빈fallback구분, 복수polygon/holes/roadparts·속성·조회완전성 검증. 이후 실제운영gateway/지속부하/다중인스턴스 및 전체공종·외부검산·사용자/경쟁제품·디자인·홍보 인수. 최종Goal활성, 공식경계·허가·전문가승인미확정.
