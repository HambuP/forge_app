// ─────────────────────────────────────────────────────────────
// FORGE — Business logic (pure, no React, no DOM)
// ─────────────────────────────────────────────────────────────
// Day classification:
//   PERFECT — 100% of scheduled habits completed
//   GOOD    — ≥70% AND all scheduled cornerstones completed
//   REGULAR — otherwise
//   NEUTRAL — no habits scheduled that day (preserves streak)
// ─────────────────────────────────────────────────────────────

const DAY_PERFECT = 'perfect';
const DAY_GOOD = 'good';
const DAY_REGULAR = 'regular';
const DAY_NEUTRAL = 'neutral';

// habit considered done given its log value. If the log was written with a
// snapshot of the target (newer logs store it), use that — so past completions
// aren't invalidated when the user later raises the target. Fall back to the
// current habit target only for legacy logs without a snapshot.
function habitIsDone(habit, log) {
  if (!log) return false;
  if (habit.type === 'binary') return log.value === true;
  const target = log.target ?? habit.target;
  return (log.value ?? 0) >= target;
}

// Returns 0..1
function habitProgress(habit, log) {
  if (!log) return 0;
  if (habit.type === 'binary') return log.value ? 1 : 0;
  const target = log.target ?? habit.target;
  return Math.min(1, Math.max(0, (log.value ?? 0) / target));
}

function isScheduledOn(habit, forgeDateStr) {
  // Habit didn't exist before its creation date — no phantom "missed" days.
  if (habit.createdAt) {
    // Use rollover 3 (default); good enough for the comparison since habits
    // created late at night are still associated with the previous forge-day.
    const createdForgeDate = forgeDateOf(new Date(habit.createdAt), 3);
    if (forgeDateStr < createdForgeDate) return false;
  }
  const dow = dowOfForgeDate(forgeDateStr);
  const s = habit.schedule;
  if (!s) return true;
  if (s.type === 'specificDays') return (s.days || []).includes(dow);
  if (s.type === 'timesPerWeek') return true; // any day counts
  return true;
}

// Classify a day given habits and logs for that day.
function classifyDay(habits, logsForDay) {
  const scheduled = habits.filter(h => !h.archived && isScheduledOn(h, logsForDay.date));
  if (scheduled.length === 0) return DAY_NEUTRAL;

  const logMap = new Map(logsForDay.logs.map(l => [l.habitId, l]));
  let doneCount = 0;
  const cornerstones = scheduled.filter(h => h.isCornerstone);
  let cornerstoneDone = 0;

  for (const h of scheduled) {
    if (habitIsDone(h, logMap.get(h.id))) doneCount++;
  }
  for (const h of cornerstones) {
    if (habitIsDone(h, logMap.get(h.id))) cornerstoneDone++;
  }

  const ratio = doneCount / scheduled.length;
  const allCornerstonesDone = cornerstones.length === 0 || cornerstoneDone === cornerstones.length;

  if (ratio >= 0.9999) return DAY_PERFECT;
  if (ratio >= 0.7 && allCornerstonesDone) return DAY_GOOD;
  return DAY_REGULAR;
}

