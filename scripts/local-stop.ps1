param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

. (Join-Path $PSScriptRoot "local-common.ps1")

$projectRoot = Get-LocalProjectRoot
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -in @("127.0.0.1", "::1") } |
  Select-Object -ExpandProperty OwningProcess -Unique)

if ($listeners.Count -eq 0) {
  Write-Host "CD-BOX is not listening on local port $Port."
  exit 0
}

foreach ($processId in $listeners) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
  if ($null -eq $process) {
    continue
  }
  $commandLine = [string]$process.CommandLine
  $isProjectNext = $process.Name -ieq "node.exe" -and
    $commandLine.IndexOf($projectRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine -match "next(?:\.js)?\s+start|next[\\/]dist[\\/]bin[\\/]next"
  if (-not $isProjectNext) {
    throw "Port $Port is owned by a process that was not started as this CD-BOX project. It was not stopped."
  }

  Write-Host "Stopping CD-BOX process $processId on http://127.0.0.1:$Port"
  Stop-Process -Id $processId
  try {
    Wait-Process -Id $processId -Timeout 30 -ErrorAction Stop
  }
  catch {
    if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
      Write-Warning "CD-BOX did not stop within 30 seconds; forcing the verified project process to exit."
      Stop-Process -Id $processId -Force
      Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
    }
  }
}
