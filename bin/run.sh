#!/bin/sh
# 대시보드 서버를 계속 켜 두는 실행기: 서버가 비정상 종료되면 2초 뒤 다시 켠다. 종료 기록은 ~/.agent-dashboard/server.log
cd "$(dirname "$0")/.." || exit 1
LOG="$HOME/.agent-dashboard/server.log"
(umask 077; mkdir -p "$HOME/.agent-dashboard")
# 로그는 본인만 읽게(600). umask 077 을 실행기 전체에 걸면 대시보드가 띄우는 tmux 세션까지 물려받아
# 프로젝트 파일이 600 으로 만들어지므로, 로그 파일만 괄호(하위 셸) 안에서 만들고 맞춘다. tee -a 는 있는 파일 권한을 그대로 둔다
(umask 077; : >> "$LOG")
chmod 600 "$LOG"
while true; do
  node server.mjs 2>&1 | tee -a "$LOG"
  echo "[$(date '+%F %T')] 서버 종료(코드 $?) — 2초 뒤 다시 켭니다" | tee -a "$LOG"
  sleep 2
done
