/* Wedding Seating Chart — a single-file static app.
 * State lives in localStorage; export/import moves it as JSON.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "wedding-seating-chart:v1";
  const MIN_CANVAS_W = 2600;      // the grid never shrinks below this
  const MIN_CANVAS_H = 1800;
  const CANVAS_MARGIN = 500;      // breathing room kept past the furthest table
  const EDGE_PAD = 120;           // dragging within this of the edge grows the grid
  const GROW_STEP = 800;          // grid grows in chunks this big
  const SEAT_GAP = 30;            // distance from table edge to seat centre
  const DRAG_THRESHOLD = 4;       // px before a press becomes a drag

  const RECT_DEFAULT = { w: 240, h: 90, seats: 8 };
  const CIRCLE_DEFAULT = { r: 70, seats: 8 };

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

  // ---------------------------------------------------------------- state ---
  let state = defaultState();
  const selection = new Set(); // holds table ids and person ids
  let clipboard = [];          // table snapshots for copy / paste

  function defaultState() {
    return {
      people: [],
      tables: [],
      settings: { snap: true, grid: 20, canvasW: MIN_CANVAS_W, canvasH: MIN_CANVAS_H },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = migrate(JSON.parse(raw));
    } catch (err) {
      console.warn("Could not load saved plan:", err);
    }
  }

  function migrate(s) {
    s = s && typeof s === "object" ? s : {};
    s.people = Array.isArray(s.people) ? s.people : [];
    s.tables = Array.isArray(s.tables) ? s.tables : [];
    s.settings = s.settings && typeof s.settings === "object" ? s.settings : {};
    if (typeof s.settings.snap !== "boolean") s.settings.snap = true;
    if (!Number.isFinite(s.settings.grid)) s.settings.grid = 20;
    s.settings.canvasW = Math.max(MIN_CANVAS_W, s.settings.canvasW || 0);
    s.settings.canvasH = Math.max(MIN_CANVAS_H, s.settings.canvasH || 0);
    for (const p of s.people) {
      p.id = p.id || uid();
      p.name = String(p.name || "").trim() || "Guest";
      p.tableId = p.tableId || null;
      p.seatIndex = Number.isInteger(p.seatIndex) ? p.seatIndex : null;
      p.locked = !!p.locked;
    }
    for (const t of s.tables) {
      t.id = t.id || uid();
      t.kind = t.kind === "circle" ? "circle" : "rect";
      t.name = String(t.name == null ? "" : t.name);
      t.x = Number.isFinite(t.x) ? t.x : 80;
      t.y = Number.isFinite(t.y) ? t.y : 80;
      t.seats = clamp(parseInt(t.seats, 10) || 0, 0, 40);
      t.locked = !!t.locked;
      if (t.kind === "circle") {
        t.r = Number.isFinite(t.r) ? t.r : CIRCLE_DEFAULT.r;
      } else {
        t.w = Number.isFinite(t.w) ? t.w : RECT_DEFAULT.w;
        t.h = Number.isFinite(t.h) ? t.h : RECT_DEFAULT.h;
      }
    }
    return s;
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn("Could not save plan:", err);
      }
    }, 250);
  }

  // ------------------------------------------------------------- geometry ---
  function tableBox(t) {
    return t.kind === "circle"
      ? { w: t.r * 2, h: t.r * 2 }
      : { w: t.w, h: t.h };
  }

  function tableCenter(t) {
    const b = tableBox(t);
    return { x: t.x + b.w / 2, y: t.y + b.h / 2 };
  }

  function applyCanvasSize() {
    canvas.style.width = state.settings.canvasW + "px";
    canvas.style.height = state.settings.canvasH + "px";
  }

  /* Grow the grid to fit the furthest table, and reclaim large empty margins on
   * the top/left by shifting everything back toward the origin (scroll is
   * compensated so the view doesn't jump). Never runs mid-drag. */
  function fitCanvasToContent() {
    if (!state.tables.length) {
      state.settings.canvasW = MIN_CANVAS_W;
      state.settings.canvasH = MIN_CANVAS_H;
      applyCanvasSize();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (const t of state.tables) {
      const b = tableBox(t);
      minX = Math.min(minX, t.x);
      minY = Math.min(minY, t.y);
      maxX = Math.max(maxX, t.x + b.w);
      maxY = Math.max(maxY, t.y + b.h);
    }

    // Only reclaim when the whole layout has drifted well clear of the origin,
    // so an ordinary edit never yanks coordinates around.
    const expanded =
      state.settings.canvasW > MIN_CANVAS_W || state.settings.canvasH > MIN_CANVAS_H;
    const slack = CANVAS_MARGIN + GROW_STEP;
    const shiftX = expanded && minX > slack ? Math.round(minX - CANVAS_MARGIN) : 0;
    const shiftY = expanded && minY > slack ? Math.round(minY - CANVAS_MARGIN) : 0;
    if (shiftX || shiftY) {
      const sx = stage.scrollLeft;
      const sy = stage.scrollTop;
      for (const t of state.tables) { t.x -= shiftX; t.y -= shiftY; }
      maxX -= shiftX;
      maxY -= shiftY;
      state.settings.canvasW = Math.max(MIN_CANVAS_W, Math.round(maxX + CANVAS_MARGIN));
      state.settings.canvasH = Math.max(MIN_CANVAS_H, Math.round(maxY + CANVAS_MARGIN));
      applyCanvasSize();
      stage.scrollLeft = sx - shiftX;
      stage.scrollTop = sy - shiftY;
    } else {
      state.settings.canvasW = Math.max(MIN_CANVAS_W, Math.round(maxX + CANVAS_MARGIN));
      state.settings.canvasH = Math.max(MIN_CANVAS_H, Math.round(maxY + CANVAS_MARGIN));
      applyCanvasSize();
    }
  }

  /** Seat centres in coordinates local to the table group origin (t.x, t.y). */
  function seatOffsets(t) {
    const n = t.seats;
    const pts = [];
    if (n <= 0) return pts;

    if (t.kind === "circle") {
      const c = t.r;
      const ring = t.r + SEAT_GAP;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        pts.push({ x: c + Math.cos(a) * ring, y: c + Math.sin(a) * ring });
      }
      return pts;
    }

    // Rectangular: banquet style — seats spread along the two long edges, so a
    // table stood on its end seats guests down its (now vertical) sides.
    const horizontal = t.w >= t.h;
    const sideA = Math.ceil(n / 2);
    const sideB = n - sideA;
    const place = (count, edge) => {
      for (let i = 0; i < count; i++) {
        const frac = (i + 1) / (count + 1);
        if (horizontal) pts.push({ x: frac * t.w, y: edge });
        else pts.push({ x: edge, y: frac * t.h });
      }
    };
    if (horizontal) {
      place(sideA, -SEAT_GAP);
      place(sideB, t.h + SEAT_GAP);
    } else {
      place(sideA, -SEAT_GAP);
      place(sideB, t.w + SEAT_GAP);
    }
    return pts;
  }

  function seatAbsolute(t) {
    return seatOffsets(t).map((p) => ({ x: t.x + p.x, y: t.y + p.y }));
  }

  // ------------------------------------------------------------ mutations ---
  function normalize() {
    const tableById = new Map(state.tables.map((t) => [t.id, t]));
    const taken = new Set(); // `${tableId}:${seatIndex}`
    for (const p of state.people) {
      if (!p.tableId) { p.seatIndex = null; continue; }
      const t = tableById.get(p.tableId);
      if (!t || p.seatIndex == null || p.seatIndex >= t.seats) {
        p.tableId = null;
        p.seatIndex = null;
        continue;
      }
      const key = `${p.tableId}:${p.seatIndex}`;
      if (taken.has(key)) {
        p.tableId = null;
        p.seatIndex = null;
      } else {
        taken.add(key);
      }
    }
  }

  function snap(v) {
    if (!state.settings.snap) return Math.round(v);
    const g = state.settings.grid;
    return Math.round(v / g) * g;
  }

  function addTable(kind) {
    const base = kind === "circle" ? CIRCLE_DEFAULT : RECT_DEFAULT;
    const b = kind === "circle" ? { w: base.r * 2, h: base.r * 2 } : { w: base.w, h: base.h };
    const cx = stage.scrollLeft + stage.clientWidth / 2;
    const cy = stage.scrollTop + stage.clientHeight / 2;
    const t = {
      id: uid(),
      kind,
      name: kind === "circle" ? "Round table" : "Head table",
      x: Math.max(0, snap(cx - b.w / 2)),
      y: Math.max(0, snap(cy - b.h / 2)),
      seats: base.seats,
      locked: false,
    };
    if (kind === "circle") t.r = base.r;
    else { t.w = base.w; t.h = base.h; }
    state.tables.push(t);
    selection.clear();
    selection.add(t.id);
    render();
  }

  function duplicateTable(t) {
    const copy = JSON.parse(JSON.stringify(t));
    copy.id = uid();
    copy.name = t.name ? t.name + " (copy)" : "";
    copy.x = t.x + 40;
    copy.y = t.y + 40;
    state.tables.push(copy);
    selection.clear();
    selection.add(copy.id);
    render();
  }

  function copyTables(tables) {
    if (!tables.length) return;
    clipboard = tables.map((t) => {
      const snap = JSON.parse(JSON.stringify(t));
      delete snap.id;
      snap.locked = false;
      return snap;
    });
    toast(`Copied ${tables.length} table${tables.length === 1 ? "" : "s"} — paste with ${modKey()}+V`);
  }

  function pasteTables() {
    if (!clipboard.length) return;
    const step = Math.max(state.settings.grid * 2, 40);
    const ids = [];
    for (const snap of clipboard) {
      const t = JSON.parse(JSON.stringify(snap));
      t.id = uid();
      t.locked = false;
      t.x = Math.max(0, t.x + step);
      t.y = Math.max(0, t.y + step);
      state.tables.push(t);
      ids.push(t.id);
    }
    // stack repeated pastes diagonally instead of on top of each other
    clipboard = clipboard.map((s) => ({ ...s, x: s.x + step, y: s.y + step }));
    selection.clear();
    ids.forEach((id) => selection.add(id));
    render();
    toast(`Pasted ${ids.length} table${ids.length === 1 ? "" : "s"}`);
  }

  function modKey() {
    return navigator.platform && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  }

  function deleteTable(id) {
    state.tables = state.tables.filter((t) => t.id !== id);
    for (const p of state.people) {
      if (p.tableId === id) { p.tableId = null; p.seatIndex = null; }
    }
    selection.delete(id);
  }

  function deletePerson(id) {
    state.people = state.people.filter((p) => p.id !== id);
    selection.delete(id);
  }

  function addPeople(names) {
    const existing = new Set(state.people.map((p) => p.name.toLowerCase()));
    let added = 0;
    let skipped = 0;
    for (let raw of names) {
      const name = String(raw || "").replace(/\s+/g, " ").trim();
      if (!name) continue;
      if (existing.has(name.toLowerCase())) { skipped++; continue; }
      existing.add(name.toLowerCase());
      state.people.push({ id: uid(), name, tableId: null, seatIndex: null, locked: false });
      added++;
    }
    return { added, skipped };
  }

  function seatPerson(personId, tableId, seatIndex) {
    const person = state.people.find((p) => p.id === personId);
    const table = state.tables.find((t) => t.id === tableId);
    if (!person || !table || person.locked) return;
    if (seatIndex == null || seatIndex < 0 || seatIndex >= table.seats) return;

    const occupant = state.people.find(
      (p) => p.tableId === tableId && p.seatIndex === seatIndex && p.id !== personId
    );
    const from = { tableId: person.tableId, seatIndex: person.seatIndex };

    if (occupant) {
      if (occupant.locked) return; // can't bump a locked guest
      // swap: occupant takes the dragged guest's previous seat (or is unseated)
      occupant.tableId = from.tableId;
      occupant.seatIndex = from.seatIndex;
    }
    person.tableId = tableId;
    person.seatIndex = seatIndex;
    render();
  }

  function seatPersonFirstFree(personId, tableId) {
    const table = state.tables.find((t) => t.id === tableId);
    if (!table) return;
    const used = new Set(
      state.people.filter((p) => p.tableId === tableId).map((p) => p.seatIndex)
    );
    for (let i = 0; i < table.seats; i++) {
      if (!used.has(i)) { seatPerson(personId, tableId, i); return; }
    }
  }

  function unseatPerson(personId) {
    const person = state.people.find((p) => p.id === personId);
    if (!person || person.locked) return;
    person.tableId = null;
    person.seatIndex = null;
    render();
  }

  function setLocked(locked) {
    for (const id of selection) {
      const t = state.tables.find((x) => x.id === id);
      if (t) { t.locked = locked; continue; }
      const p = state.people.find((x) => x.id === id);
      if (p) p.locked = locked;
    }
    render();
  }

  // -------------------------------------------------------------- helpers ---
  function personsByTable(tableId) {
    const map = new Map();
    for (const p of state.people) {
      if (p.tableId === tableId && p.seatIndex != null) map.set(p.seatIndex, p);
    }
    return map;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  let toastTimer = null;
  function toast(msg) {
    let node = document.getElementById("toast");
    if (!node) {
      node = el("div");
      node.id = "toast";
      document.body.appendChild(node);
    }
    node.textContent = msg;
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("show"), 1800);
  }

  // --------------------------------------------------------------- render ---
  const canvas = document.getElementById("canvas");
  const stage = document.getElementById("stage");
  const guestList = document.getElementById("guest-list");
  const inspectorBody = document.getElementById("inspector-body");

  function render() {
    normalize();
    document.documentElement.style.setProperty("--grid", state.settings.grid + "px");
    fitCanvasToContent();
    renderCanvas();
    renderSidebar();
    renderInspector();
    renderCounts();
    save();
  }

  function renderCounts() {
    const total = state.people.length;
    const seated = state.people.filter((p) => p.tableId).length;
    document.getElementById("guest-counts").textContent =
      `${seated} seated · ${total - seated} to place`;
  }

  function renderCanvas() {
    canvas.querySelectorAll(".table-group").forEach((n) => n.remove());
    for (const t of state.tables) canvas.appendChild(buildTableGroup(t));
  }

  function buildTableGroup(t) {
    const b = tableBox(t);
    const group = el("div", "table-group");
    group.dataset.id = t.id;
    group.style.left = t.x + "px";
    group.style.top = t.y + "px";

    const box = el("div", "table " + t.kind);
    box.style.width = b.w + "px";
    box.style.height = b.h + "px";
    if (selection.has(t.id)) box.classList.add("selected");
    if (t.locked) box.classList.add("locked");

    const seatedCount = state.people.filter((p) => p.tableId === t.id).length;
    const label = el("div", "table-label");
    label.textContent = t.name || "Untitled table";
    label.appendChild(el("span", "table-count", `${seatedCount}/${t.seats} seats`));
    box.appendChild(label);
    if (t.locked) box.appendChild(el("div", "lock-badge", "🔒"));
    group.appendChild(box);

    // table body accepts drops -> first free seat
    box.addEventListener("dragover", (e) => {
      if (dragPersonId == null) return;
      e.preventDefault();
      box.classList.add("drop-target");
    });
    box.addEventListener("dragleave", () => box.classList.remove("drop-target"));
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("drop-target");
      if (dragPersonId != null) seatPersonFirstFree(dragPersonId, t.id);
    });

    const offsets = seatOffsets(t);
    const occupants = personsByTable(t.id);
    offsets.forEach((p, i) => {
      const seat = el("div", "seat");
      seat.style.left = p.x + "px";
      seat.style.top = p.y + "px";
      seat.dataset.table = t.id;
      seat.dataset.seat = i;

      seat.addEventListener("dragover", (e) => {
        if (dragPersonId == null) return;
        e.preventDefault();
        seat.classList.add("drop-target");
      });
      seat.addEventListener("dragleave", () => seat.classList.remove("drop-target"));
      seat.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        seat.classList.remove("drop-target");
        if (dragPersonId != null) seatPerson(dragPersonId, t.id, i);
      });

      const person = occupants.get(i);
      if (person) {
        seat.classList.add("occupied");
        group.appendChild(buildPersonSquare(person, p));
      }
      group.appendChild(seat);
    });

    return group;
  }

  function buildPersonSquare(person, offset) {
    const sq = el("div", "person");
    sq.dataset.id = person.id;
    sq.style.left = offset.x + "px";
    sq.style.top = offset.y + "px";
    sq.title = person.name;
    sq.appendChild(document.createTextNode(person.name));
    if (selection.has(person.id)) sq.classList.add("selected");
    if (person.locked) {
      sq.classList.add("locked");
      sq.appendChild(el("span", "p-lock", "🔒"));
    }
    sq.draggable = !person.locked;

    sq.addEventListener("dragstart", (e) => {
      dragPersonId = person.id;
      sq.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", person.id); } catch (_) {}
      e.dataTransfer.effectAllowed = "move";
    });
    sq.addEventListener("dragend", () => {
      dragPersonId = null;
      sq.classList.remove("dragging");
    });
    // Selection happens on click so it never pre-empts a native drag gesture.
    sq.addEventListener("click", (e) => {
      e.stopPropagation();
      handleSelectClick(person.id, e);
    });
    return sq;
  }

  function renderSidebar() {
    const search = document.getElementById("guest-search").value.trim().toLowerCase();
    const showSeated = document.getElementById("show-seated").checked;
    const tableName = new Map(state.tables.map((t) => [t.id, t.name || "Untitled table"]));

    let people = [...state.people].sort(byName);
    if (!showSeated) people = people.filter((p) => !p.tableId);
    if (search) people = people.filter((p) => p.name.toLowerCase().includes(search));

    guestList.innerHTML = "";
    if (!people.length) {
      const note = el("li", "empty-note",
        state.people.length ? "No guests match." : "No guests yet — add some above.");
      guestList.appendChild(note);
      return;
    }

    for (const p of people) {
      const row = el("li", "guest-row");
      row.dataset.id = p.id;
      if (p.tableId) row.classList.add("seated");
      if (p.locked) row.classList.add("locked");
      if (selection.has(p.id)) row.classList.add("selected");
      row.appendChild(el("span", "dot"));
      row.appendChild(el("span", "name", p.name));
      if (p.locked) row.appendChild(el("span", "mini-lock", "🔒"));
      if (p.tableId) row.appendChild(el("span", "where", tableName.get(p.tableId)));

      row.draggable = !p.locked;
      row.addEventListener("dragstart", (e) => {
        dragPersonId = p.id;
        try { e.dataTransfer.setData("text/plain", p.id); } catch (_) {}
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", () => { dragPersonId = null; });
      row.addEventListener("click", (e) => handleSelectClick(p.id, e));
      guestList.appendChild(row);
    }
  }

  // guest list is a drop target for un-seating
  guestList.addEventListener("dragover", (e) => {
    if (dragPersonId == null) return;
    e.preventDefault();
    guestList.classList.add("drop-active");
  });
  guestList.addEventListener("dragleave", () => guestList.classList.remove("drop-active"));
  guestList.addEventListener("drop", (e) => {
    e.preventDefault();
    guestList.classList.remove("drop-active");
    if (dragPersonId != null) unseatPerson(dragPersonId);
  });

  // ------------------------------------------------------------ inspector ---
  function renderInspector() {
    const ids = [...selection];
    const tables = ids.map((id) => state.tables.find((t) => t.id === id)).filter(Boolean);
    const people = ids.map((id) => state.people.find((p) => p.id === id)).filter(Boolean);
    inspectorBody.innerHTML = "";

    if (ids.length === 0) {
      inspectorBody.appendChild(el("p", "hint",
        "Select a table or guest to edit it. Shift-click or drag a box to select many, then use “Lock selected”."));
      return;
    }

    if (tables.length === 1 && people.length === 0) {
      inspectorBody.appendChild(tableInspector(tables[0]));
      return;
    }
    if (people.length === 1 && tables.length === 0) {
      inspectorBody.appendChild(personInspector(people[0]));
      return;
    }

    // multi-selection
    inspectorBody.appendChild(el("p", "kv",
      `${tables.length} table${tables.length === 1 ? "" : "s"} and ` +
      `${people.length} guest${people.length === 1 ? "" : "s"} selected.`));

    if (tables.length >= 1) inspectorBody.appendChild(tableGroupInspector(tables));

    const actions = el("div", "inspector-actions");
    actions.appendChild(mkButton("🔒 Lock all", () => setLocked(true)));
    actions.appendChild(mkButton("🔓 Unlock all", () => setLocked(false)));
    if (tables.length >= 1) {
      actions.appendChild(mkButton("Copy tables", () => copyTables(tables)));
      actions.appendChild(mkButton("Duplicate tables", () => { copyTables(tables); pasteTables(); }));
    }
    actions.appendChild(mkButton("Delete all", () => {
      if (!confirm(`Delete ${tables.length} table(s) and ${people.length} guest(s)?`)) return;
      tables.forEach((t) => deleteTable(t.id));
      people.forEach((p) => deletePerson(p.id));
      render();
    }, "danger"));
    inspectorBody.appendChild(actions);
  }

  function tableGroupInspector(tables) {
    const wrap = el("div", "group-edit");
    const rects = tables.filter((t) => t.kind === "rect");
    const circles = tables.filter((t) => t.kind === "circle");
    const common = (arr, fn) => {
      const first = fn(arr[0]);
      return arr.every((t) => fn(t) === first) ? first : null;
    };

    wrap.appendChild(el("p", "field-title",
      `Apply to ${tables.length} selected table${tables.length === 1 ? "" : "s"} — a blank field is left unchanged, ` +
      `"mixed" means they currently differ`));

    const seatRow = el("div", "field-row");
    seatRow.appendChild(mkField("Seats", groupNumber(common(tables, (t) => t.seats), 0, 40, (v) => {
      tables.forEach((t) => { t.seats = v; });
      render();
    })));
    wrap.appendChild(seatRow);

    if (rects.length) {
      const row = el("div", "field-row");
      const wLabel = circles.length ? "Width (rect.)" : "Width";
      row.appendChild(mkField(wLabel, groupNumber(common(rects, (t) => t.w), 60, 900, (v) => {
        rects.forEach((t) => { t.w = v; });
        render();
      })));
      row.appendChild(mkField("Height", groupNumber(common(rects, (t) => t.h), 40, 500, (v) => {
        rects.forEach((t) => { t.h = v; });
        render();
      })));
      wrap.appendChild(row);
    }

    if (circles.length) {
      const row = el("div", "field-row");
      const rLabel = rects.length ? "Radius (round)" : "Radius";
      row.appendChild(mkField(rLabel, groupNumber(common(circles, (t) => t.r), 30, 260, (v) => {
        circles.forEach((t) => { t.r = v; });
        render();
      })));
      wrap.appendChild(row);
    }

    const acts = el("div", "inspector-actions");
    acts.appendChild(mkButton(common(tables, (t) => t.locked) === true ? "🔓 Unlock" : "🔒 Lock", () => {
      const anyUnlocked = tables.some((t) => !t.locked);
      tables.forEach((t) => { t.locked = anyUnlocked; });
      render();
    }));
    if (rects.length) {
      acts.appendChild(mkButton("Rotate rectangular", () => {
        rects.forEach((t) => { const w = t.w; t.w = t.h; t.h = w; });
        render();
      }));
    }
    wrap.appendChild(acts);
    return wrap;
  }

  function groupNumber(commonValue, min, max, onCommit) {
    const input = el("input");
    input.type = "number";
    input.min = min;
    input.max = max;
    if (commonValue != null) input.value = commonValue;
    input.placeholder = commonValue == null ? "mixed" : "";
    input.addEventListener("change", () => {
      if (input.value.trim() === "") return;
      onCommit(clamp(parseInt(input.value, 10) || min, min, max));
    });
    return input;
  }

  function tableInspector(t) {
    const wrap = document.createElement("div");

    wrap.appendChild(mkField("Name", (() => {
      const input = el("input");
      input.type = "text";
      input.value = t.name;
      input.placeholder = "e.g. Table 1";
      input.addEventListener("input", () => {
        t.name = input.value;
        // update label live without a full re-render (keeps focus)
        const label = canvas.querySelector(`.table-group[data-id="${t.id}"] .table-label`);
        if (label) label.firstChild.nodeValue = t.name || "Untitled table";
        renderSidebar();
        renderCounts();
        save();
      });
      return input;
    })()));

    const geomRow = el("div", "field-row");
    geomRow.appendChild(mkField("Seats", numberInput(t.seats, 0, 40, (v) => { t.seats = v; render(); })));
    if (t.kind === "circle") {
      geomRow.appendChild(mkField("Radius", numberInput(t.r, 30, 260, (v) => { t.r = v; render(); })));
    } else {
      geomRow.appendChild(mkField("Width", numberInput(t.w, 60, 900, (v) => { t.w = v; render(); })));
      geomRow.appendChild(mkField("Height", numberInput(t.h, 40, 500, (v) => { t.h = v; render(); })));
    }
    wrap.appendChild(geomRow);

    wrap.appendChild(el("p", "kv", (() => {
      const b = tableBox(t);
      return `Shape: ${t.kind === "circle" ? "round" : "rectangular"} · position ${Math.round(t.x)}, ${Math.round(t.y)} · ${Math.round(b.w)}×${Math.round(b.h)}px`;
    })()));

    const lockLabel = el("label", "check");
    const lockCb = el("input");
    lockCb.type = "checkbox";
    lockCb.checked = t.locked;
    lockCb.addEventListener("change", () => { t.locked = lockCb.checked; render(); });
    lockLabel.appendChild(lockCb);
    lockLabel.appendChild(document.createTextNode(" Locked (won't move)"));
    wrap.appendChild(lockLabel);

    const actions = el("div", "inspector-actions");
    if (t.kind === "rect") {
      actions.appendChild(mkButton("Rotate", () => {
        const w = t.w; t.w = t.h; t.h = w; render();
      }));
    }
    actions.appendChild(mkButton("Duplicate", () => duplicateTable(t)));
    actions.appendChild(mkButton("Clear guests", () => {
      state.people.forEach((p) => {
        if (p.tableId === t.id && !p.locked) { p.tableId = null; p.seatIndex = null; }
      });
      render();
    }));
    actions.appendChild(mkButton("Delete table", () => {
      if (!confirm(`Delete "${t.name || "this table"}"?`)) return;
      deleteTable(t.id);
      render();
    }, "danger"));
    wrap.appendChild(actions);
    return wrap;
  }

  function personInspector(p) {
    const wrap = document.createElement("div");
    const table = p.tableId ? state.tables.find((t) => t.id === p.tableId) : null;

    wrap.appendChild(mkField("Name", (() => {
      const input = el("input");
      input.type = "text";
      input.value = p.name;
      input.addEventListener("input", () => {
        p.name = input.value;
        const sq = canvas.querySelector(`.person[data-id="${p.id}"]`);
        if (sq) { sq.firstChild.nodeValue = p.name; sq.title = p.name; }
        renderSidebar();
        save();
      });
      return input;
    })()));

    wrap.appendChild(el("p", "kv",
      table ? `Seated at ${table.name || "Untitled table"}, seat ${p.seatIndex + 1}` : "Not seated yet"));

    const lockLabel = el("label", "check");
    const lockCb = el("input");
    lockCb.type = "checkbox";
    lockCb.checked = p.locked;
    lockCb.addEventListener("change", () => { p.locked = lockCb.checked; render(); });
    lockLabel.appendChild(lockCb);
    lockLabel.appendChild(document.createTextNode(" Locked (won't move)"));
    wrap.appendChild(lockLabel);

    const actions = el("div", "inspector-actions");
    if (table) actions.appendChild(mkButton("Unseat", () => unseatPerson(p.id)));
    actions.appendChild(mkButton("Delete guest", () => {
      if (!confirm(`Remove ${p.name}?`)) return;
      deletePerson(p.id);
      render();
    }, "danger"));
    wrap.appendChild(actions);
    return wrap;
  }

  function mkField(labelText, control) {
    const field = el("div", "field");
    field.appendChild(el("label", null, labelText));
    field.appendChild(control);
    return field;
  }

  function numberInput(value, min, max, onCommit) {
    const input = el("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    const commit = () => {
      const v = clamp(parseInt(input.value, 10) || min, min, max);
      input.value = v;
      onCommit(v);
    };
    input.addEventListener("change", commit);
    return input;
  }

  function mkButton(text, onClick, variant) {
    const b = el("button", "btn small" + (variant === "danger" ? " ghost danger" : ""), text);
    b.addEventListener("click", onClick);
    return b;
  }

  // ------------------------------------------------------- selection model ---
  function handleSelectClick(id, e) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (selection.has(id)) selection.delete(id);
      else selection.add(id);
    } else {
      selection.clear();
      selection.add(id);
    }
    render();
  }

  // --------------------------------------------------- table drag on canvas ---
  let dragPersonId = null; // id of person being dragged via native DnD

  const EDGE_SCROLL_ZONE = 44;   // cursor this close to a stage edge auto-scrolls
  const EDGE_SCROLL_SPEED = 22;  // px per frame at the edge
  let press = null; // { origins, startX, startY, scrollX0, scrollY0, lastX, lastY, moved, shift }
  let autoScrollRAF = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const group = e.target.closest(".table-group");

    if (!group) {
      // empty canvas -> begin marquee (or clear selection)
      if (e.target === canvas) startMarquee(e);
      return;
    }
    if (e.target.closest(".person")) return; // handled elsewhere

    const t = state.tables.find((x) => x.id === group.dataset.id);
    if (!t) return;

    if (!(e.shiftKey || e.metaKey || e.ctrlKey) && !selection.has(t.id)) {
      selection.clear();
      selection.add(t.id);
      render();
    } else if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (selection.has(t.id)) selection.delete(t.id);
      else selection.add(t.id);
      render();
    }

    const origins = new Map();
    for (const id of selection) {
      const st = state.tables.find((x) => x.id === id);
      if (st && !st.locked) origins.set(id, { x: st.x, y: st.y });
    }
    press = {
      id: t.id, origins,
      startX: e.clientX, startY: e.clientY,
      scrollX0: stage.scrollLeft, scrollY0: stage.scrollTop,
      lastX: e.clientX, lastY: e.clientY,
      moved: false, shift: e.shiftKey || e.metaKey || e.ctrlKey,
    };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (marquee) { updateMarquee(e); return; }
    if (!press) return;
    press.lastX = e.clientX;
    press.lastY = e.clientY;
    const moved = Math.hypot(e.clientX - press.startX, e.clientY - press.startY);
    if (!press.moved && moved < DRAG_THRESHOLD) return;
    press.moved = true;
    applyGroupDrag();
    updateAutoScroll();
  });

  /* Keep scrolling the stage while the cursor sits in the edge zone during a
   * drag, so a table can be dragged past the visible area. */
  let autoScrollV = { x: 0, y: 0 };

  function updateAutoScroll() {
    if (!press || !press.moved) return stopAutoScroll();
    const r = stage.getBoundingClientRect();
    autoScrollV = {
      x: press.lastX < r.left + EDGE_SCROLL_ZONE ? -1
        : press.lastX > r.right - EDGE_SCROLL_ZONE ? 1 : 0,
      y: press.lastY < r.top + EDGE_SCROLL_ZONE ? -1
        : press.lastY > r.bottom - EDGE_SCROLL_ZONE ? 1 : 0,
    };
    if (!autoScrollV.x && !autoScrollV.y) return stopAutoScroll();
    if (autoScrollRAF || typeof requestAnimationFrame !== "function") return;
    const tick = () => {
      if (!press || !press.moved || (!autoScrollV.x && !autoScrollV.y)) {
        autoScrollRAF = null;
        return;
      }
      stage.scrollLeft += autoScrollV.x * EDGE_SCROLL_SPEED;
      stage.scrollTop += autoScrollV.y * EDGE_SCROLL_SPEED;
      applyGroupDrag();
      autoScrollRAF = requestAnimationFrame(tick);
    };
    autoScrollRAF = requestAnimationFrame(tick);
  }

  function stopAutoScroll() {
    if (autoScrollRAF && typeof cancelAnimationFrame === "function") cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = null;
    autoScrollV = { x: 0, y: 0 };
  }

  /* Move every dragged table to follow the cursor (in grid coordinates, so it
   * tracks correctly even as the stage scrolls), growing the grid — and, at the
   * top/left, sliding all content plus the scroll position — so a table can be
   * dragged past any boundary without limit. */
  function applyGroupDrag() {
    if (!press) return;
    const dx = press.lastX - press.startX + (stage.scrollLeft - press.scrollX0);
    const dy = press.lastY - press.startY + (stage.scrollTop - press.scrollY0);
    const cw = state.settings.canvasW;
    const ch = state.settings.canvasH;
    const chunk = (over) => Math.ceil(over / GROW_STEP) * GROW_STEP;

    const dragged = [];
    let growL = 0, growT = 0, growR = 0, growB = 0;
    for (const [id, origin] of press.origins) {
      const t = state.tables.find((x) => x.id === id);
      if (!t) continue;
      const b = tableBox(t);
      const nx = snap(origin.x + dx);
      const ny = snap(origin.y + dy);
      dragged.push(t);
      if (nx < EDGE_PAD) growL = Math.max(growL, chunk(EDGE_PAD - nx));
      if (ny < EDGE_PAD) growT = Math.max(growT, chunk(EDGE_PAD - ny));
      if (nx + b.w > cw - EDGE_PAD) growR = Math.max(growR, chunk(nx + b.w - (cw - EDGE_PAD)));
      if (ny + b.h > ch - EDGE_PAD) growB = Math.max(growB, chunk(ny + b.h - (ch - EDGE_PAD)));
    }

    if (growL || growT || growR || growB) {
      state.settings.canvasW += growR + growL;
      state.settings.canvasH += growB + growT;
      if (growL || growT) {
        for (const t of state.tables) { t.x += growL; t.y += growT; }
        for (const o of press.origins.values()) { o.x += growL; o.y += growT; }
        stage.scrollLeft += growL;
        stage.scrollTop += growT;
        press.scrollX0 += growL; // cancel the compensating scroll so dx stays put
        press.scrollY0 += growT;
      }
      applyCanvasSize();
      repositionAllGroups();
    }

    const ddx = press.lastX - press.startX + (stage.scrollLeft - press.scrollX0);
    const ddy = press.lastY - press.startY + (stage.scrollTop - press.scrollY0);
    for (const t of dragged) {
      const o = press.origins.get(t.id);
      t.x = snap(o.x + ddx);
      t.y = snap(o.y + ddy);
      moveGroup(t);
    }
  }

  function moveGroup(t) {
    const g = canvas.querySelector(`.table-group[data-id="${t.id}"]`);
    if (g) { g.style.left = t.x + "px"; g.style.top = t.y + "px"; }
  }

  function repositionAllGroups() {
    for (const t of state.tables) moveGroup(t);
  }

  function endPress(e) {
    if (marquee) { endMarquee(); return; }
    if (!press) return;
    stopAutoScroll();
    if (press.moved) {
      render();
    } else if (!press.shift) {
      selection.clear();
      selection.add(press.id);
      render();
    }
    if (e && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    press = null;
  }
  canvas.addEventListener("pointerup", endPress);
  canvas.addEventListener("pointercancel", endPress);

  // ------------------------------------------------------------- marquee ---
  const marqueeEl = document.getElementById("marquee");
  let marquee = null; // { x0, y0, additive }

  function stageToCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startMarquee(e) {
    const p = stageToCanvas(e);
    marquee = { x0: p.x, y0: p.y, additive: e.shiftKey || e.metaKey || e.ctrlKey };
    if (!marquee.additive) { selection.clear(); render(); }
    marqueeEl.hidden = false;
    marqueeEl.style.left = p.x + "px";
    marqueeEl.style.top = p.y + "px";
    marqueeEl.style.width = "0px";
    marqueeEl.style.height = "0px";
    canvas.setPointerCapture(e.pointerId);
  }

  function updateMarquee(e) {
    const p = stageToCanvas(e);
    const x = Math.min(p.x, marquee.x0);
    const y = Math.min(p.y, marquee.y0);
    const w = Math.abs(p.x - marquee.x0);
    const h = Math.abs(p.y - marquee.y0);
    marqueeEl.style.left = x + "px";
    marqueeEl.style.top = y + "px";
    marqueeEl.style.width = w + "px";
    marqueeEl.style.height = h + "px";
    marquee.rect = { x, y, w, h };
  }

  function endMarquee() {
    const r = marquee.rect;
    if (r && (r.w > 3 || r.h > 3)) {
      const inside = (x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
      for (const t of state.tables) {
        const c = tableCenter(t);
        if (inside(c.x, c.y)) selection.add(t.id);
      }
      for (const t of state.tables) {
        const seats = seatAbsolute(t);
        const occ = personsByTable(t.id);
        for (const [idx, person] of occ) {
          const s = seats[idx];
          if (s && inside(s.x, s.y)) selection.add(person.id);
        }
      }
    }
    marqueeEl.hidden = true;
    marquee = null;
    render();
  }

  // ---------------------------------------------------------------- CSV/paste ---
  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else quoted = false;
        } else cur += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }

  function namesFromCsv(text) {
    const rows = text.split(/\r?\n/).map((l) => l).filter((l) => l.trim().length);
    if (!rows.length) return [];
    const cells = rows.map(splitCsvLine);
    const header = cells[0].map((h) => h.toLowerCase());
    const hasHeader = header.some((h) => /name|first|last|guest/.test(h));

    let start = 0;
    let nameIdx = 0;
    let firstIdx = -1;
    let lastIdx = -1;
    if (hasHeader) {
      start = 1;
      firstIdx = header.findIndex((h) => /^first/.test(h));
      lastIdx = header.findIndex((h) => /^last/.test(h));
      nameIdx = header.findIndex((h) => /(full ?name|^name$|guest)/.test(h));
      if (nameIdx < 0 && firstIdx < 0 && lastIdx < 0) nameIdx = 0;
    }

    const names = [];
    for (let i = start; i < cells.length; i++) {
      const r = cells[i];
      let name = "";
      if (firstIdx >= 0 || lastIdx >= 0) {
        name = [r[firstIdx], r[lastIdx]].filter(Boolean).join(" ").trim();
      }
      if (!name) name = (r[nameIdx] || r[0] || "").trim();
      if (name) names.push(name);
    }
    return names;
  }

  function showImportStatus(msg, warn) {
    const node = document.getElementById("import-status");
    node.textContent = msg;
    node.hidden = false;
    node.classList.toggle("warn", !!warn);
  }

  function reportAdded({ added, skipped }) {
    if (!added && !skipped) { showImportStatus("No names found.", true); return; }
    const parts = [`Added ${added} guest${added === 1 ? "" : "s"}`];
    if (skipped) parts.push(`skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}`);
    showImportStatus(parts.join(", ") + ".", false);
  }

  // ------------------------------------------------------------- toolbar ---
  document.getElementById("add-rect").addEventListener("click", () => addTable("rect"));
  document.getElementById("add-circle").addEventListener("click", () => addTable("circle"));
  document.getElementById("lock-selected").addEventListener("click", () => setLocked(true));
  document.getElementById("unlock-selected").addEventListener("click", () => setLocked(false));

  document.getElementById("snap-toggle").addEventListener("change", (e) => {
    state.settings.snap = e.target.checked;
    save();
  });
  document.getElementById("grid-size").addEventListener("change", (e) => {
    state.settings.grid = parseInt(e.target.value, 10) || 20;
    render();
  });

  document.getElementById("add-pasted").addEventListener("click", () => {
    const ta = document.getElementById("paste-names");
    const names = ta.value.split(/\r?\n/);
    const result = addPeople(names);
    if (result.added) ta.value = "";
    reportAdded(result);
    render();
  });

  document.getElementById("csv-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = addPeople(namesFromCsv(String(reader.result)));
      reportAdded(result);
      render();
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("guest-search").addEventListener("input", renderSidebar);
  document.getElementById("show-seated").addEventListener("change", renderSidebar);

  // export / import / clear
  document.getElementById("export-project").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.getElementById("download-anchor");
    a.href = url;
    a.download = "wedding-seating-chart.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  document.getElementById("import-project").addEventListener("click", () => {
    document.getElementById("project-file").click();
  });
  document.getElementById("project-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!confirm("Replace the current plan with the imported file?")) return;
        state = migrate(parsed);
        selection.clear();
        syncControls();
        render();
        showImportStatus("Plan imported.", false);
      } catch (err) {
        alert("That file could not be read as a seating plan.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  document.getElementById("clear-all").addEventListener("click", () => {
    if (!confirm("Delete every table and guest? This cannot be undone.")) return;
    state = defaultState();
    selection.clear();
    syncControls();
    render();
  });

  // keyboard
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (typing) return;
    if (e.key === "Escape") {
      selection.clear();
      render();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (!selection.size) return;
      e.preventDefault();
      const tables = [...selection].filter((id) => state.tables.some((t) => t.id === id));
      const people = [...selection].filter((id) => state.people.some((p) => p.id === id));
      if (!confirm(`Delete ${tables.length} table(s) and ${people.length} guest(s)?`)) return;
      tables.forEach(deleteTable);
      people.forEach(deletePerson);
      render();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      state.tables.forEach((t) => selection.add(t.id));
      state.people.forEach((p) => { if (p.tableId) selection.add(p.id); });
      render();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      const tbls = [...selection].map((id) => state.tables.find((t) => t.id === id)).filter(Boolean);
      if (tbls.length) { e.preventDefault(); copyTables(tbls); }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      if (clipboard.length) { e.preventDefault(); pasteTables(); }
    }
  });

  function syncControls() {
    document.getElementById("snap-toggle").checked = state.settings.snap;
    document.getElementById("grid-size").value = String(state.settings.grid);
  }

  // ---------------------------------------------------------------- boot ---
  load();
  syncControls();
  render();
})();
