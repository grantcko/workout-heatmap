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
let currentFocus = "";
let currentMobilityFocus = "";
let workoutItems = [];
let mobilityItems = [];

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

function getItemIntensityValue(item) {
  if (!item || typeof item !== "object") return 1;
  if (item.intensity !== undefined && item.intensity !== null) {
    return item.intensity;
  }
  if (item.displayIntensity !== undefined && item.displayIntensity !== null) {
    return item.displayIntensity;
  }
  return 1;
}

async function saveChecklistItems(type, items, focus) {
  if (!currentDate) return;
  const payloadItems = items
    .map((item) => ({
      exercise: (item?.exercise || "").trim(),
      intensity: getItemIntensityValue(item),
      completed: !!item.completed
    }))
    .filter((item) => item.exercise);

  await fetch("/api/checklist-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      date: currentDate,
      type,
      focus: focus || "custom",
      items: payloadItems
    })
  });

  await loadHeatmap();
  if (type === "workout") {
    await loadPlan();
  } else {
    await loadMobilityPlan();
  }
}

function createChecklistItemActions(item, items, type, focus, listEl) {
  const actions = document.createElement("div");
  actions.className = "checklist-item-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "item-button item-edit";
  editButton.textContent = "edit";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "item-button item-delete";
  deleteButton.textContent = "−";

  editButton.addEventListener("click", () => {
    const li = actions.closest(".checklist-item");
    if (!li) return;
    li.classList.add("is-editing");
    const textEl = li.querySelector(".checklist-text");
    if (!textEl) return;
    textEl.style.display = "none";

    const inputWrap = document.createElement("div");
    inputWrap.className = "checklist-edit";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "checklist-edit-name";
    nameInput.value = item.exercise || "";

    const intensityInput = document.createElement("input");
    intensityInput.type = "number";
    intensityInput.min = "0";
    intensityInput.className = "checklist-edit-intensity";
    intensityInput.value = String(getItemIntensityValue(item));

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.className = "item-button item-save";
    saveButton.textContent = "save";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "item-button item-cancel";
    cancelButton.textContent = "cancel";

    const cleanup = () => {
      inputWrap.remove();
      li.classList.remove("is-editing");
      textEl.style.display = "";
    };

    saveButton.addEventListener("click", async () => {
      item.exercise = nameInput.value.trim() || item.exercise;
      const parsed = parseInt(intensityInput.value, 10);
      item.intensity = Number.isNaN(parsed) ? getItemIntensityValue(item) : parsed;
      item.displayIntensity = item.intensity;
      await saveChecklistItems(type, items, focus);
    });

    cancelButton.addEventListener("click", () => {
      cleanup();
    });

    inputWrap.appendChild(nameInput);
    inputWrap.appendChild(intensityInput);
    inputWrap.appendChild(saveButton);
    inputWrap.appendChild(cancelButton);
    li.appendChild(inputWrap);
    nameInput.focus();
  });

  deleteButton.addEventListener("click", async () => {
    const index = items.indexOf(item);
    if (index >= 0) {
      items.splice(index, 1);
      await saveChecklistItems(type, items, focus);
    }
  });

  actions.appendChild(editButton);
  actions.appendChild(deleteButton);
  return actions;
}

