/* global React, ReactDOM, AndroidDevice, TweaksPanel, useTweaks, TweakSection, TweakRadio, TweakToggle */

const { useState, useMemo } = React;

// ─────────────────────────────────────────────────────────────
// Design tokens
// ─────────────────────────────────────────────────────────────
// Dark palette — warm near-black + off-white inks.
const C = {
  bg: '#0F0F0E',
  ink: '#ECEBE5',
  ink70: '#A5A49D',
  ink50: '#72716A',
  ink35: '#52514B',
  inkBorder: 'rgba(236,235,229,0.22)',
  hairline: 'rgba(236,235,229,0.07)',
  hairlineStrong: 'rgba(236,235,229,0.14)'
};

// Identity colors — same hues, slightly lifted luminance for dark surface.
// `sinId` is the permanent fallback used when a habit's identity is deleted.
// Module-level `let` so the wizard's managers can mutate it; App's tick state
// re-renders the tree when the shape changes.
let IDENTITIES = {
  atleta: {
    label: 'atleta fuerte',
    color: '#9CB5A4', // sage
    soft: 'rgba(156, 181, 164, 0.16)'
  },
  mente: {
    label: 'mente clara',
    color: '#A3B5C4', // dusty blue
    soft: 'rgba(163, 181, 196, 0.16)'
  },
  disciplinada: {
    label: 'persona disciplinada',
    color: '#CFA48F', // soft terracotta
    soft: 'rgba(207, 164, 143, 0.18)'
  },
  sinId: {
    label: 'sin identidad',
    color: '#7E7D75',
    soft: 'rgba(126, 125, 117, 0.12)'
  }
};

let ROUTINES = ['Mañana', 'Tarde'];

const hexToRgba = (hex, alpha) => {
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return `rgba(124,124,118,${alpha})`;
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const streakHelpers = {
  current: (h) => {
    let c = 0;
    for (let i = h.length - 1; i >= 0; i--) {
      if (h[i].value >= h[i].target) c++; else break;
    }
    return c;
  },
  best: (h) => {
    let best = 0, cur = 0;
    for (const d of h) {
      if (d.value >= d.target) { cur++; if (cur > best) best = cur; }
      else cur = 0;
    }
    return best;
  },
  completedIn: (h, n) => h.slice(-n).filter((d) => d.value >= d.target).length,
};

const heatColor = (d, idn) => {
  if (!d || !d.date) return 'transparent';
  if (d.scheduled === false) return 'transparent';  // day before habit existed → blank cell
  const p = d.value / d.target;
  if (p === 0) return 'rgba(236,235,229,0.05)';
  if (p < 0.4) return hexToRgba(idn.color, 0.20);
  if (p < 0.7) return hexToRgba(idn.color, 0.42);
  if (p < 1)   return hexToRgba(idn.color, 0.65);
  return hexToRgba(idn.color, 0.88);
};

const SPANISH_DOWS = ['dom','lun','mar','mié','jue','vie','sáb'];
const SPANISH_MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const formatLogDate = (date) => `${SPANISH_DOWS[date.getDay()]} ${date.getDate()} ${SPANISH_MONTHS_SHORT[date.getMonth()]}`;

// initialHabits removed — habits now load from IndexedDB.

const isDone = (h) => {
  if (h.type === 'binary') return !!h.done;
  return (h.value ?? 0) >= h.target;
};

// ─────────────────────────────────────────────────────────────
// Icons — minimal geometric line glyphs (18px, stroke 1.5)
// ─────────────────────────────────────────────────────────────
const Glyph = ({ name, size = 18, color = 'currentColor', strokeWidth = 1.4 }) => {
  const s = {
    width: size, height: size, fill: 'none', stroke: color,
    strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round'
  };
  switch (name) {
    case 'yoga':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="12" cy="6" r="2.2" />
        <path d="M4 19 C 6.5 13 9 11.5 12 11.5 S 17.5 13 20 19" />
      </svg>;
    case 'water':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M12 3 C 8.5 8.5 5.5 12 5.5 15.5 A 6.5 6.5 0 0 0 18.5 15.5 C 18.5 12 15.5 8.5 12 3 z" />
      </svg>;
    case 'book':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M12 6.5 V 20" />
        <path d="M3.5 5 H 9 a 3 3 0 0 1 3 3 v 12" />
        <path d="M20.5 5 H 15 a 3 3 0 0 0 -3 3" />
        <path d="M3.5 5 V 18 h 6" />
        <path d="M20.5 5 V 18 h -6" />
      </svg>;
    case 'guitar':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M15 3 l 3 3 l -3 1 l 1 3 l -3 -1" />
        <path d="M12 9 l -3 3" />
        <ellipse cx="8" cy="15.5" rx="4.5" ry="5" />
        <circle cx="8" cy="15.5" r="1.4" />
      </svg>;
    case 'run':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="16" cy="4.5" r="1.8" />
        <path d="M8 21 l 3.5 -5.5 l -2 -3 l 3 -3 l 3 3.5 l 2.5 0.5" />
        <path d="M4.5 13.5 l 3.5 0" />
      </svg>;
    case 'skin':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M10 3.5 h 4 v 2.5 h -4 z" />
        <rect x="7.5" y="6" width="9" height="14.5" rx="2" />
        <path d="M7.5 11.5 h 9" />
      </svg>;
    case 'phone':
      return <svg viewBox="0 0 24 24" {...s}>
        <rect x="7.5" y="3" width="9" height="18" rx="2" />
        <path d="M10.5 18 h 3" />
        <path d="M4 4.5 L 20 19.5" />
      </svg>;
    case 'plus':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M12 6 V 18" /><path d="M6 12 H 18" />
      </svg>;
    case 'chev':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M9 6 l 6 6 l -6 6" />
      </svg>;
    case 'list':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M5 7 H 19" /><path d="M5 12 H 19" /><path d="M5 17 H 19" />
      </svg>;
    case 'bubbles':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="7" cy="9" r="3" />
        <circle cx="16" cy="8" r="2.2" />
        <circle cx="12" cy="16" r="2.5" />
      </svg>;
    case 'check':
      return <svg viewBox="0 0 24 24" {...s} strokeWidth={2}>
        <path d="M5 12.5 l 4.5 4 l 10 -9" />
      </svg>;
    case 'minus':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M6 12 H 18" />
      </svg>;
    case 'close':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M6 6 L 18 18"/><path d="M18 6 L 6 18"/>
      </svg>;
    case 'clock':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="12" cy="12" r="8"/>
        <path d="M12 8 V 12 L 15 13.5"/>
      </svg>;
    case 'quant':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M5 18 V 20"/>
        <path d="M12 12 V 20"/>
        <path d="M19 6 V 20"/>
      </svg>;
    case 'arrow':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M5 12 H 19"/>
        <path d="M14 6 L 20 12 L 14 18"/>
      </svg>;
    case 'flame':
      // Stylised line flame — teardrop outline with an inner tongue fold.
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M12 3 C 9 7 7 9.5 7 13.5 A 5 5 0 0 0 17 13.5 C 17 11 14.8 9.5 13 8 C 13 9.5 12.5 10 11.8 10 C 11.8 7.5 12.6 5.5 12 3 Z"/>
      </svg>;
    case 'dots':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>
      </svg>;
    case 'meditate':
      // Stylized lotus: center dot with 5 petals radiating up + base line
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="12" cy="11" r="1.2" fill="currentColor" stroke="none"/>
        <path d="M12 11 V 6"/>
        <path d="M12 11 L 8.2 7.5"/>
        <path d="M12 11 L 15.8 7.5"/>
        <path d="M12 11 L 7.5 13.5"/>
        <path d="M12 11 L 16.5 13.5"/>
        <path d="M4 18 H 20"/>
      </svg>;
    case 'dumbbell':
      return <svg viewBox="0 0 24 24" {...s}>
        <rect x="3.5" y="8.5" width="2.2" height="7" rx="0.6"/>
        <rect x="5.7" y="10" width="1.8" height="4" rx="0.4"/>
        <path d="M7.5 12 H 16.5"/>
        <rect x="16.5" y="10" width="1.8" height="4" rx="0.4"/>
        <rect x="18.3" y="8.5" width="2.2" height="7" rx="0.6"/>
      </svg>;
    case 'bike':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="6" cy="16.5" r="3.2"/>
        <circle cx="18" cy="16.5" r="3.2"/>
        <path d="M9 9 L 12 16.5 H 6"/>
        <path d="M12 16.5 L 15.5 9"/>
        <path d="M14.5 9 H 17"/>
        <path d="M15.5 9 L 18 16.5"/>
      </svg>;
    case 'walk':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="13" cy="4.5" r="1.8"/>
        <path d="M11 7.5 L 9 13.5 L 7 19"/>
        <path d="M11 7.5 L 14 12 V 19"/>
        <path d="M13.5 10 L 16.5 12"/>
      </svg>;
    case 'apple':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M12 8.5 C 11 8.5 9.5 7.5 7.5 7.5 C 5 7.5 4 10 4 12.5 C 4 16 6 20 9 20 C 10.5 20 11 19 12 19 C 13 19 13.5 20 15 20 C 18 20 20 16 20 12.5 C 20 10 19 7.5 16.5 7.5 C 14.5 7.5 13 8.5 12 8.5 Z"/>
        <path d="M12 8 V 5.5 C 12 4.5 13 4 14 4"/>
      </svg>;
    case 'coffee':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M5.5 9.5 H 17 V 16 C 17 17.7 15.5 19 14 19 H 8.5 C 7 19 5.5 17.7 5.5 16 V 9.5 Z"/>
        <path d="M17 11.5 H 19 C 20 11.5 20.5 12.5 20.5 13.5 C 20.5 14.5 20 15.5 19 15.5 H 17"/>
        <path d="M9 6.5 C 9 5 9.5 4.5 9.5 6 V 7.5"/>
        <path d="M11.5 6.5 C 11.5 5 12 4.5 12 6 V 7.5"/>
        <path d="M14 6.5 C 14 5 14.5 4.5 14.5 6 V 7.5"/>
      </svg>;
    case 'music':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="7.5" cy="17" r="2.3"/>
        <circle cx="17" cy="14.5" r="2.3"/>
        <path d="M9.8 17 V 7 L 19.3 5 V 14.5"/>
        <path d="M9.8 10 L 19.3 8"/>
      </svg>;
    case 'art':
      // Paintbrush at an angle
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M17.5 3.5 L 20.5 6.5 L 11 16 L 6.5 17.5 L 8 13 Z"/>
        <path d="M14.5 6.5 L 17.5 9.5"/>
        <path d="M8 13 L 11 16"/>
      </svg>;
    case 'code':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M9 7 L 4 12 L 9 17"/>
        <path d="M15 7 L 20 12 L 15 17"/>
      </svg>;
    case 'pill':
      // Two-toned capsule (divided in middle by a line)
      return <svg viewBox="0 0 24 24" {...s}>
        <rect x="3.5" y="8" width="17" height="8" rx="4"/>
        <path d="M12 8 V 16"/>
      </svg>;
    case 'breath':
      // Three layered wind/breath waves
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M3 8 C 7 8 9 6 12 6 C 15 6 16.5 8 18.5 8 C 19.5 8 20 7.5 20.5 6.5"/>
        <path d="M3 13 C 8 13 11 11 15 11 C 17.5 11 18.5 12.5 20 12.5"/>
        <path d="M3 18 C 6 18 9 16 13 16 C 16.5 16 17.5 17.5 19 17.5"/>
      </svg>;
    case 'droplets':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M8 3 C 6.5 6 5 8 5 10 A 3 3 0 0 0 11 10 C 11 8 9.5 6 8 3 Z"/>
        <path d="M16 11 C 14.5 14 13 15.5 13 17.5 A 3 3 0 0 0 19 17.5 C 19 15.5 17.5 14 16 11 Z"/>
      </svg>;
    case 'sun':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="12" cy="12" r="3.8"/>
        <path d="M12 3 V 5"/>
        <path d="M12 19 V 21"/>
        <path d="M3 12 H 5"/>
        <path d="M19 12 H 21"/>
        <path d="M5.5 5.5 L 7 7"/>
        <path d="M17 7 L 18.5 5.5"/>
        <path d="M5.5 18.5 L 7 17"/>
        <path d="M17 17 L 18.5 18.5"/>
      </svg>;
    case 'mountain':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M3 19 L 9 9 L 13 14 L 16 11 L 21 19 Z"/>
        <path d="M9 9 L 11 12"/>
      </svg>;
    case 'chat':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M4 6 H 20 V 16 H 10 L 6.5 19 V 16 H 4 Z"/>
      </svg>;
    case 'money':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="12" cy="12" r="8"/>
        <path d="M14.5 9.7 C 14 8.7 13 8.2 12 8.2 C 10.5 8.2 9.5 9 9.5 10 C 9.5 11 10.5 11.4 12 11.9 C 13.5 12.4 14.5 13 14.5 14 C 14.5 15 13.5 15.9 12 15.9 C 11 15.9 10 15.4 9.5 14.5"/>
        <path d="M12 7 V 8.2"/>
        <path d="M12 15.9 V 17"/>
      </svg>;
    case 'paw':
      return <svg viewBox="0 0 24 24" {...s}>
        <ellipse cx="6.5" cy="9" rx="1.5" ry="2.2"/>
        <ellipse cx="9.8" cy="6.5" rx="1.5" ry="2.2"/>
        <ellipse cx="14.2" cy="6.5" rx="1.5" ry="2.2"/>
        <ellipse cx="17.5" cy="9" rx="1.5" ry="2.2"/>
        <path d="M12 11.5 C 9.5 11.5 7.5 13.5 7.5 16 C 7.5 18 9.5 19 12 19 C 14.5 19 16.5 18 16.5 16 C 16.5 13.5 14.5 11.5 12 11.5 Z"/>
      </svg>;
    case 'bed':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M3 18 V 9"/>
        <path d="M21 18 V 12"/>
        <path d="M3 12 H 21"/>
        <path d="M3 18 H 21"/>
        <circle cx="7" cy="11" r="1.5"/>
      </svg>;
    case 'cook':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M4 11 H 20 V 17 C 20 18 19 19 18 19 H 6 C 5 19 4 18 4 17 V 11 Z"/>
        <path d="M2 11 H 22"/>
        <path d="M9 7 V 4"/>
        <path d="M12 7 V 4"/>
        <path d="M15 7 V 4"/>
      </svg>;
    case 'swim':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="17.5" cy="6.5" r="1.5"/>
        <path d="M4 13 C 6 12 8 13 10 13 C 12 13 13 12 14 11 L 17 10"/>
        <path d="M3 18 C 5 17 7 17 9 18 C 11 19 13 19 15 18 C 17 17 19 17 21 18"/>
      </svg>;
    case 'pencil':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M5 19 L 8 18.5 L 18 8.5 L 15.5 6 L 5.5 16 Z"/>
        <path d="M14 7.5 L 16.5 10"/>
      </svg>;
    case 'calendar':
      return <svg viewBox="0 0 24 24" {...s}>
        <rect x="4" y="6" width="16" height="14" rx="1.5"/>
        <path d="M8 3.5 V 7"/>
        <path d="M16 3.5 V 7"/>
        <path d="M4 11 H 20"/>
      </svg>;
    case 'chart':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M5 18 V 14"/>
        <path d="M11 18 V 9"/>
        <path d="M17 18 V 6"/>
        <path d="M4 21 H 20"/>
      </svg>;
    case 'person':
      return <svg viewBox="0 0 24 24" {...s}>
        <circle cx="12" cy="8" r="3.2"/>
        <path d="M5 20 C 5 15.5 8 13.5 12 13.5 S 19 15.5 19 20"/>
      </svg>;
    case 'leaf':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M5 19 C 5 10 12 5 19 5 C 19 14 14 19 5 19 Z"/>
        <path d="M5 19 L 14 10"/>
      </svg>;
    case 'heart':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M12 20 C 4.5 14 3 9 7 6.5 C 10 5 12 7.5 12 9.5 C 12 7.5 14 5 17 6.5 C 21 9 19.5 14 12 20 Z"/>
      </svg>;
    case 'moon':
      return <svg viewBox="0 0 24 24" {...s}>
        <path d="M19 14.5 A 8 8 0 1 1 9.5 5 A 6.5 6.5 0 0 0 19 14.5 Z"/>
      </svg>;
    default:return null;
  }
};

// ─────────────────────────────────────────────────────────────
// Streak symbol options
// ─────────────────────────────────────────────────────────────
const StreakMark = ({ kind, color = C.ink70 }) => {
  if (kind === 'none') return null;
  if (kind === 'flame') return <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 7, color, marginBottom: 2 }}>
    <Glyph name="flame" size={22} strokeWidth={1.5} />
  </span>;
  if (kind === 'dot') return <span style={{ display: 'inline-block', width: 4, height: 4, borderRadius: '50%', background: color, marginRight: 8, verticalAlign: 'middle', marginBottom: 4 }} />;
  if (kind === 'dash') return <span style={{ display: 'inline-block', width: 10, height: 1, background: color, marginRight: 8, verticalAlign: 'middle', marginBottom: 4 }} />;
  if (kind === 'underscore') return <span style={{ display: 'inline-block', width: 14, height: 2, background: color, marginRight: 8, verticalAlign: 'middle', marginBottom: -2 }} />;
  return null;
};

