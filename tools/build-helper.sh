#!/usr/bin/env bash
# Builds the Windows helper (helper/) from WSL into bin/helper/IslandHelper.dll.
# Island starts it with Windows' dotnet.exe (the .NET 9+ runtime), see helper/IslandHelper.csproj for why.
# Uses the .NET SDK in ~/.dotnet, and installs it there first if it is missing (Microsoft's dotnet-install.sh, no sudo).
set -euo pipefail
cd "$(dirname "$0")/.."
DOTNET="${DOTNET:-$HOME/.dotnet/dotnet}"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
if [ ! -x "$DOTNET" ]; then
  echo "Installing the .NET SDK into ~/.dotnet (no sudo needed)…"
  curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
  bash /tmp/dotnet-install.sh --channel 10.0 --install-dir "$HOME/.dotnet"
fi
rm -rf bin/helper
"$DOTNET" publish helper/IslandHelper.csproj -c Release -o bin/helper -v:q
echo "Helper built: bin/helper/IslandHelper.dll"
