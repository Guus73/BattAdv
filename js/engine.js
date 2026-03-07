
const { DateTime } = luxon;

const el = Object.fromEntries([
  "consFile","colDate","colValue","colType","colTariff","tz","agg","from","to","series","ean",
  "bzn","priceUrl","copyUrl","priceFile","priceInfo",
  "fixedPrice","feedInFixed","dynMarkup","feedInDyn","batMode","cap","pmax","rte","soc0","socMin","cycleLife","gridTariff",
  "priorityExport","optForecast","optMode","optWindowH","runSim","generatePdfBtn",
  "tier1","tier2","tier3","batFixedCost",
  "sweepMaxCap","sweepStepCap","sweepMaxKw","sweepStepKw","autoObj","roiScale","runSweep","applyRecommended",
  "progressBar","progressText","sweepInfo",
  "kpiEnergy","kpiPeak","kpiCycles","kpiCyclesYear","kpiLifetime","kpiPeakReduction","kpiNoBatFixed","kpiNoBatDyn","kpiWithBatFixed","kpiWithBatDyn",
  "notes"
].map(id => [id, document.getElementById(id)]));

let consRows = [];
let consCols = [];
let dynPrices = null;
let hourlyAllCache = null;
let lastRecommended = null;

// ---------- helpers ----------
function euro(x){ return Number.isFinite(x) ? new Intl.NumberFormat(undefined,{style:"currency",currency:"EUR"}).format(x) : "—"; }
function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m])); }
function fillSelect(sel, options, preferred){
  sel.innerHTML = options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  if (preferred && options.includes(preferred)) sel.value = preferred;
}
function setProgress(pct, text=""){
  el.progressBar.style.width = `${clamp(pct,0,100)}%`;
  el.progressText.textContent = text || `${Math.round(clamp(pct,0,100))}%`;
}
function yieldToUI(){ return new Promise(resolve => setTimeout(resolve, 0)); }

// ---------- parsing ----------
function parseDatum(v, tz){
  const s0 = String(v ?? "").trim();
  if (!s0) return null;
  const s = s0.replace(", ", ",").replace(",", ", ");
  const fmts = [
    "dd-LL-yyyy, HH:mm:ss",
    "d-L-yyyy, H:mm:ss",
    "d-L-yyyy, HH:mm:ss",
    "dd-LL-yyyy, H:mm:ss",
    "d-LL-yyyy, H:mm:ss",
    "d-LL-yyyy, HH:mm:ss"
  ];
  for (const f of fmts){
    const dt = DateTime.fromFormat(s, f, { zone: tz });
    if (dt.isValid) return dt;
  }
  const iso = DateTime.fromISO(s0, { zone: tz });
  return iso.isValid ? iso : null;
}
function parseCommaNumber(v){
  const s = String(v ?? "").trim().replace(/\s/g,"").replace(",",".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- date/range ----------
function inRange(ms){
  const tz = el.tz.value;
  const f = el.from.value ? DateTime.fromISO(el.from.value, {zone:tz}).startOf("day").toMillis() : -Infinity;
  const t = el.to.value ? DateTime.fromISO(el.to.value, {zone:tz}).endOf("day").toMillis() : Infinity;
  return ms >= f && ms <= t;
}
function computeFullRange(all){
  if (!all.length) return null;
  const tz = el.tz.value;
  return {
    minDate: DateTime.fromMillis(all[0].t, {zone:tz}).toISODate(),
    maxDate: DateTime.fromMillis(all[all.length-1].t, {zone:tz}).toISODate()
  };
}
function scaleToYear(){
  if (el.roiScale.value === "none") return 1;
  const tz = el.tz.value;
  if (!el.from.value || !el.to.value) return 1;
  const f = DateTime.fromISO(el.from.value, {zone:tz}).startOf("day");
  const t = DateTime.fromISO(el.to.value, {zone:tz}).endOf("day");
  const days = Math.max(1, t.diff(f, "days").days);
  return 365 / days;
}

// ---------- aggregation ----------
function groupKey(dt, agg){
  if (agg === "day") return dt.toISODate();
  if (agg === "week") return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2,"0")}`;
  if (agg === "month") return dt.toFormat("yyyy-LL");
  if (agg === "year") return dt.toFormat("yyyy");
  return dt.toISO();
}
function keyToMillis(k, agg){
  const tz = el.tz.value;
  if (agg === "day") return DateTime.fromISO(k, {zone:tz}).toMillis();
  if (agg === "month") return DateTime.fromFormat(k, "yyyy-LL", {zone:tz}).toMillis();
  if (agg === "year") return DateTime.fromFormat(k, "yyyy", {zone:tz}).toMillis();
  if (agg === "week"){
    const [yy, ww] = k.split("-W");
    return DateTime.fromObject({weekYear:+yy, weekNumber:+ww, weekday:1}, {zone:tz}).toMillis();
  }
  return DateTime.fromISO(k, {zone:tz}).toMillis();
}
function aggregateSeries(points, agg){
  if (agg === "raw") return points.slice();
  const m = new Map();
  for (const p of points){
    const dt = DateTime.fromMillis(p.t, {zone:el.tz.value});
    const k = groupKey(dt, agg);
    if (!m.has(k)) m.set(k, { t:keyToMillis(k, agg) });
    const out = m.get(k);
    for (const [kk,v] of Object.entries(p)){
      if (kk === "t") continue;
      out[kk] = (out[kk] || 0) + (Number(v) || 0);
    }
  }
  return Array.from(m.values()).sort((a,b)=>a.t-b.t);
}

// ---------- prices ----------
function buildEnergyChartsUrl(){
  const bzn = el.bzn.value;
  const start = el.from.value;
  const end = el.to.value;
  if (!start || !end) return null;
  return `https://api.energy-charts.info/price?bzn=${encodeURIComponent(bzn)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
}
function updatePriceUrl(){
  const url = buildEnergyChartsUrl();
  if (!url){
    el.priceUrl.textContent = "Kies eerst Van/Tot";
    el.priceUrl.href = "#";
    return;
  }
  el.priceUrl.textContent = url;
  el.priceUrl.href = url;
}
function setPriceInfo(text, cls=""){
  el.priceInfo.className = `small ${cls}`;
  el.priceInfo.textContent = text;
}
async function loadEnergyChartsJson(file){
  const text = await file.text();
  const data = JSON.parse(text);
  const ts = data.unix_seconds;
  const pr = data.price;
  const unit = String(data.unit || "").toLowerCase();

  if (!Array.isArray(ts) || !Array.isArray(pr) || ts.length !== pr.length){
    throw new Error("Ongeldig Energy-Charts bestand: verwacht unix_seconds[] + price[] met gelijke lengte.");
  }

  const scale = unit.includes("mwh") ? 1/1000 : 1;
  const map = new Map();

  for (let i=0;i<ts.length;i++){
    const ms = Number(ts[i]) * 1000;
    const p = Number(pr[i]);
    if (!Number.isFinite(ms) || !Number.isFinite(p)) continue;
    map.set(ms, p * scale);
  }

  if (map.size < 24) throw new Error("Te weinig prijzen gevonden.");
  return { map, unit: data.unit || "", scale };
}
function priceAtHourStart(ms){
  if (!dynPrices) return null;
  const dt = DateTime.fromMillis(ms, {zone:el.tz.value}).startOf("hour").toMillis();
  return dynPrices.get(dt) ?? null;
}

