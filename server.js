import express from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import livereload from "livereload";
import connectLivereload from "connect-livereload";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "workouts.db");

if (process.env.NODE_ENV !== "production") {
  const lrserver = livereload.createServer({
    exts: ["html", "css", "js"],
    delay: 100
  });
  lrserver.watch(path.join(__dirname, "public"));
  lrserver.watch(path.join(__dirname, "server.js"));
  app.use(connectLivereload());
}

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS workout_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number INTEGER,
    focus TEXT,
    exercises TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_date TEXT NOT NULL,
    intensity INTEGER NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date);

  CREATE TABLE IF NOT EXISTS daily_summary (
    workout_date TEXT PRIMARY KEY,
    intensity INTEGER CHECK (intensity >= 0 AND intensity <= 4),
    note TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS exercise_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_date TEXT NOT NULL,
    plan_id INTEGER NOT NULL,
    exercise TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workout_date, plan_id, exercise)
  );
  CREATE INDEX IF NOT EXISTS idx_exercise_logs_date ON exercise_logs(workout_date);

  CREATE TABLE IF NOT EXISTS mobility_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_number INTEGER,
    focus TEXT,
    exercises TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS mobility_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_date TEXT NOT NULL,
    plan_id INTEGER NOT NULL,
    exercise TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(workout_date, plan_id, exercise)
  );
  CREATE INDEX IF NOT EXISTS idx_mobility_logs_date ON mobility_logs(workout_date);

  CREATE TABLE IF NOT EXISTS daily_plans (
    workout_date TEXT PRIMARY KEY,
    focus TEXT,
    exercises TEXT NOT NULL,
    difficulty INTEGER DEFAULT 3,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_mobility_plans (
    workout_date TEXT PRIMARY KEY,
    focus TEXT,
    exercises TEXT NOT NULL,
    difficulty INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workout_snapshots (
    workout_date TEXT NOT NULL,
    note TEXT NOT NULL,
    items TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (workout_date, note)
  );
`);

// Migrate workouts.intensity from 0-4 constraint to raw total intensity.
const workoutsSchema = db
  .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workouts'")
  .get()?.sql || "";
if (/CHECK\s*\(\s*intensity\s*>=\s*0\s*AND\s*intensity\s*<=\s*4\s*\)/i.test(workoutsSchema)) {
  db.exec(`
    BEGIN;
    CREATE TABLE IF NOT EXISTS workouts_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_date TEXT NOT NULL,
      intensity INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO workouts_new (id, workout_date, intensity, note, created_at)
    SELECT id, workout_date, intensity, note, created_at FROM workouts;
    DROP TABLE workouts;
    ALTER TABLE workouts_new RENAME TO workouts;
    CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date);
    COMMIT;
  `);
}

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveRequestedDate(req) {
  const requested = req.query?.date;
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return requested;
  }
  return toLocalISODate(new Date());
}

function buildExerciseKey(exercise, index, seen) {
  const name =
    typeof exercise === "string"
      ? exercise
      : exercise?.exercise || exercise?.name || JSON.stringify(exercise);
  const detail =
    typeof exercise === "object" && exercise
      ? [
          exercise.sets && `${exercise.sets} sets`,
          exercise.reps && `${exercise.reps} reps`,
          exercise.rounds && `${exercise.rounds} rounds`,
          exercise.minutes && `${exercise.minutes} min`,
          exercise.seconds && `${exercise.seconds} sec`,
          exercise.duration && `${exercise.duration}`,
          exercise.distance && `${exercise.distance}`,
          exercise.hold && `${exercise.hold} hold`,
          exercise.detail && `${exercise.detail}`,
          exercise.note && `${exercise.note}`,
          exercise.notes && `${exercise.notes}`
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
  const baseKey = detail ? `${name} (${detail})` : name;
  const count = (seen[baseKey] || 0) + 1;
  seen[baseKey] = count;
  return count > 1 ? `${baseKey} #${count}` : baseKey;
}

function clampWorkoutIntensity(value, fallback = 1) {
  const raw =
    value === undefined || value === null ? fallback : parseInt(value, 10);
  if (Number.isNaN(raw)) return fallback;
  return Math.max(0, raw);
}

function clampExerciseIntensity(value, fallback = 1) {
  const raw =
    value === undefined || value === null ? fallback : parseInt(value, 10);
  if (Number.isNaN(raw)) return fallback;
  return Math.max(0, raw);
}

