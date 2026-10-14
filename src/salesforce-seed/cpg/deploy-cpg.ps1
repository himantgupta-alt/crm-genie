<#
.SYNOPSIS
  Builds one regional org of the assessment demo (Brightwell Consumer Goods, sample data) and deploys it.

.DESCRIPTION
  1. node seed-cpg.js <region>  writes out/<region>/ (metadata, permission set, seed-data.apex)
  2. deploys it to the org, running only the demo's own Apex tests
  3. assigns the Brightwell_Sales permission set to the deploying user
  4. loads the sample records (skipped if the org already has them)
  Writes to the org: only use it on a demo org.

.EXAMPLE
  .\deploy-cpg.ps1 -Region eu                 # alias myorg
  .\deploy-cpg.ps1 -Region apac -Alias apac
  .\deploy-cpg.ps1 -Region amer -Alias amer -ValidateOnly
#>
param(
  [Parameter(Mandatory)][ValidateSet('eu', 'apac', 'amer')][string]$Region,
  [string]$Alias,
  [switch]$ValidateOnly
)
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path "$PSScriptRoot\..\..\..").Path
$env:Path = "$root\tools\node;$root\tools\git\cmd;$env:Path"
if (-not $Alias) { $Alias = @{ eu = 'myorg'; apac = 'apac'; amer = 'amer' }[$Region] }

node "$PSScriptRoot\seed-cpg.js" $Region
if ($LASTEXITCODE -ne 0) { throw 'seed-cpg.js failed' }
$out = Join-Path $PSScriptRoot "out\$Region"
$tests = (Get-Content (Join-Path $out 'tests.txt') -Raw).Trim() -split ' '

Push-Location $out
try {
  $testArgs = @('--test-level', 'RunSpecifiedTests'); foreach ($t in $tests) { $testArgs += @('--tests', $t) }
  $mode = if ($ValidateOnly) { 'validate' } else { 'start' }
  # --json keeps the output to one result; on failure the CLI puts the reasons in .message.
  $j = sf project deploy $mode --source-dir force-app --target-org $Alias --wait 30 --json @testArgs 2>$null | Out-String | ConvertFrom-Json
  if ($j.status -ne 0) { throw "deploy ($mode) to $Alias failed:`n$($j.message)" }
  $r = $j.result
  Write-Host "deploy ($mode) to ${Alias}: $($r.status) - components $($r.numberComponentsDeployed)/$($r.numberComponentsTotal) - tests $($r.numberTestsCompleted) passed"
  if ($ValidateOnly) { Write-Host "validated against $Alias (nothing deployed)"; return }

  sf org assign permset --name Brightwell_Sales --target-org $Alias
  # Exit code 1 here usually means the user already has it.
  sf apex run --file seed-data.apex --target-org $Alias
  if ($LASTEXITCODE -ne 0) { throw "seed data failed on $Alias" }
  if (Test-Path seed-extra.apex) {
    sf apex run --file seed-extra.apex --target-org $Alias
    if ($LASTEXITCODE -ne 0) { throw "extra seed data failed on $Alias" }
  }
  Write-Host "Brightwell $Region org ready on $Alias"
} finally { Pop-Location }
