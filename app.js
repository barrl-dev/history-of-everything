(function () {
  "use strict";

  const TIME_START = -3200;
  const TIME_END = 2030;
  const ROW_HEIGHT = 28;
  const ROW_PADDING_TOP = 36;
  const LANE_BOTTOM_PAD = 12;
  const LABEL_PX = 70;       // horizontal pixels needed to display an event label
  const MIN_BAR_PX = 3;      // smallest visible bar width
  const CLUSTER_MIN_PX = 26; // smallest cluster pill width
  const ZOOM_LEVELS = { "0.5": 2, "1": 4, "2": 8, "4": 16 };
  const ZOOM_ORDER = ["0.5", "1", "2", "4"];

  let pxPerYear = ZOOM_LEVELS["1"];
  let activeZoom = "1";

  const ALL_THEMES = ["war", "religion", "discovery", "cultural", "period", "reign", "event"];
  const activeThemes = new Set(ALL_THEMES);

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

  function visibleEvents(regionId) {
    return eventsByRegion[regionId].filter(function (e) { return activeThemes.has(e.type); });
  }

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

  function rangeOf(ev) {
    return ev.start === ev.end ? formatYear(ev.start) : (formatYear(ev.start) + " – " + formatYear(ev.end));
  }

  // Pack purely by temporal overlap. Events with no time overlap share a row.
  function packRows(list) {
    const rowEnds = [];
    list.forEach(function (ev) {
      const evEnd = Math.max(ev.end, ev.start);
      let placed = false;
      for (let i = 0; i < rowEnds.length; i++) {
        if (ev.start > rowEnds[i]) {
          rowEnds[i] = evEnd;
          ev._row = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev._row = rowEnds.length;
        rowEnds.push(evEnd);
      }
    });
    return rowEnds.length;
  }

  // Within one row, decide whether each event is rendered standalone (with label),
  // as a label-less marker, or grouped into a cluster pill that shows just a count.
  function clusterRow(rowEvents, zoom) {
    const sorted = rowEvents.slice().sort(function (a, b) { return a.start - b.start; });
    const items = [];
    let i = 0;
    while (i < sorted.length) {
      const ev = sorted[i];
      const startPx = (ev.start - TIME_START) * zoom;
      const barWidth = Math.max(MIN_BAR_PX, (ev.end - ev.start) * zoom);
      const next = sorted[i + 1];
      const nextStartPx = next ? (next.start - TIME_START) * zoom : Infinity;

      // Wide enough that the label fits inside the bar.
      if (barWidth >= LABEL_PX) {
        items.push({
          kind: "event",
          ev: ev,
          startPx: startPx,
          barWidth: barWidth,
          hitWidth: barWidth,
          labelInside: true
        });
        i++;
        continue;
      }

      // Narrow, but the next event is far enough that the label can flow into the gap.
      const labelClaim = startPx + Math.max(barWidth, LABEL_PX);
      if (nextStartPx >= labelClaim + 4) {
        items.push({
          kind: "event",
          ev: ev,
          startPx: startPx,
          barWidth: barWidth,
          hitWidth: LABEL_PX,
          labelInside: false
        });
        i++;
        continue;
      }

      // Narrow with no room — start gathering subsequent narrow events into a cluster.
      const cluster = { kind: "cluster", events: [ev], startPx: startPx, endPx: startPx + barWidth };
      i++;
      while (i < sorted.length) {
        const e2 = sorted[i];
        const sp2 = (e2.start - TIME_START) * zoom;
        const bw2 = Math.max(MIN_BAR_PX, (e2.end - e2.start) * zoom);
        if (bw2 >= LABEL_PX) break; // a wide event always stands alone
        if (sp2 >= cluster.endPx + LABEL_PX) break; // far enough to be its own item
        cluster.events.push(e2);
        cluster.endPx = Math.max(cluster.endPx, sp2 + bw2);
        i++;
      }

      if (cluster.events.length === 1) {
        // Solo narrow event with no room — render as a label-less marker.
        items.push({ kind: "marker", ev: cluster.events[0], startPx: cluster.startPx, barWidth: cluster.endPx - cluster.startPx });
      } else {
        items.push(cluster);
      }
    }
    return items;
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
      const list = visibleEvents(r.id);
      const rowCount = Math.max(1, packRows(list));
      const byRow = [];
      for (let i = 0; i < rowCount; i++) byRow.push([]);
      list.forEach(function (ev) { byRow[ev._row].push(ev); });

      const lane = document.createElement("div");
      lane.className = "lane";
      if (list.length === 0) lane.classList.add("lane-empty");
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

      byRow.forEach(function (rowEvents, rowIdx) {
        const items = clusterRow(rowEvents, zoom);
        const top = ROW_PADDING_TOP + rowIdx * ROW_HEIGHT;

        items.forEach(function (item) {
          if (item.kind === "event") {
            const ev = item.ev;
            const div = document.createElement("div");
            div.className = "event event-" + ev.type;
            if (item.labelInside) div.dataset.inside = "1";
            div.style.left = item.startPx + "px";
            div.style.top = top + "px";
            div.style.setProperty("--bar-width", item.barWidth + "px");
            div.style.width = item.hitWidth + "px";
            div._event = ev;
            div._region = r;

            const lbl = document.createElement("span");
            lbl.className = "event-label";
            lbl.textContent = ev.title;
            div.appendChild(lbl);

            lane.appendChild(div);
          } else if (item.kind === "marker") {
            const ev = item.ev;
            const div = document.createElement("div");
            div.className = "event event-" + ev.type + " event-marker";
            div.style.left = item.startPx + "px";
            div.style.top = top + "px";
            div.style.setProperty("--bar-width", item.barWidth + "px");
            div.style.width = Math.max(item.barWidth, 6) + "px";
            div._event = ev;
            div._region = r;
            lane.appendChild(div);
          } else {
            const span = item.endPx - item.startPx;
            const w = Math.max(CLUSTER_MIN_PX, span);
            const div = document.createElement("div");
            div.className = "event-cluster";
            div.style.left = item.startPx + "px";
            div.style.top = top + "px";
            div.style.width = w + "px";
            div._cluster = item;
            div._region = r;

            const num = document.createElement("span");
            num.className = "cluster-count";
            num.textContent = item.events.length;
            div.appendChild(num);

            lane.appendChild(div);
          }
        });
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

  function setZoom(key, opts) {
    const newZoom = ZOOM_LEVELS[key];
    if (!newZoom) return;
    opts = opts || {};
    const center = scroll.scrollLeft + scroll.clientWidth / 2;
    const centerYear = opts.centerYear != null ? opts.centerYear : (TIME_START + center / pxPerYear);
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
    el.innerHTML = items + '<div class="hint">drag to pan &middot; wheel = horizontal &middot; +/&minus; to zoom &middot; click cluster pills to zoom in</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function showEventTooltip(el) {
    const ev = el._event;
    const r = el._region;
    const duration = ev.end > ev.start ? " (" + (ev.end - ev.start) + " yr)" : "";
    tooltip.innerHTML =
      '<div><span class="tt-region" style="background:' + r.color + '">' + r.name + '</span>' +
      '<span class="tt-type">' + ev.type + '</span></div>' +
      '<strong>' + escapeHtml(ev.title) + '</strong>' +
      '<div class="tt-meta">' + rangeOf(ev) + duration + '</div>' +
      (ev.desc ? '<div class="tt-desc">' + escapeHtml(ev.desc) + '</div>' : '');
    tooltip.hidden = false;
  }

  function showClusterTooltip(el) {
    const c = el._cluster;
    const r = el._region;
    const list = c.events.slice(0, 10).map(function (e) {
      return '<div class="tt-cluster-item"><span class="tt-yr">' + rangeOf(e) + '</span> ' + escapeHtml(e.title) + '</div>';
    }).join("");
    const more = c.events.length > 10 ? '<div class="tt-more">+ ' + (c.events.length - 10) + ' more</div>' : '';
    tooltip.innerHTML =
      '<div><span class="tt-region" style="background:' + r.color + '">' + r.name + '</span>' +
      '<span class="tt-type">' + c.events.length + ' events</span></div>' +
      '<div class="tt-cluster-list">' + list + more + '</div>' +
      '<div class="tt-meta tt-hint">click to zoom in</div>';
    tooltip.hidden = false;
  }

  // --- interactions ---

  document.querySelectorAll(".zoom button").forEach(function (b) {
    b.addEventListener("click", function () { setZoom(b.dataset.zoom); });
  });

  document.querySelectorAll(".eras button").forEach(function (b) {
    b.addEventListener("click", function () { jumpToYear(parseInt(b.dataset.year, 10), true); });
  });

  function setThemeButtonState() {
    document.querySelectorAll(".theme-btn").forEach(function (b) {
      b.classList.toggle("active", activeThemes.has(b.dataset.theme));
    });
  }
  document.querySelectorAll(".theme-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      const t = b.dataset.theme;
      if (activeThemes.has(t)) activeThemes.delete(t); else activeThemes.add(t);
      setThemeButtonState();
      render();
    });
  });
  document.getElementById("themesAll").addEventListener("click", function () {
    ALL_THEMES.forEach(function (t) { activeThemes.add(t); });
    setThemeButtonState();
    render();
  });
  document.getElementById("themesNone").addEventListener("click", function () {
    activeThemes.clear();
    setThemeButtonState();
    render();
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

  scroll.addEventListener("wheel", function (e) {
    if (e.shiftKey) return;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY === 0) return;
    scroll.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  let dragging = false, dragX = 0, dragScrollX = 0, didDrag = false;
  scroll.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest(".event") || e.target.closest(".event-cluster")) return;
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

  scroll.addEventListener("click", function (e) {
    const cl = e.target.closest(".event-cluster");
    if (!cl || !cl._cluster) return;
    if (didDrag) return;
    const c = cl._cluster;
    let mid = 0;
    c.events.forEach(function (ev) { mid += (ev.start + ev.end) / 2; });
    mid = mid / c.events.length;
    const idx = ZOOM_ORDER.indexOf(activeZoom);
    if (idx < ZOOM_ORDER.length - 1) {
      setZoom(ZOOM_ORDER[idx + 1], { centerYear: mid });
    } else {
      jumpToYear(mid, true);
    }
    tooltip.hidden = true;
  });

  window.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT") return;
    const step = scroll.clientWidth * (e.shiftKey ? 0.9 : 0.25);
    if (e.key === "ArrowRight") { scroll.scrollLeft += step; e.preventDefault(); }
    else if (e.key === "ArrowLeft") { scroll.scrollLeft -= step; e.preventDefault(); }
    else if (e.key === "+" || e.key === "=") {
      const i = ZOOM_ORDER.indexOf(activeZoom);
      if (i < ZOOM_ORDER.length - 1) setZoom(ZOOM_ORDER[i + 1]);
    } else if (e.key === "-" || e.key === "_") {
      const i = ZOOM_ORDER.indexOf(activeZoom);
      if (i > 0) setZoom(ZOOM_ORDER[i - 1]);
    }
  });

  scroll.addEventListener("mouseover", function (e) {
    const evEl = e.target.closest(".event");
    if (evEl && evEl._event) { showEventTooltip(evEl); return; }
    const clEl = e.target.closest(".event-cluster");
    if (clEl && clEl._cluster) { showClusterTooltip(clEl); return; }
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
    if (e.target.closest(".event") || e.target.closest(".event-cluster")) {
      tooltip.hidden = true;
    }
  });

  renderLegend();
  render();
  requestAnimationFrame(function () {
    jumpToYear(1760, false);
    updateCurrentYear();
  });
})();
