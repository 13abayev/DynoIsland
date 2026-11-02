# Makes the zip your colleagues install Island from: dist\Island-<version>-win-x64.zip, which holds
#   Island\Island.exe       Electron's own electron.exe, only renamed. It stays the very same file, so Smart App
#                           Control (which blocks unsigned programs it does not know) lets it run.
#   Island\resources\app\   Island itself: package.json, src, hooks, extension, assets, node_modules\ws, bin\helper
#   Island\dotnet\          Microsoft's .NET runtime, which runs Island's Windows helper
# Unzipped anywhere and started, Island installs itself into %LOCALAPPDATA%\Programs\Island (no admin rights).
# Run "npm run setup" first. -NoBuild uses the helper already in bin\helper (no .NET SDK needed).
param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$electron = Join-Path $root 'node_modules\electron\dist'
if (-not (Test-Path "$electron\electron.exe")) { throw 'Electron is missing: run "npm run setup" first.' }

$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'Island'
$zip = Join-Path $dist "Island-$version-win-x64.zip"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage | Out-Null

Write-Host 'Electron, with electron.exe renamed to Island.exe'
Copy-Item "$electron\*" $stage -Recurse
Rename-Item "$stage\electron.exe" 'Island.exe'
Remove-Item "$stage\resources\default_app.asar" -ErrorAction SilentlyContinue
Get-ChildItem "$stage\locales" -Exclude 'en-US.pak' | Remove-Item # Island's own text is English
if ((Get-FileHash "$stage\Island.exe").Hash -ne (Get-FileHash "$electron\electron.exe").Hash) { throw 'Island.exe must stay the very same file as electron.exe.' }

Write-Host "Island $version"
$app = Join-Path $stage 'resources\app'
New-Item -ItemType Directory -Force $app, "$app\node_modules", "$app\bin" | Out-Null
Copy-Item (Join-Path $root 'package.json'), (Join-Path $root 'LICENSE') $app
foreach ($dir in 'src', 'hooks', 'extension', 'assets') { Copy-Item (Join-Path $root $dir) $app -Recurse }
Copy-Item (Join-Path $root 'node_modules\ws') "$app\node_modules" -Recurse
if ($NoBuild) {
  if (-not (Test-Path (Join-Path $root 'bin\helper\IslandHelper.dll'))) { throw 'There is no helper in bin\helper yet: run "npm run build:helper".' }
  Copy-Item (Join-Path $root 'bin\helper') "$app\bin" -Recurse
} else {
  & (Join-Path $PSScriptRoot 'build-helper.ps1') -Out "$app\bin\helper"
}

# straight from Microsoft's release list, checked against the SHA-512 it publishes (dotnet-install.ps1 goes through
# aka.ms links, which did not always answer)
$meta = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/9.0/releases.json'
$runtime = $meta.'latest-runtime'
Write-Host ".NET runtime $runtime (from Microsoft, kept in dist\cache)"
$file = ($meta.releases | Where-Object { $_.runtime.version -eq $runtime } | Select-Object -First 1).runtime.files |
  Where-Object { $_.name -eq 'dotnet-runtime-win-x64.zip' }
if (-not $file) { throw "Microsoft's release list has no Windows runtime for .NET $runtime." }
$cache = Join-Path $dist 'cache'
New-Item -ItemType Directory -Force $cache | Out-Null
$runtimeZip = Join-Path $cache "dotnet-runtime-$runtime-win-x64.zip"
if (-not (Test-Path $runtimeZip) -or (Get-FileHash $runtimeZip -Algorithm SHA512).Hash -ne $file.hash) {
  Invoke-WebRequest $file.url -OutFile $runtimeZip -UseBasicParsing
  if ((Get-FileHash $runtimeZip -Algorithm SHA512).Hash -ne $file.hash) { Remove-Item $runtimeZip; throw 'The .NET runtime download does not match the checksum Microsoft publishes.' }
}
Expand-Archive $runtimeZip -DestinationPath (Join-Path $stage 'dotnet')

Write-Host "Zipping $zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal
$mb = [math]::Round((Get-Item $zip).Length / 1MB)
Write-Host "Done: $zip ($mb MB)"
