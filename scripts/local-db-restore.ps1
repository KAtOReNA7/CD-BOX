param(
  [string]$BackupFile = "",
  [string]$ConfirmDatabaseName = "",
  [switch]$ValidateOnly,

  [ValidateRange(1, 65535)]
  [int]$AppPort = 3000
)

. (Join-Path $PSScriptRoot "local-common.ps1")

$projectRoot = Get-LocalProjectRoot
if ([string]::IsNullOrWhiteSpace($BackupFile)) {
  throw "BackupFile is required. No restore was attempted."
}

$resolvedBackup = Resolve-LocalPath -Path $BackupFile -BasePath $projectRoot
if (-not (Test-Path -LiteralPath $resolvedBackup -PathType Leaf)) {
  throw "The requested backup file does not exist."
}

$checksumPath = "$resolvedBackup.sha256"
if (Test-Path -LiteralPath $checksumPath -PathType Leaf) {
  $checksumLine = (Get-Content -LiteralPath $checksumPath -TotalCount 1).Trim()
  $expectedChecksum = ($checksumLine -split "\s+", 2)[0]
  $actualChecksum = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash
  if (-not $actualChecksum.Equals($expectedChecksum, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Backup checksum validation failed. No restore was attempted."
  }
}

$pgRestore = Resolve-PostgresTool -Name "pg_restore.exe"
$temporaryList = [System.IO.Path]::GetTempFileName()
try {
  Invoke-CheckedCommand -FilePath $pgRestore -Arguments @(
    "--list",
    "--file=$temporaryList",
    $resolvedBackup
  ) -FailureMessage "Backup archive validation failed"
}
finally {
  Remove-Item -LiteralPath $temporaryList -Force -ErrorAction SilentlyContinue
}

if ($ValidateOnly) {
  Write-Host "Backup archive and checksum validation passed."
  exit 0
}

$connection = Set-PostgresEnvironmentFromDatabaseUrl
if ([string]::IsNullOrWhiteSpace($ConfirmDatabaseName) -or
  -not $connection.DatabaseName.Equals($ConfirmDatabaseName, [System.StringComparison]::Ordinal)) {
  throw "ConfirmDatabaseName must exactly match the DATABASE_URL database name. No restore was attempted."
}

$activeListener = Get-NetTCPConnection -State Listen -LocalPort $AppPort -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -in @("127.0.0.1", "0.0.0.0", "::", "::1") } |
  Select-Object -First 1
if ($null -ne $activeListener) {
  throw "Port $AppPort is still listening. Stop CD-BOX gracefully before restoring its database."
}

Write-Host "Creating a safety backup before restore..."
& (Join-Path $PSScriptRoot "local-db-backup.ps1") | Out-Host

Write-Host "Restoring the PostgreSQL database in one transaction..."
Invoke-CheckedCommand -FilePath $pgRestore -Arguments @(
  "--no-password",
  "--clean",
  "--if-exists",
  "--no-owner",
  "--no-acl",
  "--exit-on-error",
  "--single-transaction",
  "--dbname=$($connection.DatabaseName)",
  $resolvedBackup
) -FailureMessage "Database restore failed and was rolled back"

Write-Host "Database restore completed successfully."
