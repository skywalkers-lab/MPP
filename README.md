# Remote Viewer / Session Ops Guide

## 1. 실행

```bash
npm install
npm run relay
```

- Relay WebSocket: `4000`
- Relay Debug HTTP: `4001`
- Viewer HTTP: `4100` (환경변수 `VIEWER_HTTP_PORT`로 변경 가능)

## 2. 현재 단계 목표

현재 단계는 **Session Ops / Notification / Control Plane (7단계)** 입니다.

- Discord OAuth 로그인
- Discord 계정 연동
- Discord bot control plane
- guild/role 연동
- Discord identity 기반 권한 모델

위 항목은 모두 **보류** 상태입니다.

이번 단계의 핵심은 외부 채널 메시지 전송이 아니라, 내부 운영 이벤트 정규화와 다중 세션 운영 시야 확립입니다.

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

### 4-3. Session Ops Control Plane

- `http://localhost:4100/ops`

이 페이지에서 운영자는 다음을 한 화면에서 확인할 수 있습니다.

- `sessionId`, `joinCode`
- `relayStatus`, `viewerStatus`
- `shareEnabled`, `visibility`, `hasViewerAccess`
- `latestSequence`, `hasSnapshot`, `lastHeartbeatAt`, `updatedAt`
- stale/active/closed 상태 시각 구분
- 세션별 `/host/:sessionId` 바로 이동

## 5. External Viewer 흐름 (Read-Only)

외부 사용자는 joinCode 링크로 접속합니다.

- `http://localhost:4100/join/JOINCODE`

Viewer는 끝까지 read-only 입니다.

- write action 없음
- role 선택 없음
- note/전략 수정 없음

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

## 8. 로드맵 원칙

- session-centric model 유지
- host/internal은 공유 정책 제어, external viewer는 joinCode read-only 접근
- Discord/account identity 모델 도입 보류
- 이번 단계는 향후 외부 채널 연동을 위한 control plane 기반 마련이 목적

## 9. 테스트

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
