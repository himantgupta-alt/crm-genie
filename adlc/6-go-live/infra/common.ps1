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

function Get-OrCreateReadablePassword([string]$name) {
  $v = Get-SecretIfExists $name
  if ($v) { return $v }
  # Four groups of four, without look-alike characters, for passwords people type: e.g. k7Qm-2xPa-Hd9r-Wt4e
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'.ToCharArray()
  $bytes = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $s = -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
  $v = '{0}-{1}-{2}-{3}' -f $s.Substring(0, 4), $s.Substring(4, 4), $s.Substring(8, 4), $s.Substring(12, 4)
  Set-Secret $name $v
  return $v
}

# In-app sign-in users. Add a line here to give someone access, then re-run deploy.ps1.
$script:AppUsers = [ordered]@{
  'demo' = 'Demo User'
  'guest'  = 'Guest Reviewer'
}

function Get-AppUsersJson {
  $node = Join-Path $tools 'node\node.exe'
  $hasher = Join-Path (Resolve-Path "$PSScriptRoot\..\..\..\src\app").Path 'scripts\hash-password.js'
  $users = [ordered]@{}
  foreach ($u in $script:AppUsers.Keys) {
    $pw = Get-OrCreateReadablePassword "crmgenie-user-$u"
    $hash = $pw | & $node $hasher
    if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "could not hash password for $u" }
    $users[$u] = [ordered]@{ name = $script:AppUsers[$u]; hash = "$hash" }
  }
  return ($users | ConvertTo-Json -Compress)
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
