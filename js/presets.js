
document.addEventListener("DOMContentLoaded",()=>{

  const fields = [
    "fixedPrice","feedInFixed","dynMarkup","feedInDyn","batMode","cap","pmax","rte","soc0","socMin","cycleLife","gridTariff",
    "pricingModel","modularFamily","phaseSetup","baseCapacity","baseUnitPower","moduleCapacity","accessoryCost","batFixedCost","stackPrice1","stackPrice2","stackPrice3","stackPrice4","stackPrice5","stackPrice6","pricesExVat",
    "tier1","tier2","tier3","batFixedCost",
    "sweepMaxCap","sweepStepCap","sweepMaxKw","sweepStepKw","autoObj","roiScale"
  ];

  const STORAGE_KEY = "energyUIPresetManager";

  function collectPreset(){
    const out = {
      version: window.VERSION?.ui || "unknown",
      exportedAt: new Date().toISOString(),
      values:{}
    };
    for (const id of fields){
      const el = document.getElementById(id);
      if (!el) continue;
      out.values[id] = el.type === "checkbox" ? !!el.checked : el.value;
    }
    return out;
  }

  function applyPreset(data){
    const values = data?.values || {};
    for (const id of fields){
      const el = document.getElementById(id);
      if (!el || !(id in values)) continue;
      if (el.type === "checkbox") el.checked = !!values[id];
      else el.value = values[id];
    }
  }

  function getManagerList(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    }catch{
      return [];
    }
  }

  function setManagerList(list){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  async function savePresetFile(jsonText, filename){
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
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    return "downloaded";
  }

  function renderManager(){
    const host = document.getElementById("presetManager");
    if (!host) return;

    const list = getManagerList();

    if (!list.length){
      host.innerHTML = '<div class="small">No presets saved in manager yet.</div>';
      return;
    }

    host.innerHTML = list.map((item, idx) => {
      const when = item.savedAt ? new Date(item.savedAt).toLocaleString() : "";
      return `
        <div class="presetItem">
          <div>
            <div class="presetName">${escapeHtml(item.name || "Unnamed preset")}</div>
            <div class="presetMeta">Saved: ${escapeHtml(when)} · UI ${escapeHtml(item.version || "")}</div>
          </div>
          <button type="button" data-action="apply" data-idx="${idx}">Load</button>
          <button type="button" data-action="replace" data-idx="${idx}">Update</button>
          <button type="button" data-action="export" data-idx="${idx}">Export</button>
          <button type="button" data-action="delete" data-idx="${idx}">Delete</button>
        </div>
      `;
    }).join("");

    host.querySelectorAll("button[data-action]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        const idx = Number(btn.dataset.idx);
        const list = getManagerList();
        const item = list[idx];
        if (!item) return;

        if (action === "apply"){
          applyPreset(item.data);
          alert("Preset loaded from manager");
        } else if (action === "replace"){
          item.data = collectPreset();
          item.savedAt = new Date().toISOString();
          item.version = window.VERSION?.ui || "unknown";
          list[idx] = item;
          setManagerList(list);
          renderManager();
          alert("Preset updated");
        } else if (action === "export"){
          const jsonText = JSON.stringify(item.data, null, 2);
          const safeName = (item.name || "preset").replace(/[^\w\-]+/g, "_");
          try{
            await savePresetFile(jsonText, `${safeName}.json`);
          }catch(err){
            if (err && err.name === "AbortError") return;
            alert("Preset export failed: " + (err?.message || err));
          }
        } else if (action === "delete"){
          if (!confirm(`Delete preset "${item.name}"?`)) return;
          list.splice(idx, 1);
          setManagerList(list);
          renderManager();
        }
      });
    });
  }

  document.getElementById("savePreset")?.addEventListener("click", async ()=>{
    const data = collectPreset();
    const jsonText = JSON.stringify(data, null, 2);
    const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    const filename = `energy-ui-preset-${stamp}.json`;

    try{
      await savePresetFile(jsonText, filename);
    }catch(err){
      if (err && err.name === "AbortError") return;
      alert("Preset save failed: " + (err?.message || err));
    }
  });

  document.getElementById("savePresetLocal")?.addEventListener("click", ()=>{
    const nameInput = document.getElementById("presetName");
    const name = (nameInput?.value || "").trim() || `Preset ${getManagerList().length + 1}`;

    const list = getManagerList();
    list.unshift({
      name,
      savedAt: new Date().toISOString(),
      version: window.VERSION?.ui || "unknown",
      data: collectPreset()
    });
    setManagerList(list);
    if (nameInput) nameInput.value = "";
    renderManager();
    alert("Preset saved to manager");
  });

  document.getElementById("loadPreset")?.addEventListener("click", ()=>{
    document.getElementById("loadPresetFile")?.click();
  });

  document.getElementById("loadPresetFile")?.addEventListener("change", async (ev)=>{
    const f = ev.target.files?.[0];
    if (!f) return;
    try{
      const text = await f.text();
      const data = JSON.parse(text);
      applyPreset(data);
      alert("Preset loaded");
    }catch(err){
      alert("Preset load failed: " + err.message);
    }finally{
      ev.target.value = "";
    }
  });

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, m => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[m]));
  }

  renderManager();

});
