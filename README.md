# Remote Viewer / Session Ops Guide

## Windows 빠른 설치

- 다운로드 페이지: [docs/index.html](docs/index.html)
- 최신 릴리스: https://github.com/skywalkers-lab/MPP/releases/latest
- 설치형(.exe): https://github.com/skywalkers-lab/MPP/releases/latest/download/MPP-Setup.exe
- 포터블(.exe): https://github.com/skywalkers-lab/MPP/releases/latest/download/MPP-portable.exe

주의: `Source code (zip/tar.gz)`는 설치 파일이 아닙니다. Windows 사용자는 반드시 `.exe` 자산을 받으세요.

Windows `.exe`를 실행하면 기본 브라우저에서 대시보드(`/ops`)를 자동으로 엽니다.
자동 오픈을 끄려면 실행 환경에서 `MPP_AUTO_OPEN_DASHBOARD=false`를 설정하세요.

대시보드가 열리지 않으면 먼저 `http://localhost:4100/ops?preset=ops`를 수동으로 열어 확인하세요.
그래도 접속이 안 되면 앱을 다시 실행하고, 로컬 보안 정책(방화벽/백신)에서 로컬 포트 접근이 차단되지 않았는지 확인하세요.

## Product Value Snapshot

MPP는 단순 텔레메트리 뷰어가 아니라, 아래 세 가지를 동시에 제공하는 운영 도구입니다.

- 실시간 전략 판단: recommendation + alternative + reasons + confidence/stability
- 운영 제어면: Host/Ops에서 세션 health, 공유 정책, 전략 변화 추세를 관리
- 복기 분석: Archive/Replay에서 snapshot 시점 전략 근거를 타임라인으로 재검증

## 1. 실행

```bash

```

- Relay WebSocket: `4000`
- Relay Debug HTTP: `4001`
- Viewer HTTP: `4100` (환경변수 `VIEWER_HTTP_PORT`로 변경 가능)

## 2. 현재 단계 목표

현재 단계는 **Streaming / Overlay / Broadcast Polish (12단계)** 입니다.

- Discord OAuth 로그인
- Discord 계정 연동
- Discord bot control plane
- guild/role 연동
- Discord identity 기반 권한 모델

위 항목은 모두 **보류** 상태입니다.

이번 단계의 핵심은 live/ops/host/archive 시스템을 방송·운영·복기 목적에 맞게 다듬는 것입니다.
새로운 대형 백엔드 기능이 아닌, **presentation layer polish**가 목표입니다.
구체적으로:
- `/overlay/:sessionId` — 방송/화면 공유용 전용 surface (read-only, compact, OBS 친화적)
- `/overlay/join/:joinCode` — joinCode 기반 방송용 진입 surface (shareEnabled/visibility 정책 동일 적용)
- `/ops` polish — session health badge, heartbeat age, overlay 직접 링크
- `/archives` polish — finalize reason chip, timeline 배지, snapshot focus 구조화, 검색 필터
- session health 4단계 시각화 (`healthy / delayed / stale_risk / stale`) + freshness bar (`heartbeat / snapshot / relay`)
- role-based presentation preset (`broadcast / ops / host / replay`) 지원

## 3. Access 모델 (Session-Centric)

이 시스템은 사용자 계정보다 **세션 상태**를 우선합니다.

- 내부 식별자: `sessionId`
- 외부 초대 코드: `joinCode`
- 공유 토글: `shareEnabled`
- 공유 정책: `visibility` (`private` | `code`)

즉, "누가 로그인했는가"보다 "이 세션이 지금 공유 가능한가"를 기준으로 동작합니다.

## 4. Host / Internal 운영 흐름

### 4-1. 세션 목록 확인

- `http://localhost:4001/relay/sessions`
- 각 세션의 `sessionId`, 상태, access metadata(`joinCode`, `shareEnabled`, `visibility`)를 확인할 수 있습니다.

### 4-2. Host Control 페이지

- `http://localhost:4100/host/SESSION_ID`

이 페이지에서 운영자는 다음을 수행할 수 있습니다.

