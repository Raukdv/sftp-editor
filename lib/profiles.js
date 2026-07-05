'use strict';
// CRUD de perfiles de conexión. Cada perfil = un JSON en /profiles.
// Los JSON NO contienen secretos (password/passphrase). Esos van cifrados aparte.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'profiles');

function ensureDir() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

// Evita path traversal: solo letras, números, guion, guion bajo y punto.
function safeName(name) {
  const clean = String(name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!clean || clean === '.' || clean === '..') {
    throw new Error('Nombre de perfil inválido');
  }
  return clean;
}

function fileFor(name) {
  return path.join(DIR, safeName(name) + '.json');
}

function list() {
  ensureDir();
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
}

function get(name) {
  const p = fileFor(name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function save(profile) {
  ensureDir();
  const p = fileFor(profile.name);
  fs.writeFileSync(p, JSON.stringify(profile, null, 2));
}

function remove(name) {
  const p = fileFor(name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { list, get, save, remove, safeName };
