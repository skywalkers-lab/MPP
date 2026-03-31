# Remote Viewer 사용법

## 1. Relay 서버 실행

```bash
npm install
npm run relay
```

- 기본 WebSocket 포트: 4000
- 디버그 HTTP 포트: 4001
- Viewer HTTP 포트: 4100 (환경변수 VIEWER_HTTP_PORT로 변경 가능)

## 2. Agent를 Relay에 연결
- F1 25 UDP 로컬 에이전트가 relay 서버(WS 포트)에 연결되어야 합니다.
- 연결 시 세션이 생성되고, state_snapshot 패킷이 전송됩니다.

## 3. sessionId 확인
- 디버그 HTTP: [http://localhost:4001/relay/sessions](http://localhost:4001/relay/sessions) 에서 sessionId 확인

## 4. Viewer 페이지 접속
- 브라우저에서 [http://localhost:4100/viewer/SESSION_ID](http://localhost:4100/viewer/SESSION_ID) 로 접속
- SESSION_ID는 위에서 확인한 값 사용

## 5. Viewer 상태 종류
- **live**: 호스트 연결 및 최신 스냅샷 표시
- **waiting**: 호스트 연결, 아직 스냅샷 없음
- **stale**: 호스트 연결 끊김, 마지막 상태 표시
- **ended**: 세션 종료
- **not_found**: 세션 없음

## 6. 동작 방식
- viewer는 polling 기반(1초 간격)으로 상태를 조회합니다.
- 실시간 WebSocket, 인증, 초대 코드, Discord 연동 등은 아직 미구현입니다.
- viewer는 오직 읽기 전용이며, 쓰기/변경/노트/전략 등은 불가합니다.

## 7. 개발/테스트
- `npm test`로 상태 판정 및 API 테스트 가능
- 프론트엔드는 public/viewer.html, public/viewer.js로 구성되어 있습니다.

---

> **다음 단계(5단계 Session Access/Invite) 준비:**
> 내부적으로 sessionId와 외부 공유 키 분리 구조를 염두에 두고 설계되어 있습니다. 실제 권한/초대 기능은 아직 구현되지 않았습니다.