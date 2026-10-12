<#
.SYNOPSIS
  Connects the hosted Org Compiler to an org already logged in on this machine (Salesforce CLI), so the site
  starts connected to it. Others replace it on the Connections page with Connect with Salesforce.

.DESCRIPTION
  Runs src/app/scripts/seed-connection.js against the Azure Postgres server: the CLI's refresh token is encrypted
  with the site's CONNECTION_KEY (from .secrets, set by deploy.ps1) and stored in ops.org_connection.

.EXAMPLE
  .\seed_connection.ps1                       # region eu from CLI alias myorg
  .\seed_connection.ps1 -Region apac -Alias apac
#>
param(
  [string]$Region = 'eu',
  [string]$Alias = 'myorg',
  [string]$Subscription = '4ba3f0a9-d7ef-4952-b635-8ed5a84b5b76',
  [string]$ResourceGroup = 'AZAP-agentic-finance',
  [string]$Server = 'crmgenie-pg-hg01'
)
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\common.ps1"

az account set --subscription $Subscription | Out-Null
$fqdn = az postgres flexible-server show -g $ResourceGroup -n $Server --query fullyQualifiedDomainName -o tsv
if (-not $fqdn) { throw "server $Server not found" }
$myIp = (Invoke-RestMethod 'https://api.ipify.org?format=json' -UseBasicParsing).ip
az postgres flexible-server firewall-rule create -g $ResourceGroup --server-name $Server --name deployer `
  --start-ip-address $myIp --end-ip-address $myIp --only-show-errors -o none

$env:PGHOST = $fqdn
$env:PGDATABASE = 'crm'
$env:PGUSER = 'crmadmin'
$env:PGPASSWORD = Get-SecretIfExists 'crmgenie-pg-admin'
$env:PGSSLMODE = 'require'
$env:CONNECTION_KEY = Get-SecretIfExists 'orgcompiler-connection-key'
if (-not $env:CONNECTION_KEY) { throw 'no connection key in .secrets; run deploy.ps1 first' }

Push-Location "$PSScriptRoot\..\..\..\src\app"
try {
  node scripts/seed-connection.js $Region $Alias
  if ($LASTEXITCODE -ne 0) { throw 'seed failed' }
} finally {
  Pop-Location
  Remove-Item Env:PGPASSWORD, Env:CONNECTION_KEY
}
