import express from "express";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "workouts.db");

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_date TEXT NOT NULL,
    intensity INTEGER NOT NULL CHECK (intensity >= 0 AND intensity <= 4),
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
`);

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const DEFAULT_PLAN = {
  id: 0,
  day_number: 0,
  focus: "full body",
  exercises: ["squats", "push-ups", "plank"],
  difficulty: 3
};

function getPlanById(id) {
  if (id === 0) return DEFAULT_PLAN;
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
  return { ...row, exercises, difficulty: 3 };
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
  if (!row) return DEFAULT_PLAN;
  let exercises = [];
  try {
    exercises = JSON.parse(row.exercises || "[]");
  } catch {
    exercises = [];
  }
  return { ...row, exercises, difficulty: 3 };
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
  return { ...row, exercises, difficulty: 3 };
}

function getPlanForDate(dateISO) {
  const existing = db
    .prepare(
      `
      SELECT plan_id
      FROM exercise_logs
      WHERE workout_date = ?
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

// Agent-only logging endpoint (UI does not expose controls).
app.post("/api/workouts", (req, res) => {
  const { date, intensity = 0, note = "" } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must be YYYY-MM-DD" });
  }
  const safeIntensity = Number.isInteger(intensity) ? intensity : parseInt(intensity, 10);
  if (Number.isNaN(safeIntensity) || safeIntensity < 0 || safeIntensity > 4) {
    return res.status(400).json({ error: "intensity must be 0-4" });
  }
  const stmt = db.prepare(
    "INSERT INTO workouts (workout_date, intensity, note) VALUES (?, ?, ?)"
  );
  const info = stmt.run(date, safeIntensity, String(note || ""));
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
  const days = Math.min(Math.max(parseInt(req.query.days || "365", 10), 30), 730);
  const end = new Date();
  const endISO = end.toISOString().slice(0, 10);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const startISO = start.toISOString().slice(0, 10);

  const rows = db
    .prepare(
      `
      SELECT workout_date as date, MIN(SUM(intensity), 4) as intensity
      FROM workouts
      WHERE workout_date BETWEEN ? AND ?
      GROUP BY workout_date
      ORDER BY workout_date ASC
      `
    )
    .all(startISO, endISO);

  res.json({ start: startISO, end: endISO, days, data: rows });
});

app.get("/api/today", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
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
      SELECT workout_date as date, SUM(intensity) as intensity, MAX(note) as note
      FROM workouts
      WHERE workout_date = ?
      GROUP BY workout_date
      `
    )
    .get(today);

  const baseIntensity = row ? Math.min(row.intensity || 0, 4) : 0;
  const intensity = summary?.intensity ?? baseIntensity;
  res.json({
    date: today,
    intensity,
    note: summary?.note || row?.note || ""
  });
});

app.get("/api/today-plan", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const plan = getPlanForDate(today);
  const exercises = Array.isArray(plan.exercises) ? plan.exercises : [];

  // Normalize exercises - can be strings or objects with .exercise property
  const normalizedExercises = exercises.map((ex) =>
    typeof ex === "string" ? ex : ex.exercise || JSON.stringify(ex)
  );

  if (normalizedExercises.length) {
    const insert = db.prepare(
      `
      INSERT OR IGNORE INTO exercise_logs (workout_date, plan_id, exercise, completed)
      VALUES (?, ?, ?, 0)
      `
    );
    const insertMany = db.transaction((rows) => {
      rows.forEach((exercise) => {
        insert.run(today, plan.id, exercise);
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
      difficulty: plan.difficulty ?? 3,
      exercises: normalizedExercises
    },
    logs
  });
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

  db.prepare(
    `
    INSERT INTO exercise_logs (workout_date, plan_id, exercise, completed, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(workout_date, plan_id, exercise) DO UPDATE SET
      completed = excluded.completed,
      updated_at = excluded.updated_at
    `
  ).run(date, planId, String(exercise), safeCompleted);

  const allLogs = db
    .prepare(
      `
      SELECT COUNT(*) as total, SUM(completed) as completed
      FROM exercise_logs
      WHERE workout_date = ? AND plan_id = ?
      `
    )
    .get(date, planId);

  const total = allLogs?.total || 0;
  const done = allLogs?.completed || 0;
  const allCompleted = total > 0 && total === done;

  if (allCompleted) {
    if (planId !== 0) {
      db.prepare(
        `
        UPDATE workout_plans
        SET completed_at = datetime('now')
        WHERE id = ? AND completed_at IS NULL
        `
      ).run(planId);
    }

    const plan = getPlanById(planId) || DEFAULT_PLAN;
    const intensity = plan.difficulty ?? 3;
    const existing = db
      .prepare(
        `
        SELECT id
        FROM workouts
        WHERE workout_date = ? AND note = ?
        LIMIT 1
        `
      )
      .get(date, "checklist");
    if (existing?.id) {
      db.prepare(
        `
        UPDATE workouts
        SET intensity = ?, created_at = datetime('now')
        WHERE id = ?
        `
      ).run(intensity, existing.id);
    } else {
      db.prepare(
        `
        INSERT INTO workouts (workout_date, intensity, note)
        VALUES (?, ?, ?)
        `
      ).run(date, intensity, "checklist");
    }
  } else {
    db.prepare(
      `
      DELETE FROM workouts
      WHERE workout_date = ? AND note = ?
      `
    ).run(date, "checklist");
  }

  res.json({ ok: true, allCompleted });
});

app.listen(PORT, () => {
  console.log(`Workout heatmap running on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