function normalizeExercises(exercises, defaultIntensity) {
  const seen = {};
  return (Array.isArray(exercises) ? exercises : []).map((ex, index) => {
    const name =
      typeof ex === "string" ? ex : ex?.exercise || ex?.name || JSON.stringify(ex);
    const hasExplicitIntensity =
      typeof ex === "object" && ex
        ? ex.intensity !== undefined || ex.level !== undefined || ex.rating !== undefined
        : false;
    const intensity = clampExerciseIntensity(
      hasExplicitIntensity ? ex.intensity ?? ex.level ?? ex.rating : undefined,
      defaultIntensity
    );
    const key =
      typeof ex === "object" && ex && ex.key
        ? String(ex.key)
        : buildExerciseKey(ex, index, seen);
    if (typeof ex === "object" && ex) {
      return {
        ...ex,
        exercise: name,
        key,
        intensity,
        displayIntensity: hasExplicitIntensity ? intensity : undefined
      };
    }
    return {
      exercise: name,
      key,
      intensity,
      displayIntensity: undefined
    };
  });
}

function getExerciseIntensityMap(planId, type) {
  const fallbackIntensity = type === "mobility" ? 0 : 1;
  if (type === "mobility") {
    if (planId === 0) {
      return normalizeExercises(DEFAULT_MOBILITY_PLAN.exercises, fallbackIntensity);
    }
    const row = db
      .prepare(
        `
        SELECT exercises
        FROM mobility_plans
        WHERE id = ?
        `
      )
      .get(planId);
    let exercises = [];
    try {
      exercises = JSON.parse(row?.exercises || "[]");
    } catch {
      exercises = [];
    }
    return normalizeExercises(exercises, fallbackIntensity);
  }

  if (planId === 0) {
    return normalizeExercises(DEFAULT_PLAN.exercises, fallbackIntensity);
  }
  const row = db
    .prepare(
      `
      SELECT exercises
      FROM workout_plans
      WHERE id = ?
      `
    )
    .get(planId);
  let exercises = [];
  try {
    exercises = JSON.parse(row?.exercises || "[]");
  } catch {
    exercises = [];
  }
  return normalizeExercises(exercises, fallbackIntensity);
}

function getDailyPlanExercises(dateISO) {
  const row = db
    .prepare(
      `
      SELECT focus, exercises, difficulty
      FROM daily_plans
      WHERE workout_date = ?
      `
    )
    .get(dateISO);
  if (!row) return [];
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  const isRecovery = /mobility|recovery|stretch|yoga|rest/i.test(row.focus || "");
  const defaultIntensity = isRecovery ? 0 : 1;
  return normalizeExercises(exercises, defaultIntensity);
}

function getDailyMobilityPlanExercises(dateISO) {
  const row = db
    .prepare(
      `
      SELECT focus, exercises, difficulty
      FROM daily_mobility_plans
      WHERE workout_date = ?
      `
    )
    .get(dateISO);
  if (!row) return [];
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return normalizeExercises(exercises, 0);
}

function upsertWorkoutIntensity(date, note, intensity) {
  const safeIntensity = clampWorkoutIntensity(intensity, 0);
  if (safeIntensity <= 0) {
    db.prepare(
      `
      DELETE FROM workouts
      WHERE workout_date = ? AND note = ?
      `
    ).run(date, note);
    db.prepare(
      `
      DELETE FROM workout_snapshots
      WHERE workout_date = ? AND note = ?
      `
    ).run(date, note);
    return;
  }

  const existing = db
    .prepare(
      `
      SELECT id
      FROM workouts
      WHERE workout_date = ? AND note = ?
      LIMIT 1
      `
    )
    .get(date, note);

  if (existing?.id) {
    db.prepare(
      `
      UPDATE workouts
      SET intensity = ?, created_at = datetime('now')
      WHERE id = ?
      `
    ).run(safeIntensity, existing.id);
  } else {
    db.prepare(
      `
      INSERT INTO workouts (workout_date, intensity, note)
      VALUES (?, ?, ?)
      `
    ).run(date, safeIntensity, note);
  }
}

function upsertWorkoutSnapshot(date, note, items) {
  const payload = JSON.stringify(Array.isArray(items) ? items : []);
  db.prepare(
    `
    INSERT INTO workout_snapshots (workout_date, note, items, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(workout_date, note) DO UPDATE SET
      items = excluded.items,
      updated_at = excluded.updated_at
    `
  ).run(date, note, payload);
}

function normalizeCompletedItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") {
        return { exercise: item, completed: true };
      }
      if (item && typeof item === "object") {
        const exercise = item.exercise || item.name || item.title || item.label;
        if (!exercise) return null;
        return { exercise: String(exercise), completed: true };
      }
      return null;
    })
    .filter(Boolean);
}

function sanitizeChecklistItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") {
        return { exercise: item, intensity: undefined, completed: false };
      }
      if (item && typeof item === "object") {
        const exercise =
          item.exercise || item.name || item.title || item.label || "";
        if (!exercise) return null;
        const intensity =
          item.intensity ?? item.level ?? item.rating ?? undefined;
        return {
          exercise: String(exercise),
          intensity,
          completed: !!item.completed
        };
      }
      return null;
    })
    .filter(Boolean);
}

function isPlaceholderSnapshot(items, note) {
  if (!Array.isArray(items) || items.length === 0) return true;
  const label =
    note === "mobility-checklist" ? "mobility completed via api" : "completed via api";
  return items.every(
    (item) => item && typeof item === "object" && item.exercise === label
  );
}

function mapIntensityToLevel(total) {
  if (total <= 0) return 0;
  if (total <= 4) return 1;
  if (total <= 7) return 2;
  if (total <= 10) return 3;
  return 4;
}

const DEFAULT_PLAN = {
  id: 0,
  day_number: 0,
  focus: "full body",
  exercises: ["squats", "push-ups", "plank"],
  difficulty: 3
};

const DEFAULT_MOBILITY_PLAN = {
  id: 0,
  day_number: 0,
  focus: "mobility",
  exercises: ["ankle circles", "hip openers", "thoracic rotations", "hamstring stretch"],
  difficulty: 1
};

function getPlanById(id) {
  if (id === 0) {
    return {
      ...DEFAULT_PLAN,
      exercises: normalizeExercises(DEFAULT_PLAN.exercises, 1)
    };
  }
  const row = db
    .prepare(
      `
      SELECT id, day_number, focus, exercises
      FROM workout_plans
      WHERE id = ?
      `
    )
    .get(id);
  if (!row) return null;
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return { ...row, exercises: normalizeExercises(exercises, 1), difficulty: 3 };
}

function getFirstPlan() {
  const row = db
    .prepare(
      `
      SELECT id, day_number, focus, exercises
      FROM workout_plans
      ORDER BY day_number ASC, id ASC
      LIMIT 1
      `
    )
    .get();
  if (!row) {
    return {
      ...DEFAULT_PLAN,
      exercises: normalizeExercises(DEFAULT_PLAN.exercises, 1)
    };
  }
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return { ...row, exercises: normalizeExercises(exercises, 1), difficulty: 3 };
}

function getNextPlan(afterDayNumber) {
  const row = db
    .prepare(
      `
      SELECT id, day_number, focus, exercises
      FROM workout_plans
      WHERE day_number > ?
      ORDER BY day_number ASC, id ASC
      LIMIT 1
      `
    )
    .get(afterDayNumber);
  if (!row) return getFirstPlan();
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return { ...row, exercises: normalizeExercises(exercises, 1), difficulty: 3 };
}

function getPlanForDate(dateISO) {
  const existing = db
    .prepare(
      `
      SELECT plan_id
      FROM exercise_logs
      WHERE workout_date = ?
      ORDER BY (plan_id = 0) ASC, updated_at DESC
      LIMIT 1
      `
    )
    .get(dateISO);
  if (existing?.plan_id !== undefined) {
    return getPlanById(existing.plan_id) || getFirstPlan();
  }

  const lastAssigned = db
    .prepare(
      `
      SELECT plan_id
      FROM exercise_logs
      WHERE workout_date < ?
      ORDER BY workout_date DESC, updated_at DESC
      LIMIT 1
      `
    )
    .get(dateISO);

  if (lastAssigned?.plan_id !== undefined) {
    const lastPlan = getPlanById(lastAssigned.plan_id);
    if (lastPlan) {
      return getNextPlan(lastPlan.day_number ?? 0);
    }
  }

  return getFirstPlan();
}