// ─────────────────────────────────────────────────────────────
// Date helpers (Spanish weekdays/months + relative eyebrow)
// ─────────────────────────────────────────────────────────────
const DAYS   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const MONTHS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Returns label/info for the date at `offset` days from TODAY's forge-day.
// "Forge-day" rolls over at 3am: anything before 3am still belongs to the
// previous calendar day. This keeps the displayed date in sync with the
// habit/log data which also uses forge-day semantics.
const dateInfo = (offset) => {
  const now = new Date();
  const rolloverHour = 3;
  const d = new Date(now);
  if (now.getHours() < rolloverHour) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);  // noon to avoid DST edge cases
  d.setDate(d.getDate() + offset);
  const eyebrow =
    offset === 0  ? 'Hoy' :
    offset === -1 ? 'Ayer' :
    offset === 1  ? 'Mañana' :
    cap(DAYS[d.getDay()]);
  return {
    eyebrow,
    dayName: cap(DAYS[d.getDay()]),
    dayNum: d.getDate(),
    monthName: MONTHS[d.getMonth()],
  };
};

// ─────────────────────────────────────────────────────────────
// Habit row
// ─────────────────────────────────────────────────────────────
const HabitRow = ({ habit, onToggle, onIncrement, onDecrement, onSelect, completed }) => {
  const id = IDENTITIES[habit.identity];
  const done = isDone(habit);
  const pct = habit.type !== 'binary' ? Math.min(1, (habit.value ?? 0) / habit.target) : done ? 1 : 0;

  // The icon container: cornerstones get a thicker, more visible ring.
  const iconBox =
  <div
    style={{
      width: 32, height: 32, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      borderRadius: '50%',
      border: habit.cornerstone
        ? `1.5px solid rgba(236,235,229,0.32)`
        : '1.5px solid transparent',
      color: done ? C.ink50 : C.ink70,
      transition: 'all 250ms ease-out',
    }}>
      <Glyph name={habit.icon} size={18} />
    </div>;


  // Binary control: 22px circle. Fills with identity color when checked.
  const binaryCheck =
  <button
    onClick={(e) => { e.stopPropagation(); onToggle(habit.id); }}
    aria-label={done ? 'Marcar pendiente' : 'Marcar hecho'}
    style={{
      width: 22, height: 22, padding: 0, border: 'none', background: 'transparent',
      cursor: 'pointer', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
    
      <span style={{
      width: 22, height: 22, borderRadius: '50%',
      border: `1.5px solid ${done ? id.color : C.inkBorder}`,
      background: done ? id.color : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 220ms ease-out',
      color: '#fff'
    }}>
        {done && <Glyph name="check" size={14} color="#fff" />}
      </span>
    </button>;


  // Quant/Duration control: progress bar + value + −/+ stepper
  const progressUnit = habit.unit;
  const formatVal = (v) => {
    if (habit.unit === 'L') return v.toFixed(1).replace(/\.0$/, '');
    return String(v);
  };
  const StepBtn = ({ disabled, onClick, icon, label }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      disabled={disabled}
      aria-label={label}
      style={{
        width: 24, height: 24, borderRadius: '50%',
        border: `1px solid ${C.hairlineStrong}`,
        background: 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        color: disabled ? C.ink50 : (done ? id.color : C.ink70),
        opacity: disabled ? 0.28 : 1,
        flexShrink: 0,
        transition: 'all 200ms ease-out',
        padding: 0,
      }}>
      <Glyph name={icon} size={icon === 'minus' ? 14 : 14} />
    </button>
  );
  const atFloor   = (habit.value ?? 0) <= 0;
  const atCeiling = (habit.value ?? 0) >= habit.target;
  const quantBlock =
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', minWidth: 0
  }}>
      {/* track */}
      <div style={{
      flex: 1, height: 2, borderRadius: 2, background: C.hairline,
      position: 'relative', overflow: 'hidden'
    }}>
        <div style={{
        position: 'absolute', inset: 0, width: `${pct * 100}%`,
        background: id.color, borderRadius: 2,
        transition: 'width 280ms ease-out'
      }} />
      </div>
      <span style={{
      fontVariantNumeric: 'tabular-nums', fontSize: 11.5,
      color: done ? id.color : C.ink50,
      fontWeight: 500, letterSpacing: 0.1,
      whiteSpace: 'nowrap'
    }}>
        {formatVal(habit.value)} / {habit.target}{progressUnit !== 'pág' ? progressUnit : ''}{progressUnit === 'pág' ? ' pág' : ''}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <StepBtn
          disabled={atFloor}
          onClick={() => onDecrement(habit.id)}
          icon="minus"
          label="Restar un paso"
        />
        <StepBtn
          disabled={atCeiling}
          onClick={() => onIncrement(habit.id)}
          icon="plus"
          label="Sumar un paso"
        />
      </div>
    </div>;


  return (
    <div
      onClick={() => onSelect?.(habit)}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '12px 20px',
        opacity: completed ? 0.4 : 1,
        cursor: onSelect ? 'pointer' : 'default',
        transition: 'opacity 260ms ease-out'
      }}>
      
      {iconBox}
      <div style={{ flex: 1, minWidth: 0, paddingTop: habit.type === 'binary' ? 5 : 3 }}>
        <div style={{
          fontSize: 14.5, lineHeight: 1.35,
          color: done ? C.ink50 : C.ink,
          fontWeight: 400, letterSpacing: -0.1,
          textWrap: 'pretty'
        }}>
          {habit.text}
        </div>
        {habit.type !== 'binary' &&
        <div style={{ marginTop: 8 }}>
            {quantBlock}
          </div>
        }
      </div>
      {habit.type === 'binary' &&
      <div style={{ paddingTop: 4 }}>{binaryCheck}</div>
      }
    </div>);

};

