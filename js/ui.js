
document.addEventListener("DOMContentLoaded",()=>{

  const v = window.VERSION || {};
  const set=(id,val)=>{ const e=document.getElementById(id); if(e) e.textContent=val||""; };

  set("uiVersion", v.ui);
  set("verUI", v.ui);
  set("verSim", v.simulation);
  set("verBat", v.batteryModel);
  set("verHeat", v.heatmap);
  set("verSweep", v.sweep);
  set("verPDF", v.pdf);
  set("verPresets", v.presets);
  set("verBuild", v.build);

  const ch = document.getElementById("changelogBox");
  if (ch) ch.textContent = window.CHANGELOG || "";

  const popup = document.getElementById("versionPopup");
  const box = document.getElementById("versionBox");
  if (box && popup){
    box.addEventListener("click", ()=> popup.classList.toggle("hidden"));
  }

  document.addEventListener("click", (ev) => {
    if (!popup || !box) return;
    if (popup.classList.contains("hidden")) return;
    if (!popup.contains(ev.target) && !box.contains(ev.target)) popup.classList.add("hidden");
  });

});
