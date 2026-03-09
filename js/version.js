
window.VERSION = {
  ui: "2.10.3",
  simulation: "1.4.0",
  batteryModel: "1.6.0",
  heatmap: "1.2.0",
  sweep: "1.4.0",
  pdf: "1.1.0",
  presets: "1.1.0",
  build: "2026-03-07"
};

window.CHANGELOG = `
2.10.3
- export family presets now uses the same file-save flow as Save preset
- export falls back to the in-app dialog only when file saving is unavailable

2.10.2
- export family presets now always opens an in-app dialog
- dialog includes copy button and download link

2.10.1
- export family presets now has popup-safe fallback
- export falls back to new tab or prompt when download is blocked

2.10.0
- full persistent family preset manager using browser storage
- reset / export / import family presets
- family preset status indicator

2.9.6
- checked all pricing inputs for recalculation updates
- family preset update now includes accessory cost, fixed cost and excl. btw setting
- batFixedCost now updates modular summary immediately

2.9.5
- button to update family preset from current modular values
- checkbox for excl. btw (-21%) calculation

2.9.4
- stack-height prices treated as complete stack prices
- cost formula shown explicitly in modular summary and notes

2.9.3
- dropdown to choose any modular sweep configuration
- apply selected modular sweep result to UI

2.9.2
- modular sweep now includes phase setup 1/2/3
- modular recommendation applies phase + stack height
- modular heatmap shows phase versus stack height

2.9.1
- stack-height pricing 1 to 6
- snapped capacity now includes base + modules
- expanded Zendure and Indevolt presets

2.9.0
- modular phase-aware battery pricing model
- Zendure AC+ and Indevolt PowerFlex 2000 presets
- apply modular setup to capacity and power

2.8.4
- monthly peak-aware optimisation
- monthly peak tariff cost in hybrid modes
- monthly peak cost shown in notes


2.3.0
- preset manager added
- optimal peak shaving solver
- local multi-preset save/load/delete/export

2.2.1
- version popup restored
- changelog viewer restored
- save/load preset as JSON file
- peak shaving optimisation mode
- grid tariff optimisation objective
- capacity × power optimisation heatmap
- iPad-friendly preset save via native share/save flow

2.7.0
- repaired heatmap
- repaired cycles, lifetime and peak KPIs

2.0.0
- repaired project baseline
`;
