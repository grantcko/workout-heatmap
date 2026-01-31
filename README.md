# Workout Heatmap

GitHub-style workout heatmap with daily checklist, SQLite database, and AI agent integration.

![Light and dark mode supported]

## Features

- 🟢 **GitHub-style green heatmap** — visualize your workout streak
- ✅ **Daily checklist** — check off exercises as you complete them
- 🔄 **Auto-sync** — completing all exercises fills today's heatmap square
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

SQLite file: `workouts.db`

### Tables

| Table | Purpose |
|-------|---------|
| `workouts` | Heatmap intensity data (date + intensity 0-4) |
| `workout_plans` | Planned workouts with exercises (JSON array) |
| `workout_details` | Detailed exercise logs (sets, reps, duration) |
| `exercise_logs` | Per-exercise completion tracking |
| `daily_summary` | Optional override for today display |

## UI Behavior

- **Checklist** shows today's planned workout from `workout_plans`
- **Check all** button marks all exercises complete at once
- Checking **all exercises** automatically logs intensity to heatmap
- **Unchecking** removes the heatmap entry
- Page auto-refreshes at **midnight** to load next day's plan

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
    "exercises": ["push-up", "plank", "jog"]
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

When all exercises are completed, automatically inserts a workout with the plan's difficulty as intensity.

### Log a workout directly (agent use)
```
POST /api/workouts
```

Body:
```json
{
  "date": "2026-01-31",
  "intensity": 3,
  "note": "morning run"
}
```

### Get heatmap data
```
GET /api/heatmap?days=365
```

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
  {"exercise": "sprint", "sets": 5, "distance": "100m"}
]
```

The UI displays the exercise name; detailed properties are for agent reference.

## Integration with OpenClaw

This app is designed to work with [OpenClaw](https://github.com/openclaw/openclaw) AI agents:

1. Agent sends daily workout reminders via Telegram/etc
2. User checks off exercises in the web UI
3. Heatmap updates automatically
4. Agent can query history and adjust future plans

---

Made with 🏃 by Brock + Rachel 🎵
