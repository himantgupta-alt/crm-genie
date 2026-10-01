# Shared helpers for the CRM Genie scripts. Secrets live in C:\SALESFORCE\.secrets\ (git-ignored), one file each.
$script:SecretDir = Join-Path (Resolve-Path "$PSScriptRoot\..\..\..").Path '.secrets'
$tools = Join-Path (Resolve-Path "$PSScriptRoot\..\..\..").Path 'tools'
$env:Path = "$tools\az\bin;$tools\node;$tools\git\cmd;$tools\gh\bin;$env:Path"
# az on Windows can crash writing non-ASCII output to a cp1252 console.
$env:PYTHONIOENCODING = 'utf-8'
$env:AZURE_CORE_NO_COLOR = 'true'

function Get-SecretIfExists([string]$name) {
  $f = Join-Path $script:SecretDir "$name.txt"
  if (Test-Path $f) { return (Get-Content $f -Raw).Trim() }
  return ''
}

function Set-Secret([string]$name, [string]$value) {
  New-Item -ItemType Directory -Force $script:SecretDir | Out-Null
  Set-Content -Path (Join-Path $script:SecretDir "$name.txt") -Value $value -Encoding ascii -NoNewline
}

function Get-OrCreateSecret([string]$name) {
  $v = Get-SecretIfExists $name
  if ($v) { return $v }
  # 32 chars from upper, lower, digits and a few symbols Postgres and URLs both tolerate.
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.~'.ToCharArray()
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $v = 'Cg9' + (-join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] }))
  Set-Secret $name $v
  return $v
}
