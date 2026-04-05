# MPP Release Distribution Plan

## 0. 제품 UX 기준선 (Room Model)

배포 문서와 온보딩은 아래 흐름을 기준으로 유지합니다.

- Driver: sender 실행 -> Relay/Telemetry 설정 -> Room 생성 -> 링크/Password/Permission Code 공유
- Engineer: pitwall 접속 -> Room 선택 -> Password/Permission Code 입력 -> Join Room

내부에서는 기존 `sessionId/joinCode/shareEnabled/visibility`를 유지하되,
사용자에게는 `Room Title/Password/Permission Code`를 우선 노출합니다.

## 1. 배포 역할 분리

MPP 배포는 다음 두 계층으로 분리합니다.

- GitHub Pages: Driver/Engineer Room 워크플로, 다운로드 UX, 설치 안내, FAQ
- GitHub Releases: 실제 실행 파일(.exe) 호스팅

즉, 사용자는 Pages에서 다운로드 버튼을 누르고, 실제 파일은 Releases에서 받습니다.

## 2. 현재 링크 정책

Pages의 다운로드 버튼은 최신 릴리스 자산 경로를 사용합니다.

- 설치형: releases/latest/download/MPP-Setup.exe
- 포터블: releases/latest/download/MPP-portable.exe
- 폴백: releases/latest 페이지

릴리스에 자산명이 바뀌면 docs/assets/site.js의 installerAsset, portableAsset만 교체하면 됩니다.

중요: GitHub가 자동으로 생성하는 `Source code (zip/tar.gz)`는 설치 파일이 아닙니다.
실제 사용자 다운로드 동선은 반드시 `MPP-Setup.exe` 또는 `MPP-portable.exe` asset 업로드를 전제로 합니다.

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

## 7. Public Relay 배포 템플릿

원격 네트워크 사용자 협업을 위해 Relay를 공용 endpoint로 띄울 때는 아래 env를 우선 설정합니다.

```bash
RELAY_WS_PORT=4000
VIEWER_HTTP_PORT=4100

RELAY_PUBLIC_URL=https://mpp-relay.example.com
RELAY_PUBLIC_WS_URL=wss://mpp-relay.example.com
RELAY_LABEL=public-relay

RELAY_ENABLE_DEBUG_HTTP=false
RELAY_ENABLE_CORS=true
RELAY_ALLOWED_ORIGINS=https://mpp-relay.example.com,https://ops.example.com
```

노출 정책:

- Public 노출: `VIEWER_HTTP_PORT`, `RELAY_WS_PORT` (프록시 뒤에서 TLS 종단)
- 기본 비노출: `RELAY_DEBUG_HTTP_PORT` (`RELAY_ENABLE_DEBUG_HTTP=true`일 때만)

공유 정책:

- Host 화면 공유 링크는 절대 URL(`RELAY_PUBLIC_URL` 기반)로 생성
- 외부 사용자에게는 joinCode 단독이 아니라 relay endpoint + joinCode 형태 링크 전달 권장

## 8. Portable + UDP + HUD 구현/검증 계획

이번 배포부터 아래 항목을 기본 품질 게이트로 유지합니다.

### 8-1. 포터블 실행 검증 절차

1. `MPP-portable.exe` 실행 후 `/rooms` 자동 진입 확인
2. `/healthz`, `/diagnostics` 응답 확인
3. 확인 필드
  - embedded agent 시작 여부
  - UDP bind 성공 여부 / bind error
  - 최근 10초 패킷 수
  - 마지막 packetId/sessionUID
  - 마지막 parse 성공 시각 / parse 실패 횟수
  - publicDir 경로 / 핵심 자산 존재 여부(`overlay.html` 포함)

### 8-2. 게임 UDP 연동 검증 절차

1. 게임 Telemetry UDP On, 포트 `20777` 설정
2. 주행 중 `/diagnostics`의 `recentPackets10s` 증가 확인
3. 세션 전환 시 `lastSessionUID` 갱신 확인
4. 파싱 실패 상황에서 `parseFailureCount` 증가 확인

### 8-3. 오버레이 클릭스루/투명 배경 검증 절차

1. Browser surface: `/overlay/:sessionId?preset=broadcast|engineer_compact|driver_hud`
2. Native HUD surface: `/hud/:sessionId?preset=driver_hud&surface=native`
3. Native HUD 창 속성 확인
  - transparent
  - frameless
  - always-on-top
  - skipTaskbar
  - focusable false
4. 클릭스루 토글 확인
  - `Ctrl+Shift+F10` 클릭스루 토글
  - `Ctrl+Shift+F11` 표시/숨김 토글
