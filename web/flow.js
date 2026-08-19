/**
 * Home energy-flow view — ported/adapted from algo_core/webapp energy flow.
 * Binds real device shadow values + meter power (not simulation inputs).
 */

function flowEsc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function flowNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function flowEdgeClass(base, watts) {
  const w = Math.abs(Number(watts) || 0);
  if (w <= 0) return `flow-edge ${base}`;
  return `flow-edge ${base} on${w >= 1000 ? " strong" : ""}`;
}

/** Hit-path so a wire can be selected, then deleted with Delete. */
function flowPortSelClass(uid, port, idx, busId) {
  const w = typeof liveCanvasSel !== "undefined" ? liveCanvasSel.wire : null;
  if (!w || w.kind !== "port") return "";
  if (String(w.uid) !== String(uid) || w.port !== port || String(w.idx) !== String(idx)) return "";
  if (busId && w.busId && String(w.busId) !== String(busId)) return "";
  return " wire-selected";
}

function flowBusLinkSelClass(busId) {
  const w = typeof liveCanvasSel !== "undefined" ? liveCanvasSel.wire : null;
  if (!w || w.kind !== "buslink") return "";
  if (w.busId !== busId && w.otherId !== busId) return "";
  return " wire-selected";
}

function flowWireSelectHit(d, uid, port, idx, busId) {
  const extra = busId ? `:${flowEsc(busId)}` : "";
  return `<path class="wire-select-hit${flowPortSelClass(uid, port, idx, busId)}" data-select-wire="port:${flowEsc(uid)}:${flowEsc(port)}:${flowEsc(idx)}${extra}" d="${d}"><title>点选连线，按 Delete 删除</title></path>`;
}

/**
 * @brief Plug anchor on a bus node (PV right, Grid bottom, Family top, Bypass left)
 * @param {{x:number,y:number,w:number,h:number}} box
 * @param {string} kind
 * @return {{x:number,y:number}}
 */
function liveBusPlug(box, kind) {
  if (kind === "pv") return { x: box.x + box.w + 1, y: box.y + box.h / 2 };
  if (kind === "grid") return { x: box.x + box.w / 2, y: box.y + box.h + 1 };
  if (kind === "family") return { x: box.x - 1, y: box.y + box.h / 2 };
  return { x: box.x - 1, y: box.y + box.h / 2 };
}

/** Terminal colors: PV yellow · Grid red · Family blue · Bypass gray */
const LIVE_BUS_COLORS = {
  pv: { fill: "#fffbeb", stroke: "#eab308", title: "#854d0e", sub: "#a16207" },
  grid: { fill: "#fef2f2", stroke: "#dc2626", title: "#991b1b", sub: "#b91c1c" },
  family: { fill: "#eff6ff", stroke: "#2563eb", title: "#1e40af", sub: "#1d4ed8" },
  bypass: { fill: "#f1f5f9", stroke: "#64748b", title: "#334155", sub: "#475569" },
};

/**
 * @brief PV combiner box on the top-left of a device card
 * @param {object} g geo unit
 * @param {number} pvN
 * @return {object|null}
 */
function livePvGroupLayout(g, pvN) {
  const n = Math.max(0, Number(pvN) || 0);
  if (!n) return null;
  const dotR = 4;
  const gap = 7;
  const padX = 7;
  const headH = 11;
  const innerW = n * (dotR * 2) + Math.max(0, n - 1) * gap;
  const frameW = Math.max(38, innerW + padX * 2);
  const frameH = headH + 6 + dotR * 2 + 4;
  const frameX = g.x + 6;
  const frameY = g.top - frameH + 4;
  const startX = frameX + (frameW - innerW) / 2 + dotR;
  const dotY = frameY + headH + 4 + dotR;
  const dots = [];
  for (let i = 0; i < n; i++) {
    dots.push({ x: startX + i * (dotR * 2 + gap), y: dotY, idx: i });
  }
  return {
    frameX,
    frameY,
    frameW,
    frameH,
    hubX: frameX + frameW / 2,
    hubY: frameY,
    right: frameX + frameW,
    dots,
  };
}

/**
 * @brief Build device port pads: PV top-left group · Grid top-right · Offgrid bottom-right
 * PV slots sit in a small frame; Grid stays on the remaining top edge.
 * @param {object} g geo unit
 * @param {{pv:number,grid:number,offgrid:number}} counts
 * @param {number} unitW
 * @param {number} unitH
 * @return {Array<object>}
 */
function buildLivePortPads(g, counts, unitW, unitH) {
  const pads = [];
  const pvN = Math.max(0, Number(counts?.pv) || 0);
  const pvGroup = livePvGroupLayout(g, pvN);
  if (pvGroup) {
    for (const d of pvGroup.dots) {
      pads.push({
        kind: "pv",
        idx: d.idx,
        x: d.x,
        y: d.y,
        lab: "",
        labX: d.x,
        labY: d.y + 10,
        labAnchor: "middle",
        group: pvGroup,
      });
    }
  }
  const gN = Math.max(0, Number(counts?.grid) || 0);
  const gridLeftT = pvGroup
    ? Math.min(0.78, Math.max(0.42, (pvGroup.right - g.x + 12) / Math.max(1, unitW)))
    : 0.08;
  const gridRightT = 0.96;
  for (let i = 0; i < gN; i++) {
    const t =
      gN === 1
        ? (gridLeftT + gridRightT) / 2
        : gridLeftT + ((i + 0.5) / gN) * (gridRightT - gridLeftT);
    const x = g.x + unitW * t;
    const y = g.top;
    pads.push({
      kind: "grid",
      idx: i,
      x,
      y,
      lab: gN > 1 ? `G${i + 1}` : "Grid",
      labX: x,
      labY: y - 7,
      labAnchor: "middle",
    });
  }
  const oN = Math.max(0, Number(counts?.offgrid) || 0);
  for (let i = 0; i < oN; i++) {
    const t0 = 0.72;
    const t1 = 0.9;
    const t = oN === 1 ? 0.78 : t0 + (i / Math.max(1, oN - 1)) * (t1 - t0);
    const x = g.x + unitW * t;
    const y = g.bottom;
    pads.push({
      kind: "offgrid",
      idx: i,
      x,
      y,
      lab: oN > 1 ? `离网${i + 1}` : "离网",
      labX: x,
      labY: y + 11,
      labAnchor: "middle",
    });
  }
  return pads;
}

function flowCurveCtrl(x1, y1, x2, y2, bendX = 0, bendY = 0) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const pull = Math.min(0.58, Math.max(0.38, 110 / dist));
  return {
    c1x: x1 + dx * pull + bendX,
    c1y: y1 + dy * (pull * 0.55) + bendY,
    c2x: x2 - dx * pull + bendX,
    c2y: y2 - dy * (pull * 0.55) + bendY,
  };
}