- 현재 `sessionId` 확인
- 현재 `joinCode` 확인 및 복사
- join URL 복사 (`/join/:joinCode`)
- `shareEnabled` on/off 제어
- `visibility` 전환 (`private` / `code`)
- Session Notes 작성/조회/삭제 (`authorLabel`, `category`, `lap`)
- Session Timeline에서 ops events + notes 시간축 확인
- Strategy card에서 primary/alternative recommendation, 이유, confidence/stability, trend reason 확인
- v2 metric(undercut, overcut, traffic, degradation, pit loss heuristic, compound bias, rejoin band, clean air) 확인
- snapshot 없음/stale 상태일 때 추천 중단 사유 확인
- `/archives` 링크로 이동해 종료된 세션의 replay timeline 복기 가능

### 4-3. Session Ops Control Plane

- `http://localhost:4100/ops`

이 페이지에서 운영자는 다음을 한 화면에서 확인할 수 있습니다.

- `sessionId`, `joinCode`
- `relayStatus`, `viewerStatus`
- **session health badge** (`healthy / delayed / stale_risk / stale`) — heartbeat 수신 간격 기반
- heartbeat age (몇 초 전 수신인지 직관적 표시)
- `shareEnabled`, `visibility`, `hasViewerAccess`
- `noteCount`, 최근 note preview
- `latestSequence`, `lastHeartbeatAt`, `updatedAt`
- stale/active/closed 상태 시각 구분 + stale_risk 행 강조
- 세션별 `/host/:sessionId` 및 **`/overlay/:sessionId`** 바로 이동
- 세션별 `/overlay/join/:joinCode` 바로 이동 (외부 송출 링크 공유용)
- `/archives` 이동 링크를 통해 replay/archive plane 접근

### 4-4. Archives / Replay 페이지

- `http://localhost:4100/archives`

이 페이지에서 운영자는 다음을 수행할 수 있습니다.

- archive summary 목록 확인 — session 검색 필터 포함
- finalize reason chip 확인 (`session_stale` / `server_shutdown`) — 어떻게 아카이브가 종료되었는지 즉시 파악
- snapshot/ops/note count 한눈에 확인
- 세션별 archive summary 상세 확인
- unified timeline에서 `snapshot`(파랑) / `ops_event`(초록) / `note`(황색) 배지로 구분
- timeline의 snapshot 항목 클릭 시 해당 시점의 lap, position, tyre, fuel, ERS, recommendation/alternative/confidence/stability/reasons 구조화된 focus 카드로 확인

### 4-5. Overlay / Broadcast 페이지 (12단계 신규)

- `http://localhost:4100/overlay/:sessionId`
- `http://localhost:4100/overlay/join/:joinCode`

Overlay는 **read-only broadcast surface**입니다.
用途:
- 방송/스트리밍 화면 공유 시 race telemetry를 compact하게 표시
- OBS Studio, Streamlabs 등 화면 캡처 도구에서 overlay로 사용 가능
- `/ops`나 `/host`와 달리 write action 없음 — 순수 관전용

표시 정보:
- session health chip (healthy/delayed/stale_risk/stale)
- LAP / POSITION / TYRE compound + age / FUEL laps remaining / ERS 레벨
- Strategy primary recommendation + alternative + severity
- 2초 poll 자동 갱신
- `shareEnabled=false` 또는 `visibility=private` 상태에서는 joinCode 기반 overlay 접근 거부

## 5. External Viewer 흐름 (Read-Only)

외부 사용자는 joinCode 링크로 접속합니다.

- `http://localhost:4100/join/JOINCODE`

Viewer는 끝까지 read-only 입니다.

- write action 없음
- role 선택 없음
- note/전략 수정 없음 (host 내부 제어면에서만 notes 작성)

### viewer 상태

- `waiting`: 호스트 연결, 아직 스냅샷 없음
- `live`: 최신 스냅샷 표시 중
- `stale`: 호스트 연결 끊김, 마지막 상태 표시
- `ended`: 세션 종료

### access 오류 상태

- `invalid_code`: 유효하지 않은 joinCode
- `not_shared`: 공유 비활성 또는 `visibility=private`

