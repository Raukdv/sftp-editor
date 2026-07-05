'use strict';
// Servidor local del cliente SFTP. Escucha SOLO en 127.0.0.1.
// Mantiene en RAM: contraseña maestra, store de secretos descifrado,
// y la conexión SFTP activa (1 usuario, 1 máquina).

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cryptoStore = require('./lib/crypto');
const profiles = require('./lib/profiles');
const sftpLib = require('./lib/sftp');
const sync = require('./lib/sync');

const PORT = process.env.PORT || 4599;
const HOST = '127.0.0.1'; // nunca exponer a la red

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Estado en memoria ----
const state = {
  master: null,        // contraseña maestra (RAM)
  secrets: null,       // store descifrado { profileName: {password, passphrase, jumpPassword, jumpPassphrase} }
  active: null,        // { sftp, close } conexión SFTP activa
  activeProfile: null, // nombre del perfil conectado
};

function requireUnlock(req, res, next) {
  if (!state.master) return res.status(401).json({ error: 'Bloqueado. Introduce la contraseña maestra.' });
  next();
}
function requireConn(req, res, next) {
  if (!state.active) return res.status(409).json({ error: 'Sin conexión SFTP activa.' });
  next();
}
function fail(res, e) {
  res.status(500).json({ error: e && e.message ? e.message : String(e) });
}

// ===================== SESIÓN / MAESTRA =====================

app.get('/api/status', (req, res) => {
  res.json({
    unlocked: !!state.master,
    hasStore: cryptoStore.storeExists(),
    connected: !!state.active,
    activeProfile: state.activeProfile,
    home: os.homedir(),
  });
});

// Desbloquea (o inicializa si no hay store). Valida la maestra descifrando.
app.post('/api/unlock', (req, res) => {
  const { master } = req.body || {};
  if (!master) return res.status(400).json({ error: 'Falta la contraseña maestra.' });
  try {
    if (cryptoStore.storeExists()) {
      state.secrets = cryptoStore.loadStore(master); // lanza si es incorrecta
    } else {
      state.secrets = {};
      cryptoStore.saveStore(master, state.secrets); // primera vez: fija la maestra
    }
    state.master = master;
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: 'Contraseña maestra incorrecta.' });
  }
});

app.post('/api/lock', async (req, res) => {
  if (state.active) { await state.active.close(); state.active = null; state.activeProfile = null; }
  state.master = null;
  state.secrets = null;
  res.json({ ok: true });
});

// ===================== PERFILES =====================

app.get('/api/profiles', requireUnlock, (req, res) => {
  try {
    // Devuelve perfiles sin secretos (los JSON ya no los contienen).
    res.json(profiles.list());
  } catch (e) { fail(res, e); }
});

// Crea/actualiza perfil + guarda sus secretos cifrados.
app.post('/api/profiles', requireUnlock, (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.host || !b.user) {
      return res.status(400).json({ error: 'Faltan campos: name, host, user.' });
    }
    const profile = {
      name: b.name,
      host: b.host,
      port: Number(b.port) || 22,
      user: b.user,
      authType: b.authType === 'key' ? 'key' : 'password',
      keyPath: b.keyPath || null,
      remotePath: (b.remotePath && b.remotePath.trim()) || null, // vacío = landing dir
      jump: b.jump && b.jump.host ? {
        host: b.jump.host,
        port: Number(b.jump.port) || 22,
        user: b.jump.user,
        authType: b.jump.authType === 'key' ? 'key' : 'password',
        keyPath: b.jump.keyPath || null,
      } : null,
    };
    profiles.save(profile);

    // Secretos → store cifrado
    const key = profiles.safeName(profile.name);
    state.secrets[key] = {
      password: b.password || '',
      passphrase: b.passphrase || '',
      jumpPassword: (b.jump && b.jump.password) || '',
      jumpPassphrase: (b.jump && b.jump.passphrase) || '',
    };
    cryptoStore.saveStore(state.master, state.secrets);

    res.json({ ok: true, profile });
  } catch (e) { fail(res, e); }
});