// ─────────────────────────────────────────────────────────────
// Routine section header
// ─────────────────────────────────────────────────────────────
const RoutineHeader = ({ name, doneCount, total, collapsed, onToggle, color }) =>
<button
  onClick={onToggle}
  style={{
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '20px 20px 10px',
    background: 'transparent', border: 'none', cursor: 'pointer',
    textAlign: 'left'
  }}>
  
    <span style={{
    display: 'inline-flex', transition: 'transform 220ms ease-out',
    transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
    color: C.ink50
  }}>
      <Glyph name="chev" size={11} strokeWidth={1.6} />
    </span>
    <span style={{
    fontSize: 10.5, fontWeight: 500, letterSpacing: 1.6,
    textTransform: 'uppercase', color: color ? hexToRgba(color, 0.9) : C.ink70
  }}>{name}</span>
    <span style={{
    flex: 1, height: 1,
    background: color ? hexToRgba(color, 0.35) : C.hairline,
    marginLeft: 4
  }} />
    <span style={{
    fontSize: 11, color: C.ink35, fontVariantNumeric: 'tabular-nums',
    letterSpacing: 0.2
  }}>{doneCount}/{total}</span>
  </button>;


// ─────────────────────────────────────────────────────────────
// View toggle (List / Bubbles)
// ─────────────────────────────────────────────────────────────
const ViewToggle = ({ view, setView }) => {
  const Btn = ({ k, icon }) =>
  <button
    onClick={() => setView(k)}
    aria-label={k}
    style={{
      width: 38, height: 38, padding: 0, border: 'none', cursor: 'pointer',
      background: 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: view === k ? C.ink : C.ink35,
      transition: 'color 200ms ease-out'
    }}>
    
      <Glyph name={icon} size={21} strokeWidth={view === k ? 1.6 : 1.3} />
    </button>;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      padding: 2, borderRadius: 999
    }}>
      <Btn k="list" icon="list" />
      <span style={{ width: 1, height: 16, background: C.hairline }} />
      <Btn k="bubbles" icon="bubbles" />
    </div>);

};

// ─────────────────────────────────────────────────────────────
// Date stepper (prev/next chevrons flanking eyebrow)
// ─────────────────────────────────────────────────────────────
const DateStepper = ({ eyebrow, onPrev, onNext }) => {
  const NavBtn = ({ dir, onClick, label }) => (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: 36, height: 36, padding: 0, border: 'none', background: 'transparent',
        cursor: 'pointer', color: C.ink50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'color 180ms ease-out',
      }}
      onMouseEnter={(e) => e.currentTarget.style.color = C.ink}
      onMouseLeave={(e) => e.currentTarget.style.color = C.ink50}
    >
      <span style={{ display: 'inline-flex', transform: dir === 'left' ? 'rotate(180deg)' : 'none' }}>
        <Glyph name="chev" size={15} strokeWidth={1.6} />
      </span>
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: -10, marginBottom: 2 }}>
      <NavBtn dir="left"  onClick={onPrev} label="Día anterior"/>
      <span style={{
        fontSize: 13, letterSpacing: 1.4, textTransform: 'uppercase',
        color: C.ink35, fontWeight: 500, minWidth: 44, textAlign: 'center',
      }}>{eyebrow}</span>
      <NavBtn dir="right" onClick={onNext} label="Día siguiente"/>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────
const Header = ({ view, setView, streak, streakMark, identityKey, dateOffset, setDateOffset, quote }) => {
  const id = IDENTITIES[identityKey];
  const info = dateInfo(dateOffset);
  return (
    <div style={{ padding: '24px 20px 12px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: 'flex-start', marginBottom: 14
      }}>
        <div style={{ minWidth: 0 }}>
          <DateStepper
            eyebrow={info.eyebrow}
            onPrev={() => setDateOffset((o) => o - 1)}
            onNext={() => setDateOffset((o) => o + 1)}
          />
          <h1 style={{
            margin: 0, fontSize: 28, lineHeight: 1.1,
            fontWeight: 600, letterSpacing: -0.6, color: C.ink, fontFamily: 'Inter',
          }}>
            {info.dayName} <span style={{ fontWeight: 300 }}>{info.dayNum}</span> de {info.monthName}
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 18, paddingTop: 4 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 20, fontWeight: 500, color: C.ink,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              letterSpacing: -0.4, display: 'inline-flex', alignItems: 'center',
            }}>
              <StreakMark kind={streakMark} color={C.ink}/>{streak}
            </div>
            <div style={{
              fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase',
              color: C.ink35, marginTop: 4, fontWeight: 500
            }}>días</div>
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        marginTop: 8, gap: 16,
      }}>
        {quote ? (
          <div style={{
            flex: 1, minWidth: 0,
            fontSize: 13.5, color: C.ink, lineHeight: 1.45,
            letterSpacing: -0.1, fontStyle: 'italic', fontWeight: 500,
          }}>
            "{quote.text}"
            <span style={{
              fontStyle: 'normal', color: quote.color || C.ink50, marginLeft: 6,
              fontSize: 11.5, letterSpacing: 0, fontWeight: 600,
            }}>— {quote.author}</span>
          </div>
        ) : id ? (
          <div style={{
            fontSize: 13.5, color: C.ink, letterSpacing: -0.1, fontWeight: 500,
          }}>
            hoy estás siendo{' '}
            <span style={{ color: id.color, fontWeight: 700 }}>{id.label}</span>
          </div>
        ) : <div />}
        <ViewToggle view={view} setView={setView} />
      </div>
    </div>);

};

// ─────────────────────────────────────────────────────────────
// Bubbles view — identity-grouped bubbles with liquid bottom-up fill.
// Each bubble: hairline outline + identity-color fill clipped to circle,
// icon centered, cornerstone wraps in a soft outer ring of identity color.
// ─────────────────────────────────────────────────────────────
const fmtVal = (h) => h.unit === 'L'
  ? h.value.toFixed(1).replace(/\.0$/, '')
  : String(h.value);

// Tight version of value/target for use inside the bubble.
const compactValue = (h) => {
  const v = fmtVal(h);
  if (h.unit === 'pág') return `${v}/${h.target}`;
  if (h.unit === 'min') return `${v}/${h.target}m`;
  return `${v}/${h.target}${h.unit}`;
};

const Bubble = ({ habit, onTap }) => {
  const idn = IDENTITIES[habit.identity];
  const done = isDone(habit);
  const pct = habit.type === 'binary'
    ? (done ? 1 : 0)
    : Math.min(1, (habit.value ?? 0) / habit.target);
  const size = 92;
  const clipId = `bclip-${habit.id}`;

  return (
    <button
      onClick={() => onTap(habit)}
      aria-label={habit.text}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9,
        width: 96, padding: 0, border: 'none', background: 'transparent',
        cursor: 'pointer', color: 'inherit',
        transition: 'transform 180ms ease-out',
      }}
      onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
      onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
      onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size}
             style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}>
          <defs>
            <clipPath id={clipId}>
              <circle cx="50" cy="50" r="42" />
            </clipPath>
          </defs>
          {habit.cornerstone && (
            <circle cx="50" cy="50" r="48" fill="none"
              stroke={idn.color} strokeOpacity="0.45" strokeWidth="0.9" />
          )}
          <rect x="0" y={100 - pct * 100} width="100" height={pct * 100 + 0.5}
            fill={idn.color} clipPath={`url(#${clipId})`}
            opacity={done ? 0.92 : 0.72} />
          {pct > 0 && pct < 1 && (
            <line x1="8" x2="92" y1={100 - pct * 100} y2={100 - pct * 100}
              stroke={idn.color} strokeOpacity="0.85" strokeWidth="1"
              clipPath={`url(#${clipId})`} />
          )}
          <circle cx="50" cy="50" r="42" fill="none"
            stroke={done ? idn.color : 'rgba(236,235,229,0.18)'}
            strokeWidth="1" />
        </svg>
        {/* Icon + value stacked inside bubble */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          color: done ? C.bg : C.ink,
          gap: habit.type === 'binary' ? 0 : 3,
          transition: 'color 200ms ease-out',
        }}>
          <Glyph name={habit.icon} size={habit.type === 'binary' ? 26 : 20} strokeWidth={1.5} />
          {habit.type !== 'binary' && (
            <div style={{
              fontSize: 11, fontWeight: 600, letterSpacing: 0.1,
              fontVariantNumeric: 'tabular-nums', lineHeight: 1,
            }}>
              {compactValue(habit)}
            </div>
          )}
        </div>
      </div>
      {/* Habit short name below — wraps to max 2 lines */}
      <div style={{
        fontSize: 11, color: done ? idn.color : C.ink70,
        letterSpacing: 0.05, fontWeight: done ? 600 : 500,
        textAlign: 'center', lineHeight: 1.2,
        width: '100%',
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
        overflow: 'hidden',
        wordBreak: 'break-word',
      }}>
        {habit.short}
      </div>
    </button>
  );
};

