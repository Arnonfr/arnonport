const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const url = require('url');
const Store = require('electron-store');

const store = new Store({
  name: 'winamp-spotify-config',
  defaults: {
    clientId: '',
    refreshToken: '',
    windowBounds: { width: 775, height: 116 },
    alwaysOnTop: false
  }
});

const SPOTIFY_SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read'
].join(' ');

let mainWindow;
let authServer;

function createWindow() {
  const bounds = store.get('windowBounds');
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 275,
    minHeight: 116,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: store.get('alwaysOnTop'),
    backgroundColor: '#00000000',
    title: 'Winamp Spotify',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('resize', () => {
    const { width, height } = mainWindow.getBounds();
    store.set('windowBounds', { width, height });
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  Menu.setApplicationMenu(null);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (authServer) authServer.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------- Window controls ----------
ipcMain.on('win:minimize', () => mainWindow.minimize());
ipcMain.on('win:close', () => mainWindow.close());
ipcMain.on('win:toggle-on-top', () => {
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  store.set('alwaysOnTop', next);
});

// ---------- Config ----------
ipcMain.handle('config:get', (_e, key) => store.get(key));
ipcMain.handle('config:set', (_e, key, value) => store.set(key, value));

// ---------- PKCE helpers ----------
function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function genVerifier() {
  return base64url(crypto.randomBytes(64));
}
function genChallenge(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

// ---------- Spotify auth (PKCE, loopback) ----------
ipcMain.handle('spotify:login', async (_e, clientId) => {
  if (!clientId) throw new Error('Missing Client ID');
  store.set('clientId', clientId);

  return new Promise((resolve, reject) => {
    const verifier = genVerifier();
    const challenge = genChallenge(verifier);
    const state = base64url(crypto.randomBytes(16));

    if (authServer) { try { authServer.close(); } catch (_) {} }

    authServer = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url, true);
      if (!parsed.pathname.startsWith('/callback')) {
        res.writeHead(404); res.end(); return;
      }
      const { code, state: retState, error } = parsed.query;
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h2>Login failed: ${error}</h2>`);
        authServer.close();
        reject(new Error(error));
        return;
      }
      if (retState !== state) {
        res.writeHead(400); res.end('State mismatch'); return;
      }
      try {
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: 'http://127.0.0.1:8888/callback',
            client_id: clientId,
            code_verifier: verifier
          })
        });
        const data = await tokenRes.json();
        if (data.error) throw new Error(data.error_description || data.error);
        store.set('refreshToken', data.refresh_token);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;background:#0a0a0a;color:#0f0;text-align:center;padding:40px">
          <h1>&#9835; Connected to Spotify &#9835;</h1>
          <p>You can close this tab and return to Winamp.</p>
          <script>setTimeout(()=>window.close(),1500)</script>
        </body></html>`);
        authServer.close();
        resolve({
          accessToken: data.access_token,
          expiresIn: data.expires_in,
          refreshToken: data.refresh_token
        });
      } catch (err) {
        res.writeHead(500); res.end('Token exchange failed');
        authServer.close();
        reject(err);
      }
    });

    authServer.listen(8888, '127.0.0.1', () => {
      const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: 'http://127.0.0.1:8888/callback',
        code_challenge_method: 'S256',
        code_challenge: challenge,
        state,
        scope: SPOTIFY_SCOPES
      }).toString();
      shell.openExternal(authUrl);
    });

    authServer.on('error', reject);
  });
});

ipcMain.handle('spotify:refresh', async () => {
  const refreshToken = store.get('refreshToken');
  const clientId = store.get('clientId');
  if (!refreshToken || !clientId) throw new Error('Not authenticated');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  if (data.refresh_token) store.set('refreshToken', data.refresh_token);
  return { accessToken: data.access_token, expiresIn: data.expires_in };
});

ipcMain.handle('spotify:logout', () => {
  store.set('refreshToken', '');
  return true;
});

ipcMain.on('app:open-external', (_e, link) => shell.openExternal(link));
