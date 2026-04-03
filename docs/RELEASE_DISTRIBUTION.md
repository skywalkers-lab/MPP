# MPP Release Distribution Plan

## 1. 배포 역할 분리

MPP 배포는 다음 두 계층으로 분리합니다.

- GitHub Pages: 제품 소개, 다운로드 UX, 설치 안내, FAQ
- GitHub Releases: 실제 실행 파일(.exe) 호스팅

즉, 사용자는 Pages에서 다운로드 버튼을 누르고, 실제 파일은 Releases에서 받습니다.

## 2. 현재 링크 정책

Pages의 다운로드 버튼은 최신 릴리스 자산 경로를 사용합니다.

- 설치형: releases/latest/download/MPP-Setup.exe
- 포터블: releases/latest/download/MPP-portable.exe
- 폴백: releases/latest 페이지

릴리스에 자산명이 바뀌면 docs/assets/site.js의 installerAsset, portableAsset만 교체하면 됩니다.

## 3. 릴리스 업로드(수동)

현재 1차 단계는 수동 업로드를 기준으로 동작합니다.

1. GitHub에서 새 Release 생성
2. MPP-Setup.exe, MPP-portable.exe 업로드
3. 릴리스 노트 작성
4. Pages 버튼으로 즉시 다운로드 가능

## 4. .exe 패키징 전략

현재 저장소는 Node/Express/Relay 기반 구조이며 브라우저 UI를 제공하는 서버형 앱입니다.
직접 실행 가능한 .exe 제공을 위해 데스크톱 셸 또는 런타임 번들링이 필요합니다.

### 후보

- Electron
  - 장점: Node + Chromium 동봉으로 호환성이 높음
  - 장점: 기존 웹 UI를 거의 그대로 데스크톱에 탑재 가능
  - 단점: 빌드 결과물이 큰 편

- Tauri
  - 장점: 결과물 크기가 상대적으로 작고 리소스 사용이 낮음
  - 장점: Rust 기반 보안 모델
  - 단점: 러닝커브와 브리지 설계 필요

### 권장 1차

- 단기: Electron 기반 설치형/포터블 패키지 도입
- 중기: 필요 시 Tauri로 재평가

## 5. 향후 자동화 방향 (GitHub Actions)

목표 흐름:

1. 태그 푸시 또는 Release 생성
2. Windows 빌드 수행
3. .exe 산출물 업로드 (Release Assets)
4. Pages는 동일 링크 구조 유지 (latest/download/...)

링크 구조가 고정되어 있으면 Pages 콘텐츠를 수정하지 않고도 릴리스만 교체할 수 있습니다.

## 6. 운영 체크리스트

- 릴리스 자산 파일명 고정: MPP-Setup.exe, MPP-portable.exe
- SmartScreen 안내 문구 유지
- 릴리스 노트 링크 최신 상태 유지
- 버전 표기 갱신: docs/assets/site.js
