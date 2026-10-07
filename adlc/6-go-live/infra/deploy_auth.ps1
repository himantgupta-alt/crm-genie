<#
.SYNOPSIS
  Turns on Microsoft Entra sign-in (App Service authentication) for CRM Genie: only accounts in this tenant.

.DESCRIPTION
  Creates (or reuses) the "CRM Genie" app registration, adds a client secret, and configures Easy Auth with
  /health left open for the pipeline's health check. The secret is saved to .secrets so deploy.ps1 can
  re-apply it (Bicep replaces all app settings). Needs permission to create app registrations in the tenant.
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

az account set --subscription $Subscription | Out-Null
$tenant = az account show --query tenantId -o tsv
$host_ = az webapp show -g $ResourceGroup -n $Site --query defaultHostName -o tsv
$redirect = "https://$host_/.auth/login/aad/callback"

$appId = az ad app list --display-name 'CRM Genie' --query '[0].appId' -o tsv
if (-not $appId) {
  $appId = az ad app create --display-name 'CRM Genie' --sign-in-audience AzureADMyOrg --web-redirect-uris $redirect --enable-id-token-issuance true --query appId -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $appId) { throw 'could not create the app registration (the tenant may restrict this)' }
  Write-Host "created app registration $appId"
} else {
  az ad app update --id $appId --web-redirect-uris $redirect --enable-id-token-issuance true | Out-Null
  Write-Host "reusing app registration $appId"
}
$secret = az ad app credential reset --id $appId --display-name 'easyauth' --years 1 --append --query password -o tsv
Set-Secret 'crmgenie-auth-client-secret' $secret

az webapp auth microsoft update -g $ResourceGroup -n $Site --client-id $appId --client-secret $secret `
  --issuer "https://login.microsoftonline.com/$tenant/v2.0" --allowed-audiences "api://$appId" "$appId" --yes | Out-Null
az webapp auth update -g $ResourceGroup -n $Site --enabled true --unauthenticated-client-action RedirectToLoginPage `
  --redirect-provider azureactivedirectory --excluded-paths '["/health"]' | Out-Null
Write-Host "Entra sign-in enabled for https://$host_ (tenant $tenant)"
