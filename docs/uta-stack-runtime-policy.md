# UTA Stack And Runtime Policy

The Unusual Trading Activity Agent uses the existing Node-first application.

## V1 Stack

| Layer | Technology | Policy |
|---|---|---|
| Backend/API | Node.js 24 ESM | Use the existing `src/server.js` and `src/http/router.js` path. |
| Live updates | Server-Sent Events | Reuse `/api/stream` and add UTA event types. |
| Frontend | React/Vite target | The canonical production target is a compiled frontend under `/uta`. |
| Durable UTA data | SQLite WAL on SSD/NVMe | Store baselines, observations, signal results, cycle history, and user state. |
| Hot runtime recovery | Lightweight JSON | May remain enabled for compact Pi runtime recovery and must not replace durable UTA history. |
| Deployment | Raspberry Pi 5 + systemd + Cloudflare Tunnel | Bind Node locally and expose through Cloudflare. |

## Deferred Technology

FastAPI, Streamlit, and Python workers are out of scope for v1. A Python worker can be reconsidered only if a later ticket proves a Python-only analytics dependency is required.

## Pi Storage Rule

Production UTA history must not be written to the Pi SD card. Use an SSD/NVMe data path for SQLite WAL files and backups.
