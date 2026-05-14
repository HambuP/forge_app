/* global React, ReactDOM, db, seedIfEmpty, todayForge, getRolloverHour,
   getMoodPromptHour, forgeDateOf, parseForgeDate, addDays, dowOfForgeDate,
   habitIsDone, habitProgress, isScheduledOn, classifyDay, habitStreak,
   habitLongestStreak, globalStreak, globalLongestStreak, groupLogsByDate, completionRate,
   habitHistory, dayClassificationsHistory,
   DAY_PERFECT, DAY_GOOD, DAY_REGULAR, DAY_NEUTRAL,
   C, IDENTITIES, ROUTINES, hexToRgba, isDone, dateInfo, cap,
   SPANISH_DOWS, SPANISH_MONTHS_SHORT, DAYS, MONTHS,
   Glyph, StreakMark, HabitRow, RoutineHeader, ViewToggle, DateStepper,
   Header, Bubble, IdentitySection, BubblesView, CreateHabit, HabitDetail,
   Modal */

// Note: useState and useMemo are already destructured at the top of components.jsx.
// Re-declaring them here would throw "redeclaration of const" since classic
// <script> tags share their lexical environment.
const { useEffect, useCallback, useRef } = React;

// ─────────────────────────────────────────────────────────────
// State sync: mirror DB identities/routines into the in-memory
// IDENTITIES / ROUTINES that the visual components expect.
// IDENTITIES is keyed by numeric id (as string for safety) plus
// a 'sinId' fallback for habits whose identity was deleted.
// ─────────────────────────────────────────────────────────────
function syncIdentities(rows) {
  // Clear and re-fill in place to keep the reference stable for the
  // components that close over IDENTITIES at import time.
  for (const k of Object.keys(IDENTITIES)) {
    if (k !== 'sinId') delete IDENTITIES[k];
  }
  for (const r of rows) {
    IDENTITIES[String(r.id)] = {
      label: r.name,
      color: r.color,
      soft: hexToRgba(r.color, 0.16),
    };
  }
}

function syncRoutines(rows) {
  ROUTINES.length = 0;
  for (const r of rows.sort((a, b) => a.order - b.order)) {
    ROUTINES.push(r.name);
  }
}

// Map a DB habit + today's log into the UI-shape expected by HabitRow/Bubble.
function toUiHabit(dbHabit, log, routineNameById) {
  const routine = dbHabit.routineId ? (routineNameById.get(dbHabit.routineId) ?? null) : null;
  const isBinary = dbHabit.type === 'binary';
  return {
    id: dbHabit.id,
    routine,
    icon: dbHabit.icon || 'yoga',
    text: `Voy a ${dbHabit.iWill}`,
    short: dbHabit.iWill.toLowerCase().trim(),
    becomePerson: dbHabit.soThatICanBecome,
    type: isBinary ? 'binary' : dbHabit.type,  // 'binary' | 'quantitative' | 'duration'
    cornerstone: !!dbHabit.isCornerstone,
    identity: dbHabit.identityId ? String(dbHabit.identityId) : 'sinId',
    done: isBinary ? (log ? log.value === true : false) : undefined,
    value: !isBinary ? (log ? log.value : 0) : undefined,
    target: dbHabit.target,
    step: dbHabit.step || (dbHabit.type === 'duration' ? 5 : 1),
    unit: dbHabit.unit,
    _db: dbHabit,  // original db row, useful for editing
  };
}

// Adapter so HabitDetail (which expects [{date: Date, value, target, scheduled, dow}])
// can consume the output of our logic.js habitHistory().
function toLegacyHistory(rows, dbHabit) {
  return rows.map((r) => {
    const date = parseForgeDate(r.date);
    return {
      date,
      dow: (date.getDay() + 6) % 7,  // Mon=0 (existing component expects this)
      scheduled: r.scheduled,
      value: dbHabit.type === 'binary' ? (r.done ? 1 : 0) : r.value,
      target: dbHabit.type === 'binary' ? 1 : r.target,
      unit: r.unit ?? dbHabit.unit,
    };
  });
}

// Existing components use type === 'quant'; my DB stores 'quantitative'.
// HabitRow's progress/stepper logic checks `type === 'binary'` (good) and
// otherwise treats as quant-style. 'duration' rows already worked the same
// way. So we only need to make sure non-'binary' rows pass through.
// (Both 'quant' and 'duration' end up in the else branch of HabitRow.)

// ─────────────────────────────────────────────────────────────
// Custom hook: live data from IndexedDB
// ─────────────────────────────────────────────────────────────
function useForgeData() {
  const [data, setData] = useState(null);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((x) => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await seedIfEmpty();
      // Auto-heal: if any habit has logs on a forge-day BEFORE its createdAt
      // forge-day (i.e. it was seeded before we backdated the seed), push
      // createdAt back to 1 day before the oldest log. We compare forge-dates,
      // not raw timestamps — otherwise habits created at e.g. 10pm get
      // incorrectly backdated by their own same-day log (which lives at noon).
      const allHabits = await db.habits.toArray();
      for (const h of allHabits) {
        if (!h.createdAt) continue;
        const habitCreatedForge = forgeDateOf(new Date(h.createdAt), 3);
        const logs = await db.logs.where('habitId').equals(h.id).toArray();
        if (logs.length === 0) continue;
        const oldestDate = logs.map(l => l.date).sort()[0];
        if (oldestDate < habitCreatedForge) {
          const oldestTs = parseForgeDate(oldestDate).getTime();
          await db.habits.update(h.id, { createdAt: oldestTs - 24 * 60 * 60 * 1000 });
        }
      }

      // One-time migration: backfill the `target` snapshot on logs that don't
      // have one. Snapshots make raising/lowering a target not retroactively
      // invalidate past completions. This runs once, tracked via settings flag.
      const tgtMigDone = await db.settings.get('logTargetSnapshotV1');
      if (!tgtMigDone?.value) {
        const habitsById = new Map(allHabits.map(h => [h.id, h]));
        const orphanLogs = await db.logs.toArray();
        for (const log of orphanLogs) {
          if (log.target !== undefined) continue;
          const h = habitsById.get(log.habitId);
          if (!h) continue;
          await db.logs.update(log.id, {
            target: h.type === 'binary' ? null : (h.target ?? null),
            unit: h.unit ?? null,
          });
        }
        await db.settings.put({ key: 'logTargetSnapshotV1', value: true });
      }

      const today = await todayForge();
      const [identities, routines, habits, logs, mood, settings, freezes, allMoods] = await Promise.all([
        db.identities.toArray(),
        db.routines.toArray(),
        db.habits.toArray(),
        db.logs.toArray(),
        db.moodEntries.where('date').equals(today).first(),
        db.settings.toArray(),
        db.freezes.toArray(),
        db.moodEntries.toArray(),
      ]);
      if (cancelled) return;
      syncIdentities(identities);
      syncRoutines(routines);
      setData({
        today,
        identities,
        routines,
        habits: habits.filter((h) => !h.archived),
        archivedHabits: habits.filter((h) => h.archived === true),
        logs,
        moodToday: mood ?? null,
        moodAll: allMoods,
        settings: Object.fromEntries(settings.map(s => [s.key, s.value])),
        freezes,
      });
    })();
    return () => { cancelled = true; };
  }, [tick]);

  return { data, refresh: bump };
}

// ─────────────────────────────────────────────────────────────
// Quotes — one per day (deterministic by date), shown in the header
// in place of the old "hoy estás siendo X" identity line.
// ─────────────────────────────────────────────────────────────
const QUOTES = [
  { text: 'somos lo que hacemos repetidamente.', author: 'aristóteles' },
  { text: 'el carácter es destino.', author: 'heráclito' },
  { text: 'no malgastes el tiempo discutiendo cómo debe ser un buen hombre. sé uno.', author: 'marco aurelio' },
  { text: 'primero di a ti mismo lo que serás; luego haz lo que tienes que hacer.', author: 'epicteto' },
  { text: 'el obstáculo en el camino se convierte en el camino.', author: 'marco aurelio' },
  { text: 'un viaje de mil millas comienza con un solo paso.', author: 'lao tse' },
  { text: 'no te elevas al nivel de tus metas. caes al nivel de tus sistemas.', author: 'james clear' },
  { text: 'cada día emprendemos un nuevo nacimiento.', author: 'séneca' },
  { text: 'la calidad no es un acto, es un hábito.', author: 'aristóteles' },
  { text: 'no es lo que te ocurre, sino cómo reaccionas a ello.', author: 'epicteto' },
  { text: 'lo que haces todos los días importa más que lo que haces de vez en cuando.', author: 'gretchen rubin' },
  { text: 'la disciplina es elegir entre lo que quieres ahora y lo que quieres más.', author: 'abraham lincoln' },
  { text: 'conócete a ti mismo.', author: 'sócrates' },
  { text: 'no esperes. el momento nunca será el indicado.', author: 'napoleon hill' },
  { text: 'el éxito es la suma de pequeños esfuerzos repetidos día tras día.', author: 'robert collier' },
  { text: 'no cuentes los días, haz que los días cuenten.', author: 'muhammad ali' },
  { text: 'haz lo que debes; lo demás vendrá.', author: 'marco aurelio' },
  { text: 'pequeños cambios, gran diferencia.', author: 'james clear' },
  { text: 'el conocimiento de uno mismo es el principio de toda sabiduría.', author: 'aristóteles' },
  { text: 'no hay viento favorable para quien no sabe a dónde va.', author: 'séneca' },
  { text: 'todo lo que necesitas está dentro de ti, ahora.', author: 'marco aurelio' },
  { text: 'la mente lo es todo. te conviertes en lo que piensas.', author: 'buda' },
  { text: 'lo difícil no es hacerlo. lo difícil es decidir hacerlo.', author: 'amelia earhart' },
  { text: 'lo perfecto es enemigo de lo bueno.', author: 'voltaire' },
  { text: 'la vida es muy simple, pero insistimos en hacerla complicada.', author: 'confucio' },
];

