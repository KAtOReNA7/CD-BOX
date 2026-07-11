param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

. (Join-Path $PSScriptRoot "local-common.ps1")

$projectRoot = Get-LocalProjectRoot
$npm = Resolve-RequiredCommand -Name "npm.cmd"
Set-LocalRuntimeEnvironment -Port $Port

Push-Location $projectRoot
try {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules") -PathType Container)) {
    Write-Host "Installing locked dependencies..."
    Invoke-CheckedCommand -FilePath $npm -Arguments @("ci") -FailureMessage "Dependency installation failed"
  }

  & (Join-Path $PSScriptRoot "local-db-init.ps1")

  Write-Host "Building the local production application..."
  Invoke-CheckedCommand -FilePath $npm -Arguments @("run", "build") -FailureMessage "Production build failed"
}
finally {
  Pop-Location
}

Write-Host "Local setup is complete. Start CD-BOX with 'npm run local:start'."
