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
`);

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

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

app.listen(PORT, () => {
  console.log(`Workout heatmap running on http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
});
