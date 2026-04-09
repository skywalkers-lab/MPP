#!/bin/bash
# scripts/post-merge.sh
# Task 병합 후 자동으로 실행되는 설정 스크립트
# - 루트 npm 의존성 설치
# - 클라이언트 npm 의존성 설치
set -e

echo "[post-merge] 루트 의존성 설치 중..."
npm install --no-audit --prefer-offline

echo "[post-merge] 클라이언트 의존성 설치 중..."
cd client && npm install --no-audit --prefer-offline
cd ..

echo "[post-merge] 완료."
