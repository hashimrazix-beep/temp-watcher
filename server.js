'use strict';
// TempWatch — local laptop monitor. Zero dependencies: Node for CPU/RAM and the
// web dashboard, a small PowerShell helper for thermal zones, battery, disks,
// network and per-app usage, and Windows toast notifications for alerts.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 4517;
const HOST = '127.0.0.1';
const URL_BASE = `http://${HOST}:${PORT}`;
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const ALERTS_FILE = path.join(DATA, 'alerts.json');
const OPEN = process.argv.includes('--open');

// ---------------------------------------------------------------- settings
const CARD_IDS = ['temp', 'cpu', 'ram', 'tempChart', 'usageChart', 'cores', 'zones', 'system', 'procs', 'alerts'];
const DEFAULTS = {
  intervalMs: 2000,
  retentionMin: 60,
  unit: 'C',
  theme: 'system',
  accent: '#2a78d6',
  density: 'comfortable',
  tempSource: 'max',
  zoneNames: {},
  chartRange: 300,
  procSort: 'cpu',
  chart: { showLimits: true, fill: true },
  alerts: {
    tempWarn: { enabled: true, threshold: 80, sustainSec: 10 },
    tempCrit: { enabled: true, threshold: 90, sustainSec: 5 },
    tempRise: { enabled: false, threshold: 15, sustainSec: 10 },
    cpu: { enabled: false, threshold: 95, sustainSec: 60 },
    ram: { enabled: true, threshold: 90, sustainSec: 30 },
  },
  notify: { toast: true, sound: true, recovery: true, cooldownMin: 5 },
  snoozeUntil: 0,
  layout: { order: CARD_IDS.slice(), hidden: [] },
};
const ENUMS = {
  unit: ['C', 'F'],
  theme: ['system', 'dark', 'light'],
  density: ['comfortable', 'compact'],
  procSort: ['cpu', 'mem'],
};
function limits(p) {
  if (p === 'intervalMs') return [1000, 10000];
  if (p === 'retentionMin') return [10, 1440];
  if (p === 'chartRange') return [0, 86400];
  if (p === 'snoozeUntil') return [0, 1e14];
  if (p === 'notify.cooldownMin') return [1, 120];
  if (p.endsWith('.sustainSec')) return [0, 600];
  if (p === 'alerts.tempWarn.threshold' || p === 'alerts.tempCrit.threshold') return [30, 120];
  if (p === 'alerts.tempRise.threshold') return [3, 50];
  if (p.endsWith('.threshold')) return [10, 100];
  return [-1e15, 1e15];
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Rebuild a settings object from untrusted input, keeping only known keys of the right type.
function sanitize(def, inc, p) {
  if (p === 'zoneNames') {
    const out = {};
    if (isObj(inc)) {
      for (const k of Object.keys(inc).slice(0, 30)) {
        if (typeof inc[k] === 'string' && inc[k].trim()) out[k.slice(0, 60)] = inc[k].trim().slice(0, 40);
      }
    }
    return out;
  }
  if (Array.isArray(def)) {
    if (!Array.isArray(inc)) return def.slice();
    const seen = new Set();
    const out = inc.filter((x) => CARD_IDS.includes(x) && !seen.has(x) && seen.add(x));
    if (p === 'layout.order') for (const id of CARD_IDS) if (!seen.has(id)) out.push(id);
    return out;
  }
  if (isObj(def)) {
    const out = {};
    for (const k of Object.keys(def)) out[k] = sanitize(def[k], isObj(inc) ? inc[k] : undefined, p ? `${p}.${k}` : k);
    return out;
  }
  if (inc === undefined || inc === null || typeof inc !== typeof def) return def;
  if (typeof def === 'number') {
    if (!Number.isFinite(inc)) return def;
    const [lo, hi] = limits(p);
    return Math.min(hi, Math.max(lo, inc));
  }
  if (typeof def === 'string') {
    if (ENUMS[p]) return ENUMS[p].includes(inc) ? inc : def;
    if (p === 'accent') return /^#[0-9a-f]{6}$/i.test(inc) ? inc.toLowerCase() : def;
    return inc.slice(0, 60);
  }
  return inc;
}
function deepAssign(base, patch) {
  const out = isObj(base) ? { ...base } : {};
  for (const k of Object.keys(patch)) {
    if (k === '__proto__' || k === 'constructor') continue;
    out[k] = isObj(patch[k]) && isObj(out[k]) && k !== 'zoneNames' ? deepAssign(out[k], patch[k]) : patch[k];
  }
  return out;
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch (e) { console.error('Could not save', path.basename(file), e.message); }
}

let settings = sanitize(DEFAULTS, readJson(SETTINGS_FILE, {}), '');
let alertLog = Array.isArray(readJson(ALERTS_FILE, [])) ? readJson(ALERTS_FILE, []).slice(0, 200) : [];
let alertSeq = alertLog.reduce((m, a) => Math.max(m, a.id || 0), 0);

// ---------------------------------------------------------------- sensors
let sensor = null;
let ext = null;       // latest reading from sensor.ps1
let extAt = 0;
let shuttingDown = false;
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

function startSensor() {
  stopSensor();
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(ROOT, 'sensor.ps1'), '-IntervalMs', String(settings.intervalMs),
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  sensor = child;
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line[0] !== '{') continue;
      try { ext = JSON.parse(line); extAt = Date.now(); } catch { /* partial line */ }
    }
  });
  child.on('error', () => {});
  child.on('exit', () => {
    if (sensor !== child) return;
    sensor = null;
    if (!shuttingDown) setTimeout(startSensor, 3000);
  });
}
function stopSensor() {
  if (!sensor) return;
  const c = sensor;
  sensor = null;
  try { c.kill(); } catch { /* already gone */ }
}

