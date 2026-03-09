
// ---------- monthly peak-aware optimisation ----------
function getMonthKeyFromMs(ms){
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function calculateMonthlyPeakMap(timeline){
  const months = {};
  for (const p of (timeline || [])){
    const key = getMonthKeyFromMs(p.t);
    const grid = Number(p.import1 !== undefined ? p.import1 : Math.max(0, p.import || 0));
    if (!months[key] || grid > months[key]) months[key] = grid;
  }
  return months;
}

function calculateMonthlyPeakCostFromMap(monthMap, tariffPerKwMonth){
  let cost = 0;
  for (const k in monthMap) cost += monthMap[k] * tariffPerKwMonth;
  return cost;
}

function calculateMonthlyPeakCost(timeline, tariffPerKwMonth){
  return calculateMonthlyPeakCostFromMap(calculateMonthlyPeakMap(timeline), tariffPerKwMonth);
}

function simulateMonthlyPeakShaving(all, cfg){
  const peak = simulatePeakShaving(all, cfg);
  const tariff = Number(el.gridTariff.value) || 0;
  peak.monthlyPeakMap = calculateMonthlyPeakMap(peak.timeline);
  peak.monthlyPeakCost = calculateMonthlyPeakCostFromMap(peak.monthlyPeakMap, tariff);
  return peak;
}



// ---------- monthly peak tariff model ----------
function calculateMonthlyPeakCost(timeline, tariffPerKwMonth){
  const months={};
  for(const p of timeline){
    const d=new Date(p.t);
    const key=d.getFullYear()+"-"+(d.getMonth()+1);
    const grid=p.import1!==undefined?p.import1:Math.max(0,p.import||0);
    if(!months[key] || grid>months[key]) months[key]=grid;
  }
  let cost=0;
  for(const m in months){
    cost+=months[m]*tariffPerKwMonth;
  }
  return cost;
}


const { DateTime } = luxon;

const el = Object.fromEntries([
  "consFile","colDate","colValue","colType","colTariff","tz","agg","from","to","ean",
  "bzn","priceUrl","copyUrl","priceFile","priceInfo",
  "fixedPrice","feedInFixed","dynMarkup","feedInDyn","batMode","cap","pmax","rte","soc0","socMin","cycleLife","gridTariff","pricingModel","modularFamily","phaseSetup","baseCapacity","baseUnitPower","moduleCapacity","accessoryCost","stackPrice1","stackPrice2","stackPrice3","stackPrice4","stackPrice5","stackPrice6","applyModular","updateFamilyPreset","resetFamilyPreset","exportFamilyPresets","importFamilyPresetsBtn","importFamilyPresetsFile","pricesExVat","familyPresetStatus","familyPresetExportDialog","familyPresetExportText","copyFamilyPresetExport","downloadFamilyPresetExport","closeFamilyPresetExport","modularSummary","tieredPricingBox","modularPricingBox",
  "priorityExport","optForecast","optMode","optWindowH","runSim","generatePdfBtn","savePreset","loadPreset","loadPresetFile",
  "tier1","tier2","tier3","batFixedCost",
  "sweepMaxCap","sweepStepCap","sweepMaxKw","sweepStepKw","autoObj","roiScale","runSweep","applyRecommended",
  "progressBar","progressText","sweepInfo","modularSweepPickerWrap","modularSweepPicker","applySweepSelection",
  "kpiEnergy","kpiPeak","kpiCycles","kpiCyclesYear","kpiLifetime","kpiPeakReduction","kpiNoBatFixed","kpiNoBatDyn","kpiWithBatFixed","kpiWithBatDyn",
  "notes"
].map(id => [id, document.getElementById(id)]));

let consRows = [];
let consCols = [];
let dynPrices = null;
let hourlyAllCache = null;
let lastRecommended = null;
let lastModularSweepResults = [];

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

function computeMainGraphSeries(filtered, agg){
  if (agg === "raw"){
    return {
      imp: filtered.map(p => ({ t:p.t, y:Math.max(0, p.import) })),
      exp: filtered.map(p => ({ t:p.t, y:-Math.max(0, p.export) }))
    };
  }

  const m = new Map();
  for (const p of filtered){
    const dt = DateTime.fromMillis(p.t, {zone:el.tz.value});
    const k = groupKey(dt, agg);
    if (!m.has(k)) m.set(k, { t:keyToMillis(k, agg), imp:0, exp:0 });
    const o = m.get(k);
    o.imp += Math.max(0, p.import);
    o.exp += -Math.max(0, p.export);
  }

  const rows = Array.from(m.values()).sort((a,b)=>a.t-b.t);
  return {
    imp: rows.map(r => ({ t:r.t, y:r.imp })),
    exp: rows.map(r => ({ t:r.t, y:r.exp }))
  };
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
function getPhaseCount(){
  return Math.max(1, Number(el.phaseSetup ? el.phaseSetup.value : 1) || 1);
}

function getRawStackPrice(height){
  const key = "stackPrice" + height;
  const node = el[key];
  return Math.max(0, Number(node ? node.value : 0) || 0);
}

function getVatFactor(){
  return (el.pricesExVat && el.pricesExVat.checked) ? 0.79 : 1.0;
}


let customFamilyOverrides = {};
const FAMILY_PRESET_STORAGE_KEY = "energyUI_family_presets_v1";

function saveFamilyPresetOverrides(){
  try{
    localStorage.setItem(FAMILY_PRESET_STORAGE_KEY, JSON.stringify(customFamilyOverrides));
    updateFamilyPresetStatus();
  }catch(e){
    console.warn("Failed to save family preset overrides", e);
  }
}

function loadFamilyPresetOverrides(){
  try{
    const raw = localStorage.getItem(FAMILY_PRESET_STORAGE_KEY);
    if (raw){
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object"){
        customFamilyOverrides = parsed;
      }
    }
  }catch(e){
    console.warn("Failed to load family preset overrides", e);
    customFamilyOverrides = {};
  }
}

function deleteFamilyPresetOverride(fam){
  if (!fam || fam === "custom") return;
  if (customFamilyOverrides && customFamilyOverrides[fam]){
    delete customFamilyOverrides[fam];
    saveFamilyPresetOverrides();
  }
}

let familyPresetExportUrl = null;

function openFamilyPresetExportDialog(filename, dataObj){
  const jsonText = JSON.stringify(dataObj, null, 2);
  const blob = new Blob([jsonText], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  if (familyPresetExportUrl){
    try{ URL.revokeObjectURL(familyPresetExportUrl); }catch(e){}
  }
  familyPresetExportUrl = url;

  if (el.familyPresetExportText) el.familyPresetExportText.value = jsonText;
  if (el.downloadFamilyPresetExport){
    el.downloadFamilyPresetExport.href = url;
    el.downloadFamilyPresetExport.download = filename;
  }

  if (el.familyPresetExportDialog && typeof el.familyPresetExportDialog.showModal === "function"){
    el.familyPresetExportDialog.showModal();
  } else {
    window.prompt("Copy preset JSON:", jsonText);
  }
}
async function saveFamilyPresetFile(jsonText, filename){
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: "JSON preset",
        accept: { "application/json": [".json"] }
      }]
    });
    const writable = await handle.createWritable();
    await writable.write(jsonText);
    await writable.close();
    return "saved";
  }

  try {
    const file = new File([jsonText], filename, {type:"application/json"});
    if (navigator.canShare && navigator.canShare({ files:[file] }) && navigator.share) {
      await navigator.share({ files:[file] });
      return "shared";
    }
  } catch (err) {
    console.warn("Share fallback failed", err);
  }

  const blob = new Blob([jsonText], {type:"application/json"});
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
  return "downloaded";
}


