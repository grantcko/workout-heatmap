const grid = document.getElementById("heatmapGrid");
const dayLabels = document.getElementById("dayLabels");
const tooltipEl = document.getElementById("heatmapTooltip");
const planMetaEl = document.getElementById("planMeta");
const checklistEl = document.getElementById("checklist");
const checkAllButton = document.getElementById("checkAllButton");
const mobilityMetaEl = document.getElementById("mobilityMeta");
const mobilityChecklistEl = document.getElementById("mobilityChecklist");
const mobilityCheckAllButton = document.getElementById("mobilityCheckAll");

let currentDate = null;
let currentPlanId = null;
let currentMobilityPlanId = null;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTooltipItems(items) {
  if (!items.length) {
    return `<div class="tooltip-empty">none</div>`;
  }
  return items
    .map(
      (item) =>
        `<div class="tooltip-item"><span class="tooltip-check">${item.completed ? "[x]" : "[ ]"}</span><span>${escapeHtml(item.exercise)}</span></div>`
    )
    .join("");
}

function positionTooltip(rect) {
  if (!tooltipEl || !rect) return;
  const padding = 10;
  const tooltipRect = tooltipEl.getBoundingClientRect();
  let top = rect.top - tooltipRect.height - 10;
  if (top < padding) {
    top = rect.bottom + 10;
  }
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
  tooltipEl.style.top = `${Math.round(top)}px`;
  tooltipEl.style.left = `${Math.round(left)}px`;
}

function showTooltip(cell, iso, detailsMap) {
  if (!tooltipEl) return;
  const details = detailsMap?.[iso] || { workout: [], mobility: [] };
  const workoutItems = (details.workout || []).filter((item) => item.completed);
  const mobilityItems = (details.mobility || []).filter((item) => item.completed);
  tooltipEl.innerHTML = `
    <div class="tooltip-date">${escapeHtml(iso)}</div>
    <div class="tooltip-section">
      <div class="tooltip-title">exercise</div>
      ${formatTooltipItems(workoutItems)}
    </div>
    <div class="tooltip-section">
      <div class="tooltip-title">mobility</div>
      ${formatTooltipItems(mobilityItems)}
    </div>
  `;
  tooltipEl.classList.add("is-visible");
  tooltipEl.setAttribute("aria-hidden", "false");
  positionTooltip(cell.getBoundingClientRect());
}

function hideTooltip() {
  if (!tooltipEl) return;
  tooltipEl.classList.remove("is-visible");
  tooltipEl.setAttribute("aria-hidden", "true");
}

function getExerciseKey(exercise) {
  if (typeof exercise === "string") return exercise;
  if (exercise && typeof exercise === "object") {
    return (
      exercise.key ||
      exercise.exercise ||
      exercise.name ||
      exercise.title ||
      exercise.label ||
      JSON.stringify(exercise)
    );
  }
  return String(exercise);
}

function getExerciseDetail(exercise) {
  if (!exercise || typeof exercise !== "object") return "";
  const parts = [];
  if (exercise.sets) parts.push(`${exercise.sets} sets`);
  if (exercise.reps) parts.push(`${exercise.reps} reps`);
  if (exercise.rounds) parts.push(`${exercise.rounds} rounds`);
  if (exercise.minutes) parts.push(`${exercise.minutes} min`);
  if (exercise.seconds) parts.push(`${exercise.seconds} sec`);
  if (exercise.duration) parts.push(String(exercise.duration));
  if (exercise.distance) parts.push(String(exercise.distance));
  if (exercise.hold) parts.push(`${exercise.hold} hold`);
  if (exercise.perSide) parts.push("each side");
  if (exercise.detail) parts.push(String(exercise.detail));
  if (exercise.note) parts.push(String(exercise.note));
  if (exercise.notes) parts.push(String(exercise.notes));
  if (exercise.displayIntensity !== undefined && exercise.displayIntensity !== null) {
    parts.push(`intensity ${exercise.displayIntensity}`);
  }
  return parts.join(" · ");
}

function getExerciseLabel(exercise) {
  if (typeof exercise === "string") return exercise;
  if (!exercise || typeof exercise !== "object") return String(exercise);
  const name = exercise.exercise || exercise.name || exercise.title || exercise.label || "exercise";
  const detail = getExerciseDetail(exercise);
  return detail ? `${name} (${detail})` : name;
}

