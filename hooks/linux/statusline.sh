#!/usr/bin/env bash
# Island status line for Claude Code: passes your 5-hour and weekly usage to Island (for the usage ring)
# and prints what Island answers. If you had your own status line before, Island kept it in
# ~/.island/statusline-original and that one is shown instead, so nothing changes for you.
dir="$HOME/.island"
input=$(cat)
token=$(cat "$dir/token" 2>/dev/null)
src=$(cat "$dir/src" 2>/dev/null || echo ssh)
port=$(cat "$dir/port" 2>/dev/null || echo 47900)
curl=curl
[ "$src" = wsl ] && curl=/mnt/c/Windows/System32/curl.exe
line=$(printf '%s' "$input" | "$curl" -s -m 1 -X POST -H "Content-Type: application/json" \
  -H "X-Island-Token: $token" --data-binary @- "http://127.0.0.1:$port/status" 2>/dev/null | tr -d '\r')
if [ -f "$dir/statusline-original" ]; then
  original=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["command"])' "$dir/statusline-original" 2>/dev/null)
  [ -n "$original" ] && { printf '%s' "$input" | bash -c "$original"; exit 0; }
fi
printf '%s\n' "${line:-Island}"