const cpuTimes = () => os.cpus().map((c) => c.times);
const total = (t) => t.user + t.nice + t.sys + t.idle + t.irq;
let prevTimes = cpuTimes();
const zoneOrder = [];
const history = [];   // rows: [t, cpu, ram, ...zone temps in zoneOrder]
let lastSample = null;
const r1 = (v) => Math.round(v * 10) / 10;

function pickTemp(zones) {
  if (!zones.length) return null;
  const src = settings.tempSource;
  if (src === 'avg') return r1(zones.reduce((s, z) => s + z.c, 0) / zones.length);
  const one = zones.find((z) => z.name === src);
  if (one) return one.c;
  return Math.max(...zones.map((z) => z.c));
}

function tick() {
  const now = Date.now();
  const cur = cpuTimes();
  const cores = cur.map((t, i) => {
    const p = prevTimes[i] || t;
    const all = total(t) - total(p);
    return all > 0 ? r1(Math.min(100, Math.max(0, (1 - (t.idle - p.idle) / all) * 100))) : 0;
  });
  prevTimes = cur;
  const cpu = r1(cores.reduce((s, v) => s + v, 0) / (cores.length || 1));
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  const ram = r1((memUsed / memTotal) * 100);

  const fresh = ext && now - extAt < Math.max(8000, settings.intervalMs * 4);
  const zones = fresh
    ? arr(ext.zones).filter((z) => z && typeof z.c === 'number' && z.c > 0 && z.c < 150).map((z) => ({ name: String(z.name), c: z.c }))
    : [];
  for (const z of zones) if (!zoneOrder.includes(z.name)) zoneOrder.push(z.name);
  const temp = pickTemp(zones);

  const row = [now, cpu, ram];
  for (const name of zoneOrder) {
    const z = zones.find((x) => x.name === name);
    row.push(z ? z.c : null);
  }
  history.push(row);
  const cutoff = now - settings.retentionMin * 60000;
  while (history.length && history[0][0] < cutoff) history.shift();

  const sample = {
    t: now, cpu, ram, temp, zones, cores, memUsed, memTotal,
    battery: fresh ? ext.battery || null : null,
    rx: fresh ? ext.rx || 0 : null,
    tx: fresh ? ext.tx || 0 : null,
    disks: fresh ? arr(ext.disks) : [],
    procs: fresh ? arr(ext.procs) : [],
    uptime: os.uptime(),
    sensorOk: !!fresh,
  };
  evaluateAlerts(sample);
  sample.active = Object.keys(RULES).filter((id) => ruleState[id].active);
  lastSample = sample;
  broadcast('sample', sample);
}

let timer = null;
function startTimer() {
  clearInterval(timer);
  timer = setInterval(tick, settings.intervalMs);
}

