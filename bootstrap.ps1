<#
.SYNOPSIS  Bring a clean Windows machine to a working workspace.
.EXAMPLE   .\bootstrap.ps1 -Scope showcase
#>
param([string]$Scope = 'core')
$ErrorActionPreference = 'Stop'
$need = 22
function Test-Node { $v = (Get-Command node -ErrorAction SilentlyContinue); if (-not $v) { return $false }; [int](node -p 'process.versions.node.split(".")[0]') -ge $need }

if (-not (Test-Node)) {
  Write-Output "Node $need or newer is required; installing the LTS release with winget."
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
if (-not (Test-Node)) { throw "Node $need+ is still not on PATH. Open a new terminal and run this again." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is required (winget install Git.Git).' }

Set-Location $PSScriptRoot
node src/cli.mjs pull --scope=$Scope
node src/cli.mjs doctor
Write-Output "Done. Next: node src/cli.mjs status --scope=$Scope"
