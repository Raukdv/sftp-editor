# Guía de SFTP Editor

Cliente SFTP local con interfaz web. Estilo WinSCP/PuTTY pero más simple: dos paneles (local ↔ remoto), editor de texto integrado y despliegues (subidas) asíncronos con presets reutilizables.

Todo corre en tu máquina. El servidor escucha **solo en `127.0.0.1`** (nunca se expone a la red).

---

## Índice

1. [Arranque](#1-arranque)
2. [Contraseña maestra y cifrado](#2-contraseña-maestra-y-cifrado)
3. [Perfiles de conexión](#3-perfiles-de-conexión)
4. [Los dos paneles (local y remoto)](#4-los-dos-paneles-local-y-remoto)
5. [Editor de texto](#5-editor-de-texto)
6. [Despliegues (subida asíncrona)](#6-despliegues-subida-asíncrona)
7. [Dónde se guardan los datos](#7-dónde-se-guardan-los-datos)
8. [Seguridad](#8-seguridad)
9. [Referencia de la API](#9-referencia-de-la-api)
10. [Arquitectura de archivos](#10-arquitectura-de-archivos)
11. [Limitaciones y mejoras futuras](#11-limitaciones-y-mejoras-futuras)

---

## 1. Arranque

Requisitos: Node.js y pnpm.

```bash
pnpm install
pnpm start
```

El servidor arranca en `http://127.0.0.1:4599`. Abre esa URL en el navegador.

Para cambiar el puerto: `PORT=5000 pnpm start`.

---

## 2. Contraseña maestra y cifrado

La primera vez que abres la app defines una **contraseña maestra**. Con ella se cifran todos los secretos (contraseñas SSH y passphrases de claves).

- **Primera vez:** escribes una maestra nueva → se crea `secrets.enc` cifrado.
- **Siguientes veces:** introduces la maestra → si es correcta, desbloquea; si no, rechaza.

La maestra **no se guarda en ningún sitio**. Vive solo en la memoria del servidor mientras la sesión está abierta. Si cierras el servidor o pulsas **Bloquear**, se borra de memoria y hay que volver a introducirla.

Cifrado usado: **AES-256-GCM**, con clave derivada de la maestra mediante **scrypt**. GCM añade verificación de integridad (detecta si el archivo fue manipulado). Sin la maestra correcta, `secrets.enc` es ilegible.

> Botón **Bloquear** (arriba a la derecha): cierra conexión activa, borra la maestra de memoria y recarga.

---

## 3. Perfiles de conexión

Un perfil guarda los datos de un servidor SFTP. Los perfiles se guardan en `profiles/*.json` **sin secretos** (las contraseñas van cifradas aparte en `secrets.enc`).

### Crear / editar un perfil

Botón **+ Perfil** (nuevo) o **Editar perfil** (el seleccionado). Campos:

| Campo | Descripción |
|-------|-------------|
| **Nombre** | Identificador del perfil (no se puede cambiar al editar). |
| **Host** | IP o dominio del servidor. |
| **Puerto** | Por defecto 22. |
| **Usuario** | Usuario SSH. |
| **Auth** | Contraseña o Clave SSH. |
| **Contraseña** | (Si auth = contraseña). |
| **Ruta clave privada** | (Si auth = clave) ruta al archivo `id_rsa` **privado**, ej. `C:\Users\usuario\.ssh\id_rsa`. |
| **Passphrase** | (Si la clave privada tiene passphrase). Opcional. |
| **Ruta remota por defecto** | Opcional. Carpeta remota donde abrir al conectar. Vacío = donde caiga la conexión (*landing dir*). |

> **Importante sobre claves SSH:** se usa la clave **privada** (`id_rsa`), no la pública (`id_rsa.pub`). La pública solo se sube al servidor; el cliente autentica con la privada.

### Autenticación: contraseña vs clave

- **Contraseña:** el usuario y su contraseña.
- **Clave SSH:** la app lee tu `id_rsa` privado. Si tiene passphrase, la introduces y se guarda cifrada. Más seguro que contraseña.

### Conexión por salto (bastión / jump host)

Si el servidor destino no es accesible directamente sino a través de un bastión, marca **"Conectar por salto (bastión)"** y rellena los datos del jump (host, puerto, usuario, auth). La app abre primero un túnel SSH al bastión y desde ahí llega al destino (`forwardOut`).

Si no marcas salto → **conexión directa** (lo normal).

### Borrar perfil

Botón **Borrar perfil** elimina el JSON y su secreto cifrado.

---

## 4. Los dos paneles (local y remoto)

La pantalla principal muestra dos paneles tipo explorador:

- **Izquierda — Local:** los archivos de tu PC. Arranca en tu carpeta de usuario.
- **Derecha — Remoto:** los archivos del servidor SFTP. Se activa al **Conectar**.

### Conectar

1. Elige un perfil en el desplegable de arriba.
2. Pulsa **Conectar**.
3. El panel remoto se llena. Abre en la *ruta remota por defecto* del perfil, o en el *landing dir* si no hay ninguna.

Estado de conexión visible arriba (verde = conectado). **Desconectar** cierra la sesión SFTP.

### Navegar

- Clic en una **carpeta** → entra.
- Fila **`..`** → sube al directorio padre.
- **Barra de ruta**: escribe una ruta y pulsa Enter para saltar ahí.
- Botón **⟳** → refresca.
- Botón **📁+** → crea carpeta nueva.

### Acciones por archivo (aparecen al pasar el ratón)

| Botón | Acción |
|-------|--------|
| ✏️ | Editar el archivo (abre el editor). |
| → | (Local) Subir el archivo al remoto (a la carpeta remota actual). |
| ← | (Remoto) Bajar el archivo al local (a la carpeta local actual). |
| 🗑️ | Borrar (con confirmación). |

Doble clic sobre un archivo también lo abre en el editor.

---

## 5. Editor de texto

Abrir un archivo (✏️ o doble clic) muestra un editor a pantalla casi completa.

- Edita el contenido.
- **Guardar** (o **Ctrl+S**) sobrescribe el archivo en su origen (local o remoto).
- **Tab** inserta tabulación (no cambia de foco).
- **Cerrar** descarta y cierra.

> Solo para archivos de **texto**. Abrir/guardar binarios (imágenes, zips, ejecutables) los corrompe. Para binarios usa las flechas → ←.

---

## 6. Despliegues (subida asíncrona)

Botón **🚀 Despliegues**. Es un gestor de subidas: eliges qué carpetas/archivos locales mandar a un servidor, y opcionalmente guardas esa configuración como **preset** reutilizable.

### Configurar y lanzar

1. **Perfil destino:** a qué servidor subir.
2. **Ruta remota destino:** carpeta remota donde dejar los archivos. Vacío = *landing dir* de la conexión. Si el perfil tiene *ruta remota por defecto*, se pre-rellena.
3. **Navegador local (izquierda):** navega y **marca con checkbox** las carpetas y/o archivos a subir. Los seleccionados aparecen a la derecha en **"Seleccionados"**.
4. **▶ Iniciar despliegue.**

Durante la subida se ve una **barra de progreso**, contador `subidos / total / fallos`, el archivo actual y un log de errores. Botón **■ Cancelar** para abortar.

### Cómo funciona

- La subida corre en **segundo plano**, con su **propia conexión** — no interrumpe el navegado de los dos paneles.
- Las carpetas suben de forma **recursiva**; se crean las carpetas remotas necesarias automáticamente.
- Usa hasta **3 conexiones en paralelo** para acelerar sin sobrecargar el servidor.
- Un archivo que falla **no aborta** el resto: se anota en el log y sigue con los demás.
- **Siempre sobrescribe** los archivos existentes en el remoto (no compara si ya son iguales).

### Presets

- **💾** guarda la configuración actual (perfil + destino + selección) con un nombre.
- El desplegable **Preset** carga uno guardado: rellena todo y navega el explorador a la carpeta de la selección para que se vea marcada.
- **🗑️** borra el preset seleccionado.

Los presets se guardan en `syncs.json` (sin secretos).

---

## 7. Dónde se guardan los datos

| Archivo/carpeta | Contenido | ¿Secreto? |
|-----------------|-----------|-----------|
| `profiles/*.json` | Datos de cada perfil (host, usuario, etc.) | No |
| `secrets.enc` | Contraseñas y passphrases cifradas (AES-256-GCM) | Sí (cifrado) |
| `syncs.json` | Presets de despliegue | No |

Los tres están en `.gitignore` (no se suben al repositorio).

---

## 8. Seguridad

- El servidor escucha **solo en `127.0.0.1`**: no accesible desde otras máquinas de la red.
- Secretos cifrados con **AES-256-GCM** + **scrypt**. La maestra solo vive en RAM.
- Protección contra *path traversal* en los nombres de perfil.

**Advertencias:**
- La app **no verifica la huella (host key)** del servidor: aceptaría cualquier fingerprint. Riesgo de MITM en redes hostiles.
- Cualquiera con acceso a tu sesión de navegador mientras está desbloqueada puede operar. Pulsa **Bloquear** al alejarte.
- `secrets.enc` es tan fuerte como tu contraseña maestra: usa una robusta.

---

## 9. Referencia de la API

Todas bajo `http://127.0.0.1:4599`. Requieren estar desbloqueado salvo `/api/status` y `/api/unlock`.

### Sesión
- `GET  /api/status` — estado (bloqueado, conectado, home).
- `POST /api/unlock` `{ master }` — desbloquea o inicializa.
- `POST /api/lock` — bloquea y borra la maestra.

### Perfiles
- `GET    /api/profiles` — lista (sin secretos).
- `POST   /api/profiles` — crea/actualiza perfil + secretos.
- `DELETE /api/profiles/:name` — borra.

### Conexión
- `POST /api/connect` `{ name }` — abre SFTP; devuelve `landingPath` y `remotePath`.
- `POST /api/disconnect` — cierra.

### Panel remoto (SFTP)
- `GET  /api/remote/list?path=` — lista directorio.
- `GET  /api/remote/read?path=` — lee archivo (texto).
- `POST /api/remote/write` `{ path, content }` — escribe.
- `POST /api/remote/delete` `{ path, isDir }` — borra.
- `POST /api/remote/mkdir` `{ path }` — crea carpeta.
- `POST /api/remote/rename` `{ from, to }` — renombra.

### Panel local (FS)
- `GET  /api/local/list?path=` · `GET /api/local/read?path=`
- `POST /api/local/write` · `/api/local/delete` · `/api/local/mkdir`

### Transferencias
- `POST /api/transfer/upload` `{ localPath, remotePath }` — sube un archivo.
- `POST /api/transfer/download` `{ remotePath, localPath }` — baja un archivo.

### Despliegues (jobs asíncronos)
- `POST /api/sync/start` `{ profileName, items, remoteDest }` — lanza job; devuelve `jobId`.
- `GET  /api/sync/status/:id` — progreso del job.
- `GET  /api/sync/jobs` — lista de jobs.
- `POST /api/sync/cancel/:id` — cancela.
- `GET/POST/DELETE /api/sync/presets[/:name]` — CRUD de presets.

---

## 10. Arquitectura de archivos

```
sfpt-editor/
  server.js            Servidor Express + estado en memoria + rutas API
  lib/
    crypto.js          Cifrado AES-256-GCM de secretos (scrypt + GCM)
    profiles.js        CRUD de perfiles (JSON, anti path-traversal)
    sftp.js            Conexión SFTP (ssh2) + soporte de salto/bastión
    sync.js            Motor de despliegues async (pool de 3 + presets)
  public/
    index.html         UI: 2 paneles, editor, modales perfil y despliegues
    app.js             Lógica de frontend (vanilla JS)
    style.css          Estilos
  profiles/            Perfiles guardados (generado)
  secrets.enc          Secretos cifrados (generado)
  syncs.json           Presets de despliegue (generado)
```

**Dependencias:** `express` (servidor), `ssh2` + `ssh2-sftp-client` (SFTP). El cifrado usa el módulo `crypto` nativo de Node (sin dependencias ni compilación nativa).

---

## 11. Limitaciones y mejoras futuras

- **Despliegue sobrescribe siempre.** No compara `mtime`/`size` para saltar archivos ya iguales. Mejora futura: sync incremental.
- **Editor solo texto.** No hay detección de binario ni aviso de tamaño.
- **Una conexión activa** en los paneles (cambiar de perfil cierra la anterior).
- **Sin verificación de host key** (posible MITM).
- **Sin barra de progreso** en transferencias individuales grandes (sí en despliegues).