function computeChecklistIntensity(date, planId, type) {
  let exercises = [];
  if (type === "workout" && planId === 0) {
    exercises = getDailyPlanExercises(date);
  } else if (type === "mobility" && planId === 0) {
    exercises = getDailyMobilityPlanExercises(date);
  } else {
    exercises = getExerciseIntensityMap(planId, type);
  }
  const intensityByKey = new Map(
    exercises.map((exercise) => [
      exercise.key,
      clampExerciseIntensity(exercise.intensity, 1)
    ])
  );

  const table = type === "mobility" ? "mobility_logs" : "exercise_logs";
  const logs = db
    .prepare(
      `
      SELECT exercise, completed
      FROM ${table}
      WHERE workout_date = ? AND plan_id = ?
      `
    )
    .all(date, planId);

  const total = logs.reduce((sum, log) => {
    if (!log.completed) return sum;
    return sum + (intensityByKey.get(log.exercise) ?? 1);
  }, 0);

  return Math.max(0, total);
}

function getCompletedChecklistItems(date, planId, type) {
  const table = type === "mobility" ? "mobility_logs" : "exercise_logs";
  const logs = db
    .prepare(
      `
      SELECT exercise, completed
      FROM ${table}
      WHERE workout_date = ? AND plan_id = ?
      ORDER BY id ASC
      `
    )
    .all(date, planId);

  return logs
    .filter((log) => !!log.completed)
    .map((log) => ({
      exercise: log.exercise,
      completed: true
    }));
}

function getLatestPlanIdForDate(date, type) {
  const table = type === "mobility" ? "mobility_logs" : "exercise_logs";
  const row = db
    .prepare(
      `
      SELECT plan_id
      FROM ${table}
      WHERE workout_date = ?
      ORDER BY (plan_id = 0) ASC, updated_at DESC, id DESC
      LIMIT 1
      `
    )
    .get(date);
  return row?.plan_id ?? null;
}

function getMobilityPlanById(id) {
  if (id === 0) {
    return {
      ...DEFAULT_MOBILITY_PLAN,
      exercises: normalizeExercises(DEFAULT_MOBILITY_PLAN.exercises, 0)
    };
  }
  const row = db
    .prepare(
      `
      SELECT id, day_number, focus, exercises
      FROM mobility_plans
      WHERE id = ?
      `
    )
    .get(id);
  if (!row) return null;
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return { ...row, exercises: normalizeExercises(exercises, 0), difficulty: 1 };
}

function getFirstMobilityPlan() {
  const row = db
    .prepare(
      `
      SELECT id, day_number, focus, exercises
      FROM mobility_plans
      ORDER BY day_number ASC, id ASC
      LIMIT 1
      `
    )
    .get();
  if (!row) {
    return {
      ...DEFAULT_MOBILITY_PLAN,
      exercises: normalizeExercises(DEFAULT_MOBILITY_PLAN.exercises, 0)
    };
  }
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return { ...row, exercises: normalizeExercises(exercises, 0), difficulty: 1 };
}

function getNextMobilityPlan(afterDayNumber) {
  const row = db
    .prepare(
      `
      SELECT id, day_number, focus, exercises
      FROM mobility_plans
      WHERE day_number > ?
      ORDER BY day_number ASC, id ASC
      LIMIT 1
      `
    )
    .get(afterDayNumber);
  if (!row) return getFirstMobilityPlan();
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return { ...row, exercises: normalizeExercises(exercises, 0), difficulty: 1 };
}

function getMobilityPlanForDate(dateISO) {
  const existing = db
    .prepare(
      `
      SELECT plan_id
      FROM mobility_logs
      WHERE workout_date = ?
      LIMIT 1
      `
    )
    .get(dateISO);
  if (existing?.plan_id !== undefined) {
    return getMobilityPlanById(existing.plan_id) || getFirstMobilityPlan();
  }

  const lastAssigned = db
    .prepare(
      `
      SELECT plan_id
      FROM mobility_logs
      WHERE workout_date < ?
      ORDER BY workout_date DESC, updated_at DESC
      LIMIT 1
      `
    )
    .get(dateISO);

  if (lastAssigned?.plan_id !== undefined) {
    const lastPlan = getMobilityPlanById(lastAssigned.plan_id);
    if (lastPlan) {
      return getNextMobilityPlan(lastPlan.day_number ?? 0);
    }
  }

  return getFirstMobilityPlan();
}

// Agent-generated daily workout plan
app.post("/api/daily-plan", (req, res) => {
  const { date, focus, exercises } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
    return res.status(400).json({ error: "exercises must be a non-empty array" });
  }

  db.prepare(`
    INSERT INTO daily_plans (workout_date, focus, exercises, difficulty)
    VALUES (?, ?, ?, NULL)
    ON CONFLICT(workout_date) DO UPDATE SET
      focus = excluded.focus,
      exercises = excluded.exercises,
      difficulty = excluded.difficulty,
      created_at = excluded.created_at
  `).run(date, focus || "custom", JSON.stringify(exercises));
  
  res.json({ ok: true, date, exerciseCount: exercises.length });
});

