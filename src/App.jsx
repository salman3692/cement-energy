import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import Papa from "papaparse";

// CSV rows (match exactly)
const EMISSIONS_ROW = "Emissions Impact (right y-axis)";
const TOTAL_ENERGY_ROW = "total energy";

// Desired stack order
const ENERGY_COMPONENT_ORDER = [
  "Fuel Demand Process",
  "P-Process",
  "Fuel Demand boiler",
  "Fuel Demand (CC-CaL)",
  "P-MEA",
  "P-Heat Pumps",
  "P-CPU",
  "P-ASU",
  "Heat Recovered",
  "Power Recovered",
];

// Force recovered below zero (only if your CSV ever has them positive)
const FORCE_NEGATIVE_ROWS = new Set(["Power Recovered", "Heat Recovered"]);

// Fixed distinct colours per component
const COLOR_MAP = {
  "Fuel Demand Process": "#c12d2d",
  "Fuel Demand boiler": "#000000",
  "Fuel Demand (CC-CaL)": "#2f6e64",
  "P-MEA": "#d5d233",
  "P-Heat Pumps": "#44aa44",
  "P-CPU": "#1cf280",
  "P-ASU": "#5646ff",
  "Heat Recovered": "#8b81f9",
  "Power Recovered": "#bf5c5c",
  [EMISSIONS_ROW]: "#000000",
};

// Global font size for the chart
const GLOBAL_FONT_SIZE = 14;
const GLOBAL_FONT_FAMILY = "segoe ui, helvetica, arial, sans-serif";

