Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-LocalProjectRoot {
  $projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
  $packageJson = Join-Path $projectRoot "package.json"

  if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
    throw "Unable to locate the CD-BOX project root."
  }

  return $projectRoot
}

function Resolve-RequiredCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    throw "Required command '$Name' was not found."
  }

  return $command.Source
}

function Resolve-PostgresTool {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
      "psql.exe",
      "pg_dump.exe",
      "pg_restore.exe",
      "pg_ctl.exe",
      "pg_isready.exe",
      "postgres.exe"
    )]
    [string]$Name
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $installRoots = @()
  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles})) {
    $installRoots += (Join-Path ${env:ProgramFiles} "PostgreSQL")
  }
  if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
    $installRoots += (Join-Path ${env:ProgramFiles(x86)} "PostgreSQL")
  }

  foreach ($installRoot in ($installRoots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $installRoot -PathType Container)) {
      continue
    }

    $versions = Get-ChildItem -LiteralPath $installRoot -Directory -ErrorAction SilentlyContinue |
      Sort-Object -Property @{ Expression = {
        $parsedVersion = [version]"0.0"
        if ([version]::TryParse($_.Name, [ref]$parsedVersion)) {
          return $parsedVersion
        }
        return [version]"0.0"
      } } -Descending

    foreach ($versionDirectory in $versions) {
      $candidate = Join-Path $versionDirectory.FullName (Join-Path "bin" $Name)
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
      }
    }
  }

  throw "PostgreSQL tool '$Name' was not found in PATH or a standard Windows installation."
}

function Set-PostgresEnvironmentFromDatabaseUrl {
  $databaseUrl = $env:DATABASE_URL
  if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
    throw "DATABASE_URL is required. Store it in the ignored .env.local file or provide it in the process environment."
  }

  try {
    $uri = [System.Uri]$databaseUrl
  }
  catch {
    throw "DATABASE_URL must be a valid PostgreSQL URL. Its value was not logged."
  }

  if ($uri.Scheme -notin @("postgres", "postgresql")) {
    throw "DATABASE_URL must use the postgres:// or postgresql:// scheme."
  }

  $databaseName = [System.Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
  if ([string]::IsNullOrWhiteSpace($uri.Host) -or [string]::IsNullOrWhiteSpace($databaseName)) {
    throw "DATABASE_URL must include a host and database name."
  }
  if ($databaseName.Contains("/")) {
    throw "DATABASE_URL must identify exactly one database."
  }

  $username = ""
  $password = ""
  if (-not [string]::IsNullOrEmpty($uri.UserInfo)) {
    $separatorIndex = $uri.UserInfo.IndexOf(":")
    if ($separatorIndex -ge 0) {
      $username = [System.Uri]::UnescapeDataString($uri.UserInfo.Substring(0, $separatorIndex))
      $password = [System.Uri]::UnescapeDataString($uri.UserInfo.Substring($separatorIndex + 1))
    }
    else {
      $username = [System.Uri]::UnescapeDataString($uri.UserInfo)
    }
  }

  $env:PGHOST = $uri.Host
  $env:PGPORT = if ($uri.IsDefaultPort) { "5432" } else { [string]$uri.Port }
  $env:PGDATABASE = $databaseName

  if ([string]::IsNullOrEmpty($username)) {
    Remove-Item Env:PGUSER -ErrorAction SilentlyContinue
  }
  else {
    $env:PGUSER = $username
  }

  if ([string]::IsNullOrEmpty($password)) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
  else {
    $env:PGPASSWORD = $password
  }

  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
  $query = $uri.Query.TrimStart("?")
  if (-not [string]::IsNullOrWhiteSpace($query)) {
    foreach ($pair in $query.Split("&", [System.StringSplitOptions]::RemoveEmptyEntries)) {
      $parts = $pair.Split("=", 2)
      $key = [System.Uri]::UnescapeDataString($parts[0])
      $value = if ($parts.Count -gt 1) { [System.Uri]::UnescapeDataString($parts[1]) } else { "" }
      if ($key -ieq "sslmode" -and -not [string]::IsNullOrWhiteSpace($value)) {
        $env:PGSSLMODE = $value
      }
    }
  }

  return [pscustomobject]@{
    DatabaseName = $databaseName
    Host = $uri.Host
    Port = if ($uri.IsDefaultPort) { 5432 } else { $uri.Port }
  }
}

