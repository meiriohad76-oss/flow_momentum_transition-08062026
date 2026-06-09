param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [string]$User = "ahad",
  [string]$UtaHostname = "uta.ahaddashboards.uk",
  [string]$ConfigPath = "/etc/cloudflared/config.yml",
  [string]$ServiceUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"

$remoteScript = @"
set -euo pipefail
CONFIG_PATH="$ConfigPath"
UTA_HOSTNAME="$UtaHostname"
SERVICE_URL="$ServiceUrl"

if [ ! -f "`$CONFIG_PATH" ]; then
  echo "Cloudflared config not found: `$CONFIG_PATH" >&2
  exit 1
fi

echo "Normalizing Cloudflare route `$UTA_HOSTNAME -> `$SERVICE_URL"
sudo cp "`$CONFIG_PATH" "`$CONFIG_PATH.bak-`$(date +%Y%m%d-%H%M%S)"
sudo python3 - "`$CONFIG_PATH" "`$UTA_HOSTNAME" "`$SERVICE_URL" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
hostname = sys.argv[2]
service = sys.argv[3]
lines = path.read_text().splitlines()
marker = "  - service: http_status:404"
entry = f"  - hostname: {hostname}\n    service: {service}\n\n"

cleaned = []
i = 0
while i < len(lines):
    line = lines[i]
    if line.strip() == f"- hostname: {hostname}":
        i += 1
        while i < len(lines) and (lines[i].startswith("    ") or not lines[i].strip()):
            i += 1
        continue
    cleaned.append(line)
    i += 1

text = "\n".join(cleaned) + "\n"
if marker not in text:
    raise SystemExit("fallback http_status route not found")
path.write_text(text.replace(marker, entry + marker))
PY

sudo systemctl restart cloudflared
sudo systemctl status cloudflared --no-pager
echo "Route ready: https://`$UTA_HOSTNAME"
"@

$localTemp = Join-Path ([System.IO.Path]::GetTempPath()) "uta-cloudflare-route-$([System.Guid]::NewGuid().ToString('N')).sh"
$remoteTemp = "/tmp/uta-cloudflare-route-$([System.Guid]::NewGuid().ToString('N')).sh"
try {
  [System.IO.File]::WriteAllText($localTemp, $remoteScript, [System.Text.UTF8Encoding]::new($false))
  scp $localTemp "$User@$HostName`:$remoteTemp"
  ssh -tt "$User@$HostName" "chmod +x '$remoteTemp' && bash '$remoteTemp'; status=`$?; rm -f '$remoteTemp'; exit `$status"
} finally {
  Remove-Item -LiteralPath $localTemp -ErrorAction SilentlyContinue
}
