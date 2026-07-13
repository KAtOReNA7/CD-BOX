param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('\A[A-Za-z0-9._:/-]{1,100}\z')]
  [string]$Model
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $projectRoot ".env.local"
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
  throw "The ignored .env.local file does not exist. Run local bootstrap first."
}

$file = Get-Item -LiteralPath $environmentPath -Force
if ($file.Length -gt 1MB) {
  throw "The local environment file is unexpectedly large and was not changed."
}
$content = [System.IO.File]::ReadAllText($environmentPath)
if ($content.IndexOf([char]0) -ge 0) {
  throw "The local environment file contains invalid data and was not changed."
}

$pattern = '(?m)^OPENAI_TEXT_MODEL=(?:"[^"\r\n]*"|[^\r\n]*)\r?$'
$matches = [System.Text.RegularExpressions.Regex]::Matches($content, $pattern)
if ($matches.Count -ne 1) {
  throw "The local environment file must contain exactly one OPENAI_TEXT_MODEL entry."
}
$replacement = 'OPENAI_TEXT_MODEL="' + $Model + '"'
$updated = [System.Text.RegularExpressions.Regex]::Replace($content, $pattern, $replacement)

# Writing the existing file in place preserves the restrictive ACL established
# by local bootstrap. Neither the old contents nor the selected model is echoed.
[System.IO.File]::WriteAllText(
  $environmentPath,
  $updated,
  [System.Text.UTF8Encoding]::new($false)
)
Write-Host "The local AI model setting was updated without displaying environment contents."
