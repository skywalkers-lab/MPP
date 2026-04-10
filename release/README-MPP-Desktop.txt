══════════════════════════════════════════════════
  MPP Desktop v0.1.19  —  Mission Pitwall Platform
  Driver / Engineer Windows Launcher
══════════════════════════════════════════════════

[ 빠른 시작 ]

1. MPP-Desktop.exe를 더블클릭합니다.
2. 첫 실행에서는 브라우저에 Local Control Panel이 열립니다.
3. Public Viewer URL에 Render 배포 주소를 입력합니다.
   예: https://your-mpp.onrender.com
4. Relay WebSocket URL은 비워 두면 자동으로 채워집니다.
5. Driver는 "Driver Sender 시작", Engineer는 "Engineer 열기"를 누릅니다.
6. Launch Mode + 자동 시작을 저장하면 다음 실행부터 한 번에 진입합니다.

[ 기본 동작 ]

- Driver 모드: 로컬 UDP 20777 수신 + Render Relay 전송 + Rooms 페이지 열기
- Engineer 모드: Render Rooms 페이지만 바로 열기
- 설정 파일은 사용자 프로필(config 폴더)에 자동 저장됩니다.

[ 릴리스 자산 ]

- MPP-Desktop.exe    — 권장 단일 실행 파일
- MPP-Setup.exe      — 기존 링크 호환용 동일 바이너리
- MPP-portable.exe   — 기존 링크 호환용 동일 바이너리

[ 문제 해결 ]

- Rooms가 열리지 않으면 Render Viewer URL을 다시 확인하세요.
- Driver에서 UDP 패킷이 0이면 게임 Telemetry UDP와 Windows 방화벽을 확인하세요.
- Relay 연결 실패 시 Relay WebSocket URL을 ws:// 또는 wss:// 형식으로 입력하세요.

══════════════════════════════════════════════════