function renderChecklist(listEl, items, type, focus, logsMap, checkAllButton) {
  listEl.innerHTML = "";
  if (!items.length) {
    updateCheckAllButton(listEl, checkAllButton);
    const li = document.createElement("li");
    li.className = "checklist-item";
    const text = document.createElement("span");
    text.className = "checklist-text";
    text.textContent = "rest day";
    li.appendChild(text);
    listEl.appendChild(li);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "checklist-item";

    const row = document.createElement("div");
    row.className = "checklist-row-item";

    const label = document.createElement("label");
    label.className = "checklist-label";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    const checkedValue = logsMap.has(item.key)
      ? logsMap.get(item.key)
      : !!item.completed;
    checkbox.checked = checkedValue || false;
    item.completed = checkbox.checked;
    checkbox.dataset.exercise = item.key;
    checkbox.addEventListener("change", async () => {
      checkbox.disabled = true;
      if (type === "workout") {
        await updateExercise(item.key, checkbox.checked, label, true);
      } else {
        await updateMobilityExercise(item.key, checkbox.checked, label, true);
      }
      item.completed = checkbox.checked;
      await loadHeatmap();
      checkbox.disabled = false;
      updateCheckAllButton(listEl, checkAllButton);
    });

    const span = document.createElement("span");
    span.className = "checklist-text";
    span.textContent = getExerciseLabel(item);

    if (checkbox.checked) {
      label.classList.add("completed");
    }

    label.appendChild(checkbox);
    label.appendChild(span);
    row.appendChild(label);
    row.appendChild(createChecklistItemActions(item, items, type, focus, listEl));
    li.appendChild(row);
    listEl.appendChild(li);
  });

  const addLi = document.createElement("li");
  addLi.className = "checklist-item";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "item-button item-add";
  addButton.textContent = "+ add";
  addButton.addEventListener("click", () => {
    const newItem = {
      exercise: "",
      intensity: 1,
      displayIntensity: 1,
      key: `new-${Date.now()}`,
      completed: false
    };
    items.push(newItem);
    const itemMap = new Map(items.map((entry) => [entry.key, !!entry.completed]));
    renderChecklist(listEl, items, type, focus, itemMap, checkAllButton);
    const lastItem = listEl.querySelector(".checklist-item.is-editing");
    if (lastItem) return;
    const lastLi = listEl.lastElementChild?.previousElementSibling;
    const editButton = lastLi?.querySelector(".item-edit");
    editButton?.click();
  });
  addLi.appendChild(addButton);
  listEl.appendChild(addLi);

  updateCheckAllButton(listEl, checkAllButton);
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
  currentFocus = payload.plan?.focus || "";

  const focus = payload.plan?.focus ? payload.plan.focus.toLowerCase() : "plan";
  const dayNumber = payload.plan?.dayNumber ? `day ${payload.plan.dayNumber}` : "today";
  planMetaEl.textContent = `${dayNumber} · ${focus}`;

  const logsMap = new Map(
    (payload.logs || []).map((item) => [item.exercise, !!item.completed])
  );

  const exercises = extractExercises(payload);
  workoutItems = exercises.map((exercise) => ({
    ...exercise,
    completed: logsMap.get(getExerciseKey(exercise)) || false
  }));

  checkAllButton.onclick = async () => {
    checkAllButton.disabled = true;
    const updates = [];
    const itemByKey = new Map(workoutItems.map((item) => [item.key, item]));
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
          const item = itemByKey.get(input.dataset.exercise);
          if (item) item.completed = false;
          updates.push(
            updateExercise(input.dataset.exercise, false, label, false)
          );
        }
      } else if (!input.checked) {
        input.checked = true;
        label?.classList.add("completed");
        const item = itemByKey.get(input.dataset.exercise);
        if (item) item.completed = true;
        updates.push(updateExercise(input.dataset.exercise, true, label, false));
      }
    });
    await Promise.all(updates);
    await loadHeatmap();
    updateCheckAllButton(checklistEl, checkAllButton);
  };
  renderChecklist(checklistEl, workoutItems, "workout", currentFocus, logsMap, checkAllButton);
}

async function loadMobilityPlan() {
  const todayISO = toISO(new Date());
  const res = await fetch(`/api/today-mobility?date=${todayISO}`, {
    cache: "no-store"
  });
  const payload = await res.json();
  currentDate = payload.date;
  currentMobilityPlanId = payload.plan?.id ?? 0;
  currentMobilityFocus = payload.plan?.focus || "";

  const focus = payload.plan?.focus ? payload.plan.focus.toLowerCase() : "mobility";
  const dayNumber = payload.plan?.dayNumber ? `day ${payload.plan.dayNumber}` : "today";
  mobilityMetaEl.textContent = `${dayNumber} · ${focus}`;

  const logsMap = new Map(
    (payload.logs || []).map((item) => [item.exercise, !!item.completed])
  );

  const exercises = extractExercises(payload);
  mobilityItems = exercises.map((exercise) => ({
    ...exercise,
    completed: logsMap.get(getExerciseKey(exercise)) || false
  }));

  mobilityCheckAllButton.onclick = async () => {
    mobilityCheckAllButton.disabled = true;
    const updates = [];
    const itemByKey = new Map(mobilityItems.map((item) => [item.key, item]));
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
          const item = itemByKey.get(input.dataset.exercise);
          if (item) item.completed = false;
          updates.push(
            updateMobilityExercise(input.dataset.exercise, false, label, false)
          );
        }
      } else if (!input.checked) {
        input.checked = true;
        label?.classList.add("completed");
        const item = itemByKey.get(input.dataset.exercise);
        if (item) item.completed = true;
        updates.push(
          updateMobilityExercise(input.dataset.exercise, true, label, false)
        );
      }
    });
    await Promise.all(updates);
    await loadHeatmap();
    updateCheckAllButton(mobilityChecklistEl, mobilityCheckAllButton);
  };
  renderChecklist(
    mobilityChecklistEl,
    mobilityItems,
    "mobility",
    currentMobilityFocus,
    logsMap,
    mobilityCheckAllButton
  );
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