// ---------------------------------------------------------------- alerts
const RULES = {
  tempCrit: { level: 'critical', metric: 'temp', hyst: 2, title: 'Critical temperature' },
  tempWarn: { level: 'warning', metric: 'temp', hyst: 2, title: 'High temperature' },
  tempRise: { level: 'warning', metric: 'rise', hyst: 2, title: 'Temperature spike' },
  cpu: { level: 'warning', metric: 'cpu', hyst: 5, title: 'High CPU usage' },
  ram: { level: 'warning', metric: 'ram', hyst: 3, title: 'High memory usage' },
};
const ruleState = {};
for (const id of Object.keys(RULES)) ruleState[id] = { since: 0, active: false, last: 0 };

const fmtT = (c) => (settings.unit === 'F' ? `${Math.round(c * 9 / 5 + 32)} °F` : `${Math.round(c)} °C`);
const fmtDT = (c) => (settings.unit === 'F' ? `${Math.round(c * 9 / 5)} °F` : `${Math.round(c)} °C`);

// Average temperature over the last 10 minutes (needs at least a minute of data).
function baseline(now) {
  let sum = 0, n = 0, first = now;
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    if (r[0] < now - 600000) break;
    const vals = r.slice(3).filter((v) => v != null);
    if (!vals.length) continue;
    sum += Math.max(...vals); n++; first = r[0];
  }
  return n > 5 && now - first >= 60000 ? sum / n : null;
}

function describe(id, v, s) {
  const cfg = settings.alerts[id];
  const top = s.procs.slice().sort((a, b) => b.cpu - a.cpu)[0];
  const topCpu = top && top.cpu >= 1 ? ` Busiest app: ${top.name} (${Math.round(top.cpu)}% CPU).` : '';
  const topMemP = s.procs.slice().sort((a, b) => b.mem - a.mem)[0];
  const topMem = topMemP ? ` Largest app: ${topMemP.name} (${(topMemP.mem / 1024).toFixed(1)} GB).` : '';
  switch (id) {
    case 'tempCrit':
    case 'tempWarn': return `Temperature is ${fmtT(s.temp)} (limit ${fmtT(cfg.threshold)}).${topCpu}`;
    case 'tempRise': return `Temperature is ${fmtT(s.temp)}, ${fmtDT(v)} above your 10-minute average.${topCpu}`;
    case 'cpu': return `CPU usage is ${Math.round(v)}% (limit ${cfg.threshold}%).${topCpu}`;
    case 'ram': return `Memory usage is ${Math.round(v)}% (limit ${cfg.threshold}%).${topMem}`;
    default: return '';
  }
}

function logAlert(entry, forceToast) {
  entry.id = ++alertSeq;
  alertLog.unshift(entry);
  if (alertLog.length > 200) alertLog.length = 200;
  writeJson(ALERTS_FILE, alertLog);
  broadcast('alert', entry);
  const snoozed = Date.now() < settings.snoozeUntil;
  if (forceToast || (settings.notify.toast && !snoozed)) toast(entry.title, entry.msg);
}

function evaluateAlerts(s) {
  const now = s.t;
  const base = s.temp != null ? baseline(now) : null;
  const values = {
    temp: s.temp,
    cpu: s.cpu,
    ram: s.ram,
    rise: s.temp != null && base != null ? s.temp - base : null,
  };
  const cooldown = settings.notify.cooldownMin * 60000;
  for (const id of Object.keys(RULES)) {
    const rule = RULES[id], cfg = settings.alerts[id], st = ruleState[id];
    const v = values[rule.metric];
    if (!cfg.enabled || v == null) { st.since = 0; st.active = false; continue; }
    if (v >= cfg.threshold) {
      if (!st.since) st.since = now;
      const starting = !st.active && now - st.since >= cfg.sustainSec * 1000;
      const repeating = st.active && now - st.last >= cooldown;
      if (starting || repeating) {
        st.active = true; st.last = now;
        // A critical temperature alert already covers the warning one.
        if (id === 'tempWarn' && ruleState.tempCrit.active) continue;
        logAlert({ t: now, rule: id, level: rule.level, title: rule.title, msg: describe(id, v, s), repeat: repeating });
      }
    } else if (st.active) {
      if (v < cfg.threshold - rule.hyst) {
        st.active = false; st.since = 0;
        if (settings.notify.recovery) {
          const what = rule.metric === 'cpu' ? `CPU usage is ${Math.round(s.cpu)}%`
            : rule.metric === 'ram' ? `Memory usage is ${Math.round(s.ram)}%`
              : `Temperature is ${fmtT(s.temp)}`;
          logAlert({ t: now, rule: id, level: 'good', title: 'Back to normal', msg: `${what} — ${rule.title.toLowerCase()} cleared.` });
        }
      }
    } else {
      st.since = 0;
    }
  }
}