// ---------- consumption ----------
function buildHourlyAll(){
  if (hourlyAllCache) return hourlyAllCache;

  const tz = el.tz.value;
  const cD = el.colDate.value;
  const cV = el.colValue.value;
  const cT = el.colType.value;

  const wantEan = el.ean.value || "";
  const hasEAN = consCols.includes("EAN");

  const m = new Map();
  for (const r of consRows){
    const dt = parseDatum(r[cD], tz);
    if (!dt) continue;
    const t = dt.toMillis();

    if (wantEan && hasEAN){
      const ean = String(r["EAN"] ?? "");
      if (ean && ean !== wantEan) continue;
    }

    const typ = String(r[cT] ?? "").trim();
    const val = parseCommaNumber(r[cV]);
    if (val == null) continue;

    if (!m.has(t)) m.set(t, { t, import:0, export:0, gas:0 });
    const o = m.get(t);

    if (typ === "Elektriciteit") o.import += val;
    else if (typ === "Teruglevering") o.export += val;
    else if (typ === "Gas") o.gas += val;
  }

  hourlyAllCache = Array.from(m.values()).sort((a,b)=>a.t-b.t);
  return hourlyAllCache;
}

function pickYMain(p){
  const s = el.series.value;
  if (s === "elec_import") return p.import;
  if (s === "elec_export") return -p.export;
  if (s === "elec_net") return Math.max(0, p.import - p.export);
  if (s === "gas") return p.gas;
  return p.import;
}

function buildSeriesForCosts(all){
  const imp = [], exp = [], net = [];
  for (const p of all){
    if (!inRange(p.t)) continue;
    const im = Math.max(0, p.import);
    const ex = Math.max(0, p.export);
    imp.push({ t:p.t, kwh: im });
    exp.push({ t:p.t, kwh: ex });
    net.push({ t:p.t, kwh: im - ex }); // can be negative
  }
  return { imp, exp, net };
}

// ---------- costs ----------
function costFixedTotal(impKwh, expKwh, fixedImport, fixedFeedIn){
  return impKwh * fixedImport - expKwh * fixedFeedIn;
}
function costDynamicSeries(impSeries, expSeries, markup, feedInDyn){
  let cost = 0, missing=0;
  for (let i=0;i<impSeries.length;i++){
    const t = impSeries[i].t;
    const pr = priceAtHourStart(t);
    if (pr == null){
      missing++;
      continue;
    }
    cost += impSeries[i].kwh * (pr + markup) - expSeries[i].kwh * feedInDyn;
  }
  return { cost, missingHours: missing };
}

// ---------- battery cost ----------
function batteryCostEUR(cap){
  const t1 = Math.max(0, Number(el.tier1.value) || 0);
  const t2 = Math.max(0, Number(el.tier2.value) || 0);
  const t3 = Math.max(0, Number(el.tier3.value) || 0);
  const fixed = Math.max(0, Number(el.batFixedCost.value) || 0);

  let cost = 0;
  cost += Math.min(cap, 5) * t1;
  cost += Math.min(Math.max(cap - 5, 0), 10) * t2;
  cost += Math.max(cap - 15, 0) * t3;
  return cost + fixed;
}

// ---------- models ----------
function simulateSelfConsumption(all, cfg){
  const { capKwh, pmaxKw, rte, soc0, socMin, priorityExport } = cfg;
  const maxKwh = pmaxKw;
  const effCh = Math.sqrt(rte);
  const effDis = Math.sqrt(rte);

  let soc = clamp(soc0,0,1) * capKwh;
  const socMinKwh = clamp(socMin,0,1) * capKwh;

  let imp0=0, exp0=0, imp1=0, exp1=0;
  const tl = [];

  for (const p of all){
    if (!inRange(p.t)) continue;

    const importKwh = Math.max(0, p.import);
    const exportKwh = Math.max(0, p.export);

    imp0 += importKwh;
    exp0 += exportKwh;

    let chargeFromExport = 0;
    if (priorityExport){
      const headroom = Math.max(0, capKwh - soc);
      chargeFromExport = Math.min(maxKwh, exportKwh, headroom / effCh);
      soc += chargeFromExport * effCh;
    }

    const exportAfter = exportKwh - chargeFromExport;

    const available = Math.max(0, soc - socMinKwh);
    const canDis = Math.min(maxKwh, available);
    const delivered = canDis * effDis;
    const used = Math.min(delivered, importKwh);
    const importAfter = importKwh - used;
    soc -= used / effDis;

    imp1 += importAfter;
    exp1 += exportAfter;

    tl.push({
      t:p.t,
      import0: importKwh,
      export0: -exportKwh,
      import1: importAfter,
      export1: -exportAfter,
      soc
    });
  }

  return { imp0, exp0, imp1, exp1, timeline: tl };
}

