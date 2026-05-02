(function () {
  "use strict";

  const TIME_START = -3200;
  const TIME_END = 2030;
  const ROW_HEIGHT = 28;
  const ROW_PADDING_TOP = 36;
  const LANE_BOTTOM_PAD = 12;
  const MIN_EVENT_PX = 90;
  const ZOOM_LEVELS = { "0.5": 2, "1": 4, "2": 8, "4": 16 };

  let pxPerYear = ZOOM_LEVELS["1"];
  let activeZoom = "1";

  const regions = window.HISTORY_REGIONS;
  const events = window.HISTORY_EVENTS.slice();
  const eventsByRegion = {};
  regions.forEach(function (r) { eventsByRegion[r.id] = []; });
  events.forEach(function (e) {
    if (eventsByRegion[e.region]) eventsByRegion[e.region].push(e);
  });
  Object.keys(eventsByRegion).forEach(function (k) {
    eventsByRegion[k].sort(function (a, b) { return a.start - b.start; });
  });

  const scroll = document.getElementById("scroll");
  const timeline = document.getElementById("timeline");
  const ruler = document.getElementById("ruler");
  const lanesEl = document.getElementById("lanes");
  const tooltip = document.getElementById("tooltip");
  const currentYearEl = document.getElementById("currentYear");

  function formatYear(y) {
    if (y < 0) return Math.abs(y).toLocaleString() + " BCE";
    if (y === 0) return "1 BCE";
    return y + (y < 1000 ? " CE" : "");
  }

  function packRows(list, zoom) {
    const minYears = MIN_EVENT_PX / zoom;
    const gapYears = 6 / zoom;
    const rowEnds = [];
    list.forEach(function (ev) {
      const effEnd = Math.max(ev.end, ev.start) + Math.max(0, minYears - Math.max(0, ev.end - ev.start));
      let placed = false;
      for (let i = 0; i < rowEnds.length; i++) {
        if (ev.start >= rowEnds[i] + gapYears) {
          rowEnds[i] = effEnd;
          ev._row = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev._row = rowEnds.length;
        rowEnds.push(effEnd);
      }
    });
    return rowEnds.length;
  }

  function renderRuler(width, zoom) {
    ruler.innerHTML = "";
    ruler.style.width = width + "px";

    let majorStep, minorStep;
    if (zoom <= 2)      { majorStep = 500; minorStep = 100; }
    else if (zoom <= 4) { majorStep = 200; minorStep = 50; }
    else if (zoom <= 8) { majorStep = 100; minorStep = 25; }
    else                { majorStep = 50;  minorStep = 10; }

    const startTick = Math.ceil(TIME_START / minorStep) * minorStep;
    const frag = document.createDocumentFragment();
    for (let y = startTick; y <= TIME_END; y += minorStep) {
      const tick = document.createElement("div");
      tick.className = "tick";
      if (y % majorStep === 0) tick.className += " major";
      if (y < 0) tick.className += " bce";
      tick.style.left = ((y - TIME_START) * zoom) + "px";
      if (y % majorStep === 0) {
        const lbl = document.createElement("span");
        lbl.className = "tick-label";
        lbl.textContent = formatYear(y);
        tick.appendChild(lbl);
      }
      frag.appendChild(tick);
    }
    const zero = document.createElement("div");
    zero.className = "year-zero";
    zero.style.left = ((0 - TIME_START) * zoom) + "px";
    frag.appendChild(zero);
    ruler.appendChild(frag);
  }

  function renderLanes(width, zoom) {
    lanesEl.innerHTML = "";
    const frag = document.createDocumentFragment();

    regions.forEach(function (r) {
      const list = eventsByRegion[r.id];
      const rowCount = packRows(list, zoom);
      const lane = document.createElement("div");
      lane.className = "lane";
      lane.style.setProperty("--region-color", r.color);
      lane.style.width = width + "px";
      lane.style.height = (ROW_PADDING_TOP + rowCount * ROW_HEIGHT + LANE_BOTTOM_PAD) + "px";

      const label = document.createElement("div");
      label.className = "lane-label";
      const dot = document.createElement("span");
      dot.className = "dot";
      label.appendChild(dot);
      label.appendChild(document.createTextNode(r.name));
      lane.appendChild(label);

      list.forEach(function (ev) {
        const startPx = (ev.start - TIME_START) * zoom;
        const span = Math.max(0, ev.end - ev.start);
        const visualWidth = Math.max(MIN_EVENT_PX, span * zoom);
        const div = document.createElement("div");
        div.className = "event event-" + ev.type;
        if (span === 0) div.classList.add("event-point");
        div.style.left = startPx + "px";
        div.style.top = (ROW_PADDING_TOP + ev._row * ROW_HEIGHT) + "px";
        div.style.width = visualWidth + "px";
        div._event = ev;
        div._region = r;

        const span1 = document.createElement("span");
        span1.className = "event-label";
        span1.textContent = ev.title;
        div.appendChild(span1);

        lane.appendChild(div);
      });

      frag.appendChild(lane);
    });

    lanesEl.appendChild(frag);
  }

  function render() {
    const width = (TIME_END - TIME_START) * pxPerYear;
    timeline.style.width = width + "px";
    renderRuler(width, pxPerYear);
    renderLanes(width, pxPerYear);
  }

  function setZoom(key) {
    const newZoom = ZOOM_LEVELS[key];
    if (!newZoom) return;
    const center = scroll.scrollLeft + scroll.clientWidth / 2;
    const centerYear = TIME_START + center / pxPerYear;
    pxPerYear = newZoom;
    activeZoom = key;
    render();
    document.querySelectorAll(".zoom button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.zoom === key);
    });
    const newCenter = (centerYear - TIME_START) * pxPerYear;
    scroll.scrollLeft = newCenter - scroll.clientWidth / 2;
    updateCurrentYear();
  }

  function jumpToYear(year, smooth) {
    const x = (year - TIME_START) * pxPerYear;
    scroll.scrollTo({
      left: x - scroll.clientWidth / 2,
      behavior: smooth ? "smooth" : "auto"
    });
  }

  function updateCurrentYear() {
    const center = scroll.scrollLeft + scroll.clientWidth / 2;
    const year = Math.round(TIME_START + center / pxPerYear);
    currentYearEl.textContent = formatYear(year);
  }

  function renderLegend() {
    const el = document.getElementById("legend");
    const items = regions.map(function (r) {
      return '<div class="legend-item"><span class="swatch" style="background:' + r.color + '"></span>' + r.name + "</div>";
    }).join("");
    el.innerHTML = items + '<div class="hint">drag to pan &middot; scroll wheel = horizontal &middot; +/&minus; to zoom &middot; arrows to scroll</div>';
  }

  // --- interactions ---

  document.querySelectorAll(".zoom button").forEach(function (b) {
    b.addEventListener("click", function () { setZoom(b.dataset.zoom); });
  });

  document.querySelectorAll(".eras button").forEach(function (b) {
    b.addEventListener("click", function () { jumpToYear(parseInt(b.dataset.year, 10), true); });
  });

  document.getElementById("jumpBtn").addEventListener("click", function () {
    const v = parseInt(document.getElementById("jumpYear").value, 10);
    if (!isNaN(v)) jumpToYear(v, true);
  });
  document.getElementById("jumpYear").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) jumpToYear(v, true);
    }
  });

  scroll.addEventListener("scroll", updateCurrentYear, { passive: true });

  // wheel: vertical scroll → horizontal scroll (when no horizontal intent already)
  scroll.addEventListener("wheel", function (e) {
    if (e.shiftKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY === 0) return;
    scroll.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // drag to pan
  let dragging = false, dragX = 0, dragScrollX = 0, didDrag = false;
  scroll.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest(".event")) return;
    dragging = true;
    didDrag = false;
    dragX = e.clientX;
    dragScrollX = scroll.scrollLeft;
    scroll.classList.add("grabbing");
  });
  window.addEventListener("mousemove", function (e) {
    if (!dragging) return;
    const dx = e.clientX - dragX;
    if (Math.abs(dx) > 3) didDrag = true;
    scroll.scrollLeft = dragScrollX - dx;
  });
  window.addEventListener("mouseup", function () {
    dragging = false;
    scroll.classList.remove("grabbing");
  });

  // keyboard
  window.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") return;
    const step = scroll.clientWidth * (e.shiftKey ? 0.9 : 0.25);
    if (e.key === "ArrowRight") { scroll.scrollLeft += step; e.preventDefault(); }
    else if (e.key === "ArrowLeft") { scroll.scrollLeft -= step; e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") {
      const order = ["0.5", "1", "2", "4"];
      const i = order.indexOf(activeZoom);
      if (i < order.length - 1) setZoom(order[i + 1]);
    } else if (e.key === "-" || e.key === "_") {
      const order = ["0.5", "1", "2", "4"];
      const i = order.indexOf(activeZoom);
      if (i > 0) setZoom(order[i - 1]);
    }
  });

  // tooltip
  scroll.addEventListener("mouseover", function (e) {
    const el = e.target.closest(".event");
    if (!el || !el._event) return;
    const ev = el._event;
    const r = el._region;
    const range = (ev.start === ev.end) ? formatYear(ev.start) : (formatYear(ev.start) + " – " + formatYear(ev.end));
    const duration = ev.end > ev.start ? " (" + (ev.end - ev.start) + " yr)" : "";
    tooltip.innerHTML =
      '<div><span class="tt-region" style="background:' + r.color + '">' + r.name + '</span>' +
      '<span class="tt-type">' + ev.type + '</span></div>' +
      '<strong>' + escapeHtml(ev.title) + '</strong>' +
      '<div class="tt-meta">' + range + duration + '</div>' +
      (ev.desc ? '<div style="margin-top:4px">' + escapeHtml(ev.desc) + '</div>' : '');
    tooltip.hidden = false;
  });
  scroll.addEventListener("mousemove", function (e) {
    if (tooltip.hidden) return;
    let left = e.clientX + 14;
    let top = e.clientY + 14;
    const rect = tooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - 8) left = e.clientX - rect.width - 14;
    if (top + rect.height > window.innerHeight - 8) top = e.clientY - rect.height - 14;
    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  });
  scroll.addEventListener("mouseout", function (e) {
    if (e.target.closest(".event")) tooltip.hidden = true;
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // --- init ---
  renderLegend();
  render();
  // Start near the user's example era: 1760 (Seven Years War / American Revolution lead-up)
  requestAnimationFrame(function () {
    jumpToYear(1760, false);
    updateCurrentYear();
  });
})();
