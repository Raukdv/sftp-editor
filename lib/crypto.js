'use strict';
// Almacén de secretos cifrado con AES-256-GCM.
// Clave derivada de una contraseña maestra mediante scrypt.
// La maestra NUNCA se guarda en disco: vive solo en RAM del server.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRETS_FILE = path.join(__dirname, '..', 'secrets.enc');

function deriveKey(master, salt) {
  // scrypt: KDF resistente a fuerza bruta. 32 bytes = clave AES-256.
  return crypto.scryptSync(master, salt, 32);
}

// Cifra el objeto store completo y lo escribe a disco.
function saveStore(master, store) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12); // 96 bits recomendado para GCM
  const key = deriveKey(master, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(store), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const blob = {
    v: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(blob), { mode: 0o600 });
}

// Descifra el store. Lanza si la maestra es incorrecta (GCM authTag falla).
// Si no existe el archivo, devuelve store vacío.
function loadStore(master) {
  if (!fs.existsSync(SECRETS_FILE)) return {};
  const blob = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
  const salt = Buffer.from(blob.salt, 'hex');
  const iv = Buffer.from(blob.iv, 'hex');
  const authTag = Buffer.from(blob.authTag, 'hex');
  const ciphertext = Buffer.from(blob.ciphertext, 'hex');
  const key = deriveKey(master, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8'));
}

function storeExists() {
  return fs.existsSync(SECRETS_FILE);
}

module.exports = { saveStore, loadStore, storeExists, SECRETS_FILE };