const IdentitySection = ({ identityKey, habits, onTap }) => {
  const idn = IDENTITIES[identityKey];
  const doneCount = habits.filter(isDone).length;
  return (
    <section style={{ padding: '22px 20px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <span style={{
          fontSize: 10.5, fontWeight: 600, letterSpacing: 1.6,
          textTransform: 'uppercase', color: idn.color,
        }}>{idn.label}</span>
        <span style={{ flex: 1, height: 1, background: C.hairline }} />
        <span style={{
          fontSize: 10.5, color: C.ink35, fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.2,
        }}>{doneCount}/{habits.length}</span>
      </div>
      <div style={{
        display: 'flex', flexWrap: 'wrap',
        rowGap: 22, columnGap: 10,
        justifyContent: 'flex-start',
      }}>
        {habits.map((h) => <Bubble key={h.id} habit={h} onTap={onTap} />)}
      </div>
    </section>
  );
};

const BubblesView = ({ habits, onTap }) => {
  // Built-in identities first, user-added next, sinId always last.
  const order = [
    ...Object.keys(IDENTITIES).filter((k) => k !== 'sinId'),
    'sinId',
  ];
  const groups = {};
  habits.forEach((h) => { (groups[h.identity] ??= []).push(h); });
  return (
    <div style={{ paddingBottom: 12 }}>
      {order.filter((k) => groups[k]?.length).map((k) =>
        <IdentitySection key={k} identityKey={k} habits={groups[k]} onTap={onTap} />
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Create Habit — two-step wizard
// Step 1: la promesa (Voy a... / para convertirme en... + identidad)
// Step 2: detalles (tipo, frecuencia, pilar, rutina)
// ─────────────────────────────────────────────────────────────
const ICON_OPTIONS = [
  // Movement / body
  'yoga', 'meditate', 'run', 'walk', 'dumbbell', 'bike', 'swim',
  // Hydration / food / health
  'water', 'droplets', 'apple', 'cook', 'coffee', 'pill', 'breath',
  // Mind / creative
  'book', 'music', 'guitar', 'code', 'art', 'chat',
  // Care / lifestyle
  'skin', 'bed', 'sun', 'mountain', 'phone', 'money', 'paw',
  // Abstract / mood
  'leaf', 'heart', 'moon',
];

const IconPicker = ({ value, idn, onChange }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
    {ICON_OPTIONS.map((name) => {
      const sel = value === name;
      return (
        <button
          key={name}
          onClick={() => onChange(name)}
          aria-label={`icono ${name}`}
          style={{
            aspectRatio: '1 / 1',
            background: 'transparent',
            border: sel ? `1.5px solid ${idn.color}` : `1px solid ${C.hairlineStrong}`,
            borderRadius: '50%',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: sel ? C.ink : C.ink70,
            transition: 'all 200ms ease-out',
            padding: 0, fontFamily: 'inherit',
          }}
        >
          <Glyph name={name} size={20} strokeWidth={1.5}/>
        </button>
      );
    })}
  </div>
);

const FormSection = ({ label, children }) => (
  <div>
    <div style={{
      fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
      color: C.ink35, fontWeight: 500, marginBottom: 14,
    }}>{label}</div>
    {children}
  </div>
);

const IdentityChip = ({ idn, selected, onClick, ghost, children }) => (
  <button
    onClick={onClick}
    style={{
      padding: '7px 13px', borderRadius: 999,
      background: 'transparent',
      border: selected
        ? `1.5px solid ${idn ? idn.color : C.ink}`
        : `1px solid ${C.hairlineStrong}`,
      color: ghost ? C.ink50 : (idn ? idn.color : C.ink50),
      fontSize: 13, fontWeight: selected ? 600 : 500,
      cursor: 'pointer', fontFamily: 'inherit',
      transition: 'all 200ms ease-out',
      letterSpacing: -0.05,
    }}
  >
    {children}
  </button>
);

const TypeCards = ({ value, idn, onChange }) => {
  const types = [
    { key: 'binary',   icon: 'check', label: 'binario',   sub: '1 check / día' },
    { key: 'quant',    icon: 'quant', label: 'cantidad',  sub: '2L · 5km · 20p' },
    { key: 'duration', icon: 'clock', label: 'duración',  sub: 'minutos' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {types.map((t) => {
        const sel = value === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              padding: '14px 6px 12px',
              background: sel ? idn.soft : 'transparent',
              border: sel ? `1.5px solid ${idn.color}` : `1px solid ${C.hairlineStrong}`,
              borderRadius: 2,
              cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              transition: 'all 200ms ease-out',
              color: sel ? C.ink : C.ink70,
            }}
          >
            <Glyph name={t.icon} size={20} strokeWidth={1.5}/>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: -0.05 }}>{t.label}</div>
            <div style={{ fontSize: 9.5, color: C.ink35, lineHeight: 1.2, letterSpacing: 0.1 }}>{t.sub}</div>
          </button>
        );
      })}
    </div>
  );
};

const TargetRow = ({ draft, idn, updateDraft }) => {
  const units = draft.type === 'duration'
    ? [{ key: 'min', label: 'min' }]
    : [{ key: 'L', label: 'L' }, { key: 'km', label: 'km' }, { key: 'pág', label: 'pág' }, { key: 'reps', label: 'reps' }];
  return (
    <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: C.ink50, letterSpacing: 0.05 }}>meta diaria</span>
      <input
        type="number"
        value={draft.target}
        onChange={(e) => updateDraft({ target: Number(e.target.value) || 0 })}
        style={{
          width: 64, padding: '6px 10px',
          background: 'transparent',
          border: `1px solid ${C.hairlineStrong}`, borderRadius: 2,
          color: C.ink, fontSize: 14, fontWeight: 600,
          fontFamily: 'inherit', outline: 'none',
          fontVariantNumeric: 'tabular-nums', textAlign: 'center',
        }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {units.map((u) => (
          <button
            key={u.key}
            onClick={() => updateDraft({ unit: u.key })}
            style={{
              padding: '6px 11px', borderRadius: 2,
              background: 'transparent',
              border: draft.unit === u.key ? `1.5px solid ${idn.color}` : `1px solid ${C.hairlineStrong}`,
              color: draft.unit === u.key ? C.ink : C.ink70,
              fontSize: 12, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 180ms ease-out',
            }}
          >{u.label}</button>
        ))}
      </div>
    </div>
  );
};

const FreqControl = ({ draft, idn, updateDraft }) => {
  return (
    <div>
      {/* Mode segmented */}
      <div style={{
        display: 'flex',
        border: `1px solid ${C.hairlineStrong}`,
        borderRadius: 2,
        marginBottom: 16,
        overflow: 'hidden',
      }}>
        {[{ k: 'days', l: 'días específicos' }, { k: 'weekly', l: '× por semana' }].map((opt) => {
          const sel = draft.freqMode === opt.k;
          return (
            <button
              key={opt.k}
              onClick={() => updateDraft({ freqMode: opt.k })}
              style={{
                flex: 1, padding: '9px 8px',
                background: sel ? idn.soft : 'transparent',
                border: 'none',
                color: sel ? C.ink : C.ink70,
                fontSize: 12, fontWeight: sel ? 600 : 500,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all 200ms ease-out', letterSpacing: -0.05,
              }}
            >{opt.l}</button>
          );
        })}
      </div>

      {draft.freqMode === 'days' ? (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
          {['L','M','X','J','V','S','D'].map((d) => {
            const sel = draft.selectedDays.includes(d);
            return (
              <button
                key={d}
                onClick={() => {
                  const next = sel ? draft.selectedDays.filter((x) => x !== d) : [...draft.selectedDays, d];
                  updateDraft({ selectedDays: next });
                }}
                style={{
                  width: 36, height: 36, padding: 0,
                  background: sel ? idn.color : 'transparent',
                  border: sel ? `1.5px solid ${idn.color}` : `1px solid ${C.hairlineStrong}`,
                  color: sel ? C.bg : C.ink70,
                  fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit',
                  borderRadius: '50%',
                  transition: 'all 200ms ease-out',
                }}
              >{d}</button>
            );
          })}
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: C.ink70 }}>cuántas veces</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => updateDraft({ timesPerWeek: Math.max(1, draft.timesPerWeek - 1) })}
              style={{
                width: 26, height: 26, borderRadius: '50%',
                border: `1px solid ${C.hairlineStrong}`, background: 'transparent',
                color: C.ink70, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            ><Glyph name="minus" size={14}/></button>
            <span style={{
              fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              color: C.ink, minWidth: 22, textAlign: 'center', letterSpacing: -0.2,
            }}>{draft.timesPerWeek}</span>
            <button
              onClick={() => updateDraft({ timesPerWeek: Math.min(7, draft.timesPerWeek + 1) })}
              style={{
                width: 26, height: 26, borderRadius: '50%',
                border: `1px solid ${C.hairlineStrong}`, background: 'transparent',
                color: C.ink70, cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            ><Glyph name="plus" size={14}/></button>
          </div>
        </div>
      )}
    </div>
  );
};

const Switch = ({ value, idn, disabled, onChange }) => {
  const w = 40, h = 22, dot = 14, pad = 4;
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      aria-checked={value}
      role="switch"
      style={{
        width: w, height: h, padding: 0, border: 'none',
        background: value ? idn.color : C.hairlineStrong,
        borderRadius: 999, position: 'relative',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.35 : 1,
        transition: 'background 220ms ease-out, opacity 220ms ease-out',
        flexShrink: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: pad,
        left: value ? w - dot - pad : pad,
        width: dot, height: dot, borderRadius: '50%',
        background: C.bg,
        transition: 'left 220ms ease-out',
      }}/>
    </button>
  );
};

