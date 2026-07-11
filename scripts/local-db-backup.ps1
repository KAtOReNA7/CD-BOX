param(
  [string]$BackupDirectory = "var/backups/postgres",

  [ValidateRange(1, 3650)]
  [int]$RetentionDays = 30,

  [ValidateRange(1, 1000)]
  [int]$RetentionCount = 14
)

. (Join-Path $PSScriptRoot "local-common.ps1")

$projectRoot = Get-LocalProjectRoot
$connection = Set-PostgresEnvironmentFromDatabaseUrl
$pgDump = Resolve-PostgresTool -Name "pg_dump.exe"
$backupPath = Resolve-LocalPath -Path $BackupDirectory -BasePath $projectRoot
$backupPath = Assert-SafeBackupDirectory -Path $backupPath
[System.IO.Directory]::CreateDirectory($backupPath) | Out-Null

$safeDatabaseName = [System.Text.RegularExpressions.Regex]::Replace(
  $connection.DatabaseName,
  "[^A-Za-z0-9_.-]",
  "_"
)
$timestamp = [DateTime]::UtcNow.ToString("yyyyMMdd-HHmmss")
$fileName = "cd-box-$safeDatabaseName-$timestamp-$PID.dump"
$finalPath = Join-Path $backupPath $fileName
$partialPath = "$finalPath.partial"
$checksumPath = "$finalPath.sha256"

try {
  Write-Host "Creating a PostgreSQL backup..."
  Invoke-CheckedCommand -FilePath $pgDump -Arguments @(
    "--no-password",
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-acl",
    "--file=$partialPath",
    "--dbname=$($connection.DatabaseName)"
  ) -FailureMessage "Database backup failed"

  Move-Item -LiteralPath $partialPath -Destination $finalPath
  $checksum = (Get-FileHash -LiteralPath $finalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  "$checksum  $fileName" | Set-Content -LiteralPath $checksumPath -Encoding ASCII
}
finally {
  Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
}

$cutoff = [DateTime]::UtcNow.AddDays(-$RetentionDays)
$allBackups = @(Get-ChildItem -LiteralPath $backupPath -Filter "cd-box-*.dump" -File |
  Sort-Object -Property LastWriteTimeUtc -Descending)
$pathsToDelete = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)

foreach ($backup in $allBackups) {
  if ($backup.LastWriteTimeUtc -lt $cutoff) {
    $pathsToDelete.Add($backup.FullName) | Out-Null
  }
}

if ($allBackups.Count -gt $RetentionCount) {
  foreach ($backup in ($allBackups | Select-Object -Skip $RetentionCount)) {
    $pathsToDelete.Add($backup.FullName) | Out-Null
  }
}

foreach ($pathToDelete in $pathsToDelete) {
  $resolvedCandidate = [System.IO.Path]::GetFullPath($pathToDelete)
  $candidateParent = [System.IO.Path]::GetDirectoryName($resolvedCandidate)
  if (-not $candidateParent.Equals($backupPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to delete a backup outside the configured backup directory."
  }

  Remove-Item -LiteralPath $resolvedCandidate -Force
  Remove-Item -LiteralPath "$resolvedCandidate.sha256" -Force -ErrorAction SilentlyContinue
}

Write-Host "Backup complete: $finalPath"
Write-Output $finalPath
