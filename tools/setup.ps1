# Gets Island ready to run from this folder on Windows (no WSL needed): its packages and its Windows helper.
# Needs Node.js 20 or newer and the .NET 9 SDK or newer, once:
#   winget install OpenJS.NodeJS.LTS Microsoft.DotNet.SDK.9
# Then: npm run setup, and npm start. (To make the zip your colleagues install: npm run package.)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed: winget install OpenJS.NodeJS.LTS' }
Push-Location $root
try {
  & npm.cmd install --no-audit --no-fund
  if ($LASTEXITCODE) { throw 'npm install failed' }
  # Electron fetches its program file the first time it is used: now, so Island starts at once
  & node node_modules\electron\install.js
  if ($LASTEXITCODE) { throw 'Getting Electron failed' }
} finally { Pop-Location }

& (Join-Path $PSScriptRoot 'build-helper.ps1')
Write-Host ''
Write-Host 'Island is ready. Start it with: npm start'
