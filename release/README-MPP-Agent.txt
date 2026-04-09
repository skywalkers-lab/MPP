══════════════════════════════════════════════════
  MPP Agent v0.1.15  —  Mission Pitwall Platform
  드라이버용 Windows 로컬 에이전트
══════════════════════════════════════════════════

[ 시작하기 ]

1. mpp-agent.config.json 파일을 편집합니다:
   - relayUrl: 팀에서 제공한 릴레이 서버 주소 (예: wss://your-app.replit.app/relay)
   - udpPort: F1 25 게임에서 설정한 UDP 포트 (기본값: 20777)

2. F1 25 게임 설정:
   - 메인 메뉴 → 설정 → 텔레메트리 설정
   - UDP 텔레메트리: 켜기
   - UDP 브로드캐스트: 끄기
   - UDP IP 주소: 127.0.0.1 (같은 PC에서 실행 시)
   - UDP 포트: 20777 (또는 설정한 udpPort)
   - UDP 형식: 2025

3. MPP-Agent.exe를 더블클릭하여 실행합니다.

4. 콘솔 창에서 릴레이 연결 상태와 UDP 수신 상태를 확인합니다.

5. 팀 엔지니어에게 세션 ID를 알려주면 브라우저에서 실시간 텔레메트리를 볼 수 있습니다.

[ 파일 목록 ]
  MPP-Agent.exe           — 에이전트 실행 파일
  mpp-agent.config.json   — 설정 파일 (필수 편집)
  README-MPP-Agent.txt    — 이 파일

[ 문제 해결 ]
  - "relayUrl이 없습니다" 오류: mpp-agent.config.json을 MPP-Agent.exe와 같은 폴더에 두세요.
  - UDP 수신 없음: F1 25 게임의 UDP 설정을 확인하고, Windows 방화벽에서 포트를 허용하세요.
  - 릴레이 연결 실패: relayUrl 주소를 다시 확인하고, 인터넷 연결 상태를 점검하세요.

══════════════════════════════════════════════════
