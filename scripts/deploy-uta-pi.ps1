param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "ahad",
  [string]$RepoDir = "/home/ahad/flow_momentum_transition-08062026",
  [string]$RepoUrl = "https://github.com/meiriohad76-oss/flow_momentum_transition-08062026.git",
  [string]$ServiceName = "uta-autonomous-stock-trader",
  [string]$BaseUrl = "http://127.0.0.1:3000",
  [string]$DatabaseDir = "/mnt/uta-ssd",
  [switch]$AllowUnMountedDatabaseDir,
  [switch]$InstallNode24,
  [switch]$SkipNpmCi
)

$ErrorActionPreference = "Stop"
$installNode24Value = if ($InstallNode24) { "true" } else { "false" }
$allowUnMountedDatabaseDirValue = if ($AllowUnMountedDatabaseDir) { "true" } else { "false" }

$remoteScript = @"
set -euo pipefail
if [ ! -d "$RepoDir/.git" ]; then
  echo "Repo directory $RepoDir is missing; cloning $RepoUrl"
  mkdir -p "`$(dirname "$RepoDir")"
  git clone "$RepoUrl" "$RepoDir"
fi
cd "$RepoDir"
git fetch origin main
git pull --ff-only origin main
INSTALL_NODE24="$installNode24Value"
if ! command -v node >/dev/null 2>&1; then
  if [ "`$INSTALL_NODE24" = "true" ]; then
    echo "Node.js is missing; installing Node.js 24 from NodeSource"
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "Node.js is missing. Re-run with -InstallNode24 or install Node.js 24 on the Pi first." >&2
    exit 127
  fi
fi
node --version
NODE_MAJOR="`$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "`$NODE_MAJOR" -lt 24 ]; then
  if [ "`$INSTALL_NODE24" = "true" ]; then
    echo "Node.js major version `$NODE_MAJOR is below 24; upgrading via NodeSource"
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    echo "Node.js 24+ is required. Current version: `$(node --version). Re-run with -InstallNode24." >&2
    exit 127
  fi
fi
npm --version
$(if ($SkipNpmCi) { "echo 'Skipping npm ci by request'" } else { "npm ci" })
npm run build:uta
npm run check:uta-pi-profile
npm run check:uta-historical-replay
npm run check:uta-calibration
npm run check:uta-trading-integration
DATABASE_DIR="$DatabaseDir"
ALLOW_UNMOUNTED_DATABASE_DIR="$allowUnMountedDatabaseDirValue"
sudo mkdir -p "`$DATABASE_DIR"
sudo chown "${User}:${User}" "`$DATABASE_DIR"
sudo chmod 750 "`$DATABASE_DIR"
if ! findmnt -T "`$DATABASE_DIR" >/dev/null 2>&1; then
  if [ "`$ALLOW_UNMOUNTED_DATABASE_DIR" = "true" ]; then
    echo "WARNING: `$DATABASE_DIR is not on a mounted filesystem target; continuing because AllowUnMountedDatabaseDir is set." >&2
  else
    echo "Database directory `$DATABASE_DIR is not on a mounted filesystem target. Mount SSD/NVMe there or re-run with -AllowUnMountedDatabaseDir for a temporary smoke only." >&2
    exit 1
  fi
fi
if [ ! -f "/etc/systemd/system/$ServiceName.service" ]; then
  echo "Installing $ServiceName.service"
else
  echo "Refreshing $ServiceName.service"
fi
sudo install -m 0644 "deploy/uta-autonomous-stock-trader.service" "/etc/systemd/system/$ServiceName.service"
sudo sed -i \
  -e "s#^User=.*#User=$User#" \
  -e "s#^Group=.*#Group=$User#" \
  -e "s#^WorkingDirectory=.*#WorkingDirectory=$RepoDir#" \
  -e "s#^Environment=DATABASE_PATH=.*#Environment=DATABASE_PATH=$DatabaseDir/sentiment-analyst.sqlite#" \
  "/etc/systemd/system/$ServiceName.service"
sudo systemctl daemon-reload
sudo systemctl enable "$ServiceName"
sudo systemctl restart "$ServiceName"
sudo systemctl status "$ServiceName" --no-pager
if ! npm run check:uta-deploy-smoke -- --base-url "$BaseUrl" --wait-ms 120000 --interval-ms 3000; then
  echo "UTA deploy smoke failed; recent service logs follow." >&2
  sudo journalctl -u "$ServiceName" -n 80 --no-pager
  exit 1
fi
"@

Write-Host "Deploying UTA to $User@$HostName from $RepoDir"
$localTemp = Join-Path ([System.IO.Path]::GetTempPath()) "uta-deploy-$([System.Guid]::NewGuid().ToString('N')).sh"
$remoteTemp = "/tmp/uta-deploy-$([System.Guid]::NewGuid().ToString('N')).sh"
try {
  [System.IO.File]::WriteAllText($localTemp, $remoteScript, [System.Text.UTF8Encoding]::new($false))
  scp $localTemp "$User@$HostName`:$remoteTemp"
  ssh -tt "$User@$HostName" "chmod +x '$remoteTemp' && bash '$remoteTemp'; status=`$?; rm -f '$remoteTemp'; exit `$status"
} finally {
  Remove-Item -LiteralPath $localTemp -ErrorAction SilentlyContinue
}
