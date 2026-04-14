// Renderer: UI wiring + Spotify Web API playback control

const $ = (id) => document.getElementById(id);

const state = {
  accessToken: null,
  tokenExpiresAt: 0,
  currentTrackId: null,
  isPlaying: false,
  durationMs: 0,
  progressMs: 0,
  volume: 70,
  shuffle: false,
  repeat: 'off' // off | context | track
};

// ---------- Window chrome ----------
$('btn-min').onclick = () => window.api.minimize();
$('btn-close').onclick = () => window.api.close();
$('btn-ontop').onclick = () => window.api.toggleOnTop();

// ---------- Settings overlay ----------
$('btn-settings').onclick = () => $('setup').classList.remove('hidden');
$('btn-close-setup').onclick = () => $('setup').classList.add('hidden');
$('link-dashboard').onclick = (e) => {
  e.preventDefault();
  window.api.openExternal('https://developer.spotify.com/dashboard');
};

$('btn-login').onclick = async () => {
  const clientId = $('client-id').value.trim();
  if (!clientId) { setMarquee('*** Enter a Spotify Client ID first ***'); return; }
  try {
    setMarquee('*** Opening Spotify login in your browser... ***');
    const tok = await window.api.spotifyLogin(clientId);
    state.accessToken = tok.accessToken;
    state.tokenExpiresAt = Date.now() + (tok.expiresIn - 60) * 1000;
    $('setup').classList.add('hidden');
    setMarquee('*** Connected to Spotify. Play anything! ***');
    startPolling();
  } catch (err) {
    setMarquee('*** Login failed: ' + err.message + ' ***');
  }
};

$('btn-logout').onclick = async () => {
  await window.api.spotifyLogout();
  state.accessToken = null;
  setMarquee('*** Logged out ***');
};

// ---------- Spotify API helpers ----------
async function getToken() {
  if (state.accessToken && Date.now() < state.tokenExpiresAt) return state.accessToken;
  try {
    const tok = await window.api.spotifyRefresh();
    state.accessToken = tok.accessToken;
    state.tokenExpiresAt = Date.now() + (tok.expiresIn - 60) * 1000;
    return state.accessToken;
  } catch (_) {
    return null;
  }
}

async function spotify(method, path, body) {
  const token = await getToken();
  if (!token) return { ok: false, status: 401, error: 'not_authenticated' };
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + token }
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('https://api.spotify.com/v1' + path, opts);
  if (res.status === 204) return { ok: true };
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) return { ok: false, status: res.status, error: data.error };
  return { ok: true, data };
}

// ---------- Transport ----------
$('btn-play').onclick = async () => {
  const r = await spotify('PUT', '/me/player/play');
  if (!r.ok) handleError(r, 'play');
};
$('btn-pause').onclick = async () => {
  const r = await spotify('PUT', '/me/player/pause');
  if (!r.ok) handleError(r, 'pause');
};
$('btn-stop').onclick = async () => {
  await spotify('PUT', '/me/player/pause');
  await spotify('PUT', '/me/player/seek?position_ms=0');
};
$('btn-next').onclick = async () => { await spotify('POST', '/me/player/next'); };
$('btn-prev').onclick = async () => { await spotify('POST', '/me/player/previous'); };

$('btn-shuffle').onclick = async () => {
  state.shuffle = !state.shuffle;
  await spotify('PUT', `/me/player/shuffle?state=${state.shuffle}`);
  $('btn-shuffle').style.color = state.shuffle ? '#fff' : '#00ff66';
};
$('btn-repeat').onclick = async () => {
  const order = { off: 'context', context: 'track', track: 'off' };
  state.repeat = order[state.repeat];
  await spotify('PUT', `/me/player/repeat?state=${state.repeat}`);
  $('btn-repeat').style.color = state.repeat === 'off' ? '#00ff66' : '#fff';
};

// ---------- Volume / position ----------
let volumeTimer;
$('volume').oninput = (e) => {
  state.volume = +e.target.value;
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(async () => {
    await spotify('PUT', `/me/player/volume?volume_percent=${state.volume}`);
  }, 150);
};

