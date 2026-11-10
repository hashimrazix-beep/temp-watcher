'use strict';
// macOS readings that Node cannot get natively: real memory use, battery, disk,
// network throughput, per-app usage and (when a helper tool is installed) temperature.
// Uses only tools that ship with macOS, plus optional `smctemp` / `osx-cpu-temp`.
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');

const ENV = { ...process.env, LC_ALL: 'C', PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` };
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: ENV, timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? null : String(out)));
  });
}

// "Memory used" the way Activity Monitor counts it: active + wired + compressed pages.
function parseVmStat(out) {
  if (!out) return null;
  const size = Number((out.match(/page size of (\d+) bytes/) || [])[1]) || 4096;
  const pages = (name) => Number((out.match(new RegExp(`${name}:\\s+(\\d+)`)) || [])[1]) || 0;
  const used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * size;
  return used > 0 ? used : null;
}

function parseBattery(out) {
  if (!out) return null;
  const pct = out.match(/(\d+)%/);
  if (!pct) return null;   // desktop Mac, no battery
  const charging = /AC Power/.test(out.split('\n')[0]);
  return { pct: Number(pct[1]), charging, status: charging ? 2 : 1 };
}

// `ps -axo pcpu=,rss=,comm=` -> apps grouped by name. pcpu is per-core, so scale to the whole CPU.
function parsePs(out, cores) {
  if (!out) return [];
  const apps = new Map();
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*([\d.]+)\s+(\d+)\s+(.+?)\s*$/);
    if (!m) continue;
    const name = path.basename(m[3]);
    const a = apps.get(name) || { name, cpu: 0, mem: 0, n: 0 };
    a.cpu += Number(m[1]) / cores; a.mem += Number(m[2]) / 1024; a.n += 1;
    apps.set(name, a);
  }
  const list = [...apps.values()];
  const top = new Map();
  for (const a of list.slice().sort((x, y) => y.cpu - x.cpu).slice(0, 12)) top.set(a.name, a);
  for (const a of list.slice().sort((x, y) => y.mem - x.mem).slice(0, 12)) top.set(a.name, a);
  return [...top.values()].map((a) => ({ name: a.name, cpu: Math.round(a.cpu * 10) / 10, mem: Math.round(a.mem), n: a.n }));
}

// `netstat -ib` -> total bytes in / out across real interfaces (one <Link#> row each).
function parseNetstat(out) {
  if (!out) return null;
  let rx = 0, tx = 0;
  const seen = new Set();
  for (const line of out.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || !/^<Link#/.test(f[2]) || f[0].startsWith('lo') || seen.has(f[0])) continue;
    seen.add(f[0]);
    // The address column can be missing, so count from the right: ... Ibytes Opkts Oerrs Obytes Coll
    const ib = Number(f[f.length - 5]), ob = Number(f[f.length - 2]);
    if (Number.isFinite(ib) && Number.isFinite(ob)) { rx += ib; tx += ob; }
  }
  return { rx, tx };
}

function parseDf(out) {
  if (!out) return [];
  const f = (out.trim().split('\n')[1] || '').trim().split(/\s+/);
  const size = Number(f[1]) * 1024, free = Number(f[3]) * 1024;
  return size > 0 ? [{ name: '/', size, free }] : [];
}

// Temperature needs a small helper tool on macOS; probe once for one that works.
let tempTool;   // undefined = not probed yet, null = none found
async function readTemps() {
  const num = (s) => { const m = s && s.match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  const ok = (v) => v != null && v > 0 && v < 150;
  if (tempTool === undefined) {
    if (ok(num(await run('smctemp', ['-c'])))) tempTool = 'smctemp';
    else if (ok(num(await run('osx-cpu-temp', [])))) tempTool = 'osx-cpu-temp';
    else tempTool = null;
  }
  const zones = [];
  if (tempTool === 'smctemp') {
    const [c, g] = await Promise.all([run('smctemp', ['-c']), run('smctemp', ['-g'])]);
    if (ok(num(c))) zones.push({ name: 'CPU', c: Math.round(num(c) * 10) / 10 });
    if (ok(num(g))) zones.push({ name: 'GPU', c: Math.round(num(g) * 10) / 10 });
  } else if (tempTool === 'osx-cpu-temp') {
    const c = num(await run('osx-cpu-temp', []));
    if (ok(c)) zones.push({ name: 'CPU', c });
  }
  return zones;
}

let prevNet = null, prevAt = 0;
async function collect() {
  const started = Date.now();
  const [vm, batt, ps, net, df, zones] = await Promise.all([
    run('vm_stat', []),
    run('pmset', ['-g', 'batt']),
    run('ps', ['-axo', 'pcpu=,rss=,comm=']),
    run('netstat', ['-ib']),
    run('df', ['-kP', '/']),
    readTemps(),
  ]);
  const now = Date.now();
  const totals = parseNetstat(net);
  let rx = 0, tx = 0;
  if (totals && prevNet && now > prevAt) {
    const secs = (now - prevAt) / 1000;
    rx = Math.max(0, Math.round((totals.rx - prevNet.rx) / secs));
    tx = Math.max(0, Math.round((totals.tx - prevNet.tx) / secs));
  }
  if (totals) { prevNet = totals; prevAt = now; }
  return {
    zones, rx, tx,
    battery: parseBattery(batt),
    disks: parseDf(df),
    procs: parsePs(ps, os.cpus().length || 1),
    memUsed: parseVmStat(vm),
    tempTool,
    ms: now - started,
  };
}

module.exports = { collect, parseVmStat, parseBattery, parsePs, parseNetstat, parseDf };
