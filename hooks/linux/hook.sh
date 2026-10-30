#!/usr/bin/env bash
# Island hook: sends a Claude Code / Codex event to the Island app on your Windows PC.
# Island installs this into ~/.island/ (in WSL, or on an SSH server) and adds it to the agent's hooks:
#   bash ~/.island/hook.sh claude|codex      (the event comes in as JSON on stdin)
# In WSL it uses Windows' own curl.exe, which reaches Island on 127.0.0.1 directly.
# On an SSH server, 127.0.0.1:<port> is the tunnel your SSH connection opens back to your PC.
# It always exits 0 and prints nothing, so it can never block or change what the agent does.
dir="$HOME/.island"
agent="${1:-claude}"
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

printf '%s' "$payload" | "$curl" -s -m 2 -X POST \
  -H "Content-Type: application/json" -H "X-Island-Token: $token" -H "X-Island-Agent: $agent" \
  -H "X-Island-Src: $src" -H "X-Island-Host: ${HOSTNAME:-$(uname -n)}" -H "X-Island-Alias: $alias" \
  -H "X-Island-Distro: ${WSL_DISTRO_NAME:-}" -H "X-Island-Term: ${TERM_PROGRAM:-}" \
  -H "X-Island-Entry: ${CLAUDE_CODE_ENTRYPOINT:-}" -H "X-Island-Branch: $branch" -H "X-Island-Summary: $summary" \
  --data-binary @- "http://127.0.0.1:$port/hook" >/dev/null 2>&1
exit 0