function extractExercises(payload) {
  const plan = payload?.plan || null;
  const raw =
    plan?.exercises ??
    payload?.exercises ??
    plan?.items ??
    payload?.items ??
    plan?.list ??
    payload?.list ??
    [];

  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.exercises)) return raw.exercises;
    if (Array.isArray(raw.items)) return raw.items;
    if (Array.isArray(raw.list)) return raw.list;
  }
  return [];
}

function setButtonText(buttonEl, text) {
  const textEl = buttonEl.querySelector(".button-text");
  if (textEl) {
    textEl.textContent = text;
  } else {
    buttonEl.textContent = text;
  }
}

function updateCheckAllButton(listEl, buttonEl) {
  const inputs = Array.from(listEl.querySelectorAll("input[type=\"checkbox\"]"));
  if (!inputs.length) {
    buttonEl.disabled = true;
    buttonEl.classList.remove("is-complete");
    setButtonText(buttonEl, "check all");
    return;
  }

  const checkedCount = inputs.filter((input) => input.checked).length;
  const allDone = checkedCount === inputs.length;
  if (allDone) {
    buttonEl.disabled = false;
    buttonEl.classList.add("is-complete");
    setButtonText(buttonEl, "done");
  } else {
    buttonEl.disabled = false;
    buttonEl.classList.remove("is-complete");
    setButtonText(buttonEl, "check all");
  }
}

function getHeatmapWidth() {
  const container = grid.parentElement;
  const containerWidth = container ? container.clientWidth : grid.clientWidth;
  const columnGap = container
    ? parseFloat(getComputedStyle(container).columnGap || "0")
    : 0;
  const dayColumnWidth =
    dayLabels && getComputedStyle(dayLabels).display !== "none"
      ? dayLabels.getBoundingClientRect().width || 32
      : 0;
  return Math.max(containerWidth - dayColumnWidth - columnGap, 0);
}

function setCellSize(weeks) {
  const root = document.documentElement;
  const gap = 2;
  const minCell = window.innerWidth <= 520 ? 9 : 11;
  const maxCell = window.innerWidth <= 520 ? 12 : 16;
  const width = getHeatmapWidth();
  const raw = Math.floor((width - gap * (weeks - 1)) / weeks);
  const cell = Math.max(minCell, Math.min(maxCell, raw));
  root.style.setProperty("--cell", `${cell}px`);
  root.style.setProperty("--gap", `${gap}px`);
}

function getDaysForViewport() {
  const gap = 2;
  const minCell = window.innerWidth <= 520 ? 9 : 11;
  const width = getHeatmapWidth();
  const weeks = Math.max(
    8,
    Math.floor((width + gap) / (minCell + gap))
  );
  const days = weeks * 7;
  return Math.min(365, Math.max(60, days));
}

function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromISODate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeekSunday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const offset = day;
  d.setDate(d.getDate() - offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function getHeatmapLevel(total) {
  if (total <= 0) return 0;
  if (total <= 4) return 1;
  if (total <= 7) return 2;
  if (total <= 10) return 3;
  return 4;
}

function renderDayLabels() {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const visible = new Set(["Mon", "Wed", "Fri"]);
  dayLabels.innerHTML = "";
  dayNames.forEach((label) => {
    const span = document.createElement("span");
    span.className = "day-label";
    if (!visible.has(label)) {
      span.classList.add("is-empty");
    }
    span.textContent = label;
    dayLabels.appendChild(span);
  });
}

function buildHeatmap(data, startISO, endISO, detailsMap = {}) {
  const dataMap = new Map(data.map((d) => [d.date, d]));
  const start = fromISODate(startISO);
  const end = fromISODate(endISO);

  const firstSunday = startOfWeekSunday(start);
  const totalDays = Math.floor((end - firstSunday) / 86400000) + 1;
  const weeks = Math.ceil(totalDays / 7);

  setCellSize(weeks);
  const cellSize = getComputedStyle(document.documentElement)
    .getPropertyValue("--cell")
    .trim() || "16px";
  grid.style.gridAutoColumns = cellSize;
  grid.style.gridTemplateRows = `repeat(7, ${cellSize})`;
  grid.innerHTML = "";
  renderDayLabels();

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const cellDate = addDays(firstSunday, w * 7 + d);
      const iso = toISO(cellDate);
      const cell = document.createElement("div");
      cell.className = "cell";
      if (cellDate < start || cellDate > end) {
        cell.classList.add("level-0");
        cell.setAttribute("aria-hidden", "true");
      } else {
        const entry = dataMap.get(iso);
        const total = entry?.total ?? 0;
        const level = getHeatmapLevel(total);
        cell.classList.add(`level-${level}`);
        cell.setAttribute("role", "gridcell");
        cell.tabIndex = 0;
        cell.dataset.date = iso;
        cell.addEventListener("mouseenter", () => showTooltip(cell, iso, detailsMap));
        cell.addEventListener("mouseleave", hideTooltip);
        cell.addEventListener("focus", () => showTooltip(cell, iso, detailsMap));
        cell.addEventListener("blur", hideTooltip);
      }
      grid.appendChild(cell);
    }
  }

}