Viewer 화면에서 access 오류와 relay lifecycle 상태를 구분해서 표시합니다.

## 6. API 요약

### Viewer API

- `GET /api/viewer/ops/sessions`
  - control plane용 세션 운영 요약 목록
- `GET /api/viewer/ops/events/recent?limit=50`
  - 최근 운영 이벤트 목록
- `GET /api/viewer/notes/:sessionId`
  - 세션 노트 목록 조회
- `POST /api/viewer/notes/:sessionId`
  - 세션 노트 생성 (text 필수, 길이 제한/필드 검증)
- `DELETE /api/viewer/notes/:sessionId/:noteId`
  - 세션 노트 삭제
- `GET /api/viewer/timeline/:sessionId?limit=100`
  - ops events + session notes 통합 타임라인
- `GET /api/viewer/strategy/:sessionId`
  - 세션 스냅샷 기반 비교형 룰 전략 추천(v2)
  - 추천 가능: `recommendation`, `primaryRecommendation`, `secondaryRecommendation`, `severity`, `confidenceScore`, `stabilityScore`, `recommendationChanged`, `trendReason`, `reasons`, `signals`, `generatedAt`
  - v2 signals: `undercutScore`, `overcutScore`, `trafficRiskScore`, `degradationTrend`, `pitLossHeuristic`, `compoundStintBias`, `expectedRejoinBand`, `cleanAirProbability`
  - 추천 불가: `strategyUnavailable=true`, `reason` (`no_snapshot`, `session_stale`, ...)
- `GET /api/viewer/archives`
  - 종료된 세션 아카이브 summary 목록 반환
- `GET /api/viewer/archive/:sessionId`
  - 특정 세션 아카이브 상세 반환 (`snapshots`, `opsEvents`, `notes`, `summary`)
- `GET /api/viewer/archive/:sessionId/timeline?limit=500`
  - replay용 unified timeline 반환 (`snapshot | ops_event | note`)
- `GET /api/viewer/archive/:sessionId/summary`
  - 특정 세션 아카이브 summary 반환
- `GET /api/viewer/health/:sessionId`
  - 세션 health 상태 반환 (`sessionFound`, `relayStatus`, `heartbeatAgeMs`, `healthLevel`)
  - `healthLevel`: `healthy` (< 3s) / `delayed` (3-6s) / `stale_risk` (6-10s) / `stale` (> 10s or not active)
  - overlay, ops 화면에서 실시간 health 표시에 활용
- `GET /api/viewer/sessions/:sessionId`
  - viewer payload + access metadata
- `GET /api/viewer/join/:joinCode`
  - 공유 가능 시 viewer payload 반환
  - 거부 시 `invalid_code` / `not_shared`
- `GET /api/viewer/session-access/:sessionId`
  - host control용 access summary
- `PATCH /api/viewer/session-access/:sessionId`
  - `shareEnabled`, `visibility` 업데이트

### Relay Debug API

- `GET /relay/sessions`
- `GET /relay/sessions/:id`

두 endpoint 모두 access metadata를 함께 제공합니다.

## 7. 운영 이벤트 모델

시스템은 내부적으로 다음 이벤트를 기록합니다.

- `session_started`
- `session_stale`
- `session_recovered`
- `session_closed`
- `share_enabled_changed`
- `visibility_changed`

현재는 in-memory recent events sink 기반이며, Discord/Slack/Email/Webhook 어댑터는 아직 구현하지 않습니다.

## 8. Session Notes 모델 (Collaboration v1)

노트는 계정 기반 객체가 아니라 **session-scoped lightweight record** 입니다.

- 필수 필드: `noteId`, `sessionId`, `timestamp`, `createdAt`, `category`, `text`, `authorLabel`
- 선택 필드: `lap`, `tag`, `severity`

`authorLabel`은 현재 단계에서 실제 사용자 계정 식별자가 아닙니다.
`Engineer`, `Strategist`, `Pit Wall`, `Observer` 같은 얇은 역할 표식만 사용합니다.

## 9. 로드맵 원칙