function updateFamilyPresetStatus(){
  if (!el.familyPresetStatus || !el.modularFamily) return;
  const fam = el.modularFamily.value;
  if (!fam || fam === "custom"){
    el.familyPresetStatus.textContent = "Custom family: no persistent preset selected.";
    return;
  }
  if (customFamilyOverrides && customFamilyOverrides[fam]){
    el.familyPresetStatus.innerHTML = "Stored override active for <b>" + fam + "</b> and persisted in this browser.";
  } else {
    el.familyPresetStatus.innerHTML = "Using built-in preset for <b>" + fam + "</b>.";
  }
}


function getStackPrice(height){
  return getRawStackPrice(height) * getVatFactor();
}

function getModularConfigExplicit(phaseCount, stackHeight, requestedCap){
  phaseCount = Math.max(1, Number(phaseCount) || 1);
  stackHeight = Math.max(1, Math.min(6, Number(stackHeight) || 1));

  const baseCapacity = Math.max(0, Number(el.baseCapacity ? el.baseCapacity.value : 0) || 0);
  const moduleCapacity = Math.max(0.01, Number(el.moduleCapacity ? el.moduleCapacity.value : 0.01) || 0.01);
  const baseUnitPower = Math.max(0, Number(el.baseUnitPower ? el.baseUnitPower.value : 0) || 0);
  const accessory = Math.max(0, Number(el.accessoryCost ? el.accessoryCost.value : 0) || 0);
  const fixed = Math.max(0, Number(el.batFixedCost ? el.batFixedCost.value : 0) || 0);

  const perStackCapacity = baseCapacity + (stackHeight - 1) * moduleCapacity;
  const snappedCapacity = phaseCount * perStackCapacity;
  const totalPower = phaseCount * baseUnitPower;
  const selectedStackPrice = getStackPrice(stackHeight); // complete stack price for this height
  const totalCost = (phaseCount * selectedStackPrice) + accessory + fixed;
  const totalModules = phaseCount * Math.max(0, stackHeight - 1);

  return {
    phaseCount: phaseCount,
    stackHeight: stackHeight,
    modules: totalModules,
    requestedCapacity: Math.max(0, Number(requestedCap) || snappedCapacity),
    perStackCapacity: perStackCapacity,
    snappedCapacity: snappedCapacity,
    totalPower: totalPower,
    selectedStackPrice: selectedStackPrice,
    totalCost: totalCost,
    label: phaseCount + "p · h" + stackHeight
  };
}

function getModularConfig(capInput){
  const phaseCount = getPhaseCount();
  const requestedCap = Math.max(0, Number(capInput) || 0);
  const baseCapacity = Math.max(0, Number(el.baseCapacity ? el.baseCapacity.value : 0) || 0);
  const moduleCapacity = Math.max(0.01, Number(el.moduleCapacity ? el.moduleCapacity.value : 0.01) || 0.01);

  const requestedPerStack = requestedCap / phaseCount;
  let stackHeight = 1;
  if (requestedPerStack > baseCapacity){
    stackHeight = 1 + Math.ceil((requestedPerStack - baseCapacity) / moduleCapacity);
  }
  stackHeight = Math.max(1, Math.min(6, stackHeight));

  return getModularConfigExplicit(phaseCount, stackHeight, requestedCap);
}

