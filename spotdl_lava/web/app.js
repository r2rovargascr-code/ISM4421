'use strict';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ backend
 * In the desktop window, Python is reached through pywebview's js_api.
 * In --browser mode, through the small HTTP API in server.py.
 */
const backend = {
  async connect() {
    if (!(window.pywebview && window.pywebview.api)) {
      await new Promise((resolve) => {
        window.addEventListener('pywebviewready', resolve, { once: true });
        setTimeout(resolve, 1500);
      });
    }
    const api = window.pywebview && window.pywebview.api;
    if (api) {
      Object.assign(this, {
        state: () => api.state(),
        add: (link) => api.add(link),
        refreshLocation: () => api.refresh_location(),
        minimize: () => api.minimize(),
        close: () => api.close(),
      });
    } else {
      document.body.classList.add('browser');
      const post = (path, body) => fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
      }).then((r) => r.json());
      Object.assign(this, {
        state: () => fetch('/api/state', { cache: 'no-store' }).then((r) => r.json()),
        add: (link) => post('/api/add', { link }),
        refreshLocation: () => post('/api/location'),
        minimize: () => {},
        close: () => {},
      });
    }
  },
};

/* ------------------------------------------------------------------ helpers */

function clock(seconds) {
  if (seconds == null) return '--:--';
  seconds = Math.max(0, Math.round(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/* ------------------------------------------------------------------ bubbles
 * Each bubble can be dragged around the tank. While it moves, its "skin" is
 * stretched along the direction of travel by a springy deformation, and its
 * outline wobbles faster, so it moves like a lump of lava. On release the
 * spring overshoots a few times before settling.
 */
const tank = $('#tank');
const bubbles = [];

function makeBubble(node, key, home) {
  const skin = node.querySelector('.skin');
  const saved = storageGet(key);
  const b = {
    node, skin, key,
    fx: saved ? saved.fx : home[0], fy: saved ? saved.fy : home[1], // centre, as a fraction of the tank
    x: 0, y: 0,
    vx: 0, vy: 0,                 // drag velocity, px/s
    dx: 0, dy: 0, dvx: 0, dvy: 0, // deformation vector and its rate
    energy: 0,
    phases: Array.from({ length: 4 }, () => Math.random() * Math.PI * 2),
    rates: Array.from({ length: 4 }, () => 0.6 + Math.random() * 0.8),
    dragging: false, moved: 0, grab: [0, 0], last: null,
    onTap: null,
  };

  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    node.setPointerCapture(e.pointerId);
    const r = tank.getBoundingClientRect();
    b.dragging = true;
    b.moved = 0;
    b.grab = [e.clientX - r.left - b.x, e.clientY - r.top - b.y];
    b.last = { x: e.clientX, y: e.clientY, t: performance.now() };
    node.classList.add('dragging');
  });
  node.addEventListener('pointermove', (e) => {
    if (!b.dragging) return;
    const r = tank.getBoundingClientRect();
    const now = performance.now();
    const dt = Math.max(now - b.last.t, 1) / 1000;
    const ix = (e.clientX - b.last.x) / dt;
    const iy = (e.clientY - b.last.y) / dt;
    b.vx = b.vx * 0.6 + ix * 0.4;
    b.vy = b.vy * 0.6 + iy * 0.4;
    b.moved += Math.hypot(e.clientX - b.last.x, e.clientY - b.last.y);
    b.last = { x: e.clientX, y: e.clientY, t: now };
    place(b, e.clientX - r.left - b.grab[0], e.clientY - r.top - b.grab[1]);
  });
  const release = () => {
    if (!b.dragging) return;
    b.dragging = false;
    node.classList.remove('dragging');
    // hand the current speed to the spring so it jiggles after letting go
    b.dvx += b.vx * 0.0012;
    b.dvy += b.vy * 0.0012;
    b.vx = b.vy = 0;
    storageSet(b.key, { fx: b.fx, fy: b.fy });
    if (b.moved < 4 && b.onTap) b.onTap();
  };
  node.addEventListener('pointerup', release);
  node.addEventListener('pointercancel', release);

  bubbles.push(b);
  return b;
}

function place(b, x, y) {
  const W = tank.clientWidth, H = tank.clientHeight;
  const hw = b.node.offsetWidth / 2, hh = b.node.offsetHeight / 2;
  b.x = Math.min(Math.max(x, hw + 6), W - hw - 6);
  b.y = Math.min(Math.max(y, hh + 6), H - hh - 6);
  b.fx = b.x / W;
  b.fy = b.y / H;
}

function layoutBubbles() {
  for (const b of bubbles) place(b, b.fx * tank.clientWidth, b.fy * tank.clientHeight);
}

let lastFrame = performance.now();
function animate(now) {
  const dt = Math.min(now - lastFrame, 50) / 1000;
  lastFrame = now;
  for (const b of bubbles) {
    if (b.dragging) {          // velocity fades when the pointer stops moving
      b.vx *= Math.pow(0.02, dt);
      b.vy *= Math.pow(0.02, dt);
    }
    // spring: deformation chases a target set by the drag speed
    const K = 0.00055, STIFF = 170, DAMP = 7;
    const tx = b.dragging ? b.vx * K : 0;
    const ty = b.dragging ? b.vy * K : 0;
    b.dvx += (STIFF * (tx - b.dx) - DAMP * b.dvx) * dt;
    b.dvy += (STIFF * (ty - b.dy) - DAMP * b.dvy) * dt;
    b.dx += b.dvx * dt;
    b.dy += b.dvy * dt;

    const mag = Math.min(Math.hypot(b.dx, b.dy), 0.32);
    const ang = Math.atan2(b.dy, b.dx);
    const speed = Math.hypot(b.vx, b.vy);
    const target = Math.min(1, speed / 700 + Math.hypot(b.dvx, b.dvy) * 0.6);
    b.energy += (target - b.energy) * Math.min(1, dt * 4);

    // wobbling outline; wobbles harder and faster while moving
    const amp = 5 + b.energy * 13;
    const r = b.phases.map((p, i) => {
      b.phases[i] = p + dt * b.rates[i] * (0.5 + b.energy * 7);
      return 50 + amp * Math.sin(b.phases[i]);
    });
    b.skin.style.borderRadius =
      `${r[0]}% ${100 - r[0]}% ${r[1]}% ${100 - r[1]}% / ${r[2]}% ${r[3]}% ${100 - r[3]}% ${100 - r[2]}%`;
    b.skin.style.transform =
      `rotate(${ang}rad) scale(${1 + mag}, ${1 - mag * 0.6}) rotate(${-ang}rad)`;
    b.node.style.transform =
      `translate(${b.x - b.node.offsetWidth / 2}px, ${b.y - b.node.offsetHeight / 2}px)`;
  }
  requestAnimationFrame(animate);
}

const flagBubble = makeBubble($('#flag-bubble'), 'bubble-flag', [0.1, 0.2]);
const etaBubble = makeBubble($('#eta-bubble'), 'bubble-eta', [0.5, 0.5]);
flagBubble.onTap = () => backend.refreshLocation && backend.refreshLocation();
window.addEventListener('resize', layoutBubbles);

/* ------------------------------------------------------------------ rendering */

const RING = 2 * Math.PI * 66;
for (const c of [$('#ring-bar'), $('#ring-glow')]) c.style.strokeDasharray = RING;

let shownFlag = null;
function renderLocation(loc) {
  const node = $('#flag-bubble');
  node.classList.toggle('checking', loc.status === 'checking');
  if (loc.status === 'ok') {
    node.title = `${loc.country} · ${loc.ip}  (click to re-check)`;
    if (shownFlag !== loc.code) {
      shownFlag = loc.code;
      const flag = $('#flag');
      const img = new Image();
      img.alt = loc.country;
      img.onerror = () => flag.replaceChildren(el('span', 'code', loc.code));
      img.src = `https://flagcdn.com/w160/${loc.code.toLowerCase()}.png`;
      flag.replaceChildren(img);
    }
  } else if (loc.status === 'error') {
    node.title = 'Could not determine your location (click to retry)';
    shownFlag = null;
    $('#flag').replaceChildren(el('span', 'code', '?'));
  }
}

const STATUS_LABEL = { queued: 'Queued', done: 'Done', skipped: 'Exists', error: 'Failed' };
const rows = new Map();
let activeId = null;

function makeRow(item) {
  const li = el('li', 'row');
  const thumb = el('span', 'thumb');
  if (item.cover) {
    const img = new Image();
    img.loading = 'lazy';
    img.alt = '';
    img.src = item.cover;
    thumb.append(img);
  }
  const text = el('div');
  text.append(el('div', 't', item.title), el('div', 'a', item.artist));
  li.append(el('span', 'n'), thumb, text, el('span', 'd', item.duration ? clock(item.duration).replace(/^0/, '') : ''), el('span', 's'));
  li.title = `${item.title} — ${item.artist}`;
  return li;
}

function renderQueue(items) {
  const queue = $('#queue');
  const seen = new Set();
  items.forEach((item, i) => {
    let li = rows.get(item.id);
    if (!li) {
      li = makeRow(item);
      rows.set(item.id, li);
      queue.append(li);
    }
    seen.add(item.id);
    li.className = `row ${item.status}`;
    li.querySelector('.n').textContent = i + 1;
    li.querySelector('.s').textContent =
      item.status === 'downloading' ? `${Math.floor(item.progress)}%` : STATUS_LABEL[item.status] || '';
    li.style.setProperty('--p', `${item.progress}%`);
    if (item.error) li.title = `${item.title} — ${item.artist}\n${item.error}`;
  });
  for (const [id, li] of rows) {
    if (!seen.has(id)) { li.remove(); rows.delete(id); }
  }
  // keep the song currently downloading in view
  const active = items.find((it) => it.status === 'downloading');
  if (active && active.id !== activeId) {
    const li = rows.get(active.id);
    queue.scrollTo({ top: li.offsetTop - queue.offsetTop - queue.clientHeight / 2 + li.clientHeight / 2, behavior: 'smooth' });
  }
  activeId = active ? active.id : null;
}

function render(state) {
  renderLocation(state.location || {});
  $('#ring-bar').style.strokeDashoffset = RING * (1 - state.overall);
  $('#ring-glow').style.strokeDashoffset = RING * (1 - state.overall);
  $('#eta').textContent = clock(state.eta);
  const total = state.items.length;
  $('#counts').textContent = total ? `${total} song${total === 1 ? '' : 's'} · ${state.finished} done` : 'No songs yet';
  const msg = $('#message');
  msg.textContent = state.message || '';
  msg.classList.toggle('error', /^(Couldn't|Could not|No songs)/.test(state.message || ''));
  $('#add-btn').disabled = state.busy;
  $('#add-btn').textContent = state.busy ? 'Adding…' : 'Add';
  renderQueue(state.items);
}

async function poll() {
  try {
    render(await backend.state());
  } catch (err) {
    console.error(err);
  }
  setTimeout(poll, 400);
}

/* ------------------------------------------------------------------ wiring */

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#link');
  const res = await backend.add(input.value);
  if (res && res.ok) input.value = '';
  else if (res && res.message) $('#message').textContent = res.message;
});
$('#btn-close').addEventListener('click', () => backend.close());
$('#btn-min').addEventListener('click', () => backend.minimize());

layoutBubbles();
requestAnimationFrame(animate);
backend.connect().then(poll);
