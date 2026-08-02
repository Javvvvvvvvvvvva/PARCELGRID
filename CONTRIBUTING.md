# PARCELGRID 협업 규칙

## 작업 시작

```bash
git switch master
git pull --ff-only
git switch -c feature/짧은-작업명
pnpm install --frozen-lockfile
```

한 브랜치에는 한 목적만 담습니다. `.env.local`, API 키, 원문 계약서, `.parcelgrid-data`는 커밋하지 않습니다.

## 완료 기준

```bash
pnpm verify
```

Pull Request에는 변경 이유, 직접 확인한 화면, 남은 제약을 적습니다. 계획·내보내기 변경은 다음 항목도 확인합니다.

- 화면·DAE·DXF가 같은 `projectId`, Geometry Hash, 원점, meter 단위를 쓰는가
- 층수·층별 외곽선·후퇴·배치·회전이 의도 없이 바뀌지 않았는가
- 주차면·통로가 화면·SketchUp·CAD에서 같은 Parking Geometry Hash를 쓰는가
- 도로 폭이나 법규값을 출처 없이 만들어 내지 않았는가
- 사실, 추천, 사용자 가정이 화면과 보고서에서 구분되는가

## 합치기

```bash
git add -A
git commit -m "feat: 변경 요약"
git push -u origin HEAD
```

GitHub에서 Pull Request를 열고 Verify 체크가 통과한 뒤 합칩니다. 실패한 체크를 우회해 master에 직접 푸시하지 않습니다.