function simulateArbitrageHeuristic(netSeries, cfg, tariff){
  const { capKwh, pmaxKw, rte, soc0, socMin, priorityExport } = cfg;
  const { markup, feedIn } = tariff;
  const maxKwh = pmaxKw;
  const effCh = Math.sqrt(rte);
  const effDis = Math.sqrt(rte);
  const socMinKwh = clamp(socMin,0,1) * capKwh;

  const pts = netSeries.map(p=>({ ...p, price: priceAtHourStart(p.t) })).filter(p=>p.price != null);
  if (!pts.length) return { cost: NaN, timeline: [], missingHours: netSeries.length };

  const prices = pts.map(p=>p.price).slice().sort((a,b)=>a-b);
  const q = p => prices[Math.floor((prices.length - 1) * p)];
  const cheap = q(0.30);
  const expensive = q(0.70);

  let soc = clamp(soc0,0,1) * capKwh;
  let cost = 0;
  const tl = [];

  for (const p of pts){
    const priceEff = p.price + markup;
    let grid = p.kwh;

    if (priorityExport && grid < 0 && soc < capKwh){
      const headroom = capKwh - soc;
      const absorb = Math.min(maxKwh, -grid, headroom / effCh);
      soc += absorb * effCh;
      grid += absorb;
    }

    if (p.price >= expensive && grid > 0 && soc > socMinKwh){
      const canDis = Math.min(maxKwh, soc - socMinKwh);
      const delivered = canDis * effDis;
      const used = Math.min(delivered, grid);
      grid -= used;
      soc -= used / effDis;
    }

    if (p.price <= cheap && soc < capKwh){
      const headroom = capKwh - soc;
      const fromGrid = Math.min(maxKwh, headroom / effCh);
      soc += fromGrid * effCh;
      grid += fromGrid;
    }

    const stepCost = (grid >= 0) ? grid * priceEff : (-grid) * (-feedIn);
    cost += stepCost;

    tl.push({
      t:p.t,
      import0: Math.max(0, p.kwh),
      export0: -Math.max(0, -p.kwh),
      import1: Math.max(0, grid),
      export1: -Math.max(0, -grid),
      soc
    });
  }

  return { cost, timeline: tl, missingHours: netSeries.length - pts.length };
}

function optimizeBatteryDP(netLoad, price, cfg, opt){
  const { capKwh, pmaxKw, rte, soc0, socMin, priorityExport } = cfg;
  const { markup, feedIn } = opt;
  const effCh = Math.sqrt(rte);
  const effDis = Math.sqrt(rte);
  const maxA = Math.max(0, pmaxKw);
  const T = netLoad.length;
  if (!T) return { grid:[], soc:[], action:[], cost:0 };

  const socMinKwh = clamp(socMin,0,1) * capKwh;
  const soc0Kwh = clamp(soc0,0,1) * capKwh;

  const socStep = Math.max(0.25, capKwh / 80);
  const nS = Math.max(2, Math.floor(capKwh / socStep) + 1);

  const aStep = Math.max(0.25, maxA / 10, socStep);
  const actions = [];
  if (maxA <= 0) {
    actions.push(0);
  } else {
    for (let a = -maxA; a <= maxA + 1e-9; a += aStep){
      actions.push(Math.round(a / aStep) * aStep);
    }
    if (actions[0] > -maxA) actions.unshift(-maxA);
    if (actions[actions.length-1] < maxA) actions.push(maxA);
  }

  function idxFromSoc(s){
    return Math.max(0, Math.min(nS-1, Math.round(clamp(s,0,capKwh) / socStep)));
  }
  function socFromIdx(i){ return i * socStep; }

  let Vnext = new Float64Array(nS);
  let Vcur = new Float64Array(nS);
  const policy = new Int16Array(T * nS);

  for (let t=T-1; t>=0; t--){
    const pr = price[t];
    for (let si=0; si<nS; si++){
      const soc = socFromIdx(si);
      let best = Number.POSITIVE_INFINITY;
      let bestAi = 0;

      for (let ai=0; ai<actions.length; ai++){
        let a = actions[ai];

        if (priorityExport && netLoad[t] < 0 && a > -netLoad[t]){
          a = -netLoad[t];
        }

        let soc2 = soc;
        if (a >= 0) soc2 = soc + a * effCh;
        else soc2 = soc + a / effDis;

        if (soc2 < socMinKwh - 1e-9 || soc2 > capKwh + 1e-9) continue;

        const s2i = idxFromSoc(soc2);
        const grid = netLoad[t] + a;
        const stepCost = (grid >= 0) ? grid * (pr + markup) : (-grid) * (-feedIn);
        const total = stepCost + Vnext[s2i];

        if (total < best){
          best = total;
          bestAi = ai;
        }
      }

      Vcur[si] = best;
      policy[t*nS + si] = bestAi;
    }
    const tmp = Vnext; Vnext = Vcur; Vcur = tmp;
  }

  let soc = soc0Kwh;
  let cost = 0;
  const outGrid = new Array(T);
  const outSoc = new Array(T);
  const outAct = new Array(T);

  for (let t=0; t<T; t++){
    const si = idxFromSoc(soc);
    let a = actions[policy[t*nS + si]];

    if (priorityExport && netLoad[t] < 0 && a > -netLoad[t]){
      a = -netLoad[t];
    }

    let soc2 = soc;
    if (a >= 0) soc2 = soc + a * effCh;
    else soc2 = soc + a / effDis;
    soc2 = clamp(soc2, socMinKwh, capKwh);

    const grid = netLoad[t] + a;
    const stepCost = (grid >= 0) ? grid * (price[t] + markup) : (-grid) * (-feedIn);
    cost += stepCost;

    outGrid[t] = grid;
    outSoc[t] = soc2;
    outAct[t] = a;
    soc = soc2;
  }

  return { grid: outGrid, soc: outSoc, action: outAct, cost };
}

function optimizeBatteryRolling(netLoad, price, cfg, opt, windowH){
  const T = netLoad.length;
  if (!T) return { grid:[], soc:[], action:[], cost:0 };

  const effCh = Math.sqrt(cfg.rte);
  const effDis = Math.sqrt(cfg.rte);
  let soc = clamp(cfg.soc0,0,1) * cfg.capKwh;
  const socMinKwh = clamp(cfg.socMin,0,1) * cfg.capKwh;

  const outGrid = new Array(T);
  const outSoc = new Array(T);
  const outAct = new Array(T);
  let totalCost = 0;

  for (let t=0; t<T; t++){
    const end = Math.min(T, t + Math.max(1, windowH|0));
    const res = optimizeBatteryDP(
      netLoad.slice(t, end),
      price.slice(t, end),
      { ...cfg, soc0: soc / Math.max(1e-9, cfg.capKwh) },
      opt
    );

    let a = res.action[0] ?? 0;
    if (cfg.priorityExport && netLoad[t] < 0 && a > -netLoad[t]){
      a = -netLoad[t];
    }

    let soc2 = soc;
    if (a >= 0) soc2 = soc + a * effCh;
    else soc2 = soc + a / effDis;
    soc2 = clamp(soc2, socMinKwh, cfg.capKwh);

    const grid = netLoad[t] + a;
    const stepCost = (grid >= 0) ? grid * (price[t] + opt.markup) : (-grid) * (-opt.feedIn);
    totalCost += stepCost;

    outGrid[t] = grid;
    outSoc[t] = soc2;
    outAct[t] = a;
    soc = soc2;
  }

  return { grid: outGrid, soc: outSoc, action: outAct, cost: totalCost };
}

