param(
  [Parameter(Mandatory = $false)]
  [string]$ExtensionId,

  [string]$ChromeExtensionId,

  [string]$EdgeExtensionId,

  [string[]]$ExtensionIds,

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
$StatePath = Join-Path $NativeBuildDir 'dmmp-window-opacity-install-state.json'

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

$allIds = @($ExtensionIds) + @($ExtensionId, $ChromeExtensionId, $EdgeExtensionId) | Where-Object { $_ } | ForEach-Object { $_.ToLower().Trim() } | Select-Object -Unique
foreach ($id in $allIds) { if ($id -notmatch '^[a-p]{32}$') { Fail "extension ID 必须是 32 位 a-p 字母：$id" } }
$origins = @($allIds | ForEach-Object { "chrome-extension://$_/" })
if ($origins.Count -eq 0) { Fail '请提供 -ChromeExtensionId 和/或 -EdgeExtensionId' }

Step "Write native messaging manifest"
$manifest = [ordered]@{
  name = $HostName
  description = 'dmMiniPlayer Windows PiP native opacity host'
  path = $ExePath
  type = 'stdio'
  allowed_origins = $origins
}
$manifestJson = $manifest | ConvertTo-Json -Depth 4
$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($ManifestPath, $manifestJson, $utf8NoBom)
$state = [ordered]@{ extension_ids = $allIds }
[System.IO.File]::WriteAllText($StatePath, ($state | ConvertTo-Json), $utf8NoBom)

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
