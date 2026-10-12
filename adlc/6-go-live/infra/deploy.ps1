<#
.SYNOPSIS
  Provisions CRM Genie in Azure (Postgres Flexible Server + App Service) with main.bicep.

.DESCRIPTION
  Same subscription and resource group as Cash Forecasting and Revenue Genie; separate resources and tags.
  The Postgres password is generated once and kept in C:\SALESFORCE\.secrets\ (git-ignored).
  Run with -WhatIf first to see what would change.

.EXAMPLE
  .\deploy.ps1 -WhatIf
  .\deploy.ps1
#>
param(
  [string]$Subscription = '4ba3f0a9-d7ef-4952-b635-8ed5a84b5b76',
  [string]$ResourceGroup = 'AZAP-agentic-finance',
  [string]$SfInstanceUrl = 'https://demo-org-dev-ed.develop.my.salesforce.com',
  [switch]$WhatIf
)
# az writes warnings to stderr, which PowerShell 5.1 turns into terminating errors under 'Stop';
# exit codes are checked explicitly instead.
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\common.ps1"

az account set --subscription $Subscription | Out-Null
$pgPassword = Get-OrCreateSecret 'crmgenie-pg-admin'
$authSecret = Get-SecretIfExists 'crmgenie-auth-client-secret'
$sessionSecret = Get-OrCreateSecret 'crmgenie-session-secret'
$appUsers = Get-AppUsersJson
# The demo account's credentials are filled into the sign-in form (CRM Genie and Org Compiler share it).
$loginPrefill = @{ username = 'demo'; password = (Get-SecretIfExists 'crmgenie-user-demo') } | ConvertTo-Json -Compress
# Org Compiler connections: encryption key (generated once) and the connected app's consumer key.
$connectionKey = Get-OrCreateSecret 'orgcompiler-connection-key'
$oauthClientId = Get-SecretIfExists 'orgcompiler-oauth-client-id'
$myIp = (Invoke-RestMethod 'https://api.ipify.org?format=json' -UseBasicParsing).ip
Write-Host "deployer IP: $myIp"

$paramFile = New-TemporaryFile
@{
  '$schema' = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#'
  contentVersion = '1.0.0.0'
  parameters = @{
    pgAdminPassword = @{ value = $pgPassword }
    authClientSecret = @{ value = $authSecret }
    appUsers = @{ value = $appUsers }
    sessionSecret = @{ value = $sessionSecret }
    loginPrefill = @{ value = $loginPrefill }
    connectionKey = @{ value = $connectionKey }
    oauthClientId = @{ value = $oauthClientId }
    sfInstanceUrl = @{ value = $SfInstanceUrl }
    deployerIp = @{ value = $myIp }
  }
} | ConvertTo-Json -Depth 5 | Set-Content -Path $paramFile -Encoding utf8
try {
  $name = "crmgenie-$(Get-Date -Format yyyyMMdd-HHmmss)"
  if ($WhatIf) {
    az deployment group what-if -g $ResourceGroup -n $name -f "$PSScriptRoot\main.bicep" -p "@$paramFile"
  } else {
    $out = az deployment group create -g $ResourceGroup -n $name -f "$PSScriptRoot\main.bicep" -p "@$paramFile" --query properties.outputs -o json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'deployment failed' }
    Write-Host "site:     $($out.siteUrl.value)"
    Write-Host "postgres: $($out.pgServer.value) / $($out.pgDatabase.value)"
  }
} finally {
  Remove-Item $paramFile -Force
}
