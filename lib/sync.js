'use strict';
// Motor de sincronización asíncrona: sube archivos/carpetas locales al remoto.
// Cada job usa su PROPIA conexión SFTP (no interfiere con el navegado activo).
// Los jobs viven en memoria; la UI consulta su progreso por polling.

const fs = require('fs');
const path = require('path');
const sftpLib = require('./sftp');

const jobs = new Map();
let counter = 0;

// Máx conexiones SFTP paralelas por job. 3 = balance conservador:
// acelera sin arriesgar límites del server (MaxStartups/MaxSessions).
const CONCURRENCY = 3;

// Presets de sincronización (config reutilizable, sin secretos).
const PRESETS_FILE = path.join(__dirname, '..', 'syncs.json');

function loadPresets() {
  if (!fs.existsSync(PRESETS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')); } catch (_) { return []; }
}
function savePresets(list) {
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(list, null, 2));
}
function upsertPreset(preset) {
  const list = loadPresets().filter((p) => p.name !== preset.name);
  list.push(preset);
  savePresets(list);
  return list;
}
function removePreset(name) {
  savePresets(loadPresets().filter((p) => p.name !== name));
}

// Recorre un item local. Devuelve [{abs, rel}] donde rel es POSIX relativo
// al padre del item (así la carpeta seleccionada se incluye en el destino).
function walk(itemPath) {
  const base = path.dirname(itemPath);
  const out = [];
  (function rec(p) {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) rec(path.join(p, e));
    } else {
      const rel = path.relative(base, p).split(path.sep).join('/');
      out.push({ abs: p, rel });
    }
  })(itemPath);
  return out;
}

function posixJoin(a, b) {
  return a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, '');
}
function posixDir(p) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

// Lanza un job (no bloquea: run() corre en background).
function start(profile, secret, items, remoteDest, ts) {
  const id = 'job' + (++counter);
  const files = [];
  for (const it of items) files.push(...walk(it.localPath));
  const job = {
    id,
    profileName: profile.name,
    status: 'running', // running | done | done_with_errors | error | cancelled
    total: files.length,
    done: 0,
    failed: 0,
    current: '',
    log: [],
    remoteDest,
    cancel: false,
    startedAt: ts || 0,
    finishedAt: 0,
  };
  jobs.set(id, job);
  run(job, profile, secret, files, remoteDest); // fire-and-forget
  return id;
}

async function run(job, profile, secret, files, remoteDest) {
  const conns = [];
  const dirLocks = new Map(); // dir -> Promise (dedupe mkdir entre workers)
  let idx = 0; // cola compartida; idx++ es atómico (JS single-thread, sin await entre lectura e incremento)
  let dest = remoteDest; // se resuelve al landing dir si viene vacío (tras conectar)

  // Crea el dir remoto una sola vez aunque varios workers lo pidan a la vez.
  // mkdir es server-side: lo hace una conexión, el resto ve el mismo dir.
  function ensureDir(conn, dir) {
    let p = dirLocks.get(dir);
    if (!p) {
      p = (async () => { try { await conn.sftp.mkdir(dir, true); } catch (_) { /* ya existe */ } })();
      dirLocks.set(dir, p);
    }
    return p;
  }

  async function worker(conn) {
    for (;;) {
      if (job.cancel) return;
      const i = idx++;
      if (i >= files.length) return;
      const f = files[i];
      const remotePath = posixJoin(dest, f.rel);
      const dir = posixDir(remotePath);
      job.current = f.rel;
      try {
        await ensureDir(conn, dir);
        await conn.sftp.fastPut(f.abs, remotePath);
        job.done++;
      } catch (e) {
        job.failed++;
        job.log.push(f.rel + ' -> ERROR: ' + (e.message || e));
      }
    }
  }

  try {
    const n = Math.min(CONCURRENCY, files.length || 1);
    for (let i = 0; i < n; i++) conns.push(await sftpLib.connect(profile, secret));

    // dest vacío => landing dir real de la conexión.
    if (!dest || !dest.trim()) {
      try { dest = await conns[0].sftp.realPath('.'); } catch (_) { dest = '.'; }
    }
    job.remoteDest = dest; // refleja el destino real en el status

    await Promise.all(conns.map((c) => worker(c)));

    if (job.cancel) job.status = 'cancelled';
    else job.status = job.failed ? 'done_with_errors' : 'done';
  } catch (e) {
    job.status = 'error';
    job.log.push('Conexión: ' + (e.message || e));
  } finally {
    for (const c of conns) { try { await c.close(); } catch (_) { /* noop */ } }
    job.current = '';
  }
}

function status(id) {
  const j = jobs.get(id);
  if (!j) return null;
  // no exponemos secretos ni objetos internos pesados
  return {
    id: j.id, profileName: j.profileName, status: j.status,
    total: j.total, done: j.done, failed: j.failed, current: j.current,
    log: j.log.slice(-100), remoteDest: j.remoteDest,
    startedAt: j.startedAt, finishedAt: j.finishedAt,
  };
}

function markFinished(id, ts) {
  const j = jobs.get(id);
  if (j && !j.finishedAt && j.status !== 'running') j.finishedAt = ts;
}

function list() {
  return [...jobs.values()].map((j) => ({
    id: j.id, profileName: j.profileName, status: j.status,
    total: j.total, done: j.done, failed: j.failed,
  }));
}

function cancel(id) {
  const j = jobs.get(id);
  if (j && j.status === 'running') { j.cancel = true; return true; }
  return false;
}

module.exports = {
  start, status, list, cancel, markFinished,
  loadPresets, upsertPreset, removePreset,
};