function Resolve-LocalPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $true)]
    [string]$BasePath
  )

  $candidate = if ([System.IO.Path]::IsPathRooted($Path)) {
    $Path
  }
  else {
    Join-Path $BasePath $Path
  }

  return [System.IO.Path]::GetFullPath($candidate)
}

function Assert-SafeBackupDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  $volumeRoot = [System.IO.Path]::GetPathRoot($fullPath).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  if ($fullPath -eq $volumeRoot) {
    throw "The backup directory cannot be a drive root."
  }

  return $fullPath
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit code $LASTEXITCODE)."
  }
}

function Set-LocalRuntimeEnvironment {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int]$Port
  )

  $localUrl = "http://127.0.0.1:$Port"
  $env:LOCAL_OWNER_MODE = "true"
  $env:LOCAL_OWNER_BIND_HOST = "127.0.0.1"
  $env:NEXTAUTH_URL = $localUrl
  $env:AUTH_URL = $localUrl
  $env:NEXT_TELEMETRY_DISABLED = "1"
}

function Set-LocalNodeProxyEnvironment {
  # Node's built-in environment proxy supports HTTP_PROXY, HTTPS_PROXY, and
  # NO_PROXY. Map an ALL_PROXY-only desktop setup into the variables Node
  # actually reads, without overriding either protocol-specific value.
  if (-not [string]::IsNullOrWhiteSpace($env:ALL_PROXY)) {
    if ([string]::IsNullOrWhiteSpace($env:HTTP_PROXY)) {
      $env:HTTP_PROXY = $env:ALL_PROXY
    }
    if ([string]::IsNullOrWhiteSpace($env:HTTPS_PROXY)) {
      $env:HTTPS_PROXY = $env:ALL_PROXY
    }
  }

  # Local owner mode and a supported local OpenAI-compatible relay both use
  # loopback HTTP. Never send those requests (or their bearer credentials)
  # through an inherited desktop/corporate proxy. Preserve every existing
  # NO_PROXY entry and append only missing loopback identities.
  $existingNoProxy = if ([string]::IsNullOrWhiteSpace($env:NO_PROXY)) {
    ""
  }
  else {
    $env:NO_PROXY.Trim()
  }
  $seen = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
  )
  foreach ($entry in ($existingNoProxy -split ",")) {
    $normalized = $entry.Trim()
    if ($normalized) {
      [void]$seen.Add($normalized)
    }
  }
  $missingLoopback = @(
    @("localhost", "127.0.0.1", "::1") |
      Where-Object { -not $seen.Contains($_) }
  )
  if ($missingLoopback.Count -gt 0) {
    $separator = if (-not $existingNoProxy -or $existingNoProxy.EndsWith(",")) { "" } else { "," }
    $env:NO_PROXY = "${existingNoProxy}${separator}$($missingLoopback -join ',')"
  }
  elseif ($existingNoProxy) {
    $env:NO_PROXY = $existingNoProxy
  }

  # Node 24 reads the proxy variables above only when environment-proxy mode
  # is enabled before the Node process starts. With no proxy configured this is
  # harmless; NO_PROXY remains useful if a parent process adds one later.
  $env:NODE_USE_ENV_PROXY = "1"
}

function New-CryptographicToken {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(16, 256)]
    [int]$ByteCount
  )

  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  }
  finally {
    $generator.Dispose()
  }

  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}