// Get agent-generated plan for a date (falls back to default if none)
app.get("/api/daily-plan/:date", (req, res) => {
  const { date } = req.params;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  
  const row = db.prepare(`
    SELECT workout_date, focus, exercises, difficulty
    FROM daily_plans
    WHERE workout_date = ?
  `).get(date);
  
  if (!row) {
    return res.json({ date, plan: null, usingDefault: true });
  }
  
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  
  res.json({
    date,
    plan: {
      focus: row.focus,
      exercises: normalizeExercises(exercises, 1)
    },
    usingDefault: false
  });
});

// Agent-only logging endpoint (UI does not expose controls).
app.post("/api/workouts", (req, res) => {
  const { date, intensity = 0, note = "", completedItems = [] } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  const safeIntensity = Number.isInteger(intensity) ? intensity : parseInt(intensity, 10);
  if (Number.isNaN(safeIntensity) || safeIntensity < 0) {
    return res.status(400).json({ error: "intensity must be >= 0" });
  }
  const safeNote = String(note || "");
  const stmt = db.prepare(
    "INSERT INTO workouts (workout_date, intensity, note) VALUES (?, ?, ?)"
  );
  const info = stmt.run(date, safeIntensity, safeNote);

  const normalizedItems = normalizeCompletedItems(completedItems);
  if (
    normalizedItems.length > 0 &&
    (safeNote === "checklist" || safeNote === "mobility-checklist")
  ) {
    upsertWorkoutSnapshot(date, safeNote, normalizedItems);
  }

  res.json({ ok: true, id: info.lastInsertRowid });
});

// Optional daily summary override for "today" display.
app.post("/api/today", (req, res) => {
  const { date, intensity = null, note = "" } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  let safeIntensity = null;
  if (intensity !== null && intensity !== undefined) {
    safeIntensity = Number.isInteger(intensity) ? intensity : parseInt(intensity, 10);
    if (Number.isNaN(safeIntensity) || safeIntensity < 0 || safeIntensity > 4) {
      return res.status(400).json({ error: "intensity must be 0-4 or null" });
    }
  }
  db.prepare(
    `
    INSERT INTO daily_summary (workout_date, intensity, note, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(workout_date) DO UPDATE SET
      intensity = excluded.intensity,
      note = excluded.note,
      updated_at = excluded.updated_at
    `
  ).run(date, safeIntensity, String(note || ""));

  res.json({ ok: true });
});

app.get("/api/heatmap", (req, res) => {
  res.set("Cache-Control", "no-store");
  const days = Math.min(Math.max(parseInt(req.query.days || "365", 10), 30), 730);
  const type = req.query.type || "workout";
  const includeDetails = req.query.details === "1";
  const end = new Date();
  const endISO = toLocalISODate(end);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const startISO = toLocalISODate(start);

  const note = type === "mobility" ? "mobility-checklist" : "checklist";
  const rows = db
    .prepare(
      `
      SELECT workout_date as date, SUM(intensity) as total
      FROM workouts
      WHERE workout_date BETWEEN ? AND ? AND note = ?
      GROUP BY workout_date
      ORDER BY workout_date ASC
      `
    )
    .all(startISO, endISO, note);

  const data = rows.map((row) => ({
    date: row.date,
    total: Math.max(0, row.total || 0)
  }));

  if (!includeDetails) {
    return res.json({ start: startISO, end: endISO, days, data });
  }

  const details = {};
  const snapshotRows = db
    .prepare(
      `
      SELECT workout_date as date, note, items
      FROM workout_snapshots
      WHERE workout_date BETWEEN ? AND ?
      `
    )
    .all(startISO, endISO);

  const placeholderDates = new Set();

  snapshotRows.forEach((row) => {
    let items = [];
    try {
      items = JSON.parse(row.items || "[]");
    } catch {
      items = [];
    }
    if (isPlaceholderSnapshot(items, row.note)) {
      placeholderDates.add(`${row.date}|${row.note}`);
      return;
    }
    if (!details[row.date]) {
      details[row.date] = { workout: [], mobility: [] };
    }
    if (row.note === "mobility-checklist") {
      details[row.date].mobility = items;
    } else if (row.note === "checklist") {
      details[row.date].workout = items;
    }
  });

  const workoutRows = db
    .prepare(
      `
      SELECT workout_date as date, note
      FROM workouts
      WHERE workout_date BETWEEN ? AND ?
        AND note IN ('checklist', 'mobility-checklist')
      `
    )
    .all(startISO, endISO);

  workoutRows.forEach((row) => {
    const slot = row.note === "mobility-checklist" ? "mobility" : "workout";
    const hasSnapshot =
      details[row.date] && Array.isArray(details[row.date][slot]);
    if (hasSnapshot && !placeholderDates.has(`${row.date}|${row.note}`)) return;
    const type = row.note === "mobility-checklist" ? "mobility" : "workout";
    const planId = getLatestPlanIdForDate(row.date, type);
    if (planId === null) {
      if (!details[row.date]) {
        details[row.date] = { workout: [], mobility: [] };
      }
      details[row.date][slot] = [];
      return;
    }
    const items = getCompletedChecklistItems(row.date, planId, type);
    if (!details[row.date]) {
      details[row.date] = { workout: [], mobility: [] };
    }
    details[row.date][slot] = items;
    upsertWorkoutSnapshot(row.date, row.note, items);
  });

  res.json({ start: startISO, end: endISO, days, data, details });
});

