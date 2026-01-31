# Workout Heatmap

Minimal, black‑and‑white workout heatmap with a local SQLite database and a read‑only UI.

## Run locally

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Database

SQLite file is created at `workout-heatmap/workouts.db`.

Tables:
- `workouts`: raw workout logs (used for the heatmap).
- `daily_summary`: optional override for the “today” line.

## API (for your AI agent)

### Health
`GET /api/health`

### Log a workout (affects heatmap)
`POST /api/workouts`

Body:
```json
{
  "date": "YYYY-MM-DD",
  "intensity": 0,
  "note": "optional note"
}
```

Notes:
- `intensity` must be an integer 0–4.
- Multiple logs on the same day are summed (capped at 4) for the heatmap.

### Update “today” summary (optional override)
`POST /api/today`

Body:
```json
{
  "date": "YYYY-MM-DD",
  "intensity": 0,
  "note": "optional note"
}
```

Notes:
- If you set a row in `daily_summary`, the UI uses it for the “today” line.
- If no summary exists, the UI uses the aggregated `workouts` for today.
- `intensity` can be `null` to display “rest” with a note.

### Read the data
`GET /api/heatmap?days=365`
`GET /api/today`

## UI behavior
- The UI does not expose CRUD controls.
- “Today” line is pulled from `/api/today`.
- Heatmap is pulled from `/api/heatmap`.
