#!/usr/bin/env bash
# scripts/package-agent-windows.sh
# MPP 드라이버 로컬 에이전트를 Windows .exe로 패키징합니다.
# 출력: release/MPP-Agent.exe, release/mpp-agent.config.json, release/README-MPP-Agent.txt
set -euo pipefail

AGENT_VERSION="0.1.19"
OUTDIR="release"
BUILDDIR=".agentbuild"

echo ""
echo "═══════════════════════════════════════"
echo "  MPP Agent Windows 패키징 시작"
echo "  버전: ${AGENT_VERSION}"
echo "═══════════════════════════════════════"
echo ""

# 1. 빌드 디렉터리 초기화
rm -rf "${BUILDDIR}"
mkdir -p "${BUILDDIR}" "${OUTDIR}"

# 2. esbuild로 단일 CJS 번들 생성
echo "[1/3] esbuild로 번들링 중..."
npx esbuild src/agent-main.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node18 \
  --outfile="${BUILDDIR}/agent-entry.cjs"

echo "      완료: ${BUILDDIR}/agent-entry.cjs"

# 3. pkg용 package.json 작성
cat > "${BUILDDIR}/package.json" <<'PKGJSON'
{
  "name": "mpp-agent",
  "version": "0.1.19",
  "type": "commonjs",
  "bin": "agent-entry.cjs",
  "pkg": {
    "targets": ["node18-win-x64"],
    "outputPath": "../release"
  }
}
PKGJSON

# 4. pkg로 exe 생성
echo "[2/3] pkg로 Windows exe 생성 중..."
npx pkg "${BUILDDIR}" \
  --targets node18-win-x64 \
  --output "${OUTDIR}/MPP-Agent.exe"
echo "      완료: ${OUTDIR}/MPP-Agent.exe"

# 5. 설정 파일 템플릿 생성 (이미 존재하면 덮어쓰지 않음)
CONFIG_PATH="${OUTDIR}/mpp-agent.config.json"
if [ ! -f "${CONFIG_PATH}" ]; then
  echo "[3/3] 설정 파일 템플릿 생성 중..."
  cat > "${CONFIG_PATH}" <<'CONFIGEOF'
{
  "_주석": "이 파일을 편집하고 MPP-Agent.exe와 같은 폴더에 두세요.",
  "relayUrl": "wss://your-mpp.onrender.com",
  "udpPort": 20777,
  "udpAddr": "0.0.0.0",
  "_sessionId_주석": "sessionId는 선택 사항입니다. 비우면 자동 생성됩니다.",
  "sessionId": ""
}
CONFIGEOF
  echo "      완료: ${CONFIG_PATH}"
else
  echo "[3/3] 설정 파일 이미 존재 — 덮어쓰지 않음: ${CONFIG_PATH}"
fi

# README 생성 (항상 최신 버전으로 덮어씀)
cat > "${OUTDIR}/README-MPP-Agent.txt" <<READMEEOF
══════════════════════════════════════════════════
  MPP Agent v${AGENT_VERSION}  —  Mission Pitwall Platform
  드라이버용 Windows 로컬 에이전트
══════════════════════════════════════════════════

[ 시작하기 ]

1. mpp-agent.config.json 파일을 편집합니다:
  - relayUrl: 팀에서 제공한 릴레이 서버 주소 (예: wss://your-mpp.onrender.com)
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
READMEEOF

echo ""
echo "═══════════════════════════════════════"
echo "  패키징 완료!"
echo ""
echo "  출력 파일:"
echo "    ${OUTDIR}/MPP-Agent.exe"
echo "    ${OUTDIR}/mpp-agent.config.json"
echo "    ${OUTDIR}/README-MPP-Agent.txt"
echo ""
echo "  드라이버에게 release/ 폴더 전체를 배포하세요."
echo "  실행 전 mpp-agent.config.json의 relayUrl을 반드시 수정해야 합니다."
echo "═══════════════════════════════════════"
echo ""
