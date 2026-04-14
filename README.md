# Winamp Spotify

A classic-Winamp–styled desktop music player that streams through your Spotify account.
Built with Electron.

![Winamp Spotify](https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6)

## Features

- Frameless, classic-Winamp look (green LCD, draggable title bar, tiny transport buttons)
- Connects to Spotify via OAuth 2.0 PKCE (no server needed, no client secret stored)
- Play / pause / stop / next / previous / shuffle / repeat
- Volume + seek sliders
- Marquee track title, running clock, fake VU-meter visualizer
- "Always on top" toggle, minimize, close
- Remembers window size & login (refresh token stored locally via `electron-store`)

> Note: Playback itself happens on the Spotify device (desktop app, phone, web player).
> This app controls that device through Spotify's Web API. A Spotify Premium account is
> required to control playback.

## Install & Run (dev)

```bash
npm install
npm start
```

## Build installers

```bash
npm run build          # current OS
npm run build:win      # Windows (.exe / NSIS installer + portable)
npm run build:mac      # macOS (.dmg)
npm run build:linux    # Linux (AppImage + .deb)
```

Installers are written to `dist/`.

## First-time setup (Spotify Client ID)

Spotify requires every app to have its own Client ID. It's free and takes ~30 seconds:

1. Go to <https://developer.spotify.com/dashboard> and log in.
2. Click **Create app**. Any name/description works.
3. In **Redirect URIs** add: `http://127.0.0.1:8888/callback`
4. Save, open the app, and copy the **Client ID**.
5. Launch Winamp Spotify → gear icon → paste the Client ID → **LOGIN**.
6. Approve in the browser. Done — the refresh token is saved, so next launch is silent.

## How playback works

The Spotify Web API controls a **device** (a running Spotify instance). So:

- Open Spotify on phone / desktop / web and play any track once (this registers a device).
- Winamp Spotify will then control that device: play/pause/seek/volume/next/prev.

## Tech

- Electron (main + preload + renderer, contextIsolation on)
- PKCE OAuth via a local loopback HTTP server on port 8888
- `electron-store` for Client ID + refresh token
- No server, no client secret, no third-party backend

## License

MIT
