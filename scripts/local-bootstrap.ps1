param(
  [switch]$RelayKeyFromClipboard,

  [ValidateRange(1, 65535)]
  [int]$PostgresPort = 55432,

  [ValidatePattern("^[A-Za-z0-9._-]+$")]
  [string]$PostgresServiceName = "postgresql-x64-16",

  [switch]$ReplaceExistingEnvFile,
  [switch]$SkipApplicationSetup
)

. (Join-Path $PSScriptRoot "local-common.ps1")

function Assert-Administrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [System.Security.Principal.WindowsPrincipal]$identity
  if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Local bootstrap must run from an elevated Windows terminal."
  }
}

function Set-SecretFileAcl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $systemSid = [System.Security.Principal.SecurityIdentifier]"S-1-5-18"
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]"S-1-5-32-544"
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner($identity.User)
  $acl.SetAccessRuleProtection($true, $false)

  foreach ($sid in @($identity.User, $systemSid, $administratorsSid)) {
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    $acl.AddAccessRule($rule)
  }

  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Remove-PostgresConfigComment {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string]$Line
  )

  $builder = New-Object System.Text.StringBuilder
  $insideQuote = $false
  for ($index = 0; $index -lt $Line.Length; $index += 1) {
    $character = $Line[$index]
    if ($character -eq "'") {
      if ($insideQuote -and $index + 1 -lt $Line.Length -and $Line[$index + 1] -eq "'") {
        $builder.Append("''") | Out-Null
        $index += 1
        continue
      }
      $insideQuote = -not $insideQuote
      $builder.Append($character) | Out-Null
      continue
    }
    if ($character -eq "#" -and -not $insideQuote) {
      break
    }
    $builder.Append($character) | Out-Null
  }

  if ($insideQuote) {
    throw "An unterminated quoted PostgreSQL configuration value was found."
  }
  return $builder.ToString()
}

function ConvertFrom-PostgresConfigLiteral {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  $trimmed = $Value.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    throw "An empty PostgreSQL configuration value was found."
  }

  if ($trimmed.StartsWith("'", [System.StringComparison]::Ordinal)) {
    if (-not $trimmed.EndsWith("'", [System.StringComparison]::Ordinal) -or $trimmed.Length -lt 2) {
      throw "A malformed quoted PostgreSQL configuration value was found."
    }
    return $trimmed.Substring(1, $trimmed.Length - 2).Replace("''", "'")
  }

  return $trimmed
}

