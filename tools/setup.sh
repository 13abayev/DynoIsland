#!/usr/bin/env bash
# Installs Island's packages and builds the helper, from WSL. The app runs on Windows, so this fetches the
# Windows build of Electron (electron.exe) instead of the Linux one.
# Run from WSL, in this folder:  bash tools/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
command -v npm >/dev/null || { echo "Node.js is missing in WSL: install Node.js 20 or newer first (for example with nvm)."; exit 1; }
npm install --no-bin-links --no-audit --no-fund
# npm skips Electron's download step here, so run it ourselves, asking for the Windows build
ELECTRON_INSTALL_PLATFORM=win32 ELECTRON_INSTALL_ARCH=x64 node node_modules/electron/install.js
test -f node_modules/electron/dist/electron.exe && echo "Electron for Windows is ready."
bash tools/build-helper.sh
# the helper runs on Windows' own .NET runtime
if ! ls "/mnt/c/Program Files/dotnet/shared/Microsoft.NETCore.App/" 2>/dev/null | grep -qE '^(9|[1-9][0-9])\.'; then
  echo "Note: Windows has no .NET runtime 9 or newer yet. In PowerShell: winget install Microsoft.DotNet.Runtime.10"
fi
echo "Done. Start Island in PowerShell from this folder: .\\node_modules\\electron\\dist\\electron.exe ."