// Per-habit streak: counts consecutive scheduled days where habit was done,
// going backwards from `endDate` (inclusive). Days where habit wasn't
// scheduled are skipped (don't break streak). Stop at first scheduled day
// that wasn't done.
function habitStreak(habit, logsByDate, endDate, maxLookback = 365) {
  let streak = 0;
  let cursor = endDate;
  for (let i = 0; i < maxLookback; i++) {
    if (!isScheduledOn(habit, cursor)) {
      cursor = addDays(cursor, -1);
      continue;
    }
    const log = (logsByDate.get(cursor) || []).find(l => l.habitId === habit.id);
    if (habitIsDone(habit, log)) {
      streak++;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

// Longest historical streak by walking forward from earliest log date.
function habitLongestStreak(habit, allLogsForHabit, todayDate) {
  if (allLogsForHabit.length === 0) return 0;
  const dates = allLogsForHabit.map(l => l.date).sort();
  const start = dates[0];
  let cursor = start;
  let cur = 0, max = 0;
  // walk forward until today
  while (cursor <= todayDate) {
    if (isScheduledOn(habit, cursor)) {
      const log = allLogsForHabit.find(l => l.date === cursor);
      if (habitIsDone(habit, log)) {
        cur++;
        if (cur > max) max = cur;
      } else {
        cur = 0;
      }
    }
    cursor = addDays(cursor, 1);
  }
  return max;
}

// Global streak: counts consecutive perfect/good days going backwards.
// Regular breaks. Neutral preserves (doesn't count nor break).
function globalStreak(habits, logsGroupedByDate, endDate, maxLookback = 365) {
  let streak = 0;
  let cursor = endDate;
  for (let i = 0; i < maxLookback; i++) {
    const logs = logsGroupedByDate.get(cursor) || [];
    const cls = classifyDay(habits, { date: cursor, logs });
    if (cls === DAY_PERFECT || cls === DAY_GOOD) {
      streak++;
      cursor = addDays(cursor, -1);
    } else if (cls === DAY_NEUTRAL) {
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

// Longest-ever global streak: walks from the earliest log forward, counting
// consecutive perfect/good days (neutral preserves, regular breaks).
function globalLongestStreak(habits, logsGroupedByDate, todayDate, maxLookback = 365) {
  // Find the earliest log date to know where to start walking.
  let earliest = todayDate;
  for (const d of logsGroupedByDate.keys()) {
    if (d < earliest) earliest = d;
  }
  if (earliest === todayDate && (logsGroupedByDate.get(todayDate) || []).length === 0) {
    return 0;
  }
  let cur = 0, max = 0;
  let cursor = earliest;
  // walk forward to today
  while (cursor <= todayDate) {
    const logs = logsGroupedByDate.get(cursor) || [];
    const cls = classifyDay(habits, { date: cursor, logs });
    if (cls === DAY_PERFECT || cls === DAY_GOOD) {
      cur++;
      if (cur > max) max = cur;
    } else if (cls === DAY_NEUTRAL) {
      // neutral preserves but doesn't add — same semantics as globalStreak
    } else {
      cur = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return max;
}

// Group logs by date for fast lookups
function groupLogsByDate(logs) {
  const m = new Map();
  for (const l of logs) {
    if (!m.has(l.date)) m.set(l.date, []);
    m.get(l.date).push(l);
  }
  return m;
}

// Compute % completion of a habit over the last N days (only counts
// scheduled days within that window).
function completionRate(habit, logsForHabit, todayDate, days) {
  const logMap = new Map(logsForHabit.map(l => [l.date, l]));
  let scheduled = 0, done = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(todayDate, -i);
    if (!isScheduledOn(habit, d)) continue;
    scheduled++;
    if (habitIsDone(habit, logMap.get(d))) done++;
  }
  return { scheduled, done, rate: scheduled ? done / scheduled : 0 };
}

// History array of last N days for a habit, for heatmap/calendar/trend.
// Each entry: { date, scheduled, value, target, done, progress }
function habitHistory(habit, logsForHabit, todayDate, days) {
  const logMap = new Map(logsForHabit.map(l => [l.date, l]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(todayDate, -i);
    const scheduled = isScheduledOn(habit, d);
    const log = logMap.get(d);
    out.push({
      date: d,
      scheduled,
      value: log ? log.value : (habit.type === 'binary' ? false : 0),
      target: log?.target ?? habit.target,
      unit: log?.unit ?? habit.unit,
      done: scheduled && habitIsDone(habit, log),
      progress: scheduled ? habitProgress(habit, log) : 0,
    });
  }
  return out;
}

// Daily classifications over last N days for global stats
function dayClassificationsHistory(habits, logsGrouped, todayDate, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(todayDate, -i);
    const logs = logsGrouped.get(d) || [];
    out.push({ date: d, classification: classifyDay(habits, { date: d, logs }) });
  }
  return out;
}

Object.assign(window, {
  DAY_PERFECT, DAY_GOOD, DAY_REGULAR, DAY_NEUTRAL,
  habitIsDone, habitProgress, isScheduledOn,
  classifyDay, habitStreak, habitLongestStreak, globalStreak, globalLongestStreak,
  groupLogsByDate, completionRate, habitHistory, dayClassificationsHistory,
});