app.get("/api/today", (req, res) => {
  const today = resolveRequestedDate(req);
  const summary = db
    .prepare(
      `
      SELECT workout_date as date, intensity, note
      FROM daily_summary
      WHERE workout_date = ?
      `
    )
    .get(today);

  const row = db
    .prepare(
      `
      SELECT workout_date as date, SUM(intensity) as total, MAX(note) as note
      FROM workouts
      WHERE workout_date = ?
      GROUP BY workout_date
      `
    )
    .get(today);

  const baseIntensity = row ? mapIntensityToLevel(row.total || 0) : 0;
  const intensity = summary?.intensity ?? baseIntensity;
  res.json({
    date: today,
    intensity,
    note: summary?.note || row?.note || ""
  });
});

app.get("/api/today-plan", (req, res) => {
  const today = resolveRequestedDate(req);
  const dailyRow = db.prepare(
    `
    SELECT workout_date, focus, exercises, difficulty
    FROM daily_plans
    WHERE workout_date = ?
    `
  ).get(today);

  let plan = null;
  if (dailyRow) {
    let exercises = [];
    try {
      exercises = JSON.parse(dailyRow.exercises || "[]");
    } catch {
      exercises = [];
    }
    plan = {
      id: 0,
      day_number: 0,
      focus: dailyRow.focus || "",
      exercises
    };

    db.prepare(
      `
      DELETE FROM exercise_logs
      WHERE workout_date = ? AND plan_id != 0
      `
    ).run(today);
  } else {
    plan = getPlanForDate(today);
  }

  // Recovery/mobility days have zero intensity
  const isRecovery = /mobility|recovery|stretch|yoga|rest/i.test(plan.focus || "");
  const defaultIntensity = isRecovery ? 0 : 1;
  const normalizedExercises = normalizeExercises(plan.exercises || [], defaultIntensity);

  if (normalizedExercises.length) {
    const keys = normalizedExercises.map((ex) => ex.key);
    db.prepare(
      `
      DELETE FROM exercise_logs
      WHERE workout_date = ? AND plan_id = ? AND exercise NOT IN (${keys
        .map(() => "?")
        .join(",")})
      `
    ).run(today, plan.id, ...keys);

    const insert = db.prepare(
      `
      INSERT OR IGNORE INTO exercise_logs (workout_date, plan_id, exercise, completed)
      VALUES (?, ?, ?, 0)
      `
    );
    const insertMany = db.transaction((rows) => {
      rows.forEach((exercise) => {
        insert.run(today, plan.id, exercise.key);
      });
    });
    insertMany(normalizedExercises);
  }

  const logs = db
    .prepare(
      `
      SELECT exercise, completed
      FROM exercise_logs
      WHERE workout_date = ? AND plan_id = ?
      ORDER BY id ASC
      `
    )
    .all(today, plan.id);

  res.json({
    date: today,
    plan: {
      id: plan.id,
      dayNumber: plan.day_number ?? 0,
      focus: plan.focus || "",
      exercises: normalizedExercises
    },
    logs
  });
});

