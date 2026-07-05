'use strict';

// ---------- helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

function setStatus(msg) { $('#statusMsg').textContent = msg; }
function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i ? 1 : 0) + ' ' + u[i];
}

// Rutas: local usa '\', remoto usa '/'.
function sep(side) { return side === 'local' ? '\\' : '/'; }
function joinPath(side, cur, name) {
  const s = sep(side);
  if (side === 'remote') {
    if (cur === '/' ) return '/' + name;
    return cur.replace(/\/+$/, '') + '/' + name;
  }
  return cur.replace(/[\\/]+$/, '') + s + name;
}
function parentPath(side, cur) {
  if (side === 'remote') {
    if (cur === '/' || cur === '') return '/';
    const p = cur.replace(/\/+$/, '').split('/').slice(0, -1).join('/');
    return p === '' ? '/' : p;
  }
  // local
  const parts = cur.replace(/[\\/]+$/, '').split(/[\\/]/);
  if (parts.length <= 1) return cur; // raíz de unidad p.ej C:
  return parts.slice(0, -1).join('\\') || cur;
}

// ---------- estado UI ----------
const S = {
  connected: false,
  paths: { local: '', remote: '/' },
  selected: { local: null, remote: null }, // {name, type, path}
  editor: { side: null, path: null },
  editingProfile: null,
};

// ================= SESIÓN =================
async function refreshStatus() {
  const st = await api('GET', '/api/status');
  if (!st.unlocked) {
    $('#lockOverlay').classList.remove('hidden');
    $('#lockHint').textContent = st.hasStore
      ? 'Introduce tu contraseña maestra.'
      : 'Primera vez: define una contraseña maestra (cifra tus secretos).';
    return false;
  }
  $('#lockOverlay').classList.add('hidden');
  S.connected = st.connected;
  updateConnUI(st.activeProfile);
  await loadProfiles();
  // panel local arranca en HOME
  if (!S.paths.local) S.paths.local = st.home;
  await refreshPanel('local');
  if (st.connected) await refreshPanel('remote');
  return true;
}

$('#unlockBtn').onclick = async () => {
  $('#lockError').textContent = '';
  try {
    await api('POST', '/api/unlock', { master: $('#masterInput').value });
    $('#masterInput').value = '';
    await refreshStatus();
  } catch (e) { $('#lockError').textContent = e.message; }
};
$('#masterInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#unlockBtn').click(); });

$('#lockBtn').onclick = async () => {
  await api('POST', '/api/lock');
  location.reload();
};

// ================= PERFILES =================
async function loadProfiles() {
  const list = await api('GET', '/api/profiles');
  const sel = $('#profileSelect');
  const prev = sel.value;
  sel.innerHTML = '';
  list.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.name; o.textContent = p.name + '  (' + p.user + '@' + p.host + ')';
    sel.appendChild(o);
  });
  if (prev) sel.value = prev;
  window._profiles = list;
}

$('#connectBtn').onclick = async () => {
  const name = $('#profileSelect').value;
  if (!name) return;
  setStatus('Conectando a ' + name + '...');
  try {
    const r = await api('POST', '/api/connect', { name });
    S.connected = true;
    updateConnUI(name);
    // ruta remota por defecto del perfil, o el landing dir real de la conexión
    S.paths.remote = r.remotePath || r.landingPath || '.';
    await refreshPanel('remote');
    setStatus('Conectado a ' + name);
  } catch (e) { setStatus('Error: ' + e.message); }
};

$('#disconnectBtn').onclick = async () => {
  await api('POST', '/api/disconnect');
  S.connected = false;
  updateConnUI(null);
  $('.filelist[data-side="remote"]').innerHTML = '';
  $('.pathbar[data-side="remote"]').value = '';
  setStatus('Desconectado');
};

