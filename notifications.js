// ─────────────────────────────────────────────────────────────
// FORGE — Native notifications bridge (Capacitor only).
// ─────────────────────────────────────────────────────────────
// Exposes window.ForgeNotifications:
//   available        — true only inside the native app
//   ensurePermission — asks for POST_NOTIFICATIONS, returns boolean
//   resync           — cancels + re-schedules from settings
//
// Scheduling is deliberately INEXACT: the app never requests
// SCHEDULE_EXACT_ALARM, so Android delivers via setAndAllowWhileIdle
// (± a few minutes). For habit reminders that's plenty, and it avoids
// the exact-alarm permission flow plus the "user revokes it and all
// alarms are wiped" failure mode entirely.
//
// resync() runs on every launch, which makes the schedule self-healing:
// device reboots are covered by the plugin's boot receiver, and anything
// that slips through (app update, One UI clearing alarms) gets repaired
// the next time FORGE opens.
(function () {
  const IS_NATIVE = !!(
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform()
  );

  if (!IS_NATIVE) {
    // Web: inert stub so callers never need to feature-detect beyond `available`.
    window.ForgeNotifications = {
      available: false,
      ensurePermission: async () => false,
      resync: async () => {},
    };
    return;
  }

  const LN = window.Capacitor.Plugins.LocalNotifications;

  const CHANNEL_ID = 'recordatorios';
  const ID_HABITS = 1001;
  const ID_MOOD = 1002;

  async function getSetting(key, fallback) {
    const s = await db.settings.get(key);
    return s ? s.value : fallback;
  }

  async function ensureChannel() {
    await LN.createChannel({
      id: CHANNEL_ID,
      name: 'Recordatorios',
      description: 'Recordatorios diarios de hábitos y ánimo',
      importance: 4, // heads-up banner; the user can tune it per-channel in Android settings
      visibility: 1,
    });
  }

  async function hasPermission() {
    const st = await LN.checkPermissions();
    return st.display === 'granted';
  }

  async function ensurePermission() {
    if (await hasPermission()) return true;
    const req = await LN.requestPermissions();
    return req.display === 'granted';
  }

  async function resync() {
    try {
      const pending = await LN.getPending();
      const ours = (pending.notifications || []).filter(
        (n) => n.id === ID_HABITS || n.id === ID_MOOD
      );
      if (ours.length) {
        await LN.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
      }

      // Never prompt from here — resync only schedules what's already allowed.
      if (!(await hasPermission())) return;

      const toSchedule = [];

      if (await getSetting('notifHabitsEnabled', false)) {
        const hour = await getSetting('notifHabitsHour', 9);
        toSchedule.push({
          id: ID_HABITS,
          channelId: CHANNEL_ID,
          title: 'tus hábitos te esperan',
          body: 'un pequeño paso hoy. la identidad se forja a diario.',
          schedule: { on: { hour, minute: 0 }, allowWhileIdle: true },
        });
      }

      if (await getSetting('notifMoodEnabled', false)) {
        const hour = await getSetting('moodPromptHour', 20);
        toSchedule.push({
          id: ID_MOOD,
          channelId: CHANNEL_ID,
          title: '¿cómo estuvo tu día?',
          body: 'registra tu ánimo antes de cerrar el día.',
          schedule: { on: { hour, minute: 0 }, allowWhileIdle: true },
        });
      }

      if (toSchedule.length) {
        await LN.schedule({ notifications: toSchedule });
      }
    } catch (e) {
      console.warn('ForgeNotifications: resync failed', e);
    }
  }

  window.ForgeNotifications = { available: true, ensurePermission, resync };

  window.addEventListener('load', () => {
    ensureChannel().then(resync).catch((e) => {
      console.warn('ForgeNotifications: init failed', e);
    });
  });
})();