app.get("/api/today-mobility", (req, res) => {
  const today = resolveRequestedDate(req);
  
  // If today's daily plan is already mobility/recovery focused, skip separate mobility
  const dailyPlan = db.prepare(
    `SELECT focus FROM daily_plans WHERE workout_date = ?`
  ).get(today);
  if (dailyPlan?.focus && /mobility|recovery|stretch|yoga/i.test(dailyPlan.focus)) {
    return res.json({
      date: today,
      plan: { id: 0, dayNumber: 0, focus: "", difficulty: 1, exercises: [] },
      logs: []
    });
  }
  
  const dailyRow = db.prepare(
    `
    SELECT workout_date, focus, exercises, difficulty
    FROM daily_mobility_plans
    WHERE workout_date = ?
    `
  ).get(today);

  let plan = null;
  if (dailyRow) {
    let exercises = [];
    try {
      exercises = JSON.parse(dailyRow.exercises || "[]");
    } catch {
      exercises = [];
    }
    plan = {
      id: 0,
      day_number: 0,
      focus: dailyRow.focus || "",
      exercises
    };

    db.prepare(
      `
      DELETE FROM mobility_logs
      WHERE workout_date = ? AND plan_id != 0
      `
    ).run(today);
  } else {
    plan = getMobilityPlanForDate(today);
  }

  const normalizedExercises = normalizeExercises(plan.exercises || [], 1);

  if (normalizedExercises.length) {
    const keys = normalizedExercises.map((ex) => ex.key);
    db.prepare(
      `
      DELETE FROM mobility_logs
      WHERE workout_date = ? AND plan_id = ? AND exercise NOT IN (${keys
        .map(() => "?")
        .join(",")})
      `
    ).run(today, plan.id, ...keys);

    const insert = db.prepare(
      `
      INSERT OR IGNORE INTO mobility_logs (workout_date, plan_id, exercise, completed)
      VALUES (?, ?, ?, 0)
      `
    );
    const insertMany = db.transaction((rows) => {
      rows.forEach((exercise) => {
        insert.run(today, plan.id, exercise.key);
      });
    });
    insertMany(normalizedExercises);
  }

  const logs = db
    .prepare(
      `
      SELECT exercise, completed
      FROM mobility_logs
      WHERE workout_date = ? AND plan_id = ?
      ORDER BY id ASC
      `
    )
    .all(today, plan.id);

  res.json({
    date: today,
    plan: {
      id: plan.id,
      dayNumber: plan.day_number ?? 0,
      focus: plan.focus || "",
      exercises: normalizedExercises
    },
    logs
  });
});

app.post("/api/checklist-items", (req, res) => {
  const { date, type, focus = "custom", items = [] } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  if (type !== "workout" && type !== "mobility") {
    return res.status(400).json({ error: "type must be workout or mobility" });
  }

  const sanitized = sanitizeChecklistItems(items);
  const planItems = sanitized.map((item) => ({
    exercise: item.exercise,
    intensity: item.intensity
  }));
  const completedFlags = sanitized.map((item) => !!item.completed);

  if (type === "workout") {
    db.prepare(
      `
      INSERT INTO daily_plans (workout_date, focus, exercises, difficulty)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(workout_date) DO UPDATE SET
        focus = excluded.focus,
        exercises = excluded.exercises,
        difficulty = excluded.difficulty,
        created_at = excluded.created_at
      `
    ).run(date, focus || "custom", JSON.stringify(planItems));
  } else {
    db.prepare(
      `
      INSERT INTO daily_mobility_plans (workout_date, focus, exercises, difficulty)
      VALUES (?, ?, ?, NULL)
      ON CONFLICT(workout_date) DO UPDATE SET
        focus = excluded.focus,
        exercises = excluded.exercises,
        difficulty = excluded.difficulty,
        created_at = excluded.created_at
      `
    ).run(date, focus || "mobility", JSON.stringify(planItems));
  }

  const isRecovery = /mobility|recovery|stretch|yoga|rest/i.test(focus || "");
  const defaultIntensity = type === "mobility" ? 0 : isRecovery ? 0 : 1;
  const normalizedExercises = normalizeExercises(planItems, defaultIntensity);
  const table = type === "mobility" ? "mobility_logs" : "exercise_logs";

  db.prepare(
    `
    DELETE FROM ${table}
    WHERE workout_date = ?
    `
  ).run(date);

  if (normalizedExercises.length) {
    const insert = db.prepare(
      `
      INSERT OR IGNORE INTO ${table} (workout_date, plan_id, exercise, completed)
      VALUES (?, 0, ?, ?)
      `
    );
    const insertMany = db.transaction((rows) => {
      rows.forEach((exercise, index) => {
        insert.run(date, exercise.key, completedFlags[index] ? 1 : 0);
      });
    });
    insertMany(normalizedExercises);
  }

  const intensityTotal = computeChecklistIntensity(date, 0, type);
  const note = type === "mobility" ? "mobility-checklist" : "checklist";
  upsertWorkoutIntensity(date, note, intensityTotal);
  const completedItems = getCompletedChecklistItems(date, 0, type);
  if (completedItems.length) {
    upsertWorkoutSnapshot(date, note, completedItems);
  }
  const level = mapIntensityToLevel(intensityTotal);
  res.json({ ok: true, total: intensityTotal, level });
});