function toast(title, body) {
  try {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'toast.ps1'),
    ], {
      windowsHide: true, stdio: 'ignore',
      env: { ...process.env, TW_TITLE: `TempWatch: ${title}`, TW_BODY: body, TW_URL: URL_BASE },
    });
    child.on('error', () => {});
  } catch { /* notifications are best effort */ }
}

// ---------------------------------------------------------------- http
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (d) => {
      body += d;
      if (body.length > 100000) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function applySettings(next) {
  const before = settings;
  settings = sanitize(DEFAULTS, next, '');
  writeJson(SETTINGS_FILE, settings);
  if (settings.intervalMs !== before.intervalMs) { startTimer(); startSensor(); }
  broadcast('settings', settings);
}
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

const server = http.createServer(async (req, res) => {
  // Only answer requests addressed to this machine, and only accept changes from our own page.
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) { res.writeHead(403); return res.end('Forbidden'); }
  const url = new URL(req.url, URL_BASE);
  const route = `${req.method} ${url.pathname}`;
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.has(origin)) { res.writeHead(403); return res.end('Forbidden'); }
  }
  try {
    switch (route) {
      case 'GET /':
      case 'GET /index.html': {
        const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      case 'GET /api/stream': {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const cpus = os.cpus();
        res.write(`event: init\ndata: ${JSON.stringify({
          settings, zoneOrder, history, alerts: alertLog, last: lastSample, cards: CARD_IDS,
          info: { host: os.hostname(), cpu: cpus[0] ? cpus[0].model.trim() : 'CPU', threads: cpus.length, os: `${os.type()} ${os.release()}` },
        })}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      case 'POST /api/settings': {
        const patch = await readBody(req);
        if (!isObj(patch)) return sendJson(res, 400, { error: 'Expected an object' });
        applySettings(deepAssign(settings, patch));
        return sendJson(res, 200, settings);
      }
      case 'POST /api/settings/reset':
        applySettings({});
        return sendJson(res, 200, settings);
      case 'POST /api/test':
        logAlert({ t: Date.now(), rule: 'test', level: 'info', title: 'Test notification', msg: 'Notifications are working. This is what an alert looks like.' }, true);
        return sendJson(res, 200, { ok: true });
      case 'POST /api/alerts/clear':
        alertLog = [];
        writeJson(ALERTS_FILE, alertLog);
        broadcast('alerts', alertLog);
        return sendJson(res, 200, { ok: true });
      case 'GET /api/export.csv': {
        const head = ['time', 'cpu_percent', 'ram_percent', ...zoneOrder.map((z) => `${z.replace(/[",\r\n]/g, ' ')}_celsius`)];
        const lines = [head.join(',')];
        for (const r of history) lines.push([new Date(r[0]).toISOString(), ...r.slice(1).map((v) => (v == null ? '' : v))].join(','));
        res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="tempwatch-history.csv"' });
        return res.end(lines.join('\r\n'));
      }
      case 'POST /api/quit':
        sendJson(res, 200, { ok: true });
        return setTimeout(shutdown, 200);
      case 'GET /favicon.ico':
        res.writeHead(204);
        return res.end();
      default:
        res.writeHead(404);
        return res.end('Not found');
    }
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
});

function openBrowser() {
  spawn('cmd', ['/c', 'start', '', URL_BASE], { windowsHide: true, stdio: 'ignore', detached: true }).unref();
}
function shutdown() {
  shuttingDown = true;
  stopSensor();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`TempWatch is already running at ${URL_BASE}`);
    if (OPEN) openBrowser();
    setTimeout(() => process.exit(0), 300);
  } else {
    console.error(e);
    process.exit(1);
  }
});
server.listen(PORT, HOST, () => {
  console.log(`TempWatch is running at ${URL_BASE}  (Ctrl+C to stop)`);
  startSensor();
  startTimer();
  if (OPEN) openBrowser();
});
