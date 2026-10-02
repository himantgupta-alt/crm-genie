<#
.SYNOPSIS
  Builds the CRM Genie database in Azure: compiled schema (target/db), org data (output/data), parity baseline.

.DESCRIPTION
  Runs app/scripts/load.js from this machine against the Azure Postgres server. deploy.ps1 adds a firewall
  rule for this machine's IP. -Recreate drops and rebuilds schema app (and the sf_* roles); without it an
  existing schema stops the load.

.EXAMPLE
  .\load_db.ps1 -Recreate
#>
param(
  [string]$Subscription = '4ba3f0a9-d7ef-4952-b635-8ed5a84b5b76',
  [string]$ResourceGroup = 'AZAP-agentic-finance',
  [string]$Server = 'crmgenie-pg-hg01',
  [switch]$Recreate
)
# az writes warnings to stderr, which PowerShell 5.1 turns into terminating errors under 'Stop';
# exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\common.ps1"

az account set --subscription $Subscription | Out-Null
$fqdn = az postgres flexible-server show -g $ResourceGroup -n $Server --query fullyQualifiedDomainName -o tsv
if (-not $fqdn) { throw "server $Server not found" }

# This machine's public IP changes between networks; keep the 'deployer' firewall rule current.
$myIp = (Invoke-RestMethod 'https://api.ipify.org?format=json' -UseBasicParsing).ip
az postgres flexible-server firewall-rule create -g $ResourceGroup --server-name $Server --name deployer `
  --start-ip-address $myIp --end-ip-address $myIp --only-show-errors -o none
if ($LASTEXITCODE -ne 0) { throw "could not open the firewall for $myIp" }
Write-Host "firewall open for $myIp"

$env:PGHOST = $fqdn
$env:PGDATABASE = 'crm'
$env:PGUSER = 'crmadmin'
$env:PGPASSWORD = Get-SecretIfExists 'crmgenie-pg-admin'
$env:PGSSLMODE = 'require'
if (-not $env:PGPASSWORD) { throw 'no Postgres password in .secrets; run deploy.ps1 first' }

Push-Location "$PSScriptRoot\..\app"
try {
  if (-not (Test-Path node_modules)) { npm ci --omit=dev --no-fund --no-audit }
  $nodeArgs = @('scripts/load.js')
  if ($Recreate) { $nodeArgs += '--recreate' }
  node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw 'load failed' }
} finally {
  Pop-Location
  Remove-Item Env:PGPASSWORD
}
