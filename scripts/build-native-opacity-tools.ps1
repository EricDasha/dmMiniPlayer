param(
  [switch]$SkipHost,
  [switch]$SkipInstaller
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutDir = Join-Path $Root 'build\native'

function Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail($Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
  Fail 'go not found. Install Go first: https://go.dev/dl/'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Push-Location $Root
try {
  $env:GOCACHE = Join-Path $Root '.gocache'
  $env:GOMODCACHE = Join-Path $Root '.gomodcache'
  $env:GOPROXY = 'off'

  if (-not $SkipHost) {
    Step 'Build native opacity host'
    & go build -o (Join-Path $OutDir 'dmmp-window-opacity-host.exe') ./native/window-opacity-host
    if ($LASTEXITCODE -ne 0) { Fail 'native host build failed' }
  }

  if (-not $SkipInstaller) {
    Step 'Build native opacity GUI installer'
    & go build -ldflags="-H windowsgui" -o (Join-Path $OutDir 'dmmp-window-opacity-installer.exe') ./native/window-opacity-installer
    if ($LASTEXITCODE -ne 0) { Fail 'native installer build failed' }
  }
} finally {
  Pop-Location
}

Step 'Done'
Get-ChildItem $OutDir -Filter 'dmmp-window-opacity-*.exe' |
  ForEach-Object { Write-Host $_.FullName -ForegroundColor Green }
