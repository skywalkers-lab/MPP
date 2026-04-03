# F1 25 UDP 실환경 검증 체크리스트

## 1. 준비
- F1 25 게임에서 UDP Telemetry를 활성화 (설정 > Telemetry > UDP On, 포트 확인)
- 로컬 에이전트 실행: `npm start`
- 브라우저에서 `http://localhost:3000/state` 접속

## 2. 검증 시나리오

### 2-1. 세션 진입/전환
- 타임트라이얼, 그랑프리, 멀티플레이 등 세션 진입
- /state의 `session.sessionType`, `session.trackId`, `session.sessionUID`가 정상적으로 갱신되는지 확인
- 세션 전환(퀄리파잉→레이스, 트랙 재시작, 메뉴 복귀 등) 시 sessionUID, sessionType, trackId가 바뀌고, player/이벤트/차량 상태가 리셋되는지 확인

### 2-2. 주행 중 상태 변화
- 주행 시작 후 /state의 `player.position`, `player.currentLapNum`이 실제 게임 내 위치/랩과 일치하는지 확인
- 피트 진입 시 `player.pitStatus`가 바뀌는지 확인
- 타이어 교체 후 `player.tyreCompound`, `player.tyreAgeLaps`가 갱신되는지 확인
- 연료 소모에 따라 `player.fuelLapsRemaining`이 감소하는지 확인

### 2-3. 손상/이벤트
- 충돌 등으로 앞/뒤 윙 손상 시 `player.frontWingLeftDamage`, `player.frontWingRightDamage`, `player.rearWingDamage`가 0이 아닌 값으로 바뀌는지 확인
- 주요 이벤트(최고 랩, 페널티 등) 발생 시 /state의 `recentEvents`에 기록되는지 확인

### 2-4. 비정상/경계 상황
- currentLapNum, fuelLapsRemaining, tyreAgeLaps, damage 값이 비정상 범위(음수, 200 초과 등)일 때 콘솔에 경고 로그가 남는지 확인
- playerCarIndex가 0~21 범위를 벗어나면 경고 로그가 남는지 확인
- driverName이 깨지거나 null/missing이면 경고 로그가 남는지 확인

### 2-5. 부분 패킷/순서 무관성
- Participants 없이 LapData만 먼저 들어와도 player/차량 상태가 부분적으로라도 생성되는지 확인
- CarDamage가 나중에 와도 기존 차량 상태에 자연스럽게 병합되는지 확인

## 3. /state에서 확인할 필드
- session: sessionUID, sessionType, trackId, totalLaps, sessionTime
- player: carIndex, position, currentLapNum, pitStatus, tyreCompound, tyreAgeLaps, fuelLapsRemaining, frontWingLeftDamage, frontWingRightDamage, rearWingDamage, driverName
- totalCars: 전체 차량 수
- recentEvents: 최근 10개 이벤트
- raw: 전체 상태(디버깅용)

## 4. 직접 체크해야 할 항목
- 세션 전환 시 상태 리셋이 과도/부족하지 않은지
- 값이 null/missing과 0이 명확히 구분되는지
- self-check 경고가 실제로 의미 있는 상황에서만 발생하는지
- /state와 콘솔 로그가 실제 게임 상황과 일치하는지

## 5. 남은 리스크
- F1 25 UDP 스펙 변경 시 파서 오프셋 불일치 가능성
- 일부 드문 이벤트/패킷(예: DNF, SC 등) 실환경에서 미확인
- 네트워크 지연/패킷 유실 시 부분 상태 일관성
- 드라이버명 등 문자열 인코딩 이슈

## 6. Public Relay 검증
- Host/Ops/Overlay에서 동일 relay namespace(label + endpoint)가 표시되는지 확인
- Host의 공유 링크가 절대 URL(`RELAY_PUBLIC_URL/join/{joinCode}`)로 생성되는지 확인
- 서로 다른 네트워크 클라이언트가 같은 Public Relay join 링크로 동일 canonical session을 보는지 확인
- session_rebound 직후 host command bar에 syncing 문구가 잠시 표시되고 이후 안정화되는지 확인
- debug endpoint가 기본 비활성(`RELAY_ENABLE_DEBUG_HTTP=false`)인지 확인

---

이 체크리스트를 따라가며 실제 게임과 /state, 콘솔 로그를 비교하면 실환경 검증이 가능합니다.
