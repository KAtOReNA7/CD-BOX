if ($args.Count -ne 0) {
  throw "local:start does not accept arguments; CD-BOX is fixed to http://127.0.0.1:3000."
}

$Port = 3000

. (Join-Path $PSScriptRoot "local-common.ps1")

$projectRoot = Get-LocalProjectRoot
$buildIdPath = Join-Path $projectRoot (Join-Path ".next" "BUILD_ID")
if (-not (Test-Path -LiteralPath $buildIdPath -PathType Leaf)) {
  throw "No production build was found. Run 'npm run local:setup' first."
}

Set-LocalRuntimeEnvironment -Port $Port
Set-LocalNodeProxyEnvironment
$node = Resolve-RequiredCommand -Name "node.exe"
$nextCli = Join-Path $projectRoot (Join-Path "node_modules" (Join-Path "next" (Join-Path "dist" (Join-Path "bin" "next"))))
if (-not (Test-Path -LiteralPath $nextCli -PathType Leaf)) {
  throw "The local Next.js CLI was not found. Run 'npm ci' first."
}

Write-Host "Starting CD-BOX at http://127.0.0.1:$Port"
Write-Host "The server is bound to this computer only. Press Ctrl+C once and allow up to 30 seconds for graceful shutdown."

$runtimeDirectory = Join-Path $projectRoot (Join-Path "var" "run")
$workerPidPath = Join-Path $runtimeDirectory "cover-retry-worker.pid"
$workerOutputPath = Join-Path $runtimeDirectory "cover-retry-worker.log"
$workerErrorPath = Join-Path $runtimeDirectory "cover-retry-worker.error.log"
$workerScriptPath = Join-Path $projectRoot (Join-Path "scripts" "run-cover-retry-worker.ts")
[void](New-Item -ItemType Directory -Path $runtimeDirectory -Force)
if (-not (Test-Path -LiteralPath $workerScriptPath -PathType Leaf)) {
  throw "The local cover retry worker script was not found."
}

if (Test-Path -LiteralPath $workerPidPath -PathType Leaf) {
  $existingWorkerPidText = (Get-Content -LiteralPath $workerPidPath -ErrorAction Stop | Select-Object -First 1).Trim()
  $existingWorkerPid = 0
  if (-not [int]::TryParse($existingWorkerPidText, [ref]$existingWorkerPid) -or $existingWorkerPid -le 0) {
    throw "The existing cover retry worker PID file is invalid. It was not overwritten."
  }
  $existingWorker = Get-CimInstance Win32_Process -Filter "ProcessId = $existingWorkerPid"
  if ($null -ne $existingWorker) {
    $existingCommandLine = [string]$existingWorker.CommandLine
    $isProjectWorker = $existingWorker.Name -ieq "node.exe" -and
      $existingCommandLine.IndexOf($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $existingCommandLine -match "run-cover-retry-worker\.ts"
    if ($isProjectWorker) {
      throw "The CD-BOX cover retry worker is already running as process $existingWorkerPid. Stop the existing local service first."
    }
    throw "The existing cover retry PID belongs to a different process. It was not overwritten."
  }
  Remove-Item -LiteralPath $workerPidPath -Force
}

$worker = $null
try {
  $worker = Start-Process `
    -FilePath $node `
    -ArgumentList @(
      "--env-file=.env.local",
      "--import",
      "tsx",
      "--conditions=react-server",
      $workerScriptPath
    ) `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $workerOutputPath `
    -RedirectStandardError $workerErrorPath `
    -PassThru
  Start-Sleep -Milliseconds 750
  $worker.Refresh()
  if ($worker.HasExited) {
    throw "The local cover retry worker exited during startup. Check var/run/cover-retry-worker.error.log."
  }
  Set-Content -LiteralPath $workerPidPath -Value ([string]$worker.Id) -Encoding Ascii

  Push-Location $projectRoot
  try {
    & $node $nextCli "start" "-H" "127.0.0.1" "-p" ([string]$Port)
    $exitCode = $LASTEXITCODE
  }
  finally {
    Pop-Location
  }
}
finally {
  if ($null -ne $worker -and -not $worker.HasExited) {
    Stop-Process -Id $worker.Id -ErrorAction SilentlyContinue
    Wait-Process -Id $worker.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $workerPidPath -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0 -and $exitCode -ne 130) {
  exit $exitCode
}