function updateConnUI(activeProfile) {
  const on = !!activeProfile;
  $('#connStatus').textContent = on ? ('conectado: ' + activeProfile) : 'desconectado';
  $('#connStatus').className = 'status ' + (on ? 'on' : 'off');
  $('#connectBtn').disabled = on;
  $('#disconnectBtn').disabled = !on;
}

// --- Formulario de perfil ---
function openProfileForm(existing) {
  S.editingProfile = existing ? existing.name : null;
  $('#profileFormTitle').textContent = existing ? 'Editar perfil' : 'Nuevo perfil';
  $('#profileError').textContent = '';
  const g = (id) => $('#' + id);
  g('pf_name').value = existing?.name || '';
  g('pf_name').disabled = !!existing;
  g('pf_host').value = existing?.host || '';
  g('pf_port').value = existing?.port || 22;
  g('pf_user').value = existing?.user || '';
  g('pf_auth').value = existing?.authType || 'password';
  g('pf_keyPath').value = existing?.keyPath || '';
  g('pf_remotePath').value = existing?.remotePath || '';
  g('pf_password').value = '';
  g('pf_passphrase').value = '';
  const j = existing?.jump;
  g('pf_useJump').checked = !!j;
  g('pf_jhost').value = j?.host || '';
  g('pf_jport').value = j?.port || 22;
  g('pf_juser').value = j?.user || '';
  g('pf_jauth').value = j?.authType || 'password';
  g('pf_jkeyPath').value = j?.keyPath || '';
  g('pf_jpassword').value = '';
  g('pf_jpassphrase').value = '';
  syncAuthVisibility();
  $('#profileOverlay').classList.remove('hidden');
}

function syncAuthVisibility() {
  const isKey = $('#pf_auth').value === 'key';
  $$('.pf-key').forEach((e) => e.classList.toggle('hidden', !isKey));
  $$('.pf-password').forEach((e) => e.classList.toggle('hidden', isKey));
  const useJump = $('#pf_useJump').checked;
  $('#jumpFields').classList.toggle('hidden', !useJump);
  const jKey = $('#pf_jauth').value === 'key';
  $$('.jf-key').forEach((e) => e.classList.toggle('hidden', !jKey));
  $$('.jf-password').forEach((e) => e.classList.toggle('hidden', jKey));
}
['pf_auth', 'pf_jauth', 'pf_useJump'].forEach((id) => $('#' + id).addEventListener('change', syncAuthVisibility));

$('#newProfileBtn').onclick = () => openProfileForm(null);
$('#editProfileBtn').onclick = () => {
  const name = $('#profileSelect').value;
  const p = (window._profiles || []).find((x) => x.name === name);
  if (p) openProfileForm(p);
};
$('#profileCancel').onclick = () => $('#profileOverlay').classList.add('hidden');

$('#profileSave').onclick = async () => {
  const g = (id) => $('#' + id).value;
  const body = {
    name: g('pf_name'), host: g('pf_host'), port: g('pf_port'), user: g('pf_user'),
    authType: g('pf_auth'), password: g('pf_password'),
    keyPath: g('pf_keyPath'), passphrase: g('pf_passphrase'),
    remotePath: g('pf_remotePath'),
  };
  if ($('#pf_useJump').checked) {
    body.jump = {
      host: g('pf_jhost'), port: g('pf_jport'), user: g('pf_juser'),
      authType: g('pf_jauth'), password: g('pf_jpassword'),
      keyPath: g('pf_jkeyPath'), passphrase: g('pf_jpassphrase'),
    };
  }
  try {
    await api('POST', '/api/profiles', body);
    $('#profileOverlay').classList.add('hidden');
    await loadProfiles();
    $('#profileSelect').value = body.name;
    setStatus('Perfil guardado: ' + body.name);
  } catch (e) { $('#profileError').textContent = e.message; }
};

$('#delProfileBtn').onclick = async () => {
  const name = $('#profileSelect').value;
  if (!name || !confirm('¿Borrar perfil "' + name + '"?')) return;
  await api('DELETE', '/api/profiles/' + encodeURIComponent(name));
  await loadProfiles();
  setStatus('Perfil borrado: ' + name);
};

