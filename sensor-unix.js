'use strict';
// macOS and Linux readings that Node cannot get natively: real memory use, battery,
// disk, network throughput, per-app usage and temperature.
// macOS: built-in tools only (battery temperature out of the box; CPU temperature
// when `smctemp` or `osx-cpu-temp` is installed). Linux: /proc and /sys.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_MAC = process.platform === 'darwin';
const ENV = { ...process.env, LC_ALL: 'C', PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` };
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: ENV, timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? null : String(out)));
  });
}
const read = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const r1 = (v) => Math.round(v * 10) / 10;
const okTemp = (v) => v != null && Number.isFinite(v) && v > 0 && v < 150;

// Keep the busiest and the largest apps, like the Windows helper does.
function topApps(apps) {
  const top = new Map();
  for (const a of apps.slice().sort((x, y) => y.cpu - x.cpu).slice(0, 12)) top.set(a.name, a);
  for (const a of apps.slice().sort((x, y) => y.mem - x.mem).slice(0, 12)) top.set(a.name, a);
  return [...top.values()].map((a) => ({ name: a.name, cpu: r1(a.cpu), mem: Math.round(a.mem), n: a.n }));
}

function parseDf(out) {
  if (!out) return [];
  const f = (out.trim().split('\n')[1] || '').trim().split(/\s+/);
  const size = Number(f[1]) * 1024, free = Number(f[3]) * 1024;
  return size > 0 ? [{ name: '/', size, free }] : [];
}

// ---------------------------------------------------------------- macOS
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

// `ioreg -rn AppleSmartBattery` reports the battery temperature in hundredths of a degree.
function parseBatteryTemp(out) {
  const m = out && out.match(/"Temperature"\s*=\s*(\d+)/);
  const c = m ? Number(m[1]) / 100 : null;
  return okTemp(c) ? r1(c) : null;
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
  return topApps([...apps.values()]);
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

// CPU temperature needs a small helper tool on macOS; probe once for one that works.
let tempTool;   // undefined = not probed yet, null = none found
async function macTemps() {
  const num = (s) => { const m = s && s.match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  if (tempTool === undefined) {
    if (okTemp(num(await run('smctemp', ['-c'])))) tempTool = 'smctemp';
    else if (okTemp(num(await run('osx-cpu-temp', [])))) tempTool = 'osx-cpu-temp';
    else tempTool = null;
  }
  const zones = [];
  if (tempTool === 'smctemp') {
    const [c, g] = await Promise.all([run('smctemp', ['-c']), run('smctemp', ['-g'])]);
    if (okTemp(num(c))) zones.push({ name: 'CPU', c: r1(num(c)) });
    if (okTemp(num(g))) zones.push({ name: 'GPU', c: r1(num(g)) });
  } else if (tempTool === 'osx-cpu-temp') {
    const c = num(await run('osx-cpu-temp', []));
    if (okTemp(c)) zones.push({ name: 'CPU', c });
  }
  const batt = parseBatteryTemp(await run('ioreg', ['-rn', 'AppleSmartBattery']));
  if (batt != null) zones.push({ name: 'Battery', c: batt });
  return zones;
}

async function collectMac() {
  const [vm, batt, ps, net, df, zones] = await Promise.all([
    run('vm_stat', []), run('pmset', ['-g', 'batt']), run('ps', ['-axo', 'pcpu=,rss=,comm=']),
    run('netstat', ['-ib']), run('df', ['-kP', '/']), macTemps(),
  ]);
  return {
    zones, net: parseNetstat(net), battery: parseBattery(batt), disks: parseDf(df),
    procs: parsePs(ps, os.cpus().length || 1), memUsed: parseVmStat(vm), cpuTempTool: tempTool,
  };
}

// ---------------------------------------------------------------- Linux
function parseMeminfo(out) {
  if (!out) return null;
  const kb = (k) => Number((out.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm')) || [])[1]);
  const total = kb('MemTotal'), avail = kb('MemAvailable');
  return total > 0 && avail >= 0 ? (total - avail) * 1024 : null;
}

function parseProcNetDev(out) {
  if (!out) return null;
  let rx = 0, tx = 0;
  for (const line of out.split('\n').slice(2)) {
    const m = line.match(/^\s*([^:\s]+):\s*(.+)$/);
    if (!m || m[1] === 'lo') continue;
    const f = m[2].trim().split(/\s+/);
    rx += Number(f[0]) || 0; tx += Number(f[8]) || 0;
  }
  return { rx, tx };
}

// One /proc/<pid>/stat line -> { name, ticks (user + system), rssPages }
function parseProcStat(line) {
  const open = line.indexOf('('), close = line.lastIndexOf(')');
  if (open < 0 || close < 0) return null;
  const f = line.slice(close + 2).split(' ');
  return { name: line.slice(open + 1, close), ticks: Number(f[11]) + Number(f[12]), rssPages: Number(f[21]) };
}

function linuxTemps() {
  const zones = [], used = new Set();
  const add = (name, milli) => {
    const c = Number(milli) / 1000;
    if (!okTemp(c)) return;
    let label = name, i = 2;
    while (used.has(label)) label = `${name} ${i++}`;
    used.add(label);
    zones.push({ name: label, c: r1(c) });
  };
  for (const hw of list('/sys/class/hwmon')) {
    const base = `/sys/class/hwmon/${hw}`;
    if (/^(coretemp|k10temp|zenpower|cpu_thermal)$/.test(read(`${base}/name`) || '')) add('CPU', read(`${base}/temp1_input`));
  }
  for (const z of list('/sys/class/thermal').filter((n) => n.startsWith('thermal_zone'))) {
    add(read(`/sys/class/thermal/${z}/type`) || z, read(`/sys/class/thermal/${z}/temp`));
  }
  return zones;
}

function linuxBattery() {
  const bat = list('/sys/class/power_supply').find((n) => /^BAT/.test(n));
  if (!bat) return null;
  const pct = Number(read(`/sys/class/power_supply/${bat}/capacity`));
  if (!Number.isFinite(pct)) return null;
  const charging = (read(`/sys/class/power_supply/${bat}/status`) || '') !== 'Discharging';
  return { pct, charging, status: charging ? 2 : 1 };
}

let prevTicks = new Map(), prevTicksAt = 0;
function linuxProcs(now) {
  const cores = os.cpus().length || 1, secs = (now - prevTicksAt) / 1000;
  const cur = new Map(), apps = new Map();
  for (const pid of list('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const st = parseProcStat(read(`/proc/${pid}/stat`) || '');
    if (!st || !Number.isFinite(st.ticks)) continue;
    cur.set(pid, st.ticks);
    const before = prevTicks.get(pid);
    // Clock ticks are 100 per second on every mainstream Linux build.
    const pct = before != null && secs > 0 ? Math.max(0, (st.ticks - before) / 100 / secs / cores * 100) : 0;
    const a = apps.get(st.name) || { name: st.name, cpu: 0, mem: 0, n: 0 };
    a.cpu += pct; a.mem += (st.rssPages || 0) * 4096 / 1048576; a.n += 1;
    apps.set(st.name, a);
  }
  prevTicks = cur; prevTicksAt = now;
  return topApps([...apps.values()]);
}

async function collectLinux() {
  const df = await run('df', ['-kP', '/']);
  return {
    zones: linuxTemps(), net: parseProcNetDev(read('/proc/net/dev')), battery: linuxBattery(), disks: parseDf(df),
    procs: linuxProcs(Date.now()), memUsed: parseMeminfo(read('/proc/meminfo')), cpuTempTool: 'sysfs',
  };
}

// ---------------------------------------------------------------- shared
let prevNet = null, prevNetAt = 0;
async function collect() {
  const started = Date.now();
  const d = IS_MAC ? await collectMac() : await collectLinux();
  const now = Date.now();
  let rx = 0, tx = 0;
  if (d.net && prevNet && now > prevNetAt) {
    const secs = (now - prevNetAt) / 1000;
    rx = Math.max(0, Math.round((d.net.rx - prevNet.rx) / secs));
    tx = Math.max(0, Math.round((d.net.tx - prevNet.tx) / secs));
  }
  if (d.net) { prevNet = d.net; prevNetAt = now; }
  return { zones: d.zones, rx, tx, battery: d.battery, disks: d.disks, procs: d.procs, memUsed: d.memUsed, cpuTempTool: d.cpuTempTool, ms: now - started };
}

module.exports = { collect, parseVmStat, parseBattery, parseBatteryTemp, parsePs, parseNetstat, parseDf, parseMeminfo, parseProcNetDev, parseProcStat };