function quoteForDate(forgeDateStr) {
  const seed = dateSeed(forgeDateStr);
  return QUOTES[Math.abs(seed) % QUOTES.length];
}

// ─────────────────────────────────────────────────────────────
// Floating tab pill — bottom-center oval with 3 segments.
// Visible on home / stats / identities. Hidden on settings, wizard, detail.
// ─────────────────────────────────────────────────────────────
const TabPill = ({ current, onSelect, onCreate }) => {
  const tabs = [
    { key: 'home',       icon: 'calendar', label: 'hoy' },
    { key: 'stats',      icon: 'chart',    label: 'stats' },
    { key: 'identities', icon: 'person',   label: 'identidades' },
  ];
  return (
    <div style={{
      position: 'fixed', bottom: 28, left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        background: 'rgba(28,27,25,0.92)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: `1px solid ${C.hairlineStrong}`,
        borderRadius: 999, padding: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.30), 0 8px 24px rgba(0,0,0,0.35)',
      }}>
        {tabs.map((t) => {
          const active = current === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onSelect(t.key)}
              aria-label={t.label}
              style={{
                background: active ? 'rgba(236,235,229,0.10)' : 'transparent',
                color: active ? C.ink : 'rgba(236,235,229,0.5)',
                border: 'none', cursor: 'pointer',
                width: 60, height: 48, padding: 0, borderRadius: 999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 180ms ease-out',
              }}
            >
              <Glyph name={t.icon} size={24} strokeWidth={active ? 1.7 : 1.4} />
            </button>
          );
        })}
      </div>

      {onCreate && (
        <button
          onClick={onCreate}
          aria-label="Crear hábito"
          style={{
            width: 60, height: 60, borderRadius: '50%',
            background: C.ink, color: C.bg,
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.30), 0 8px 24px rgba(0,0,0,0.35)',
            transition: 'transform 180ms ease-out',
          }}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.94)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          <Glyph name="plus" size={24} color={C.bg} strokeWidth={1.7} />
        </button>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Stats globales — global streak, day distribution, completion %.
