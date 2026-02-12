# slowburn

slowburn is a GitHub-style workout heatmap with daily checklist, SQLite database, and AI agent integration.

![Light and dark mode supported]

## Features

- 🟢 **GitHub-style green heatmap** — visualize your workout streak
- ✅ **Daily checklist** — check off exercises as you complete them
- ✏️ **Inline CRUD** — edit names/intensity or delete items in-place
- 🔄 **Auto-sync** — partial completion updates today's heatmap total + level
- 🎚️ **Per-exercise intensity** — each activity can contribute 0–10 points (stored in DB)
- 🌙 **Dark mode** — automatic, follows system preference
- 🤖 **Agent-friendly API** — designed for AI assistant integration
- 📱 **Responsive** — works on mobile and desktop

## Run locally

```bash
npm install
npm run dev
```

App runs at `http://localhost:3000`.

## Database

SQLite file: `slowburn.db`

### Tables

| Table | Purpose |
|-------|---------|
| `workouts` | Heatmap totals (raw intensity sum per day) |
| `workout_plans` | Planned workouts with exercises (JSON array) |
| `exercise_logs` | Workout checklist completion tracking |
| `mobility_plans` | Planned mobility sessions with exercises (JSON array) |
| `mobility_logs` | Mobility checklist completion tracking |
| `daily_summary` | Optional override for today display |
| `daily_plans` | Agent-provided daily workout overrides |
| `daily_mobility_plans` | Agent-provided daily mobility overrides |
| `workout_snapshots` | Tooltip source of truth (completed items per day) |

## UI Behavior

- **Workout checklist** shows today's planned workout from `workout_plans`
- **Mobility checklist** shows today's plan from `mobility_plans`
- **Inline edits** persist via `/api/checklist-items` (workout or mobility)
- **Check all** button marks all exercises complete at once
- Checking exercises increases today's heatmap **total**; unchecking decreases it
- Heatmap shows **level** based on total intensity thresholds
- Page auto-refreshes at **midnight** to load next day's plan
- Tooltips use `workout_snapshots` (kept in sync with checklist completions)

## API

### Health
```
GET /api/health
```

### Get today's plan + checklist state
```
GET /api/today-plan
```

Response:
```json
{
  "date": "2026-01-31",
  "plan": {
    "id": 1,
    "dayNumber": 2,
    "focus": "upper body",
    "difficulty": 3,
    "exercises": [
      {"exercise": "push-up", "intensity": 2},
      {"exercise": "plank", "intensity": 1},
      {"exercise": "jog", "intensity": 3}
    ]
  },
  "logs": [
    {"exercise": "push-up", "completed": 1},
    {"exercise": "plank", "completed": 0}
  ]
}
```

### Log exercise completion
```
POST /api/exercise-log
```

Body:
```json
{
  "date": "2026-01-31",
  "planId": 1,
  "exercise": "push-up",
  "completed": true
}
```

Each exercise can include an `intensity` (0–10). The heatmap stores the **total** and maps it to a **level** for color.

### Get today's mobility plan + checklist state
```
GET /api/today-mobility
```

### Log mobility completion
```
POST /api/mobility-log
```

Body:
```json
{
  "date": "2026-01-31",
  "planId": 1,
  "exercise": "hip opener",
  "completed": true
}
```

### Create/update checklist items (inline CRUD)
```
POST /api/checklist-items
```

Body:
```json
{
  "date": "2026-02-08",
  "type": "workout",
  "focus": "upper body",
  "items": [
    { "exercise": "push-up", "intensity": 2, "completed": true },
    { "exercise": "plank", "intensity": 1, "completed": false }
  ]
}
```

Notes:
- `type` must be `workout` or `mobility`.
- This endpoint updates the daily plan override, logs, heatmap totals, and snapshots.

### Log a workout directly (agent use)
```
POST /api/workouts
```

Body:
```json
{
  "date": "2026-01-31",
  "intensity": 8,
  "note": "morning run",
  "completedItems": ["easy jog", "strides"]
}
```

### Get heatmap data
```
GET /api/heatmap?days=365
```
Response rows include `total` (raw sum) and `level` (mapped color):
```json
{"date":"2026-02-01","total":8,"level":3}
```

To include tooltip details (from `workout_snapshots`):
```
GET /api/heatmap?days=365&details=1
```

### Create/update a daily plan (agent override)
```
POST /api/daily-plan
```

Body:
```json
{
  "date": "2026-01-31",
  "focus": "judo",
  "exercises": [{"exercise": "judo", "intensity": 8}]
}
```

### Get a daily plan by date
```
GET /api/daily-plan/2026-01-31
```

### Create/update a daily mobility plan (agent override)
```
POST /api/checklist-items
```

Set `type: "mobility"` and pass `items` for the daily mobility override.

### Get today's summary
```
GET /api/today
```

## Workout Plans

Plans are stored in `workout_plans` with exercises as a JSON array:

```sql
INSERT INTO workout_plans (day_number, focus, exercises) VALUES 
(1, 'full body', '["squats", "push-ups", "plank"]');
```

Exercises can be strings or objects:
```json
[
  "push-ups",
  {"exercise": "sprint", "sets": 5, "distance": "100m", "intensity": 3}
]
```

The UI displays the exercise name; detailed properties are for agent reference. `intensity` controls heatmap contribution.

## Agent Playbook

Use these flows to keep the UI and heatmap consistent:

1) **Set today’s workout plan**
   - `POST /api/daily-plan` with `focus` + `exercises` (include `intensity` on each exercise).
   - The UI will show this plan immediately for today.

2) **Edit checklist items or mark done**
   - Use `POST /api/checklist-items` with `type: "workout"` or `type: "mobility"`.
   - This updates the daily override, logs, heatmap totals, and tooltips in one call.

3) **Insert an ad‑hoc workout**
   - Use `POST /api/workouts` with `note: "checklist"` (or `"mobility-checklist"`) and `completedItems`.
   - This keeps the heatmap and tooltip in sync when logging outside the UI.

4) **Mobility sessions**
   - Use `POST /api/mobility-log` for mobility checklists.
   - Mobility totals are tracked separately (note: `mobility-checklist`).

## Tests

```bash
npm test
```

## Mobility Plans

Plans are stored in `mobility_plans` with exercises as a JSON array:

```sql
INSERT INTO mobility_plans (day_number, focus, exercises) VALUES 
(1, 'hips + ankles', '["ankle circles", "hip openers", "hamstring stretch"]');
```

## Integration with OpenClaw

This app is designed to work with [OpenClaw](https://github.com/openclaw/openclaw) AI agents:

1. Agent sends daily workout reminders via Telegram/etc
2. User checks off exercises in the web UI
3. Heatmap updates automatically
4. Agent can query history and adjust future plans

---

Made with 🏃 by Brock + Rachel 🎵