function Get-SafePostgresConfigSettings {
  param(
    [Parameter(Mandatory = $true)]
    [string]$DataDirectory
  )

  $settings = @{}
  $configurationPaths = @(
    (Join-Path $DataDirectory "postgresql.conf"),
    (Join-Path $DataDirectory "postgresql.auto.conf")
  )
  $dataPrefix = $DataDirectory.TrimEnd("\") + [System.IO.Path]::DirectorySeparatorChar

  foreach ($configurationPath in $configurationPaths) {
    if (-not (Test-Path -LiteralPath $configurationPath -PathType Leaf)) {
      if ([System.IO.Path]::GetFileName($configurationPath) -eq "postgresql.conf") {
        throw "The primary PostgreSQL configuration file is missing."
      }
      continue
    }

    $resolvedPath = [System.IO.Path]::GetFullPath($configurationPath)
    if (-not $resolvedPath.StartsWith($dataPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "A PostgreSQL configuration file is outside the verified data directory."
    }
    $configurationItem = Get-Item -LiteralPath $resolvedPath
    if (($configurationItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Reparse-point PostgreSQL configuration files are not accepted for bootstrap."
    }

    foreach ($line in (Get-Content -LiteralPath $resolvedPath)) {
      $activeLine = (Remove-PostgresConfigComment -Line $line).Trim()
      if ([string]::IsNullOrWhiteSpace($activeLine)) {
        continue
      }
      if ($activeLine -match "^(?i:include|include_if_exists|include_dir)\b") {
        throw "Active PostgreSQL include directives require manual configuration review before bootstrap."
      }
      if ($activeLine -match "^(?i:port|hba_file)\s*=\s*(.+)$") {
        $separatorIndex = $activeLine.IndexOf("=")
        $name = $activeLine.Substring(0, $separatorIndex).Trim().ToLowerInvariant()
        $value = ConvertFrom-PostgresConfigLiteral -Value $activeLine.Substring($separatorIndex + 1)
        $settings[$name] = $value
      }
    }
  }

  return [pscustomobject]@{
    Port = if ($settings.ContainsKey("port")) { [string]$settings["port"] } else { $null }
    HbaFile = if ($settings.ContainsKey("hba_file")) { [string]$settings["hba_file"] } else { $null }
  }
}

function Get-ByteArraySha256 {
  param(
    [Parameter(Mandatory = $true)]
    [byte[]]$Bytes
  )

  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [System.BitConverter]::ToString($algorithm.ComputeHash($Bytes)).Replace("-", "")
  }
  finally {
    $algorithm.Dispose()
  }
}

function Write-AtomicHbaReplacement {
  param(
    [Parameter(Mandatory = $true)]
    [string]$HbaPath,

    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [Parameter(Mandatory = $true)]
    [byte[]]$ReplacementBytes,

    [Parameter(Mandatory = $true)]
    [System.Security.AccessControl.FileSystemSecurity]$OriginalAcl
  )

  $directory = [System.IO.Path]::GetDirectoryName($HbaPath)
  $temporaryPath = Join-Path $directory (".pg_hba.cd-box-{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
  try {
    [System.IO.File]::WriteAllBytes($temporaryPath, $ReplacementBytes)
    Set-Acl -LiteralPath $temporaryPath -AclObject $OriginalAcl
    [System.IO.File]::Replace($temporaryPath, $HbaPath, $BackupPath, $true)
  }
  finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}

function Restore-OriginalHba {
  param(
    [Parameter(Mandatory = $true)]
    [string]$HbaPath,

    [Parameter(Mandatory = $true)]
    [string]$BackupPath,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedHash,

    [Parameter(Mandatory = $true)]
    [byte[]]$OriginalBytes,

    [Parameter(Mandatory = $true)]
    [System.Security.AccessControl.FileSystemSecurity]$OriginalAcl,

    [Parameter(Mandatory = $true)]
    [string]$PgCtlPath,

    [Parameter(Mandatory = $true)]
    [string]$DataDirectory
  )

  $restorationBytes = $OriginalBytes
  if (Test-Path -LiteralPath $BackupPath -PathType Leaf) {
    $backupHash = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash
    if ($backupHash.Equals($ExpectedHash, [System.StringComparison]::OrdinalIgnoreCase)) {
      $restorationBytes = [System.IO.File]::ReadAllBytes($BackupPath)
    }
  }

  $directory = [System.IO.Path]::GetDirectoryName($HbaPath)
  $temporaryPath = Join-Path $directory (".pg_hba.cd-box-restore-{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
  $discardPath = Join-Path $directory (".pg_hba.cd-box-discard-{0}.bak" -f [Guid]::NewGuid().ToString("N"))
  try {
    [System.IO.File]::WriteAllBytes($temporaryPath, $restorationBytes)
    Set-Acl -LiteralPath $temporaryPath -AclObject $OriginalAcl
    [System.IO.File]::Replace($temporaryPath, $HbaPath, $discardPath, $true)

    $restoredHash = (Get-FileHash -LiteralPath $HbaPath -Algorithm SHA256).Hash
    if (-not $restoredHash.Equals($ExpectedHash, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "PostgreSQL authentication restoration failed its integrity check."
    }

    Invoke-CheckedCommand -FilePath $PgCtlPath -Arguments @(
      "reload",
      "-D",
      $DataDirectory,
      "-s"
    ) -FailureMessage "PostgreSQL rejected the authentication restoration reload"

    Set-Acl -LiteralPath $HbaPath -AclObject $OriginalAcl
  }
  finally {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $discardPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-PsqlInput {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PsqlPath,

    [Parameter(Mandatory = $true)]
    [string]$Sql,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  $previousOutputEncoding = $OutputEncoding
  try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $Sql | & $PsqlPath @Arguments *> $null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $OutputEncoding = $previousOutputEncoding
  }

  if ($exitCode -ne 0) {
    throw "$FailureMessage (exit code $exitCode)."
  }
}

function Commit-EnvironmentFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TemporaryPath,

    [Parameter(Mandatory = $true)]
    [string]$DestinationPath,

    [switch]$ReplaceExisting
  )

  if (Test-Path -LiteralPath $DestinationPath -PathType Leaf) {
    if (-not $ReplaceExisting) {
      throw "The ignored .env.local file already exists. It was not read or changed."
    }

    $replacementBackup = "$DestinationPath.bootstrap-replaced-$([Guid]::NewGuid().ToString('N')).bak"
    try {
      [System.IO.File]::Replace($TemporaryPath, $DestinationPath, $replacementBackup, $true)
    }
    finally {
      Remove-Item -LiteralPath $replacementBackup -Force -ErrorAction SilentlyContinue
    }
  }
  else {
    [System.IO.File]::Move($TemporaryPath, $DestinationPath)
  }
}

Assert-Administrator

$projectRoot = Get-LocalProjectRoot
$environmentPath = Join-Path $projectRoot ".env.local"
if ((Test-Path -LiteralPath $environmentPath -PathType Leaf) -and -not $ReplaceExistingEnvFile) {
  throw "The ignored .env.local file already exists. Bootstrap stopped without reading or changing it."
}

if (-not $RelayKeyFromClipboard) {
  throw "RelayKeyFromClipboard is required for non-interactive bootstrap."
}
$clipboardCommand = Get-Command Get-Clipboard -ErrorAction SilentlyContinue
if ($null -eq $clipboardCommand) {
  throw "Windows clipboard access is unavailable."
}
$relayKey = ([string](Get-Clipboard -Format Text -Raw)).Trim()
if ([string]::IsNullOrWhiteSpace($relayKey) -or $relayKey -notmatch "\Ask-[A-Za-z0-9._-]{16,}\z") {
  throw "The clipboard does not contain one valid sk-style relay key. Its content was not logged."
}

$databaseRole = "cd_box_app"
$databaseName = "cd_box"
$databasePassword = New-CryptographicToken -ByteCount 32
$authSecret = New-CryptographicToken -ByteCount 48
$databaseUrl = "postgresql://${databaseRole}:${databasePassword}@127.0.0.1:${PostgresPort}/${databaseName}?schema=public"
$environmentContent = @"
DATABASE_URL="$databaseUrl"

LOCAL_OWNER_MODE="true"
LOCAL_OWNER_BIND_HOST="127.0.0.1"
NEXTAUTH_URL="http://127.0.0.1:3000"
AUTH_URL="http://127.0.0.1:3000"
AUTH_SECRET="$authSecret"

OPENAI_API_KEY="$relayKey"
OPENAI_BASE_URL="https://new-api.xiron.net.cn/v1"
OPENAI_TEXT_MODEL="gpt-5.6-terra"
AI_TEXT_PROTOCOL="chat-completions"
AI_MAX_COMPLETION_TOKENS="16384"
AI_REASONING_EFFORT="none"
AI_REQUEST_TIMEOUT_MS="300000"
AI_ENABLE_WEB_SEARCH="true"
AI_ORGANIZE_PUBLIC_METADATA="false"
AI_ENABLE_IMAGE_GENERATION="false"
AI_RESPONSES_SUPPORTED="false"
AI_CHAT_COMPLETIONS_SUPPORTED="true"
AI_WEB_SEARCH_SUPPORTED="false"

NEXT_TELEMETRY_DISABLED="1"
"@

$temporaryEnvironmentPath = Join-Path $projectRoot (".env.local.{0}.tmp" -f [Guid]::NewGuid().ToString("N"))
trap {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw $_
}
[System.IO.File]::WriteAllText(
  $temporaryEnvironmentPath,
  $environmentContent,
  [System.Text.UTF8Encoding]::new($false)
)
Set-SecretFileAcl -Path $temporaryEnvironmentPath

$registryPath = "HKLM:\SOFTWARE\PostgreSQL\Installations\$PostgresServiceName"
if (-not (Test-Path -LiteralPath $registryPath)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The requested PostgreSQL Windows installation was not found."
}
$installation = Get-ItemProperty -LiteralPath $registryPath
$baseDirectory = [System.IO.Path]::GetFullPath([string]$installation.'Base Directory').TrimEnd("\")
$dataDirectory = [System.IO.Path]::GetFullPath([string]$installation.'Data Directory').TrimEnd("\")
$superUser = [string]$installation.'Super User'
if (-not $superUser.Equals("postgres", [System.StringComparison]::Ordinal)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The PostgreSQL installation does not use the expected postgres bootstrap user."
}

$dataVolumeRoot = [System.IO.Path]::GetPathRoot($dataDirectory).TrimEnd("\")
if ($dataDirectory.Equals($dataVolumeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The PostgreSQL data directory cannot be a drive root."
}
if (-not (Test-Path -LiteralPath $dataDirectory -PathType Container)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The PostgreSQL data directory does not exist."
}
$dataDirectoryItem = Get-Item -LiteralPath $dataDirectory
if (($dataDirectoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "A reparse-point PostgreSQL data directory is not accepted for bootstrap."
}

$versionPath = Join-Path $dataDirectory "PG_VERSION"
if (-not (Test-Path -LiteralPath $versionPath -PathType Leaf) -or
  -not (Get-Content -LiteralPath $versionPath -Raw).Trim().Equals("16", [System.StringComparison]::Ordinal)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "Bootstrap requires the verified local PostgreSQL 16 data directory."
}

$service = Get-CimInstance Win32_Service -Filter "Name='$PostgresServiceName'"
if ($null -eq $service -or $service.State -ne "Running") {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The local PostgreSQL Windows service is not running."
}
if (([string]$service.PathName).IndexOf($dataDirectory, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The PostgreSQL service data directory does not match the verified installation registry."
}
$serviceCommandLine = [string]$service.PathName
if ($serviceCommandLine -match "(?i)(?:^|\s)(?:-c|--config-file|--config_file|-o)(?:\s|=)" -or
  $serviceCommandLine -match "(?i)\b(?:hba_file|config_file|port)\s*=") {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "PostgreSQL service command-line configuration overrides are not accepted for bootstrap."
}

$binDirectory = Join-Path $baseDirectory "bin"
$psql = Join-Path $binDirectory "psql.exe"
$pgCtl = Join-Path $binDirectory "pg_ctl.exe"
$pgIsReady = Join-Path $binDirectory "pg_isready.exe"
$postgresExecutable = Join-Path $binDirectory "postgres.exe"
foreach ($toolPath in @($psql, $pgCtl, $pgIsReady, $postgresExecutable)) {
  if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
    Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
    throw "A required PostgreSQL 16 executable is missing."
  }
}

$serviceProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$service.ProcessId)"
if ($null -eq $serviceProcess -or
  -not ([string]$serviceProcess.Name).Equals("pg_ctl.exe", [System.StringComparison]::OrdinalIgnoreCase) -or
  -not ([System.IO.Path]::GetFullPath([string]$serviceProcess.ExecutablePath)).Equals(
    [System.IO.Path]::GetFullPath($pgCtl),
    [System.StringComparison]::OrdinalIgnoreCase
  )) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The PostgreSQL Windows service is not running from the verified installation directory."
}

$postmasterPidPath = Join-Path $dataDirectory "postmaster.pid"
if (-not (Test-Path -LiteralPath $postmasterPidPath -PathType Leaf)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The running PostgreSQL instance metadata file is missing."
}
$postmasterPidItem = Get-Item -LiteralPath $postmasterPidPath
if (($postmasterPidItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "A reparse-point postmaster.pid is not accepted for bootstrap."
}
$postmasterLines = @(Get-Content -LiteralPath $postmasterPidPath)
if ($postmasterLines.Count -lt 8 -or ([string]$postmasterLines[7]).Trim() -ne "ready") {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The PostgreSQL instance metadata does not report a ready server."
}
$postmasterProcessId = 0
if (-not [int]::TryParse(([string]$postmasterLines[0]).Trim(), [ref]$postmasterProcessId)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "postmaster.pid does not contain a valid PostgreSQL server process ID."
}
$postmasterProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$postmasterProcessId"
if ($null -eq $postmasterProcess -or
  -not ([string]$postmasterProcess.Name).Equals("postgres.exe", [System.StringComparison]::OrdinalIgnoreCase) -or
  -not ([System.IO.Path]::GetFullPath([string]$postmasterProcess.ExecutablePath)).Equals(
    [System.IO.Path]::GetFullPath($postgresExecutable),
    [System.StringComparison]::OrdinalIgnoreCase
  ) -or
  ([string]$postmasterProcess.CommandLine).IndexOf(
    $dataDirectory,
    [System.StringComparison]::OrdinalIgnoreCase
  ) -lt 0) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "postmaster.pid does not identify the verified PostgreSQL server process."
}

$ancestorLinkedToService = $false
$ancestorProcessId = [int]$postmasterProcess.ParentProcessId
$visitedProcessIds = [System.Collections.Generic.HashSet[int]]::new()
for ($depth = 0; $depth -lt 8 -and $ancestorProcessId -gt 0; $depth += 1) {
  if ($ancestorProcessId -eq [int]$service.ProcessId) {
    $ancestorLinkedToService = $true
    break
  }
  if (-not $visitedProcessIds.Add($ancestorProcessId)) {
    break
  }
  $ancestorProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$ancestorProcessId"
  if ($null -eq $ancestorProcess) {
    break
  }
  $ancestorProcessId = [int]$ancestorProcess.ParentProcessId
}
if (-not $ancestorLinkedToService) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The PostgreSQL server process is not descended from the verified Windows service process."
}
$postmasterDataDirectory = [System.IO.Path]::GetFullPath(([string]$postmasterLines[1]).Trim()).TrimEnd("\")
if (-not $postmasterDataDirectory.Equals($dataDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The running PostgreSQL process uses a different data directory."
}
$postmasterPort = 0
if (-not [int]::TryParse(([string]$postmasterLines[3]).Trim(), [ref]$postmasterPort) -or
  $postmasterPort -ne $PostgresPort) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The running PostgreSQL process uses a different port."
}

$configSettings = Get-SafePostgresConfigSettings -DataDirectory $dataDirectory
if (-not [string]::IsNullOrWhiteSpace($configSettings.Port)) {
  $configuredPort = 0
  if (-not [int]::TryParse($configSettings.Port, [ref]$configuredPort) -or $configuredPort -ne $PostgresPort) {
    Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
    throw "The PostgreSQL file configuration port does not match the running server."
  }
}

$hbaConfigValue = $configSettings.HbaFile
$hbaPath = if ([string]::IsNullOrWhiteSpace($hbaConfigValue)) {
  [System.IO.Path]::GetFullPath((Join-Path $dataDirectory "pg_hba.conf"))
}
elseif ([System.IO.Path]::IsPathRooted($hbaConfigValue)) {
  [System.IO.Path]::GetFullPath($hbaConfigValue)
}
else {
  [System.IO.Path]::GetFullPath((Join-Path $dataDirectory $hbaConfigValue))
}
if (-not $hbaPath.StartsWith(($dataDirectory + [System.IO.Path]::DirectorySeparatorChar), [System.StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The configured pg_hba.conf path is outside the verified PostgreSQL data directory."
}
$dataPrefix = $dataDirectory + [System.IO.Path]::DirectorySeparatorChar
if (-not $hbaPath.StartsWith($dataPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
  -not (Test-Path -LiteralPath $hbaPath -PathType Leaf)) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The active pg_hba.conf path is outside the verified PostgreSQL data directory."
}
$hbaItem = Get-Item -LiteralPath $hbaPath
if (($hbaItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
  ($hbaItem.Attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "The active pg_hba.conf is not a regular writable file."
}

& $pgIsReady "-q" "-h" "127.0.0.1" "-p" ([string]$PostgresPort) "-t" "3"
if ($LASTEXITCODE -ne 0) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "PostgreSQL is not accepting loopback connections on the verified port."
}

$originalHbaBytes = [System.IO.File]::ReadAllBytes($hbaPath)
$originalHbaText = [System.Text.Encoding]::UTF8.GetString($originalHbaBytes)
if ($originalHbaText.Contains("CD-BOX bootstrap temporary trust")) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "A previous CD-BOX bootstrap trust marker is still present; refusing to add another rule."
}
if ($originalHbaBytes.Length -ge 2 -and
  (($originalHbaBytes[0] -eq 0xFF -and $originalHbaBytes[1] -eq 0xFE) -or
   ($originalHbaBytes[0] -eq 0xFE -and $originalHbaBytes[1] -eq 0xFF))) {
  Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  throw "UTF-16 pg_hba.conf files are not supported by the atomic bootstrap editor."
}

$ruleIdentifier = [Guid]::NewGuid().ToString("N")
$trustRule = "hostnossl`tpostgres`tpostgres`t127.0.0.1/32`ttrust`t# CD-BOX bootstrap temporary trust $ruleIdentifier`r`n"
$trustRuleBytes = [System.Text.Encoding]::ASCII.GetBytes($trustRule)
$bomLength = if ($originalHbaBytes.Length -ge 3 -and
  $originalHbaBytes[0] -eq 0xEF -and
  $originalHbaBytes[1] -eq 0xBB -and
  $originalHbaBytes[2] -eq 0xBF) { 3 } else { 0 }
$modifiedHbaBytes = New-Object byte[] ($originalHbaBytes.Length + $trustRuleBytes.Length)
if ($bomLength -gt 0) {
  [System.Buffer]::BlockCopy($originalHbaBytes, 0, $modifiedHbaBytes, 0, $bomLength)
}
[System.Buffer]::BlockCopy($trustRuleBytes, 0, $modifiedHbaBytes, $bomLength, $trustRuleBytes.Length)
[System.Buffer]::BlockCopy(
  $originalHbaBytes,
  $bomLength,
  $modifiedHbaBytes,
  $bomLength + $trustRuleBytes.Length,
  $originalHbaBytes.Length - $bomLength
)

$originalHbaHash = Get-ByteArraySha256 -Bytes $originalHbaBytes
$originalHbaAcl = Get-Acl -LiteralPath $hbaPath
$hbaDirectory = [System.IO.Path]::GetDirectoryName($hbaPath)
$hbaBackupPath = Join-Path $hbaDirectory (".pg_hba.conf.cd-box-bootstrap-{0}.bak" -f $ruleIdentifier)
$hbaModified = $false
$hbaRestored = $false
$databaseMutationAttempted = $false
$databaseReady = $false
$operationError = $null
$restoreError = $null

try {
  Write-AtomicHbaReplacement -HbaPath $hbaPath -BackupPath $hbaBackupPath `
    -ReplacementBytes $modifiedHbaBytes -OriginalAcl $originalHbaAcl
  $hbaModified = $true

  $backupHash = (Get-FileHash -LiteralPath $hbaBackupPath -Algorithm SHA256).Hash
  if (-not $backupHash.Equals($originalHbaHash, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The pg_hba.conf backup failed its integrity check."
  }

  Invoke-CheckedCommand -FilePath $pgCtl -Arguments @(
    "reload",
    "-D",
    $dataDirectory,
    "-s"
  ) -FailureMessage "PostgreSQL rejected the temporary authentication reload"

  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  $env:PGSSLMODE = "disable"
  $env:PGCONNECT_TIMEOUT = "1"
  $trustAvailable = $false
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    & $psql "--no-psqlrc" "--no-password" "--quiet" "--host=127.0.0.1" "--port=$PostgresPort" `
      "--username=postgres" "--dbname=postgres" "--tuples-only" "--command=SELECT 1;" *> $null
    if ($LASTEXITCODE -eq 0) {
      $trustAvailable = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $trustAvailable) {
    throw "The narrow temporary PostgreSQL trust rule did not become active."
  }

  $runtimeHbaOutput = @(& $psql "--no-psqlrc" "--no-password" "--quiet" `
    "--host=127.0.0.1" "--port=$PostgresPort" "--username=postgres" "--dbname=postgres" `
    "--tuples-only" "--no-align" "--command=SHOW hba_file;" 2>$null)
  $runtimePortOutput = @(& $psql "--no-psqlrc" "--no-password" "--quiet" `
    "--host=127.0.0.1" "--port=$PostgresPort" "--username=postgres" "--dbname=postgres" `
    "--tuples-only" "--no-align" "--command=SHOW port;" 2>$null)
  if ($LASTEXITCODE -ne 0 -or $runtimeHbaOutput.Count -eq 0 -or $runtimePortOutput.Count -eq 0) {
    throw "Unable to verify the running PostgreSQL authentication configuration."
  }
  $runtimeHbaPath = [System.IO.Path]::GetFullPath(([string]$runtimeHbaOutput[-1]).Trim())
  $runtimePort = 0
  if (-not $runtimeHbaPath.Equals($hbaPath, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not [int]::TryParse(([string]$runtimePortOutput[-1]).Trim(), [ref]$runtimePort) -or
    $runtimePort -ne $PostgresPort) {
    throw "The running PostgreSQL authentication path or port differs from the verified files."
  }

  $preflightOutput = @(& $psql "--no-psqlrc" "--no-password" "--quiet" "--host=127.0.0.1" `
    "--port=$PostgresPort" "--username=postgres" "--dbname=postgres" "--tuples-only" `
    "--no-align" "--command=SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cd_box_app') OR EXISTS (SELECT 1 FROM pg_database WHERE datname = 'cd_box');")
  if ($LASTEXITCODE -ne 0 -or $preflightOutput.Count -eq 0) {
    throw "Unable to perform the non-destructive database bootstrap preflight."
  }
  if (([string]$preflightOutput[-1]).Trim() -ne "f") {
    throw "The cd_box_app role or cd_box database already exists; bootstrap refused to alter either object."
  }

  $databaseSqlTemplate = @'
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
SET statement_timeout = '30s';
SET lock_timeout = '5s';
CREATE ROLE cd_box_app WITH
  LOGIN
  PASSWORD '__CD_BOX_PASSWORD__'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;
COMMENT ON ROLE cd_box_app IS 'CD-BOX local application role';
CREATE DATABASE cd_box
  WITH OWNER = cd_box_app
       ENCODING = 'UTF8'
       TEMPLATE = template0;
REVOKE ALL ON DATABASE cd_box FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE cd_box TO cd_box_app;
COMMENT ON DATABASE cd_box IS 'CD-BOX local application database';
'@
  $databaseSql = $databaseSqlTemplate.Replace("__CD_BOX_PASSWORD__", $databasePassword)
  $databaseMutationAttempted = $true
  Invoke-PsqlInput -PsqlPath $psql -Sql $databaseSql -Arguments @(
    "--no-psqlrc",
    "--no-password",
    "--quiet",
    "--set=ON_ERROR_STOP=1",
    "--host=127.0.0.1",
    "--port=$PostgresPort",
    "--username=postgres",
    "--dbname=postgres"
  ) -FailureMessage "Creating the dedicated CD-BOX database failed"

  $env:PGPASSWORD = $databasePassword
  & $psql "--no-psqlrc" "--no-password" "--quiet" "--host=127.0.0.1" "--port=$PostgresPort" `
    "--username=$databaseRole" "--dbname=$databaseName" "--tuples-only" "--command=SELECT 1;" *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "The dedicated CD-BOX database credential verification failed."
  }
  $databaseReady = $true
}
catch {
  $operationError = $_
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  Remove-Item Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue

  if ($hbaModified -or (Test-Path -LiteralPath $hbaBackupPath -PathType Leaf)) {
    try {
      Restore-OriginalHba -HbaPath $hbaPath -BackupPath $hbaBackupPath `
        -ExpectedHash $originalHbaHash -OriginalBytes $originalHbaBytes `
        -OriginalAcl $originalHbaAcl `
        -PgCtlPath $pgCtl -DataDirectory $dataDirectory
      $hbaRestored = $true
    }
    catch {
      $restoreError = $_
    }
  }
}

if ($hbaRestored) {
  Remove-Item -LiteralPath $hbaBackupPath -Force -ErrorAction SilentlyContinue
}

if ($null -ne $restoreError) {
  if (Test-Path -LiteralPath $temporaryEnvironmentPath -PathType Leaf) {
    $recoveryEnvironmentPath = Join-Path $projectRoot (".env.local.bootstrap-recovery-{0}" -f $ruleIdentifier)
    [System.IO.File]::Move($temporaryEnvironmentPath, $recoveryEnvironmentPath)
  }
  throw "CRITICAL: pg_hba.conf could not be fully restored and reloaded. The original backup was retained beside it."
}

if ($null -ne $operationError -or -not $databaseReady) {
  if ($databaseMutationAttempted -and (Test-Path -LiteralPath $temporaryEnvironmentPath -PathType Leaf)) {
    $recoveryEnvironmentPath = Join-Path $projectRoot (".env.local.bootstrap-recovery-{0}" -f $ruleIdentifier)
    [System.IO.File]::Move($temporaryEnvironmentPath, $recoveryEnvironmentPath)
    Write-Warning "Database creation began but bootstrap did not finish. A protected recovery environment file was retained without displaying its contents."
  }
  else {
    Remove-Item -LiteralPath $temporaryEnvironmentPath -Force -ErrorAction SilentlyContinue
  }

  if ($null -ne $operationError) {
    throw $operationError
  }
  throw "The dedicated CD-BOX database was not created."
}

Commit-EnvironmentFile -TemporaryPath $temporaryEnvironmentPath -DestinationPath $environmentPath `
  -ReplaceExisting:$ReplaceExistingEnvFile
Set-SecretFileAcl -Path $environmentPath

$env:DATABASE_URL = $databaseUrl
$env:LOCAL_OWNER_MODE = "true"
$env:LOCAL_OWNER_BIND_HOST = "127.0.0.1"
$env:NEXTAUTH_URL = "http://127.0.0.1:3000"
$env:AUTH_URL = "http://127.0.0.1:3000"
$env:AUTH_SECRET = $authSecret
$env:OPENAI_API_KEY = $relayKey
$env:OPENAI_BASE_URL = "https://new-api.xiron.net.cn/v1"
$env:OPENAI_TEXT_MODEL = "gpt-5.6-terra"
$env:AI_TEXT_PROTOCOL = "chat-completions"
$env:AI_MAX_COMPLETION_TOKENS = "16384"
$env:AI_REASONING_EFFORT = "none"
$env:AI_REQUEST_TIMEOUT_MS = "300000"
$env:AI_ENABLE_WEB_SEARCH = "true"
$env:AI_ORGANIZE_PUBLIC_METADATA = "false"
$env:AI_ENABLE_IMAGE_GENERATION = "false"
$env:AI_RESPONSES_SUPPORTED = "false"
$env:AI_CHAT_COMPLETIONS_SUPPORTED = "true"
$env:AI_WEB_SEARCH_SUPPORTED = "false"
Remove-Item Env:OPENAI_IMAGE_MODEL -ErrorAction SilentlyContinue
$env:NEXT_TELEMETRY_DISABLED = "1"

if (-not $SkipApplicationSetup) {
  & (Join-Path $PSScriptRoot "local-setup.ps1")
}

Write-Host "CD-BOX local bootstrap completed. Secrets were written only to the ignored .env.local file."
Write-Host "Start the application with 'npm run local:start' and open http://127.0.0.1:3000."
