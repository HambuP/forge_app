# FORGE — App Android (Capacitor)

La PWA empaquetada como app nativa Android con [Capacitor 8](https://capacitorjs.com).
No va a Play Store: se instala por sideload en el dispositivo propio.

---

## El ciclo de rebuild (lo que vas a usar el 99% del tiempo)

Cambiaste algo en `app.jsx`, `components.jsx`, `db.js`, `logic.js`,
`notifications.js`, `index.html` o `icons/`:

```bash
npm run android:release
```

Eso hace, en orden:

1. **Staging** — copia los archivos web a `www/` (`scripts/stage-www.mjs`).
2. **Sync** — `npx cap sync android` mete `www/` dentro del proyecto nativo.
3. **Build** — Gradle compila y **firma** el APK con el keystore de release.

El APK queda en:

```
android\app\build\outputs\apk\release\app-release.apk
```

Pásalo al celular (Drive, Quick Share…) e instálalo **encima** de la app
existente. Como la firma es la misma, los datos de IndexedDB se conservan.

Si vas a distribuir una versión "de verdad" (no solo iterar), sube antes
`versionCode` (+1) y `versionName` en `android/app/build.gradle` — Android
nunca permite instalar un `versionCode` menor al instalado.

### Otros comandos

| Comando | Qué hace |
|---|---|
| `npm run stage` | Solo regenera `www/` |
| `npm run sync` | Staging + sync (sin compilar) |
| `npm run android:open` | Staging + sync + abre Android Studio (para correr con cable/depurar) |
| `npm run android:build` | Igual que release pero APK de **debug** (firma de debug — no instala encima del release) |

---

## Firma (LEE ESTO ANTES DE PERDER ALGO)

- **Keystore**: `C:\Users\forer\keystores\forge-release.keystore`
  (alias `forge`, RSA 2048, válido ~30 años). Está **fuera del repo** a propósito.
- **Credenciales**: `android/keystore.properties` — **gitignored**, contiene la
  contraseña en texto plano. Gradle lo lee para firmar automáticamente; si el
  archivo no existe, el build de release sale sin firmar (no falla).
- **Respalda ambos** (keystore + contraseña en tu gestor). Si pierdes
  cualquiera de los dos: no hay más actualizaciones sobre la app instalada —
  toca desinstalar (perdiendo IndexedDB), generar keystore nuevo y reinstalar.
  Exactamente lo que pasó con Bubblewrap. No otra vez.

---

## Cómo está armado

- **No hay bundler ni build web.** Los archivos de la raíz son la app; Babel
  standalone compila los `.jsx` en el navegador/WebView al arrancar.
- **`webDir` es `www/`, nunca la raíz.** Capacitor copia `webDir` completo al
  APK; apuntarlo a la raíz metería `android/`, `.git` y `node_modules` dentro
  del APK. `stage-www.mjs` define la lista exacta de qué entra.
- **Librerías vendorizadas** en `vendor/` (React 18.3.1, ReactDOM, Dexie 4.0.7,
  Babel standalone 7.29.0). Antes venían de unpkg: dentro del WebView eso
  significaba "sin internet no arranca". Para actualizar una lib: descarga la
  nueva versión a `vendor/` y ajusta el comentario en `index.html`.
- **Guards nativos en `index.html`**: el service worker y Vercel Analytics solo
  corren en la web (`if (!window.Capacitor)`). En el WebView el SW solo
  aportaría una capa de caché capaz de servir archivos viejos.
- **JDK**: Capacitor 8 exige JDK 21; el del sistema es 17. `android/gradle.properties`
  apunta `org.gradle.java.home` al JBR 21 que trae Android Studio. Si actualizas
  o mueves Android Studio, revisa esa ruta.

## Edge-to-edge (por qué se ve bien sin ningún plugin)

Android 16 eliminó el opt-out de edge-to-edge — la app debe manejar los insets.
FORGE ya lo hacía sola: `viewport-fit=cover` + `env(safe-area-inset-*)` en el
CSS, y el fondo lo pinta `body` de borde a borde. Capacitor expone los insets
del sistema como esas variables CSS y todo cuadra. El TWA de Bubblewrap no
exponía nada de esto — de ahí venían las franjas negras.

**No agregues** `@capacitor/status-bar` ni plugins de edge-to-edge: no hacen
falta y pueden pisar este comportamiento.

## Notificaciones

- `notifications.js` expone `window.ForgeNotifications` (en web es un stub
  inerte). Canal "Recordatorios"; IDs fijos: 1001 hábitos, 1002 ánimo.
- **Scheduling INEXACTO a propósito**: nunca pedimos `SCHEDULE_EXACT_ALARM`,
  así que el plugin degrada a `setAndAllowWhileIdle` (± minutos de deriva).
  Suficiente para recordatorios, y evita el flujo de permiso especial de
  Android 14+ y el borrado de alarmas si el usuario lo revoca.
- **Autocurativo**: en cada arranque `resync()` cancela y reprograma según la
  tabla `settings` (claves `notifHabitsEnabled`, `notifHabitsHour`,
  `notifMoodEnabled`; la hora del ánimo reusa `moodPromptHour`).
- Ícono de barra de estado: `android/app/src/main/res/drawable/ic_stat_forge.xml`
  (la llama en monocromo), configurado en `capacitor.config.json`.
- **Samsung/One UI duerme apps**: tras instalar (o reinstalar), poner
  Ajustes → Aplicaciones → FORGE → Batería → **"Sin restricciones"**, y revisar
  que no esté en Ajustes → Batería → Límites de uso en segundo plano.

## Datos (IndexedDB)

- Cada instalación tiene su IndexedDB propio. La PWA (Chrome), la app de debug
  y una reinstalación tras desinstalar son **orígenes/almacenes distintos** —
  los datos NO se comparten ni sobreviven a una desinstalación.
- El puente entre mundos es ajustes → **exportar / importar** (JSON).
  Exporta con regularidad: es tu único backup.
- Si "exportar mis datos" algún día no descarga nada dentro de la app nativa
  (usa blob + `a.download`, que algunos WebView ignoran), exporta desde la
  versión web como plan B.

## Gotchas acumulados

1. **`gradlew` a secas no corre en esta máquina** — Windows ya no resuelve
   ejecutables del directorio actual. Siempre `.\gradlew.bat` (los scripts npm
   ya lo hacen así).
2. **Debug y release no se instalan uno encima del otro** (firmas distintas):
   cambiar de uno a otro = desinstalar = perder IndexedDB. Exporta antes.
3. **`capacitor.config.json`, no `.ts`** — la variante TypeScript exigiría
   instalar TypeScript solo para leer la config.
4. **El seed de onboarding** (`db.js#seedIfEmpty`) corre en cualquier
   instalación nueva; importar el JSON lo reemplaza y marca `userResetData`.
5. Los permisos de Android (notificaciones, exclusión de batería) **no
   sobreviven a una desinstalación** — reconfigurarlos tras reinstalar.