app.delete('/api/profiles/:name', requireUnlock, (req, res) => {
  try {
    const key = profiles.safeName(req.params.name);
    profiles.remove(key);
    delete state.secrets[key];
    cryptoStore.saveStore(state.master, state.secrets);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ===================== CONEXIÓN =====================

app.post('/api/connect', requireUnlock, async (req, res) => {
  try {
    const { name } = req.body || {};
    const profile = profiles.get(name);
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado.' });
    const secret = state.secrets[profiles.safeName(name)] || {};

    if (state.active) { await state.active.close(); state.active = null; }
    state.active = await sftpLib.connect(profile, secret);
    state.activeProfile = profile.name;
    // Directorio de aterrizaje real (donde deja el server al conectar).
    let landingPath = '.';
    try { landingPath = await state.active.sftp.realPath('.'); } catch (_) { /* noop */ }
    res.json({ ok: true, landingPath, remotePath: profile.remotePath || null });
  } catch (e) { state.active = null; state.activeProfile = null; fail(res, e); }
});

app.post('/api/disconnect', async (req, res) => {
  if (state.active) { await state.active.close(); state.active = null; state.activeProfile = null; }
  res.json({ ok: true });
});

// ===================== PANEL REMOTO (SFTP) =====================

app.get('/api/remote/list', requireConn, async (req, res) => {
  try {
    const dir = req.query.path || '.';
    const items = await state.active.sftp.list(dir);
    res.json({
      path: dir,
      items: items.map((i) => ({
        name: i.name,
        type: i.type, // 'd' dir, '-' file, 'l' link
        size: i.size,
        modified: i.modifyTime,
      })),
    });
  } catch (e) { fail(res, e); }
});

app.get('/api/remote/read', requireConn, async (req, res) => {
  try {
    const p = req.query.path;
    const buf = await state.active.sftp.get(p); // Buffer
    res.json({ path: p, content: buf.toString('utf8') });
  } catch (e) { fail(res, e); }
});

app.post('/api/remote/write', requireConn, async (req, res) => {
  try {
    const { path: p, content } = req.body || {};
    await state.active.sftp.put(Buffer.from(content ?? '', 'utf8'), p);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post('/api/remote/delete', requireConn, async (req, res) => {
  try {
    const { path: p, isDir } = req.body || {};
    if (isDir) await state.active.sftp.rmdir(p, true);
    else await state.active.sftp.delete(p);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post('/api/remote/mkdir', requireConn, async (req, res) => {
  try {
    const { path: p } = req.body || {};
    await state.active.sftp.mkdir(p, true);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post('/api/remote/rename', requireConn, async (req, res) => {
  try {
    const { from, to } = req.body || {};
    await state.active.sftp.rename(from, to);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ===================== PANEL LOCAL (FS de la máquina) =====================

app.get('/api/local/list', requireUnlock, (req, res) => {
  try {
    const dir = req.query.path || os.homedir();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const items = entries.map((e) => {
      let size = 0, modified = 0;
      try {
        const st = fs.statSync(path.join(dir, e.name));
        size = st.size; modified = st.mtimeMs;
      } catch (_) { /* permiso denegado, ignora */ }
      return { name: e.name, type: e.isDirectory() ? 'd' : '-', size, modified };
    });
    res.json({ path: path.resolve(dir), items });
  } catch (e) { fail(res, e); }
});

app.get('/api/local/read', requireUnlock, (req, res) => {
  try {
    const p = req.query.path;
    res.json({ path: p, content: fs.readFileSync(p, 'utf8') });
  } catch (e) { fail(res, e); }
});

app.post('/api/local/write', requireUnlock, (req, res) => {
  try {
    const { path: p, content } = req.body || {};
    fs.writeFileSync(p, content ?? '', 'utf8');
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post('/api/local/delete', requireUnlock, (req, res) => {
  try {
    const { path: p, isDir } = req.body || {};
    if (isDir) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

app.post('/api/local/mkdir', requireUnlock, (req, res) => {
  try {
    const { path: p } = req.body || {};
    fs.mkdirSync(p, { recursive: true });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ===================== TRANSFERENCIAS (local <-> remoto) =====================

// Sube: archivo local -> remoto
app.post('/api/transfer/upload', requireConn, async (req, res) => {
  try {
    const { localPath, remotePath } = req.body || {};
    await state.active.sftp.fastPut(localPath, remotePath);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// Baja: archivo remoto -> local
app.post('/api/transfer/download', requireConn, async (req, res) => {
  try {
    const { remotePath, localPath } = req.body || {};
    await state.active.sftp.fastGet(remotePath, localPath);
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ===================== SINCRONIZACIÓN (jobs async) =====================

// Inicia un job de subida. Usa su propia conexión (no toca el navegado activo).
app.post('/api/sync/start', requireUnlock, (req, res) => {
  try {
    const { profileName, items, remoteDest } = req.body || {};
    if (!profileName) return res.status(400).json({ error: 'Falta profileName.' });
    // remoteDest opcional: vacío => sync usa el landing dir de la conexión.
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No hay archivos/carpetas seleccionados.' });
    }
    const profile = profiles.get(profileName);
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado.' });
    const secret = state.secrets[profiles.safeName(profileName)] || {};
    const jobId = sync.start(profile, secret, items, remoteDest, Date.now());
    res.json({ ok: true, jobId });
  } catch (e) { fail(res, e); }
});

app.get('/api/sync/status/:id', requireUnlock, (req, res) => {
  const st = sync.status(req.params.id);
  if (!st) return res.status(404).json({ error: 'Job no encontrado.' });
  if (st.status !== 'running') sync.markFinished(req.params.id, Date.now());
  res.json(st);
});

app.get('/api/sync/jobs', requireUnlock, (req, res) => res.json(sync.list()));

app.post('/api/sync/cancel/:id', requireUnlock, (req, res) => {
  res.json({ ok: sync.cancel(req.params.id) });
});

// Presets (config reutilizable)
app.get('/api/sync/presets', requireUnlock, (req, res) => res.json(sync.loadPresets()));

app.post('/api/sync/presets', requireUnlock, (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Falta nombre del preset.' });
    const preset = {
      name: b.name,
      profileName: b.profileName || '',
      remoteDest: b.remoteDest || '',
      items: Array.isArray(b.items) ? b.items : [],
    };
    res.json({ ok: true, presets: sync.upsertPreset(preset) });
  } catch (e) { fail(res, e); }
});

app.delete('/api/sync/presets/:name', requireUnlock, (req, res) => {
  sync.removePreset(req.params.name);
  res.json({ ok: true });
});

// ===================== ARRANQUE =====================

app.listen(PORT, HOST, () => {
  console.log(`SFTP Editor escuchando en http://${HOST}:${PORT}`);
  console.log('Abre esa URL en el navegador.');
});
