# Take-out Underwriting Contract 2026.1

> 역사 버전이다. 현행 계약은 `TAKEOUT-UNDERWRITING-2026.2.md`를 따른다.

## 목적

임대 수익이 있는 개발안의 안정화 NOI가 장기대출 원리금을 감당하는지, 그리고 수수료를 차감한 대출 순유입액으로 안정화 시점 PF 원금을 상환할 수 있는지를 분리해 계산한다.

모델 버전은 `takeout-underwriting-2026.1`이다. 이 결과는 금융기관 승인이나 대출 실행 확약이 아니다.

## 필수 입력

| 입력 | 단위 | 역할 |
|---|---:|---|
| 안정화 자산가치 | 만원 | LTV 한도의 담보가치 |
| 안정화 연간 NOI | 만원/년 | DSCR 한도의 상환재원 |
| 안정화 직전 PF 원금 | 만원 | 재융자 상환 필요액 |
| 최대 LTV | % | 담보가치 기준 상한 |
| 장기대출 연 금리 | % | 월 원리금 산정 |
| 원리금 상환기간 | 년 | 월 원리금 산정 |
| 최소 DSCR | 배 | NOI 기준 대출 상한 |
| 대출 확약액 | 만원 | 계산 한도와 별도의 실제 입력 상한 |
| 취급·약정 수수료율 | % | PF 상환에 쓸 수 있는 순유입 차감 |

최대 LTV, 금리, 상환기간, 최소 DSCR 중 하나라도 0이거나 유효하지 않으면 `terms-missing`이며 DSCR을 표시하지 않는다. 대출 확약액 0은 계산을 허용하되 `modeled-unverified`로 남긴다. 수수료율 0은 원문으로 확인된 무수수료 조건일 수 있다.

## 계산식

연 금리를 `i`, 월 금리를 `r = i / 12`, 상환 개월 수를 `n = 상환기간 × 12`, 대출원금을 `L`이라 한다.

```text
월 원리금 = L × r × (1 + r)^n / ((1 + r)^n - 1)
연간 원리금 = 월 원리금 × 12
LTV 한도 = 안정화 자산가치 × 최대 LTV
DSCR 한도 = 안정화 NOI / 최소 DSCR / 원금 1만원당 연간 원리금
계산 가능액 = min(LTV 한도, DSCR 한도)
모델 대출액 = 확약액이 있으면 min(계산 가능액, 확약액), 없으면 계산 가능액
수수료 = 모델 대출액 × 수수료율
순유입액 = 모델 대출액 - 수수료
재융자 부족액 = max(안정화 직전 PF 원금 - 순유입액, 0)
DSCR = 안정화 NOI / 모델 대출액의 연간 원리금
Debt yield = 안정화 NOI / 모델 대출액
```

금리가 0인 특수 계산식은 원금을 전체 상환 개월 수로 균등 분할하지만, 소스 데이터 게이트는 금리 0을 유효한 장기대출 조건으로 인증하지 않는다.

## 상태 계약

| 상태 | 의미 |
|---|---|
| `not-applicable` | 안정화 임대가치 또는 NOI가 없어 장기대출 검토 비적용 |
| `terms-missing` | LTV·금리·상환기간·최소 DSCR 중 필수 조건 누락 |
| `modeled-unverified` | 계산 한도는 있으나 대출 확약액 미확인 |
| `commitment-feasible` | 입력 확약액을 적용한 순유입액이 PF 상환 필요액 이상 |
| `commitment-shortfall` | 입력 확약액을 적용해도 PF 상환 필요액 부족 |

`commitment-feasible`은 숫자 입력 결과다. 금융기관 Term Sheet 또는 대출약정 원문이 소스 데이터 게이트를 통과해야만 근거 확인 상태가 된다.

## 소스 데이터 게이트

임대 수익이 있는 안은 다음 여섯 필드를 금융기관 Term Sheet 또는 대출약정서에 연결해야 한다.

1. 최대 LTV
2. 장기대출 금리
3. 원리금 상환기간
4. 최소 DSCR
5. 대출 확약액
6. 취급·약정 수수료율

문서 원본, 발급기관, 문서 참조, 기준일, 확인자와 등록일이 모두 있어야 `source-backed`로 인정한다.

## 현재 경계

1. 현재 임대 시나리오의 기본 손익·NPV·IRR은 안정화 후 자산가치를 매각 회수하는 개발 원장이다. 장기대출 실행액과 이후 보유 현금흐름은 이 기본 지표를 바꾸지 않고 `hold-period-ledger-2026.1` 별도 대안 원장에만 반영한다.
2. 거치기간, 이자-only 구간, 만기 일시상환, 변동금리, 이자율 캡, 상환준비금과 covenant cure는 아직 지원하지 않는다.
3. 감정평가 조정, 대출 법무비, 담보 설정비, 예치금과 세금·보험 escrow는 아직 포함하지 않는다.
4. PF 상환 필요액은 안정화 월의 수입 상계 직전 PF 원금이며, PF 조기상환 수수료나 미지급 이자는 별도다.
5. `hold-period-ledger-2026.1`은 임대료 면제, 임차인 공사비, 중개수수료, 제한 보증금, 월별 운영비, 교체 준비금, 대수선과 매각비를 반영한다. 세금과 임차인 교체·갱신은 아직 미산정이다.

## 기준 자료

- [OCC Commercial Real Estate Lending Handbook](https://www.occ.treas.gov/publications-and-resources/publications/comptrollers-handbook/files/commercial-real-estate-lending/pub-ch-commercial-real-estate.pdf): DSCR, debt yield, 직접환원과 상환구조 검토 원칙
- [FDIC Commercial Real Estate Lending](https://www.fdic.gov/risk-management-manual-examination-policies/commercial-real-estate-lending): 최소 DSCR·LTV, take-out 확약과 재융자 상환재원 검토 원칙
- [Fannie Mae Underwritten DSCR](https://mfguide.fanniemae.com/node/1541): 상환기간을 적용한 level debt service 기반 DSCR
- [Fannie Mae Permanent Loan Final Underwriting](https://mfguide.fanniemae.com/node/15676): 약정 DSCR·LTV 충족 확인
- [OCC Commercial Real Estate Refinance Risk](https://occ.treas.gov/news-issuances/bulletins/2024/bulletin-2024-29.html): 만기·재융자 위험 관리 원칙