// ---------- simulation wrapper ----------
function runSimulationFor(capKwh, pmaxKw){
  const all = buildHourlyAll();
  const { imp, exp, net } = buildSeriesForCosts(all);

  const fixedImport = Number(el.fixedPrice.value) || 0;
  const fixedFeedIn = Number(el.feedInFixed.value) || 0;
  const markup = Number(el.dynMarkup.value) || 0;
  const feedInDyn = Number(el.feedInDyn.value) || 0;

  const cfg = {
    capKwh,
    pmaxKw,
    rte: clamp(Number(el.rte.value), 0.2, 1.0),
    soc0: clamp(Number(el.soc0.value), 0, 1),
    socMin: clamp(Number(el.socMin.value), 0, 1),
    priorityExport: !!el.priorityExport.checked
  };

  const imp0 = imp.reduce((s,p)=>s+p.kwh,0);
  const exp0 = exp.reduce((s,p)=>s+p.kwh,0);

  const fixed0 = costFixedTotal(imp0, exp0, fixedImport, fixedFeedIn);
  const dyn0 = dynPrices ? costDynamicSeries(imp, exp, markup, feedInDyn) : null;

  const self = simulateSelfConsumption(all, cfg);
  const fixed1 = costFixedTotal(self.imp1, self.exp1, fixedImport, fixedFeedIn);

  let dyn1Cost = null;
  let dynMissing = null;
  let timeline = self.timeline;

  if (dynPrices){
    if (el.optForecast.checked){
      const netLoad = [];
      const price = [];
      const tArr = [];
      let missing = 0;

      for (const p of net){
        const pr = priceAtHourStart(p.t);
        if (pr == null){
          missing++;
          continue;
        }
        netLoad.push(p.kwh);
        price.push(pr);
        tArr.push(p.t);
      }

      const opt = { markup, feedIn: feedInDyn };
      let res;
      if (el.optMode.value === "window"){
        const wh = Math.max(1, Number(el.optWindowH.value) || 24);
        res = optimizeBatteryRolling(netLoad, price, cfg, opt, wh);
      } else {
        res = optimizeBatteryDP(netLoad, price, cfg, opt);
      }

      dyn1Cost = res.cost;
      dynMissing = missing;

      timeline = tArr.map((t, i) => ({
        t,
        import0: Math.max(0, netLoad[i]),
        export0: -Math.max(0, -netLoad[i]),
        import1: Math.max(0, res.grid[i]),
        export1: -Math.max(0, -res.grid[i]),
        soc: res.soc[i]
      }));
    } else if (el.batMode.value === "arb"){
      const arb = simulateArbitrageHeuristic(net, cfg, { markup, feedIn: feedInDyn });
      dyn1Cost = arb.cost;
      dynMissing = arb.missingHours;
      timeline = arb.timeline;
    } else {
      const imp1 = self.timeline.map(p=>({t:p.t,kwh:p.import1}));
      const exp1 = self.timeline.map(p=>({t:p.t,kwh:-p.export1}));
      const dyn1 = costDynamicSeries(imp1, exp1, markup, feedInDyn);
      dyn1Cost = dyn1.cost;
      dynMissing = dyn1.missingHours;
      timeline = self.timeline;
    }
  }

  return {
    fixed0, fixed1,
    dyn0Cost: dyn0 ? dyn0.cost : null,
    dyn1Cost,
    dynMissing,
    timeline
  };
}

// ---------- knee ----------
function kneePoint(caps, values){
  const valid = values.map(v => Number.isFinite(v) ? v : NaN);
  const slopes = [];
  for (let i=1;i<valid.length;i++){
    if (!Number.isFinite(valid[i-1]) || !Number.isFinite(valid[i])) slopes.push(NaN);
    else slopes.push(valid[i] - valid[i-1]);
  }
  const finiteSlopes = slopes.filter(v => Number.isFinite(v));
  if (!finiteSlopes.length) return null;
  const maxSlope = Math.max(...finiteSlopes);
  const threshold = maxSlope * 0.15;
  for (let i=0;i<slopes.length;i++){
    if (Number.isFinite(slopes[i]) && slopes[i] < threshold) return caps[i];
  }
  return caps[caps.length - 1];
}

// ---------- chart2 render: one shared zero line ----------
function renderOutputGraph(timeline){
  const agg = el.agg.value;
  const tl = aggregateSeries(timeline, agg);

  Plotly.newPlot("chart2", [
    {
      x: tl.map(p => new Date(p.t)),
      y: tl.map(p => p.import0 ?? 0),
      type: "scatter",
      mode: "lines",
      name: "Import vóór"
    },
    {
      x: tl.map(p => new Date(p.t)),
      y: tl.map(p => p.import1 ?? 0),
      type: "scatter",
      mode: "lines",
      name: "Import na"
    },
    {
      x: tl.map(p => new Date(p.t)),
      y: tl.map(p => p.export0 ?? 0),
      type: "scatter",
      mode: "lines",
      name: "Export vóór"
    },
    {
      x: tl.map(p => new Date(p.t)),
      y: tl.map(p => p.export1 ?? 0),
      type: "scatter",
      mode: "lines",
      name: "Export na"
    },
    {
      x: tl.map(p => new Date(p.t)),
      y: tl.map(p => p.soc ?? 0),
      type: "scatter",
      mode: "lines",
      name: "SoC"
    }
  ], {
    margin: { t: 10, r: 10, b: 40, l: 55 },
    xaxis: { title: "Tijd" },
    yaxis: {
      title: "Import / Export / SoC",
      zeroline: true,
      zerolinewidth: 2
    },
    hovermode: "x unified",
    legend: { orientation: "h" }
  }, { responsive: true });
}


