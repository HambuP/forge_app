// ─────────────────────────────────────────────────────────────
// FORGE — Data layer (IndexedDB via Dexie)
// ─────────────────────────────────────────────────────────────
// Stores:
//   identities    — "the person I want to become"
//   habits        — definitions
//   logs          — daily entries (one per habit per day)
//   moodEntries   — daily mood (1 per day)
//   routines      — ordered groupings (visual only)
//   freezes       — earned streak freezes
//   settings      — singleton key/value
// ─────────────────────────────────────────────────────────────

const db = new Dexie('forge');

db.version(1).stores({
  identities:   '++id, name',
  habits:       '++id, identityId, routineId',
  logs:         '++id, habitId, date, [habitId+date]',
  moodEntries:  '++id, &date',          // unique by date
  routines:     '++id, order',
  freezes:      '++id, earnedAt, usedAt',
  settings:     '&key',                  // unique key
});

// ─── Helpers ─────────────────────────────────────────────────

window.db = db;

// "Forge day" — day rolls over at the rollover hour (default 3am).
// So a check made at 1:30am still counts for "yesterday".
async function getRolloverHour() {
  const s = await db.settings.get('rolloverHour');
  return s ? s.value : 3;
}

async function getMoodPromptHour() {
  const s = await db.settings.get('moodPromptHour');
  return s ? s.value : 20;
}

