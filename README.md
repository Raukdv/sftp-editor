# SFTP Editor

Cliente **SFTP local con interfaz web**. Estilo WinSCP/PuTTY pero más simple: dos paneles (local ↔ remoto), editor de texto integrado y **despliegues** (subidas) asíncronos con presets reutilizables.

Todo corre en tu máquina. El servidor escucha **solo en `127.0.0.1`** — nunca se expone a la red.

---

## Inicio rápido

Requisitos: **Node.js** y **pnpm**.

```bash
pnpm install
pnpm start
```

Abre **http://127.0.0.1:4599** en el navegador.

- Cambiar puerto: `PORT=5000 pnpm start`
- La **primera vez** defines una contraseña maestra (cifra tus secretos). Guárdala bien: no se puede recuperar.

---

## Funciones principales

- 🔐 **Secretos cifrados** — contraseñas y passphrases con AES-256-GCM. La maestra solo vive en RAM.
- 🗂️ **Dos paneles** — explora local y remoto lado a lado. Subir (→), bajar (←), borrar, crear carpetas.
- ✏️ **Editor de texto** — abre, edita y guarda archivos remotos o locales (Ctrl+S).
- 🚀 **Despliegues** — sube carpetas/archivos seleccionados a un servidor, en segundo plano, con presets reutilizables.
- 🔀 **Salto / bastión** — conexión directa o a través de un jump host.
- 🔑 **Auth por contraseña o clave SSH** — usa tu `id_rsa` privado (OpenSSH de Windows).

---

## Cosas importantes a saber

- **Clave SSH = privada.** Se usa `id_rsa` (privada), **no** `id_rsa.pub`. Ejemplo de ruta: `C:\Users\usuario\.ssh\id_rsa`.
- **Ruta remota por defecto** (en el perfil): vacío = abre donde caiga la conexión (*landing dir*); con valor = abre ahí. Igual para el destino de despliegues.
- **Editor solo texto.** Abrir/guardar binarios los corrompe — para binarios usa las flechas → ←.
- **Despliegue sobrescribe siempre.** No compara si el archivo ya existe igual (subida completa cada vez).
- **Bloquea al alejarte.** El botón **Bloquear** borra la maestra de memoria.
- **Sin verificación de host key** — aceptaría cualquier fingerprint. Riesgo de MITM en redes no confiables.

---

## Datos generados (no se versionan)

| Archivo | Contenido |
|---------|-----------|
| `secrets.enc` | Contraseñas/passphrases cifradas (AES-256-GCM) |
| `profiles/*.json` | Perfiles de conexión (sin secretos) |
| `syncs.json` | Presets de despliegue |

Los tres están en `.gitignore`.

---

## Documentación completa

Guía detallada con todas las funciones, referencia de la API y arquitectura:
**[guiade/GUIA.md](guiade/GUIA.md)**

---

## Stack

- **express** — servidor local
- **ssh2** + **ssh2-sftp-client** — motor SFTP y salto/bastión
- **crypto** (nativo de Node) — cifrado, sin dependencias ni compilación nativa

## Licencia

Ver [LICENSE](LICENSE).