- session-centric model 유지
- host/internal은 공유 정책 제어, external viewer는 joinCode read-only 접근
- Discord/account identity 모델 도입 보류
- 이번 단계는 Discord 없는 협업 v1이며, 계정/ACL/멘션/첨부/스레드는 범위 밖
- Strategy Engine v2는 v1 위에 비교형 스코어 레이어를 추가한 단계
- 여전히 설명 가능한 룰 기반이며 Monte Carlo/ML 단계가 아님
- 11단계에서 archive/replay/analysis 기반 추가
- archived session은 snapshot timeline + ops events + notes + strategy summary를 포함
- 12단계에서 overlay/broadcast polish 추가 — overlay는 read-only presentation surface
- 12단계에서 overlay/broadcast polish 마감
- read-only overlay와 host/ops(write control)의 목적 분리가 완료됨
- ops/live control plane, archive/replay plane, broadcast presentation surface가 라우팅/프리셋 기준으로 연결됨
- overlay는 ops/host와 목적이 다름: write action 없음, compact 레이아웃, broadcast 친화적
- session health 4단계 (`healthy/delayed/stale_risk/stale`) 시각화 완성
- live control plane과 replay/archive plane이 자연스럽게 이어지는 구조 유지
- 이후 단계에서 compound comparison, safety car scenario planning, strategy tree, broader traffic model로 확장
- notes + ops timeline + strategy card 조합은 전략 판단 문맥의 핵심 기반
- 이후에는 file/db 영속화, 고급 post-race analytics, strategy review workflow로 확장 가능
- video/영상 송출, WebRTC, 외부 스트리밍 플랫폼 연동은 여전히 범위 밖

## 10. 테스트

```bash
npm test
```

현재 테스트는 다음을 검증합니다.

- session access metadata 노출
- PATCH access control 상태 변경
- joinCode 기반 접근 허용/거부
- viewer status 판정
- ops sessions summary shape
- ops recent events 생성 및 상태 전이 기록
- session notes store CRUD / 세션 분리 / timestamp 정렬
- notes API GET/POST/DELETE + body validation
- session timeline(ops + notes) 응답 shape
- strategy engine 룰/지표 기반 추천 및 unavailable reason
- strategy API shape (`recommendation/reasons/signals` 또는 `strategyUnavailable/reason`)
- v2 advanced metric 경향성(undercut/overcut/traffic/degradation) 일관성

## 11. Windows 배포 (GitHub Pages + Releases)

MPP는 배포 UX와 바이너리 호스팅을 분리합니다.

- GitHub Pages: 제품 소개 + 다운로드 페이지
- GitHub Releases: 실제 .exe 설치 파일 호스팅

### 11-1. Pages 정적 사이트

- 정적 페이지 루트: `docs/`
- 메인 페이지: `docs/index.html`
- 스타일/동적 링크 설정: `docs/assets/site.css`, `docs/assets/site.js`
- 배포 전략 문서: `docs/RELEASE_DISTRIBUTION.md`

GitHub 저장소 설정에서 Pages source를 `Deploy from a branch` + `main /docs`로 설정하면 바로 게시할 수 있습니다.

### 11-2. 다운로드 링크 정책

페이지의 다운로드 버튼은 Releases latest 경로를 사용합니다.

- 설치형: `.../releases/latest/download/MPP-Setup.exe`
- 포터블: `.../releases/latest/download/MPP-portable.exe`
- 폴백: `.../releases/latest`

즉, 페이지는 고정 링크를 유지하고 릴리스 자산만 교체하면 최신 빌드 배포가 가능합니다.

### 11-3. 현재 운영 방식과 확장

현재는 수동 Release 업로드를 전제로 합니다.

1. Release 생성
2. `.exe` 자산 업로드
3. 릴리스 노트 게시

향후에는 GitHub Actions로 태그/Release 이벤트 시 Windows 빌드 후 Release asset 업로드로 확장할 예정입니다.
- archive store의 snapshot/ops event/note 세션 단위 기록 및 finalize
- archive API 목록/상세/summary/timeline 응답 shape 및 not_found 처리
- replay timeline의 시간순 정렬 및 mixed item(`snapshot|ops_event|note`) 일관성