// ---------- battery metrics / heatmap / peak chart ----------
function computeBatteryMetrics(timeline, capKwh, cycleLife){
  if (!timeline || !timeline.length || !(capKwh > 0)) {
    return {
      throughput:0, cycles:0, cyclesYear:0, lifetimeYears:null,
      peakBefore:0, peakAfter:0, peakReduction:0
    };
  }

  let throughput = 0;
  let peakBefore = 0;
  let peakAfter = 0;

  let prevSoc = Number(timeline[0].soc || 0);
  for (let i=1; i<timeline.length; i++){
    const soc = Number(timeline[i].soc || 0);
    throughput += Math.abs(soc - prevSoc);
    prevSoc = soc;
  }

  for (const p of timeline){
    peakBefore = Math.max(peakBefore, Number(p.import0 || 0));
    peakAfter = Math.max(peakAfter, Number(p.import1 || 0));
  }

  const cycles = throughput / (2 * capKwh);
  const cyclesYear = cycles * scaleToYear();
  const lifetimeYears = cyclesYear > 0 ? cycleLife / cyclesYear : null;

  return {
    throughput,
    cycles,
    cyclesYear,
    lifetimeYears,
    peakBefore,
    peakAfter,
    peakReduction: peakBefore - peakAfter
  };
}

function renderBatteryHeatmap(timeline){
  const chartId = "heatmapChart";
  if (!document.getElementById(chartId)) return;
  if (!timeline || !timeline.length){
    Plotly.newPlot(chartId, [], {}, {responsive:true});
    return;
  }

  const tz = el.tz.value;
  const dayOrder = [];
  const dayMap = new Map();

  // Pre-create all days in full period to ensure complete span
  if (el.from.value && el.to.value){
    let d = DateTime.fromISO(el.from.value, {zone:tz}).startOf("day");
    const end = DateTime.fromISO(el.to.value, {zone:tz}).startOf("day");
    while (d <= end){
      const key = d.toISODate();
      if (!dayMap.has(key)){
        dayMap.set(key, new Array(24).fill(0));
        dayOrder.push(key);
      }
      d = d.plus({days:1});
    }
  }

  let prevSoc = Number(timeline[0].soc || 0);
  for (let i=0; i<timeline.length; i++){
    const p = timeline[i];
    const dt = DateTime.fromMillis(p.t, {zone:tz});
    const day = dt.toISODate();
    const hour = dt.hour;

    if (!dayMap.has(day)){
      dayMap.set(day, new Array(24).fill(0));
      dayOrder.push(day);
    }

    const soc = Number(p.soc || 0);
    // charge = negative (blue), discharge = positive (red)
    const flow = i === 0 ? 0 : (prevSoc - soc);
    dayMap.get(day)[hour] = flow;
    prevSoc = soc;
  }

  const x = dayOrder;
  const y = Array.from({length:24}, (_,i)=>i);
  const z = y.map(h => x.map(day => (dayMap.get(day)?.[h] ?? 0)));

  Plotly.newPlot(chartId, [{
    x, y, z,
    type:"heatmap",
    zmid:0,
    colorscale:[[0,"#1d4ed8"],[0.5,"#ffffff"],[1,"#dc2626"]],
    hovertemplate:"%{x}<br>Hour %{y}:00<br>Battery %{z:.2f} kWh<extra></extra>"
  }], {
    margin:{t:10,r:10,b:40,l:55},
    xaxis:{title:"Day"},
    yaxis:{title:"Hour of day"}
  }, {responsive:true});
}

function renderPeakChart(timeline){
  const chartId = "peakChart";
  if (!document.getElementById(chartId)) return;
  if (!timeline || !timeline.length){
    Plotly.newPlot(chartId, [], {}, {responsive:true});
    return;
  }

  const pts = aggregateSeries(
    timeline.map(p => ({ t:p.t, before:Number(p.import0||0), after:Number(p.import1||0) })),
    el.agg.value
  );

  Plotly.newPlot(chartId, [
    {
      x: pts.map(p => new Date(p.t)),
      y: pts.map(p => p.before || 0),
      type:"scatter",
      mode:"lines",
      name:"Grid before"
    },
    {
      x: pts.map(p => new Date(p.t)),
      y: pts.map(p => p.after || 0),
      type:"scatter",
      mode:"lines",
      name:"Grid after"
    }
  ], {
    margin:{t:10,r:10,b:40,l:55},
    xaxis:{title:"Tijd"},
    yaxis:{title:"kW ≈ kWh/u"},
    hovermode:"x unified",
    legend:{orientation:"h"}
  }, {responsive:true});
}

function updateGridCost(peakAfter){
  const out = document.getElementById("gridCost");
  if (!out) return;
  const tariff = Number(el.gridTariff?.value) || 0;
  const months = 12 / Math.max(1e-9, scaleToYear());
  out.textContent = euro(peakAfter * tariff * months);
}