async function loadHeatmap() {
  const days = getDaysForViewport();
  hideTooltip();
  const res = await fetch(`/api/heatmap?days=${days}&details=1&t=${Date.now()}`, {
    cache: "no-store"
  });
  const payload = await res.json();
  buildHeatmap(payload.data, payload.start, payload.end, payload.details || {});
}

async function loadPlan() {
  const todayISO = toISO(new Date());
  const res = await fetch(`/api/today-plan?date=${todayISO}`, {
    cache: "no-store"
  });
  const payload = await res.json();
  currentDate = payload.date;
  currentPlanId = payload.plan?.id ?? 0;

  const focus = payload.plan?.focus ? payload.plan.focus.toLowerCase() : "plan";
  const dayNumber = payload.plan?.dayNumber ? `day ${payload.plan.dayNumber}` : "today";
  planMetaEl.textContent = `${dayNumber} · ${focus}`;

  const logsMap = new Map(
    (payload.logs || []).map((item) => [item.exercise, !!item.completed])
  );

  checklistEl.innerHTML = "";
  const exercises = extractExercises(payload);
  if (!exercises.length) {
    updateCheckAllButton(checklistEl, checkAllButton);
    const li = document.createElement("li");
    li.className = "checklist-item";
    const text = document.createElement("span");
    text.className = "checklist-text";
    text.textContent = "rest day";
    li.appendChild(text);
    checklistEl.appendChild(li);
    return;
  }

  checkAllButton.onclick = async () => {
    checkAllButton.disabled = true;
    const updates = [];
    const inputs = Array.from(
      checklistEl.querySelectorAll("input[type=\"checkbox\"]")
    );
    const allDone = inputs.length > 0 && inputs.every((input) => input.checked);
    inputs.forEach((input) => {
      const label = input.closest(".checklist-label");
      if (allDone) {
        if (input.checked) {
          input.checked = false;
          label?.classList.remove("completed");
          updates.push(
            updateExercise(input.dataset.exercise, false, label, false)
          );
        }
      } else if (!input.checked) {
        input.checked = true;
        label?.classList.add("completed");
        updates.push(updateExercise(input.dataset.exercise, true, label, false));
      }
    });
    await Promise.all(updates);
    await loadHeatmap();
    updateCheckAllButton(checklistEl, checkAllButton);
  };

  exercises.forEach((exercise) => {
    const li = document.createElement("li");
    li.className = "checklist-item";

    const label = document.createElement("label");
    label.className = "checklist-label";

    const exerciseKey = getExerciseKey(exercise);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = logsMap.get(exerciseKey) || false;
    checkbox.dataset.exercise = exerciseKey;
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      await updateExercise(exerciseKey, checkbox.checked, label, true);
      await loadHeatmap();
      checkbox.disabled = false;
      updateCheckAllButton(checklistEl, checkAllButton);
    });

    const span = document.createElement("span");
    span.className = "checklist-text";
    span.textContent = getExerciseLabel(exercise);

    if (checkbox.checked) {
      label.classList.add("completed");
    }

    label.appendChild(checkbox);
    label.appendChild(span);
    li.appendChild(label);
    checklistEl.appendChild(li);
  });

  updateCheckAllButton(checklistEl, checkAllButton);
}

