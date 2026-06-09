param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "ahad",
  [string]$UtaHostname = "uta.ahaddashboards.uk",
  [string]$ConfigPath = "/etc/cloudflared/config.yml"
)

$ErrorActionPreference = "Stop"

$remoteScript = @"
set -euo pipefail
CONFIG_PATH="$ConfigPath"
UTA_HOSTNAME="$UtaHostname"

echo "== cloudflared config =="
sudo cat "`$CONFIG_PATH"

echo
echo "== ingress validate =="
cloudflared tunnel ingress validate --config "`$CONFIG_PATH"

echo
echo "== ingress rule for UTA =="
cloudflared tunnel ingress rule --config "`$CONFIG_PATH" "https://`$UTA_HOSTNAME/api/health"

echo
echo "== local service health =="
curl -i --max-time 10 http://127.0.0.1:3000/api/health

echo
echo "== local UTA shell =="
curl -I --max-time 10 http://127.0.0.1:3000/uta

echo
echo "== tunnel dns route =="
cloudflared tunnel route ip show 2>/dev/null || true
cloudflared tunnel route dns show 2>/dev/null || true

echo
echo "== cloudflared recent logs =="
sudo journalctl -u cloudflared -n 80 --no-pager -l
"@

$localTemp = Join-Path ([System.IO.Path]::GetTempPath()) "uta-cloudflare-diagnose-$([System.Guid]::NewGuid().ToString('N')).sh"
$remoteTemp = "/tmp/uta-cloudflare-diagnose-$([System.Guid]::NewGuid().ToString('N')).sh"
try {
  [System.IO.File]::WriteAllText($localTemp, $remoteScript, [System.Text.UTF8Encoding]::new($false))
  scp $localTemp "$User@$HostName`:$remoteTemp"
  ssh -tt "$User@$HostName" "chmod +x '$remoteTemp' && bash '$remoteTemp'; status=`$?; rm -f '$remoteTemp'; exit `$status"
} finally {
  Remove-Item -LiteralPath $localTemp -ErrorAction SilentlyContinue
}
