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

- 권장 단일 실행 파일: releases/latest/download/MPP-Desktop.exe
- 호환 자산: releases/latest/download/MPP-Setup.exe
- 호환 자산: releases/latest/download/MPP-portable.exe
- 폴백: releases/latest 페이지

릴리스에 자산명이 바뀌면 docs/assets/site.js의 desktopAsset만 교체하면 됩니다.

중요: GitHub가 자동으로 생성하는 `Source code (zip/tar.gz)`는 설치 파일이 아닙니다.
실제 사용자 다운로드 동선은 반드시 `MPP-Desktop.exe` asset 업로드를 전제로 합니다.

## 3. 릴리스 업로드(수동)

현재 1차 단계는 수동 업로드를 기준으로 동작합니다.

1. GitHub에서 새 Release 생성
2. MPP-Desktop.exe 업로드
3. 구버전 링크 호환이 필요하면 MPP-Setup.exe, MPP-portable.exe도 함께 업로드
3. 릴리스 노트 작성
4. Pages 버튼으로 즉시 다운로드 가능

## 4. .exe 패키징 전략

현재 릴리스는 `pkg` 기반 단일 Windows 실행 파일 전략을 사용합니다.

- `MPP-Desktop.exe`
  - Local Control Panel을 브라우저로 열어 첫 실행 설정을 처리
  - Driver 모드에서는 로컬 UDP 20777을 수신하고 Render Relay로 업링크
  - Engineer 모드에서는 같은 실행 파일로 Render Rooms 페이지만 바로 열기
  - 설정은 사용자 프로필 config 폴더에 저장되어 다음 실행부터 자동 모드 진입 가능

- `MPP-Setup.exe`, `MPP-portable.exe`
  - 현재는 기존 다운로드 링크 호환을 위한 동일 바이너리 별칭

## 5. 향후 자동화 방향 (GitHub Actions)

목표 흐름:

1. 태그 푸시 또는 Release 생성
2. Windows 빌드 수행
3. .exe 산출물 업로드 (Release Assets)
4. Pages는 동일 링크 구조 유지 (latest/download/...)

링크 구조가 고정되어 있으면 Pages 콘텐츠를 수정하지 않고도 릴리스만 교체할 수 있습니다.

## 6. 운영 체크리스트

- 릴리스 자산 파일명 고정: MPP-Desktop.exe
- 구버전 링크 호환 시 추가 업로드: MPP-Setup.exe, MPP-portable.exe
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

## 8. Desktop Launcher 검증 계획

이번 배포부터 아래 항목을 기본 품질 게이트로 유지합니다.

### 8-1. 런처 실행 검증 절차

1. `MPP-Desktop.exe` 실행 후 Local Control Panel 오픈 확인
2. Public Viewer URL 저장 후 `Engineer 열기`가 Render `/rooms`를 여는지 확인
3. Launch Mode를 `Engineer 자동 열기`로 저장 후 재실행 시 바로 Rooms가 열리는지 확인
4. Launch Mode를 `Driver 자동 시작`으로 저장 후 재실행 시 Sender + Rooms가 같이 뜨는지 확인

### 8-2. 게임 UDP 연동 검증 절차

1. 게임 Telemetry UDP On, 포트 `20777` 설정
2. Driver Sender 시작 후 Local Control Panel의 `UDP packets/10s` 증가 확인
3. `Relay 연결`, `Session ID`, `Bind 상태`가 정상 값으로 바뀌는지 확인
4. 세션 전환 시 `lastSessionUID`와 Session ID가 안정적으로 유지되는지 확인