async function loadMobilityPlan() {
  const todayISO = toISO(new Date());
  const res = await fetch(`/api/today-mobility?date=${todayISO}`, {
    cache: "no-store"
  });
  const payload = await res.json();
  currentDate = payload.date;
  currentMobilityPlanId = payload.plan?.id ?? 0;

  const focus = payload.plan?.focus ? payload.plan.focus.toLowerCase() : "mobility";
  const dayNumber = payload.plan?.dayNumber ? `day ${payload.plan.dayNumber}` : "today";
  mobilityMetaEl.textContent = `${dayNumber} · ${focus}`;

  const logsMap = new Map(
    (payload.logs || []).map((item) => [item.exercise, !!item.completed])
  );

  mobilityChecklistEl.innerHTML = "";
  const exercises = extractExercises(payload);
  if (!exercises.length) {
    updateCheckAllButton(mobilityChecklistEl, mobilityCheckAllButton);
    const li = document.createElement("li");
    li.className = "checklist-item";
    const text = document.createElement("span");
    text.className = "checklist-text";
    text.textContent = "rest day";
    li.appendChild(text);
    mobilityChecklistEl.appendChild(li);
    return;
  }

  mobilityCheckAllButton.onclick = async () => {
    mobilityCheckAllButton.disabled = true;
    const updates = [];
    const inputs = Array.from(
      mobilityChecklistEl.querySelectorAll("input[type=\"checkbox\"]")
    );
    const allDone = inputs.length > 0 && inputs.every((input) => input.checked);
    inputs.forEach((input) => {
      const label = input.closest(".checklist-label");
      if (allDone) {
        if (input.checked) {
          input.checked = false;
          label?.classList.remove("completed");
          updates.push(
            updateMobilityExercise(input.dataset.exercise, false, label, false)
          );
        }
      } else if (!input.checked) {
        input.checked = true;
        label?.classList.add("completed");
        updates.push(
          updateMobilityExercise(input.dataset.exercise, true, label, false)
        );
      }
    });
    await Promise.all(updates);
    await loadHeatmap();
    updateCheckAllButton(mobilityChecklistEl, mobilityCheckAllButton);
  };

  exercises.forEach((exercise) => {
    const li = document.createElement("li");
    li.className = "checklist-item";

    const label = document.createElement("label");
    label.className = "checklist-label";

    const exerciseKey = getExerciseKey(exercise);
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = logsMap.get(exerciseKey) || false;
    checkbox.dataset.exercise = exerciseKey;
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      await updateMobilityExercise(exerciseKey, checkbox.checked, label, true);
      await loadHeatmap();
      checkbox.disabled = false;
      updateCheckAllButton(mobilityChecklistEl, mobilityCheckAllButton);
    });

    const span = document.createElement("span");
    span.className = "checklist-text";
    span.textContent = getExerciseLabel(exercise);

    if (checkbox.checked) {
      label.classList.add("completed");
    }

    label.appendChild(checkbox);
    label.appendChild(span);
    li.appendChild(label);
    mobilityChecklistEl.appendChild(li);
  });

  updateCheckAllButton(mobilityChecklistEl, mobilityCheckAllButton);
}

async function updateExercise(exercise, completed, labelEl, refresh = true) {
  if (!currentDate) return;
  const res = await fetch("/api/exercise-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: currentDate,
      planId: currentPlanId,
      exercise,
      completed
    })
  });

  if (!res.ok) return;
  if (completed) {
    labelEl.classList.add("completed");
  } else {
    labelEl.classList.remove("completed");
  }

  if (refresh) {
    return;
  }
}

async function updateMobilityExercise(exercise, completed, labelEl, refresh = true) {
  if (!currentDate) return;
  const res = await fetch("/api/mobility-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: currentDate,
      planId: currentMobilityPlanId,
      exercise,
      completed
    })
  });

  if (!res.ok) return;
  if (completed) {
    labelEl.classList.add("completed");
  } else {
    labelEl.classList.remove("completed");
  }

  if (refresh) {
    await loadMobilityPlan();
  }
}

loadHeatmap();
loadPlan();
loadMobilityPlan();

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(loadHeatmap, 150);
});

setInterval(() => {
  const nowISO = toISO(new Date());
  if (currentDate && nowISO !== currentDate) {
    loadHeatmap();
    loadPlan();
    loadMobilityPlan();
  }
}, 60000);