function toNum(v) {
  if (v == null) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// Excel-like auto-rotation by number of configs
function getXLabelRotation(n) {
  if (n <= 6) return 0; // horizontal
  if (n <= 10) return 25;
  if (n <= 14) return 45;
  if (n <= 20) return 60;
  if (n <= 26) return 75;
  return 89.5; // max
}

export default function App() {
  const [raw, setRaw] = useState([]);
  const [configs, setConfigs] = useState([]);

  // Selected configs (checkbox dropdown controls what appears on x-axis)
  const [selected, setSelected] = useState([]);

  // Dropdown
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Search inside dropdown
  const [search, setSearch] = useState("");

  // Load CSV from public/
  useEffect(() => {
    Papa.parse("/EnergyBreakdown.csv", {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        if (!res?.meta?.fields?.length) {
          console.error("CSV did not load. Check public/EnergyBreakdown.csv");
          return;
        }
        const rows = res.data;
        setRaw(rows);

        const cols = (res.meta.fields || []).filter((c) => c && c !== "Unnamed: 0");
        setConfigs(cols);

        // Default: all selected
        setSelected(cols);
      },
      error: (err) => console.error("CSV parse error:", err),
    });
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function onDocClick(e) {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const rowKey = "Unnamed: 0";

  const rowMap = useMemo(() => {
    const m = {};
    for (const r of raw) {
      const name = r?.[rowKey];
      if (name) m[name] = r;
    }
    return m;
  }, [raw]);

  const energyRows = useMemo(() => {
    if (!raw.length) return [];
    const allNames = raw.map((r) => r?.[rowKey]).filter(Boolean);
    const available = new Set(allNames);

    const ordered = ENERGY_COMPONENT_ORDER.filter((n) => available.has(n));
    const extras = allNames.filter(
      (n) => n && n !== TOTAL_ENERGY_ROW && n !== EMISSIONS_ROW && !ordered.includes(n)
    );

    return Array.from(new Set([...ordered, ...extras])).filter(
      (n) => n !== TOTAL_ENERGY_ROW && n !== EMISSIONS_ROW
    );
  }, [raw]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Filtered configs for dropdown list
  const filteredConfigs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return configs;
    return configs.filter((c) => c.toLowerCase().includes(q));
  }, [configs, search]);

  // "(Select All)" checkbox behaviour
  const allSelected = selected.length === configs.length && configs.length > 0;

  function toggleSelectAll() {
    if (allSelected) setSelected([]);
    else setSelected(configs.slice(0, 32));
  }

  function toggleConfig(c) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(c)) s.delete(c);
      else {
        if (s.size >= 32) return prev;
        s.add(c);
      }
      return Array.from(s);
    });
  }

  function clearAll() {
    setSelected([]);
  }

  // X-axis categories = selected only
  const xCategories = selected;
  const xRotate = getXLabelRotation(xCategories.length);

  // Auto grid bottom so labels never overlap the legend
  const gridBottom = xRotate === 0 ? 30 : xRotate >= 45 ? 50 : 50;

  const energySeries = useMemo(() => {
    return energyRows.map((rowName) => ({
      name: rowName,
      type: "bar",
      stack: "energy",
      barMaxWidth: 40,
      itemStyle: { color: COLOR_MAP[rowName] || "#999999" },
      emphasis: { focus: "series" },
      data: xCategories.map((c) => {
        const v = toNum(rowMap?.[rowName]?.[c]);
        return FORCE_NEGATIVE_ROWS.has(rowName) ? -Math.abs(v) : v;
      }),
    }));
  }, [energyRows, xCategories, rowMap]);

  const emissions = useMemo(() => {
    return xCategories.map((c) => toNum(rowMap?.[EMISSIONS_ROW]?.[c]));
  }, [xCategories, rowMap]);

  const option = useMemo(() => {
    return {
      backgroundColor: "#ffffff",

      // global default for all text in the plot
      textStyle: { fontSize: GLOBAL_FONT_SIZE, fontFamily: GLOBAL_FONT_FAMILY, color: "#111" },

      tooltip: {
        trigger: "item",
        textStyle: { fontSize: GLOBAL_FONT_SIZE, fontFamily: GLOBAL_FONT_FAMILY },
        formatter: (p) => {
          const cfg = p?.name ?? "";
          const series = p?.seriesName ?? "";
          const val = p?.value;

          if (series === EMISSIONS_ROW) {
            return `<b>${cfg}</b><br/>Emissions: <b>${Number(val).toFixed(
              3
            )}</b> tCO₂/t clinker`;
          }
          return `<b>${cfg}</b><br/>${series}: <b>${Number(val).toFixed(
            3
          )}</b> GJ/t clinker`;
        },
      },

      // legend: centered at the top with gap from plot
      legend: {
        // type: "scroll",
        orient: "horizontal",
        left: "center",
        top: 12,
        itemGap: 20,
        itemWidth: 18,
        itemHeight: 10,
        textStyle: { color: "#111", fontSize: GLOBAL_FONT_SIZE, fontFamily: GLOBAL_FONT_FAMILY },
      },

      // grid: adjust top to leave room for the legend
      grid: { left: 60, right: 60, top: 95, bottom: gridBottom, containLabel: true },

      xAxis: {
        type: "category",
        data: xCategories,
        axisLabel: {
          rotate: xRotate,
          color: "#111",
          interval: 0,
          margin: 14,
          fontSize: GLOBAL_FONT_SIZE,
          fontFamily: GLOBAL_FONT_FAMILY,
        },
        nameTextStyle: { fontSize: GLOBAL_FONT_SIZE, fontFamily: GLOBAL_FONT_FAMILY },
        axisLine: { lineStyle: { color: "#111" } },
      },

      yAxis: [
        {
          type: "value",
          name: "Energy (Demand or Supply) - GJ/t clinker",
          position: "left",
          min: -3,
          max: 9,
          interval: 1,

          //Title along the axis
          nameLocation: "middle",
          nameRotate: 90,
          nameGap: 40,

          nameTextStyle: { color: "#111", fontSize: GLOBAL_FONT_SIZE, fontFamily: "segoe ui semibold" },
          axisLabel: { color: "#111", fontSize: GLOBAL_FONT_SIZE, fontFamily: GLOBAL_FONT_FAMILY },
          splitLine: { lineStyle: { color: "#e6e6e6" } },
        },
        {
          type: "value",
          name: "Total Emissions (Scope 1 & 2) - tCO₂/t clinker",
          position: "right",
          min: -0.3,
          max: 0.9,
          interval: 0.1,

          // ✅ Title along the axis
          nameLocation: "middle",
          nameRotate: -90,
          nameGap: 40,

          // changed font family to segoe ui semibold as requested
          nameTextStyle: { color: "#111", fontSize: GLOBAL_FONT_SIZE, fontFamily: "segoe ui semibold" },
          axisLabel: { color: "#111", fontSize: GLOBAL_FONT_SIZE, fontFamily: GLOBAL_FONT_FAMILY },
          splitLine: { show: false },
        },
      ],

      series: xCategories.length
        ? [
            ...energySeries,
            {
              name: EMISSIONS_ROW,
              type: "scatter",
              yAxisIndex: 1,
              data: emissions,
              symbol: "circle",
              symbolSize: 9,
              itemStyle: { color: COLOR_MAP[EMISSIONS_ROW] || "#000" },
              z: 10,
            },
          ]
        : [],
    };
  }, [xCategories, xRotate, gridBottom, energySeries, emissions]);

  return (
    <div style={{ background: "#fff", minHeight: "100vh", padding: 16, width: "100%" }}>
      {/* Controls (fixed width: 1000 like your website) */}
      <div style={{ maxWidth: 1000, margin: "0 auto 12px auto" }}>
        <div style={{ color: "#111", marginBottom: 6 }}>Configurations</div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {/* Excel-like dropdown anchored under the button */}
          <div ref={dropdownRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              style={{
                width: 420,
                height: 36,
                borderRadius: 6,
                border: "1px solid #bbb",
                padding: "0 10px",
                background: "#fff",
                color: "#111",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              {selected.length === 0 ? "Select configurations..." : `${selected.length} selected`}
              <span style={{ float: "right", opacity: 0.7 }}>{open ? "▲" : "▼"}</span>
            </button>

            {open && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 40,
                  width: 420,
                  border: "1px solid #bbb",
                  borderRadius: 6,
                  background: "#fff",
                  padding: 8,
                  boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                  zIndex: 9999,
                }}
              >
                {/* Search */}
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                  style={{
                    width: "100%",
                    height: 30,
                    borderRadius: 4,
                    border: "1px solid #ccc",
                    padding: "0 8px",
                    outline: "none",
                    color: "#111",
                    background: "#fff",
                  }}
                />

                {/* Select all */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 2px 6px 2px",
                    color: "#111",
                    userSelect: "none",
                  }}
                >
                  <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
                  <b>(Select All)</b>
                </label>

                {/* Items */}
                <div
                  style={{
                    maxHeight: 230,
                    overflow: "auto",
                    borderTop: "1px solid #eee",
                    paddingTop: 6,
                    marginTop: 4,
                  }}
                >
                  {filteredConfigs.map((c) => {
                    const checked = selectedSet.has(c);
                    const disableAdd = !checked && selected.length >= 32;

                    return (
                      <label
                        key={c}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 2px",
                          color: "#111",
                          opacity: disableAdd ? 0.5 : 1,
                          cursor: disableAdd ? "not-allowed" : "pointer",
                          userSelect: "none",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disableAdd}
                          onChange={() => toggleConfig(c)}
                        />
                        <span style={{ color: "#111" }}>{c}</span>
                      </label>
                    );
                  })}
                </div>

                <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>Max 32 configs.</div>
              </div>
            )}
          </div>

          <button onClick={clearAll}>Clear</button>

          <div style={{ marginLeft: "auto", fontSize: 13, color: "#111" }}>
            Selected: <b>{selected.length}</b> / 32
          </div>
        </div>
      </div>

      {/* Fixed-size plot area: 1000 x 625 px */}
      <div
        style={{
          width: 1000,
          height: 625,
          margin: "0 auto",
          border: "1px solid #ddd",
          borderRadius: 10,
          background: "#fff",
        }}
      >
        <ReactECharts
          option={option}
          style={{ width: "100%", height: "100%" }}
          notMerge={true}
          lazyUpdate={true}
          opts={{ renderer: "svg" }}
        />
      </div>
    </div>
  );
}