function flowCurve(x1, y1, x2, y2, bendX = 0, bendY = 0) {
  const { c1x, c1y, c2x, c2y } = flowCurveCtrl(x1, y1, x2, y2, bendX, bendY);
  return `M${x1} ${y1} C${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
}

function flowCurveMid(x1, y1, x2, y2, bendX = 0, bendY = 0) {
  const { c1x, c1y, c2x, c2y } = flowCurveCtrl(x1, y1, x2, y2, bendX, bendY);
  return {
    x: 0.125 * x1 + 0.375 * c1x + 0.375 * c2x + 0.125 * x2,
    y: 0.125 * y1 + 0.375 * c1y + 0.375 * c2y + 0.125 * y2,
  };
}

/** Keep arrowheads outside terminal dots / port pads at both ends. */
const FLOW_WIRE_CLEAR = { bus: 17, pad: 13, hub: 12, bms: 12 };

/**
 * @brief Cubic wire whose endpoints stop short of hubs so markers stay visible
 * @return {{d:string,mid:{x:number,y:number}}}
 */
function flowClearedCurve(x1, y1, x2, y2, bendX, bendY, r1, r2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const cap = dist * 0.32;
  const a = Math.min(Math.max(0, Number(r1) || 0), cap);
  const b = Math.min(Math.max(0, Number(r2) || 0), cap);
  const ux = dx / dist;
  const uy = dy / dist;
  const sx = x1 + ux * a;
  const sy = y1 + uy * a;
  const ex = x2 - ux * b;
  const ey = y2 - uy * b;
  return {
    d: flowCurve(sx, sy, ex, ey, bendX, bendY),
    mid: flowCurveMid(sx, sy, ex, ey, bendX, bendY),
  };
}

function flowBmsSvg(bx, by, bw, bh, mode, wattsLabel, limLabel, capLabel = "") {
  const padX = 8;
  const padY = 6;
  const bodyW = bw - 20;
  const bodyH = 16;
  const bodyX = bx + padX;
  const bodyY = by + padY;
  const capW = 5;
  const capH = 9;
  const cells = 4;
  const gap = 2;
  const innerPad = 2;
  const cellW = (bodyW - innerPad * 2 - gap * (cells - 1)) / cells;
  const cellH = bodyH - innerPad * 2;
  const stroke = mode === "chg" ? "#16a34a" : mode === "dchg" ? "#e11d48" : "#94a3b8";
  const fillBg = mode === "chg" ? "#f0fdf4" : mode === "dchg" ? "#fff1f2" : "#f8fafc";
  const capFill = mode === "chg" ? "#166534" : mode === "dchg" ? "#9f1239" : "#334155";
  let cellRects = "";
  for (let i = 0; i < cells; i++) {
    const cx = bodyX + innerPad + i * (cellW + gap);
    const cy = bodyY + innerPad;
    const cls = mode === "idle" ? "bat-cell idle" : `bat-cell ${mode} c${i}`;
    cellRects += `<rect class="${cls}" x="${cx}" y="${cy}" width="${cellW}" height="${cellH}" rx="1.5"/>`;
  }
  // 功率已在连线旁展示，卡片内去掉「充 xxxW」；突出电池容量
  void wattsLabel;
  return `
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" fill="${fillBg}" stroke="${stroke}" stroke-width="${mode === "idle" ? 1 : 2}"/>
    <rect x="${bodyX}" y="${bodyY}" width="${bodyW}" height="${bodyH}" rx="3" fill="#fff" stroke="${stroke}" stroke-width="1.4"/>
    <rect x="${bodyX + bodyW}" y="${bodyY + (bodyH - capH) / 2}" width="${capW}" height="${capH}" rx="1.5" fill="${stroke}"/>
    ${cellRects}
    <text x="${bx + bw / 2}" y="${by + 40}" text-anchor="middle" font-size="13" font-weight="800" fill="${capFill}">${flowEsc(capLabel || "—")}</text>
    <text x="${bx + bw / 2}" y="${by + 54}" text-anchor="middle" font-size="8" fill="#94a3b8">${flowEsc(limLabel)}</text>`;
}

/** Build per-device geometry + power from live shadow values. */
function buildDeviceFlowGeo(home, device, i, layout) {
  const v = device.values || {};
  const pv = typeof _ownerPvW === "function" ? _ownerPvW(device) : Math.max(0, flowNum(v.pv_power_total));
  const grid = flowNum(v.grid_port_power ?? v.inverter_output_power);
  const bat = flowNum(v.battery_power);
  const offgrid = typeof _ownerBypassW === "function" ? _ownerBypassW(device) : flowNum(v.offgrid1_export_power ?? v.battery_charging_power_grid);
  const soc = flowNum(v.current_soc ?? v.main_soc);
  const backup = flowNum(v.backup_soc);
  const batCapRaw = v.battery_capacity;
  const batCap =
    batCapRaw == null || batCapRaw === "" || Number.isNaN(Number(batCapRaw))
      ? null
      : Number(batCapRaw);
  const load = offgrid > 0 ? offgrid : 0;
  const micro = offgrid < 0 ? -offgrid : 0;
  // grid_port_power: 正数=馈网(放)，负数=买电(充)
  const acDchg = grid > 0 ? grid : 0;
  const acChg = grid < 0 ? -grid : 0;
  // battery_power: 正数=放电，负数=充电
  const absorb = bat < 0 ? -bat : 0;
  const bmsDchg = bat > 0 ? bat : 0;
  const x = layout.clusterX + layout.pad + i * (layout.unitW + layout.unitGap);
  const model = typeof modelMeta === "function" ? modelMeta(device) : { badge: device.model || "" };
  const unitH = Number(layout.unitHByUid?.[device.uid] || layout.unitH) || 0;
  return {
    device,
    uid: device.uid,
    name: device.name || device.deviceId,
    model,
    i,
    x,
    ux: x + layout.unitW / 2,
    left: x,
    right: x + layout.unitW,
    top: layout.unitY,
    bottom: layout.unitY + unitH,
    unitH,
    pv,
    grid,
    bat,
    batCap,
    soc,
    backup,
    load,
    micro,
    absorb,
    bmsDchg,
    acChg,
    acDchg,
    exportLimit: flowNum(v.regulation_grid_export_p_limit),
    outputLimit: flowNum(v.output_power_limit),
    inputLimit: flowNum(v.inverter_input_power_limit),
  };
}

/**
 * Estimate device card height so ① realtime rows are fully visible (no clip/scroll).
 * foreignObject height is fixed in SVG, so we size it from field counts + wrap labels.
 * @param {object} [device]
 * @returns {number}
 */
function estimateUnitCardHeight(device) {
  const liveCount =
    (typeof DP_DISPLAY !== "undefined" ? DP_DISPLAY.length : 5) +
    (typeof HOME_FAMILY_FIELDS !== "undefined" ? HOME_FAMILY_FIELDS.length : 5) +
    2;
  const liveRows = Math.ceil(liveCount / 2);
  let wrapExtra = 0;
  if (typeof HOME_FAMILY_FIELDS !== "undefined") {
    for (const f of HOME_FAMILY_FIELDS) {
      const len = String(f.label || "").length;
      if (len > 18) wrapExtra += 24;
      else if (len > 10) wrapExtra += 12;
    }
  }
  const editCount = 1 + (typeof DP_EDITABLE !== "undefined" ? DP_EDITABLE.length : 4);
  const editRows = Math.ceil(editCount / 2);
  const workShown = String(
    (device?.drafts?.work_mode || "").trim() || device?.values?.work_mode || ""
  );
  const scheduleExtra =
    workShown === "manual" || workShown === "time_of_use" ? 30 : 0;
  const headerH = 44;
  const l1H = 24 + liveRows * 20 + wrapExtra;
  const l2H = 24 + editRows * 44 + scheduleExtra;
  const l3H = 56;
  const l4H = 66;
  return Math.max(160, headerH + l1H + l2H + l3H + l4H);
}

/**
 * @brief Measure natural .u3 card size (① live values must not ellipsis)
 * Width comes from header/①/②/③ nowrap content; height then includes wrapping ④.
 * @param {object[]} geos
 * @return {Record<string, {w:number,h:number}>}
 */
function measureUnitCardSizes(geos) {
  const UNIT_W_MIN = 168;
  const sizes = {};
  if (!geos.length) return sizes;
  if (typeof document === "undefined" || !document.body) {
    for (const g of geos) {
      sizes[g.uid] = { w: UNIT_W_MIN, h: estimateUnitCardHeight(g.device) };
    }
    return sizes;
  }
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;width:max-content;min-width:168px;";
  document.body.appendChild(wrap);
  try {
    for (const g of geos) {
      wrap.innerHTML = unitCardHtml(g);
      const el = wrap.querySelector(".u3");
      if (!el) {
        sizes[g.uid] = { w: UNIT_W_MIN, h: estimateUnitCardHeight(g.device) };
        continue;
      }
      el.style.width = "max-content";
      el.style.minWidth = `${UNIT_W_MIN}px`;
      el.style.height = "auto";
      const l4 = el.querySelector(".layer.l4");
      if (l4) l4.style.display = "none";
      const w = Math.max(
        UNIT_W_MIN,
        Math.ceil(Math.max(el.scrollWidth, el.getBoundingClientRect().width)) + 2
      );
      if (l4) l4.style.display = "";
      el.style.width = `${w}px`;
      el.style.maxWidth = `${w}px`;
      const h = Math.max(
        160,
        Math.ceil(Math.max(el.scrollHeight, el.getBoundingClientRect().height)) + 2
      );
      sizes[g.uid] = { w, h };
    }
  } finally {
    wrap.remove();
  }
  return sizes;
}

/**
 * @brief Write measured card box onto a geo unit
 * @param {object} g
 * @param {number} x
 * @param {number} unitW
 * @param {number} unitH
 * @param {number} unitY
 * @return {void}
 */
function applyLiveUnitBox(g, x, unitW, unitH, unitY) {
  g.unitW = unitW;
  g.unitH = unitH;
  g.x = x;
  g.ux = x + unitW / 2;
  g.left = x;
  g.right = x + unitW;
  g.top = unitY;
  g.bottom = unitY + unitH;
}

const LIVE_CARD_BOX_MIN = { w: 168, h: 160 };
const LIVE_CARD_BOX_MAX = { w: 560, h: 920 };

/**
 * @brief Clamp shared device-card size
 * @param {number} w
 * @param {number} h
 * @return {{w:number,h:number}}
 */
function clampLiveCardBox(w, h) {
  const nw = Math.round(
    Math.min(LIVE_CARD_BOX_MAX.w, Math.max(LIVE_CARD_BOX_MIN.w, Number(w) || LIVE_CARD_BOX_MIN.w))
  );
  const nh = Math.round(
    Math.min(LIVE_CARD_BOX_MAX.h, Math.max(LIVE_CARD_BOX_MIN.h, Number(h) || LIVE_CARD_BOX_MIN.h))
  );
  return { w: nw, h: nh };
}

/**
 * @brief Parse persisted shared card box
 * @param {object} raw
 * @return {{w:number,h:number}|null}
 */
function parseLiveCardBox(raw) {
  if (!raw || typeof raw !== "object") return null;
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return clampLiveCardBox(w, h);
}

/**
 * @brief Shared card size: saved override, else max of measured cards
 * @param {object} home
 * @param {Record<string,{w:number,h:number}>} cardSizes
 * @return {{w:number,h:number}}
 */
function resolveLiveCardBox(home, cardSizes) {
  const saved = parseLiveCardBox(home?.cardBox);
  if (saved) return saved;
  const vals = Object.values(cardSizes || {});
  if (!vals.length) return { ...LIVE_CARD_BOX_MIN };
  return clampLiveCardBox(
    Math.max(...vals.map((s) => Number(s.w) || LIVE_CARD_BOX_MIN.w)),
    Math.max(...vals.map((s) => Number(s.h) || LIVE_CARD_BOX_MIN.h))
  );
}

/** Field exists in device pid-schema (or schema not loaded yet → treat as available). */
function flowFieldInSchema(device, fieldOrCode) {
  if (typeof resolveSchemaEntry !== "function") return true;
  const schema = device.schema || {};
  if (!Object.keys(schema).length) return true; // 未拉 schema 前先正常展示
  const field =
    typeof fieldOrCode === "string"
      ? { code: fieldOrCode, aliases: [fieldOrCode] }
      : fieldOrCode;
  return !!resolveSchemaEntry(schema, field);
}

function unitCardHtml(g) {
  const d = g.device;
  const draftsN = typeof countDrafts === "function" ? countDrafts(d) : 0;
  const loading = d.loading ? "loading" : "";
  const schemaReady = Object.keys(d.schema || {}).length > 0;

  const kv = (lab, val, unit = "W", opts = {}) => {
    const missing = !!opts.missing;
    const cls = missing ? "kv missing" : "kv";
    const shown = missing ? "—" : val == null || val === "" ? "—" : `${val}${unit}`;
    const tip = missing ? `当前 PID 未定义此 DP · ${lab}` : `${lab}：${shown}`;
    return `<div class="${cls}" title="${flowEsc(tip)}"><span class="k">${flowEsc(lab)}</span><span class="v">${
      missing ? "—" : val == null || val === "" ? "—" : `${flowEsc(val)}${unit}`
    }</span></div>`;
  };

  const draftInput = (field, lab, unit, maxHint) => {
    const code = field.code;
    const missing = schemaReady && !flowFieldInSchema(d, field);
    // pid 未定义：删除线灰色展示，不可编辑（不计入可下发）
    if (missing) {
      return `<label class="fld missing" title="当前 PID 未定义此 DP（${flowEsc(code)}）· ${flowEsc(lab)}">
        <span title="${flowEsc(lab)}">${flowEsc(lab)}</span>
        <input type="text" value="—" disabled />
        <span class="u">${flowEsc(unit)}</span>
      </label>`;
    }
    const cur = d.values?.[code];
    const draft = (d.drafts?.[code] || "").trim();
    const echo = cur != null && cur !== "" && !Number.isNaN(Number(cur)) ? String(cur) : "";
    const shown = draft !== "" ? draft : echo;
    const dirty = draft !== "" && draft !== echo ? "dirty" : "";
    const maxAttr = maxHint != null ? ` max="${maxHint}" data-max="${maxHint}"` : "";
    return `<label class="fld" title="${flowEsc(lab)}">
      <span title="${flowEsc(lab)}">${flowEsc(lab)}</span>
      <input type="number" inputmode="numeric" data-device-uid="${flowEsc(d.uid)}" data-field="${flowEsc(code)}"
        data-echo="${flowEsc(echo)}" value="${flowEsc(shown)}" placeholder="${flowEsc(echo || "—")}"
        min="0"${maxAttr} class="${dirty}" />
      <span class="u">${flowEsc(unit)}</span>
    </label>`;
  };

  const maxExport = g.model?.maxExport;
  const v = d.values || {};
  const displayFields =
    typeof DP_DISPLAY !== "undefined"
      ? DP_DISPLAY
      : [
          { code: "pv_power_total", label: "PV", unit: "W", aliases: ["pv_power_total"] },
          {
            code: "grid_port_power",
            label: "Grid",
            unit: "W",
            aliases: ["grid_port_power", "inverter_output_power"],
          },
          { code: "battery_power", label: "电池", unit: "W", aliases: ["battery_power"] },
          { code: "current_soc", label: "SOC", unit: "%", aliases: ["current_soc", "main_soc"] },
          { code: "backup_soc", label: "备用", unit: "%", aliases: ["backup_soc", "backup_reserve"] },
          {
            code: "battery_charging_power_grid",
            label: "离网口",
            unit: "W",
            aliases: ["offgrid1_export_power", "battery_charging_power_grid"],
          },
        ];
  const editableFields =
    typeof DP_EDITABLE !== "undefined"
      ? DP_EDITABLE
      : [
          { code: "backup_soc", label: "备用 SOC", unit: "%" },
          { code: "regulation_grid_export_p_limit", label: "法规输出上限(取小)", unit: "W", useModelMax: true },
          { code: "output_power_limit", label: "AC输出限制", unit: "W" },
          { code: "inverter_input_power_limit", label: "AC输入限制", unit: "W" },
        ];

  const workModeOpts =
    typeof HOME_FAMILY_FIELDS !== "undefined"
      ? HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode")?.options || []
      : [];
  const workCur = v.work_mode;
  const workDraft = (d.drafts?.work_mode || "").trim();
  const workShown = workDraft !== "" ? workDraft : workCur == null ? "" : String(workCur);
  const workDirty = workDraft !== "" && String(workDraft) !== String(workCur ?? "");
  const workMissing = schemaReady && workModeOpts.length && !flowFieldInSchema(d, { code: "work_mode", aliases: ["work_mode"] });
  const workModeHtml = workMissing
    ? `<label class="fld missing" title="当前 PID 未定义 work_mode"><span title="工作模式">工作模式</span><input type="text" value="—" disabled /><span class="u"></span></label>`
    : `<label class="fld" title="工作模式">
        <span title="工作模式">工作模式</span>
        <select data-device-uid="${flowEsc(d.uid)}" data-field="work_mode" data-echo="${flowEsc(workCur == null ? "" : String(workCur))}" class="${workDirty ? "dirty" : ""}">
          <option value="">—</option>
          ${workModeOpts
            .map(
              (o) =>
                `<option value="${flowEsc(o.value)}" ${String(workShown) === String(o.value) ? "selected" : ""}>${flowEsc(o.label)}</option>`
            )
            .join("")}
        </select>
        <span class="u"></span>
      </label>
      ${
        String(workShown) === "manual"
          ? `<button type="button" class="btn btn-sm btn-ghost" data-act="manual-schedule" style="grid-column:1/-1">配置手动时段（8段）</button>`
          : String(workShown) === "time_of_use"
            ? `<button type="button" class="btn btn-sm btn-ghost" data-act="tou-schedule" style="grid-column:1/-1">配置分时时段（8段）</button>`
            : ""
      }`;

  // ①：固定顺序展示；PID 未定义 → 删除线灰色占位（不隐藏，保证各卡对齐）
  const liveHtml = displayFields
    .map((f) => {
      const missing = schemaReady && !flowFieldInSchema(d, f);
      let val = v[f.code];
      if (f.code === "current_soc" && (val == null || val === "")) val = v.main_soc;
      if (f.code === "backup_soc" && (val == null || val === "")) val = v.backup_reserve;
      if (f.code === "grid_port_power" && (val == null || val === "")) {
        val = v.inverter_output_power;
      }
      if (f.code === "battery_charging_power_grid" && (val == null || val === "")) {
        val = v.offgrid1_export_power;
      }
      if (!missing) {
        if (f.code === "pv_power_total") val = g.pv;
        if (f.code === "grid_port_power" || f.code === "grid_power") val = g.grid;
        if (f.code === "battery_power") val = g.bat;
        if (f.code === "current_soc") val = g.soc;
        if (f.code === "backup_soc") val = g.backup;
        if (f.code === "battery_charging_power_grid") val = g.load || g.micro || val;
      } else {
        val = null;
      }
      const short =
        f.label === "发电功率" ? "PV" : f.label === "并网口" ? "Grid" : f.label;
      return kv(short, val, f.unit || "W", { missing });
    })
    .join("");

  // 家庭侧：物模型始终展示；DP 类若不在 schema → 删除线灰色
  const workModeLabel = (() => {
    const raw = v.work_mode;
    if (raw == null || raw === "") return null;
    const field =
      typeof HOME_FAMILY_FIELDS !== "undefined"
        ? HOME_FAMILY_FIELDS.find((f) => f.code === "work_mode")
        : null;
    const hit = (field?.options || []).find((o) => String(o.value) === String(raw));
    return hit ? hit.label : String(raw);
  })();
  const famLiveHtml = (typeof HOME_FAMILY_FIELDS !== "undefined" ? HOME_FAMILY_FIELDS : [])
    .map((f) => {
      const isDp = f.via === "dp";
      const missing = isDp && schemaReady && !flowFieldInSchema(d, f);
      if (f.code === "work_mode") {
        return kv("工作模式", missing ? null : workModeLabel, "", { missing });
      }
      const shortLab = f.label
        .replace(/[（(][^）)]*[）)]/g, "")
        .replace(/(限制|功率)/g, "")
        .trim() || f.label;
      return kv(shortLab, v[f.code], f.unit || "W", { missing });
    })
    .join("");

  // device_cluster_node_id：有值进对应集群；无值单机。角色仍用 device_cluster_role 展示。
  const clusterRaw = v.device_cluster_role;
  const clusterTxt =
    typeof clusterRoleLabel === "function" ? clusterRoleLabel(clusterRaw) : null;
  const nodeId =
    typeof deviceClusterNodeId === "function" ? deviceClusterNodeId(d) : v.device_cluster_node_id || null;
  const inClusterBox =
    typeof isClusterBoxMember === "function" ? isClusterBoxMember(d) : nodeId != null && nodeId !== "";
  const clusterHtml = kv(
    "集群角色",
    clusterTxt == null ? null : `${clusterTxt}${clusterRaw != null && clusterRaw !== "" ? ` (${clusterRaw})` : ""}`,
    ""
  );
  const nodeIdHtml = kv("集群身份", nodeId == null ? null : nodeId, "");

  // grid 口充放策略：理论状态放在 ④ 工况；上报/决策来自各机本机 DP98
  const owner =
    typeof classifyOwnerWorkModel === "function" ? classifyOwnerWorkModel(d) : null;
  const actual = d.ownerActual || null;

  // ②：可下发区列出全部；PID 无此 dpcode → 删除线灰色、不可编辑
  const editHtml = editableFields
    .map((f) => draftInput(f, f.label, f.unit || "W", f.useModelMax ? maxExport : null))
    .join("");

  const roleNum = Number(clusterRaw);
  const roleKind =
    !inClusterBox || nodeId == null || nodeId === ""
      ? "solo"
      : roleNum === 0
        ? "master"
        : roleNum === 1
          ? "slave"
          : roleNum === 2
            ? "electing"
            : "solo";
  const roleBadge = inClusterBox
    ? `<span class="u3-role role-${roleKind}" title="node=${flowEsc(nodeId)} · role=${flowEsc(clusterRaw)}">${flowEsc(clusterTxt || "集群")}</span>`
    : clusterTxt
      ? `<span class="u3-role role-${roleKind}" title="device_cluster_role=${flowEsc(clusterRaw)}">${flowEsc(clusterTxt)}</span>`
      : `<span class="u3-role role-solo" title="无 device_cluster_node_id">单机</span>`;

  const theorBadge = owner
    ? `<button type="button" class="owner-chip m${owner.model}" data-act="owner-strat"
        title="点击查看判定公式 · ${flowEsc(owner.label)} 充${owner.chgCapW}/放${owner.dchgCapW}W">${flowEsc(owner.label)}</button>
       <span class="owner-caps" title="充${owner.chgCapW}/放${owner.dchgCapW}W">充${owner.chgCapW}/放${owner.dchgCapW}W</span>`
    : `<span class="hint">—</span>`;

  const orderTxt =
    actual == null
      ? ""
      : Number(actual.order) === 1
        ? "充"
        : Number(actual.order) === 2
          ? "放"
          : "待机";
  const numerTxt = actual
    ? Number(actual.numer) === 10
      ? "0x0A"
      : String(actual.numer ?? "—")
    : "";
  // 上报 = 报文头 + 从机上报寄存器；决策 = 主机下发令功率/方向
  const reportParts = [];
  if (actual && actual.fnlFlag != null) {
    reportParts.push(`防逆流${Number(actual.fnlFlag) ? "开" : "关"}`);
  }
  if (actual && actual.socTest != null) reportParts.push(`簇SOC${Number(actual.socTest)}`);
  if (actual && actual.gridPowerW != null) reportParts.push(`电网${Number(actual.gridPowerW)}`);
  if (actual) {
    reportParts.push(numerTxt, `充${actual.chgCapW}`, `放${actual.dchgCapW}`, `PV${actual.pvW}`);
  }
  const reportTxt = reportParts.length ? reportParts.join("/") : "";
  const decideTxt = actual ? `令${actual.cmdPowerW}` : "";
  const reportTip = actual
    ? `DP98 上报 · ${actual.label} · ${reportTxt}`
    : "尚未解析到 DP98 / command_receive";
  const decideTip = actual
    ? `DP98 主机决策 · ${orderTxt} · 指令${actual.cmdPowerW}W`
    : "尚未解析到 DP98 / command_receive";
  const decideChipClass =
    actual == null
      ? ""
      : Number(actual.order) === 1
        ? "m1"
        : Number(actual.order) === 2
          ? "m2"
          : "m6";
  const reportBadge = actual
    ? `<span class="owner-chip m${actual.model}" title="${flowEsc(reportTip)}">${flowEsc(actual.label)}</span>
       <span class="owner-caps" title="${flowEsc(reportTip)}">${flowEsc(reportTxt)}</span>`
    : `<span class="hint">—</span>`;
  const decideBadge = actual
    ? `<span class="owner-chip ${decideChipClass}" title="${flowEsc(decideTip)}">${flowEsc(orderTxt)}</span>
       <span class="owner-caps" title="${flowEsc(decideTip)}">${flowEsc(decideTxt)}</span>`
    : `<span class="hint">—</span>`;

  return `<div xmlns="http://www.w3.org/1999/xhtml" class="u3 u3-fit ${loading}" data-uid="${flowEsc(d.uid)}" data-device-uid="${flowEsc(d.uid)}">
    <div class="u3-name">
      <div class="u3-title">
        <span class="u3-devname" title="${flowEsc(g.name)}">${flowEsc(g.name)}</span>
        <button type="button" class="u3-devid" data-act="copy-id" title="点击复制设备 ID：${flowEsc(d.deviceId)}">${flowEsc(d.deviceId)}</button>
      </div>
      <span class="u3-actions">
        <button type="button" class="u3-btn" data-act="refresh" title="读取">↻</button>
        ${roleBadge}
        <span style="font-size:10px;color:#94a3b8">${flowEsc(g.model.badge || "")}</span>
      </span>
    </div>
    <div class="layer l1">
      <div class="lh"><span>① 实时上报</span><span>影子</span></div>
      <div class="grid2">
        ${liveHtml}
        ${famLiveHtml}
        ${clusterHtml}
        ${nodeIdHtml}
      </div>
    </div>
    <div class="layer l2">
      <div class="lh"><span>② 可下发</span><span>草稿</span></div>
      <div class="grid2">
        ${workModeHtml}
        ${editHtml}
      </div>
    </div>
    <div class="layer l3">
      <div class="lh"><span>③ 操作</span><span>${
        typeof deviceReadAgoLabel === "function"
          ? deviceReadAgoLabel(d)
          : d.lastReadAt
            ? "已读"
            : "未读"
      }</span></div>
      <div class="u3-foot">
        <button type="button" class="u3-eye" data-act="more-points" title="展示更多点位">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
        </button>
        <button type="button" class="u3-link" data-act="reg-query" title="物模型明文值，或查 DP 原始报文中的寄存器">寄存器查询</button>
        <button type="button" class="u3-link" data-act="edit">编辑</button>
        <button type="button" class="u3-link danger" data-act="remove">移除</button>
        <button type="button" class="u3-issue ${draftsN ? "on" : ""}" data-act="issue" ${draftsN ? "" : "disabled"}>
          ${draftsN ? `下发 (${draftsN})` : "下发"}
        </button>
      </div>
    </div>
    <div class="layer l4">
      <div class="lh"><span>④ 工况</span><span>理论 / 上报 / 决策</span></div>
      <div class="owner-status-rows">
        <div class="owner-status-row">
          <span class="owner-status-lab">理论状态</span>
          <span class="owner-status-val">${theorBadge}</span>
        </div>
        <div class="owner-status-row">
          <span class="owner-status-lab">上报状态</span>
          <span class="owner-status-val">${reportBadge}</span>
        </div>
        <div class="owner-status-row">
          <span class="owner-status-lab">主机决策</span>
          <span class="owner-status-val">${decideBadge}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function renderFamilyRail(home) {
  const meters = home.meters || [];
  const devices =
    typeof homeLiveDevices === "function" ? homeLiveDevices(home) : home.devices || [];
  const meter = meters[0];
  const gridPow =
    typeof resolveGridNodePower === "function"
      ? resolveGridNodePower(home)
      : {
          watts:
            meter?.lastValue == null || Number.isNaN(Number(meter.lastValue))
              ? null
              : Number(meter.lastValue),
          source: "meter",
          label: meter?.name || meter?.deviceId || "未添加电表",
        };
  const meterW =
    gridPow.watts == null || Number.isNaN(Number(gridPow.watts))
      ? "—"
      : `${gridPow.watts}W`;
  const meterName =
    gridPow.source === "lan"
      ? gridPow.label
      : meter?.name || meter?.deviceId || "未添加电表";
  const meterAgo =
    typeof meterReadAgoLabel === "function" && meter
      ? meterReadAgoLabel(meter)
      : meter?.lastReadAt
        ? "已读"
        : gridPow.source === "lan"
          ? "来自选中一体机 DP26"
          : "未读";
  const lanSelId = String(
    home.lanMeterDeviceId ||
      (typeof resolveLanMeterDevice === "function"
        ? resolveLanMeterDevice(home)?.deviceId
        : "") ||
      ""
  ).trim();
  const lanSelect =
    !meters.length && devices.length
      ? `<label class="fb-lan-src">电网功率来源一体机
          <select data-act="lan-meter-device">
            ${devices
              .map(
                (d) =>
                  `<option value="${flowEsc(d.deviceId)}" ${
                    lanSelId === String(d.deviceId) ? "selected" : ""
                  }>${flowEsc(d.name || d.deviceId)}</option>`
              )
              .join("")}
          </select>
          <span class="fb-hint">无电表时取 DP26 局域网电表配对功率</span>
        </label>`
      : "";

  const meterCards = meters.length
    ? meters
        .map(
          (m) => `<div class="rail-meter" data-meter-uid="${flowEsc(m.uid)}">
      <div class="rm-title">
        <input class="rm-name" data-act="meter-name" value="${flowEsc(m.name || "")}" placeholder="电表名称" />
        <span class="badge-meter">${m.isThirdParty ? "三方电表" : "电表"}</span>
      </div>
      <div class="rm-sub">${flowEsc(m.deviceId)}</div>
      <div class="rm-power ${m.lastValue != null && m.lastValue < 0 ? "neg" : ""}">${
            m.lastValue == null ? "—" : `${m.lastValue}W`
          }</div>
      <div class="rm-ago" data-meter-ago-uid="${flowEsc(m.uid)}">${flowEsc(
            typeof meterReadAgoLabel === "function" ? meterReadAgoLabel(m) : ""
          )}</div>
      <div class="rm-ops">
        <button type="button" class="btn btn-sm btn-ghost" data-act="meter-read">读取</button>
        <button type="button" class="btn-link" data-act="meter-edit">编辑</button>
        <button type="button" class="btn-link danger" data-act="meter-remove">移除</button>
      </div>
    </div>`
        )
        .join("")
    : `<div class="rail-empty">尚未添加电表${
        devices.length ? " · 电网功率可用一体机 DP26" : ""
      }</div>`;

  const devList = devices
    .map(
      (d) => `<button type="button" class="rail-dev${
        !meters.length && lanSelId === String(d.deviceId) ? " active" : ""
      }" data-device-uid="${flowEsc(d.uid)}" title="${
        !meters.length ? "选为电网功率来源（DP26）" : "点击复制设备 ID"
      }">
      <span class="rd-name">${flowEsc(d.name || d.deviceId)}</span>
      <span class="rd-meta">${flowEsc(d.deviceId)}</span>
    </button>`
    )
    .join("");

  const values = home.familyValues || {};
  const drafts = home.familyDrafts || {};
  const famDraftN = typeof countFamilyDrafts === "function" ? countFamilyDrafts(home) : 0;

  const famFields =
    typeof HOME_FAMILY_FIELDS !== "undefined"
      ? HOME_FAMILY_FIELDS.map((f) => {
          const echo = values[f.code];
          const echoStr = echo == null || echo === "" ? "" : String(echo);
          const draft = (drafts[f.code] || "").trim();
          const shown = draft !== "" ? draft : echoStr;
          const dirty = draft !== "" && draft !== echoStr ? "dirty" : "";
          if (f.type === "enum") {
            const opts = (f.options || [])
              .map(
                (o) =>
                  `<option value="${flowEsc(o.value)}" ${
                    String(shown) === String(o.value) ? "selected" : ""
                  }>${flowEsc(o.label)}</option>`
              )
              .join("");
            const extra =
              f.code === "work_mode" && String(shown) === "manual"
                ? `<button type="button" class="btn btn-sm btn-ghost fam-manual-btn" data-act="family-manual-schedule">配置手动时段</button>`
                : f.code === "work_mode" && String(shown) === "time_of_use"
                  ? `<button type="button" class="btn btn-sm btn-ghost fam-manual-btn" data-act="family-tou-schedule">配置分时时段</button>`
                  : "";
            return `<label class="fam-fld">
              <span class="ff-lab">${flowEsc(f.label)}</span>
              <select data-fam-field="${flowEsc(f.code)}" data-echo="${flowEsc(echoStr)}" class="${dirty}">
                <option value="">—</option>
                ${opts}
              </select>
              ${extra}
            </label>`;
          }
          return `<label class="fam-fld">
            <span class="ff-lab">${flowEsc(f.label)}</span>
            <span class="ff-input">
              <input type="number" inputmode="numeric" data-fam-field="${flowEsc(f.code)}"
                data-echo="${flowEsc(echoStr)}" value="${flowEsc(shown)}" placeholder="${flowEsc(echoStr || "—")}"
                class="${dirty}" />
              <span class="u">${flowEsc(f.unit || "")}</span>
            </span>
          </label>`;
        }).join("")
      : "";

  const fold = (typeof loadFamilyRailFold === "function" ? loadFamilyRailFold() : {}) || {};
  // 设备多时默认折叠列表，避免挤掉参数区；用户折叠偏好优先生效
  const metersFolded = fold.meters === true;
  const paramsFolded = fold.params === true;
  const devicesFolded =
    fold.devices === true || (fold.devices == null && devices.length >= 5);
  const railHidden = fold.railHidden === true;
  const eyeTitle = railHidden ? "显示家庭侧" : "隐藏家庭侧";
  const eyeSvg = railHidden
    ? `<svg class="fb-eye-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>`
    : `<svg class="fb-eye-ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M2.1 3.5 3.5 2.1 21.9 20.5 20.5 21.9l-3.1-3.1A12.6 12.6 0 0 1 12 19c-5 0-9.3-3.1-11-7a13.5 13.5 0 0 1 4.5-5.2L2.1 3.5zM12 7a5 5 0 0 1 4.9 4l-1.6-1.6A2.5 2.5 0 0 0 12 9.5V7zm0-2c5 0 9.3 3.1 11 7a13.4 13.4 0 0 1-3.6 4.6l-1.5-1.5A11.4 11.4 0 0 0 21.1 12C19.6 8.7 16 6.5 12 6.5c-.7 0-1.4.1-2 .2L8.4 5.1A12 12 0 0 1 12 5z"/></svg>`;

  return `
    <div class="family-bar">
      <div class="fb-hd">
        <div class="fb-hd-text">
          <strong>家庭侧</strong>
          <span class="fb-sub">电表 · 可下发参数 · 设备列表</span>
        </div>
        <button type="button" class="fb-eye" data-act="fb-rail-toggle"
          title="${eyeTitle}" aria-label="${eyeTitle}" aria-pressed="${railHidden ? "true" : "false"}">${eyeSvg}</button>
      </div>
      <div class="fb-scroll">
        <div class="fb-block">
          <div class="fb-label">入户电表功率</div>
          <div class="fb-meter-val">${flowEsc(meterW)}</div>
          <div class="fb-hint">${flowEsc(meterName)}</div>
          <div class="fb-hint meter-read-ago" data-meter-ago>${flowEsc(meterAgo)}</div>
          ${lanSelect}
        </div>
        <div class="fb-block fb-fold${metersFolded ? " is-collapsed" : ""}" data-fold="meters">
          <button type="button" class="fb-fold-hd" data-act="fb-fold" aria-expanded="${metersFolded ? "false" : "true"}">
            <span class="fb-label">电表设备</span>
            <span class="fb-chevron" aria-hidden="true"></span>
          </button>
          <div class="fb-fold-body">${meterCards}</div>
        </div>
        <div class="fb-block fam-params fb-fold${paramsFolded ? " is-collapsed" : ""}" data-fold="params">
          <button type="button" class="fb-fold-hd" data-act="fb-fold" aria-expanded="${paramsFolded ? "false" : "true"}">
            <span class="fb-label">家庭参数（下发到全部一体机）</span>
            <span class="fb-chevron" aria-hidden="true"></span>
          </button>
          <div class="fb-fold-body">
            <div class="fam-fields">${famFields}</div>
            <div class="fb-hint">改动后将对家庭内 ${devices.length} 台设备逐台下发</div>
          </div>
        </div>
        <div class="fb-block fb-fold${devicesFolded ? " is-collapsed" : ""}" data-fold="devices">
          <button type="button" class="fb-fold-hd" data-act="fb-fold" aria-expanded="${devicesFolded ? "false" : "true"}">
            <span class="fb-label">一体机 (${devices.length})</span>
            <span class="fb-chevron" aria-hidden="true"></span>
          </button>
          <div class="fb-fold-body">
            <div class="rail-dev-list">${devList || '<div class="rail-empty">暂无设备</div>'}</div>
          </div>
        </div>
      </div>
      <div class="fb-foot">
        <span class="fb-foot-hint">${famDraftN ? `${famDraftN} 项待下发` : "无草稿"}</span>
        <button type="button" class="u3-issue ${famDraftN ? "on" : ""}" data-act="family-issue"
          ${famDraftN ? "" : "disabled"}>${famDraftN ? `下发 (${famDraftN})` : "下发"}</button>
      </div>
    </div>`;
}

/**
 * Render algo_core-style energy flow for a live home.
 * @returns {string} HTML
 */
function renderHomeEnergyFlow(home) {
  const devices =
    typeof homeLiveDevices === "function" ? homeLiveDevices(home) : home.devices || [];
  const meters = home.meters || [];
  const meter = meters[0];
  const gridPow =
    typeof resolveGridNodePower === "function"
      ? resolveGridNodePower(home)
      : {
          watts: flowNum(meter?.lastValue),
          source: "meter",
        };
  const meterW = gridPow.watts == null ? 0 : flowNum(gridPow.watts);
  const hasGridPow =
    gridPow.watts != null && Number.isFinite(Number(gridPow.watts));
  const meterAgoTxt =
    typeof meterReadAgoLabel === "function" && meter
      ? meterReadAgoLabel(meter)
      : meter?.lastReadAt
        ? "已读"
        : gridPow.source === "lan"
          ? "DP26"
          : "未读";

  if (!devices.length) {
    const railHidden =
      typeof loadFamilyRailFold === "function" && loadFamilyRailFold().railHidden === true;
    return `<div class="home-flow-shell${railHidden ? " is-rail-hidden" : ""}">
      <aside class="flow-rail">${renderFamilyRail(home)}</aside>
      <div class="flow-main"><div class="flow-empty">暂无型号范围内的储能设备。点击「刷新设备」按家庭 ID 拉取（仅展示已关联 PID 的机型）。</div></div>
    </div>`;
  }

  const grouped =
    typeof groupDevicesByCluster === "function"
      ? groupDevicesByCluster(devices)
      : {
          clusters: (() => {
            const members = devices.filter((d) =>
              typeof isClusterBoxMember === "function" ? isClusterBoxMember(d) : false
            );
            return members.length ? [{ nodeId: "?", devices: members }] : [];
          })(),
          solos: devices.filter(
            (d) => !(typeof isClusterBoxMember === "function" ? isClusterBoxMember(d) : false)
          ),
        };
  const clusterGroups = grouped.clusters || [];
  const soloDevices = grouped.solos || [];
  const ncTotal = clusterGroups.reduce((n, g) => n + (g.devices?.length || 0), 0);
  const ns = soloDevices.length;
  const nn = devices.length;
  const UNIT_W_MIN = 168;
  const unitW = UNIT_W_MIN;
  const unitGap = 18;
  const pad = 14;
  const soloGap = 28;
  const pvBusW = typeof busDefaultSize === "function" ? busDefaultSize("pv").w : 108;
  const leftLane = Math.max(pvBusW + 44, 28 + nn * 16);
  const rightLane = 36 + nn * 16;

  const clusterBoxes = [];
  let xCursor = 24 + leftLane;
  for (const cg of clusterGroups) {
    const n = cg.devices.length;
    if (!n) continue;
    const w = pad * 2 + n * UNIT_W_MIN + Math.max(0, n - 1) * unitGap;
    clusterBoxes.push({ nodeId: cg.nodeId, devices: cg.devices, x: xCursor, w, n });
    xCursor += w + soloGap;
  }
  const soloStartX0 = clusterBoxes.length ? xCursor : 24 + leftLane;
  const gridTop = 10;
  const gridH =
    typeof busDefaultSize === "function" ? busDefaultSize("grid").h : 72;
  const topBand = 48 + nn * 10;
  const clusterY = gridTop + gridH + topBand;
  const clusterTopPad = 36;
  const clusterBotPad = 88;
  const unitY = clusterY + clusterTopPad;
  const bmsH = 62;
  const avgBarH = 30;

  const geos = [];
  const layoutDraft = { unitW: UNIT_W_MIN, unitGap, unitY, unitH: 0, pad };
  for (const box of clusterBoxes) {
    const layoutCluster = {
      ...layoutDraft,
      clusterX: box.x,
      nodeId: box.nodeId,
    };
    box.devices.forEach((d, i) => {
      geos.push(buildDeviceFlowGeo(home, d, i, layoutCluster));
    });
  }
  const layoutSolo = { ...layoutDraft, clusterX: soloStartX0, pad: 0 };
  soloDevices.forEach((d, i) => {
    geos.push(buildDeviceFlowGeo(home, d, i, layoutSolo));
  });
  const cardSizes = measureUnitCardSizes(geos);
  const cardBox = resolveLiveCardBox(home, cardSizes);
  const cardW0 = cardBox.w;
  const cardH0 = cardBox.h;

  clusterBoxes.length = 0;
  xCursor = 24 + leftLane;
  let gi = 0;
  for (const cg of clusterGroups) {
    const n = cg.devices.length;
    if (!n) continue;
    const innerW = n * cardW0 + Math.max(0, n - 1) * unitGap;
    const w = pad * 2 + innerW;
    clusterBoxes.push({ nodeId: cg.nodeId, devices: cg.devices, x: xCursor, w, n });
    let x = xCursor + pad;
    cg.devices.forEach((d) => {
      const g = geos[gi++];
      applyLiveUnitBox(g, x, cardW0, cardH0, unitY);
      x += cardW0 + unitGap;
    });
    xCursor += w + soloGap;
  }
  const soloStartX = clusterBoxes.length ? xCursor : 24 + leftLane;
  let sx = soloStartX;
  soloDevices.forEach((d, i) => {
    const g = geos[gi++];
    applyLiveUnitBox(g, sx, cardW0, cardH0, unitY);
    sx += cardW0 + (i < ns - 1 ? unitGap : 0);
  });
  const soloBlockW = ns > 0 ? sx - soloStartX : 0;
  const clusterSpanW = clusterBoxes.length
    ? clusterBoxes[clusterBoxes.length - 1].x +
      clusterBoxes[clusterBoxes.length - 1].w -
      clusterBoxes[0].x
    : 0;
  const firstClusterX = clusterBoxes.length ? clusterBoxes[0].x : soloStartX;
  const unitsSpanW =
    (clusterBoxes.length ? clusterSpanW : 0) +
    (clusterBoxes.length && ns > 0 ? soloGap : 0) +
    soloBlockW;
  const vbW0 = Math.max(960, firstClusterX + unitsSpanW + rightLane + 280);
  let vbW = vbW0;
  const gridCx = firstClusterX + (ncTotal > 0 || ns > 0 ? unitsSpanW : 0) / 2;
  const unitH = geos.length ? Math.max(...geos.map((g) => g.unitH)) : 160;
  const clusterH = clusterTopPad + unitH + clusterBotPad;
  const bmsY = clusterY + clusterH + 36;
  const avgBarY = bmsY + bmsH + 14;
  const loadY = avgBarY + avgBarH + 28;
  let vbH = loadY + 100;

  const layout = {
    clusterX: firstClusterX,
    pad,
    unitW: UNIT_W_MIN,
    unitGap,
    unitY,
    unitH,
  };
  const clusterX = firstClusterX;
  const nc = ncTotal;

  // ---- wiring buses layout ----
  const wiring =
    typeof ensureHomeWiring === "function"
      ? ensureHomeWiring(home)
      : home.wiring || { buses: [], devices: {} };
  const busBoxes = {};
  const kindIdx = { pv: 0, grid: 0, bypass: 0, family: 0 };
  const layoutCtx = { vbW: vbW0, gridTop, gridCx, loadY, unitY };
  for (const b of wiring.buses) {
    const size = typeof busDefaultSize === "function" ? busDefaultSize(b.kind) : { w: 120, h: 56 };
    const idx = kindIdx[b.kind] || 0;
    kindIdx[b.kind] = idx + 1;
    const def =
      typeof defaultBusPosition === "function"
        ? defaultBusPosition(b.kind, idx, layoutCtx)
        : { x: 24, y: 16 };
    const pos =
      typeof parseBusCoord === "function"
        ? parseBusCoord(b.x, b.y)
        : {
            x: b.x != null && b.x !== "" && Number.isFinite(Number(b.x)) ? Number(b.x) : null,
            y: b.y != null && b.y !== "" && Number.isFinite(Number(b.y)) ? Number(b.y) : null,
          };
    // (0,0) was a legacy normalize bug for "unset" — use default layout
    const useDef = pos.x == null || pos.y == null;
    const x = useDef ? def.x : pos.x;
    const y = useDef ? def.y : pos.y;
    if (useDef) {
      b.x = x;
      b.y = y;
    }
    busBoxes[b.id] = { x, y, w: size.w, h: size.h, bus: b };
    vbW = Math.max(vbW, x + size.w + 32);
    vbH = Math.max(vbH, y + size.h + 32);
  }
  const portOf = (g) =>
    typeof deviceWiringPorts === "function"
      ? deviceWiringPorts(home, g.device)
      : wiring.devices?.[g.device.uid] || { pv: [], grid: [], offgrid: [] };

  const countsOf = (g) =>
    typeof liveDevicePortCounts === "function"
      ? liveDevicePortCounts(g.device)
      : { pv: 1, grid: 1, offgrid: 1 };

  const padsOf = (g) =>
    buildLivePortPads(g, countsOf(g), g.unitW || unitW, g.unitH || unitH);

  const slotAt = (ports, kind, idx) =>
    typeof getPortSlot === "function"
      ? getPortSlot(ports, kind, idx)
      : Array.isArray(ports?.[kind])
        ? ports[kind][idx] || ""
        : idx === 0
          ? ports?.[kind] || ""
          : "";

  const busKindOf = (busId) => wiring.buses.find((b) => b.id === busId)?.kind || "";
  const plugOf = (busId) => {
    const box = busBoxes[busId];
    if (!box) return null;
    return liveBusPlug(box, busKindOf(busId) || "bypass");
  };

  const linksBus = (ports, kind, busId) =>
    typeof portSlotsLinkBus === "function"
      ? portSlotsLinkBus(ports, kind, busId)
      : slotAt(ports, kind, 0) === busId;

  const busPower = (busId, kind) => {
    let pv = 0;
    let load = 0;
    let micro = 0;
    let dchg = 0;
    let chg = 0;
    for (const g of geos) {
      const p = portOf(g);
      if (kind === "pv" && linksBus(p, "pv", busId)) pv += g.pv;
      if (kind === "grid" && linksBus(p, "grid", busId)) {
        dchg += g.acDchg;
        chg += g.acChg;
      }
      if ((kind === "bypass" || kind === "family") && linksBus(p, "offgrid", busId)) {
        load += g.load;
        micro += g.micro;
      }
    }
    return { pv, load, micro, dchg, chg };
  };

  const pvTotal = geos.reduce((s, g) => s + g.pv, 0);
  const microSum = geos.reduce((s, g) => s + g.micro, 0);
  const loadSum = geos.reduce((s, g) => s + g.load, 0);
  const gridDchgTot = geos.reduce((s, g) => s + g.acDchg, 0);
  const gridChgTot = geos.reduce((s, g) => s + g.acChg, 0);
  // 家庭负载功率（能量守恒 / algo_core）：
  //   有电表或 DP26：P = meter − Σ(−grid口) = meter + Σ(grid)
  //   都没有：P = 基础负载 + 插座
  // 注：逆流上限（feedin）是限值，不参与负载估算
  const sumNegGrid = geos.reduce((s, g) => s + -g.grid, 0);
  const hasMeter =
    meter?.lastValue != null && meter.lastValue !== "" && Number.isFinite(Number(meter.lastValue));
  const famPower = hasMeter || (gridPow.source === "lan" && hasGridPow)
    ? Math.round(meterW - sumNegGrid)
    : Math.round(
        flowNum(home.familyValues?.base_load) + flowNum(home.familyValues?.total_plug_power)
      );
  const famFromGrid = Math.max(0, famPower);
  const famOn = famFromGrid > 0;
  const gridTake = hasGridPow && meterW > 0;
  const gridFeed = hasGridPow && meterW < 0;
  const gridNetTxt = !hasGridPow
    ? gridPow.source === "lan"
      ? `DP26 —`
      : `净交换 —`
    : gridFeed
      ? `馈网 ${-meterW}W`
      : gridTake
        ? `取电 ${meterW}W`
        : `净交换 0W`;
  const gridSubTxt =
    gridPow.source === "lan"
      ? `DP26 · 机放 ${gridDchgTot} · 机充 ${gridChgTot}`
      : `机放 ${gridDchgTot} · 机充 ${gridChgTot}`;

  const gc = LIVE_BUS_COLORS.grid;
  let gridFill = gc.fill;
  let gridStroke = gc.stroke;
  let gridSw = 1.5;
  let gridCls = "";
  let gridTitleFill = gc.title;
  let gridNetFill = gc.sub;
  let gridNetSize = 11;
  if (gridTake || gridFeed) {
    gridSw = 3;
    gridCls = "grid-node-alert";
    gridNetSize = 14;
  } else if (gridDchgTot || gridChgTot) {
    gridSw = 2;
  }

  const wireMode = true;

  const edges = geos
    .map((g) => {
      const parts = [];
      const ports = portOf(g);
      const pads = padsOf(g);
      const midI = (nn - 1) / 2;
      const fan = (g.i - midI) * 28;

      // PV bus → combiner hub (one wire per bus, regardless of slot count)
      {
        const pvByBus = new Map();
        pads
          .filter((p) => p.kind === "pv")
          .forEach((pad) => {
            const busId = slotAt(ports, "pv", pad.idx);
            if (!busId || !busBoxes[busId]) return;
            if (!pvByBus.has(busId)) pvByBus.set(busId, []);
            pvByBus.get(busId).push(pad);
          });
        pvByBus.forEach((list, busId) => {
          const hub = list[0].group || { hubX: list[0].x, hubY: list[0].y };
          const plug = plugOf(busId);
          if (!plug) return;
          const bx = -36 - (nn - 1 - g.i) * 16;
          const by = -32 + fan * 0.15;
          const w = flowClearedCurve(
            plug.x,
            plug.y,
            hub.hubX,
            hub.hubY,
            bx,
            by,
            FLOW_WIRE_CLEAR.bus,
            FLOW_WIRE_CLEAR.hub
          );
          if (g.pv > 0) {
            parts.push(
              `<path class="${flowEdgeClass("pv", g.pv)}${flowPortSelClass(g.uid, "pv", "all", busId)}" d="${w.d}" marker-end="url(#arrAmber)"/>`
            );
            parts.push(
              `<text class="flow-label active" x="${w.mid.x}" y="${w.mid.y - 4}" text-anchor="middle" fill="#b45309">${g.pv}W</text>`
            );
          } else {
            parts.push(
              `<path class="flow-edge wired pv${flowPortSelClass(g.uid, "pv", "all", busId)}" d="${w.d}" />`
            );
          }
          parts.push(flowWireSelectHit(w.d, g.uid, "pv", "all", busId));
        });
      }

      // Offgrid ↔ bypass/family (bottom)
      pads
        .filter((p) => p.kind === "offgrid")
        .forEach((pad) => {
          const busId = slotAt(ports, "offgrid", pad.idx);
          if (!busId) return;
          const plug = plugOf(busId);
          if (!plug) return;
          const bx = 56 + g.i * 20 + pad.idx * 10;
          const by = 36 + fan * 0.3;
          if (pad.idx === 0 && g.load > 0) {
            const w = flowClearedCurve(
              pad.x,
              pad.y,
              plug.x,
              plug.y,
              bx,
              by,
              FLOW_WIRE_CLEAR.pad,
              FLOW_WIRE_CLEAR.bus
            );
            parts.push(
              `<path class="${flowEdgeClass("load", g.load)}${flowPortSelClass(g.uid, "offgrid", pad.idx)}" d="${w.d}" marker-end="url(#arrGray)"/>`
            );
            parts.push(
              `<text class="flow-label active" x="${w.mid.x}" y="${w.mid.y - 4}" text-anchor="middle" fill="#475569">${g.load}W</text>`
            );
            parts.push(flowWireSelectHit(w.d, g.uid, "offgrid", pad.idx));
          } else if (pad.idx === 0 && g.micro > 0) {
            const w = flowClearedCurve(
              plug.x,
              plug.y,
              pad.x,
              pad.y,
              bx,
              -by,
              FLOW_WIRE_CLEAR.bus,
              FLOW_WIRE_CLEAR.pad
            );
            parts.push(
              `<path class="${flowEdgeClass("micro", g.micro)}${flowPortSelClass(g.uid, "offgrid", pad.idx)}" d="${w.d}" marker-end="url(#arrSky)"/>`
            );
            parts.push(
              `<text class="flow-label active" x="${w.mid.x}" y="${w.mid.y - 4}" text-anchor="middle" fill="#0369a1">${g.micro}W</text>`
            );
            parts.push(flowWireSelectHit(w.d, g.uid, "offgrid", pad.idx));
          } else {
            const w = flowClearedCurve(
              pad.x,
              pad.y,
              plug.x,
              plug.y,
              bx,
              by,
              FLOW_WIRE_CLEAR.pad,
              FLOW_WIRE_CLEAR.bus
            );
            parts.push(`<path class="flow-edge wired offgrid${flowPortSelClass(g.uid, "offgrid", pad.idx)}" d="${w.d}" />`);
            parts.push(flowWireSelectHit(w.d, g.uid, "offgrid", pad.idx));
          }
        });

      // Grid ↔ device (top)
      pads
        .filter((p) => p.kind === "grid")
        .forEach((pad) => {
          const busId = slotAt(ports, "grid", pad.idx);
          if (!busId) return;
          const plug = plugOf(busId);
          if (!plug) return;
          if (pad.idx === 0 && g.acDchg > 0) {
            const bx = 24 + fan * 0.5;
            const by = -28 - g.i * 8;
            const w = flowClearedCurve(
              pad.x,
              pad.y,
              plug.x,
              plug.y,
              bx,
              by,
              FLOW_WIRE_CLEAR.pad,
              FLOW_WIRE_CLEAR.bus
            );
            parts.push(
              `<path class="${flowEdgeClass("discharge", g.acDchg)}${flowPortSelClass(g.uid, "grid", pad.idx)}" d="${w.d}" marker-end="url(#arrPurple)"/>`
            );
            parts.push(
              `<text class="flow-label active" x="${w.mid.x}" y="${w.mid.y - 4}" text-anchor="middle" fill="#7e22ce">${g.acDchg}W</text>`
            );
            parts.push(flowWireSelectHit(w.d, g.uid, "grid", pad.idx));
          } else if (pad.idx === 0 && g.acChg > 0) {
            const bx = -20 + fan * 0.5;
            const by = -24 - (nn + g.i) * 6;
            const w = flowClearedCurve(
              plug.x,
              plug.y,
              pad.x,
              pad.y,
              bx,
              by,
              FLOW_WIRE_CLEAR.bus,
              FLOW_WIRE_CLEAR.pad
            );
            parts.push(
              `<path class="${flowEdgeClass("charge", g.acChg)}${flowPortSelClass(g.uid, "grid", pad.idx)}" d="${w.d}" marker-end="url(#arrBlue)"/>`
            );
            parts.push(
              `<text class="flow-label active" x="${w.mid.x}" y="${w.mid.y - 4}" text-anchor="middle" fill="#1d4ed8">${g.acChg}W</text>`
            );
            parts.push(flowWireSelectHit(w.d, g.uid, "grid", pad.idx));
          } else {
            const by = -30 - g.i * 6 - pad.idx * 6;
            const w = flowClearedCurve(
              plug.x,
              plug.y,
              pad.x,
              pad.y,
              0,
              by,
              FLOW_WIRE_CLEAR.bus,
              FLOW_WIRE_CLEAR.pad
            );
            parts.push(`<path class="flow-edge wired grid${flowPortSelClass(g.uid, "grid", pad.idx)}" d="${w.d}" />`);
            parts.push(flowWireSelectHit(w.d, g.uid, "grid", pad.idx));
          }
        });
      return parts.join("");
    })
    .join("");

  // Grid ↔ family load: only when explicitly wired (bus_links)
  let famEdge = "";
  const busLinks = wiring.bus_links || {};
  const seenBusLink = new Set();
  for (const [aId, bId] of Object.entries(busLinks)) {
    if (!bId || !busBoxes[aId] || !busBoxes[bId]) continue;
    const key = [aId, bId].sort().join("|");
    if (seenBusLink.has(key)) continue;
    seenBusLink.add(key);
    const a = wiring.buses.find((b) => b.id === aId);
    const b = wiring.buses.find((x) => x.id === bId);
    if (!a || !b) continue;
    // Always Grid → Family so the arrow points into the load
    const from = a.kind === "family" && b.kind === "grid" ? b : a;
    const to = from === a ? b : a;
    const pa = liveBusPlug(busBoxes[from.id], from.kind);
    const pb = liveBusPlug(busBoxes[to.id], to.kind);
    const w = flowClearedCurve(
      pa.x,
      pa.y,
      pb.x,
      pb.y,
      40,
      20,
      FLOW_WIRE_CLEAR.bus,
      FLOW_WIRE_CLEAR.bus
    );
    if (famOn) {
      famEdge += `
      <path class="${flowEdgeClass("family", famFromGrid)}${flowBusLinkSelClass(aId)}" d="${w.d}" marker-end="url(#arrBlue)"/>
      <text class="flow-label active" x="${w.mid.x}" y="${w.mid.y - 4}" text-anchor="middle" fill="#1d4ed8">${famFromGrid}W</text>`;
    } else {
      famEdge += `<path class="flow-edge wired family${flowBusLinkSelClass(aId)}" d="${w.d}" />`;
    }
    famEdge += `<path class="wire-select-hit${flowBusLinkSelClass(aId)}" data-select-wire="buslink:${flowEsc(aId)}" d="${w.d}"><title>点选连线，按 Delete 删除</title></path>`;
  }

  const busPlugParts = [];
  const busNodesSvg = wiring.buses
    .map((b) => {
      const box = busBoxes[b.id];
      if (!box) return "";
      const pwr = busPower(b.id, b.kind);
      const moveHit = `<rect class="bus-move-hit" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
          data-bus-move data-bus-id="${flowEsc(b.id)}" />`;
      const plugPos = liveBusPlug(box, b.kind);
      busPlugParts.push(`<g class="wire-bus-node" data-bus-id="${flowEsc(b.id)}" data-bus-kind="${flowEsc(b.kind)}">
            <circle class="wire-plug ${flowEsc(b.kind)}" cx="${plugPos.x}" cy="${plugPos.y}" r="7"
            data-wire-src="bus:${flowEsc(b.id)}" data-bus-id="${flowEsc(b.id)}" data-bus-kind="${flowEsc(b.kind)}">
            <title>拖到端口接线</title></circle></g>`);
      let body = "";
      if (b.kind === "pv") {
        const c = LIVE_BUS_COLORS.pv;
        const on = pwr.pv > 0;
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${on ? 2 : 1.5}"/>
          <text x="${box.x + box.w / 2}" y="${box.y + 22}" text-anchor="middle" font-size="12" font-weight="700" fill="${c.title}">${flowEsc(b.label)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 40}" text-anchor="middle" font-size="11" fill="${c.sub}">${on ? pwr.pv + "W" : "—"}</text>`;
      } else if (b.kind === "grid") {
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
            class="${gridCls}" fill="${gridFill}" stroke="${gridStroke}" stroke-width="${gridSw}"/>
          <text x="${box.x + box.w / 2}" y="${box.y + 14}" text-anchor="middle" font-size="12" font-weight="700" fill="${gridTitleFill}">${flowEsc(b.label)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 32}" text-anchor="middle" font-size="${gridNetSize}" font-weight="700" fill="${gridNetFill}">${flowEsc(gridNetTxt)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 48}" text-anchor="middle" font-size="10" fill="#64748b">机放 ${pwr.dchg} · 机充 ${pwr.chg}</text>
          <text class="meter-read-ago" data-meter-ago x="${box.x + box.w / 2}" y="${box.y + 64}" text-anchor="middle" font-size="9" fill="#94a3b8">${flowEsc(meterAgoTxt)}</text>`;
      } else if (b.kind === "bypass") {
        const c = LIVE_BUS_COLORS.bypass;
        const on = pwr.load > 0 || pwr.micro > 0;
        const sub = pwr.micro > 0 ? `微逆 ${pwr.micro}W` : pwr.load > 0 ? `${pwr.load}W` : "—";
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
            fill="${c.fill}" stroke="${c.stroke}" stroke-width="${on ? 2 : 1.5}"/>
          <text x="${box.x + box.w / 2}" y="${box.y + 20}" text-anchor="middle" font-size="11" font-weight="700" fill="${c.title}">${flowEsc(b.label)}</text>
          <text x="${box.x + box.w / 2}" y="${box.y + 38}" text-anchor="middle" font-size="12" fill="${c.sub}">${flowEsc(sub)}</text>`;
      } else {
        const c = LIVE_BUS_COLORS.family;
        const on = famOn || famPower !== 0 || pwr.load > 0;
        const sub = pwr.load > 0 ? `离网 ${pwr.load}W` : `${famPower}W`;
        body = `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="10"
          fill="${c.fill}" stroke="${c.stroke}" stroke-width="${on ? 2 : 1.5}"/>
        <text x="${box.x + box.w / 2}" y="${box.y + 18}" text-anchor="middle" font-size="11" font-weight="700" fill="${c.title}">${flowEsc(b.label)}</text>
        <text x="${box.x + box.w / 2}" y="${box.y + 36}" text-anchor="middle" font-size="13" font-weight="700" fill="${c.sub}">${flowEsc(sub)}</text>`;
      }
      return `<g class="wire-bus-node movable editable${typeof liveCanvasSel !== "undefined" && liveCanvasSel.buses.has(b.id) ? " selected" : ""}" data-bus-id="${flowEsc(b.id)}" data-bus-kind="${flowEsc(b.kind)}">${body}${moveHit}</g>`;
    })
    .join("");
  const busPlugsSvg = busPlugParts.join("");

  const portPadsSvg = wireMode
    ? geos
        .map((g) => {
          const ports = portOf(g);
          const pads = padsOf(g);
          const pvPads = pads.filter((p) => p.kind === "pv");
          const otherPads = pads.filter((p) => p.kind !== "pv");
          let html = "";
          if (pvPads.length) {
            const grp = pvPads[0].group || livePvGroupLayout(g, pvPads.length);
            if (grp) {
            const onN = pvPads.filter((p) => !!slotAt(ports, "pv", p.idx)).length;
            const uid = flowEsc(g.uid);
            const dots = pvPads
              .map((pad) => {
                const on = !!slotAt(ports, "pv", pad.idx);
                return `<g class="wire-port-pad${on ? " on" : ""} pv" data-wire-dst="device:${uid}:pv:${pad.idx}"
                data-wire-src="device:${uid}:pv:${pad.idx}" data-port="pv" data-port-idx="${pad.idx}" data-device-uid="${uid}">
              <circle class="wire-hit" cx="${pad.x}" cy="${pad.y}" r="10" fill="transparent" stroke="none"/>
              <circle cx="${pad.x}" cy="${pad.y}" r="4" />
              ${on ? `<title>已接 PV${pad.idx + 1}</title>` : `<title>拖到此口接 PV${pad.idx + 1}</title>`}
            </g>`;
              })
              .join("");
            html += `<g class="wire-pv-group${onN ? " on" : ""}" data-wire-dst="device:${uid}:pv:all"
              data-port="pv" data-port-idx="all" data-device-uid="${uid}">
              <rect class="pv-group-frame" x="${grp.frameX}" y="${grp.frameY}" width="${grp.frameW}" height="${grp.frameH}" rx="6"/>
              <text class="pv-group-count" x="${grp.frameX + grp.frameW / 2}" y="${grp.frameY + 10}" text-anchor="middle">PV ${onN}/${pvPads.length}</text>
              <g class="wire-port-pad pv-hub${onN ? " on" : ""}" data-wire-dst="device:${uid}:pv:all"
                data-wire-src="device:${uid}:pv:all" data-port="pv" data-port-idx="all" data-device-uid="${uid}">
                <circle class="wire-hit" cx="${grp.hubX}" cy="${grp.hubY}" r="14" fill="transparent" stroke="none"/>
                <circle cx="${grp.hubX}" cy="${grp.hubY}" r="3.5" />
                <title>拖到框上接全部 PV 口</title>
              </g>
              ${dots}
            </g>`;
            }
          }
          html += otherPads
            .map((pad) => {
              const on = !!slotAt(ports, pad.kind, pad.idx);
              return `<g class="wire-port-pad${on ? " on" : ""} ${pad.kind}" data-wire-dst="device:${flowEsc(g.uid)}:${pad.kind}:${pad.idx}"
                data-wire-src="device:${flowEsc(g.uid)}:${pad.kind}:${pad.idx}" data-port="${pad.kind}" data-port-idx="${pad.idx}" data-device-uid="${flowEsc(g.uid)}">
              <circle class="wire-hit" cx="${pad.x}" cy="${pad.y}" r="12" fill="transparent" stroke="none"/>
              <circle cx="${pad.x}" cy="${pad.y}" r="5" />
              <text x="${pad.labX}" y="${pad.labY}" text-anchor="${flowEsc(pad.labAnchor)}" font-size="8" font-weight="700">${flowEsc(pad.lab)}</text>
              ${on ? `<title>已接 · 点选连线后按 Delete 删除</title>` : `<title>拖到此处接线</title>`}
            </g>`;
            })
            .join("");
          return html;
        })
        .join("")
    : "";

  let bmsEdgesSvg = "";
  let bmsBoxesSvg = "";
  const unitBodies = geos
    .map((g, gi) => {
      const cardW = g.unitW || unitW;
      const bmsW = Math.min(96, Math.max(48, cardW - 36));
      const bx = g.ux - bmsW / 2;
      const bmsBend = (g.i - (nn - 1) / 2) * 6;
      const charging = g.absorb > 0;
      const discharging = !charging && g.bmsDchg > 0;
      const mode = charging ? "chg" : discharging ? "dchg" : "idle";
      let wattsLabel = "待机";
      if (charging) {
        const w = flowClearedCurve(
          g.ux,
          g.bottom,
          g.ux,
          bmsY,
          bmsBend,
          0,
          FLOW_WIRE_CLEAR.pad,
          FLOW_WIRE_CLEAR.bms
        );
        bmsEdgesSvg += `<path class="${flowEdgeClass("bms", g.absorb)}" d="${w.d}" marker-end="url(#arrBms)"/>
          <text class="flow-label active" x="${w.mid.x + 14}" y="${w.mid.y + 3}" fill="#15803d">${g.absorb}W↓充</text>`;
        wattsLabel = `充 ${g.absorb}W`;
      } else if (discharging) {
        const w = flowClearedCurve(
          g.ux,
          bmsY,
          g.ux,
          g.bottom,
          bmsBend,
          0,
          FLOW_WIRE_CLEAR.bms,
          FLOW_WIRE_CLEAR.pad
        );
        bmsEdgesSvg += `<path class="${flowEdgeClass("bms-dchg", g.bmsDchg)}" d="${w.d}" marker-end="url(#arrBmsDchg)"/>
          <text class="flow-label active" x="${w.mid.x + 14}" y="${w.mid.y + 3}" fill="#be123c">${g.bmsDchg}W↑放</text>`;
        wattsLabel = `放 ${g.bmsDchg}W`;
      }
      const capLabel =
        g.batCap == null ? "—" : `${Number(g.batCap).toFixed(3)}kWh`;
      bmsBoxesSvg += flowBmsSvg(bx, bmsY, bmsW, bmsH, mode, wattsLabel, `SOC ${g.soc}%`, capLabel);
      const next = geos[gi + 1];
      const nextGap = next ? Math.max(0, next.x - (g.x + cardW)) : 0;
      return `<g>
      <foreignObject data-unit-card="${flowEsc(g.uid)}" data-next-gap="${nextGap}"
        x="${g.x}" y="${unitY}" width="${cardW}" height="${g.unitH || unitH}">${unitCardHtml(g)}</foreignObject>
    </g>`;
    })
    .join("");

  // 家庭平均 SOC = Σ(soc×容量) / Σ(容量)
  let capSum = 0;
  let socCapSum = 0;
  for (const g of geos) {
    if (g.batCap == null || !(g.batCap > 0)) continue;
    socCapSum += flowNum(g.soc) * g.batCap;
    capSum += g.batCap;
  }
  const homeAvgSoc = capSum > 0 ? socCapSum / capSum : null;
  const avgBarX = geos.length ? Math.min(...geos.map((g) => g.x)) : clusterX;
  const avgBarRight = geos.length
    ? Math.max(...geos.map((g) => g.x + (g.unitW || unitW)))
    : clusterX + unitsSpanW;
  const avgBarW = Math.max(200, avgBarRight - avgBarX);
  const avgSocTxt =
    homeAvgSoc == null ? "—" : `${homeAvgSoc.toFixed(3)}%`;
  const avgSocBarSvg = `<g class="home-avg-soc">
      <rect x="${avgBarX}" y="${avgBarY}" width="${avgBarW}" height="${avgBarH}" rx="6"
        fill="#f0fdf4" stroke="#86efac" stroke-width="1.5"/>
      <text x="${avgBarX + avgBarW / 2}" y="${avgBarY + avgBarH / 2 + 5}" text-anchor="middle"
        font-size="14" font-weight="700" fill="#166534">家庭平均 SOC  ${flowEsc(avgSocTxt)}</text>
      <title>Σ(SOC × 容量) / Σ(容量)${capSum > 0 ? ` · 总容量 ${capSum.toFixed(3)}kWh` : ""}</title>
    </g>`;

  const capParts = [];
  if (pvTotal) capParts.push(`PV ${pvTotal}W`);
  if (hasGridPow && meterW) {
    capParts.push(`${gridPow.source === "lan" ? "DP26" : "电表"} ${meterW}W`);
  }
  if (famPower) capParts.push(`家庭负载 ${famPower}W`);
  if (gridDchgTot) capParts.push(`集群放电 ${gridDchgTot}W`);
  if (gridChgTot) capParts.push(`集群充电 ${gridChgTot}W`);
  if (loadSum) capParts.push(`Bypass ${loadSum}W`);
  const caption = capParts.join(" · ");

  const autoOn = typeof autoRefreshEnabled !== "undefined" && autoRefreshEnabled;
  const pendingN =
    typeof countHomeDrafts === "function" ? countHomeDrafts(home) : 0;
  const cardResizeSvg = geos
    .map((g) => {
      const hs = 11;
      const cw = g.unitW || unitW;
      const ch = g.unitH || unitH;
      return `<rect class="live-card-resize" data-card-resize data-device-uid="${flowEsc(g.uid)}"
        x="${g.x + cw - hs / 2}" y="${g.top + ch - hs / 2}" width="${hs}" height="${hs}" rx="2">
        <title>拖拽缩放宽高 · 全部卡片同步 · 双击恢复默认</title></rect>`;
    })
    .join("");
  const svg = `<div class="flow-panel wiring-mode">
    <div class="flow-hd">
      <span class="flow-hd-left">
        <span>家庭实况 · 能量流向</span>
        <button type="button" class="auto-refresh-switch${autoOn ? " on" : ""}"
          data-act="toggle-auto-refresh"
          role="switch"
          aria-checked="${autoOn ? "true" : "false"}"
          title="${autoOn ? "关闭后停止定时读取" : "开启后每 7 秒自动一键读取"}">
          <span class="auto-refresh-text">自动刷新${autoOn ? " · 7s" : ""}</span>
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
        </button>
        <button type="button" class="auto-refresh-switch${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? " on" : ""}"
          data-act="toggle-high-freq"
          role="switch"
          aria-checked="${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? "true" : "false"}"
          title="${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? "关闭后停止每分钟自动下发" : "开启后立即下发，并每 1 分钟自动再下发一次"}">
          <span class="auto-refresh-text">高频上报${typeof highFreqEnabled !== "undefined" && highFreqEnabled ? " · 1m" : ""}</span>
          <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
        </button>
        <button type="button" class="btn btn-sm btn-ghost clear-drafts-btn"
          data-act="clear-drafts"
          ${pendingN ? "" : "disabled"}
          title="清除家庭侧与各一体机卡片上尚未下发的草稿参数">
          缓存清空${pendingN ? ` (${pendingN})` : ""}
        </button>
      </span>
      <span class="flow-hd-actions">
        <button type="button" class="btn btn-sm btn-ghost" data-act="auto-wire" title="各机 PV/Grid/离网口接到对应端子">一键全接</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="clear-wires" title="清除所有设备与端子的连线">清空接线</button>
        <button type="button" class="btn btn-sm btn-ghost" data-act="manage-buses" title="增删改家庭端子">管理端子</button>
        <span class="badge">${flowEsc(home.name || home.homeId || "")}</span>
      </span>
    </div>
    ${caption ? `<div class="flow-cap">${flowEsc(caption)}</div>` : ""}
    <div class="flow-svg-wrap" title="双指捏合放大缩小画布 · 从端子圆点拖到端口接线 · 卡片右下角拖拽缩放（全部同步）· 双击恢复 · 框选端子可一起移动 · 点选连线后按 Delete 删除">
      <div class="flow-legend-row">
        <span><i style="background:#eab308"></i>PV→各机</span>
        <span><i style="background:#a855f7"></i>各机→电网(放)</span>
        <span><i style="background:#3b82f6"></i>电网→各机(充)</span>
        <span><i style="background:#22c55e"></i>一体机→BMS(充)</span>
        <span><i style="background:#fb7185"></i>BMS→一体机(放)</span>
        <span><i style="background:#64748b"></i>离网口负载</span>
      </div>
      <svg class="flow-svg" width="${vbW}" height="${vbH}" viewBox="0 0 ${vbW} ${vbH}" overflow="visible" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrAmber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#f59e0b"/></marker>
          <marker id="arrBlue" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#3b82f6"/></marker>
          <marker id="arrSky" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#38bdf8"/></marker>
          <marker id="arrPurple" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#a855f7"/></marker>
          <marker id="arrGray" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#64748b"/></marker>
          <marker id="arrOrange" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#ea580c"/></marker>
          <marker id="arrBms" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#22c55e"/></marker>
          <marker id="arrBmsDchg" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#fb7185"/></marker>
        </defs>
        ${
          clusterBoxes
            .map(
              (box) =>
                `<rect x="${box.x}" y="${clusterY}" width="${box.w}" height="${clusterH}" rx="12" fill="#fff" stroke="#334155"/>
        <text x="${box.x + 12}" y="${clusterY + 22}" font-size="12" font-weight="700">一体机集群 · id ${flowEsc(box.nodeId)} · ${box.n} 台</text>`
            )
            .join("\n")
        }
        ${
          ns > 0
            ? `<text x="${soloStartX}" y="${clusterY + 22}" font-size="12" font-weight="700" fill="#64748b">单机 · ${ns} 台</text>`
            : ""
        }
        ${unitBodies}
        ${avgSocBarSvg}
        ${busNodesSvg}
        ${edges}
        ${famEdge}
        ${bmsEdgesSvg}
        ${bmsBoxesSvg}
        ${busPlugsSvg}
        ${portPadsSvg}
        ${cardResizeSvg}
        <g id="wireRubberBand" pointer-events="none"></g>
        <g id="marqueeLayer" pointer-events="none"></g>
      </svg>
    </div>
  </div>`;

  return `<div class="home-flow-shell${
    typeof loadFamilyRailFold === "function" && loadFamilyRailFold().railHidden === true
      ? " is-rail-hidden"
      : ""
  }">
    <aside class="flow-rail">${renderFamilyRail(home)}</aside>
    <div class="flow-main">${svg}</div>
  </div>`;
}
