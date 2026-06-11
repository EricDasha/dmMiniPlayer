param(
  [switch]$Install,
  [switch]$NoArchive,
  [switch]$SizeTest,
  [switch]$Clean,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

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

function Run($File, [string[]]$ArgsList) {
  Write-Host "+ $File $($ArgsList -join ' ')" -ForegroundColor DarkGray
  & $File @ArgsList
  if ($LASTEXITCODE -ne 0) {
    Fail "Command failed: $File $($ArgsList -join ' ')"
  }
}

Step "Check toolchain"
Need-Command "node" "Install Node.js 24.11+ first."
Need-Command "pnpm" "Install pnpm 10+ first: corepack enable"
Run "node" @("--version")
Run "pnpm" @("--version")

if ($Install -or -not (Test-Path "node_modules")) {
  Step "Install dependencies"
  Run "pnpm" @("install", "--frozen-lockfile")
}

if ($Clean) {
  Step "Clean generated output"
  foreach ($Path in @("dist", "build")) {
    $FullPath = Join-Path $Root $Path
    if (Test-Path $FullPath) {
      Remove-Item -LiteralPath $FullPath -Recurse -Force
    }
  }
}

if (-not $SkipBuild) {
  Step "Build extension"
  Run "pnpm" @("build")
}

if (-not (Test-Path "dist\manifest.json")) {
  Fail "Build output missing: dist\manifest.json"
}

if (-not $NoArchive) {
  Step "Archive extension"
  if ($SizeTest) {
    Run "pnpm" @("archive", "--size-test")
  } else {
    Run "pnpm" @("archive")
  }
}

Step "Done"
Write-Host "dist\         unpacked extension for browser loading" -ForegroundColor Green
if (-not $NoArchive) {
  Get-ChildItem "build" -Filter "*.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 3 |
    ForEach-Object { Write-Host ("build\{0}" -f $_.Name) -ForegroundColor Green }
}
