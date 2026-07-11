param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

. (Join-Path $PSScriptRoot "local-common.ps1")

$projectRoot = Get-LocalProjectRoot
$buildIdPath = Join-Path $projectRoot (Join-Path ".next" "BUILD_ID")
if (-not (Test-Path -LiteralPath $buildIdPath -PathType Leaf)) {
  throw "No production build was found. Run 'npm run local:setup' first."
}

Set-LocalRuntimeEnvironment -Port $Port
$node = Resolve-RequiredCommand -Name "node.exe"
$nextCli = Join-Path $projectRoot (Join-Path "node_modules" (Join-Path "next" (Join-Path "dist" (Join-Path "bin" "next"))))
if (-not (Test-Path -LiteralPath $nextCli -PathType Leaf)) {
  throw "The local Next.js CLI was not found. Run 'npm ci' first."
}

Write-Host "Starting CD-BOX at http://127.0.0.1:$Port"
Write-Host "The server is bound to this computer only. Press Ctrl+C once and allow up to 30 seconds for graceful shutdown."

Push-Location $projectRoot
try {
  & $node $nextCli "start" "-H" "127.0.0.1" "-p" ([string]$Port)
  $exitCode = $LASTEXITCODE
}
finally {
  Pop-Location
}

if ($exitCode -ne 0 -and $exitCode -ne 130) {
  exit $exitCode
}
