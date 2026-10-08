<#
.SYNOPSIS
  Renders the client pack (docs/client-pack/pack.json) to A4 PDFs with Microsoft Edge (headless).
  Diagrams are drawn by mermaid from src/generators/node_modules (npm install there first); no CDN is used.
.EXAMPLE
  .\src\generators\render-client-pack.ps1   # -> presentations\client-pack
#>
param([string]$OutDir = (Join-Path $PSScriptRoot '..\..\presentations\client-pack'))
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$env:Path = "$root\tools\node;$env:Path"
if (-not (Test-Path "$root\src\generators\node_modules\mermaid")) { npm install --prefix "$root\src\generators" }
node "$root\src\generators\emit-client-pack.js"
if ($LASTEXITCODE) { throw 'emit-client-pack.js failed' }
$html = Join-Path $env:TEMP 'crm-genie-client-pack-html'
if (Test-Path $html) { Remove-Item -Recurse -Force $html }
node "$root\src\generators\client-pack-html.js" $html
if ($LASTEXITCODE) { throw 'client-pack-html.js failed' }
New-Item -ItemType Directory -Force $OutDir | Out-Null
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$names = Get-Content (Join-Path $html 'names.json') -Raw | ConvertFrom-Json
foreach ($f in Get-ChildItem $html -Filter *.html | Sort-Object Name) {
  $pdf = Join-Path $OutDir ($names.($f.BaseName) + '.pdf')
  $uri = 'file:///' + ($f.FullName -replace '\\', '/')
  $profile = Join-Path $env:TEMP 'crm-genie-edge-profile'
  Start-Process -FilePath $edge -ArgumentList @('--headless', '--disable-gpu', '--allow-file-access-from-files', "--user-data-dir=`"$profile`"", '--no-pdf-header-footer', '--virtual-time-budget=60000', "--print-to-pdf=`"$pdf`"", "`"$uri`"") -Wait | Out-Null
  "{0}  ({1:N0} KB)" -f (Split-Path $pdf -Leaf), ((Get-Item $pdf).Length / 1KB)
}