// Returns a YYYY-MM-DD string representing the "forge date" for a given Date.
function forgeDateOf(jsDate, rolloverHour) {
  const d = new Date(jsDate);
  // Subtract rollover hours so e.g. 2am with rollover=3 lands on previous day
  d.setHours(d.getHours() - rolloverHour);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function todayForge() {
  const rh = await getRolloverHour();
  return forgeDateOf(new Date(), rh);
}

// Parse YYYY-MM-DD → Date (local, at noon to avoid DST edges)
function parseForgeDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function addDays(forgeDateStr, n) {
  const d = parseForgeDate(forgeDateStr);
  d.setDate(d.getDate() + n);
  return forgeDateOf(d, 0); // already at noon, no rollover trickery needed
}

function dowOfForgeDate(forgeDateStr) {
  return parseForgeDate(forgeDateStr).getDay(); // 0=Sun..6=Sat
}

// ─── Seeding ─────────────────────────────────────────────────
// First-run seed: 3 identities + 7 habits matching the design mockups.
// Skipped entirely if the user explicitly ran "borrar todo" (we leave a
// marker in settings so the seed doesn't re-populate the slate).
async function seedIfEmpty() {
  const resetFlag = await db.settings.get('userResetData');
  if (resetFlag && resetFlag.value === true) return;

  const count = await db.habits.count();
  if (count > 0) return;

  // Identities
  const atletaId = await db.identities.add({
    name: 'atleta fuerte',
    description: 'Cuido mi cuerpo y mi energía.',
    color: '#9CB5A4',
    createdAt: Date.now(),
  });
  const menteId = await db.identities.add({
    name: 'mente clara',
    description: 'Pienso con calma y profundidad.',
    color: '#A3B5C4',
    createdAt: Date.now(),
  });
  const disciplinadaId = await db.identities.add({
    name: 'persona disciplinada',
    description: 'Hago lo que digo que voy a hacer.',
    color: '#CFA48F',
    createdAt: Date.now(),
  });

  // Routines (subtle colors that tint the divider lines in list view)
  const mananaId = await db.routines.add({ name: 'Mañana', order: 0, color: '#C4BB8F' });
  const tardeId = await db.routines.add({ name: 'Tarde', order: 1, color: '#A3B5C4' });

  // Backdate seed habits by 1 day so today's view shows them without auto-heal
  // kicking in (auto-heal needs createdAt < today's forge-day). No demo logs
  // anymore — empty stats on day 1 is honest.
  const seedTs = Date.now() - 24 * 60 * 60 * 1000;

  // Helper for habit
  const everyDay = { type: 'specificDays', days: [0,1,2,3,4,5,6], timesPerWeek: null };
  const weekdays = { type: 'specificDays', days: [1,2,3,4,5], timesPerWeek: null };

  // Habits — minimal onboarding set. 2 simple examples + 1 meta-instruction
  // pointing the user to "borrar todo" so they can start clean. Backdated 1
  // day so today's view isn't empty but there's no fake history baggage.
  await db.habits.bulkAdd([
    {
      identityId: atletaId, routineId: mananaId, routineOrder: 0,
      iWill: 'tomar un vaso de agua al despertar',
      soThatICanBecome: 'alguien hidratado',
      type: 'binary', target: null, unit: null,
      schedule: everyDay, isCornerstone: false, icon: 'water',
      short: 'tomar un vaso de agua al despertar',
      archived: false, createdAt: seedTs,
    },
    {
      identityId: menteId, routineId: tardeId, routineOrder: 0,
      iWill: 'leer 5 páginas',
      soThatICanBecome: 'un lector',
      type: 'quantitative', target: 5, unit: 'pág', step: 1,
      schedule: everyDay, isCornerstone: false, icon: 'book',
      short: 'leer 5 páginas',
      archived: false, createdAt: seedTs,
    },
    {
      identityId: disciplinadaId, routineId: null, routineOrder: 0,
      iWill: 'ir a ajustes y darle a "borrar todo" para empezar mi propio sistema',
      soThatICanBecome: 'el arquitecto de mis días',
      type: 'binary', target: null, unit: null,
      schedule: everyDay, isCornerstone: true, icon: 'flame',
      short: 'borrar todo y empezar mi propio sistema',
      archived: false, createdAt: seedTs,
    },
  ]);

  // Defaults for settings
  await db.settings.bulkPut([
    { key: 'rolloverHour', value: 3 },
    { key: 'moodPromptHour', value: 20 },
    { key: 'weekStartsOn', value: 1 },
    { key: 'seededAt', value: Date.now() },
  ]);

  // NOTE: skipping demo log generation. The previous version backfilled 14
  // days of fake logs to populate stats — but that confused new users who
  // wondered where the history came from. Empty stats on day 1 is honest.
}

// Generates realistic looking historical logs for the demo so streaks
// and stats are non-empty when the app is opened the first time.
async function seedDemoLogs() {
  const habits = await db.habits.toArray();
  const today = await todayForge();
  const dates = [];
  for (let i = 13; i >= 1; i--) dates.push(addDays(today, -i));

  const logs = [];
  for (const d of dates) {
    const dow = dowOfForgeDate(d);
    for (const h of habits) {
      // Only generate logs for days the habit was scheduled
      const scheduledDays = h.schedule.days || [];
      if (!scheduledDays.includes(dow)) continue;
      // 78% chance of completion (so streaks/stats show realistic data)
      const rand = (Math.sin((h.id * 19 + dateSeed(d)) * 0.5) + 1) / 2;
      if (rand < 0.22) continue; // skipped that day

      if (h.type === 'binary') {
        logs.push({
          habitId: h.id, date: d, value: true,
          target: null, unit: null,
          timestamp: Date.now(),
        });
      } else {
        const value = rand < 0.35 ? h.target * (0.4 + rand) : h.target;
        logs.push({
          habitId: h.id, date: d, value: Math.round(value * 4) / 4,
          target: h.target, unit: h.unit,
          timestamp: Date.now(),
        });
      }
    }
  }
  await db.logs.bulkAdd(logs);
}

function dateSeed(forgeDateStr) {
  const [y, m, d] = forgeDateStr.split('-').map(Number);
  return y * 10000 + m * 100 + d;
}

// Export helpers to window
Object.assign(window, {
  db, seedIfEmpty,
  forgeDateOf, todayForge, parseForgeDate, addDays, dowOfForgeDate,
  getRolloverHour, getMoodPromptHour, dateSeed,
});