app.post("/api/exercise-log", (req, res) => {
  const { date, planId, exercise, completed } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  if (planId === undefined || planId === null) {
    return res.status(400).json({ error: "planId is required" });
  }
  if (!exercise) {
    return res.status(400).json({ error: "exercise is required" });
  }
  const safeCompleted = completed ? 1 : 0;
  const safePlanId = Number.isInteger(planId) ? planId : parseInt(planId, 10);
  if (Number.isNaN(safePlanId)) {
    return res.status(400).json({ error: "planId must be a number" });
  }

  db.prepare(
    `
    INSERT INTO exercise_logs (workout_date, plan_id, exercise, completed, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workout_date, plan_id, exercise) DO UPDATE SET
      completed = excluded.completed,
      updated_at = excluded.updated_at
    `
  ).run(date, safePlanId, String(exercise), safeCompleted);

  const allLogs = db
    .prepare(
      `
      SELECT COUNT(*) as total, SUM(completed) as completed
      FROM exercise_logs
      WHERE workout_date = ? AND plan_id = ?
      `
    )
    .get(date, safePlanId);

  const total = allLogs?.total || 0;
  const done = allLogs?.completed || 0;
  const allCompleted = total > 0 && total === done;

  if (allCompleted) {
    if (safePlanId !== 0) {
      db.prepare(
        `
        UPDATE workout_plans
        SET completed_at = datetime('now')
        WHERE id = ? AND completed_at IS NULL
        `
      ).run(safePlanId);
    }
  }

  const intensityTotal = computeChecklistIntensity(date, safePlanId, "workout");
  upsertWorkoutIntensity(date, "checklist", intensityTotal);
  const workoutItems = getCompletedChecklistItems(date, safePlanId, "workout");
  upsertWorkoutSnapshot(date, "checklist", workoutItems);
  const level = mapIntensityToLevel(intensityTotal);

  res.json({ ok: true, allCompleted, total: intensityTotal, level });
});

app.post("/api/mobility-log", (req, res) => {
  const { date, planId, exercise, completed } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  if (planId === undefined || planId === null) {
    return res.status(400).json({ error: "planId is required" });
  }
  if (!exercise) {
    return res.status(400).json({ error: "exercise is required" });
  }
  const safeCompleted = completed ? 1 : 0;
  const safePlanId = Number.isInteger(planId) ? planId : parseInt(planId, 10);
  if (Number.isNaN(safePlanId)) {
    return res.status(400).json({ error: "planId must be a number" });
  }

  db.prepare(
    `
    INSERT INTO mobility_logs (workout_date, plan_id, exercise, completed, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workout_date, plan_id, exercise) DO UPDATE SET
      completed = excluded.completed,
      updated_at = excluded.updated_at
    `
  ).run(date, safePlanId, String(exercise), safeCompleted);

  const allLogs = db
    .prepare(
      `
      SELECT COUNT(*) as total, SUM(completed) as completed
      FROM mobility_logs
      WHERE workout_date = ? AND plan_id = ?
      `
    )
    .get(date, safePlanId);

  const total = allLogs?.total || 0;
  const done = allLogs?.completed || 0;
  const allCompleted = total > 0 && total === done;

  if (allCompleted) {
    if (safePlanId !== 0) {
      db.prepare(
        `
        UPDATE mobility_plans
        SET completed_at = datetime('now')
        WHERE id = ? AND completed_at IS NULL
        `
      ).run(safePlanId);
    }
  }

  const intensityTotal = computeChecklistIntensity(date, safePlanId, "mobility");
  upsertWorkoutIntensity(date, "mobility-checklist", intensityTotal);
  const mobilityItems = getCompletedChecklistItems(date, safePlanId, "mobility");
  upsertWorkoutSnapshot(date, "mobility-checklist", mobilityItems);
  const level = mapIntensityToLevel(intensityTotal);

  res.json({ ok: true, allCompleted, total: intensityTotal, level });
});

app.listen(PORT, () => {
  console.log(`Workout heatmap running on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
