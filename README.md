# MatterCameras

Bridge RTSP/ONVIF cameras into **Matter 1.5 Camera** devices for SmartThings (Aeotec Hub v2) and other Matter controllers.

## Architecture

```
RTSP/ONVIF → go2rtc (WebRTC) → Matter Bridge (matter.js 0.17) → SmartThings Hub
```

- **Matter bridge**: exposes bridged `Camera` endpoints (type `0x0142`) with AV Stream + WebRTC clusters
- **go2rtc**: ingests RTSP and answers WebRTC SDP offers
- **Web UI**: add/remove cameras, Matter pairing QR

## Quick start (server 192.168.1.50)

```bash
npm install
npm start
```

Web UI: `http://192.168.1.50:3202`

### Configuration

Edit `data/config.json`:

```json
{
  "matterHost": "192.168.1.50",
  "matterPort": 5550,
  "webPort": 3202,
  "go2rtcUrl": "http://127.0.0.1:3203"
}
```

Override via env: `MATTER_HOST`, `MATTER_PORT`, `GO2RTC_URL`, etc.

### Docker no servidor (192.168.1.50)

Isolado em containers; usa `network_mode: host` só para Matter/mDNS funcionar.

**Portas no host** (confira se não conflitam com outras apps):

| Porta | Serviço |
|-------|---------|
| 3202 | Web UI |
| 3203 | go2rtc API |
| 5550 | Matter |
| 8554 | RTSP relay |
| 8555 | WebRTC |
| 5353 | mDNS (UDP) |

```bash
# Deploy do Mac para o servidor
npm run deploy

# Ou manualmente no servidor
docker compose up --build -d
docker compose logs -f app
```

Dados persistentes em `./data` (câmeras, Matter fabric, go2rtc config).

## Pairing with SmartThings

1. Ensure Aeotec Hub v2 firmware supports Matter 1.5 cameras
2. Open Web UI → scan Matter QR or use manual code
3. Add cameras in the UI with RTSP URL
4. Cameras appear as bridged Matter cameras on the hub

## Development on Mac

Set `matterHost` to your Mac LAN IP or `0.0.0.0` for local testing. Production target remains `192.168.1.50`.

## Status (MVP)

- [x] Matter 1.5 Camera device type (bridged)
- [x] Camera AV Stream Management (1x H.264 LiveView)
- [x] WebRTC signaling via go2rtc
- [ ] ICE trickle / remote viewing
- [ ] ONVIF auto-discovery
- [ ] Snapshot / motion events

## Repository

https://github.com/patricktd/MatterCameras