// ================= PANELES =================
async function refreshPanel(side) {
  const listEl = $('.filelist[data-side="' + side + '"]');
  const pathEl = $('.pathbar[data-side="' + side + '"]');
  try {
    let url;
    if (side === 'local') url = '/api/local/list?path=' + encodeURIComponent(S.paths.local);
    else url = '/api/remote/list?path=' + encodeURIComponent(S.paths.remote);
    const data = await api('GET', url);
    S.paths[side] = data.path; // ruta normalizada por el server
    pathEl.value = data.path;
    renderList(side, data.items);
  } catch (e) {
    listEl.innerHTML = '<div class="row"><span class="name" style="color:#ff8080">' + e.message + '</span></div>';
  }
}

function renderList(side, items) {
  const listEl = $('.filelist[data-side="' + side + '"]');
  listEl.innerHTML = '';
  // fila ".."
  const up = row(side, { name: '..', type: 'd', size: 0 }, true);
  listEl.appendChild(up);
  // dirs primero, luego files, alfabético
  items.sort((a, b) => {
    if ((a.type === 'd') !== (b.type === 'd')) return a.type === 'd' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  items.forEach((it) => listEl.appendChild(row(side, it, false)));
}

function row(side, it, isUp) {
  const div = document.createElement('div');
  div.className = 'row';
  const isDir = it.type === 'd';
  const path = isUp ? parentPath(side, S.paths[side]) : joinPath(side, S.paths[side], it.name);

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = isUp ? '⬆️' : (isDir ? '📁' : '📄');
  div.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = it.name;
  div.appendChild(name);

  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = isDir ? '' : fmtSize(it.size);
  div.appendChild(size);

  const actions = document.createElement('span');
  actions.className = 'actions';
  if (!isUp) {
    if (!isDir) {
      // editar
      const ed = mkBtn('✏️', 'Editar', (e) => { e.stopPropagation(); openEditor(side, path, it.name); });
      actions.appendChild(ed);
      // transferir
      if (side === 'local') {
        actions.appendChild(mkBtn('→', 'Subir a remoto', (e) => { e.stopPropagation(); doUpload(path, it.name); }));
      } else {
        actions.appendChild(mkBtn('←', 'Bajar a local', (e) => { e.stopPropagation(); doDownload(path, it.name); }));
      }
    }
    actions.appendChild(mkBtn('🗑️', 'Borrar', (e) => { e.stopPropagation(); doDelete(side, path, isDir, it.name); }));
  }
  div.appendChild(actions);

  div.onclick = () => {
    if (isDir) { S.paths[side] = path; refreshPanel(side); }
    else {
      $$('.filelist[data-side="' + side + '"] .row').forEach((r) => r.classList.remove('selected'));
      div.classList.add('selected');
      S.selected[side] = { name: it.name, path, type: it.type };
    }
  };
  div.ondblclick = () => { if (!isDir && !isUp) openEditor(side, path, it.name); };
  return div;
}

function mkBtn(txt, title, fn) {
  const b = document.createElement('button');
  b.textContent = txt; b.title = title; b.onclick = fn;
  return b;
}

// pathbar: Enter navega
$$('.pathbar').forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const side = el.dataset.side; S.paths[side] = el.value; refreshPanel(side); }
  });
});
$$('.btn-refresh').forEach((b) => b.onclick = () => refreshPanel(b.dataset.side));
$$('.btn-mkdir').forEach((b) => b.onclick = async () => {
  const side = b.dataset.side;
  const name = prompt('Nombre de la nueva carpeta:');
  if (!name) return;
  const p = joinPath(side, S.paths[side], name);
  try {
    if (side === 'local') await api('POST', '/api/local/mkdir', { path: p });
    else await api('POST', '/api/remote/mkdir', { path: p });
    refreshPanel(side);
  } catch (e) { setStatus('Error mkdir: ' + e.message); }
});

