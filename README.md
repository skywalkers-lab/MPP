# Remote Viewer / Session Access Guide

## 1. 실행

```bash
npm install
npm run relay
```

- Relay WebSocket: `4000`
- Relay Debug HTTP: `4001`
- Viewer HTTP: `4100` (환경변수 `VIEWER_HTTP_PORT`로 변경 가능)

## 2. 현재 단계 목표

현재 단계는 **Host Control / Access UX Polish** 입니다.

- Discord OAuth 로그인
- Discord 계정 연동
- Discord bot control plane
- guild/role 연동
- Discord identity 기반 권한 모델

위 항목은 모두 **보류** 상태입니다.

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

## 7. 테스트

```bash
npm test
```

현재 테스트는 다음을 검증합니다.

- session access metadata 노출
- PATCH access control 상태 변경
- joinCode 기반 접근 허용/거부
- viewer status 판정
