# Render 배포 가이드

MPP Relay 서버를 Render에 배포하여 공용 릴레이 서버로 운영하는 방법입니다.

## 빠른 시작

### 1. Render Dashboard에서 배포

1. [Render Dashboard](https://dashboard.render.com/)에 로그인
2. **New +** > **Web Service** 클릭
3. GitHub 저장소 연결: `skywalkers-lab/MPP`
4. 설정:
   - **Name**: `mpp-relay` (원하는 이름)
   - **Region**: 가까운 리전 선택
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: 
     ```
     npm install && npm run build && cd client && npm install && npm run build && cp -r dist ../public/
     ```
   - **Start Command**: 
     ```
     node dist/relay/index.js
     ```

5. **Environment Variables** 설정:
   ```
   MPP_EMBEDDED_AGENT=false
   MPP_AUTO_OPEN_DASHBOARD=false
   RELAY_ENABLE_CORS=true
   RELAY_LABEL=mpp-public-relay
   ```

6. **Create Web Service** 클릭

### 2. 배포 후 URL 설정

배포가 완료되면 Render가 URL을 제공합니다 (예: `https://mpp-relay.onrender.com`).

**Environment Variables**에 다음을 추가:
```
RELAY_PUBLIC_URL=https://mpp-relay.onrender.com
RELAY_PUBLIC_WS_URL=wss://mpp-relay.onrender.com
```

## Blueprint 배포 (권장)

저장소의 `render.yaml` 파일을 사용하여 자동 배포할 수 있습니다.

1. [Render Blueprint](https://dashboard.render.com/blueprints) 페이지로 이동
2. **New Blueprint Instance** 클릭
3. GitHub 저장소 선택
4. 자동으로 `render.yaml` 설정 적용

## 환경 변수 설명

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `RELAY_PUBLIC_URL` | 외부에서 접근할 HTTP URL | 배포 후 설정 필요 |
| `RELAY_PUBLIC_WS_URL` | 외부 WebSocket URL | `RELAY_PUBLIC_URL`에서 자동 유도 |
| `RELAY_LABEL` | UI에 표시될 릴레이 라벨 | `public-relay` |
| `RELAY_ENABLE_CORS` | CORS 허용 여부 | `true` |
| `RELAY_ALLOWED_ORIGINS` | 허용할 Origin 목록 (쉼표 구분) | (빈값 = 모두 허용) |
| `MPP_EMBEDDED_AGENT` | 내장 UDP Agent 활성화 | `false` (클라우드에서는 비활성화 권장) |
| `MPP_AUTO_OPEN_DASHBOARD` | 자동 브라우저 오픈 | `false` |

## 사용 방법

### 로컬 Agent에서 클라우드 Relay 연결

로컬에서 MPP Agent를 실행하고 클라우드 Relay에 연결:

```bash
# Windows .exe 또는 로컬 개발 환경에서
RELAY_URL=wss://mpp-relay.onrender.com npm run start
```

또는 Agent 설정 파일에서:
```json
{
  "relayUrl": "wss://mpp-relay.onrender.com"
}
```

### Viewer 접속

배포된 URL로 직접 접속:
- 대시보드: `https://mpp-relay.onrender.com/rooms`
- 특정 세션: `https://mpp-relay.onrender.com/viewer/:sessionId`
- Join 링크: `https://mpp-relay.onrender.com/join/:joinCode`

## 아키텍처

```
┌─────────────────┐     UDP      ┌─────────────────┐
│   F1 Game       │─────────────▶│  Local Agent    │
│  (Telemetry)    │   (20777)    │  (Windows PC)   │
└─────────────────┘              └────────┬────────┘
                                          │
                                          │ WebSocket
                                          ▼
                               ┌─────────────────────┐
                               │   Render           │
                               │   mpp-relay        │
                               │   (Cloud Relay)    │
                               └────────┬───────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
              ┌──────────┐       ┌──────────┐       ┌──────────┐
              │ Viewer A │       │ Viewer B │       │ OBS      │
              │ (Host)   │       │ (Eng.)   │       │ Overlay  │
              └──────────┘       └──────────┘       └──────────┘
```

## 무료 플랜 제한사항

Render 무료 플랜:
- 15분 비활성 시 슬립 (첫 요청 시 ~30초 콜드 스타트)
- 월 750시간 무료
- 512MB RAM

프로덕션 사용 시 유료 플랜 권장.

## 문제 해결

### Health Check 실패
- `/healthz` 엔드포인트가 올바르게 응답하는지 확인
- 빌드 로그에서 client 빌드 오류 확인

### WebSocket 연결 실패
- `RELAY_PUBLIC_WS_URL`이 `wss://`로 시작하는지 확인
- Render는 자동으로 HTTPS/WSS를 제공

### CORS 오류
- `RELAY_ENABLE_CORS=true` 설정 확인
- 특정 Origin만 허용하려면 `RELAY_ALLOWED_ORIGINS` 설정

## 다른 클라우드 플랫폼

같은 설정으로 Railway, Fly.io 등에도 배포 가능합니다.
`PORT` 환경변수를 감지하여 자동으로 단일 포트 모드로 전환됩니다.
