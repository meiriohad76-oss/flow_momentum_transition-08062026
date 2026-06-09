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

if [ ! -f "`$CONFIG_PATH" ]; then
  echo "Cloudflared config not found: `$CONFIG_PATH" >&2
  exit 1
fi

TUNNEL_ID="`$(awk '/^tunnel:/ { print `$2; exit }' "`$CONFIG_PATH")"
if [ -z "`$TUNNEL_ID" ]; then
  echo "Could not read tunnel id from `$CONFIG_PATH" >&2
  exit 1
fi

echo "Creating Cloudflare DNS route `$UTA_HOSTNAME for tunnel `$TUNNEL_ID"
cloudflared tunnel route dns "`$TUNNEL_ID" "`$UTA_HOSTNAME"
echo "DNS route requested: https://`$UTA_HOSTNAME"
"@

$localTemp = Join-Path ([System.IO.Path]::GetTempPath()) "uta-cloudflare-dns-$([System.Guid]::NewGuid().ToString('N')).sh"
$remoteTemp = "/tmp/uta-cloudflare-dns-$([System.Guid]::NewGuid().ToString('N')).sh"
try {
  [System.IO.File]::WriteAllText($localTemp, $remoteScript, [System.Text.UTF8Encoding]::new($false))
  scp $localTemp "$User@$HostName`:$remoteTemp"
  ssh -tt "$User@$HostName" "chmod +x '$remoteTemp' && bash '$remoteTemp'; status=`$?; rm -f '$remoteTemp'; exit `$status"
} finally {
  Remove-Item -LiteralPath $localTemp -ErrorAction SilentlyContinue
}
