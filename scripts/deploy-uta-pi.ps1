param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "ahad",
  [string]$RepoDir = "/home/ahad/autonomous_stock_trader_ahad",
  [string]$ServiceName = "uta-autonomous-stock-trader",
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [switch]$SkipNpmCi
)

$ErrorActionPreference = "Stop"

function Invoke-Pi {
  param([string]$Command)
  ssh "$User@$HostName" $Command
}

$remoteScript = @"
set -euo pipefail
cd "$RepoDir"
git fetch origin main
git pull --ff-only origin main
node --version
$(if ($SkipNpmCi) { "echo 'Skipping npm ci by request'" } else { "npm ci" })
npm run build:uta
npm run check:uta-pi-profile
npm run check:uta-historical-replay
npm run check:uta-calibration
npm run check:uta-trading-integration
sudo systemctl daemon-reload
sudo systemctl restart "$ServiceName"
sudo systemctl status "$ServiceName" --no-pager
npm run check:uta-deploy-smoke -- --base-url "$BaseUrl"
"@

Write-Host "Deploying UTA to $User@$HostName from $RepoDir"
Invoke-Pi $remoteScript
