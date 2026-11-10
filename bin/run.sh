#!/bin/sh
# 대시보드 서버를 계속 켜 두는 실행기: 서버가 비정상 종료되면 2초 뒤 다시 켠다. 종료 기록은 ~/.agent-dashboard/server.log
cd "$(dirname "$0")/.." || exit 1
mkdir -p "$HOME/.agent-dashboard"
while true; do
  node server.mjs 2>&1 | tee -a "$HOME/.agent-dashboard/server.log"
  echo "[$(date '+%F %T')] 서버 종료(코드 $?) — 2초 뒤 다시 켭니다" | tee -a "$HOME/.agent-dashboard/server.log"
  sleep 2
done
