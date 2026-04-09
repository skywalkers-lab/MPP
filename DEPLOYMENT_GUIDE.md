# 무료 배포 가이드 (Render)

## 1단계: GitHub에 코드 푸시

```bash
git add .
git commit -m "Production ready MPP with security fixes"
git push origin main
```

## 2단계: Render 가입

https://render.com 에서 GitHub로 가입

## 3단계: 새 Web Service 생성

1. Dashboard → New → Web Service
2. GitHub repository 선택: `skywalkers-lab/MPP`
3. 다음 설정 입력:

| 항목 | 값 |
|------|-----|
| **Name** | `mpp-relay` |
| **Region** | Singapore (또는 가까운 지역) |
| **Branch** | `main` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run relay` |
| **Environment** | Node (자동 감지됨) |

## 4단계: 환경 변수 설정

Render 대시보드에서 **Environment** 탭:

```
NODE_ENV=production
MPP_OPS_TOKEN=<생성된-토큰>
RELAY_PUBLIC_URL=https://mpp-relay.onrender.com
RELAY_PUBLIC_WS_URL=wss://mpp-relay.onrender.com
RELAY_LABEL=production
RELAY_ENABLE_DEBUG_HTTP=false
MPP_TRUST_LOCAL_OPS=false
MPP_PERSISTENCE_ENABLED=true
```

**MPP_OPS_TOKEN 생성:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 5단계: 배포 시작

Create Web Service 버튼 클릭 → 2-3분 대기

배포 완료 후:
- `https://mpp-relay.onrender.com/rooms` — 메인 대시보드
- `https://mpp-relay.onrender.com/ops` — OPS 제어판

---

## 로컬 개발 설정 (F1 UDP 테스트)

```bash
# 로컬에서 실행
npm run relay

# 다른 터미널에서 F1 25 게임 실행
# 설정 → Telemetry → UDP: On, Port: 20777

# 브라우저 접속
http://localhost:4100/rooms
```

---

## GitHub Pages 다운로드 페이지 호스팅 (선택)

이미 설정되어 있습니다. GitHub 저장소 설정에서 확인:

1. Settings → Pages
2. Source: `Deploy from a branch`
3. Branch: `main`, Folder: `/docs`

이제 다운로드 페이지가 여기에서 자동 호스팅됩니다:
https://skywalkers-lab.github.io/MPP

---

## Windows 배포 (로컬 앱)

```bash
npm run package:windows
```

생성 파일:
- `MPP-Setup.exe` (설치형)
- `MPP-portable.exe` (포터블)

이 파일들을 GitHub Releases에 업로드하면:
- 다운로드 페이지에서 자동 링크
- 사용자가 `.exe` 다운로드 가능

---

## 운영 팁

### Render 무료 티어 제약
- 월 750시간 제한 (충분)
- 15분 idle 후 자동 종료 (cold start ~30초)
- Keep-alive 설정 권장

### Keep-Alive Cron Job 추가 (선택)

UptimeRobot (무료) 사용:
1. https://uptimerobot.com 가입
2. Monitor 생성: `https://mpp-relay.onrender.com/healthz`
3. Interval: 5분

이렇게 하면 항상 웹서비스가 깨어 있습니다.

---

## 문제 해결

### "Build failed" 에러
```bash
# 로컬에서 먼저 테스트
npm install
npm run build
npm run relay
```

### UDP 패킷 수신 안 됨
- Windows 방화벽 설정: UDP 20777 허용
- F1 25 Telemetry 설정 확인 (UDP On, 20777)
- 로컬: `http://localhost:4100/diagnostics`에서 `recentPackets10s` 확인

### Render 배포 후 접속 안 됨
- 배포 로그 확인: Render Dashboard → Service → Logs
- 환경 변수 확인: 모두 설정되었는지
- 5분 대기 (초기 컴파일 시간)

---

## 다음 단계

1. 로컬에서 F1 게임과 연동 테스트
2. Render에 배포
3. 엔지니어들이 `/join/JOINCODE` 링크로 접속

