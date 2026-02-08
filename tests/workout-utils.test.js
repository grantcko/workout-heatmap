import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExerciseKey,
  clampExerciseIntensity,
  clampWorkoutIntensity,
  isPlaceholderSnapshot,
  mapIntensityToLevel,
  normalizeCompletedItems,
  normalizeExercises,
  sanitizeChecklistItems
} from "../lib/workout-utils.js";

test("buildExerciseKey differentiates duplicates", () => {
  const seen = {};
  const base = buildExerciseKey("push-up", 0, seen);
  const second = buildExerciseKey("push-up", 1, seen);
  assert.equal(base, "push-up");
  assert.equal(second, "push-up #2");
});

test("normalizeExercises applies default intensity", () => {
  const [item] = normalizeExercises(["squats"], 2);
  assert.equal(item.intensity, 2);
  assert.equal(item.displayIntensity, undefined);
});

test("normalizeExercises respects explicit intensity", () => {
  const [item] = normalizeExercises([{ exercise: "rows", intensity: 4 }], 1);
  assert.equal(item.intensity, 4);
  assert.equal(item.displayIntensity, 4);
});

test("sanitizeChecklistItems trims to exercise + intensity", () => {
  const [item] = sanitizeChecklistItems([
    { exercise: "lunges", intensity: 3, completed: true, extra: "x" }
  ]);
  assert.equal(item.exercise, "lunges");
  assert.equal(item.intensity, 3);
  assert.equal(item.completed, true);
});

test("normalizeCompletedItems converts strings to completed items", () => {
  const [item] = normalizeCompletedItems(["deadlift"]);
  assert.deepEqual(item, { exercise: "deadlift", completed: true });
});

test("mapIntensityToLevel matches thresholds", () => {
  assert.equal(mapIntensityToLevel(0), 0);
  assert.equal(mapIntensityToLevel(4), 1);
  assert.equal(mapIntensityToLevel(7), 2);
  assert.equal(mapIntensityToLevel(10), 3);
  assert.equal(mapIntensityToLevel(11), 4);
});

test("isPlaceholderSnapshot detects placeholder items", () => {
  const placeholder = [{ exercise: "completed via api", completed: true }];
  assert.equal(isPlaceholderSnapshot(placeholder, "checklist"), true);
  assert.equal(isPlaceholderSnapshot([{ exercise: "real", completed: true }], "checklist"), false);
});

test("clamp intensities never go negative", () => {
  assert.equal(clampWorkoutIntensity(-5, 1), 0);
  assert.equal(clampExerciseIntensity(-2, 1), 0);
});