function batteryCostEUR(cap){
  if (el.pricingModel && el.pricingModel.value === "modular"){
    return getModularConfig(cap).totalCost;
  }

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


// ---------- pricing UI ----------
function applyModularFamilyPreset(){
  if (!el.modularFamily) return;
  const fam = el.modularFamily.value;

  const presetMap = {
    custom: null,
    zendure_solarflow_1600_ac_plus: { baseCapacity:2.4, moduleCapacity:1.92, baseUnitPower:1.6, prices:[969,1458,1947,2436,2925,3414] },
    zendure_solarflow_2400_ac_plus: { baseCapacity:2.4, moduleCapacity:2.88, baseUnitPower:2.4, prices:[1918.29,2647.29,3376.29,4105.29,4834.29,5563.29] },
    zendure_solarflow_2400_ac: { baseCapacity:0, moduleCapacity:2.88, baseUnitPower:2.4, prices:[1419,2239,3059,3879,4699,5519] },
    zendure_hyper_2000: { baseCapacity:0, moduleCapacity:1.92, baseUnitPower:0.8, prices:[978,1467,1956,2445,2934,3423] },
    zendure_hub_2000: { baseCapacity:0, moduleCapacity:1.92, baseUnitPower:0.8, prices:[888,1377,1866,2355,2844,3333] },
    zendure_solarflow_800: { baseCapacity:0, moduleCapacity:1.92, baseUnitPower:0.8, prices:[738,1227,1716,2205,2694,3183] },
    indevolt_powerflex_2000: { baseCapacity:2.0, moduleCapacity:2.0, baseUnitPower:2.4, prices:[650,1180,1710,2239,2769,3299] },
    indevolt_solidflex_2000: { baseCapacity:1.8, moduleCapacity:1.8, baseUnitPower:2.4, prices:[518,1106,1694,2281,2869,3457] }
  };

  var p = customFamilyOverrides[fam] || presetMap[fam];
  if (p){
    if (el.baseCapacity) el.baseCapacity.value = String(p.baseCapacity);
    if (el.moduleCapacity) el.moduleCapacity.value = String(p.moduleCapacity);
    if (el.baseUnitPower) el.baseUnitPower.value = String(p.baseUnitPower);
    if (el.accessoryCost && p.accessoryCost !== undefined) el.accessoryCost.value = String(p.accessoryCost);
    if (el.batFixedCost && p.batFixedCost !== undefined) el.batFixedCost.value = String(p.batFixedCost);
    if (el.pricesExVat && p.pricesExVat !== undefined) el.pricesExVat.checked = !!p.pricesExVat;
    for (var i=1;i<=6;i++){
      if (el["stackPrice"+i]) el["stackPrice"+i].value = String(p.prices[i-1]);
    }
  }
  updatePricingUI();
  updateFamilyPresetStatus();
}

function updatePricingUI(){
  if (!el.pricingModel) return;

  const modular = el.pricingModel.value === "modular";
  if (el.tieredPricingBox) el.tieredPricingBox.style.display = modular ? "none" : "";
  if (el.modularPricingBox) el.modularPricingBox.style.display = modular ? "" : "none";

  if (modular && el.modularSummary){
    const cfg = getModularConfig(Number(el.cap ? el.cap.value : 0) || 0);
    el.modularSummary.innerHTML =
      'Derived from current capacity input: stack height <b>' + cfg.stackHeight + '</b> per phase · ' +
      '<b>' + cfg.phaseCount + '</b> base unit(s) · ' +
      '<b>' + cfg.modules + '</b> extra module(s) total · ' +
      'snapped capacity: <b>' + cfg.snappedCapacity.toFixed(2) + ' kWh</b> · ' +
      'total power: <b>' + cfg.totalPower.toFixed(2) + ' kW</b> · ' +
      'cost formula: <b>' + cfg.phaseCount + ' × ' + euro(cfg.selectedStackPrice) + '</b> + accessories + fixed' +
      ((el.pricesExVat && el.pricesExVat.checked) ? ' <i>(excl. btw)</i>' : '') + ' · ' +
      'system cost: <b>' + euro(cfg.totalCost) + '</b>';
  } else if (el.modularSummary){
    el.modularSummary.textContent = "";
  }
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



function simulatePeakShaving(all, cfg){
  const { capKwh, pmaxKw, rte, soc0, socMin, priorityExport } = cfg;
  const effCh = Math.sqrt(rte);
  const effDis = Math.sqrt(rte);
  const maxKwh = pmaxKw;
  const socMinKwh = clamp(socMin,0,1) * capKwh;

  const series = all.filter(p=>inRange(p.t));

  const imports = series.map(p=>Math.max(0,p.import));
  const lo = 0;
  const hi = Math.max(...imports);

  function feasible(target){
    let soc = clamp(soc0,0,1) * capKwh;
    for(const p of series){
      let imp = Math.max(0,p.import);
      let exp = Math.max(0,p.export);

      if(priorityExport && exp>0 && soc<capKwh){
        const headroom = capKwh - soc;
        const ch = Math.min(maxKwh, exp, headroom/effCh);
        soc += ch*effCh;
        exp -= ch;
      }

      if(imp > target){
        const needed = imp-target;
        const avail = Math.max(0,soc-socMinKwh);
        const dis = Math.min(maxKwh, avail);
        const delivered = dis*effDis;
        if(delivered < needed) return false;
        soc -= needed/effDis;
      }else{
        const headroom = capKwh - soc;
        const ch = Math.min(maxKwh, target-imp, headroom/effCh);
        soc += ch*effCh;
      }
    }
    return true;
  }

  let low=lo, high=hi;
  for(let i=0;i<20;i++){
    const mid=(low+high)/2;
    if(feasible(mid)) high=mid; else low=mid;
  }
  const target=high;

  let soc = clamp(soc0,0,1)*capKwh;
  let imp0=0,exp0=0,imp1=0,exp1=0;
  const tl=[];

  for(const p of series){
    const import0=Math.max(0,p.import);
    const export0=Math.max(0,p.export);
    imp0+=import0; exp0+=export0;

    let imp=import0;
    let exp=export0;

    if(priorityExport && exp>0 && soc<capKwh){
      const headroom=capKwh-soc;
      const ch=Math.min(maxKwh,exp,headroom/effCh);
      soc+=ch*effCh;
      exp-=ch;
    }

    if(imp>target && soc>socMinKwh){
      const needed=imp-target;
      const avail=Math.max(0,soc-socMinKwh);
      const dis=Math.min(maxKwh,avail);
      const delivered=dis*effDis;
      const shave=Math.min(delivered,needed);
      imp-=shave;
      soc-=shave/effDis;
    }else if(imp<target && soc<capKwh){
      const headroom=capKwh-soc;
      const ch=Math.min(maxKwh,target-imp,headroom/effCh);
      soc+=ch*effCh;
      imp+=ch;
    }

    imp1+=imp; exp1+=exp;

    tl.push({
      t:p.t,
      import0:import0,
      export0:-export0,
      import1:imp,
      export1:-exp,
      soc
    });
  }

  return { imp0, exp0, imp1, exp1, timeline: tl, target };
}



function simulateHybridSelfPeak(all, cfg){
  const self = simulateSelfConsumption(all, cfg);
  const metricsSelf = computeBatteryMetrics(self.timeline, cfg.capKwh, Number(el.cycleLife?.value) || 6000);
  const peak = simulatePeakShaving(all, cfg);
  const metricsPeak = computeBatteryMetrics(peak.timeline, cfg.capKwh, Number(el.cycleLife?.value) || 6000);
  const tariff = Number(el.gridTariff?.value) || 0;
  const months = 12 / Math.max(1e-9, scaleToYear());

  const fixedImport = Number(el.fixedPrice.value) || 0;
  const fixedFeedIn = Number(el.feedInFixed.value) || 0;

  const selfCost = costFixedTotal(self.imp1, self.exp1, fixedImport, fixedFeedIn) + metricsSelf.peakAfter * tariff * months;
  const peakCost = costFixedTotal(peak.imp1, peak.exp1, fixedImport, fixedFeedIn) + metricsPeak.peakAfter * tariff * months;

  return selfCost <= peakCost ? { ...self, hybridChoice:"self" } : { ...peak, hybridChoice:"peak" };
}

function simulateHybridPricePeak(all, netSeries, cfg, tariff){
  // Compare dynamic-price optimisation against peak optimisation on total economic outcome
  const markup = tariff.markup;
  const feedInDyn = tariff.feedIn;
  const tariffPerKw = Number(el.gridTariff?.value) || 0;
  const months = 12 / Math.max(1e-9, scaleToYear());

  const peak = simulatePeakShaving(all, cfg);
  const metricsPeak = computeBatteryMetrics(peak.timeline, cfg.capKwh, Number(el.cycleLife?.value) || 6000);
  const impPeak = peak.timeline.map(p=>({t:p.t,kwh:p.import1}));
  const expPeak = peak.timeline.map(p=>({t:p.t,kwh:-p.export1}));
  const dynPeak = costDynamicSeries(impPeak, expPeak, markup, feedInDyn);
  const totalPeakCost = (dynPeak.cost ?? Infinity) + metricsPeak.peakAfter * tariffPerKw * months;

  let priceTimeline = peak.timeline;
  let priceCost = Infinity;
  let priceMissing = null;

  if (dynPrices){
    if (el.optForecast.checked){
      const netLoad = [];
      const price = [];
      const tArr = [];
      let missing = 0;
      for (const p of netSeries){
        const pr = priceAtHourStart(p.t);
        if (pr == null){ missing++; continue; }
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
      priceMissing = missing;
      priceTimeline = tArr.map((t, i) => ({
        t,
        import0: Math.max(0, netLoad[i]),
        export0: -Math.max(0, -netLoad[i]),
        import1: Math.max(0, res.grid[i]),
        export1: -Math.max(0, -res.grid[i]),
        soc: res.soc[i]
      }));
      const metricsPrice = computeBatteryMetrics(priceTimeline, cfg.capKwh, Number(el.cycleLife?.value) || 6000);
      priceCost = res.cost + metricsPrice.peakAfter * tariffPerKw * months;
    } else {
      const arb = simulateArbitrageHeuristic(netSeries, cfg, { markup, feedIn: feedInDyn });
      priceMissing = arb.missingHours;
      priceTimeline = arb.timeline;
      const metricsPrice = computeBatteryMetrics(priceTimeline, cfg.capKwh, Number(el.cycleLife?.value) || 6000);
      priceCost = arb.cost + metricsPrice.peakAfter * tariffPerKw * months;
    }
  }

  if (priceCost <= totalPeakCost){
    return {
      timeline: priceTimeline,
      dyn1Cost: priceCost,
      dynMissing: priceMissing,
      hybridChoice:"price"
    };
  }
  return {
    timeline: peak.timeline,
    dyn1Cost: totalPeakCost,
    dynMissing: dynPeak.missingHours,
    hybridChoice:"peak"
  };
}



function simulateHybridCombined(all, netSeries, cfg, tariff){
  const peak = simulatePeakShaving(all, cfg);
  const target = peak.target;
  const markup = tariff.markup;
  const feedInDyn = tariff.feedIn;

  const netLoad = [];
  const price = [];
  const tArr = [];

  for (const p of netSeries){
    const pr = priceAtHourStart(p.t);
    if (pr == null) continue;
    netLoad.push(p.kwh);
    price.push(pr);
    tArr.push(p.t);
  }

  const penalty = 5; // €/kWh penalty above peak target

  const modPrice = netLoad.map((v,i)=>{
    if(v > target) return price[i] + penalty;
    return price[i];
  });

  const opt = { markup, feedIn: feedInDyn };
  const res = optimizeBatteryDP(netLoad, modPrice, cfg, opt);

  const timeline = tArr.map((t, i) => ({
    t,
    import0: Math.max(0, netLoad[i]),
    export0: -Math.max(0, -netLoad[i]),
    import1: Math.max(0, res.grid[i]),
    export1: -Math.max(0, -res.grid[i]),
    soc: res.soc[i]
  }));

  return { timeline, dyn1Cost: res.cost, dynMissing: null, hybridChoice:"combined" };
}

// ---------- simulation wrapper ----------
function runSimulationFor(capKwh, pmaxKw, options){
  const all = buildHourlyAll();
  const { imp, exp, net } = buildSeriesForCosts(all);

  const fixedImport = Number(el.fixedPrice.value) || 0;
  const fixedFeedIn = Number(el.feedInFixed.value) || 0;
  const markup = Number(el.dynMarkup.value) || 0;
  const feedInDyn = Number(el.feedInDyn.value) || 0;

  options = options || {};

  if (el.pricingModel && el.pricingModel.value === "modular"){
    const modularCfg = options.modularCfg ? options.modularCfg : getModularConfig(capKwh);
    capKwh = modularCfg.snappedCapacity;
    pmaxKw = modularCfg.totalPower;
  }

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

  let self;
  if (el.batMode.value === "peak"){
    self = simulatePeakShaving(all, cfg);
  } else if (el.batMode.value === "hybrid_self_peak"){
    self = simulateHybridSelfPeak(all, cfg);
  } else {
    self = simulateSelfConsumption(all, cfg);
  }
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
    timeline,
    hybridChoice: (self && self.hybridChoice) || null
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


function renderOptimizationHeatmap(caps, pows, matrix, title){
  const chartId = "optHeatmapChart";
  if (!document.getElementById(chartId)) return;
  if (!caps?.length || !pows?.length || !matrix?.length){
    Plotly.newPlot(chartId, [], {}, {responsive:true});
    return;
  }

  Plotly.newPlot(chartId, [{
    x: caps,
    y: pows,
    z: matrix,
    type: "heatmap",
    hovertemplate: "Cap %{x} kWh<br>Power %{y} kW<br>Score %{z:.2f}<extra></extra>"
  }], {
    margin:{t:30,r:10,b:40,l:55},
    title:{text:title, font:{size:12}},
    xaxis:{title:"Capacity (kWh)"},
    yaxis:{title:"Power (kW)"}
  }, {responsive:true});
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
  const series = computeMainGraphSeries(filtered, agg);
  const absPeak = Math.max(
    ...series.imp.map(p => Math.abs(p.y || 0)),
    ...series.exp.map(p => Math.abs(p.y || 0))
  );

  el.kpiEnergy.textContent = (series.imp.reduce((s,p)=>s+(p.y||0),0) + series.exp.reduce((s,p)=>s+(p.y||0),0)).toFixed(2);
  el.kpiPeak.textContent = absPeak.toFixed(2);

  Plotly.newPlot("chart", [
    {
      x: series.imp.map(p=>new Date(p.t)),
      y: series.imp.map(p=>p.y),
      type: agg === "raw" ? "scatter" : "bar",
      mode: agg === "raw" ? "lines" : undefined,
      name: "Import",
      hovertemplate: "%{x}<br>Import: %{y:.3f} kWh<extra></extra>"
    },
    {
      x: series.exp.map(p=>new Date(p.t)),
      y: series.exp.map(p=>p.y),
      type: agg === "raw" ? "scatter" : "bar",
      mode: agg === "raw" ? "lines" : undefined,
      name: "Export",
      hovertemplate: "%{x}<br>Export: %{y:.3f} kWh<extra></extra>"
    }
  ], {
    margin:{t:10,r:10,b:40,l:55},
    xaxis:{title:"Tijd"},
    yaxis:{
      title:"kWh (export negatief)",
      zeroline:true,
      zerolinewidth:2
    },
    hovermode:"x unified",
    legend:{orientation:"h"}
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
  Plotly.newPlot("savingsChart", [], {}, {responsive:true});
  Plotly.newPlot("roiChart", [], {}, {responsive:true});
  Plotly.newPlot("powerChart", [], {}, {responsive:true});
  Plotly.newPlot("optHeatmapChart", [], {}, {responsive:true});
  Plotly.newPlot("heatmapChart", [], {}, {responsive:true});
  Plotly.newPlot("peakChart", [], {}, {responsive:true});
  el.notes.textContent = "";
  el.sweepInfo.textContent = "";
  if (el.modularSweepPickerWrap) el.modularSweepPickerWrap.style.display = "none";
  if (el.modularSweepPicker) el.modularSweepPicker.innerHTML = "";
  lastModularSweepResults = [];
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
      Monthly grid tariff cost: <b>${euro(calculateMonthlyPeakCost(r.timeline, Number(el.gridTariff.value) || 0))}</b><br>
      ${r.hybridChoice ? `Hybrid selected: <b>${r.hybridChoice}</b><br>` : ""}
      ${r.dynMissing ? `<span class="warn">Ontbrekende prijs-uren: ${r.dynMissing}</span>` : ""}
    </div>
  `;
}

// ---------- sweep ----------
async function runSweepAndRecommend(){
  const autoObj = el.autoObj.value;
  const scaleYear = scaleToYear();
  const tariff = Number(el.gridTariff ? el.gridTariff.value : 0) || 0;

  const baseline = runSimulationFor(0, 0);
  const baseFix = baseline.fixed0;
  const baseDyn = baseline.dyn0Cost;

  if (el.pricingModel && el.pricingModel.value === "modular"){
    const configs = [];
    for (let phase=1; phase<=3; phase++){
      for (let h=1; h<=6; h++){
        configs.push(getModularConfigExplicit(phase, h, 0));
      }
    }

    const labels = configs.map(c => c.label);
    const xVals = labels.slice();
    const fixSavings = [];
    const dynSavings = [];
    const fixRoi = [];
    const dynRoi = [];
    const powers = [];
    const heatRows = [[],[],[]];

    let bestOverall = null;
    const total = configs.length;

    for (let i=0; i<configs.length; i++){
      const cfgMod = configs[i];
      const r = runSimulationFor(cfgMod.snappedCapacity, cfgMod.totalPower, { modularCfg: cfgMod });
      const cost = cfgMod.totalCost;

      const saveFix = baseFix - r.fixed1;
      const annualFix = saveFix * scaleYear;
      const roiFix = annualFix > 0 ? cost / annualFix : null;

      let saveDyn = null, roiDyn = null;
      if (dynPrices && baseDyn != null && r.dyn1Cost != null){
        saveDyn = baseDyn - r.dyn1Cost;
        const annualDyn = saveDyn * scaleYear;
        roiDyn = annualDyn > 0 ? cost / annualDyn : null;
      }

      fixSavings.push(saveFix);
      dynSavings.push(saveDyn);
      fixRoi.push(roiFix);
      dynRoi.push(roiDyn);
      powers.push(cfgMod.totalPower);

      let score = null;
      if (autoObj === "save_fix") score = saveFix;
      else if (autoObj === "roi_fix") score = roiFix != null ? -roiFix : null;
      else if (autoObj === "save_dyn") score = saveDyn;
      else if (autoObj === "roi_dyn") score = roiDyn != null ? -roiDyn : null;
      else if (autoObj === "peak") score = calculateMonthlyPeakCost(baseline.timeline, tariff) - calculateMonthlyPeakCost(r.timeline, tariff);
      else if (autoObj === "knee") score = saveDyn != null ? saveDyn : saveFix;

      heatRows[cfgMod.phaseCount - 1].push(score);

      if (score != null && (!bestOverall || score > bestOverall.score)){
        bestOverall = {
          score: score,
          cap: cfgMod.snappedCapacity,
          pmax: cfgMod.totalPower,
          modularCfg: cfgMod,
          fixSave: saveFix,
          fixRoi: roiFix,
          dynSave: saveDyn,
          dynRoi: roiDyn
        };
      }

      setProgress((i + 1) / total * 100, "Sweep " + (i + 1) + "/" + total);
      if ((i + 1) % 2 === 0) await yieldToUI();
    }

    Plotly.newPlot("savingsChart", [
      { x:xVals, y:fixSavings, type:"scatter", mode:"lines+markers", name:"Savings fixed" },
      ...(dynPrices ? [{ x:xVals, y:dynSavings, type:"scatter", mode:"lines+markers", name:"Savings dynamic" }] : [])
    ], {
      margin:{t:10,r:10,b:80,l:55},
      xaxis:{title:"Phase + stack height", tickangle:-30},
      yaxis:{title:"Savings (€)"},
      hovermode:"x unified"
    }, {responsive:true});

    Plotly.newPlot("roiChart", [
      { x:xVals, y:fixRoi, type:"scatter", mode:"lines+markers", name:"ROI fixed" },
      ...(dynPrices ? [{ x:xVals, y:dynRoi, type:"scatter", mode:"lines+markers", name:"ROI dynamic" }] : [])
    ], {
      margin:{t:10,r:10,b:80,l:55},
      xaxis:{title:"Phase + stack height", tickangle:-30},
      yaxis:{title:"ROI (years)"},
      hovermode:"x unified"
    }, {responsive:true});

    Plotly.newPlot("powerChart", [
      { x:xVals, y:powers, type:"scatter", mode:"lines+markers", name:"Derived power" }
    ], {
      margin:{t:10,r:10,b:80,l:55},
      xaxis:{title:"Phase + stack height", tickangle:-30},
      yaxis:{title:"Power (kW)"},
      hovermode:"x unified"
    }, {responsive:true});

    Plotly.newPlot("optHeatmapChart", [{
      x:[1,2,3,4,5,6],
      y:["1 phase","2 phase","3 phase"],
      z:heatRows,
      type:"heatmap",
      hovertemplate:"%{y}<br>Stack height %{x}<br>Score %{z:.2f}<extra></extra>"
    }], {
      margin:{t:30,r:10,b:40,l:80},
      title:{text:"Modular sweep score", font:{size:12}},
      xaxis:{title:"Stack height"},
      yaxis:{title:"Phase setup"}
    }, {responsive:true});

    lastModularSweepResults = configs.map(function(cfgMod, i){
      return {
        label: cfgMod.label,
        modularCfg: cfgMod,
        fixSavings: fixSavings[i],
        dynSavings: dynSavings[i],
        fixRoi: fixRoi[i],
        dynRoi: dynRoi[i],
        power: powers[i]
      };
    });

    if (el.modularSweepPicker && el.modularSweepPickerWrap){
      el.modularSweepPicker.innerHTML = lastModularSweepResults.map(function(r, idx){
        var dynTxt = r.dynSavings != null ? (" | dyn " + euro(r.dynSavings)) : "";
        return '<option value="' + idx + '">' + r.label + ' | ' + r.modularCfg.snappedCapacity.toFixed(2) + ' kWh | ' + r.modularCfg.totalPower.toFixed(2) + ' kW | ' + euro(r.modularCfg.totalCost) + ' | fix ' + euro(r.fixSavings) + dynTxt + '</option>';
      }).join("");
      el.modularSweepPickerWrap.style.display = "";
    }

    if (!bestOverall){
      lastRecommended = null;
      el.applyRecommended.disabled = true;
      el.sweepInfo.textContent = "Geen recommendation gevonden.";
      return;
    }

    const rec = runSimulationFor(bestOverall.cap, bestOverall.pmax, { modularCfg: bestOverall.modularCfg });
    const cost = bestOverall.modularCfg.totalCost;
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
      modularCfg: bestOverall.modularCfg,
      fix: { savings: saveFix, annual: annualFix, roi: roiFix },
      dyn: { savings: saveDyn, annual: annualDyn, roi: roiDyn }
    };

    el.applyRecommended.disabled = false;
    setProgress(100, "Sweep klaar");

    el.sweepInfo.innerHTML = "Recommended modular setup: <b>" + bestOverall.modularCfg.phaseCount + " phase</b> · <b>stack height " + bestOverall.modularCfg.stackHeight + "</b><br>Capacity: <b>" + bestOverall.modularCfg.snappedCapacity.toFixed(2) + " kWh</b> · Power: <b>" + bestOverall.modularCfg.totalPower.toFixed(2) + " kW</b><br>You can also choose any swept modular configuration from the dropdown below.";

    el.notes.innerHTML = '<div class="small">' +
      '<b>Recommended modular setup</b>: ' + bestOverall.modularCfg.phaseCount + ' phase · stack height ' + bestOverall.modularCfg.stackHeight + '<br>' +
      'Base units: <b>' + bestOverall.modularCfg.phaseCount + '</b> · extra modules total: <b>' + bestOverall.modularCfg.modules + '</b><br>' +
      'Capacity: <b>' + bestOverall.modularCfg.snappedCapacity.toFixed(2) + ' kWh</b> · Power: <b>' + bestOverall.modularCfg.totalPower.toFixed(2) + ' kW</b><br>' +
      'Cost formula: <b>' + bestOverall.modularCfg.phaseCount + ' × ' + euro(bestOverall.modularCfg.selectedStackPrice) + '</b> + accessories + fixed<br>' +
      'Batterijkosten: <b>' + euro(cost) + '</b><br><br>' +
      '<b>Fixed</b> — savings: ' + euro(saveFix) + ' · annual: ' + euro(annualFix) + ' · ROI: <b>' + (roiFix != null ? roiFix.toFixed(1) + ' years' : '—') + '</b><br>' +
      '<b>Dynamic</b> — savings: ' + (saveDyn != null ? euro(saveDyn) : '—') + ' · annual: ' + (annualDyn != null ? euro(annualDyn) : '—') + ' · ROI: <b>' + (roiDyn != null ? roiDyn.toFixed(1) + ' years' : '—') + '</b>' +
      '</div>';
    return;
  }

  const maxCap = Math.max(0, Number(el.sweepMaxCap.value) || 0);
  const stepCap = Math.max(0.5, Number(el.sweepStepCap.value) || 1);
  const maxKw = Math.max(0, Number(el.sweepMaxKw.value) || 0);
  const stepKw = Math.max(0.5, Number(el.sweepStepKw.value) || 1);

  const caps = [];
  for (let c=0;c<=maxCap + 1e-9;c+=stepCap) caps.push(Math.round(c/stepCap)*stepCap);
  const pows = [];
  for (let p=0;p<=maxKw + 1e-9;p+=stepKw) pows.push(Math.round(p/stepKw)*stepKw);

  if (!caps.length || !pows.length) return;

  const bestSavingsFix = [];
  const bestSavingsDyn = [];
  const bestRoiFix = [];
  const bestRoiDyn = [];
  const bestPowerFix = [];
  const bestPowerDyn = [];
  const scoreMatrix = pows.map(() => caps.map(() => null));

  let bestOverall = null;
  const total = caps.length * pows.length;
  let done = 0;

  for (let ci=0; ci<caps.length; ci++){
    const cap = caps[ci];
    let bestFix = { savings:-Infinity, roi:null, pmax:null };
    let bestDyn = { savings:-Infinity, roi:null, pmax:null };

    for (let pi=0; pi<pows.length; pi++){
      const pmax = pows[pi];
      const r = runSimulationFor(cap, pmax);
      const cost = batteryCostEUR(cap);
      const metrics = computeBatteryMetrics(r.timeline, cap, Number(el.cycleLife ? el.cycleLife.value : 6000) || 6000);

      const saveFix = baseFix - r.fixed1;
      const annualFix = saveFix * scaleYear;
      const roiFix = annualFix > 0 ? cost / annualFix : null;

      if (saveFix > bestFix.savings){
        bestFix = { savings: saveFix, roi: roiFix, pmax: pmax };
      }

      if (dynPrices && baseDyn != null && r.dyn1Cost != null){
        const saveDyn = baseDyn - r.dyn1Cost;
        const annualDyn = saveDyn * scaleYear;
        const roiDyn = annualDyn > 0 ? cost / annualDyn : null;

        if (saveDyn > bestDyn.savings){
          bestDyn = { savings: saveDyn, roi: roiDyn, pmax: pmax };
        }
      }

      let scoreForHeatmap = null;
      if (autoObj === "peak"){
        const annualGridSaving = calculateMonthlyPeakCost(baseline.timeline, tariff) - calculateMonthlyPeakCost(r.timeline, tariff);
        scoreForHeatmap = annualGridSaving;
      } else if (autoObj === "save_fix") {
        scoreForHeatmap = saveFix;
      } else if (autoObj === "roi_fix") {
        scoreForHeatmap = roiFix != null ? -roiFix : null;
      } else if (autoObj === "save_dyn" && dynPrices && baseDyn != null && r.dyn1Cost != null) {
        scoreForHeatmap = baseDyn - r.dyn1Cost;
      } else if (autoObj === "roi_dyn" && dynPrices && baseDyn != null && r.dyn1Cost != null) {
        const saveDynTmp = baseDyn - r.dyn1Cost;
        const annualDynTmp = saveDynTmp * scaleYear;
        const roiDynTmp = annualDynTmp > 0 ? cost / annualDynTmp : null;
        scoreForHeatmap = roiDynTmp != null ? -roiDynTmp : null;
      }
      scoreMatrix[pi][ci] = scoreForHeatmap;

      done++;
      setProgress(done / total * 100, "Sweep " + done + "/" + total);
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
    if (autoObj === "roi_fix" && bestFix.roi != null) candidate = { score: -bestFix.roi, cap: cap, pmax: bestFix.pmax };
    if (autoObj === "save_fix") candidate = { score: bestFix.savings, cap: cap, pmax: bestFix.pmax };
    if (autoObj === "roi_dyn" && bestDyn.roi != null) candidate = { score: -bestDyn.roi, cap: cap, pmax: bestDyn.pmax };
    if (autoObj === "save_dyn" && dynPrices && bestDyn.savings != null) candidate = { score: bestDyn.savings, cap: cap, pmax: bestDyn.pmax };
    if (autoObj === "peak") {
      let bestPeak = { score:-Infinity, pmax:null };
      for (let pi=0; pi<pows.length; pi++) {
        const s = scoreMatrix[pi][ci];
        if (s != null && s > bestPeak.score) bestPeak = { score:s, pmax:pows[pi] };
      }
      if (bestPeak.pmax != null) candidate = { score: bestPeak.score, cap: cap, pmax: bestPeak.pmax };
    }

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

  renderOptimizationHeatmap(caps, pows, scoreMatrix, autoObj === "peak" ? "Annual grid tariff savings (€)" : "Optimisation score");

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
    el.batMode.value === "self" ? "Zelfconsumptie" : (el.batMode.value === "peak" ? "Peak shaving optimisation" : (el.batMode.value === "hybrid_price_peak" ? "Hybrid dynamic price + peak" : (el.batMode.value === "hybrid_self_peak" ? "Hybrid self consumption + peak" : "Dynamisch arbitrage")));

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


async function captureChartsForReport(){

  async function cap(id){
    const el=document.getElementById(id);
    if(!el) return null;
    try{
      return await Plotly.toImage(id,{format:"png",width:1000,height:450});
    }catch(e){
      return null;
    }
  }

  const main=await cap("chart");
  const out=await cap("chart2");
  const sav=await cap("savingsChart");
  const roi=await cap("roiChart");
  const heat=await cap("heatmapChart");

  if(main) document.getElementById("reportChartMain").src=main;
  if(out) document.getElementById("reportChartOutput").src=out;
  if(sav) document.getElementById("reportChartSavings").src=sav;
  if(roi) document.getElementById("reportChartROI").src=roi;
  if(heat) document.getElementById("reportChartHeatmap").src=heat;
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

["colDate","colValue","colType","colTariff","tz","agg","from","to","ean","bzn"].forEach(id => {
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
  if (lastRecommended.modularCfg){
    if (el.phaseSetup) el.phaseSetup.value = String(lastRecommended.modularCfg.phaseCount);
    if (el.cap) el.cap.value = lastRecommended.modularCfg.snappedCapacity.toFixed(2);
    if (el.pmax) el.pmax.value = lastRecommended.modularCfg.totalPower.toFixed(2);
    updatePricingUI();
  } else {
    el.cap.value = lastRecommended.cap;
    el.pmax.value = lastRecommended.pmax;
  }
  renderSingleSimulation();
});


el.generatePdfBtn.addEventListener("click", async ()=>{
  await captureChartsForReport();
  generatePdfReport();
});





["pricingModel","modularFamily","phaseSetup","baseCapacity","baseUnitPower","moduleCapacity","accessoryCost","batFixedCost","stackPrice1","stackPrice2","stackPrice3","stackPrice4","stackPrice5","stackPrice6","cap","pricesExVat","tier1","tier2","tier3"].forEach(function(id){
  if (el[id]){
    el[id].addEventListener("change", function(){
      if (id === "modularFamily") applyModularFamilyPreset();
      updatePricingUI();
      updateFamilyPresetStatus();
    });
    el[id].addEventListener("input", function(){
      updatePricingUI();
    });
  }
});

if (el.applyModular){
  el.applyModular.addEventListener("click", function(){
    const cfg = getModularConfig(Number(el.cap ? el.cap.value : 0) || 0);
    if (el.cap) el.cap.value = cfg.snappedCapacity.toFixed(2);
    if (el.pmax) el.pmax.value = cfg.totalPower.toFixed(2);
    updatePricingUI();
  });
}



if (el.applySweepSelection){
  el.applySweepSelection.addEventListener("click", function(){
    if (!el.modularSweepPicker) return;
    var idx = Number(el.modularSweepPicker.value);
    var chosen = lastModularSweepResults[idx];
    if (!chosen) return;

    if (el.pricingModel) el.pricingModel.value = "modular";
    if (el.phaseSetup) el.phaseSetup.value = String(chosen.modularCfg.phaseCount);
    if (el.cap) el.cap.value = chosen.modularCfg.snappedCapacity.toFixed(2);
    if (el.pmax) el.pmax.value = chosen.modularCfg.totalPower.toFixed(2);
    updatePricingUI();
    renderSingleSimulation();
  });
}

if (el.updateFamilyPreset){
  el.updateFamilyPreset.addEventListener("click", function(){
    if (!el.modularFamily) return;
    var fam = el.modularFamily.value;
    if (!fam || fam === "custom"){
      alert("Select a family preset first.");
      return;
    }
    customFamilyOverrides[fam] = {
      baseCapacity: Number(el.baseCapacity ? el.baseCapacity.value : 0) || 0,
      moduleCapacity: Number(el.moduleCapacity ? el.moduleCapacity.value : 0) || 0,
      baseUnitPower: Number(el.baseUnitPower ? el.baseUnitPower.value : 0) || 0,
      accessoryCost: Number(el.accessoryCost ? el.accessoryCost.value : 0) || 0,
      batFixedCost: Number(el.batFixedCost ? el.batFixedCost.value : 0) || 0,
      pricesExVat: !!(el.pricesExVat && el.pricesExVat.checked),
      prices: [
        Number(el.stackPrice1 ? el.stackPrice1.value : 0) || 0,
        Number(el.stackPrice2 ? el.stackPrice2.value : 0) || 0,
        Number(el.stackPrice3 ? el.stackPrice3.value : 0) || 0,
        Number(el.stackPrice4 ? el.stackPrice4.value : 0) || 0,
        Number(el.stackPrice5 ? el.stackPrice5.value : 0) || 0,
        Number(el.stackPrice6 ? el.stackPrice6.value : 0) || 0
      ]
    };
    saveFamilyPresetOverrides();
    updatePricingUI();
    alert("Family preset updated and stored in this browser, including accessory / fixed cost and excl. btw setting.");
  });
}


if (el.resetFamilyPreset){
  el.resetFamilyPreset.addEventListener("click", function(){
    if (!el.modularFamily) return;
    var fam = el.modularFamily.value;
    if (!fam || fam === "custom"){
      alert("Select a family preset first.");
      return;
    }
    deleteFamilyPresetOverride(fam);
    applyModularFamilyPreset();
    alert("Family preset reset to built-in default for this browser.");
  });
}

if (el.exportFamilyPresets){
  el.exportFamilyPresets.addEventListener("click", async function(){
    var payload = {
      version: 1,
      exported_at: new Date().toISOString(),
      presets: customFamilyOverrides
    };
    var jsonText = JSON.stringify(payload, null, 2);
    try{
      await saveFamilyPresetFile(jsonText, "energyui_family_presets.json");
    }catch(e){
      openFamilyPresetExportDialog("energyui_family_presets.json", payload);
    }
  });
}

if (el.importFamilyPresetsBtn && el.importFamilyPresetsFile){
  el.importFamilyPresetsBtn.addEventListener("click", function(){
    el.importFamilyPresetsFile.click();
  });

  el.importFamilyPresetsFile.addEventListener("change", async function(){
    var f = el.importFamilyPresetsFile.files && el.importFamilyPresetsFile.files[0];
    if (!f) return;
    try{
      var txt = await f.text();
      var data = JSON.parse(txt);
      var incoming = data && data.presets ? data.presets : data;
      if (!incoming || typeof incoming !== "object") throw new Error("Invalid preset file");
      customFamilyOverrides = Object.assign({}, customFamilyOverrides, incoming);
      saveFamilyPresetOverrides();
      applyModularFamilyPreset();
      alert("Family presets imported successfully.");
    }catch(e){
      alert("Import failed: " + e.message);
    }finally{
      el.importFamilyPresetsFile.value = "";
    }
  });
}


if (el.copyFamilyPresetExport){
  el.copyFamilyPresetExport.addEventListener("click", async function(){
    const txt = el.familyPresetExportText ? el.familyPresetExportText.value : "";
    try{
      await navigator.clipboard.writeText(txt);
      alert("Preset JSON copied.");
    }catch(e){
      window.prompt("Copy preset JSON:", txt);
    }
  });
}

if (el.closeFamilyPresetExport){
  el.closeFamilyPresetExport.addEventListener("click", function(){
    if (el.familyPresetExportDialog && typeof el.familyPresetExportDialog.close === "function"){
      el.familyPresetExportDialog.close();
    }
  });
}

// init
loadFamilyPresetOverrides();
if (el.modularFamily) applyModularFamilyPreset();
updatePricingUI();
updatePriceUrl();
setProgress(0, "");
