# Render 배포 가이드

## 1. Render 계정 및 프로젝트 생성

1. [Render](https://render.com) 계정 생성 (GitHub 연동 추천)
2. Dashboard에서 **New +** > **Web Service** 클릭
3. GitHub 저장소 연결: `skywalkers-lab/MPP`

## 2. 배포 설정

### 방법 A: Blueprint 자동 배포 (권장)

저장소에 `render.yaml`이 포함되어 있으므로:

1. **New +** > **Blueprint** 선택
2. GitHub 저장소 선택
3. 자동으로 설정 감지됨
4. **Apply** 클릭

### 방법 B: 수동 설정

| 항목 | 값 |
|------|-----|
| **Name** | `mpp-relay` |
| **Region** | Singapore (한국에서 가장 가까움) |
| **Branch** | `main` |
| **Runtime** | Node |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run relay` |
| **Plan** | Free (또는 Starter) |

### 환경변수 설정

| Key | Value | 설명 |
|-----|-------|------|
| `NODE_ENV` | `production` | 프로덕션 모드 |
| `RELAY_PUBLIC_URL` | `https://mpp-relay.onrender.com` | 배포 후 Render가 제공하는 URL로 변경 |
| `MPP_EMBEDDED_AGENT` | `false` | 원격 서버이므로 UDP 비활성화 |
| `VIEWER_HTTP_PORT` | `10000` | Render 기본 포트 |
| `RELAY_WS_PORT` | `10000` | WebSocket 포트 |
| `RELAY_ENABLE_CORS` | `true` | CORS 허용 |

## 3. 배포 완료 후

배포가 완료되면 Render가 URL을 제공합니다:
```
https://mpp-relay-xxxx.onrender.com
```

**중요**: 이 URL을 `RELAY_PUBLIC_URL` 환경변수에 다시 설정하세요.

## 4. 드라이버 PC 설정

드라이버 PC에서 원격 Relay 서버로 데이터를 전송합니다:

```bash
# 환경변수 설정
export RELAY_URL=wss://mpp-relay-xxxx.onrender.com
export MPP_EMBEDDED_AGENT=true

# Relay 클라이언트 실행
npm run relay
```

또는 Windows에서:
```cmd
set RELAY_URL=wss://mpp-relay-xxxx.onrender.com
set MPP_EMBEDDED_AGENT=true
npm run relay
```

## 5. 팀원 접속

팀원들은 브라우저에서 접속:
```
https://mpp-relay-xxxx.onrender.com/rooms
```

## 6. 아키텍처

```
┌─────────────────┐          ┌─────────────────────────┐          ┌─────────────────┐
│   F1 게임       │   UDP    │     드라이버 PC         │   WSS    │   Render 서버   │
│   (텔레메트리)  │ ──────▶  │  (로컬 Relay+Agent)    │ ──────▶  │  (Public Relay) │
│                 │  :20777  │                         │          │                 │
└─────────────────┘          └─────────────────────────┘          └────────┬────────┘
                                                                           │
                                                                           │ HTTPS/WSS
                                                                           ▼
                                                                  ┌─────────────────┐
                                                                  │   팀원 브라우저 │
                                                                  │   (원격 접속)   │
                                                                  └─────────────────┘
```

## 7. 문제 해결

### 배포 실패 시
- Render Dashboard > Logs 확인
- `npm run build` 로컬에서 먼저 테스트

### WebSocket 연결 안 됨
- `RELAY_PUBLIC_URL`이 `https://`로 시작하는지 확인
- 드라이버 PC의 `RELAY_URL`이 `wss://`로 시작하는지 확인

### 무료 플랜 제한
- 15분 비활동 시 슬립 모드 (첫 요청 시 ~30초 대기)
- 월 750시간 무료
- Starter 플랜($7/월)으로 업그레이드하면 항상 활성 상태 유지

## 8. 유용한 URL

| URL | 용도 |
|-----|------|
| `/rooms` | Room 목록 |
| `/healthz` | 서버 상태 확인 |
| `/diagnostics` | 상세 진단 정보 |