// ---------- main render ----------
function render(){
  if (!consRows.length) return;

  updatePriceUrl();

  const all = buildHourlyAll();
  const range = computeFullRange(all);

  if (range){
    const fromEmpty = !el.from.value;
    const toEmpty = !el.to.value;
    const outOfRange =
      (el.from.value && (el.from.value < range.minDate || el.from.value > range.maxDate)) ||
      (el.to.value && (el.to.value < range.minDate || el.to.value > range.maxDate));
    if (fromEmpty || toEmpty || outOfRange){
      el.from.value = range.minDate;
      el.to.value = range.maxDate;
      updatePriceUrl();
    }
  }

  const filtered = all.filter(p=>inRange(p.t));
  if (!filtered.length){
    Plotly.newPlot("chart", [], {}, {responsive:true});
    return;
  }

  const agg = el.agg.value;
  let mainSeries;
  if (agg === "raw"){
    mainSeries = filtered.map(p => ({ t:p.t, y:pickYMain(p) }));
  } else {
    const m = new Map();
    for (const p of filtered){
      const dt = DateTime.fromMillis(p.t, {zone:el.tz.value});
      const k = groupKey(dt, agg);
      m.set(k, (m.get(k)||0) + pickYMain(p));
    }
    const keys = Array.from(m.keys()).sort();
    mainSeries = keys.map(k => ({ t:keyToMillis(k, agg), y:m.get(k) }));
  }

  el.kpiEnergy.textContent = mainSeries.reduce((s,p)=>s+(p.y||0),0).toFixed(2);
  el.kpiPeak.textContent = Math.max(...filtered.map(p=>pickYMain(p))).toFixed(2);

  Plotly.newPlot("chart", [{
    x: mainSeries.map(p=>new Date(p.t)),
    y: mainSeries.map(p=>p.y),
    type: agg === "raw" ? "scatter" : "bar",
    mode: agg === "raw" ? "lines" : undefined,
    hovertemplate: "%{x}<br>kWh: %{y:.3f}<extra></extra>"
  }], {
    margin:{t:10,r:10,b:40,l:55},
    xaxis:{title:"Tijd"},
    yaxis:{title:"kWh (export negatief)"},
    hovermode:"x unified"
  }, {responsive:true});

  el.kpiCycles.textContent = "—";
  el.kpiCyclesYear.textContent = "—";
  el.kpiLifetime.textContent = "—";
  el.kpiPeakReduction.textContent = "—";
  el.kpiNoBatFixed.textContent = "—";
  el.kpiNoBatDyn.textContent = "—";
  el.kpiWithBatFixed.textContent = "—";
  el.kpiWithBatDyn.textContent = "—";
  const gridCostEl = document.getElementById("gridCost");
  if (gridCostEl) gridCostEl.textContent = "—";
  Plotly.newPlot("chart2", [], {}, {responsive:true});
  if (document.getElementById("heatmapChart")) Plotly.newPlot("heatmapChart", [], {}, {responsive:true});
  if (document.getElementById("peakChart")) Plotly.newPlot("peakChart", [], {}, {responsive:true});
  Plotly.newPlot("savingsChart", [], {}, {responsive:true});
  Plotly.newPlot("roiChart", [], {}, {responsive:true});
  Plotly.newPlot("powerChart", [], {}, {responsive:true});
  el.notes.textContent = "";
  el.sweepInfo.textContent = "";
  lastRecommended = null;
  el.applyRecommended.disabled = true;
  el.generatePdfBtn.disabled = false;
  setProgress(0, "");
  el.runSim.disabled = false;
  el.runSweep.disabled = false;
}

// ---------- single simulation ----------
function renderSingleSimulation(){
  const cap = Math.max(0, Number(el.cap.value) || 0);
  const pmax = Math.max(0, Number(el.pmax.value) || 0);

  const r = runSimulationFor(cap, pmax);

  el.kpiNoBatFixed.textContent = euro(r.fixed0);
  el.kpiWithBatFixed.textContent = euro(r.fixed1);
  el.kpiNoBatDyn.textContent = r.dyn0Cost != null ? euro(r.dyn0Cost) : "—";
  el.kpiWithBatDyn.textContent = r.dyn1Cost != null ? euro(r.dyn1Cost) : "—";

  const metrics = computeBatteryMetrics(r.timeline, cap, Number(el.cycleLife?.value) || 6000);
  el.kpiCycles.textContent = metrics.cycles.toFixed(2);
  el.kpiCyclesYear.textContent = metrics.cyclesYear.toFixed(1);
  el.kpiLifetime.textContent = metrics.lifetimeYears != null ? `${metrics.lifetimeYears.toFixed(1)} years` : "—";
  el.kpiPeakReduction.textContent = `${metrics.peakReduction.toFixed(2)} kW`;
  updateGridCost(metrics.peakAfter);

  renderOutputGraph(r.timeline);
  renderBatteryHeatmap(r.timeline);
  renderPeakChart(r.timeline);

  el.notes.innerHTML = `
    <div class="small">
      Configuratie: <b>${cap} kWh</b> · <b>${pmax} kW</b><br>
      Cycles: <b>${metrics.cycles.toFixed(2)}</b> · Cycles/year: <b>${metrics.cyclesYear.toFixed(1)}</b><br>
      Lifetime: <b>${metrics.lifetimeYears != null ? metrics.lifetimeYears.toFixed(1) + " years" : "—"}</b><br>
      Peak before: <b>${metrics.peakBefore.toFixed(2)} kW</b> · peak after: <b>${metrics.peakAfter.toFixed(2)} kW</b> · reduction: <b>${metrics.peakReduction.toFixed(2)} kW</b><br>
      ${r.dynMissing ? `<span class="warn">Ontbrekende prijs-uren: ${r.dynMissing}</span>` : ""}
    </div>
  `;
}

