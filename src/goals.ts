/**
 * Goals, streaks, XP and achievements — all derived from `applied_at` dates
 * (and statuses) so nothing can drift: change a date and everything recomputes.
 * Only achievement unlock times are stored, so each is celebrated once.
 */
import { db } from "./db.ts";

db.exec("CREATE TABLE IF NOT EXISTS achievements (key TEXT PRIMARY KEY, unlocked_at TEXT NOT NULL DEFAULT (datetime('now')))");

// ---------- goals (settings) ----------

export interface Goals { daily: number; weekly: number; monthly: number; weekends: boolean; followupDays: number }
const DEFAULT_GOALS: Goals = { daily: 2, weekly: 10, monthly: 40, weekends: true, followupDays: 7 };

const getSetting = (k: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined)?.value;
const setSetting = (k: string, v: string) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export function getGoals(): Goals {
  const raw = getSetting("goals");
  return raw ? { ...DEFAULT_GOALS, ...JSON.parse(raw) } : DEFAULT_GOALS;
}
export function saveGoals(input: Partial<Goals>): Goals {
  const g = getGoals();
  const num = (v: unknown, cur: number, max: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 && n <= max ? n : cur; };
  const next: Goals = {
    daily: input.daily !== undefined ? num(input.daily, g.daily, 50) : g.daily,
    weekly: input.weekly !== undefined ? num(input.weekly, g.weekly, 300) : g.weekly,
    monthly: input.monthly !== undefined ? num(input.monthly, g.monthly, 1000) : g.monthly,
    weekends: input.weekends !== undefined ? Boolean(input.weekends) : g.weekends,
    followupDays: input.followupDays !== undefined ? num(input.followupDays, g.followupDays, 90) : g.followupDays,
  };
  setSetting("goals", JSON.stringify(next));
  return next;
}

// ---------- dates (local time) ----------

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s: string, n: number) => { const d = fromIso(s); d.setDate(d.getDate() + n); return isoDate(d); };
const isWeekend = (s: string) => { const w = fromIso(s).getDay(); return w === 0 || w === 6; };
/** Monday of the ISO week containing `s`. */
const weekStart = (s: string) => { const d = fromIso(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); };
const monthOf = (s: string) => s.slice(0, 7);
export const today = () => isoDate(new Date());

// ---------- stats ----------

export interface Period { label: string; count: number; goal: number; start: string; end: string; pct: number; met: boolean }

export function stats() {
  const goals = getGoals();
  const rows = db.prepare("SELECT applied_at, status, fit_score FROM applications WHERE applied_at IS NOT NULL AND applied_at != ''").all() as { applied_at: string; status: string; fit_score: number | null }[];
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.applied_at, (byDay.get(r.applied_at) ?? 0) + 1);
  const t = today();
  const count = (from: string, to: string) => { let n = 0; for (const [d, c] of byDay) if (d >= from && d <= to) n += c; return n; };
  const dayMet = (d: string) => goals.daily > 0 && (byDay.get(d) ?? 0) >= goals.daily;
  const restDay = (d: string) => !goals.weekends && isWeekend(d);

  const wkStart = weekStart(t), wkEnd = addDays(wkStart, 6);
  const moStart = `${monthOf(t)}-01`, moEnd = isoDate(new Date(fromIso(t).getFullYear(), fromIso(t).getMonth() + 1, 0));
  const period = (label: string, start: string, end: string, goal: number): Period => {
    const c = count(start, end);
    return { label, count: c, goal, start, end, pct: goal ? Math.min(100, Math.round((c / goal) * 100)) : 0, met: goal > 0 && c >= goal };
  };
  const dayP = period("Today", t, t, goals.daily), weekP = period("This week", wkStart, wkEnd, goals.weekly), monthP = period("This month", moStart, moEnd, goals.monthly);

  // Current streak: consecutive goal-met days ending today (or yesterday, if today isn't done yet). Rest days don't break it.
  let streak = 0, cursor = t;
  if (!dayMet(t)) cursor = addDays(t, -1);
  for (let guard = 0; guard < 3660; guard++) {
    if (dayMet(cursor)) streak++;
    else if (!restDay(cursor)) break;
    cursor = addDays(cursor, -1);
  }
  // Best streak ever.
  const days = [...byDay.keys()].sort();
  let best = 0;
  if (days.length) {
    let run = 0;
    for (let d = days[0]; d <= t; d = addDays(d, 1)) {
      if (dayMet(d)) { run++; best = Math.max(best, run); }
      else if (!restDay(d)) run = 0;
    }
  }

  // Goal hits (for XP): days, weeks and months where the target was reached.
  const daysMet = days.filter(dayMet).length;
  const weeks = new Map<string, number>(), months = new Map<string, number>();
  for (const [d, c] of byDay) { weeks.set(weekStart(d), (weeks.get(weekStart(d)) ?? 0) + c); months.set(monthOf(d), (months.get(monthOf(d)) ?? 0) + c); }
  const weeksMet = [...weeks.values()].filter((c) => goals.weekly > 0 && c >= goals.weekly).length;
  const monthsMet = [...months.values()].filter((c) => goals.monthly > 0 && c >= goals.monthly).length;

  const total = rows.length;
  const xp = total * 10 + daysMet * 25 + weeksMet * 75 + monthsMet * 200 + Math.max(0, streak - 1) * 5;
  const level = levelFor(xp);

  // Heatmap: last 16 weeks, Monday-aligned.
  const heatStart = addDays(wkStart, -7 * 15);
  const heatmap: { date: string; count: number; met: boolean; rest: boolean }[] = [];
  for (let d = heatStart; d <= wkEnd; d = addDays(d, 1)) heatmap.push({ date: d, count: byDay.get(d) ?? 0, met: dayMet(d), rest: restDay(d) });

  const statusCounts = db.prepare("SELECT status, COUNT(*) AS n FROM applications GROUP BY status").all() as { status: string; n: number }[];
  const pipeline = Object.fromEntries(statusCounts.map((r) => [r.status, r.n]));

  return {
    goals, today: t, total, streak, best, daysMet, weeksMet, monthsMet, xp, level,
    periods: { day: dayP, week: weekP, month: monthP },
    heatmap, pipeline,
    maxDay: Math.max(0, ...byDay.values()),
    highFitApplied: rows.filter((r) => (r.fit_score ?? 0) >= 4).length,
  };
}

