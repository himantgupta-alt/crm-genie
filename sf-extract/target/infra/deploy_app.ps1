<#
.SYNOPSIS
  Packages target/app (with production node_modules) and zip-deploys it to the CRM Genie App Service.

.DESCRIPTION
  The same package the GitHub Actions pipeline builds. Use this for a manual deploy from the laptop.
  The zip is written with forward-slash entry names: PowerShell 5.1 Compress-Archive writes backslashes,
  which break on Linux App Service.
#>
param(
  [string]$Subscription = '4ba3f0a9-d7ef-4952-b635-8ed5a84b5b76',
  [string]$ResourceGroup = 'AZAP-agentic-finance',
  [string]$Site = 'crmgenie-app-hg01'
)
# az writes warnings to stderr, which PowerShell 5.1 turns into terminating errors under 'Stop';
# exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\common.ps1"

$appDir = (Resolve-Path "$PSScriptRoot\..\app").Path
$demo = Join-Path (Resolve-Path "$PSScriptRoot\..\..").Path 'demo\org-compiler.html'
Copy-Item $demo (Join-Path $appDir 'public\compiler.html') -Force

Push-Location $appDir
try { npm ci --omit=dev --no-fund --no-audit --loglevel=error; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' } } finally { Pop-Location }

$zip = Join-Path $env:TEMP "crmgenie-$(Get-Date -Format yyyyMMdd-HHmmss).zip"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  Get-ChildItem $appDir -Recurse -File | Where-Object { $_.FullName -notmatch '\\scripts\\' } | ForEach-Object {
    $rel = $_.FullName.Substring($appDir.Length + 1).Replace('\', '/')
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $rel, 'Optimal')
  }
} finally { $archive.Dispose() }
Write-Host "package: $zip ($([math]::Round((Get-Item $zip).Length/1MB,1)) MB)"

az account set --subscription $Subscription | Out-Null
az webapp deploy -g $ResourceGroup -n $Site --src-path $zip --type zip --clean true --restart true
if ($LASTEXITCODE -ne 0) { throw 'deploy failed' }
$url = "https://$(az webapp show -g $ResourceGroup -n $Site --query defaultHostName -o tsv)"
for ($i = 0; $i -lt 30; $i++) {
  try { $h = Invoke-RestMethod "$url/health" -UseBasicParsing -TimeoutSec 10; if ($h.ok) { Write-Host "healthy: $url"; break } } catch { Start-Sleep -Seconds 5 }
}
Remove-Item $zip -Force