// ---------- sweep ----------
async function runSweepAndRecommend(){
  const maxCap = Math.max(0, Number(el.sweepMaxCap.value) || 0);
  const stepCap = Math.max(0.5, Number(el.sweepStepCap.value) || 1);
  const maxKw = Math.max(0, Number(el.sweepMaxKw.value) || 0);
  const stepKw = Math.max(0.5, Number(el.sweepStepKw.value) || 1);
  const autoObj = el.autoObj.value;
  const scaleYear = scaleToYear();

  const caps = [];
  for (let c=0;c<=maxCap + 1e-9;c+=stepCap) caps.push(Math.round(c/stepCap)*stepCap);
  const pows = [];
  for (let p=0;p<=maxKw + 1e-9;p+=stepKw) pows.push(Math.round(p/stepKw)*stepKw);

  if (!caps.length || !pows.length) return;

  const baseline = runSimulationFor(0, 0);
  const baseFix = baseline.fixed0;
  const baseDyn = baseline.dyn0Cost;

  const bestSavingsFix = [];
  const bestSavingsDyn = [];
  const bestRoiFix = [];
  const bestRoiDyn = [];
  const bestPowerFix = [];
  const bestPowerDyn = [];

  let bestOverall = null;
  const total = caps.length * pows.length;
  let done = 0;

  for (const cap of caps){
    let bestFix = { savings:-Infinity, roi:null, pmax:null };
    let bestDyn = { savings:-Infinity, roi:null, pmax:null };

    for (const pmax of pows){
      const r = runSimulationFor(cap, pmax);
      const cost = batteryCostEUR(cap);

      const saveFix = baseFix - r.fixed1;
      const annualFix = saveFix * scaleYear;
      const roiFix = annualFix > 0 ? cost / annualFix : null;

      if (saveFix > bestFix.savings){
        bestFix = { savings: saveFix, roi: roiFix, pmax };
      }

      if (dynPrices && baseDyn != null && r.dyn1Cost != null){
        const saveDyn = baseDyn - r.dyn1Cost;
        const annualDyn = saveDyn * scaleYear;
        const roiDyn = annualDyn > 0 ? cost / annualDyn : null;

        if (saveDyn > bestDyn.savings){
          bestDyn = { savings: saveDyn, roi: roiDyn, pmax };
        }
      }

      done++;
      setProgress(done / total * 100, `Sweep ${done}/${total}`);
      if (done % 4 === 0) await yieldToUI();
    }

    bestSavingsFix.push(bestFix.savings);
    bestRoiFix.push(bestFix.roi);
    bestPowerFix.push(bestFix.pmax);

    if (dynPrices){
      bestSavingsDyn.push(bestDyn.savings);
      bestRoiDyn.push(bestDyn.roi);
      bestPowerDyn.push(bestDyn.pmax);
    } else {
      bestSavingsDyn.push(null);
      bestRoiDyn.push(null);
      bestPowerDyn.push(null);
    }

    let candidate = null;
    if (autoObj === "roi_fix" && bestFix.roi != null) candidate = { score: -bestFix.roi, cap, pmax: bestFix.pmax };
    if (autoObj === "save_fix") candidate = { score: bestFix.savings, cap, pmax: bestFix.pmax };
    if (autoObj === "roi_dyn" && bestDyn.roi != null) candidate = { score: -bestDyn.roi, cap, pmax: bestDyn.pmax };
    if (autoObj === "save_dyn" && dynPrices && bestDyn.savings != null) candidate = { score: bestDyn.savings, cap, pmax: bestDyn.pmax };

    if (candidate && (!bestOverall || candidate.score > bestOverall.score)){
      bestOverall = candidate;
    }
  }

  if (autoObj === "knee"){
    const source = dynPrices ? bestSavingsDyn : bestSavingsFix;
    const kCap = kneePoint(caps, source);
    if (kCap != null){
      const idx = caps.findIndex(c => c === kCap);
      bestOverall = {
        score: 0,
        cap: kCap,
        pmax: dynPrices ? bestPowerDyn[idx] : bestPowerFix[idx]
      };
    }
  }

  Plotly.newPlot("savingsChart", [
    { x:caps, y:bestSavingsFix, type:"scatter", mode:"lines+markers", name:"Savings fixed" },
    ...(dynPrices ? [{ x:caps, y:bestSavingsDyn, type:"scatter", mode:"lines+markers", name:"Savings dynamic" }] : [])
  ], {
    margin:{t:10,r:10,b:40,l:55},
    xaxis:{title:"Capacity (kWh)"},
    yaxis:{title:"Savings (€)"},
    hovermode:"x unified"
  }, {responsive:true});

  Plotly.newPlot("roiChart", [
    { x:caps, y:bestRoiFix, type:"scatter", mode:"lines+markers", name:"ROI fixed" },
    ...(dynPrices ? [{ x:caps, y:bestRoiDyn, type:"scatter", mode:"lines+markers", name:"ROI dynamic" }] : [])
  ], {
    margin:{t:10,r:10,b:40,l:55},
    xaxis:{title:"Capacity (kWh)"},
    yaxis:{title:"ROI (years)"},
    hovermode:"x unified"
  }, {responsive:true});

  Plotly.newPlot("powerChart", [
    { x:caps, y:bestPowerFix, type:"scatter", mode:"lines+markers", name:"Best power fixed" },
    ...(dynPrices ? [{ x:caps, y:bestPowerDyn, type:"scatter", mode:"lines+markers", name:"Best power dynamic" }] : [])
  ], {
    margin:{t:10,r:10,b:40,l:55},
    xaxis:{title:"Capacity (kWh)"},
    yaxis:{title:"Power (kW)"},
    hovermode:"x unified"
  }, {responsive:true});

  if (!bestOverall){
    lastRecommended = null;
    el.applyRecommended.disabled = true;
    el.sweepInfo.textContent = "Geen recommendation gevonden.";
    return;
  }

  const rec = runSimulationFor(bestOverall.cap, bestOverall.pmax);
  const cost = batteryCostEUR(bestOverall.cap);
  const saveFix = rec.fixed0 - rec.fixed1;
  const annualFix = saveFix * scaleYear;
  const roiFix = annualFix > 0 ? cost / annualFix : null;

  let saveDyn = null, annualDyn = null, roiDyn = null;
  if (rec.dyn0Cost != null && rec.dyn1Cost != null){
    saveDyn = rec.dyn0Cost - rec.dyn1Cost;
    annualDyn = saveDyn * scaleYear;
    roiDyn = annualDyn > 0 ? cost / annualDyn : null;
  }

  lastRecommended = {
    cap: bestOverall.cap,
    pmax: bestOverall.pmax,
    fix: { savings: saveFix, annual: annualFix, roi: roiFix },
    dyn: { savings: saveDyn, annual: annualDyn, roi: roiDyn }
  };

  el.applyRecommended.disabled = false;
  setProgress(100, "Sweep klaar");

  el.sweepInfo.innerHTML = `
    Recommended: <b>${bestOverall.cap} kWh</b> · <b>${bestOverall.pmax} kW</b><br>
    Objective: <span class="mono">${escapeHtml(autoObj)}</span>
  `;

  el.notes.innerHTML = `
    <div class="small">
      <b>Recommended</b>: ${bestOverall.cap} kWh · ${bestOverall.pmax} kW<br>
      Batterijkosten: <b>${euro(cost)}</b><br><br>
      <b>Fixed</b> — savings: ${euro(saveFix)} · annual: ${euro(annualFix)} · ROI: <b>${roiFix != null ? roiFix.toFixed(1) + " years" : "—"}</b><br>
      <b>Dynamic</b> — savings: ${saveDyn != null ? euro(saveDyn) : "—"} · annual: ${annualDyn != null ? euro(annualDyn) : "—"} · ROI: <b>${roiDyn != null ? roiDyn.toFixed(1) + " years" : "—"}</b>
      ${rec.dynMissing ? `<br><span class="warn">Missing price hours: ${rec.dynMissing}</span>` : ""}
    </div>
  `;
}

