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

- **내부 디버그용**: [http://localhost:4100/viewer/SESSION_ID](http://localhost:4100/viewer/SESSION_ID)
	- SESSION_ID는 디버그 HTTP에서 확인한 값 사용
- **외부 공유용**: [http://localhost:4100/join/JOINCODE](http://localhost:4100/join/JOINCODE)
	- JOINCODE는 세션 생성 시 자동 생성되며, host가 공유를 활성화해야 외부 접근 가능
	- 잘못된 코드: "유효하지 않은 초대 코드입니다." 메시지 표시
	- 공유 비활성/비공개: "이 세션은 현재 공유 중이 아닙니다." 메시지 표시


## 5. Viewer 상태 종류
- **live**: 호스트 연결 및 최신 스냅샷 표시
- **waiting**: 호스트 연결, 아직 스냅샷 없음
- **stale**: 호스트 연결 끊김, 마지막 상태 표시
- **ended**: 세션 종료
- **not_found**: 세션 없음


## 6. 동작 방식 및 접근 정책
- viewer는 polling 기반(1초 간격)으로 상태를 조회합니다.
- **5단계: sessionId와 joinCode 분리, 최소 접근 제어 도입**
	- sessionId는 내부 식별자, joinCode는 외부 공유용(6자리 랜덤)
	- host가 공유를 활성화해야만 joinCode로 외부 접근 가능
	- visibility(기본값 private), shareEnabled(기본값 false) 정책 적용
	- 잘못된 joinCode, 공유 비활성, 정상 접근을 각각 구분하여 안내
- 실시간 WebSocket, 인증, Discord OAuth, 역할 시스템 등은 아직 미구현입니다.
- viewer는 오직 읽기 전용이며, 쓰기/변경/노트/전략 등은 불가합니다.

## 7. 개발/테스트
- `npm test`로 상태 판정 및 API 테스트 가능
- 프론트엔드는 public/viewer.html, public/viewer.js로 구성되어 있습니다.


---

> **5단계 Session Access/Invite 안내:**
> - 내부 식별자(sessionId)와 외부 공유용 joinCode가 분리되어 있습니다.
> - 외부 사용자는 joinCode로만 viewer에 접근할 수 있습니다.
> - host가 공유를 활성화하지 않았다면 joinCode로도 접근할 수 없습니다.
> - OAuth/role system, 협업 기능 등은 아직 미구현이며, 현재는 최소 접근 제어만 적용되어 있습니다.