// ─────────────────────────────────────────────────────────────
function StatsScreen({ onBack, data, onGoToDate }) {
  const { today, habits, logs } = data;
  const logsByDate = useMemo(() => groupLogsByDate(logs), [logs]);
  const dayClasses = useMemo(
    () => dayClassificationsHistory(habits, logsByDate, today, 90),
    [habits, logsByDate, today]
  );
  const gStreak = useMemo(
    () => globalStreak(habits, logsByDate, today),
    [habits, logsByDate, today]
  );
  const gRecord = useMemo(
    () => globalLongestStreak(habits, logsByDate, today),
    [habits, logsByDate, today]
  );

  // 90-day distribution
  const dist = useMemo(() => {
    const c = { perfect: 0, good: 0, regular: 0, neutral: 0 };
    for (const d of dayClasses) c[d.classification]++;
    return c;
  }, [dayClasses]);

  // Global completion rate by week (last 12 weeks)
  const weekly = useMemo(() => {
    const out = [];
    for (let w = 11; w >= 0; w--) {
      let sched = 0, done = 0;
      for (let dd = 6; dd >= 0; dd--) {
        const date = addDays(today, -(w * 7 + dd));
        const lset = new Map((logsByDate.get(date) || []).map(l => [l.habitId, l]));
        for (const h of habits) {
          if (!isScheduledOn(h, date)) continue;
          sched++;
          if (habitIsDone(h, lset.get(h.id))) done++;
        }
      }
      out.push({ rate: sched ? done / sched : 0, sched });
    }
    return out;
  }, [habits, logsByDate, today]);

  const last7 = dayClasses.slice(-7);

  return (
    <div style={{
      minHeight: '100%', background: C.bg, color: C.ink,
      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
      padding: '24px 20px 80px',
    }}>
      {/* Back */}
      <button
        onClick={onBack}
        aria-label="Volver"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 4, marginLeft: -4, marginBottom: 8, color: C.ink70,
        }}
      >
        <Glyph name="chev" size={20} strokeWidth={1.6}
               color={C.ink70} />
        <span style={{ position: 'absolute', left: -9999 }}>volver</span>
      </button>

      <div style={{
        fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
        color: C.ink35, marginBottom: 6, fontWeight: 500,
      }}>estadísticas</div>
      <h1 style={{
        margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.6,
      }}>tu progreso</h1>

      <div style={{ height: 1, background: C.hairline, margin: '24px 0' }} />

      {/* Global streak */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginBottom: 8,
        }}>racha global</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{
              fontSize: 44, fontWeight: 300, letterSpacing: -1.5,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            }}>{gStreak}</span>
            <span style={{
              fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
              color: C.ink35, fontWeight: 500,
            }}>días</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase',
              color: C.ink35, fontWeight: 500, marginBottom: 4,
            }}>récord</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'flex-end' }}>
              <span style={{
                fontSize: 18, fontWeight: 500, color: C.ink70,
                fontVariantNumeric: 'tabular-nums', letterSpacing: -0.3, lineHeight: 1,
              }}>{gRecord}</span>
              <span style={{ fontSize: 10.5, color: C.ink35, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 500 }}>días</span>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: C.ink50, marginTop: 6 }}>
          días perfectos o buenos consecutivos
        </div>
      </div>

      {/* Last 7 days timeline */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginBottom: 12,
        }}>últimos 7 días</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {last7.map((d, i) => {
            const fill = d.classification === DAY_PERFECT ? C.ink :
                         d.classification === DAY_GOOD ? hexToRgba('#ECEBE5', 0.5) :
                         d.classification === DAY_NEUTRAL ? hexToRgba('#ECEBE5', 0.10) :
                         hexToRgba('#ECEBE5', 0.18);
            const date = parseForgeDate(d.date);
            return (
              <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  height: 36, borderRadius: '50%', width: 36, margin: '0 auto',
                  background: fill,
                  border: d.classification === DAY_REGULAR
                    ? `1px solid ${hexToRgba('#ECEBE5', 0.18)}` : 'none',
                }} />
                <div style={{
                  fontSize: 9.5, color: C.ink35, marginTop: 6,
                  letterSpacing: 0.4, textTransform: 'uppercase',
                }}>
                  {SPANISH_DOWS[date.getDay()][0]}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Distribution */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginBottom: 12,
        }}>distribución · 90 días</div>
        {(() => {
          const real = dist.perfect + dist.good + dist.regular;
          const pct = (n) => real > 0 ? Math.round((n / real) * 100) : 0;
          return (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                {[
                  { label: 'perfectos', val: dist.perfect, color: C.ink },
                  { label: 'buenos',    val: dist.good,    color: hexToRgba('#ECEBE5', 0.55) },
                  { label: 'regulares', val: dist.regular, color: hexToRgba('#ECEBE5', 0.25) },
                ].map((s) => (
                  <div key={s.label}>
                    <div style={{ fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.ink35, marginBottom: 6 }}>{s.label}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <span style={{
                        fontSize: 26, fontWeight: 400, color: C.ink,
                        fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4,
                      }}>{s.val}</span>
                      <span style={{ fontSize: 11, color: C.ink50 }}>
                        {pct(s.val)}%
                      </span>
                    </div>
                    <div style={{
                      height: 2, background: s.color, marginTop: 8,
                      width: `${pct(s.val)}%`, minWidth: 4,
                    }} />
                  </div>
                ))}
              </div>
              {dist.neutral > 0 && (
                <p style={{
                  fontSize: 11, color: C.ink35, marginTop: 14, lineHeight: 1.45,
                }}>
                  {dist.neutral} {dist.neutral === 1 ? 'día' : 'días'} sin hábitos
                  programados ({real} {real === 1 ? 'día cuenta' : 'días cuentan'}).
                </p>
              )}
            </>
          );
        })()}
      </div>

      <GlobalCalendarBlock habits={habits} logsByDate={logsByDate} today={today} onGoToDate={onGoToDate} />

      {/* Weekly completion sparkline */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginBottom: 12,
        }}>completación semanal · 12 sem</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
          {weekly.map((w, i) => (
            <div key={i} style={{
              flex: 1, height: `${Math.max(2, w.rate * 80)}px`,
              background: i === weekly.length - 1 ? C.ink : hexToRgba('#ECEBE5', 0.35),
              transition: 'height 280ms ease-out',
            }} title={`${Math.round(w.rate * 100)}%`} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span style={{ fontSize: 9.5, color: C.ink35 }}>hace 12 sem</span>
          <span style={{ fontSize: 9.5, color: C.ink35 }}>esta semana · {Math.round((weekly[weekly.length-1]?.rate ?? 0) * 100)}%</span>
        </div>
      </div>

      <MoodBlock data={data} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Global calendar — month-by-month grid of day classifications.
// Each cell colored by classifyDay (perfect/good/regular/neutral).
// ─────────────────────────────────────────────────────────────
function GlobalCalendarBlock({ habits, logsByDate, today, onGoToDate }) {
  const [offset, setOffset] = useState(0);
  const todayD = parseForgeDate(today);
  const target = new Date(todayD.getFullYear(), todayD.getMonth() + offset, 1);
  const monthName = SPANISH_MONTHS_SHORT[target.getMonth()];
  const year = target.getFullYear();
  const monthStartDow = (target.getDay() + 6) % 7;
  const daysInMonth = new Date(year, target.getMonth() + 1, 0).getDate();

  const cells = useMemo(() => {
    const out = [];
    for (let i = 0; i < monthStartDow; i++) out.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const yyyy = target.getFullYear();
      const mm = String(target.getMonth() + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const forgeStr = `${yyyy}-${mm}-${dd}`;
      const logs = logsByDate.get(forgeStr) || [];
      const cls = classifyDay(habits, { date: forgeStr, logs });
      const isToday = forgeStr === today;
      const isFuture = forgeStr > today;
      out.push({ day, forgeStr, cls, isToday, isFuture });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [habits, logsByDate, today, offset, monthStartDow, daysInMonth, year]);

  // Color mapping for day classification — mirrors the distribution tiles
  // colors (ink at varying opacity).
  const cellBg = (cls, isFuture, isToday) => {
    if (isFuture) return 'transparent';
    if (cls === DAY_PERFECT) return hexToRgba('#ECEBE5', 0.88);
    if (cls === DAY_GOOD)    return hexToRgba('#ECEBE5', 0.55);
    if (cls === DAY_REGULAR) return hexToRgba('#ECEBE5', 0.22);
    return hexToRgba('#ECEBE5', 0.05);  // neutral / no data
  };
  const cellText = (cls, isFuture) => {
    if (isFuture) return C.ink35;
    if (cls === DAY_PERFECT) return '#0F0F0E';
    if (cls === DAY_GOOD) return '#0F0F0E';
    return C.ink70;
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14,
      }}>
        <span style={{
          fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500,
        }}>calendario · {monthName} {year}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={() => setOffset((o) => o - 1)}
            aria-label="Mes anterior"
            style={{
              width: 32, height: 32, padding: 0,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.ink50, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
              <Glyph name="chev" size={14} strokeWidth={1.6}/>
            </span>
          </button>
          <button
            onClick={() => offset < 0 && setOffset((o) => o + 1)}
            disabled={offset >= 0}
            aria-label="Mes siguiente"
            style={{
              width: 32, height: 32, padding: 0,
              background: 'transparent', border: 'none',
              cursor: offset < 0 ? 'pointer' : 'default',
              color: C.ink50, opacity: offset < 0 ? 1 : 0.3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <Glyph name="chev" size={14} strokeWidth={1.6}/>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
        {['L','M','X','J','V','S','D'].map((d) => (
          <div key={d} style={{
            fontSize: 9.5, color: C.ink35, letterSpacing: 0.8, textAlign: 'center',
            textTransform: 'uppercase', fontWeight: 500, paddingBottom: 4,
          }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((c, i) => {
          if (!c) return <div key={i}/>;
          return (
            <button
              key={i}
              onClick={() => !c.isFuture && onGoToDate && onGoToDate(c.forgeStr)}
              disabled={c.isFuture}
              aria-label={c.forgeStr}
              style={{
                aspectRatio: '1',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                background: cellBg(c.cls, c.isFuture, c.isToday),
                border: c.isToday ? `1.5px solid ${C.ink}` : (c.isFuture ? `1px solid ${C.hairline}` : 'none'),
                fontSize: 11, color: cellText(c.cls, c.isFuture),
                fontWeight: 500, fontVariantNumeric: 'tabular-nums',
                cursor: c.isFuture ? 'default' : 'pointer',
                padding: 0, fontFamily: 'inherit',
                transition: 'all 200ms ease-out',
              }}>
              {c.day}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 14, flexWrap: 'wrap',
        marginTop: 14, fontSize: 10, color: C.ink35,
        letterSpacing: 0.3,
      }}>
        {[
          { label: 'perfecto', op: 0.88 },
          { label: 'bueno',    op: 0.55 },
          { label: 'regular',  op: 0.22 },
          { label: 'neutro',   op: 0.05 },
        ].map((it) => (
          <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: hexToRgba('#ECEBE5', it.op),
            }} />
            {it.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Mood section — appears at the end of StatsScreen.
// ─────────────────────────────────────────────────────────────
const MOOD_LABELS = ['pésimo', 'mal', 'meh', 'bien', 'gran día'];
const MOOD_COLOR = '#CFA48F';  // warm terracotta accent for mood

function MoodBlock({ data }) {
  const { today, moodAll = [], settings } = data;
  const moodHour = settings.moodPromptHour ?? 20;

  const last14 = useMemo(() => {
    const byDate = new Map(moodAll.map(m => [m.date, m]));
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(today, -i);
      out.push({ date: d, mood: byDate.get(d) ?? null });
    }
    return out;
  }, [moodAll, today]);

  const scores = last14.filter(d => d.mood).map(d => d.mood.score);
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const recentNotes = useMemo(() => {
    return [...moodAll]
      .filter(m => m.note && m.note.trim())
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);
  }, [moodAll]);

  return (
    <div style={{ marginTop: 8, marginBottom: 24 }}>
      <div style={{
        fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
        color: C.ink35, fontWeight: 500, marginBottom: 12,
      }}>ánimo · 14 días</div>

      {scores.length === 0 ? (
        <p style={{
          fontSize: 12.5, color: C.ink50, lineHeight: 1.5,
          margin: '8px 0 0',
        }}>
          el prompt de ánimo aparece después de las {moodHour}:00.
          aún no has registrado ninguno.
        </p>
      ) : (
        <>
          {/* Bars */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 64, marginBottom: 6 }}>
            {last14.map((d, i) => {
              const score = d.mood?.score ?? null;
              const h = score ? (score / 5) * 64 : 2;
              const op = score ? 0.25 + (score / 5) * 0.65 : 0.06;
              return (
                <div key={i} style={{
                  flex: 1, height: `${h}px`,
                  background: score ? hexToRgba(MOOD_COLOR, op) : hexToRgba('#ECEBE5', 0.05),
                  transition: 'all 280ms ease-out',
                }} title={score ? `${MOOD_LABELS[score-1]}` : 'sin registro'} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 9.5, color: C.ink35 }}>hace 14 días</span>
            <span style={{ fontSize: 11, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ fontWeight: 500 }}>{avg.toFixed(1)}</span>
              <span style={{ color: C.ink35, marginLeft: 4 }}>/ 5</span>
              <span style={{ color: C.ink35, marginLeft: 8 }}>· {scores.length} registros</span>
            </span>
          </div>

          {recentNotes.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div style={{
                fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
                color: C.ink35, fontWeight: 500, marginBottom: 4,
              }}>notas recientes</div>
              {recentNotes.map((n) => (
                <div key={n.date} style={{
                  padding: '12px 0', borderTop: `1px solid ${C.hairline}`,
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'baseline', marginBottom: 6,
                  }}>
                    <span style={{ fontSize: 12, color: C.ink70, letterSpacing: -0.05 }}>
                      {formatLogDate(parseForgeDate(n.date))}
                    </span>
                    <span style={{
                      fontSize: 10.5, color: hexToRgba(MOOD_COLOR, 0.85),
                      fontWeight: 500, letterSpacing: 0.4,
                    }}>{MOOD_LABELS[n.score - 1]}</span>
                  </div>
                  <p style={{
                    fontSize: 13, color: C.ink, lineHeight: 1.4,
                    margin: 0, letterSpacing: -0.05,
                  }}>"{n.note}"</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Identity editor modal — edit name, description, color.
// ─────────────────────────────────────────────────────────────
const IDENTITY_COLOR_OPTIONS = ['#9CB5A4', '#A3B5C4', '#CFA48F', '#B4A3C4', '#C4BB8F', '#A4CFC0', '#C2A3A3'];

function IdentityEditor({ identity, onClose, onSave }) {
  const [name, setName] = useState(identity.name || '');
  const [desc, setDesc] = useState(identity.description || '');
  const [color, setColor] = useState(identity.color || IDENTITY_COLOR_OPTIONS[0]);
  const trimmed = name.trim();

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(90%, 400px)', background: C.bg,
          border: `1px solid ${C.hairlineStrong}`,
          padding: '20px 22px 18px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{
            fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
            color: C.ink35, fontWeight: 500,
          }}>editar identidad</span>
          <button onClick={onClose} aria-label="cerrar" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink50, padding: 0,
          }}>
            <Glyph name="close" size={14}/>
          </button>
        </div>

        <div>
          <div style={{
            fontSize: 10.5, color: C.ink35, marginBottom: 6,
            textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 500,
          }}>nombre</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              borderBottom: `1px solid ${C.hairlineStrong}`,
              color: C.ink, fontSize: 14, padding: '6px 0',
              width: '100%', fontFamily: 'inherit',
            }}
          />
        </div>

        <div>
          <div style={{
            fontSize: 10.5, color: C.ink35, marginBottom: 6,
            textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 500,
          }}>descripción <span style={{ textTransform: 'lowercase', letterSpacing: 0, color: C.ink50 }}>· opcional</span></div>
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="cuido mi cuerpo y mi energía"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              borderBottom: `1px solid ${C.hairlineStrong}`,
              color: C.ink, fontSize: 14, padding: '6px 0',
              width: '100%', fontFamily: 'inherit',
            }}
          />
        </div>

        <div>
          <div style={{
            fontSize: 10.5, color: C.ink35, marginBottom: 8,
            textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 500,
          }}>color</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {IDENTITY_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: c,
                  border: color === c ? `1.5px solid ${C.ink}` : '1.5px solid transparent',
                  cursor: 'pointer', padding: 0,
                  transition: 'all 180ms ease-out',
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 6 }}>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink50, fontSize: 13, fontWeight: 500,
            fontFamily: 'inherit', padding: '8px 4px',
          }}>cancelar</button>
          <button
            onClick={() => trimmed && onSave({ name: trimmed, description: desc.trim(), color })}
            disabled={!trimmed}
            style={{
              background: trimmed ? C.ink : C.hairlineStrong,
              color: trimmed ? C.bg : C.ink50,
              border: 'none', cursor: trimmed ? 'pointer' : 'default',
              padding: '8px 16px', borderRadius: 999,
              fontSize: 13, fontWeight: 600, letterSpacing: -0.05,
              fontFamily: 'inherit',
            }}
          >guardar</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Identidades — list of identities with fidelity %.
// ─────────────────────────────────────────────────────────────
function IdentitiesScreen({ onBack, data, refresh }) {
  const { today, identities, habits, logs } = data;
  const logsByDate = useMemo(() => groupLogsByDate(logs), [logs]);
  const [editingIdentity, setEditingIdentity] = useState(null);

  // For each identity, compute last-7d completion rate of its habits.
  const fidelity = useMemo(() => {
    const m = new Map();
    for (const i of identities) {
      const myHabits = habits.filter(h => h.identityId === i.id);
      let sched = 0, done = 0;
      for (let dd = 6; dd >= 0; dd--) {
        const d = addDays(today, -dd);
        const lset = new Map((logsByDate.get(d) || []).map(l => [l.habitId, l]));
        for (const h of myHabits) {
          if (!isScheduledOn(h, d)) continue;
          sched++;
          if (habitIsDone(h, lset.get(h.id))) done++;
        }
      }
      m.set(i.id, { rate: sched ? done / sched : 0, habitCount: myHabits.length });
    }
    return m;
  }, [identities, habits, logsByDate, today]);

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta identidad? Los hábitos asociados quedarán sin identidad.')) return;
    await db.identities.delete(id);
    await db.habits.where({ identityId: id }).modify({ identityId: null });
    refresh();
  };

  return (
    <div style={{
      minHeight: '100%', background: C.bg, color: C.ink,
      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
      padding: '24px 20px 80px',
    }}>
      <button
        onClick={onBack}
        aria-label="Volver"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 4, marginLeft: -4, marginBottom: 8, color: C.ink70,
        }}
      >
        <Glyph name="chev" size={20} strokeWidth={1.6} color={C.ink70} />
      </button>

      <div style={{
        fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
        color: C.ink35, marginBottom: 6, fontWeight: 500,
      }}>identidades</div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.6 }}>
        en quién te conviertes
      </h1>
      <p style={{
        fontSize: 13.5, color: C.ink50, marginTop: 10, marginBottom: 24, lineHeight: 1.5,
      }}>
        cada hábito es un voto por la persona que quieres ser. esta es tu fidelidad
        a cada identidad durante los últimos 7 días.
      </p>

      <div style={{ height: 1, background: C.hairline, margin: '0 0 16px' }} />

      {identities.map((idn) => {
        const stat = fidelity.get(idn.id) ?? { rate: 0, habitCount: 0 };
        return (
          <div key={idn.id} style={{ padding: '20px 0', borderBottom: `1px solid ${C.hairline}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%', background: idn.color,
                flexShrink: 0,
              }} />
              <button
                onClick={() => setEditingIdentity(idn)}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  fontSize: 15, color: C.ink, fontWeight: 500, padding: 0,
                  fontFamily: 'Inter', letterSpacing: -0.1, textAlign: 'left',
                  flex: 1,
                }}
              >{idn.name}</button>
              <button
                onClick={() => setEditingIdentity(idn)}
                aria-label="Editar"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.ink35, padding: 4,
                }}
              >
                <Glyph name="pencil" size={14} />
              </button>
              <button
                onClick={() => handleDelete(idn.id)}
                aria-label="Eliminar"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.ink35, padding: 4,
                }}
              >
                <Glyph name="close" size={14} />
              </button>
            </div>
            {idn.description && (
              <p style={{ fontSize: 12.5, color: C.ink50, margin: '0 0 12px 20px', lineHeight: 1.5 }}>
                {idn.description}
              </p>
            )}
            <div style={{ marginLeft: 20, marginRight: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{
                  fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: C.ink35,
                }}>fidelidad · 7 días</span>
                <span style={{
                  fontSize: 13, color: C.ink, fontVariantNumeric: 'tabular-nums',
                  fontWeight: 500,
                }}>{Math.round(stat.rate * 100)}%</span>
              </div>
              <div style={{ height: 2, background: C.hairline, borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: `${stat.rate * 100}%`,
                  background: idn.color, transition: 'width 280ms ease-out',
                }} />
              </div>
              <div style={{ fontSize: 10.5, color: C.ink35, marginTop: 8 }}>
                {stat.habitCount} {stat.habitCount === 1 ? 'hábito' : 'hábitos'}
              </div>
            </div>
          </div>
        );
      })}

      {editingIdentity && (
        <IdentityEditor
          identity={editingIdentity}
          onClose={() => setEditingIdentity(null)}
          onSave={async (patch) => {
            await db.identities.update(editingIdentity.id, patch);
            // Sync in-memory IDENTITIES so wizard chips update too
            IDENTITIES[String(editingIdentity.id)] = {
              label: patch.name,
              color: patch.color,
              soft: hexToRgba(patch.color, 0.16),
            };
            setEditingIdentity(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ajustes — settings screen.
// ─────────────────────────────────────────────────────────────
function SettingsScreen({ onBack, data, refresh }) {
  const [rh, setRh] = useState(data.settings.rolloverHour ?? 3);
  const [mh, setMh] = useState(data.settings.moodPromptHour ?? 20);

  const save = async (key, value) => {
    await db.settings.put({ key, value });
    refresh();
  };

  const exportData = async () => {
    const dump = {
      version: 1,
      exportedAt: new Date().toISOString(),
      identities: await db.identities.toArray(),
      routines: await db.routines.toArray(),
      habits: await db.habits.toArray(),
      logs: await db.logs.toArray(),
      moodEntries: await db.moodEntries.toArray(),
      settings: await db.settings.toArray(),
      freezes: await db.freezes.toArray(),
    };
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forge-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Import a previously-exported JSON. Replaces ALL current data after a
  // double confirmation. The import preserves the original IDs from the dump
  // (so habits keep their log relationships). Sets userResetData flag so the
  // demo seed won't repopulate on the next load.
  const fileInputRef = useRef(null);

  const handleImportFile = async (file) => {
    let dump;
    try {
      const text = await file.text();
      dump = JSON.parse(text);
    } catch (e) {
      alert('No pude leer el archivo. ¿Está bien el JSON?');
      return;
    }
    if (!dump || !Array.isArray(dump.identities) || !Array.isArray(dump.habits) || !Array.isArray(dump.logs)) {
      alert('Este archivo no parece ser un export válido de FORGE.');
      return;
    }
    const summary = [
      `${dump.identities.length} identidades`,
      `${(dump.routines || []).length} rutinas`,
      `${dump.habits.length} hábitos`,
      `${dump.logs.length} registros`,
    ].join('\n');
    if (!confirm(`Esto va a REEMPLAZAR todos tus datos actuales con:\n\n${summary}\n\n¿Continuar?`)) return;
    if (!confirm('¿De verdad? Lo que tenés ahora se pierde.')) return;

    try {
      // Clear current state
      await Promise.all([
        db.identities.clear(),
        db.routines.clear(),
        db.habits.clear(),
        db.logs.clear(),
        db.moodEntries.clear(),
        db.freezes.clear(),
      ]);
      // bulkPut preserves explicit IDs from the dump and is tolerant of
      // partial / missing optional arrays.
      if (dump.identities?.length)  await db.identities.bulkPut(dump.identities);
      if (dump.routines?.length)    await db.routines.bulkPut(dump.routines);
      if (dump.habits?.length)      await db.habits.bulkPut(dump.habits);
      if (dump.logs?.length)        await db.logs.bulkPut(dump.logs);
      if (dump.moodEntries?.length) await db.moodEntries.bulkPut(dump.moodEntries);
      if (dump.freezes?.length)     await db.freezes.bulkPut(dump.freezes);
      if (dump.settings?.length) {
        for (const s of dump.settings) await db.settings.put(s);
      }
      // Prevent the demo seed from running on the next load
      await db.settings.put({ key: 'userResetData', value: true });
      alert('Datos importados correctamente.');
      location.reload();
    } catch (e) {
      alert('Hubo un error al importar:\n\n' + (e?.message || 'desconocido'));
    }
  };

  const resetAll = async () => {
    if (!confirm('¿Borrar TODOS los datos? Esto no se puede deshacer.')) return;
    if (!confirm('¿De verdad? Vas a perder todo tu historial.')) return;
    await Promise.all([
      db.identities.clear(), db.routines.clear(), db.habits.clear(),
      db.logs.clear(), db.moodEntries.clear(),
      db.freezes.clear(),
    ]);
    // Mark that the user explicitly reset so seedIfEmpty won't repopulate
    // the demo data on the next load. User settings (rollover, mood hour)
    // are intentionally preserved.
    await db.settings.put({ key: 'userResetData', value: true });
    location.reload();
  };

  return (
    <div style={{
      minHeight: '100%', background: C.bg, color: C.ink,
      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
      padding: '24px 20px 60px',
    }}>
      <button
        onClick={onBack}
        aria-label="Volver"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 4, marginLeft: -4, marginBottom: 8, color: C.ink70,
        }}
      >
        <Glyph name="chev" size={20} strokeWidth={1.6} color={C.ink70} />
      </button>

      <div style={{
        fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
        color: C.ink35, marginBottom: 6, fontWeight: 500,
      }}>ajustes</div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.6 }}>
        configuración
      </h1>

      <div style={{ height: 1, background: C.hairline, margin: '24px 0' }} />

      <Setting
        label="hora de rollover"
        sub="hora a la que termina el día (anti-trasnoche)"
      >
        <NumberStepper value={rh} setValue={(v) => { setRh(v); save('rolloverHour', v); }} min={0} max={6} suffix="am" />
      </Setting>

      <Setting
        label="recordatorio de ánimo"
        sub="hora a la que aparece el mood revisador"
      >
        <NumberStepper
          value={mh}
          setValue={(v) => { setMh(v); save('moodPromptHour', v); }}
          min={18}
          max={23}
          suffix={mh >= 12 ? 'pm' : 'am'}
          format={v => v > 12 ? v - 12 : v}
        />
      </Setting>

      <div style={{ height: 1, background: C.hairline, margin: '24px 0' }} />

      <button onClick={exportData} style={btnRow}>
        <span>exportar mis datos</span>
        <Glyph name="arrow" size={16} color={C.ink70} />
      </button>

      <button onClick={() => fileInputRef.current?.click()} style={btnRow}>
        <span>importar desde archivo</span>
        <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
          <Glyph name="arrow" size={16} color={C.ink70} />
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = '';
        }}
      />

      <button onClick={resetAll} style={{ ...btnRow, color: '#CFA48F' }}>
        <span>borrar todo</span>
        <Glyph name="close" size={14} color="#CFA48F" />
      </button>

      <div style={{ marginTop: 40, fontSize: 11, color: C.ink35, textAlign: 'center' }}>
        FORGE · v0.1
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Archived screen — list of archived habits with unarchive / delete.
// ─────────────────────────────────────────────────────────────
function ArchivedScreen({ onBack, data, onUnarchive, onDelete }) {
  const archived = data.archivedHabits || [];
  return (
    <div style={{
      minHeight: '100%', background: C.bg, color: C.ink,
      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
      padding: '24px 20px 60px',
    }}>
      <button
        onClick={onBack}
        aria-label="Volver"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: 4, marginLeft: -4, marginBottom: 8, color: C.ink70,
        }}
      >
        <Glyph name="chev" size={20} strokeWidth={1.6} color={C.ink70} />
      </button>

      <div style={{
        fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
        color: C.ink35, marginBottom: 6, fontWeight: 500,
      }}>archivados</div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.6 }}>
        hábitos guardados
      </h1>
      <p style={{
        fontSize: 13, color: C.ink50, marginTop: 10, marginBottom: 24, lineHeight: 1.5,
      }}>
        estos hábitos están ocultos del home pero su historial sigue intacto.
        podés desarchivar cualquiera para volver a verlo.
      </p>

      <div style={{ height: 1, background: C.hairline, margin: '0 0 8px' }} />

      {archived.length === 0 ? (
        <p style={{ fontSize: 13, color: C.ink50, padding: '24px 0', lineHeight: 1.5 }}>
          no tienes hábitos archivados.
        </p>
      ) : (
        archived.map((h) => {
          const idn = IDENTITIES[h.identityId != null ? String(h.identityId) : 'sinId'] ?? IDENTITIES.sinId;
          return (
            <div key={h.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 0', borderBottom: `1px solid ${C.hairline}`,
            }}>
              <div style={{
                width: 32, height: 32, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                border: h.isCornerstone ? '1.5px solid rgba(236,235,229,0.32)' : '1.5px solid transparent',
                color: C.ink50,
              }}>
                <Glyph name={h.icon || 'yoga'} size={18} strokeWidth={1.4} color={C.ink50}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, color: C.ink70, letterSpacing: -0.1 }}>
                  Voy a {h.iWill}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: idn.color, opacity: 0.7 }}/>
                  <span style={{ fontSize: 11, color: C.ink35, letterSpacing: 0.2 }}>{idn.label}</span>
                </div>
              </div>
              <button
                onClick={() => onUnarchive(h.id)}
                style={{
                  background: 'transparent', border: `1px solid ${C.hairlineStrong}`,
                  color: C.ink, padding: '6px 12px', borderRadius: 999,
                  fontSize: 11.5, fontWeight: 500, cursor: 'pointer',
                  fontFamily: 'Inter', letterSpacing: -0.05,
                }}
              >desarchivar</button>
              <button
                onClick={async () => {
                  if (!confirm('¿Eliminar permanentemente? Se borra el historial.')) return;
                  await onDelete(h.id);
                }}
                aria-label="eliminar permanentemente"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.ink35, padding: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Glyph name="close" size={14}/>
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

const btnRow = {
  width: '100%', padding: '16px 0', background: 'transparent',
  border: 'none', borderBottom: `1px solid ${C.hairline}`,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontFamily: 'Inter', fontSize: 14.5, color: C.ink, cursor: 'pointer',
  letterSpacing: -0.1, textAlign: 'left',
};

const Setting = ({ label, sub, children }) => (
  <div style={{ padding: '14px 0', borderBottom: `1px solid ${C.hairline}` }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14.5, color: C.ink, letterSpacing: -0.1 }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: C.ink50, marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
      </div>
      {children}
    </div>
  </div>
);

const NumberStepper = ({ value, setValue, min, max, suffix, format }) => {
  const display = format ? format(value) : value;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => value > min && setValue(value - 1)}
        disabled={value <= min}
        style={stepperBtn(value <= min)}
      >
        <Glyph name="minus" size={12} color={C.ink70} />
      </button>
      <span style={{
        fontVariantNumeric: 'tabular-nums', fontSize: 14.5, color: C.ink,
        minWidth: 40, textAlign: 'center', fontWeight: 500,
      }}>
        {display}{suffix && <span style={{ color: C.ink35, fontSize: 11, marginLeft: 3 }}>{suffix}</span>}
      </span>
      <button
        onClick={() => value < max && setValue(value + 1)}
        disabled={value >= max}
        style={stepperBtn(value >= max)}
      >
        <Glyph name="plus" size={12} color={C.ink70} />
      </button>
    </div>
  );
};

const stepperBtn = (disabled) => ({
  width: 24, height: 24, borderRadius: '50%',
  border: `1px solid ${C.hairlineStrong}`, background: 'transparent',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.28 : 1,
});

// ─────────────────────────────────────────────────────────────
// Mood prompt — appears as a card after the mood prompt hour.
// ─────────────────────────────────────────────────────────────
const MOOD_OPTIONS = [
  { score: 1, label: 'pésimo' },
  { score: 2, label: 'mal' },
  { score: 3, label: 'meh' },
  { score: 4, label: 'bien' },
  { score: 5, label: 'gran día' },
];

function MoodPromptCard({ onSave, onDismiss }) {
  const [score, setScore] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (score === null) return;
    setSaving(true);
    await onSave({ score, note: note.trim() });
  };

  return (
    <div style={{
      margin: '12px 20px 20px', padding: '18px 18px 16px',
      border: `1px solid ${C.hairlineStrong}`, background: 'transparent',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{
          fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500,
        }}>cómo te fue</div>
        <button
          onClick={onDismiss}
          aria-label="cerrar"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: C.ink35, padding: 0 }}
        >
          <Glyph name="close" size={14} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, justifyContent: 'space-between' }}>
        {MOOD_OPTIONS.map((m) => {
          const selected = score === m.score;
          return (
            <button
              key={m.score}
              onClick={() => setScore(m.score)}
              style={{
                flex: 1, padding: '10px 4px', background: 'transparent',
                border: `1px solid ${selected ? C.ink : C.hairlineStrong}`,
                color: selected ? C.ink : C.ink50,
                fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase',
                cursor: 'pointer', borderRadius: 0,
                fontFamily: 'Inter', fontWeight: 500,
                transition: 'all 200ms ease-out',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="una línea sobre el día (opcional)"
        style={{
          width: '100%', background: 'transparent', border: 'none',
          borderBottom: `1px solid ${C.hairlineStrong}`,
          padding: '8px 0', color: C.ink, fontFamily: 'Inter',
          fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button
          onClick={submit}
          disabled={score === null || saving}
          style={{
            background: 'transparent', border: 'none', cursor: score === null ? 'default' : 'pointer',
            color: score === null ? C.ink35 : C.ink,
            fontFamily: 'Inter', fontWeight: 600, fontSize: 13.5,
            letterSpacing: -0.1, padding: 0,
          }}
        >guardar →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PWA install banner — only shows if browser triggers beforeinstallprompt
// ─────────────────────────────────────────────────────────────
function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const installedHandler = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  return { available: !!deferredPrompt && !installed, promptInstall };
}

// ─────────────────────────────────────────────────────────────
// Day progress banner — sits under the header on the home screen.
// Shows how close the day is to "bueno" / "perfecto". Factual, calm tone:
// it informs, it doesn't nag. Green for good, gold for perfect.
// ─────────────────────────────────────────────────────────────
const DAY_GOOD_COLOR = '#9CB5A4';     // sage green — matches "atlética" identity
const DAY_PERFECT_COLOR = '#D4B978';  // muted gold

function DayProgressBanner({ progress }) {
  if (!progress) return null;
  const { done, total, goodThreshold, tier, toGood, csRemaining } = progress;

  const pct = total > 0 ? done / total : 0;
  const goodPct = total > 0 ? goodThreshold / total : 0;

  // Build the label as JSX segments so individual words/numbers can be
  // colored. `labelNode` is what renders; `barColor` drives the fill.
  let labelNode;
  if (tier === 'perfect') {
    labelNode = (
      <span style={{ color: DAY_PERFECT_COLOR, fontWeight: 700, letterSpacing: -0.1 }}>
        día perfecto
      </span>
    );
  } else if (tier === 'good') {
    const morePerfect = total - done;
    labelNode = (
      <span style={{ letterSpacing: -0.1 }}>
        <span style={{ color: DAY_GOOD_COLOR, fontWeight: 600 }}>día bueno</span>
        {morePerfect > 0 && (
          <span style={{ color: C.ink50, fontWeight: 500 }}>
            {'  ·  '}
            <span style={{ color: C.ink, fontWeight: 600 }}>{morePerfect}</span>
            {' más para '}
            <span style={{ color: DAY_PERFECT_COLOR, fontWeight: 600 }}>perfecto</span>
          </span>
        )}
      </span>
    );
  } else {
    // regular — still climbing. Numbers get emphasis, "bueno" previews its color.
    if (csRemaining > 0 && toGood === 0) {
      labelNode = (
        <span style={{ color: C.ink50, fontWeight: 500, letterSpacing: -0.1 }}>
          falta{' '}
          <span style={{ color: C.ink, fontWeight: 600 }}>{csRemaining}</span>
          {' '}{csRemaining === 1 ? 'cornerstone' : 'cornerstones'} para un{' '}
          <span style={{ color: DAY_GOOD_COLOR, fontWeight: 600 }}>día bueno</span>
        </span>
      );
    } else if (toGood === 1) {
      labelNode = (
        <span style={{ color: C.ink70, fontWeight: 600, letterSpacing: -0.1 }}>
          te falta{' '}
          <span style={{ color: C.ink, fontWeight: 700 }}>1 hábito</span>
          {' '}para un{' '}
          <span style={{ color: DAY_GOOD_COLOR, fontWeight: 700 }}>día bueno</span>
        </span>
      );
    } else if (toGood > 1) {
      labelNode = (
        <span style={{ color: C.ink50, fontWeight: 500, letterSpacing: -0.1 }}>
          <span style={{ color: C.ink35, fontWeight: 400 }}>{done}/{goodThreshold}</span>
          {' para un '}
          <span style={{ color: DAY_GOOD_COLOR, fontWeight: 600 }}>día bueno</span>
        </span>
      );
    } else {
      labelNode = (
        <span style={{ color: C.ink50, fontWeight: 500, letterSpacing: -0.1 }}>
          <span style={{ color: C.ink35, fontWeight: 400 }}>{done}/{total}</span>
          {' hoy'}
        </span>
      );
    }
  }

  const barColor =
    tier === 'perfect' ? DAY_PERFECT_COLOR :
    tier === 'good'    ? DAY_GOOD_COLOR :
    C.ink50;

  // Count badge on the right also picks up tier color subtly
  const countColor =
    tier === 'perfect' ? hexToRgba(DAY_PERFECT_COLOR, 0.9) :
    tier === 'good'    ? hexToRgba(DAY_GOOD_COLOR, 0.9) :
    C.ink35;

  return (
    <div style={{ padding: '20px 20px 18px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 7, gap: 10,
      }}>
        <span style={{ fontSize: 12 }}>{labelNode}</span>
        <span style={{
          fontSize: 11, color: countColor, fontVariantNumeric: 'tabular-nums',
          fontWeight: tier === 'regular' ? 400 : 600, flexShrink: 0,
          transition: 'color 320ms ease-out',
        }}>{done}/{total}</span>
      </div>
      <div style={{
        position: 'relative', height: 3, background: C.hairline,
        borderRadius: 2,
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${Math.max(2, pct * 100)}%`,
          background: barColor, borderRadius: 2,
          transition: 'width 320ms ease-out, background 320ms ease-out',
        }} />
        {tier === 'regular' && goodPct < 1 && (
          <div style={{
            position: 'absolute', top: -3, bottom: -3,
            left: `${goodPct * 100}%`, width: 1.5,
            background: hexToRgba(DAY_GOOD_COLOR, 0.7),
          }} />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main App — owns state & navigation between screens.
// ─────────────────────────────────────────────────────────────
function App() {
  const { data, refresh } = useForgeData();
  const [view, setView] = useState('list');             // 'list' | 'bubbles'
  const [screen, setScreen] = useState('home');         // 'home' | 'stats' | 'identities' | 'settings'
  const [collapsed, setCollapsed] = useState({});
  const [dateOffset, setDateOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [detailHabitId, setDetailHabitId] = useState(null);
  const [editingHabitId, setEditingHabitId] = useState(null);
  const [topMenuOpen, setTopMenuOpen] = useState(false);
  const [moodDismissed, setMoodDismissed] = useState(false);
  const install = useInstallPrompt();

  if (!data) {
    return (
      <div style={{
        minHeight: '100vh', background: C.bg, color: C.ink50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'Inter', fontSize: 11, letterSpacing: 2,
        textTransform: 'uppercase',
      }}>forge</div>
    );
  }

  const { today, identities, routines, habits: dbHabits, logs, moodToday, settings } = data;
  const routineNameById = new Map(routines.map(r => [r.id, r.name]));
  const routineColorByName = new Map(routines.map(r => [r.name, r.color || null]));

  // viewDate = the day currently shown in the header. Differs from `today`
  // when the user has stepped backward/forward with the chevron buttons.
  // All home-screen data (logs, scheduled habits, log writes) follows viewDate.
  // Global streak, mood prompt, and quote-of-the-day still follow `today`.
  const viewDate = addDays(today, dateOffset);

  // Logs for the currently-viewed day, indexed by habitId for fast lookup.
  const viewLogs = logs.filter(l => l.date === viewDate);
  const viewLogByHabit = new Map(viewLogs.map(l => [l.habitId, l]));

  // Build UI habits scheduled for the viewed day.
  const uiHabits = dbHabits
    .filter(h => isScheduledOn(h, viewDate))
    .map(h => toUiHabit(h, viewLogByHabit.get(h.id), routineNameById));

  // Global streak (always anchored at today; doesn't change when navigating).
  const logsByDate = groupLogsByDate(logs);
  const gStreak = globalStreak(dbHabits, logsByDate, today);

  // ── Day progress ────────────────────────────────────────────
  // How close is the VIEWED day to "bueno" / "perfecto"? Drives the progress
  // banner under the header. Plain calculation (not useMemo) — it sits after
  // the early `if (!data) return` above, so it must NOT be a hook.
  const dayProgress = (() => {
    const scheduled = dbHabits.filter(h => !h.archived && isScheduledOn(h, viewDate));
    if (scheduled.length === 0) return null;
    const lset = new Map((logsByDate.get(viewDate) || []).map(l => [l.habitId, l]));
    let done = 0;
    const cornerstones = scheduled.filter(h => h.isCornerstone);
    let csDone = 0;
    for (const h of scheduled) if (habitIsDone(h, lset.get(h.id))) done++;
    for (const h of cornerstones) if (habitIsDone(h, lset.get(h.id))) csDone++;
    const total = scheduled.length;
    const goodThreshold = Math.ceil(total * 0.7);
    const ratio = done / total;
    const allCs = cornerstones.length === 0 || csDone === cornerstones.length;
    let tier = 'regular';
    if (ratio >= 0.9999) tier = 'perfect';
    else if (ratio >= 0.7 && allCs) tier = 'good';
    return {
      done, total, goodThreshold,
      csTotal: cornerstones.length, csDone,
      csRemaining: cornerstones.length - csDone,
      toGood: Math.max(0, goodThreshold - done),
      toPerfect: total - done,
      allCs, tier,
    };
  })();

  // Quote-of-the-day (deterministic by viewDate so flipping back shows the
  // quote that was shown that day). The author gets a subtle accent that
  // rotates daily through the identity palette.
  const baseQuote = quoteForDate(viewDate);
  const ACCENT_COLORS = ['#9CB5A4', '#A3B5C4', '#CFA48F', '#B4A3C4', '#C4BB8F'];
  const accentColor = ACCENT_COLORS[Math.abs(dateSeed(viewDate)) % ACCENT_COLORS.length];
  const todayQuote = { ...baseQuote, color: accentColor };

  // ── Actions (mutate DB + refresh) ──
  // All log writes go into viewDate, NOT today — so toggling a habit while
  // looking at "ayer" updates yesterday's log. New logs snapshot the current
  // habit target/unit so later target changes don't retro-invalidate them.
  const upsertLog = async (habitId, value) => {
    const habit = dbHabits.find(h => h.id === habitId);
    const existing = await db.logs.where('[habitId+date]').equals([habitId, viewDate]).first();
    if (existing) {
      // Don't touch target/unit on update — keep the original snapshot
      await db.logs.update(existing.id, { value, timestamp: Date.now() });
    } else {
      await db.logs.add({
        habitId, date: viewDate, value,
        target: habit?.target ?? null,
        unit: habit?.unit ?? null,
        timestamp: Date.now(),
      });
    }
    refresh();
  };

  const toggleBinary = (id) => {
    const log = viewLogByHabit.get(id);
    const next = !(log && log.value === true);
    upsertLog(id, next);
  };

  const incrementHabit = (id) => {
    const h = dbHabits.find(x => x.id === id);
    if (!h || h.type === 'binary') return;
    const log = viewLogByHabit.get(id);
    const cur = log ? (log.value || 0) : 0;
    const step = h.step || (h.type === 'duration' ? 5 : 1);
    upsertLog(id, Math.min(h.target, cur + step));
  };

  const decrementHabit = (id) => {
    const h = dbHabits.find(x => x.id === id);
    if (!h || h.type === 'binary') return;
    const log = viewLogByHabit.get(id);
    const cur = log ? (log.value || 0) : 0;
    const step = h.step || (h.type === 'duration' ? 5 : 1);
    upsertLog(id, Math.max(0, cur - step));
  };

  const tapBubble = (habit) => {
    if (habit.type === 'binary') return toggleBinary(habit.id);
    if ((habit.value ?? 0) >= habit.target) return decrementHabit(habit.id);
    return incrementHabit(habit.id);
  };

  // Wizard handlers
  const addIdentity = async (label, color, description = '') => {
    const id = await db.identities.add({
      name: label, color, description, createdAt: Date.now(),
    });
    // Optimistically update in-memory IDENTITIES so the wizard sees the new chip
    IDENTITIES[String(id)] = { label, color, soft: hexToRgba(color, 0.16) };
    refresh();
    return String(id);
  };

  const deleteIdentity = async (key) => {
    if (key === 'sinId') return;
    const idNum = Number(key);
    await db.identities.delete(idNum);
    await db.habits.where({ identityId: idNum }).modify({ identityId: null });
    refresh();
  };

  const addRoutine = async (name, color = null) => {
    if (routines.find(r => r.name === name)) return;
    const order = routines.length;
    await db.routines.add({ name, order, color });
    refresh();
  };

  const deleteRoutine = async (name) => {
    const r = routines.find(x => x.name === name);
    if (!r) return;
    await db.routines.delete(r.id);
    await db.habits.where({ routineId: r.id }).modify({ routineId: null });
    refresh();
  };

  // Swap a routine with its neighbor in the order. direction: 'up' or 'down'.
  // Routines are sorted by `order` ascending — "up" means smaller `order` (earlier).
  const moveRoutine = async (name, direction) => {
    const sorted = [...routines].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(r => r.name === name);
    if (idx < 0) return;
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= sorted.length) return;
    const a = sorted[idx], b = sorted[swap];
    await db.routines.update(a.id, { order: b.order });
    await db.routines.update(b.id, { order: a.order });
    refresh();
  };

  // Day letter → dow index for the schedule built from the wizard.
  const DAY_LETTER_TO_DOW = { D: 0, L: 1, M: 2, X: 3, J: 4, V: 5, S: 6 };
  const buildScheduleFromDraft = (draft) => {
    if (draft.freqMode === 'week') {
      return { type: 'timesPerWeek', days: null, timesPerWeek: draft.timesPerWeek || 5 };
    }
    return {
      type: 'specificDays',
      days: (draft.selectedDays || []).map(l => DAY_LETTER_TO_DOW[l]).filter(d => d !== undefined),
      timesPerWeek: null,
    };
  };

  // Unified create OR update — depends on whether we're in edit mode.
  // KEY: editing NEVER touches createdAt or the archived flag, so history
  // and stats are preserved when a habit is renamed / restyled.
  const handleSubmit = async (draft) => {
    const identityIdNum = (draft.identity === 'sinId' || !draft.identity) ? null : Number(draft.identity);
    const routineObj = routines.find(r => r.name === draft.routine);
    const dbType = draft.type === 'quant' ? 'quantitative' : draft.type;
    const schedule = buildScheduleFromDraft(draft);

    const iconFor = (action) => {
      const a = action.toLowerCase();
      // Mind / breath
      if (/medita|mindful|atenci/.test(a)) return 'meditate';
      if (/respirar|breath|wim hof/.test(a)) return 'breath';
      // Movement
      if (/yoga|estirar|stretch/.test(a)) return 'yoga';
      if (/correr|trotar|carrera|maratón|5km|10km/.test(a)) return 'run';
      if (/caminar|pasear|caminata|pasos/.test(a)) return 'walk';
      if (/gym|pesas|fuerza|peso|levantar/.test(a)) return 'dumbbell';
      if (/bici|bicicleta|ciclismo|cycle/.test(a)) return 'bike';
      if (/nadar|natac|piscina|swim/.test(a)) return 'swim';
      if (/montaña|sender|hike|escalar/.test(a)) return 'mountain';
      // Hydration / food / health
      if (/agua|tomar|beber|hidrat/.test(a)) return 'water';
      if (/fruta|sano|nutric|dieta|comer/.test(a)) return 'apple';
      if (/cocin|chef|recet/.test(a)) return 'cook';
      if (/café|coffee/.test(a)) return 'coffee';
      if (/medic|pastilla|vitamin|suplement/.test(a)) return 'pill';
      // Mind / creative
      if (/leer|libro|pág|estudiar|aprend/.test(a)) return 'book';
      if (/guitarra|piano|instrumento/.test(a)) return 'guitar';
      if (/escuchar.*música|música|cantar/.test(a)) return 'music';
      if (/código|programar|coding|bug/.test(a)) return 'code';
      if (/pintar|dibujar|arte|pincel/.test(a)) return 'art';
      if (/escribir|journal|diario|hablar/.test(a)) return 'chat';
      // Care
      if (/skin|crema|cuidado/.test(a)) return 'skin';
      if (/dormir|sueño|cama/.test(a)) return 'bed';
      if (/sol|amanecer|mañana/.test(a)) return 'sun';
      if (/redes|teléfono|phone|celular|tiktok|insta/.test(a)) return 'phone';
      if (/dinero|ahorr|finan|presupuesto/.test(a)) return 'money';
      if (/mascota|perro|gato|pet/.test(a)) return 'paw';
      return 'yoga';
    };
    // No truncation here — let the bubble's CSS line-clamp handle visual
    // overflow. Previous version sliced to 2 words and lost critical info.
    const shortFor = (action) => action.toLowerCase().trim();

    const fields = {
      identityId: identityIdNum,
      routineId: routineObj ? routineObj.id : null,
      iWill: draft.iWillAction,
      soThatICanBecome: draft.becomePerson ?? '',
      type: dbType,
      target: dbType === 'binary' ? null : (draft.target ?? null),
      unit: dbType === 'binary' ? null : (draft.unit ?? null),
      step: draft.type === 'duration' ? 5 : (draft.type === 'binary' ? null : (draft.target <= 5 ? 0.25 : 1)),
      schedule,
      isCornerstone: !!draft.cornerstone,
      icon: draft.icon || iconFor(draft.iWillAction),
      short: shortFor(draft.iWillAction),
    };

    if (editingHabitId !== null) {
      // UPDATE — preserve createdAt, archived, routineOrder
      await db.habits.update(editingHabitId, fields);
      setEditingHabitId(null);
      setCreating(false);
    } else {
      // CREATE — new habit. Anchor createdAt to the forge-date the user is
      // currently viewing (noon of that day) so creating a habit while
      // looking at tomorrow makes it start tomorrow, not retroactively today.
      const createdAt = parseForgeDate(viewDate).getTime() + 12 * 60 * 60 * 1000;
      await db.habits.add({
        ...fields,
        routineOrder: 999,
        archived: false,
        createdAt,
      });
      setCreating(false);
    }
    refresh();
  };

  const archiveHabit = async (id) => {
    await db.habits.update(id, { archived: true });
    refresh();
  };

  const unarchiveHabit = async (id) => {
    await db.habits.update(id, { archived: false });
    refresh();
  };

  const duplicateHabit = async (id) => {
    const orig = dbHabits.find(h => h.id === id);
    if (!orig) return null;
    const { id: _drop, ...rest } = orig;
    const newId = await db.habits.add({
      ...rest,
      iWill: orig.iWill + ' (copia)',
      createdAt: Date.now(),
      archived: false,
    });
    refresh();
    return newId;
  };

  const deleteHabit = async (id) => {
    await db.habits.delete(id);
    await db.logs.where({ habitId: id }).delete();
    refresh();
  };

  const saveMood = async ({ score, note }) => {
    const existing = await db.moodEntries.where('date').equals(today).first();
    if (existing) {
      await db.moodEntries.update(existing.id, { score, note, timestamp: Date.now() });
    } else {
      await db.moodEntries.add({ date: today, score, note, timestamp: Date.now() });
    }
    refresh();
  };

  // ── Sub-screens ──

  // Habit detail
  if (detailHabitId !== null) {
    const dbHabit = dbHabits.find(h => h.id === detailHabitId);
    if (!dbHabit) {
      setDetailHabitId(null);
      return null;
    }
    const uiHabit = toUiHabit(dbHabit, viewLogByHabit.get(dbHabit.id), routineNameById);
    const logsForHabit = logs.filter(l => l.habitId === dbHabit.id);
    const rawHist = habitHistory(dbHabit, logsForHabit, today, 365);
    const history = toLegacyHistory(rawHist, dbHabit);
    return (
      <div style={{
        minHeight: '100%', background: C.bg, color: C.ink,
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        display: 'flex', flexDirection: 'column',
      }}>
        <HabitDetail
          habit={uiHabit}
          history={history}
          onBack={() => setDetailHabitId(null)}
          onDelete={async () => {
            if (!confirm('¿Eliminar este hábito? Esta acción borra todo el historial.')) return;
            await deleteHabit(detailHabitId);
            setDetailHabitId(null);
          }}
          onEdit={() => {
            setEditingHabitId(detailHabitId);
            setCreating(true);
            setDetailHabitId(null);
          }}
          onArchive={async () => {
            if (!confirm('¿Archivar este hábito? Se ocultará pero se mantiene el historial.')) return;
            await archiveHabit(detailHabitId);
            setDetailHabitId(null);
          }}
          onDuplicate={async () => {
            await duplicateHabit(detailHabitId);
            setDetailHabitId(null);
          }}
        />
      </div>
    );
  }

  // Create habit (also used for editing — see editingHabitId)
  if (creating) {
    const editingDbHabit = editingHabitId !== null ? dbHabits.find(h => h.id === editingHabitId) : null;
    const editingHabitForWizard = editingDbHabit ? {
      ...editingDbHabit,
      routineName: routineNameById.get(editingDbHabit.routineId) ?? null,
    } : null;
    return (
      <div style={{
        height: '100vh', maxHeight: '100dvh', overflow: 'hidden',
        background: C.bg, color: C.ink,
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        display: 'flex', flexDirection: 'column',
      }}>
        <CreateHabit
          allHabits={uiHabits}
          identities={IDENTITIES}
          routines={ROUTINES}
          routineColorByName={routineColorByName}
          editingHabit={editingHabitForWizard}
          onCancel={() => { setCreating(false); setEditingHabitId(null); }}
          onCreate={handleSubmit}
          onAddIdentity={addIdentity}
          onDeleteIdentity={deleteIdentity}
          onAddRoutine={addRoutine}
          onDeleteRoutine={deleteRoutine}
          onMoveRoutine={moveRoutine}
        />
      </div>
    );
  }

  // Stats / Identities / Settings render alongside the floating TabPill below.
  // Settings is the only "tab screen" without the pill (it's accessed via dots).
  if (screen === 'stats') {
    return (
      <>
        <StatsScreen
          onBack={() => setScreen('home')}
          data={data}
          onGoToDate={(forgeDateStr) => {
            // Compute days between today and target by walking forward/back.
            // Forge-dates are YYYY-MM-DD strings so we can parse and diff in
            // ms / day. Target in the future is allowed but clamped to 0.
            const a = parseForgeDate(data.today).getTime();
            const b = parseForgeDate(forgeDateStr).getTime();
            const diff = Math.round((b - a) / (24 * 60 * 60 * 1000));
            setDateOffset(diff);
            setScreen('home');
          }}
        />
        <TabPill current={screen} onSelect={setScreen} />
      </>
    );
  }
  if (screen === 'identities') {
    return (
      <>
        <IdentitiesScreen onBack={() => setScreen('home')} data={data} refresh={refresh} />
        <TabPill current={screen} onSelect={setScreen} />
      </>
    );
  }
  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('home')} data={data} refresh={refresh} />;
  }
  if (screen === 'archived') {
    return (
      <ArchivedScreen
        onBack={() => setScreen('home')}
        data={data}
        onUnarchive={unarchiveHabit}
        onDelete={deleteHabit}
      />
    );
  }

  // ── Home (default) ──

  // Group pending habits by routine — order follows ROUTINES (which is
  // synced from db.routines.order), so reordering routines in the manager
  // shows up here. __none__ goes last if any habits lack a routine.
  const pendingHabits = uiHabits.filter(h => !isDone(h));
  const completed = uiHabits.filter(isDone);
  const groups = {};
  for (const r of ROUTINES) groups[r] = [];
  groups['__none__'] = [];
  pendingHabits.forEach((h) => {
    const key = h.routine ?? '__none__';
    if (!groups[key]) groups[key] = [];
    groups[key].push(h);
  });
  const order = ROUTINES.filter(r => groups[r] && groups[r].length > 0);
  if (groups['__none__'].length > 0) order.push('__none__');
  const groupedPending = order.map(k => ({ key: k, habits: groups[k] }));

  const routineTotal = (k) => uiHabits.filter(h => (h.routine ?? '__none__') === k).length;
  const routineDone = (k) => uiHabits.filter(h => (h.routine ?? '__none__') === k && isDone(h)).length;
  const labelFor = (k) => k === '__none__' ? 'sin rutina' : k.toLowerCase();

  // Mood prompt visibility — only when actually viewing today, not when
  // navigating to yesterday/tomorrow with the date stepper.
  const now = new Date();
  const moodHour = settings.moodPromptHour ?? 20;
  const showMoodPrompt = dateOffset === 0 && !moodToday && !moodDismissed && now.getHours() >= moodHour;

  return (
    <>
    <div style={{
      minHeight: '100%', background: C.bg, color: C.ink,
      fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
      paddingBottom: 80, position: 'relative',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Top bar — dots open a small popover: archivados + ajustes */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        padding: '12px 14px 0', minHeight: 32, position: 'relative',
      }}>
        <button
          onClick={() => setTopMenuOpen(o => !o)}
          aria-label="opciones"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 10, color: C.ink70,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Glyph name="dots" size={20} />
        </button>
        {topMenuOpen && (
          <>
            <div onClick={() => setTopMenuOpen(false)} style={{
              position: 'fixed', inset: 0, zIndex: 18,
            }}/>
            <div style={{
              position: 'absolute', top: 42, right: 14, zIndex: 19,
              background: '#1A1917',
              border: `1px solid ${C.hairlineStrong}`,
              minWidth: 160, padding: '6px 0',
              boxShadow: '0 8px 24px rgba(0,0,0,0.40)',
            }}>
              {[
                { label: 'archivados', target: 'archived' },
                { label: 'ajustes',    target: 'settings' },
              ].map((it) => (
                <button
                  key={it.target}
                  onClick={() => { setTopMenuOpen(false); setScreen(it.target); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '10px 16px', background: 'transparent', border: 'none',
                    color: C.ink, fontFamily: 'inherit',
                    fontSize: 13, fontWeight: 500, cursor: 'pointer',
                    letterSpacing: -0.05,
                  }}
                >{it.label}</button>
              ))}
            </div>
          </>
        )}
      </div>

      <Header
        view={view} setView={setView}
        streak={gStreak} streakMark="flame"
        quote={todayQuote}
        dateOffset={dateOffset} setDateOffset={setDateOffset}
      />

      {dateOffset === 0
        ? <DayProgressBanner progress={dayProgress} />
        : <div style={{ height: 14 }} />}

      {install.available && (
        <button
          onClick={install.promptInstall}
          style={{
            margin: '0 20px 8px', padding: '10px 14px',
            background: 'transparent', border: `1px solid ${C.hairlineStrong}`,
            color: C.ink70, fontFamily: 'Inter', fontSize: 12,
            letterSpacing: 0.3, cursor: 'pointer', textAlign: 'left',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>instalar forge en tu inicio</span>
          <Glyph name="arrow" size={14} color={C.ink70} />
        </button>
      )}

      {showMoodPrompt && (
        <MoodPromptCard
          onSave={async (m) => { await saveMood(m); setMoodDismissed(true); }}
          onDismiss={() => setMoodDismissed(true)}
        />
      )}

      {uiHabits.length === 0 ? (
        <div style={{
          padding: '60px 30px', textAlign: 'center', color: C.ink50,
        }}>
          <p style={{ fontSize: 15, lineHeight: 1.5, margin: 0 }}>
            {dateOffset === 0
              ? 'no tienes hábitos todavía.'
              : 'no hay hábitos programados para este día.'}
          </p>
          {dateOffset === 0 && (
            <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: '10px 0 0', color: C.ink35 }}>
              presiona + para crear el primero.
            </p>
          )}
        </div>
      ) : view === 'bubbles' ?
        <BubblesView habits={uiHabits} onTap={tapBubble} /> :
        <>
          {groupedPending.map((group) => {
            const isCollapsed = !!collapsed[group.key];
            return (
              <section key={group.key} style={{ paddingBottom: 4 }}>
                <RoutineHeader
                  name={labelFor(group.key)}
                  doneCount={routineDone(group.key)}
                  total={routineTotal(group.key)}
                  collapsed={isCollapsed}
                  color={routineColorByName.get(group.key) ?? null}
                  onToggle={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
                />
                {!isCollapsed && group.habits.map((h) =>
                  <HabitRow
                    key={h.id} habit={h}
                    onToggle={toggleBinary}
                    onIncrement={incrementHabit}
                    onDecrement={decrementHabit}
                    onSelect={(habit) => setDetailHabitId(habit.id)}
                  />
                )}
              </section>
            );
          })}

          {completed.length > 0 && (
            <section style={{ paddingTop: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '0 20px 8px',
              }}>
                <span style={{
                  fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
                  color: C.ink35, fontWeight: 500,
                }}>
                  completados hoy · {completed.length}
                </span>
                <span style={{ flex: 1, height: 1, background: C.hairline }} />
              </div>
              {completed.map((h) =>
                <HabitRow
                  key={h.id} habit={h}
                  onToggle={toggleBinary}
                  onIncrement={incrementHabit}
                  onDecrement={decrementHabit}
                  onSelect={(habit) => setDetailHabitId(habit.id)}
                  completed
                />
              )}
            </section>
          )}
        </>
      }

      <div style={{ flex: 1, minHeight: 24 }} />

      </div>
    <TabPill current={screen} onSelect={setScreen} onCreate={() => setCreating(true)} />
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Mount
// ─────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
