'use strict';
// Wrapper de conexión SFTP. Soporta:
//  - Conexión directa (host destino).
//  - Salto por bastión (jump host) usando forwardOut de ssh2.
//  - Auth por contraseña o por clave privada (con passphrase opcional).

const fs = require('fs');
const SftpClient = require('ssh2-sftp-client');
const { Client } = require('ssh2');

// Construye las opciones de auth de ssh2 para un nodo (destino o salto).
function authOpts(node, password, passphrase) {
  const o = {
    host: node.host,
    port: node.port || 22,
    username: node.user,
    readyTimeout: 20000,
    keepaliveInterval: 15000,
  };
  if (node.authType === 'key') {
    o.privateKey = fs.readFileSync(node.keyPath); // clave PRIVADA (id_rsa)
    if (passphrase) o.passphrase = passphrase;
  } else {
    o.password = password;
  }
  return o;
}

// Abre conexión al bastión y hace forwardOut hacia el destino.
// Devuelve { stream, jumpConn } para poder cerrar el jump luego.
function jumpForward(profile, secret) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const jOpts = authOpts(profile.jump, secret.jumpPassword, secret.jumpPassphrase);
    conn.on('ready', () => {
      conn.forwardOut('127.0.0.1', 0, profile.host, profile.port || 22, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        resolve({ stream, jumpConn: conn });
      });
    });
    conn.on('error', reject);
    conn.connect(jOpts);
  });
}

// Conecta y devuelve { sftp, close }.
// close() cierra tanto el SFTP como el jump (si lo hubo).
async function connect(profile, secret) {
  const sftp = new SftpClient();
  const targetOpts = authOpts(profile, secret.password, secret.passphrase);
  let jumpConn = null;

  if (profile.jump && profile.jump.host) {
    const fwd = await jumpForward(profile, secret);
    targetOpts.sock = fwd.stream; // ssh2 usa el socket tunelizado
    jumpConn = fwd.jumpConn;
  }

  await sftp.connect(targetOpts);

  const close = async () => {
    try { await sftp.end(); } catch (_) { /* noop */ }
    if (jumpConn) {
      try { jumpConn.end(); } catch (_) { /* noop */ }
    }
  };

  return { sftp, close };
}

module.exports = { connect };