// ---------- levels ----------

const LEVELS = [
  { xp: 0, name: "Rookie" }, { xp: 100, name: "Applicant" }, { xp: 300, name: "Contender" }, { xp: 600, name: "Hunter" },
  { xp: 1000, name: "Closer" }, { xp: 1500, name: "Relentless" }, { xp: 2200, name: "Unstoppable" }, { xp: 3000, name: "Legend" },
];
function levelFor(xp: number) {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].xp) i++;
  const next = LEVELS[i + 1] ? LEVELS[i + 1].xp : LEVELS[i].xp + 1500 * (i - LEVELS.length + 2);
  const cur = LEVELS[i].xp;
  return { n: i + 1, name: LEVELS[i].name, xp, cur, next, pct: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100)) };
}

// ---------- achievements ----------

type S = ReturnType<typeof stats>;
const ACHIEVEMENTS: { key: string; name: string; hint: string; icon: string; test: (s: S) => boolean }[] = [
  { key: "first", name: "First step", hint: "Mark your first application as applied", icon: "🚀", test: (s) => s.total >= 1 },
  { key: "daily", name: "On target", hint: "Hit your daily goal", icon: "🎯", test: (s) => s.daysMet >= 1 },
  { key: "power", name: "Power day", hint: "5 applications in one day", icon: "⚡", test: (s) => s.maxDay >= 5 },
  { key: "streak3", name: "Warming up", hint: "3-day streak", icon: "🔥", test: (s) => s.best >= 3 },
  { key: "streak7", name: "One week strong", hint: "7-day streak", icon: "🔥", test: (s) => s.best >= 7 },
  { key: "streak14", name: "Fortnight", hint: "14-day streak", icon: "🌋", test: (s) => s.best >= 14 },
  { key: "streak30", name: "Machine", hint: "30-day streak", icon: "🏆", test: (s) => s.best >= 30 },
  { key: "weekly", name: "Week won", hint: "Hit a weekly goal", icon: "📅", test: (s) => s.weeksMet >= 1 },
  { key: "monthly", name: "Month won", hint: "Hit a monthly goal", icon: "🗓️", test: (s) => s.monthsMet >= 1 },
  { key: "t10", name: "Double digits", hint: "10 applications", icon: "🔟", test: (s) => s.total >= 10 },
  { key: "t25", name: "Quarter century", hint: "25 applications", icon: "🥉", test: (s) => s.total >= 25 },
  { key: "t50", name: "Half century", hint: "50 applications", icon: "🥈", test: (s) => s.total >= 50 },
  { key: "t100", name: "Centurion", hint: "100 applications", icon: "🥇", test: (s) => s.total >= 100 },
  { key: "sharp", name: "Sharpshooter", hint: "Apply to 5 roles scored 4+ fit", icon: "🎯", test: (s) => s.highFitApplied >= 5 },
  { key: "screening", name: "Foot in the door", hint: "Reach a screening", icon: "📞", test: (s) => (s.pipeline.screening ?? 0) + (s.pipeline.interview ?? 0) + (s.pipeline.offer ?? 0) >= 1 },
  { key: "interview", name: "In the room", hint: "Reach an interview", icon: "🤝", test: (s) => (s.pipeline.interview ?? 0) + (s.pipeline.offer ?? 0) >= 1 },
  { key: "offer", name: "Offer!", hint: "Receive an offer", icon: "🎉", test: (s) => (s.pipeline.offer ?? 0) >= 1 },
  { key: "l3", name: "Contender", hint: "Reach level 3", icon: "⭐", test: (s) => s.level.n >= 3 },
  { key: "l5", name: "Closer", hint: "Reach level 5", icon: "🌟", test: (s) => s.level.n >= 5 },
];

/** Evaluate every achievement; persist newly unlocked ones and return them. */
export function checkAchievements(s = stats()) {
  const unlocked = new Map((db.prepare("SELECT key, unlocked_at FROM achievements").all() as { key: string; unlocked_at: string }[]).map((r) => [r.key, r.unlocked_at]));
  const fresh: typeof ACHIEVEMENTS[number][] = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked.has(a.key) || !a.test(s)) continue;
    db.prepare("INSERT INTO achievements (key) VALUES (?)").run(a.key);
    fresh.push(a);
  }
  return fresh.map(({ test, ...a }) => a);
}

export function listAchievements() {
  const unlocked = new Map((db.prepare("SELECT key, unlocked_at FROM achievements").all() as { key: string; unlocked_at: string }[]).map((r) => [r.key, r.unlocked_at]));
  return ACHIEVEMENTS.map(({ test, ...a }) => ({ ...a, unlocked_at: unlocked.get(a.key) ?? null }));
}
