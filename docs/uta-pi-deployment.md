# UTA Raspberry Pi Deployment

This is the UTA-specific deployment checklist for Raspberry Pi 5, 8 GB memory.

## Runtime Shape

- Node.js 24 runs the existing server.
- React/Vite UTA assets are built into `src/public/uta`.
- SQLite WAL storage must live on SSD/NVMe, not the SD card.
- Cloudflare Tunnel forwards the public hostname to `http://127.0.0.1:3000`.
- Heavy UTA jobs stay manual or dry-run until live providers and validation gates are accepted.

## Files

- `deploy/flow-momentum-uta.service`
- `deploy/cloudflared-uta-example.yml`
- `docs/raspberry-pi-cloudflare.md`

## Pi Preflight

Run locally before copying to the Pi:

```powershell
npm run build:uta
npm run check:uta-pi-profile
npm run check:uta-historical-replay
npm run check:uta-calibration
npm run check:uta-trading-integration
npm run check:uta-deploy-smoke -- --base-url http://127.0.0.1:3000
```

Run on the Pi after deploy:

```bash
node --version
npm ci --omit=dev
npm run build:uta
npm run check:uta-pi-profile
npm run check:uta-api
npm run check:uta-deploy-smoke -- --base-url http://127.0.0.1:3000
```

## Service Install Sketch

```bash
sudo cp deploy/flow-momentum-uta.service /etc/systemd/system/flow-momentum-uta.service
sudo systemctl daemon-reload
sudo systemctl enable flow-momentum-uta
sudo systemctl restart flow-momentum-uta
sudo systemctl status flow-momentum-uta --no-pager
```

Before starting the service, update:

- `User`
- `Group`
- `WorkingDirectory`
- `DATABASE_PATH`
- Cloudflare hostname

Provider secrets can be kept outside git in `/etc/flow-momentum-uta.env`:

```text
MASSIVE_API_KEY=...
UTA_PRIMARY_PROVIDER=massive
TRADE_PRINTS_PROVIDER=massive
MARKET_DATA_PROVIDER=massive
```

## Cloudflare Smoke

After the tunnel is configured:

```bash
curl -fsS https://uta.example.com/api/uta/runtime
curl -fsS https://uta.example.com/uta
```

Also verify `/api/uta/stream` stays connected through the tunnel.

The reusable smoke command can target the Cloudflare hostname:

```bash
npm run check:uta-deploy-smoke -- --base-url https://uta.example.com
```

## PowerShell Helper

From Windows, after updating `HostName`, this helper pulls the latest `main` branch on the Pi, builds UTA, runs validation gates, restarts systemd, and runs the deployment smoke:

```powershell
$PiHost = "10.100.102.18"
.\scripts\deploy-uta-pi.ps1 -HostName $PiHost -User ahad -BaseUrl http://127.0.0.1:3000 -InstallNode24
```

Replace `10.100.102.18` with the real Pi hostname or IP before running it. Do not include angle brackets around the hostname.

The helper creates and owns the database directory specified by `-DatabaseDir`, which defaults to `/mnt/uta-ssd`.
For production, mount SSD/NVMe storage at that path before deployment. For a temporary service smoke only, you may add:

```powershell
-AllowUnMountedDatabaseDir
```

Do not treat an unmounted `/mnt/uta-ssd` directory as production storage.

## Trading Guard

UTA remains supporting evidence only. Do not enable paper-trading effects until:

- historical replay report is accepted
- calibration audit is accepted
- Pi deployment smoke passes
- risk and execution checks prove UTA cannot bypass guards