// ---------- PDF report ----------
function fillPdfReport() {
  document.getElementById("reportPeriod").textContent =
    `${el.from.value || "—"} → ${el.to.value || "—"}`;

  document.getElementById("reportMode").textContent =
    el.batMode.value === "self" ? "Zelfconsumptie" : "Dynamisch arbitrage";

  document.getElementById("reportPriorityExport").textContent =
    el.priorityExport.checked ? "Ja" : "Nee";

  document.getElementById("reportForecast").textContent =
    el.optForecast.checked ? "Ja" : "Nee";

  document.getElementById("reportFixedNoBat").textContent =
    el.kpiNoBatFixed.textContent || "—";

  document.getElementById("reportFixedBat").textContent =
    el.kpiWithBatFixed.textContent || "—";

  document.getElementById("reportDynNoBat").textContent =
    el.kpiNoBatDyn.textContent || "—";

  document.getElementById("reportDynBat").textContent =
    el.kpiWithBatDyn.textContent || "—";

  if (lastRecommended) {
    document.getElementById("reportRecCap").textContent = `${lastRecommended.cap} kWh`;
    document.getElementById("reportRecPower").textContent = `${lastRecommended.pmax} kW`;
    document.getElementById("reportRecCost").textContent = euro(batteryCostEUR(lastRecommended.cap));
    document.getElementById("reportRecRoiFix").textContent =
      lastRecommended.fix?.roi != null ? `${lastRecommended.fix.roi.toFixed(1)} years` : "—";
    document.getElementById("reportRecRoiDyn").textContent =
      lastRecommended.dyn?.roi != null ? `${lastRecommended.dyn.roi.toFixed(1)} years` : "—";
  } else {
    document.getElementById("reportRecCap").textContent = "—";
    document.getElementById("reportRecPower").textContent = "—";
    document.getElementById("reportRecCost").textContent = "—";
    document.getElementById("reportRecRoiFix").textContent = "—";
    document.getElementById("reportRecRoiDyn").textContent = "—";
  }

  document.getElementById("reportNotes").innerHTML =
    `<div><b>Cycles:</b> ${el.kpiCycles?.textContent || "—"}<br><b>Cycles/year:</b> ${el.kpiCyclesYear?.textContent || "—"}<br><b>Lifetime:</b> ${el.kpiLifetime?.textContent || "—"}<br><b>Peak shaving:</b> ${el.kpiPeakReduction?.textContent || "—"}<br><b>Grid cost estimate:</b> ${(document.getElementById("gridCost")?.textContent) || "—"}</div><br>` + (el.notes.innerHTML || "—");
}

function generatePdfReport() {
  fillPdfReport();

  const report = document.getElementById("pdfReport");
  const app = document.querySelector(".wrap");
  const header = document.querySelector("header");

  // Make report visible before calling print
  report.style.display = "block";
  app.style.display = "none";
  header.style.display = "none";

  setTimeout(() => {
    window.print();

    // Restore UI after print dialog closes or is dismissed
    setTimeout(() => {
      report.style.display = "none";
      app.style.display = "";
      header.style.display = "";
    }, 500);
  }, 100);
}


// ---------- events ----------
el.consFile.addEventListener("change", () => {
  const f = el.consFile.files?.[0];
  if (!f) return;

  consRows = [];
  consCols = [];
  hourlyAllCache = null;

  Papa.parse(f, {
    header:true,
    skipEmptyLines:true,
    complete:(res)=>{
      consRows = res.data || [];
      consCols = res.meta.fields || Object.keys(consRows[0]||{});
      if (!consCols.length){
        alert("Geen kolommen gevonden in CSV.");
        return;
      }

      fillSelect(el.colDate, consCols, consCols.includes("Datum") ? "Datum" : consCols[0]);
      fillSelect(el.colValue, consCols, consCols.includes("Verbruik") ? "Verbruik" : (consCols[1]||consCols[0]));
      fillSelect(el.colType, consCols, consCols.includes("Type") ? "Type" : (consCols[2]||consCols[0]));
      fillSelect(el.colTariff, consCols, consCols.includes("Tarief") ? "Tarief" : (consCols[3]||consCols[0]));

      const hasEAN = consCols.includes("EAN");
      const eans = hasEAN
        ? Array.from(new Set(consRows.map(r => r["EAN"]).filter(v=>v!=null).map(v=>String(v)))).sort()
        : [];
      el.ean.innerHTML = `<option value="">(alle)</option>` + eans.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join("");
      if (!hasEAN) el.ean.innerHTML = `<option value="">(geen EAN kolom)</option>`;

      el.from.value = "";
      el.to.value = "";
      render();
    }
  });
});

["colDate","colValue","colType","colTariff","tz","agg","from","to","series","ean","bzn"].forEach(id => {
  el[id].addEventListener("change", () => {
    hourlyAllCache = null;
    updatePriceUrl();
    render();
  });
});

el.copyUrl.addEventListener("click", async () => {
  const url = buildEnergyChartsUrl();
  if (!url){
    alert("Kies eerst Van/Tot.");
    return;
  }
  try{
    await navigator.clipboard.writeText(url);
    setPriceInfo("Link gekopieerd ✅", "ok");
  } catch {
    prompt("Copy this URL:", url);
  }
});

el.priceFile.addEventListener("change", async () => {
  const f = el.priceFile.files?.[0];
  if (!f) return;

  try{
    const { map, unit, scale } = await loadEnergyChartsJson(f);
    dynPrices = map;

    const all = buildHourlyAll();
    const hours = all.filter(p=>inRange(p.t));
    let have = 0;
    for (const p of hours){
      if (priceAtHourStart(p.t) != null) have++;
    }

    setPriceInfo(`Prijsbestand geladen ✅ ${dynPrices.size} uurprijzen. Unit: ${unit || "(onbekend)"}; schaal: ${scale}. Dekking: ${have}/${hours.length} uur.`, "ok");
  } catch(e){
    dynPrices = null;
    setPriceInfo(`Prijsbestand fout: ${e.message}`, "bad");
  }
});

el.runSim.addEventListener("click", () => {
  if (!consRows.length){
    alert("Upload eerst een verbruik CSV.");
    return;
  }
  if (el.optForecast.checked && !dynPrices){
    alert("Forecast optimisation vereist een prijs JSON.");
    return;
  }
  renderSingleSimulation();
});

el.runSweep.addEventListener("click", async () => {
  if (!consRows.length){
    alert("Upload eerst een verbruik CSV.");
    return;
  }
  await runSweepAndRecommend();
});

el.applyRecommended.addEventListener("click", () => {
  if (!lastRecommended) return;
  el.cap.value = lastRecommended.cap;
  el.pmax.value = lastRecommended.pmax;
  renderSingleSimulation();
});

el.generatePdfBtn.addEventListener("click", generatePdfReport);



// init
updatePriceUrl();
setProgress(0, "");
