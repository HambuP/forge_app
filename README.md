# FORGE

Habit tracker basado en identidad. PWA instalable en Android / iOS sin tienda
de apps, con persistencia offline en IndexedDB.

> "no buscas correr 5km. te conviertes en la persona que sale a correr 5km."

---

## Cómo correrlo localmente

No tiene build step — los `.jsx` se compilan en el navegador con Babel
standalone. Solo necesitas servirlo con cualquier servidor HTTP estático.

```bash
cd forge
python3 -m http.server 8000
# o:  npx serve .
# o:  npx http-server -p 8000
```

Abre http://localhost:8000

El service worker solo se registra sobre HTTPS o localhost. Para probar la
instalación real (con prompt nativo) necesitas deployear.

---

## Deploy a Vercel (gratis, HTTPS automático)

### Paso 1 — Crear cuenta de Vercel
1. Ve a https://vercel.com/signup
2. Click en **Continue with GitHub** (si ya tienes GitHub, login; si no,
   crea cuenta en https://github.com primero — tarda 1 minuto)
3. Acepta los permisos. Eso es todo.

### Paso 2 — Subir el código (dos opciones)

#### Opción A: Drag-and-drop (más rápida, no necesitas git)
1. En Vercel dashboard → **Add New...** → **Project**
2. Scroll hasta **Deploy a template** o busca **Import** → en el panel
   de browse, hay una opción de "deploy from local" o **arrastra la carpeta
   `forge` directamente** al área "Drop your folder here"
3. Vercel detecta que es estático, deja todo en defaults, click **Deploy**
4. En ~30 segundos tienes URL: `https://forge-xxx.vercel.app`

> Si no ves la opción de drop, usa la opción B (más confiable).

#### Opción B: Vía GitHub (recomendada — push = deploy automático)
1. En github.com → **New repository** → nombre `forge` → **Private**
   (o public, da igual) → **Create**
2. En tu compu, dentro de la carpeta `forge`:
   ```bash
   git init
   git add .
   git commit -m "forge inicial"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario>/forge.git
   git push -u origin main
   ```
3. En Vercel → **Add New...** → **Project** → selecciona el repo `forge`
   → todos los defaults → **Deploy**
4. URL lista en ~30s. Cada `git push` redeploya automáticamente.

### Paso 3 (opcional) — Conectar tu subdominio `hambup.me`
1. En Vercel → tu proyecto → **Settings** → **Domains** → **Add**
2. Escribe `forge.hambup.me` (o como quieras)
3. Vercel te dice qué CNAME agregar
4. En Namecheap → Domain List → `hambup.me` → **Manage** → **Advanced DNS**
5. Add new record: **CNAME** | host: `forge` | value: `cname.vercel-dns.com`
   | TTL: Automatic
6. Espera 1-5 minutos. Listo.

---

## Cómo instalarlo en tu Galaxy S25

1. Abre la URL de Vercel (`https://forge-xxx.vercel.app`) en **Chrome**
2. Verás un banner adentro de FORGE que dice *"instalar forge en tu inicio"*
   — tócalo y acepta el prompt nativo
3. (Alternativa) Tres puntitos de Chrome → **Instalar app** o
   **Añadir a pantalla de inicio**
4. Aparece en tu app drawer como cualquier app nativa. Se abre en pantalla
   completa, funciona offline.

En iOS Safari el flujo es: compartir → **Añadir a inicio**. iOS no muestra
prompt automático.

---

## Estructura del proyecto

```
forge/
├── index.html              -- shell PWA (carga React/Dexie de CDN)
├── db.js                   -- IndexedDB schema + seed inicial
├── logic.js                -- clasificación de día, rachas, stats
├── components.jsx          -- UI components (de Claude Design)
├── app.jsx                 -- main app, navegación, screens nuevos
├── sw.js                   -- service worker (offline)
├── manifest.webmanifest    -- PWA manifest
├── vercel.json             -- config de routing/headers
└── icons/                  -- íconos para PWA
    ├── icon.svg
    ├── icon-192.png
    ├── icon-512.png
    └── icon-maskable-512.png
```

---

## Qué funciona en esta v0

- **Vista lista + burbujas** con tu lenguaje visual original
- **Persistencia** real en IndexedDB (los datos sobreviven recarga/cierre)
- **Rollover a las 3am** configurable
- **Clasificación del día**: perfecto / bueno / regular / neutro
- **Racha global** consecutiva de días perfectos+buenos
- **Crear hábito** con wizard, identidades nuevas, rutinas nuevas
- **Detalle de hábito** con racha real, heatmap real, calendario, tendencia
- **Estadísticas globales** (nuevo screen): racha, distribución 90d, completación 12 sem
- **Identidades** (nuevo screen): fidelidad % a cada identidad en los últimos 7 días
- **Mood prompt** después de las 20:00 (configurable)
- **Ajustes**: hora de rollover, hora de mood, exportar JSON, borrar todo
- **PWA real**: instalable, offline, ícono propio
- **Seed inicial**: tus 3 identidades + 7 hábitos + 13 días de logs realistas

## Qué viene después (v0.2+)

- Notificaciones push (recordatorios)
- Freezes de racha (3/7/14/30 días → +1 freeze)
- Onboarding para usuarios nuevos
- Sync entre dispositivos
- Edición de hábitos existentes

---

## Stack

- **React 18** vía CDN UMD (sin build)
- **Babel standalone** compila JSX en el navegador en el primer load
- **Dexie 4** envuelve IndexedDB
- **Inter** de Google Fonts (300/400/500/600/700)
- Sin dependencias de Node, sin bundler, sin pipeline. Es una PWA estática
  que se puede servir desde cualquier CDN

El trade-off: ~1.5s más en el primer load porque Babel compila los `.jsx`
en el cliente. Para v0.2 esto se migra a Vite y deja de ser cuestión.

---

FORGE v0.1 — construido en una tarde.