// ================= TRANSFERENCIAS =================
async function doUpload(localPath, name) {
  if (!S.connected) return setStatus('Conecta primero al remoto.');
  const remotePath = joinPath('remote', S.paths.remote, name);
  setStatus('Subiendo ' + name + '...');
  try {
    await api('POST', '/api/transfer/upload', { localPath, remotePath });
    setStatus('Subido: ' + name);
    refreshPanel('remote');
  } catch (e) { setStatus('Error subida: ' + e.message); }
}
async function doDownload(remotePath, name) {
  const localPath = joinPath('local', S.paths.local, name);
  setStatus('Bajando ' + name + '...');
  try {
    await api('POST', '/api/transfer/download', { remotePath, localPath });
    setStatus('Bajado: ' + name);
    refreshPanel('local');
  } catch (e) { setStatus('Error bajada: ' + e.message); }
}

async function doDelete(side, path, isDir, name) {
  if (!confirm('¿Borrar "' + name + '"' + (isDir ? ' (carpeta y contenido)' : '') + '?')) return;
  try {
    if (side === 'local') await api('POST', '/api/local/delete', { path, isDir });
    else await api('POST', '/api/remote/delete', { path, isDir });
    setStatus('Borrado: ' + name);
    refreshPanel(side);
  } catch (e) { setStatus('Error borrado: ' + e.message); }
}

// ================= EDITOR =================
async function openEditor(side, path, name) {
  setStatus('Abriendo ' + name + '...');
  try {
    let data;
    if (side === 'local') data = await api('GET', '/api/local/read?path=' + encodeURIComponent(path));
    else data = await api('GET', '/api/remote/read?path=' + encodeURIComponent(path));
    S.editor = { side, path };
    $('#editorTitle').textContent = (side === 'local' ? 'Local: ' : 'Remoto: ') + path;
    $('#editorArea').value = data.content;
    $('#editorOverlay').classList.remove('hidden');
    setStatus('Editando ' + name);
  } catch (e) { setStatus('Error abrir: ' + e.message); }
}
$('#editorClose').onclick = () => $('#editorOverlay').classList.add('hidden');
$('#editorSave').onclick = async () => {
  const { side, path } = S.editor;
  const content = $('#editorArea').value;
  setStatus('Guardando...');
  try {
    if (side === 'local') await api('POST', '/api/local/write', { path, content });
    else await api('POST', '/api/remote/write', { path, content });
    setStatus('Guardado: ' + path);
    $('#editorOverlay').classList.add('hidden');
  } catch (e) { setStatus('Error guardar: ' + e.message); }
};
$('#editorArea').addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); $('#editorSave').click(); }
  if (e.key === 'Tab') { // Tab inserta tab, no cambia foco
    e.preventDefault();
    const t = e.target, s = t.selectionStart, en = t.selectionEnd;
    t.value = t.value.slice(0, s) + '\t' + t.value.slice(en);
    t.selectionStart = t.selectionEnd = s + 1;
  }
});

// ================= SINCRONIZAR =================
const SY = {
  path: '',
  selected: new Map(), // abs -> {localPath, isDir, name}
  jobId: null,
  poll: null,
};

$('#syncBtn').onclick = async () => {
  // rellena perfiles
  const sel = $('#sync_profile');
  sel.innerHTML = '';
  (window._profiles || []).forEach((p) => {
    const o = document.createElement('option');
    o.value = p.name; o.textContent = p.name + ' (' + p.user + '@' + p.host + ')';
    sel.appendChild(o);
  });
  if (!SY.path) {
    const st = await api('GET', '/api/status');
    SY.path = st.home;
  }
  syncFillDestFromProfile();
  await loadSyncPresets();
  await syncBrowse(SY.path);
  renderSyncSelected();
  $('#syncOverlay').classList.remove('hidden');
};