let seeking = false;
$('position').onpointerdown = () => { seeking = true; };
$('position').onpointerup = async (e) => {
  seeking = false;
  if (!state.durationMs) return;
  const pct = +e.target.value / 1000;
  const pos = Math.floor(pct * state.durationMs);
  await spotify('PUT', `/me/player/seek?position_ms=${pos}`);
};

// ---------- Polling current playback ----------
let pollHandle;
function startPolling() {
  if (pollHandle) return;
  const tick = async () => {
    await refreshPlayback();
    pollHandle = setTimeout(tick, 1500);
  };
  tick();
}

async function refreshPlayback() {
  const r = await spotify('GET', '/me/player');
  if (!r.ok) {
    if (r.status === 401) setMarquee('*** Session expired. Please LOGIN again. ***');
    return;
  }
  const p = r.data;
  if (!p || !p.item) {
    setTime(0);
    return;
  }
  state.isPlaying = p.is_playing;
  state.durationMs = p.item.duration_ms;
  state.progressMs = p.progress_ms || 0;
  setTime(state.progressMs);

  if (!seeking) {
    $('position').value = Math.floor((state.progressMs / state.durationMs) * 1000);
  }
  if (typeof p.device?.volume_percent === 'number' && !volumeTimer) {
    $('volume').value = p.device.volume_percent;
  }

  if (p.item.id !== state.currentTrackId) {
    state.currentTrackId = p.item.id;
    const artists = (p.item.artists || []).map(a => a.name).join(', ');
    setMarquee(`  ${artists} - ${p.item.name}   [${fmtMs(p.item.duration_ms)}]   `);
    // Fake bitrate/khz (Spotify doesn't expose this via API)
    $('bitrate').textContent = '320';
    $('khz').textContent = '44';
  }
}

function handleError(r, op) {
  if (r.status === 404 || (r.error && r.error.reason === 'NO_ACTIVE_DEVICE')) {
    setMarquee('*** No active Spotify device. Open Spotify on phone/desktop/web and play once. ***');
  } else if (r.status === 403) {
    setMarquee('*** Spotify Premium required for ' + op + ' ***');
  } else if (r.status === 401) {
    setMarquee('*** Please LOGIN ***');
  } else {
    setMarquee('*** Error: ' + (r.error?.message || r.status) + ' ***');
  }
}

// ---------- UI utils ----------
function setMarquee(text) { $('marquee').textContent = text; }
function setTime(ms) { $('time').textContent = fmtMs(ms); }
function fmtMs(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// ---------- Visualizer (fake, animated) ----------
const canvas = $('viz');
const ctx = canvas.getContext('2d');
const bars = 18;
const barState = new Array(bars).fill(0);
function drawViz() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const bw = canvas.width / bars;
  for (let i = 0; i < bars; i++) {
    const target = state.isPlaying ? Math.random() * canvas.height : 0;
    barState[i] = barState[i] * 0.6 + target * 0.4;
    const h = Math.max(1, barState[i]);
    const grad = ctx.createLinearGradient(0, canvas.height - h, 0, canvas.height);
    grad.addColorStop(0, '#00ff66');
    grad.addColorStop(1, '#003311');
    ctx.fillStyle = grad;
    ctx.fillRect(i * bw + 1, canvas.height - h, bw - 2, h);
  }
  requestAnimationFrame(drawViz);
}
drawViz();

// ---------- Boot ----------
(async function init() {
  const clientId = await window.api.getConfig('clientId');
  if (clientId) $('client-id').value = clientId;

  try {
    const tok = await window.api.spotifyRefresh();
    state.accessToken = tok.accessToken;
    state.tokenExpiresAt = Date.now() + (tok.expiresIn - 60) * 1000;
    setMarquee('*** Ready. Play something on Spotify to begin. ***');
    startPolling();
  } catch (_) {
    $('setup').classList.remove('hidden');
  }
})();
