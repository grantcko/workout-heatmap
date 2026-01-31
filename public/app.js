const grid = document.getElementById("heatmapGrid");
const monthLabels = document.getElementById("monthLabels");
const todayEl = document.getElementById("todayWorkout");

function setCellSize(weeks) {
  const root = document.documentElement;
  const gap = window.innerWidth <= 520 ? 2 : 3;
  const minCell = window.innerWidth <= 520 ? 9 : 11;
  const maxCell = window.innerWidth <= 520 ? 12 : 16;
  const width = grid.clientWidth || grid.parentElement.clientWidth;
  const raw = Math.floor((width - gap * (weeks - 1)) / weeks);
  const cell = Math.max(minCell, Math.min(maxCell, raw));
  root.style.setProperty("--cell", `${cell}px`);
  root.style.setProperty("--gap", `${gap}px`);
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

function startOfWeekSunday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function buildHeatmap(data, startISO, endISO) {
  const dataMap = new Map(data.map((d) => [d.date, d.intensity]));
  const start = new Date(startISO);
  const end = new Date(endISO);

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
  monthLabels.innerHTML = "";

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
        const intensity = dataMap.get(iso) ?? 0;
        cell.classList.add(`level-${intensity}`);
        cell.title = `${iso} · intensity ${intensity}`;
        cell.setAttribute("role", "gridcell");
      }
      grid.appendChild(cell);
    }
  }

  const monthPositions = new Map();
  for (let w = 0; w < weeks; w++) {
    const weekDate = addDays(firstSunday, w * 7);
    if (weekDate < start || weekDate > end) continue;
    const label = weekDate.toLocaleString("en-US", { month: "short" }).toUpperCase();
    if (!monthPositions.has(label)) {
      monthPositions.set(label, w);
    }
  }

  monthPositions.forEach((weekIndex, label) => {
    const span = document.createElement("span");
    span.textContent = label;
    span.style.gridColumnStart = String(weekIndex + 1);
    monthLabels.appendChild(span);
  });
}

async function loadHeatmap() {
  const res = await fetch("/api/heatmap?days=365");
  const payload = await res.json();
  buildHeatmap(payload.data, payload.start, payload.end);
}

async function loadToday() {
  const res = await fetch("/api/today");
  const payload = await res.json();
  const label = payload.intensity > 0 ? `intensity ${payload.intensity}` : "rest";
  const note = payload.note ? ` · ${payload.note}` : "";
  todayEl.textContent = `${payload.date} · ${label}${note}`;
}

loadHeatmap();
loadToday();

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(loadHeatmap, 150);
});
