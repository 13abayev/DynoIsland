#!/usr/bin/env bash
# Island hook: sends an agent's event (Claude Code, Codex, OpenCode…) to the Island app on your Windows PC.
# Island installs this into ~/.island/ (in WSL, or on an SSH server) and adds it to the agent's hooks:
#   bash ~/.island/hook.sh <agent>             the event comes in as JSON on stdin
#   bash ~/.island/hook.sh <agent> wait        a permission prompt: waits for your answer in the island and
#                                              prints it (nothing, if you answer in the terminal)
#   bash ~/.island/hook.sh <agent> reply       a finished session: waits for your reply in the island and prints it
# In WSL it uses Windows' own curl.exe, which reaches Island on 127.0.0.1 directly.
# On an SSH server, 127.0.0.1:<port> is the tunnel Island keeps open back to your PC.
# It always exits 0, and only prints an answer you gave in the island, so it never blocks or changes anything else.
dir="$HOME/.island"
agent="${1:-claude}"
mode="${2:-}"
payload=$(cat)
token=$(cat "$dir/token" 2>/dev/null) || exit 0
src=$(cat "$dir/src" 2>/dev/null || echo ssh)
alias=$(cat "$dir/alias" 2>/dev/null)
port=$(cat "$dir/port" 2>/dev/null || echo 47900)
curl=curl
[ "$src" = wsl ] && curl=/mnt/c/Windows/System32/curl.exe

# git branch, and when the agent stops the start of its answer (base64: any text is safe in a header)
branch="" summary=""
if command -v python3 >/dev/null 2>&1; then
  { read -r branch; read -r summary; } < <(printf '%s' "$payload" | python3 "$dir/info.py" 2>/dev/null)
fi

headers=(-H "Content-Type: application/json" -H "X-Island-Token: $token" -H "X-Island-Agent: $agent"
  -H "X-Island-Src: $src" -H "X-Island-Host: ${HOSTNAME:-$(uname -n)}" -H "X-Island-Alias: $alias"
  -H "X-Island-Distro: ${WSL_DISTRO_NAME:-}" -H "X-Island-Term: ${TERM_PROGRAM:-}"
  -H "X-Island-Entry: ${CLAUDE_CODE_ENTRYPOINT:-}" -H "X-Island-Branch: $branch" -H "X-Island-Summary: $summary")

if [ "$mode" = wait ] || [ "$mode" = reply ]; then
  # an answer only when you gave one: no answer, or an empty one ({}), prints nothing
  if [ "$mode" = wait ]; then url="hook?wait=1" max=1800; else url="reply-wait" max=10800; fi
  answer=$(printf '%s' "$payload" | "$curl" -s -m "$max" -X POST "${headers[@]}" --data-binary @- \
    "http://127.0.0.1:$port/$url" 2>/dev/null | tr -d '\r')
  case "$answer" in ''|'{}') ;; *) printf '%s\n' "$answer" ;; esac
  exit 0
fi

printf '%s' "$payload" | "$curl" -s -m 2 -X POST "${headers[@]}" --data-binary @- \
  "http://127.0.0.1:$port/hook" >/dev/null 2>&1
exit 0
