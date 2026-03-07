
import {initCSV} from "./modules/csv.js";
import {initPrices} from "./modules/prices.js";
import {initBattery} from "./modules/battery.js";
import {initMetrics} from "./modules/metrics.js";
import {initCharts} from "./modules/charts.js";
import {initHeatmap} from "./modules/heatmap.js";
import {initSweep} from "./modules/sweep.js";
import {initPDF} from "./modules/pdf.js";

window.addEventListener("DOMContentLoaded",()=>{

 initCSV();
 initPrices();
 initBattery();
 initMetrics();
 initCharts();
 initHeatmap();
 initSweep();
 initPDF();

 if(window.initVersionUI) initVersionUI();

});
