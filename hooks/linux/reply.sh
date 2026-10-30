#!/usr/bin/env bash
# Island reply hook: a Claude Code Stop hook that runs in the background (asyncRewake) after Claude finished,
# and waits until you type a reply to this session in the island.
# Exit code 2 wakes Claude with your reply; exit 0 means there is nothing to send (you typed in its window
# instead, the session ended, Island is not running, or the wait ran out).
dir="$HOME/.island"
payload=$(cat)
token=$(cat "$dir/token" 2>/dev/null) || exit 0
src=$(cat "$dir/src" 2>/dev/null || echo ssh)
port=$(cat "$dir/port" 2>/dev/null || echo 47900)
curl=curl
[ "$src" = wsl ] && curl=/mnt/c/Windows/System32/curl.exe

answer=$(printf '%s' "$payload" | "$curl" -s -m 10800 -X POST -H "Content-Type: application/json" \
  -H "X-Island-Token: $token" -H "X-Island-Agent: claude" -H "X-Island-Src: $src" --data-binary @- \
  "http://127.0.0.1:$port/reply-wait" 2>/dev/null | tr -d '\r')
reply=$(printf '%s' "$answer" | python3 -c 'import json, sys; print(json.load(sys.stdin).get("reply", ""))' 2>/dev/null)
[ -n "$reply" ] || exit 0
printf 'The user replied from Island (their Windows notch app) instead of the terminal: %s\n' "$reply" >&2
exit 2