const CornerstoneRow = ({ value, idn, atLimit, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, color: C.ink, fontWeight: 500, marginBottom: 4, letterSpacing: -0.1 }}>
        marcarlo como pilar
      </div>
      <div style={{ fontSize: 11.5, color: atLimit ? C.ink50 : C.ink50, lineHeight: 1.45, letterSpacing: 0.05 }}>
        {atLimit
          ? <>ya tienes 3 pilares activos · desmarca uno primero</>
          : <>cuenta más fuerte hacia tu identidad. máximo 3 simultáneos.</>}
      </div>
    </div>
    <Switch value={value} idn={idn} disabled={atLimit} onChange={onChange}/>
  </div>
);

const RoutinePicker = ({ value, onChange, onAddNew }) => {
  const [open, setOpen] = React.useState(false);
  const options = [null, ...ROUTINES];
  return (
    <div style={{
      borderTop: `1px solid ${C.hairline}`,
      borderBottom: `1px solid ${C.hairline}`,
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', padding: '12px 0',
          background: 'transparent', border: 'none',
          cursor: 'pointer', fontFamily: 'inherit', color: 'inherit',
        }}
      >
        <span style={{ fontSize: 14, color: value ? C.ink : C.ink50, letterSpacing: -0.05 }}>
          {value ? value.toLowerCase() : 'sin rutina'}
        </span>
        <span style={{
          display: 'inline-flex',
          transition: 'transform 200ms ease-out',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          color: C.ink50,
        }}>
          <Glyph name="chev" size={12} strokeWidth={1.6}/>
        </span>
      </button>
      {open && (
        <div style={{ paddingBottom: 4 }}>
          {options.map((r) => {
            const sel = value === r;
            return (
              <button
                key={r ?? '__none__'}
                onClick={() => { onChange(r); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '10px 0',
                  background: 'transparent', border: 'none',
                  borderTop: `1px solid ${C.hairline}`,
                  cursor: 'pointer', fontFamily: 'inherit',
                  color: sel ? C.ink : C.ink70,
                  fontSize: 13.5, fontWeight: sel ? 500 : 400, letterSpacing: -0.05,
                }}
              >
                <span>{r ? r.toLowerCase() : 'sin rutina'}</span>
                {sel && <Glyph name="check" size={13} color={C.ink} strokeWidth={1.6}/>}
              </button>
            );
          })}
          <button
            onClick={() => { setOpen(false); onAddNew?.(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '10px 0',
              background: 'transparent', border: 'none',
              borderTop: `1px solid ${C.hairline}`,
              cursor: 'pointer', fontFamily: 'inherit',
              color: C.ink50, fontSize: 13.5, fontWeight: 400, letterSpacing: -0.05,
            }}
          >
            <Glyph name="plus" size={13} strokeWidth={1.5}/>
            administrar rutinas
          </button>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Modal — absolute-positioned overlay inside the wizard
// ─────────────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
  <div
    onClick={onClose}
    style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 20, padding: 16,
      animation: 'fadeIn 180ms ease-out',
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', maxWidth: 320,
        background: '#1A1917',
        border: `1px solid ${C.hairlineStrong}`,
        borderRadius: 2,
        display: 'flex', flexDirection: 'column',
        maxHeight: '88%', overflow: 'hidden',
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 14px', borderBottom: `1px solid ${C.hairline}`,
      }}>
        <span style={{
          fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
          color: C.ink70, fontWeight: 600,
        }}>{title}</span>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          style={{
            width: 28, height: 28, padding: 0,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <Glyph name="close" size={15} strokeWidth={1.5}/>
        </button>
      </div>
      <div style={{ padding: '14px 16px', overflowY: 'auto' }}>
        {children}
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Identity manager modal
// ─────────────────────────────────────────────────────────────
const IDENTITY_COLOR_PRESETS = ['#9CB5A4', '#A3B5C4', '#CFA48F', '#B4A3C4', '#C4BB8F', '#A4CFC0', '#C2A3A3'];

const IdentityManager = ({ identities, onAdd, onDelete, onClose }) => {
  const [creating, setCreating] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState('');
  const [newDesc, setNewDesc] = React.useState('');
  const [newColor, setNewColor] = React.useState(IDENTITY_COLOR_PRESETS[3]);
  return (
    <Modal title="identidades" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Object.entries(identities).map(([key, i]) => {
          const isProtected = key === 'sinId';
          return (
            <div key={key} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 0',
              borderBottom: `1px solid ${C.hairline}`,
            }}>
              <span style={{
                width: 11, height: 11, borderRadius: '50%',
                background: i.color, flexShrink: 0,
              }}/>
              <span style={{
                flex: 1, fontSize: 13.5, color: C.ink, letterSpacing: -0.05,
              }}>{i.label}</span>
              <button
                onClick={() => !isProtected && onDelete(key)}
                disabled={isProtected}
                aria-label={isProtected ? 'identidad permanente' : 'eliminar identidad'}
                style={{
                  width: 24, height: 24, padding: 0,
                  background: 'transparent', border: 'none',
                  color: C.ink50,
                  cursor: isProtected ? 'default' : 'pointer',
                  opacity: isProtected ? 0.25 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <Glyph name="close" size={14} strokeWidth={1.5}/>
              </button>
            </div>
          );
        })}

        {creating ? (
          <div style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{
                fontSize: 10.5, color: C.ink35, marginBottom: 6,
                textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 500,
              }}>nombre</div>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="persona que aprende"
                autoFocus
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
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
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
                {IDENTITY_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    aria-label={`color ${c}`}
                    style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: c,
                      border: newColor === c ? `1.5px solid ${C.ink}` : '1.5px solid transparent',
                      cursor: 'pointer', padding: 0,
                      transition: 'all 180ms ease-out',
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button
                onClick={() => { setCreating(false); setNewLabel(''); setNewDesc(''); }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.ink50, fontSize: 13, fontWeight: 500,
                  fontFamily: 'inherit', padding: '8px 4px',
                }}
              >cancelar</button>
              <button
                onClick={() => {
                  const v = newLabel.trim();
                  if (!v) return;
                  onAdd(v, newColor, newDesc.trim());
                  setNewLabel(''); setNewDesc(''); setCreating(false);
                }}
                disabled={!newLabel.trim()}
                style={{
                  background: newLabel.trim() ? C.ink : C.hairlineStrong,
                  color: newLabel.trim() ? C.bg : C.ink50,
                  border: 'none',
                  cursor: newLabel.trim() ? 'pointer' : 'default',
                  padding: '8px 16px', borderRadius: 999,
                  fontSize: 13, fontWeight: 600, letterSpacing: -0.05,
                  fontFamily: 'inherit',
                  transition: 'all 180ms ease-out',
                }}
              >crear</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '14px 0 4px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.ink50, fontSize: 13, fontFamily: 'inherit',
              fontWeight: 500,
            }}>
            <Glyph name="plus" size={13} strokeWidth={1.5}/>
            crear nueva identidad
          </button>
        )}
      </div>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────
// Routine manager modal
// ─────────────────────────────────────────────────────────────
const ROUTINE_COLOR_PRESETS = ['#C4BB8F', '#A3B5C4', '#9CB5A4', '#CFA48F', '#B4A3C4', '#A4CFC0'];

const RoutineManager = ({ routines, routineColorByName, onAdd, onDelete, onMove, onClose }) => {
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newColor, setNewColor] = React.useState(ROUTINE_COLOR_PRESETS[0]);
  return (
    <Modal title="rutinas" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {routines.map((r, idx) => {
          const c = routineColorByName?.get?.(r);
          const isFirst = idx === 0;
          const isLast = idx === routines.length - 1;
          return (
            <div key={r} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0',
              borderBottom: `1px solid ${C.hairline}`,
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: c || C.hairlineStrong, flexShrink: 0,
              }}/>
              <span style={{
                flex: 1, fontSize: 13.5, color: C.ink, letterSpacing: -0.05,
              }}>{r.toLowerCase()}</span>
              <button
                onClick={() => onMove && onMove(r, 'up')}
                disabled={isFirst}
                aria-label="subir"
                style={{
                  width: 28, height: 28, padding: 0,
                  background: 'transparent', border: 'none',
                  color: isFirst ? C.ink35 : C.ink70,
                  cursor: isFirst ? 'default' : 'pointer',
                  opacity: isFirst ? 0.35 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <span style={{ display: 'inline-flex', transform: 'rotate(-90deg)' }}>
                  <Glyph name="chev" size={13} strokeWidth={1.6}/>
                </span>
              </button>
              <button
                onClick={() => onMove && onMove(r, 'down')}
                disabled={isLast}
                aria-label="bajar"
                style={{
                  width: 28, height: 28, padding: 0,
                  background: 'transparent', border: 'none',
                  color: isLast ? C.ink35 : C.ink70,
                  cursor: isLast ? 'default' : 'pointer',
                  opacity: isLast ? 0.35 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <span style={{ display: 'inline-flex', transform: 'rotate(90deg)' }}>
                  <Glyph name="chev" size={13} strokeWidth={1.6}/>
                </span>
              </button>
              <button
                onClick={() => onDelete(r)}
                aria-label="eliminar rutina"
                style={{
                  width: 28, height: 28, padding: 0,
                  background: 'transparent', border: 'none',
                  color: C.ink50, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <Glyph name="close" size={14} strokeWidth={1.5}/>
              </button>
            </div>
          );
        })}

        {creating ? (
          <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{
                fontSize: 10.5, color: C.ink35, marginBottom: 6,
                textTransform: 'uppercase', letterSpacing: 1.6, fontWeight: 500,
              }}>nombre</div>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="noche"
                autoFocus
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
                {ROUTINE_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    aria-label={`color ${c}`}
                    style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: c,
                      border: newColor === c ? `1.5px solid ${C.ink}` : '1.5px solid transparent',
                      cursor: 'pointer', padding: 0,
                      transition: 'all 180ms ease-out',
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setCreating(false); setNewName(''); }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: C.ink50, fontSize: 13, fontWeight: 500,
                  fontFamily: 'inherit', padding: '8px 4px',
                }}>cancelar</button>
              <button
                onClick={() => {
                  const v = newName.trim();
                  if (!v) return;
                  const formatted = v.charAt(0).toUpperCase() + v.slice(1);
                  onAdd(formatted, newColor);
                  setNewName(''); setCreating(false);
                }}
                disabled={!newName.trim()}
                style={{
                  background: newName.trim() ? C.ink : C.hairlineStrong,
                  color: newName.trim() ? C.bg : C.ink50,
                  border: 'none',
                  cursor: newName.trim() ? 'pointer' : 'default',
                  padding: '8px 16px', borderRadius: 999,
                  fontSize: 13, fontWeight: 600, letterSpacing: -0.05,
                  fontFamily: 'inherit',
                  transition: 'all 180ms ease-out',
                }}>crear</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '14px 0 4px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.ink50, fontSize: 13, fontFamily: 'inherit',
              fontWeight: 500,
            }}>
            <Glyph name="plus" size={13} strokeWidth={1.5}/>
            crear nueva rutina
          </button>
        )}
      </div>
    </Modal>
  );
};

function CreateHabit({ allHabits, identities, routines, routineColorByName, editingHabit, onCancel, onCreate, onAddIdentity, onDeleteIdentity, onAddRoutine, onDeleteRoutine, onMoveRoutine }) {
  const isEditing = !!editingHabit;
  const [step, setStep] = useState(1);
  const [identityModal, setIdentityModal] = useState(false);
  const [routineModal,  setRoutineModal]  = useState(false);
  const [iconModal,     setIconModal]     = useState(false);

  // Day-of-week letter mapping (Sun=0..Sat=6)
  const DAY_LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

  const initialDraft = isEditing ? (() => {
    const sched = editingHabit.schedule ?? { type: 'specificDays', days: [0,1,2,3,4,5,6] };
    const isWeek = sched.type === 'timesPerWeek';
    const selected = isWeek ? ['L','M','X','J','V'] : (sched.days || []).map(d => DAY_LETTERS[d]).filter(Boolean);
    const dbType = editingHabit.type === 'quantitative' ? 'quant' : editingHabit.type;
    return {
      iWillAction: (editingHabit.iWill || '').replace(/^voy a /i, ''),
      becomePerson: editingHabit.soThatICanBecome || '',
      identity: editingHabit.identityId != null ? String(editingHabit.identityId) : 'sinId',
      icon: editingHabit.icon || 'yoga',
      type: dbType || 'binary',
      target: editingHabit.target ?? 1,
      unit: editingHabit.unit || '',
      freqMode: isWeek ? 'week' : 'days',
      selectedDays: selected.length ? selected : ['L','M','X','J','V'],
      timesPerWeek: isWeek ? (sched.timesPerWeek || 5) : 5,
      cornerstone: !!editingHabit.isCornerstone,
      routine: editingHabit.routineName ?? null,
    };
  })() : {
    iWillAction: 'hacer 20 min de yoga',
    becomePerson: 'una persona que cuida su cuerpo',
    identity: Object.keys(IDENTITIES).find(k => k !== 'sinId') ?? 'sinId',
    icon: 'yoga',
    type: 'binary',
    target: 1,
    unit: '',
    freqMode: 'days',
    selectedDays: ['L','M','X','J','V'],
    timesPerWeek: 5,
    cornerstone: false,
    routine: ROUTINES[0] ?? null,
  };
  const [draft, setDraft] = useState(initialDraft);
  const idn = IDENTITIES[draft.identity] ?? IDENTITIES.sinId;
  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // Handlers that mutate global state + reconcile draft when an entity it
  // refers to is deleted (so the user is never left pointing at nothing).
  const handleAddIdentity = (label, color, description) => {
    const key = onAddIdentity(label, color, description);
    if (key) updateDraft({ identity: key });
  };
  const handleDeleteIdentity = (key) => {
    if (draft.identity === key) updateDraft({ identity: 'sinId' });
    onDeleteIdentity(key);
  };
  const handleAddRoutine = (name, color) => {
    onAddRoutine(name, color);
    updateDraft({ routine: name });
  };
  const handleDeleteRoutine = (name) => {
    if (draft.routine === name) updateDraft({ routine: null });
    onDeleteRoutine(name);
  };

  // Cornerstone constraint: existing habits at the limit + draft currently OFF
  // means the user can't enable it. If currently ON, they can disable freely.
  const existingCornerstones = allHabits.filter((h) => h.cornerstone).length;
  const atLimit = !draft.cornerstone && existingCornerstones >= 3;

  // ── Step 1 — La promesa ────────────────────────────────────────
  const Step1 = (
    <>
      <div style={{
        padding: '12px 16px 0', paddingTop: 'calc(12px + env(safe-area-inset-top))', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <button onClick={onCancel}
          style={{
            width: 44, height: 44, padding: 0,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink70, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <Glyph name="close" size={20} strokeWidth={1.5}/>
        </button>
        <span style={{
          fontSize: 11, color: C.ink35, fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.4, fontWeight: 500,
        }}>1 / 2</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '28px 24px 12px', minHeight: 0 }}>
        <div style={{
          fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginBottom: 10,
        }}>Voy a</div>
        <input
          type="text"
          value={draft.iWillAction}
          onChange={(e) => updateDraft({ iWillAction: e.target.value })}
          placeholder="correr 5 km"
          style={{
            background: 'transparent', border: 'none', outline: 'none',
            color: C.ink, fontSize: 26, fontWeight: 500, letterSpacing: -0.4,
            fontFamily: 'inherit', padding: '2px 0 6px',
            width: '100%', lineHeight: 1.2,
            borderBottom: `1px solid ${C.hairline}`,
          }}
        />

        <div style={{
          fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginTop: 28, marginBottom: 10,
        }}>para convertirme en</div>
        <textarea
          value={draft.becomePerson}
          onChange={(e) => updateDraft({ becomePerson: e.target.value })}
          placeholder="una persona que cuida su cuerpo"
          rows={2}
          style={{
            background: 'transparent', border: 'none', outline: 'none', resize: 'none',
            color: C.ink70, fontSize: 18, fontWeight: 400, letterSpacing: -0.2,
            fontFamily: 'inherit', padding: '2px 0 6px',
            width: '100%', lineHeight: 1.35,
            borderBottom: `1px solid ${C.hairline}`,
          }}
        />

        <div style={{
          fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginTop: 32, marginBottom: 12,
        }}>identidad</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(IDENTITIES).map(([key, i]) => (
            <IdentityChip
              key={key}
              idn={i}
              selected={draft.identity === key}
              onClick={() => updateDraft({ identity: key })}
            >{i.label}</IdentityChip>
          ))}
          <IdentityChip ghost onClick={() => setIdentityModal(true)}>+ nueva</IdentityChip>
        </div>

        <div style={{
          fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginTop: 28, marginBottom: 12,
        }}>ícono</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => setIconModal(true)}
            aria-label="Cambiar ícono"
            style={{
              width: 52, height: 52, borderRadius: '50%',
              background: 'transparent',
              border: `1.5px solid ${idn.color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.ink, cursor: 'pointer', padding: 0,
              transition: 'all 200ms ease-out', fontFamily: 'inherit',
            }}
          >
            <Glyph name={draft.icon} size={22} strokeWidth={1.5}/>
          </button>
          <button
            onClick={() => setIconModal(true)}
            style={{
              background: 'transparent', border: 'none',
              color: C.ink70, fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              letterSpacing: -0.05, padding: '4px 0',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >cambiar ícono <Glyph name="arrow" size={12} strokeWidth={1.5}/></button>
        </div>
      </div>

      <div style={{
        padding: '14px 20px 16px', borderTop: `1px solid ${C.hairline}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0, background: C.bg,
      }}>
        <button
          onClick={onCancel}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink50, fontSize: 14, fontWeight: 500,
            fontFamily: 'inherit', padding: '12px 8px',
          }}
        >Cancelar</button>
        <button
          onClick={() => setStep(2)}
          disabled={!draft.iWillAction.trim()}
          style={{
            background: draft.iWillAction.trim() ? C.ink : 'transparent',
            border: 'none',
            cursor: draft.iWillAction.trim() ? 'pointer' : 'default',
            color: draft.iWillAction.trim() ? C.bg : C.ink50,
            fontSize: 14.5, fontWeight: 600, letterSpacing: -0.05,
            fontFamily: 'inherit', padding: '12px 22px', borderRadius: 999,
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'all 180ms ease-out',
          }}
        >Continuar <Glyph name="arrow" size={14} strokeWidth={1.6}/></button>
      </div>
    </>
  );

  // ── Step 2 — Detalles ──────────────────────────────────────────
  const Step2 = (
    <>
      <div style={{
        padding: '12px 16px 0', paddingTop: 'calc(12px + env(safe-area-inset-top))', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <button
          onClick={() => setStep(1)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink70, fontSize: 13, fontWeight: 500,
            fontFamily: 'inherit', padding: '8px 6px 8px 4px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
            <Glyph name="chev" size={12} strokeWidth={1.6}/>
          </span>
          atrás
        </button>
        <span style={{
          fontSize: 11, color: C.ink35, fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.4, fontWeight: 500,
        }}>2 / 2</span>
      </div>

      {/* Compact statement summary */}
      <div style={{ padding: '14px 24px 18px' }}>
        <div style={{
          fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginBottom: 6,
        }}>Voy a</div>
        <div style={{
          fontSize: 14.5, color: C.ink, fontWeight: 500, letterSpacing: -0.1,
          lineHeight: 1.35, textWrap: 'pretty',
        }}>
          {draft.iWillAction}{' '}
          <span style={{ color: idn.color, fontWeight: 600 }}>· {idn.label}</span>
        </div>
      </div>

      <div style={{ height: 1, background: C.hairline }}/>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 20px 24px', minHeight: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <FormSection label="Tipo de hábito">
            <TypeCards
              value={draft.type}
              idn={idn}
              onChange={(v) => {
                const defaults = { binary: { target: 1, unit: '' },
                                   quant: { target: 1, unit: 'L' },
                                   duration: { target: 30, unit: 'min' } };
                updateDraft({ type: v, ...defaults[v] });
              }}
            />
            {draft.type !== 'binary' && (
              <TargetRow draft={draft} idn={idn} updateDraft={updateDraft}/>
            )}
          </FormSection>

          <FormSection label="Frecuencia">
            <FreqControl draft={draft} idn={idn} updateDraft={updateDraft}/>
          </FormSection>

          <FormSection label="Pilar">
            <CornerstoneRow
              value={draft.cornerstone}
              idn={idn}
              atLimit={atLimit}
              onChange={(v) => updateDraft({ cornerstone: v })}
            />
          </FormSection>

          <FormSection label="Rutina">
            <RoutinePicker
              value={draft.routine}
              onChange={(r) => updateDraft({ routine: r })}
              onAddNew={() => setRoutineModal(true)}
            />
          </FormSection>
        </div>
      </div>

      <div style={{
        padding: '14px 20px 16px', borderTop: `1px solid ${C.hairline}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
        flexShrink: 0, background: C.bg,
      }}>
        <button
          onClick={() => setStep(1)}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink50, fontSize: 13, fontWeight: 500,
            fontFamily: 'inherit', padding: '8px 4px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
            <Glyph name="chev" size={11} strokeWidth={1.6}/>
          </span>
          atrás
        </button>
        <button
          onClick={() => onCreate(draft)}
          style={{
            background: C.ink, color: C.bg,
            border: 'none', cursor: 'pointer',
            padding: '12px 22px', borderRadius: 999,
            fontSize: 14, fontWeight: 600, letterSpacing: -0.05,
            fontFamily: 'inherit',
            transition: 'transform 180ms ease-out',
          }}
          onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >{isEditing ? 'Guardar cambios' : 'Crear hábito'}</button>
      </div>
    </>
  );

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: C.bg, color: C.ink, minHeight: '100%',
      position: 'relative',
    }}>
      {step === 1 ? Step1 : Step2}

      {identityModal && (
        <IdentityManager
          identities={IDENTITIES}
          onAdd={handleAddIdentity}
          onDelete={handleDeleteIdentity}
          onClose={() => setIdentityModal(false)}
        />
      )}
      {routineModal && (
        <RoutineManager
          routines={ROUTINES}
          routineColorByName={routineColorByName}
          onAdd={handleAddRoutine}
          onDelete={handleDeleteRoutine}
          onMove={onMoveRoutine}
          onClose={() => setRoutineModal(false)}
        />
      )}
      {iconModal && (
        <Modal title="elige un ícono" onClose={() => setIconModal(false)}>
          <IconPicker
            value={draft.icon}
            idn={idn}
            onChange={(name) => {
              updateDraft({ icon: name });
              setIconModal(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Habit Detail screen
// Tap a habit row from Home → arrive here for stats & history.
// Sections: header (statement + identity + menu) → racha → completion
// → heatmap (year, horizontal scroll) → calendar (current month, arrows) →
// trend (last 30 days, quant/duration only) → logs (last 14).
// ─────────────────────────────────────────────────────────────

// ── Header ─────────────────────────────────────────────────────
const DetailHeader = ({ habit, idn, onBack, onDelete, onEdit, onArchive, onDuplicate }) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const actionText = habit.text.replace(/^Voy a /i, '');
  return (
    <div style={{ padding: '12px 20px 24px', paddingTop: 'calc(12px + env(safe-area-inset-top))', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onBack} aria-label="Volver" style={{
          width: 36, height: 36, padding: 0,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: C.ink70, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
            <Glyph name="chev" size={18} strokeWidth={1.6}/>
          </span>
        </button>
        <button onClick={() => setMenuOpen((o) => !o)} aria-label="Opciones" style={{
          width: 36, height: 36, padding: 0,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: C.ink70, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Glyph name="dots" size={18} strokeWidth={1.5}/>
        </button>
      </div>

      <div style={{ marginTop: 24 }}>
        <div style={{
          fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginBottom: 8,
        }}>Voy a</div>
        <h1 style={{
          margin: 0, fontSize: 26, fontWeight: 500, color: C.ink,
          letterSpacing: -0.4, lineHeight: 1.18, textWrap: 'pretty',
        }}>{actionText}</h1>

        <div style={{
          fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500, marginTop: 16, marginBottom: 6,
        }}>para convertirme en</div>
        <p style={{
          margin: 0, fontSize: 16, color: C.ink70,
          letterSpacing: -0.1, lineHeight: 1.35, fontWeight: 400, textWrap: 'pretty',
        }}>{habit.becomePerson ?? idn.label}</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: idn.color, flexShrink: 0 }}/>
        <span style={{ fontSize: 12, color: idn.color, fontWeight: 600, letterSpacing: -0.05 }}>{idn.label}</span>
        {habit.cornerstone && (
          <>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: C.ink35 }}/>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 9px', borderRadius: 999,
              border: `1.5px solid rgba(236,235,229,0.32)`,
              fontSize: 10.5, color: C.ink70, letterSpacing: 0.8,
              textTransform: 'uppercase', fontWeight: 500,
            }}>pilar</span>
          </>
        )}
      </div>

      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{
            position: 'absolute', inset: 0, zIndex: 8,
          }}/>
          <div style={{
            position: 'absolute', top: 48, right: 16, zIndex: 9,
            background: '#1A1917',
            border: `1px solid ${C.hairlineStrong}`,
            minWidth: 160, padding: '6px 0',
            boxShadow: '0 8px 24px rgba(0,0,0,0.40)',
          }}>
            {[
              { label: 'editar',    onClick: onEdit },
              { label: 'duplicar',  onClick: onDuplicate },
              { label: 'archivar',  onClick: onArchive },
              { label: 'eliminar',  danger: true, onClick: onDelete },
            ].filter(it => it.onClick).map((item) => (
              <button
                key={item.label}
                onClick={() => { setMenuOpen(false); item.onClick?.(); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '10px 16px', background: 'transparent', border: 'none',
                  color: item.danger ? '#C29080' : C.ink, fontFamily: 'inherit',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  letterSpacing: -0.05,
                }}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ── Racha (current streak + record + last-14-day dots) ─────────
const StreakBlock = ({ history, idn }) => {
  const cur = streakHelpers.current(history);
  const best = streakHelpers.best(history);
  const last14 = history.slice(-14);
  return (
    <div style={{ padding: '8px 20px 28px' }}>
      <div style={{
        fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
        color: C.ink35, fontWeight: 500, marginBottom: 14,
      }}>Racha</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{
          fontSize: 54, fontWeight: 300, color: C.ink,
          letterSpacing: -2, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
        }}>{cur}</span>
        <span style={{
          fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
          color: C.ink50, fontWeight: 500,
        }}>días</span>
      </div>
      <div style={{
        fontSize: 12, color: C.ink50, letterSpacing: -0.05, marginTop: 8,
        fontVariantNumeric: 'tabular-nums',
      }}>récord · {best} días</div>

      <div style={{ display: 'flex', gap: 5, marginTop: 18 }}>
        {last14.map((d, i) => {
          const p = d.value / d.target;
          const done = p >= 1;
          const partial = p > 0 && p < 1;
          return (
            <div key={i} title={formatLogDate(d.date)} style={{
              width: 10, height: 10, borderRadius: '50%',
              background: done ? idn.color : 'transparent',
              border: done ? `1px solid ${idn.color}`
                    : partial ? `1.5px solid ${hexToRgba(idn.color, 0.55)}`
                    : `1px solid ${C.hairlineStrong}`,
              flexShrink: 0,
            }}/>
          );
        })}
      </div>
      <div style={{
        fontSize: 10, color: C.ink35, letterSpacing: 1.4,
        textTransform: 'uppercase', fontWeight: 500, marginTop: 10,
      }}>últimos 14 días</div>
    </div>
  );
};

// ── Completion stats (2×2 grid) ────────────────────────────────
const CompletionBlock = ({ history }) => {
  const windows = [
    { label: '7 días',   n: 7 },
    { label: '30 días',  n: 30 },
    { label: '90 días',  n: 90 },
    { label: '365 días', n: 365 },
  ];
  return (
    <div style={{ padding: '0 20px 32px' }}>
      <div style={{
        fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
        color: C.ink35, fontWeight: 500, marginBottom: 18,
      }}>Completados</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 22, columnGap: 16 }}>
        {windows.map((w) => {
          const done = streakHelpers.completedIn(history, w.n);
          const pct = Math.round((done / w.n) * 100);
          return (
            <div key={w.label}>
              <div style={{
                fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase',
                color: C.ink35, fontWeight: 500, marginBottom: 6,
              }}>{w.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontSize: 22, fontWeight: 500, color: C.ink,
                  fontVariantNumeric: 'tabular-nums', letterSpacing: -0.4, lineHeight: 1,
                }}>{done}<span style={{ color: C.ink50, fontWeight: 400 }}>/{w.n}</span></span>
                <span style={{
                  fontSize: 11, color: C.ink50, fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums', letterSpacing: 0.1,
                }}>{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Heatmap (year, horizontal scroll, 10px cells) ──────────────
const HeatmapBlock = ({ history, idn, onTapDay }) => {
  // Pad start so first column starts on Monday
  const firstDow = history[0].dow;
  const padded = [...new Array(firstDow).fill(null), ...history];
  const weeks = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }
  // Month labels: only on the first week each month appears
  let lastMonth = -1;
  const monthLabels = weeks.map((week) => {
    for (const d of week) {
      if (d?.date) {
        const m = d.date.getMonth();
        if (m !== lastMonth) {
          lastMonth = m;
          return SPANISH_MONTHS_SHORT[m];
        }
        return '';
      }
    }
    return '';
  });
  const dayLabelCol = ['lun','','mié','','vie','','dom'];
  const cellSize = 10;
  const gap = 3;
  return (
    <div style={{ paddingBottom: 32 }}>
      <div style={{
        padding: '0 20px 16px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span style={{
          fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500,
        }}>último año</span>
        <span style={{
          fontSize: 11, color: C.ink50, fontVariantNumeric: 'tabular-nums', letterSpacing: 0.1,
        }}>{streakHelpers.completedIn(history, 365)} / 365 días</span>
      </div>

      <div style={{ overflowX: 'auto', paddingLeft: 20, paddingBottom: 4, paddingRight: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          {/* Day labels column */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap,
            paddingTop: 16, marginRight: 10, flexShrink: 0,
          }}>
            {dayLabelCol.map((dl, i) => (
              <div key={i} style={{
                height: cellSize, lineHeight: `${cellSize}px`,
                fontSize: 9, color: C.ink50, letterSpacing: 0.4,
                textTransform: 'uppercase', fontWeight: 500,
              }}>{dl}</div>
            ))}
          </div>
          <div>
            {/* Month labels row */}
            <div style={{ display: 'flex', gap, height: 12, marginBottom: 6 }}>
              {monthLabels.map((label, i) => (
                <div key={i} style={{
                  width: cellSize, fontSize: 9.5, color: C.ink50,
                  letterSpacing: 0.7, textTransform: 'uppercase', fontWeight: 500,
                  whiteSpace: 'nowrap',
                }}>{label}</div>
              ))}
            </div>
            {/* Weeks grid */}
            <div style={{ display: 'flex', gap }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap }}>
                  {Array.from({ length: 7 }, (_, di) => {
                    const day = week[di];
                    return (
                      <button
                        key={di}
                        onClick={() => day && onTapDay?.(day)}
                        aria-label={day?.date ? formatLogDate(day.date) : ''}
                        style={{
                          width: cellSize, height: cellSize, padding: 0,
                          background: heatColor(day, idn),
                          border: 'none',
                          borderRadius: 2,
                          cursor: day?.date ? 'pointer' : 'default',
                          transition: 'transform 150ms ease-out',
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        padding: '14px 20px 0',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{
          fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500,
        }}>menos</span>
        <div style={{ display: 'flex', gap: 3 }}>
          {[0, 0.3, 0.5, 0.8, 1].map((p, i) => (
            <div key={i} style={{
              width: 10, height: 10, borderRadius: 2,
              background: p === 0
                ? 'rgba(236,235,229,0.05)'
                : hexToRgba(idn.color, [0.20, 0.42, 0.65, 0.88][i - 1] ?? 0.88),
            }}/>
          ))}
        </div>
        <span style={{
          fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500,
        }}>más</span>
      </div>
    </div>
  );
};

// ── Calendar (current month + ← → arrows) ──────────────────────
const CalendarBlock = ({ history, idn }) => {
  const [offset, setOffset] = React.useState(0); // 0 = current month, -1 = previous
  // Real "today" with forge-day rollover at 3am — anything before 3am still
  // belongs to the previous calendar day, matching how logs are keyed.
  const _now = new Date();
  const today = new Date(_now);
  if (_now.getHours() < 3) today.setDate(today.getDate() - 1);
  today.setHours(12, 0, 0, 0);
  const target = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const monthName = SPANISH_MONTHS_SHORT[target.getMonth()];
  const year = target.getFullYear();
  const monthStartDow = (target.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, target.getMonth() + 1, 0).getDate();

  // Build a 6×7 grid; each cell has either null or a day object
  const cells = [];
  for (let i = 0; i < monthStartDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, target.getMonth(), day);
    // Find matching history entry by date
    const entry = history.find((h) =>
      h.date.getFullYear() === date.getFullYear() &&
      h.date.getMonth() === date.getMonth() &&
      h.date.getDate() === date.getDate()
    );
    const isToday = date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    const isFuture = date > today;
    cells.push({ date, entry, isToday, isFuture });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div style={{ padding: '0 20px 32px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16,
      }}>
        <span style={{
          fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500,
        }}>{monthName} {year}</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setOffset((o) => o - 1)}
            aria-label="Mes anterior"
            style={{
              width: 26, height: 26, padding: 0,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: C.ink50, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
              <Glyph name="chev" size={12} strokeWidth={1.6}/>
            </span>
          </button>
          <button
            onClick={() => offset < 0 && setOffset((o) => o + 1)}
            disabled={offset >= 0}
            aria-label="Mes siguiente"
            style={{
              width: 26, height: 26, padding: 0,
              background: 'transparent', border: 'none',
              cursor: offset < 0 ? 'pointer' : 'default',
              color: C.ink50, opacity: offset < 0 ? 1 : 0.3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
            <Glyph name="chev" size={12} strokeWidth={1.6}/>
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
        {['L','M','X','J','V','S','D'].map((d) => (
          <div key={d} style={{
            fontSize: 9, color: C.ink35, letterSpacing: 0.8, textAlign: 'center',
            textTransform: 'uppercase', fontWeight: 500, paddingBottom: 4,
          }}>{d}</div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((c, i) => {
          if (!c) return <div key={i}/>;
          const pct = c.entry ? c.entry.value / c.entry.target : 0;
          const done = pct >= 1;
          const partial = pct > 0 && pct < 1;
          return (
            <div key={i} style={{
              aspectRatio: '1',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '50%',
              background: done ? hexToRgba(idn.color, 0.88)
                : partial ? hexToRgba(idn.color, 0.20 + pct * 0.30)
                : 'transparent',
              border: c.isToday ? `1.5px solid ${idn.color}` : '1.5px solid transparent',
              fontSize: 12, fontWeight: done ? 600 : 500,
              fontVariantNumeric: 'tabular-nums', letterSpacing: -0.1,
              color: done ? C.bg
                : c.isFuture ? C.ink35
                : c.isToday ? C.ink
                : C.ink70,
              transition: 'all 200ms ease-out',
            }}>
              {c.date.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Trend (last 30 days line chart) ────────────────────────────
const TrendBlock = ({ history, idn }) => {
  const last30 = history.slice(-30);
  const w = 320, h = 90, padX = 4, padY = 14;
  const xStep = (w - padX * 2) / (last30.length - 1);
  const maxVal = Math.max(...last30.map((d) => d.target));
  const yFor = (v) => padY + (1 - v / maxVal) * (h - padY * 2);
  const points = last30.map((d, i) => ({ x: padX + i * xStep, y: yFor(d.value), d }));
  const targetY = yFor(last30[0]?.target ?? 2);
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(h - padY).toFixed(1)} L ${points[0].x.toFixed(1)} ${(h - padY).toFixed(1)} Z`;
  return (
    <div style={{ padding: '0 20px 32px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 16,
      }}>
        <span style={{
          fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
          color: C.ink35, fontWeight: 500,
        }}>últimos 30 días</span>
        <span style={{
          fontSize: 11, color: C.ink50, letterSpacing: 0.1,
          fontVariantNumeric: 'tabular-nums',
        }}>meta · {last30[0]?.target ?? 2} {history[0].target ? 'L' : ''}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 90, display: 'block' }}>
        {/* Target line */}
        <line x1={padX} x2={w - padX} y1={targetY} y2={targetY}
          stroke={C.hairlineStrong} strokeDasharray="3 4" strokeWidth="1"/>
        {/* Area fill */}
        <path d={areaPath} fill={idn.color} fillOpacity="0.10"/>
        {/* Line */}
        <path d={linePath} fill="none" stroke={idn.color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round"/>
        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.8"
            fill={p.d.value >= p.d.target ? idn.color : '#0F0F0E'}
            stroke={idn.color} strokeWidth="1"/>
        ))}
      </svg>
    </div>
  );
};

// ── Logs (last 14 days, latest first) ──────────────────────────
const LogsBlock = ({ history, idn, habit }) => {
  const [showAll, setShowAll] = React.useState(false);
  const fmtVal = (v) => habit.unit === 'L'
    ? v.toFixed(1).replace(/\.0$/, '')
    : String(v);
  // Only show days the habit was actually scheduled — no phantom "missed days"
  // for dates before the habit existed or days off the schedule.
  const scheduledDays = history.filter(h => h.scheduled !== false);
  const display = showAll
    ? [...scheduledDays].reverse()
    : [...scheduledDays].slice(-14).reverse();
  const hasMore = scheduledDays.length > 14;
  return (
    <div style={{ padding: '0 20px 40px' }}>
      <div style={{
        fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase',
        color: C.ink35, fontWeight: 500, marginBottom: 8,
      }}>Registros</div>
      {display.length === 0 && (
        <div style={{
          padding: '24px 0', fontSize: 13, color: C.ink50, lineHeight: 1.5,
        }}>
          aún no hay registros para este hábito.
        </div>
      )}
      <div>
        {display.map((d, i) => {
          const done = d.value >= d.target;
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 0',
              borderTop: `1px solid ${C.hairline}`,
            }}>
              <span style={{ fontSize: 13, color: C.ink70, letterSpacing: -0.05 }}>
                {formatLogDate(d.date)}
              </span>
              <span style={{
                fontSize: 13, fontWeight: 500,
                fontVariantNumeric: 'tabular-nums', letterSpacing: 0.05,
                color: done ? idn.color : (d.value === 0 ? C.ink50 : C.ink),
              }}>
                {fmtVal(d.value)} / {d.target}{habit.unit === 'pág' ? ' pág' : habit.unit}
              </span>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <button
          onClick={() => setShowAll(s => !s)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '16px 0 4px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: C.ink70, fontSize: 13, fontWeight: 500,
            fontFamily: 'inherit', letterSpacing: -0.05,
          }}
        >
          {showAll ? 'ver menos' : 'ver todos los registros'}
          <Glyph name="arrow" size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
};

// ── Main detail container ──────────────────────────────────────
function HabitDetail({ habit, history, onBack, onDelete, onEdit, onArchive, onDuplicate }) {
  const idn = IDENTITIES[habit.identity] ?? IDENTITIES.sinId;
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: C.bg, color: C.ink, minHeight: '100%',
      overflow: 'auto',
    }}>
      <DetailHeader habit={habit} idn={idn} onBack={onBack} onDelete={onDelete} onEdit={onEdit} onArchive={onArchive} onDuplicate={onDuplicate}/>
      <div style={{ height: 1, background: C.hairline, margin: '0 20px 24px' }}/>
      <StreakBlock history={history} idn={idn}/>
      <CompletionBlock history={history}/>
      <HeatmapBlock history={history} idn={idn}/>
      <CalendarBlock history={history} idn={idn}/>
      {habit.type !== 'binary' && <TrendBlock history={history} idn={idn}/>}
      <LogsBlock history={history} idn={idn} habit={habit}/>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Export to window so the next script (app.jsx) can use them
// (Babel standalone wraps each <script> in its own closure)
// ─────────────────────────────────────────────────────────────
Object.assign(window, {
  // tokens
  C, IDENTITIES, ROUTINES, hexToRgba,
  // utils
  isDone, heatColor, dateInfo, cap, formatLogDate,
  SPANISH_DOWS, SPANISH_MONTHS_SHORT, DAYS, MONTHS,
  // visual components
  Glyph, StreakMark,
  HabitRow, RoutineHeader, ViewToggle, DateStepper, Header,
  fmtVal, compactValue, Bubble, IdentitySection, BubblesView,
  // wizard pieces
  IconPicker, FormSection, IdentityChip, TypeCards, TargetRow,
  FreqControl, Switch, CornerstoneRow, RoutinePicker,
  Modal, IdentityManager, RoutineManager,
  // screens
  CreateHabit, HabitDetail,
  // detail sub-blocks (in case we want to reuse for global stats)
  DetailHeader, StreakBlock, CompletionBlock, HeatmapBlock,
  CalendarBlock, TrendBlock, LogsBlock,
});