// Pre-rellena destino con la ruta remota por defecto del perfil elegido.
// Vacío => el server sube al landing dir de la conexión.
function syncFillDestFromProfile() {
  const name = $('#sync_profile').value;
  const p = (window._profiles || []).find((x) => x.name === name);
  $('#sync_dest').value = p?.remotePath || '';
}
$('#sync_profile').addEventListener('change', syncFillDestFromProfile);
$('#syncClose').onclick = () => {
  $('#syncOverlay').classList.add('hidden');
  if (SY.poll) { clearInterval(SY.poll); SY.poll = null; }
};

async function syncBrowse(dir) {
  try {
    const data = await api('GET', '/api/local/list?path=' + encodeURIComponent(dir));
    SY.path = data.path;
    $('#sync_localPath').value = data.path;
    renderSyncList(data.items);
  } catch (e) {
    $('#sync_localList').innerHTML = '<div class="row"><span class="name" style="color:#ff8080">' + e.message + '</span></div>';
  }
}

function renderSyncList(items) {
  const listEl = $('#sync_localList');
  listEl.innerHTML = '';
  // ".."
  const up = document.createElement('div');
  up.className = 'row';
  up.innerHTML = '<span class="chk"></span><span class="icon">⬆️</span><span class="name">..</span>';
  up.onclick = () => syncBrowse(parentPath('local', SY.path));
  listEl.appendChild(up);

  items.sort((a, b) => {
    if ((a.type === 'd') !== (b.type === 'd')) return a.type === 'd' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  items.forEach((it) => {
    const isDir = it.type === 'd';
    const abs = joinPath('local', SY.path, it.name);
    const div = document.createElement('div');
    div.className = 'row';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'chk';
    chk.checked = SY.selected.has(abs);
    chk.onclick = (e) => e.stopPropagation();
    chk.onchange = () => {
      if (chk.checked) SY.selected.set(abs, { localPath: abs, isDir, name: it.name });
      else SY.selected.delete(abs);
      renderSyncSelected();
    };
    div.appendChild(chk);

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = isDir ? '📁' : '📄';
    div.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = it.name;
    div.appendChild(name);

    const size = document.createElement('span');
    size.className = 'size';
    size.textContent = isDir ? '' : fmtSize(it.size);
    div.appendChild(size);

    // click en fila: navegar si es dir; si archivo, alterna checkbox
    div.onclick = () => {
      if (isDir) syncBrowse(abs);
      else { chk.checked = !chk.checked; chk.onchange(); }
    };
    listEl.appendChild(div);
  });
}

function renderSyncSelected() {
  $('#sync_selCount').textContent = SY.selected.size;
  const el = $('#sync_selList');
  el.innerHTML = '';
  SY.selected.forEach((v, abs) => {
    const d = document.createElement('div');
    d.className = 'sel-item';
    const ic = document.createElement('span');
    ic.textContent = v.isDir ? '📁' : '📄';
    const n = document.createElement('span');
    n.className = 'name'; n.textContent = v.localPath; n.title = v.localPath;
    const rm = document.createElement('span');
    rm.className = 'rm'; rm.textContent = '✕';
    rm.onclick = () => { SY.selected.delete(abs); renderSyncSelected(); syncBrowse(SY.path); };
    d.appendChild(ic); d.appendChild(n); d.appendChild(rm);
    el.appendChild(d);
  });
}

$('#sync_localRefresh').onclick = () => syncBrowse(SY.path);
$('#sync_localPath').addEventListener('keydown', (e) => { if (e.key === 'Enter') syncBrowse($('#sync_localPath').value); });
$('#sync_selClear').onclick = () => { SY.selected.clear(); renderSyncSelected(); syncBrowse(SY.path); };

// --- Iniciar / cancelar ---
$('#sync_start').onclick = async () => {
  const profileName = $('#sync_profile').value;
  const remoteDest = $('#sync_dest').value.trim();
  const items = [...SY.selected.values()].map((v) => ({ localPath: v.localPath, isDir: v.isDir }));
  if (!profileName) return setSyncText('Elige un perfil.');
  // remoteDest vacío es válido: el server sube al landing dir de la conexión.
  if (items.length === 0) return setSyncText('Marca al menos un archivo/carpeta.');
  try {
    const r = await api('POST', '/api/sync/start', { profileName, items, remoteDest });
    SY.jobId = r.jobId;
    $('#sync_progress').classList.remove('hidden');
    $('#sync_start').disabled = true;
    $('#sync_cancel').disabled = false;
    $('#sync_log').textContent = '';
    startSyncPoll();
  } catch (e) { setSyncText('Error: ' + e.message); }
};

$('#sync_cancel').onclick = async () => {
  if (SY.jobId) await api('POST', '/api/sync/cancel/' + SY.jobId);
};

function startSyncPoll() {
  if (SY.poll) clearInterval(SY.poll);
  SY.poll = setInterval(async () => {
    if (!SY.jobId) return;
    try {
      const j = await api('GET', '/api/sync/status/' + SY.jobId);
      const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
      $('#sync_bar').style.width = pct + '%';
      setSyncText(`${j.status} — ${j.done}/${j.total} subidos, ${j.failed} fallos` + (j.current ? ' — ' + j.current : ''));
      if (j.log && j.log.length) $('#sync_log').textContent = j.log.join('\n');
      if (j.status !== 'running') {
        clearInterval(SY.poll); SY.poll = null;
        $('#sync_start').disabled = false;
        $('#sync_cancel').disabled = true;
        setStatus('Sync ' + j.status + ': ' + j.done + '/' + j.total);
      }
    } catch (e) {
      clearInterval(SY.poll); SY.poll = null;
      setSyncText('Error polling: ' + e.message);
      $('#sync_start').disabled = false; $('#sync_cancel').disabled = true;
    }
  }, 700);
}
function setSyncText(t) { $('#sync_progressText').textContent = t; $('#sync_progress').classList.remove('hidden'); }

// --- Presets ---
async function loadSyncPresets() {
  const list = await api('GET', '/api/sync/presets');
  const sel = $('#sync_presetSelect');
  sel.innerHTML = '<option value="">— cargar preset —</option>';
  list.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.name; o.textContent = p.name;
    sel.appendChild(o);
  });
  window._syncPresets = list;
}
$('#sync_presetSelect').onchange = () => {
  const name = $('#sync_presetSelect').value;
  const p = (window._syncPresets || []).find((x) => x.name === name);
  if (!p) return;
  if (p.profileName) $('#sync_profile').value = p.profileName;
  $('#sync_dest').value = p.remoteDest || '';
  SY.selected.clear();
  (p.items || []).forEach((it) => {
    const nm = it.localPath.split(/[\\/]/).pop();
    SY.selected.set(it.localPath, { localPath: it.localPath, isDir: it.isDir, name: nm });
  });
  renderSyncSelected();
  // Navega el browser a la carpeta padre del primer item para que la
  // selección se vea marcada, aunque estuvieras en otro path.
  const first = (p.items || [])[0];
  if (first) SY.path = parentPath('local', first.localPath);
  syncBrowse(SY.path);
};
$('#sync_presetSave').onclick = async () => {
  const name = prompt('Nombre del preset:');
  if (!name) return;
  const items = [...SY.selected.values()].map((v) => ({ localPath: v.localPath, isDir: v.isDir }));
  await api('POST', '/api/sync/presets', {
    name, profileName: $('#sync_profile').value, remoteDest: $('#sync_dest').value.trim(), items,
  });
  await loadSyncPresets();
  $('#sync_presetSelect').value = name;
  setStatus('Preset guardado: ' + name);
};
$('#sync_presetDel').onclick = async () => {
  const name = $('#sync_presetSelect').value;
  if (!name || !confirm('¿Borrar preset "' + name + '"?')) return;
  await api('DELETE', '/api/sync/presets/' + encodeURIComponent(name));
  await loadSyncPresets();
};

// ================= INIT =================
refreshStatus();
