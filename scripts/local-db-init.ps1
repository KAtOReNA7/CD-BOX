. (Join-Path $PSScriptRoot "local-common.ps1")

$projectRoot = Get-LocalProjectRoot
$connection = Set-PostgresEnvironmentFromDatabaseUrl
$psql = Resolve-PostgresTool -Name "psql.exe"
$npm = Resolve-RequiredCommand -Name "npm.cmd"
$temporarySql = [System.IO.Path]::GetTempFileName()

try {
  $initializationSql = @'
\set ON_ERROR_STOP on
SELECT format('CREATE DATABASE %I WITH ENCODING = %L TEMPLATE = template0', :'database_name', 'UTF8')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database_name')
\gexec
'@
  [System.IO.File]::WriteAllText(
    $temporarySql,
    $initializationSql,
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-Host "Ensuring the local PostgreSQL database exists on $($connection.Host):$($connection.Port)..."
  Invoke-CheckedCommand -FilePath $psql -Arguments @(
    "--no-password",
    "--quiet",
    "--dbname=postgres",
    "--variable=database_name=$($connection.DatabaseName)",
    "--file=$temporarySql"
  ) -FailureMessage "Database initialization failed"
}
finally {
  Remove-Item -LiteralPath $temporarySql -Force -ErrorAction SilentlyContinue
}

Push-Location $projectRoot
try {
  Write-Host "Generating the Prisma client..."
  Invoke-CheckedCommand -FilePath $npm -Arguments @("run", "db:generate") -FailureMessage "Prisma client generation failed"

  Write-Host "Applying committed database migrations..."
  Invoke-CheckedCommand -FilePath $npm -Arguments @("run", "db:migrate:deploy") -FailureMessage "Database migration failed"
}
finally {
  Pop-Location
}

Write-Host "The local database is ready."
