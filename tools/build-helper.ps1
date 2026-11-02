# Builds Island's Windows helper (helper\) into bin\helper\IslandHelper.dll. Island starts it with Microsoft's
# dotnet.exe (helper\IslandHelper.csproj says why). Needs the .NET 9 SDK or newer, once:
#   winget install Microsoft.DotNet.SDK.9
param([string]$Out = (Join-Path (Split-Path $PSScriptRoot) 'bin\helper'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw 'The .NET SDK is not installed: winget install Microsoft.DotNet.SDK.9' }
$sdks = & dotnet --list-sdks 2>$null
if (-not ($sdks | Where-Object { [int](($_ -split '\.')[0]) -ge 9 })) { throw 'Building the helper needs the .NET 9 SDK or newer: winget install Microsoft.DotNet.SDK.9' }

$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
if (Test-Path $Out) { Remove-Item $Out -Recurse -Force }
& dotnet publish (Join-Path $root 'helper\IslandHelper.csproj') -c Release -o $Out -v:q
if ($LASTEXITCODE) { throw 'Building the helper failed' }
Write-Host "Helper built: $Out\IslandHelper.dll"
