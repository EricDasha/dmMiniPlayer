param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Both',

  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$HostName = 'com.dmminiplayer.window_opacity'
$NativeBuildDir = Join-Path $Root 'build\native'
$ExePath = Join-Path $NativeBuildDir 'dmmp-window-opacity-host.exe'
$ManifestPath = Join-Path $NativeBuildDir "$HostName.json"

function Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Fail($Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Need-Command($Name, $InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "$Name not found. $InstallHint"
  }
}

function Set-DefaultRegistryValue($Path, $Value) {
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }
  Set-Item -Path $Path -Value $Value
}

Step "Prepare native host output"
New-Item -ItemType Directory -Force -Path $NativeBuildDir | Out-Null

if (-not $NoBuild) {
  Step "Build native opacity host"
  Need-Command 'go' 'Install Go first: https://go.dev/dl/'
  Push-Location $Root
  try {
    $env:GOCACHE = Join-Path $Root '.gocache'
    $env:GOMODCACHE = Join-Path $Root '.gomodcache'
    $env:GOPROXY = 'off'
    & go build -o $ExePath ./native/window-opacity-host
    if ($LASTEXITCODE -ne 0) {
      Fail 'go build failed'
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $ExePath)) {
  Fail "Native host executable missing: $ExePath"
}

Step "Write native messaging manifest"
$manifest = [ordered]@{
  name = $HostName
  description = 'dmMiniPlayer Windows PiP native opacity host'
  path = $ExePath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($ManifestPath, $manifestJson, $utf8NoBom)

$targets = switch ($Browser) {
  'Chrome' { @('Chrome') }
  'Edge' { @('Edge') }
  'Both' { @('Chrome', 'Edge') }
}

foreach ($target in $targets) {
  $registryPath = switch ($target) {
    'Chrome' { "Registry::HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\$HostName" }
    'Edge' { "Registry::HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts\$HostName" }
  }

  Step "Register $target native host"
  Set-DefaultRegistryValue $registryPath $ManifestPath
  Write-Host "$target -> $ManifestPath" -ForegroundColor Green
}

Step "Done"
Write-Host "Restart the browser, then enable setting: native window opacity." -ForegroundColor Green
