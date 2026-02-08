export function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveRequestedDate(req) {
  const requested = req.query?.date;
  if (requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return requested;
  }
  return toLocalISODate(new Date());
}

export function buildExerciseKey(exercise, index, seen) {
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

export function clampWorkoutIntensity(value, fallback = 1) {
  const raw = value === undefined || value === null ? fallback : parseInt(value, 10);
  if (Number.isNaN(raw)) return fallback;
  return Math.max(0, raw);
}

export function clampExerciseIntensity(value, fallback = 1) {
  const raw = value === undefined || value === null ? fallback : parseInt(value, 10);
  if (Number.isNaN(raw)) return fallback;
  return Math.max(0, raw);
}

export function normalizeExercises(exercises, defaultIntensity) {
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

export function normalizeCompletedItems(items) {
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

export function sanitizeChecklistItems(items) {
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
        const intensity = item.intensity ?? item.level ?? item.rating ?? undefined;
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

export function mapIntensityToLevel(total) {
  if (total <= 0) return 0;
  if (total <= 4) return 1;
  if (total <= 7) return 2;
  if (total <= 10) return 3;
  return 4;
}

export function isPlaceholderSnapshot(items, note) {
  if (!Array.isArray(items) || items.length === 0) return true;
  const label =
    note === "mobility-checklist" ? "mobility completed via api" : "completed via api";
  return items.every(
    (item) => item && typeof item === "object" && item.exercise === label
  );
}
