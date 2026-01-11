(() => {
/**
 * Andy Stats Clock
 * v1.0.0
 * ------------------------------------------------------------------
 * Developed by: Andreas ("AndyBonde") with some help from AI :).
 *
 * License / Disclaimer:
 * - Free to use, copy, modify, redistribute.
 * - Provided "AS IS" without warranty. No liability.
 * - Not affiliated with Home Assistant / Nabu Casa.
 * - Runs fully in the browser.
 *
 * Compatibility notes:
 * - Stats uses REST history endpoint via hass.callApi("GET", "history/period/...")
 *
 * Install: Se README.md in GITHUB
 *
 *
 */

  const CARD_TAG = "andy-stats-clock";
  const EDITOR_TAG = "andy-stats-clock-editor";

  console.info(
    `%c Andy Stats Clock %c v1.0.0 loaded `,
    "color: white; background: #4A148C; padding: 4px 8px; border-radius: 4px 0 0 4px;",
    "color: white; background: #6A1B9A; padding: 4px 8px; border-radius: 0 4px 4px 0;"
  );

  const fireEvent = (node, type, detail, options) => {
    options = options || {};
    detail = detail === null || detail === undefined ? {} : detail;
    const event = new Event(type, {
      bubbles: options.bubbles ?? true,
      cancelable: options.cancelable ?? false,
      composed: options.composed ?? true,
    });
    event.detail = detail;
    node.dispatchEvent(event);
    return event;
  };

  // ----------------------------------------------------------
  // Shared helpers / defaults
  // ----------------------------------------------------------

  const StatsClockDefaultConfig = {
    type: `custom:${CARD_TAG}`,
    clock_mode: "24h", // "24h" | "12h"
    show_hour_labels: true,
    start_angle: -7.5,
    end_angle: 352.5,
    radius: 45,
    layer_gap: 2,
    hands_center_pivot: false, // NY: gemensam hub i mitten

    // Bakåtkompatibel sweeper (hour hand)
    sweeper: {
      enabled: true,
      use_system_time: true,
      entity: "",
      color: "#FFFFFF",
      width: 1.5,
    },
    hour_sweeper: {
      enabled: true,
      use_system_time: true,
      entity: "",
      color: "#FFFFFF",
      width: 1.5,
    },

    // Minute hand
    minute_sweeper: {
      enabled: false,
      color: "#FFFFFF",
      width: 1.2,
    },

    // Second hand
    second_sweeper: {
      enabled: false,
      color: "#FF4081",
      width: 1.0,
    },

    style: {
      background: "var(--ha-card-background, rgba(0,0,0,0.4))",
      text_color: "var(--primary-text-color)",
      font_family:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    layers: [],
    center_layers: [],
    bottom_layers: [],
  };

  function deepMerge(target, source) {
    const out = { ...(target || {}) };
    Object.keys(source || {}).forEach((key) => {
      const sv = source[key];
      if (sv && typeof sv === "object" && !Array.isArray(sv)) {
        out[key] = deepMerge(out[key] || {}, sv);
      } else {
        out[key] = sv;
      }
    });
    return out;
  }

  function polarToCartesian(r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: r * Math.cos(rad),
      y: r * Math.sin(rad),
    };
  }

  function makeRingSegmentPath(rInner, rOuter, angleStart, angleEnd) {
    const startOuter = polarToCartesian(rOuter, angleStart);
    const endOuter = polarToCartesian(rOuter, angleEnd);
    const startInner = polarToCartesian(rInner, angleEnd);
    const endInner = polarToCartesian(rInner, angleStart);
    const sweepAngle = Math.abs(angleEnd - angleStart);
    const largeArc = sweepAngle <= 180 ? 0 : 1;
    const sweepFlag = angleEnd > angleStart ? 1 : 0;

    return [
      "M", startOuter.x, startOuter.y,
      "A", rOuter, rOuter, 0, largeArc, sweepFlag, endOuter.x, endOuter.y,
      "L", startInner.x, startInner.y,
      "A", rInner, rInner, 0, largeArc, sweepFlag ? 0 : 1, endInner.x, endInner.y,
      "Z",
    ].join(" ");
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  }

  function lerpColor(a, b, t) {
    try {
      const ca = hexToRgb(a);
      const cb = hexToRgb(b);
      const r = Math.round(ca.r + (cb.r - ca.r) * t);
      const g = Math.round(ca.g + (cb.g - ca.g) * t);
      const bb = Math.round(ca.b + (cb.b - ca.b) * t);
      return `rgb(${r},${g},${bb})`;
    } catch (e) {
      return a;
    }
  }

  function valueToIntervalColor(value, intervals) {
    if (!intervals || !intervals.length) return "#28c76f";
    if (value == null || isNaN(value)) {
      return intervals[0].color_from || intervals[0].color_to || "#28c76f";
    }

    let chosen = null;
    for (const intv of intervals) {
      const from = Number(intv.from);
      const to = Number(intv.to);
      if (!isNaN(from) && !isNaN(to) && value >= from && value < to) {
        chosen = intv;
        break;
      }
    }
    if (!chosen) {
      let last = intervals[0];
      for (const intv of intervals) {
        if (value >= intv.from) last = intv;
      }
      chosen = last;
    }

    const cf = chosen.color_from || chosen.color_to || "#28c76f";
    const ct = chosen.color_to || cf;
    const from = Number(chosen.from);
    const to = Number(chosen.to);
    if (isNaN(from) || isNaN(to) || from === to) return cf;

    const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
    return lerpColor(cf, ct, t);
  }

  function valueToGradientColor(value, min, max, gradient) {
    const from = (gradient && gradient.from) || "#28c76f";
    const to = (gradient && gradient.to) || "#ea5455";
    if (value == null || isNaN(value) || max === min) return from;
    const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
    return lerpColor(from, to, t);
  }

  function getEntityState(hass, entityId) {
    if (!hass || !entityId) return null;
    return hass.states[entityId] || null;
  }

  function parseAttributeArray(stateObj, attribute, valuePath) {
    if (!stateObj) return [];
    const attr = attribute || "today";
    const raw = stateObj.attributes[attr];
    if (!Array.isArray(raw)) return [];
    if (!valuePath) return raw.map((v) => Number(v));
    return raw.map((item) => {
      if (item && typeof item === "object" && valuePath in item) {
        return Number(item[valuePath]);
      }
      return Number(item);
    });
  }

  // ----------------------------------------------------------
  // CARD (DISPLAY)
  // ----------------------------------------------------------

  if (!customElements.get(CARD_TAG)) {
    class AndyStatsClockCard extends HTMLElement {
      constructor() {
        super();
        this._config = null;
        this._hass = null;
        this._historyCache = {};
        this.attachShadow({ mode: "open" });
      }

      static getConfigElement() {
        return document.createElement(EDITOR_TAG);
      }

      static getStubConfig(hass, entities) {
        const first = entities && entities.length ? entities[0] : "sensor.example";
        return deepMerge(StatsClockDefaultConfig, {
          clock_mode: "24h",
          layers: [
            {
              id: "price_today",
              name: "Price today",
              type: "price",
              entity: first,
              price_source: "array",
              attribute: "today",
              value_path: "value",
              radius: 45,
              thickness: 8,
              opacity: 1.0,
              color_mode: "intervals",
              segment_count: null,
              intervals: [
                { from: 0, to: 50, color_from: "#28c76f", color_to: "#9be15d" },
                { from: 50, to: 100, color_from: "#ff9f43", color_to: "#ffc26a" },
                { from: 100, to: 1000, color_from: "#ea5455", color_to: "#f86c7d" },
              ],
              gradient: {
                from: "#28c76f",
                to: "#ea5455",
              },
              stats_markers: {
                show_min: true,
                show_max: true,
                show_avg: false,
                color: "rgba(255,255,255,0.9)",
                font_size: 3,
                radius_offset: 2,
                decimals: 1,
                min_label: "",
                max_label: "",
                avg_label: "",
              },
            },
          ],
          center_layers: [
            {
              id: "time",
              type: "entity",
              entity: "sensor.time",
              show_icon: true,
              icon: "mdi:watch-variant",
              label_template: "<state>",
              decimals: 0,
              font_size: 26,
              font_weight: 700,
              color: "var(--primary-text-color)",
            },
            {
              id: "subtitle",
              type: "static",
              text: "Andy Stats Clock",
              font_size: 13,
              font_weight: 500,
              color: "var(--secondary-text-color)",
            },
          ],
          bottom_layers: [
            {
              id: "explanation",
              type: "static",
              text: "Price intensity over the next 24 hours",
              font_size: 11,
              font_weight: 400,
              color: "var(--secondary-text-color)",
            },
          ],
        });
      }

      setConfig(config) {
        if (!config) throw new Error("Configuration is required");
        this._config = deepMerge(StatsClockDefaultConfig, config);

        // Bakåtkompatibilitet: om gammal "sweeper" finns men ingen hour_sweeper → kopiera
        if (config.sweeper && !config.hour_sweeper) {
          this._config.hour_sweeper = deepMerge(
            this._config.hour_sweeper || {},
            config.sweeper
          );
        }

        if (!Array.isArray(this._config.layers)) this._config.layers = [];
        if (!Array.isArray(this._config.center_layers))
          this._config.center_layers = [];
        if (!Array.isArray(this._config.bottom_layers))
          this._config.bottom_layers = [];
        this._render();
      }

      set hass(hass) {
        this._hass = hass;
        this._render();
      }

      get hass() {
        return this._hass;
      }

      getCardSize() {
        return 3;
      }

      connectedCallback() {
        this._render();
      }

      disconnectedCallback() {}

      _getCurrentHourForClock(cfg, hass) {
        const sw = cfg.hour_sweeper || cfg.sweeper || {};
        if (sw.use_system_time || !sw.entity) {
          const now = new Date();
          return now.getHours();
        }
        const st = getEntityState(hass, sw.entity);
        if (st && !isNaN(Number(st.state))) {
          const v = Number(st.state);
          return ((v % 24) + 24) % 24;
        }
        const now = new Date();
        return now.getHours();
      }

      _getPeriodString(cfg, hass) {
        const mode = cfg.clock_mode || "24h";
        if (mode !== "12h") return "";
        const h = this._getCurrentHourForClock(cfg, hass);
        return h < 12 ? "AM" : "PM";
      }

      _getHistory24ForLayer(lc, hass, stateObj) {
        if (!hass || !lc || !lc.entity) return [];
        const entityId = lc.entity;
        const cacheKey = `${entityId}::today24`;
        const now = Date.now();
        const ttlMs = 5 * 60 * 1000;

        const existing = this._historyCache[cacheKey];
        if (existing && existing.values && now - existing.fetchedAt < ttlMs) {
          return existing.values;
        }

        if (existing && existing.loading) {
          return existing.values || [];
        }

        this._historyCache[cacheKey] = {
          loading: true,
          values: existing?.values || [],
        };

        try {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          const iso = start.toISOString();
          const url = `history/period/${iso}?filter_entity_id=${encodeURIComponent(
            entityId
          )}&minimal_response&significant_changes_only=0`;

          hass
            .callApi("GET", url)
            .then((res) => {
              let series = [];
              if (Array.isArray(res) && res.length > 0 && Array.isArray(res[0])) {
                series = res[0];
              }

              const buckets = new Array(24).fill(null);

              series.forEach((pt) => {
                const ts =
                  pt.last_updated ||
                  pt.last_changed ||
                  pt.time ||
                  pt.timestamp;
                const d = ts ? new Date(ts) : null;
                if (!d || isNaN(d.getTime())) return;
                const h = d.getHours();
                if (h < 0 || h > 23) return;
                const v = Number(pt.state);
                if (isNaN(v)) return;
                buckets[h] = v;
              });

              let last = null;
              for (let h = 0; h < 24; h++) {
                if (buckets[h] == null) {
                  buckets[h] = last;
                } else {
                  last = buckets[h];
                }
              }
              const hasAny = buckets.some((v) => v != null && !isNaN(v));
              let finalValues;
              if (!hasAny) {
                const cur = Number(stateObj.state);
                finalValues = isNaN(cur)
                  ? []
                  : new Array(24).fill(cur);
              } else {
                finalValues = buckets.map((v) =>
                  v == null || isNaN(v) ? Number(stateObj.state) : Number(v)
                );
              }

              this._historyCache[cacheKey] = {
                loading: false,
                fetchedAt: Date.now(),
                values: finalValues,
              };
              this._render();
            })
            .catch((err) => {
              console.error("Andy Stats Clock history error", err);
              const cur = Number(stateObj.state);
              const fallbackValues = isNaN(cur)
                ? []
                : new Array(24).fill(cur);
              this._historyCache[cacheKey] = {
                loading: false,
                fetchedAt: Date.now(),
                values: fallbackValues,
              };
              this._render();
            });
        } catch (e) {
          console.error("Andy Stats Clock history exception", e);
          const cur = Number(stateObj.state);
          const fallbackValues = isNaN(cur)
            ? []
            : new Array(24).fill(cur);
          this._historyCache[cacheKey] = {
            loading: false,
            fetchedAt: Date.now(),
            values: fallbackValues,
          };
        }

        return this._historyCache[cacheKey].values || [];
      }

      // ------------------------------------------------------
      // RENDER
      // ------------------------------------------------------

      _render() {
        if (!this.shadowRoot) return;
        const cfg = this._config;
        const hass = this._hass;

        this.shadowRoot.innerHTML = "";

        const style = document.createElement("style");
        style.textContent = `
          :host {
            display: block;
          }
          ha-card {
            position: relative;
            overflow: hidden;
            padding: 12px;
            box-sizing: border-box;
            background: var(--ha-card-background, rgba(0,0,0,0.3));
          }
          .wrapper {
            position: relative;
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          svg {
            width: 100%;
            height: auto;
            max-height: 400px;
            display: block;
          }
          .center-content {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            padding: 4px;
            text-align: center;
          }
          .center-line {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .center-line.icon-line {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
          }
          .center-line ha-icon {
            --mdc-icon-size: 18px;
          }
          .bottom-strip {
            margin-top: 8px;
            display: flex;
            flex-wrap: wrap;
            gap: 6px 12px;
            align-items: center;
            justify-content: center;
            text-align: center;
          }
          .bottom-item {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            max-width: 100%;
          }
          .bottom-item ha-icon {
            --mdc-icon-size: 16px;
          }

          .second-sweeper-group {
            transform-origin: 0 0;
            animation: stats-second-sweep 60s linear infinite;
          }

          @keyframes stats-second-sweep {
            from {
              transform: rotate(calc(var(--second-start-angle, 0) * 1deg));
            }
            to {
              transform: rotate(calc(var(--second-end-angle, 360) * 1deg));
            }
          }
        `;
        this.shadowRoot.appendChild(style);

        const card = document.createElement("ha-card");
        const wrapper = document.createElement("div");
        wrapper.classList.add("wrapper");
        card.appendChild(wrapper);
        this.shadowRoot.appendChild(card);

        if (!cfg || !hass) {
          card.innerHTML = "<div>Andy Stats Clock - not configured</div>";
          return;
        }

        const radius = cfg.radius || 45;
        const layers = this._buildLayerData(cfg, hass);
        const hourSweeper = this._buildHourSweeper(cfg, hass);
        const minuteSweeper = this._buildMinuteSweeper(cfg);
        const secondSweeper = this._buildSecondSweeper(cfg);
        const maxRadius = Math.max(
          radius + 4,
          ...layers.map((l) => l.rOuter + 4)
        );
        const viewSize = (maxRadius + 4) * 2;
        const viewMin = -maxRadius - 4;

        let svg = "";
        svg += `<svg viewBox="${viewMin} ${viewMin} ${viewSize} ${viewSize}" xmlns="http://www.w3.org/2000/svg">`;
        svg += `
          <defs>
            <filter id="stats-clock-glow">
              <feGaussianBlur stdDeviation="0.8" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        `;

        svg += `
          <circle
            cx="0"
            cy="0"
            r="${radius + 2}"
            fill="rgba(0,0,0,0.45)"
            stroke="rgba(255,255,255,0.06)"
            stroke-width="1.4"
          />
        `;

        // Ring-lager
        layers.forEach((layer) => {
          svg += this._renderLayerSvg(cfg, layer);
        });

        // Tim-/minut-/sekundvisare + gemensam hub
        const useCenterPivot = cfg.hands_center_pivot === true;

        if (cfg.show_hour_labels !== false) {
          svg += this._renderHourLabelsSvg(cfg, maxRadius - 2);
        }

        if (hourSweeper) {
          svg += this._renderHourSweeperSvg(hourSweeper, maxRadius - 4, useCenterPivot);
        }

        if (minuteSweeper) {
          svg += this._renderMinuteSweeperSvg(minuteSweeper, maxRadius - 3, useCenterPivot);
        }

        if (secondSweeper) {
          svg += this._renderSecondSweeperSvgSmooth(cfg, secondSweeper, maxRadius - 2, useCenterPivot);
        }

        if (useCenterPivot) {
          svg += `
            <circle
              cx="0"
              cy="0"
              r="2.3"
              fill="rgba(0,0,0,0.7)"
              stroke="rgba(255,255,255,0.9)"
              stroke-width="0.5"
            ></circle>
          `;
        }

        svg += `</svg>`;

        wrapper.innerHTML = svg;

        const centerDiv = document.createElement("div");
        centerDiv.classList.add("center-content");
        centerDiv.style.color =
          cfg.style.text_color || "var(--primary-text-color)";
        centerDiv.style.fontFamily =
          cfg.style.font_family ||
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

        const centerHtml = this._renderCenterLayersHtml(cfg, hass);
        centerDiv.innerHTML = centerHtml;
        wrapper.appendChild(centerDiv);

        const bottomDiv = document.createElement("div");
        bottomDiv.classList.add("bottom-strip");
        bottomDiv.innerHTML = this._renderBottomLayersHtml(cfg, hass);
        card.appendChild(bottomDiv);

        card.style.background = cfg.style.background || card.style.background;
      }

      // ---- building data ----

      _buildLayerData(cfg, hass) {
        const layers = [];
        const clockMode = cfg.clock_mode || "24h";
        const currentHour = this._getCurrentHourForClock(cfg, hass);

        (cfg.layers || []).forEach((lc, index) => {
          const baseRadius =
            (lc.radius != null ? lc.radius : cfg.radius) -
            index * ((lc.thickness || 6) + (cfg.layer_gap || 2));
          const thickness = lc.thickness || 6;
          const rOuter = baseRadius;
          const rInner = baseRadius - thickness;

          const stateObj = getEntityState(hass, lc.entity);
          if (!stateObj) return;

          const rawValues = this._resolveLayerValues(lc, hass, stateObj);
          if (!rawValues || !rawValues.length) return;

          let values = rawValues;
          if (clockMode === "12h") {
            if (rawValues.length >= 24) {
              const isDay = currentHour >= 12;
              const start = isDay ? 12 : 0;
              const end = start + 12;
              values = rawValues.slice(start, end);
            } else {
              values = rawValues.slice(0, Math.min(12, rawValues.length));
            }
          }

          const unit =
            stateObj.attributes.unit_of_measurement ||
            stateObj.attributes.price_unit ||
            stateObj.attributes.unit ||
            "";

          let min = null;
          let max = null;
          let sum = 0;
          let count = 0;
          let minIndex = -1;
          let maxIndex = -1;

          values.forEach((v, i) => {
            const num = Number(v);
            if (isNaN(num)) return;
            if (min === null || num < min) {
              min = num;
              minIndex = i;
            }
            if (max === null || num > max) {
              max = num;
              maxIndex = i;
            }
            sum += num;
            count += 1;
          });

          const avg = count > 0 ? sum / count : null;
          let avgIndex = -1;
          if (avg != null) {
            let bestDiff = null;
            values.forEach((v, i) => {
              const num = Number(v);
              if (isNaN(num)) return;
              const diff = Math.abs(num - avg);
              if (bestDiff === null || diff < bestDiff) {
                bestDiff = diff;
                avgIndex = i;
              }
            });
          }

          const segmentCount =
            lc.segment_count && Number(lc.segment_count) > 0
              ? Number(lc.segment_count)
              : clockMode === "12h"
                ? 12
                : values.length;

          layers.push({
            cfg: lc,
            values,
            min,
            max,
            avg,
            minIndex,
            maxIndex,
            avgIndex,
            rInner,
            rOuter,
            unit,
            segmentCount,
          });
        });
        return layers;
      }

      _resolveLayerValues(lc, hass, stateObj) {
        const entityId = lc.entity;
        const type = lc.type || "price";
        const st = stateObj || getEntityState(hass, entityId);
        if (!entityId || !st) return [];

        if (type === "price" && lc.price_source === "array") {
          const vals = parseAttributeArray(
            st,
            lc.attribute || "today",
            lc.value_path || "value"
          );
          return vals.filter((v) => v != null && !isNaN(v));
        }

        if (
          lc.price_source === "history" ||
          type === "consumption" ||
          type === "history"
        ) {
          const attrName = lc.attribute || "";
          if (attrName && Array.isArray(st.attributes[attrName])) {
            return st.attributes[attrName]
              .map((v) => Number(v))
              .filter((v) => !isNaN(v));
          }

          const s = st.state;
          if (s && typeof s === "string" && s.trim().startsWith("[")) {
            try {
              const json = JSON.parse(s);
              if (Array.isArray(json)) {
                return json.filter((v) => v != null && !isNaN(v)).map(Number);
              }
            } catch (e) {}
          }

          const historyVals = this._getHistory24ForLayer(lc, hass, st);
          if (historyVals && historyVals.length) {
            return historyVals;
          }

          const val = Number(s);
          return isNaN(val) ? [] : [val];
        }

        return [];
      }

      // ---- svg rendering ----

      _renderLayerSvg(cfg, layer) {
        const {
          values,
          min,
          max,
          rInner,
          rOuter,
          cfg: lc,
          unit,
          minIndex,
          maxIndex,
          avgIndex,
          avg,
          segmentCount,
        } = layer;
        const n = values.length;
        if (!n) return "";
        const span = cfg.end_angle - cfg.start_angle;
        const segments = segmentCount || n;
        const step = span / segments;
        let segs = "";

        for (let i = 0; i < n; i++) {
          const val = values[i];
          const angleStart = cfg.start_angle + step * i;
          const angleEnd = cfg.start_angle + step * (i + 1);

          let color = "#28c76f";
          if (lc.color_mode === "gradient") {
            color = valueToGradientColor(val, min, max, lc.gradient);
          } else {
            const intervals =
              lc.intervals && lc.intervals.length
                ? lc.intervals
                : [
                    { from: 0, to: 50, color_from: "#28c76f", color_to: "#9be15d" },
                    { from: 50, to: 100, color_from: "#ff9f43", color_to: "#ffc26a" },
                    {
                      from: 100,
                      to: 1000,
                      color_from: "#ea5455",
                      color_to: "#f86c7d",
                    },
                  ];
            color = valueToIntervalColor(val, intervals);
          }

          const path = makeRingSegmentPath(rInner, rOuter, angleStart, angleEnd);
          const opacity = lc.opacity != null ? lc.opacity : 1.0;

          segs += `
            <path
              d="${path}"
              fill="${color}"
              fill-opacity="${opacity}"
              stroke="rgba(0,0,0,0.3)"
              stroke-width="0.1"
              filter="url(#stats-clock-glow)"
            ></path>
          `;
        }

        const markersCfg = lc.stats_markers || {};
        let markersSvg = "";
        const markerColor = markersCfg.color || "rgba(255,255,255,0.9)";
        const decimals =
          markersCfg.decimals !== undefined && markersCfg.decimals !== null
            ? Number(markersCfg.decimals)
            : 1;
        const radiusOffset = markersCfg.radius_offset;
        const fontSize = markersCfg.font_size;
        const minLabel = markersCfg.min_label ?? "";
        const maxLabel = markersCfg.max_label ?? "";
        const avgLabel = markersCfg.avg_label ?? "";

        if (markersCfg.show_min && minIndex >= 0 && min != null) {
          markersSvg += this._renderStatsMarker(
            cfg,
            layer,
            minIndex,
            min,
            unit,
            "min",
            markerColor,
            decimals,
            radiusOffset,
            fontSize,
            minLabel
          );
        }
        if (markersCfg.show_max && maxIndex >= 0 && max != null) {
          markersSvg += this._renderStatsMarker(
            cfg,
            layer,
            maxIndex,
            max,
            unit,
            "max",
            markerColor,
            decimals,
            radiusOffset,
            fontSize,
            maxLabel
          );
        }
        if (markersCfg.show_avg && avgIndex >= 0 && avg != null) {
          markersSvg += this._renderStatsMarker(
            cfg,
            layer,
            avgIndex,
            avg,
            unit,
            "avg",
            markerColor,
            decimals,
            radiusOffset,
            fontSize,
            avgLabel
          );
        }

        return segs + markersSvg;
      }

      _renderStatsMarker(
        cfg,
        layer,
        idx,
        value,
        unit,
        type,
        color,
        decimals,
        radiusOffset,
        fontSize,
        label
      ) {
        const n = layer.values.length;
        if (!n) return "";
        const span = cfg.end_angle - cfg.start_angle;
        const segments = layer.segmentCount || n;
        const step = span / segments;
        const angleCenter = cfg.start_angle + step * (idx + 0.5);

        const offset = radiusOffset != null ? Number(radiusOffset) : 2;
        const rDot = layer.rOuter + offset;
        const rText = rDot + 4;

        const pDot = polarToCartesian(rDot, angleCenter);
        const pText = polarToCartesian(rText, angleCenter);

        let valStr;
        if (isNaN(value)) {
          valStr = String(value);
        } else if (!isNaN(decimals)) {
          valStr = Number(value).toFixed(decimals);
        } else {
          valStr = String(value);
        }
        if (unit) valStr += unit;

        let textStr = valStr;
        if (label && label.trim() !== "") {
          textStr = `${label.trim()} ${valStr}`;
        }

        const size = fontSize != null ? Number(fontSize) : 3;

        return `
          <circle
            cx="${pDot.x}"
            cy="${pDot.y}"
            r="1.1"
            fill="${color}"
          ></circle>
          <text
            x="${pText.x}"
            y="${pText.y}"
            text-anchor="middle"
            alignment-baseline="middle"
            font-size="${size}"
            fill="${color}"
          >
            ${textStr}
          </text>
        `;
      }

      _renderHourLabelsSvg(cfg, r) {
        const mode = cfg.clock_mode || "24h";
        let out = "";

        if (mode === "12h") {
          const hours = 12;
          const span = cfg.end_angle - cfg.start_angle;
          const step = span / hours;
          for (let i = 0; i < hours; i++) {
            const angleCenter = cfg.start_angle + step * (i + 0.5);
            const p = polarToCartesian(r, angleCenter);
            const label = i === 0 ? 12 : i;
            out += `
              <text
                x="${p.x}"
                y="${p.y + 2}"
                text-anchor="middle"
                alignment-baseline="middle"
                font-size="4"
                fill="rgba(255,255,255,0.7)"
              >
                ${label}
              </text>
            `;
          }
          return out;
        }

        const hours = 24;
        const span = cfg.end_angle - cfg.start_angle;
        const step = span / hours;

        for (let i = 0; i < hours; i++) {
          const angleCenter = cfg.start_angle + step * (i + 0.5);
          const p = polarToCartesian(r, angleCenter);
          const label = i;

          out += `
            <text
              x="${p.x}"
              y="${p.y + 2}"
              text-anchor="middle"
              alignment-baseline="middle"
              font-size="4"
              fill="rgba(255,255,255,0.7)"
            >
              ${label}
            </text>
          `;
        }
        return out;
      }

      // --------- Hour / Minute / Second sweepers ---------

      _buildHourSweeper(cfg, hass) {
        const sw = cfg.hour_sweeper || cfg.sweeper || {};
        if (!sw.enabled) return null;

        const clockMode = cfg.clock_mode || "24h";
        let hourFraction = 0;

        if (sw.use_system_time) {
          const now = new Date();
          hourFraction = now.getHours() + now.getMinutes() / 60;
        } else if (sw.entity) {
          const st = getEntityState(hass, sw.entity);
          if (st && !isNaN(Number(st.state))) hourFraction = Number(st.state);
        }

        let totalHours = 24;
        if (clockMode === "12h") {
          hourFraction = ((hourFraction % 12) + 12) % 12;
          totalHours = 12;
        }

        const t =
          ((hourFraction % totalHours) + totalHours) % totalHours / totalHours;

        const span = cfg.end_angle - cfg.start_angle || 360;
        const step = span / totalHours;
        const angle = cfg.start_angle + span * t + step / 2;

        return {
          angle,
          color: sw.color || "#FFFFFF",
          width: sw.width || 1.5,
        };
      }

      _buildMinuteSweeper(cfg) {
        const ms = cfg.minute_sweeper || {};
        if (!ms.enabled) return null;

        const now = new Date();
        const minutes = now.getMinutes() + now.getSeconds() / 60;
        const t = minutes / 60; // 0..1 per timme

        const span = cfg.end_angle - cfg.start_angle || 360;
        const angle = cfg.start_angle + span * t;

        return {
          angle,
          color: ms.color || "#FFFFFF",
          width: ms.width || 1.2,
        };
      }

      _buildSecondSweeper(cfg) {
        const sw = cfg.second_sweeper || {};
        if (!sw.enabled) return null;
        const now = new Date();
        const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
        return {
          seconds,
          color: sw.color || "#FF4081",
          width: sw.width || 1.0,
        };
      }

      _renderHourSweeperSvg(sw, radius, centerPivot) {
        const inner = centerPivot ? 0 : radius * 0.1;
        const outer = radius;
        const pInner = polarToCartesian(inner, sw.angle);
        const pOuter = polarToCartesian(outer, sw.angle);

        return `
          <line
            x1="${pInner.x}"
            y1="${pInner.y}"
            x2="${pOuter.x}"
            y2="${pOuter.y}"
            stroke="${sw.color}"
            stroke-width="${sw.width}"
            stroke-linecap="round"
          ></line>
          <circle
            cx="${pOuter.x}"
            cy="${pOuter.y}"
            r="1.3"
            fill="${sw.color}"
          ></circle>
        `;
      }

      _renderMinuteSweeperSvg(sw, radius, centerPivot) {
        const inner = centerPivot ? 0 : radius * 0.06;
        const outer = radius - 1.5;
        const pInner = polarToCartesian(inner, sw.angle);
        const pOuter = polarToCartesian(outer, sw.angle);

        return `
          <line
            x1="${pInner.x}"
            y1="${pInner.y}"
            x2="${pOuter.x}"
            y2="${pOuter.y}"
            stroke="${sw.color}"
            stroke-width="${sw.width}"
            stroke-linecap="round"
          ></line>
        `;
      }

      _renderSecondSweeperSvgSmooth(cfg, sw, radius, centerPivot) {
        const inner = centerPivot ? 0 : radius * 0.1;
        const outer = radius;
        return `
          <g
            class="second-sweeper-group"
            style="
              --second-start-angle:${cfg.start_angle};
              --second-end-angle:${cfg.end_angle};
              animation-delay:-${sw.seconds}s;
            "
          >
            <line
              x1="0"
              y1="${-inner}"
              x2="0"
              y2="${-outer}"
              stroke="${sw.color}"
              stroke-width="${sw.width}"
              stroke-linecap="round"
            ></line>
            <circle
              cx="0"
              cy="${-outer}"
              r="1.3"
              fill="${sw.color}"
            ></circle>
          </g>
        `;
      }

      _renderCenterLayersHtml(cfg, hass) {
        const layers = cfg.center_layers || [];
        let htmlStr = "";
        const period = this._getPeriodString(cfg, hass);

        layers.forEach((lc) => {
          let text = "";
          let icon = null;

          if (lc.type === "entity") {
            const st = getEntityState(hass, lc.entity);
            const tpl = lc.label_template || "<state>";
            if (st) {
              const attrs = st.attributes || {};
              const unit = attrs.unit_of_measurement || "";
              const rawState = st.state != null ? String(st.state) : "";
              let stateForTpl = rawState;
              const num = Number(rawState);
              if (!isNaN(num) && lc.decimals != null && lc.decimals !== "") {
                const dec = Number(lc.decimals);
                stateForTpl = isNaN(dec) ? rawState : num.toFixed(dec);
              }

              text = tpl
                .replace(/<state>/g, stateForTpl)
                .replace(/<raw_state>/g, rawState)
                .replace(/<unit>/g, unit)
                .replace(
                  /<name>/g,
                  st.attributes.friendly_name || lc.entity || ""
                )
                .replace(/<time>/g, new Date().toLocaleTimeString())
                .replace(/<period>/g, period);

              if (lc.show_icon) {
                icon = lc.icon || attrs.icon || "";
              }
            } else {
              text = (lc.label_template || "<state>").replace(/<period>/g, period);
            }
          } else if (lc.type === "static") {
            const baseText = lc.text || "";
            text = baseText.replace(/<period>/g, period);
          }

          if (!text) return;

          const style = [
            `font-size:${lc.font_size || 14}px`,
            `font-weight:${lc.font_weight || 400}`,
            `color:${lc.color || "var(--primary-text-color)"}`,
          ].join(";");

          const cls = icon ? "center-line icon-line" : "center-line";

          if (icon) {
            htmlStr += `
              <div class="${cls}" style="${style}">
                <ha-icon icon="${icon}"></ha-icon>
                <span>${text}</span>
              </div>
            `;
          } else {
            htmlStr += `<div class="${cls}" style="${style}">${text}</div>`;
          }
        });

        return htmlStr;
      }

      _renderBottomLayersHtml(cfg, hass) {
        const layers = cfg.bottom_layers || [];
        let htmlStr = "";
        const period = this._getPeriodString(cfg, hass);

        layers.forEach((lc) => {
          let text = "";
          let icon = null;

          if (lc.type === "entity") {
            const st = getEntityState(hass, lc.entity);
            const tpl = lc.label_template || "<name>: <state><unit>";
            if (st) {
              const attrs = st.attributes || {};
              const unit = attrs.unit_of_measurement || "";
              const rawState = st.state != null ? String(st.state) : "";
              let stateForTpl = rawState;
              const num = Number(rawState);
              if (!isNaN(num) && lc.decimals != null && lc.decimals !== "") {
                const dec = Number(lc.decimals);
                stateForTpl = isNaN(dec) ? rawState : num.toFixed(dec);
              }

              text = tpl
                .replace(/<state>/g, stateForTpl)
                .replace(/<raw_state>/g, rawState)
                .replace(/<unit>/g, unit)
                .replace(
                  /<name>/g,
                  st.attributes.friendly_name || lc.entity || ""
                )
                .replace(/<time>/g, new Date().toLocaleTimeString())
                .replace(/<period>/g, period);

              if (lc.show_icon) {
                icon = lc.icon || attrs.icon || "";
              }
            } else {
              text = (lc.label_template || "<name>: <state><unit>").replace(
                /<period>/g,
                period
              );
            }
          } else if (lc.type === "static") {
            const baseText = lc.text || "";
            text = baseText.replace(/<period>/g, period);
          }

          if (!text) return;

          const style = [
            `font-size:${lc.font_size || 11}px`,
            `font-weight:${lc.font_weight || 400}`,
            `color:${lc.color || "var(--secondary-text-color)"}`,
          ].join(";");

          if (icon) {
            htmlStr += `
              <div class="bottom-item" style="${style}">
                <ha-icon icon="${icon}"></ha-icon>
                <span>${text}</span>
              </div>
            `;
          } else {
            htmlStr += `<div class="bottom-item" style="${style}">${text}</div>`;
          }
        });

        return htmlStr;
      }
    }

    customElements.define(CARD_TAG, AndyStatsClockCard);

    window.customCards = window.customCards || [];
    if (!window.customCards.some((c) => c.type === CARD_TAG)) {
      window.customCards.push({
        type: CARD_TAG,
        name: "Andy Stats Clock",
        description:
          "Layer-based statistics clock for prices, consumption and sensors.",
      });
    }
  }

  // ----------------------------------------------------------
  // EDITOR (VISUAL)
  // ----------------------------------------------------------

  if (!customElements.get(EDITOR_TAG)) {
    const LitBase =
      customElements.get("hui-masonry-view") ||
      customElements.get("ha-panel-lovelace");
    const LitElement = Object.getPrototypeOf(LitBase);
    const html = LitElement.prototype.html;
    const css = LitElement.prototype.css;

    class AndyStatsClockEditor extends LitElement {
      static get properties() {
        return {
          hass: {},
          _config: {},
          _expandedLayerIndex: { type: Number },
          _expandedCenterIndex: { type: Number },
          _expandedBottomIndex: { type: Number },
        };
      }

      constructor() {
        super();
        this._config = deepMerge(StatsClockDefaultConfig, {});
        this._expandedLayerIndex = 0;
        this._expandedCenterIndex = 0;
        this._expandedBottomIndex = 0;
      }

      setConfig(config) {
        this._config = deepMerge(StatsClockDefaultConfig, config || {});

        // Bakåtkompatibelt import av sweeper → hour_sweeper
        if (config && config.sweeper && !config.hour_sweeper) {
          this._config.hour_sweeper = deepMerge(
            this._config.hour_sweeper || {},
            config.sweeper
          );
        }

        if (!Array.isArray(this._config.layers)) this._config.layers = [];
        if (!Array.isArray(this._config.center_layers))
          this._config.center_layers = [];
        if (!Array.isArray(this._config.bottom_layers))
          this._config.bottom_layers = [];
      }

      get hass() {
        return this._hass;
      }

      set hass(hass) {
        this._hass = hass;
        this.requestUpdate();
      }

      _emitConfigChanged() {
        fireEvent(this, "config-changed", { config: this._config });
      }

      _stopPropagation(ev) {
        ev.stopPropagation();
      }

      _normalizeColorInput(val) {
        if (typeof val !== "string") return "#ffffff";
        const t = val.trim();
        const m = t.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
        return m ? m[0] : "#ffffff";
      }

      _mkEntityControl(label, value, onChange) {
        const stop = (e) => e.stopPropagation();
        const hasSelector = !!customElements.get("ha-selector");

        if (hasSelector) {
          const sel = document.createElement("ha-selector");
          sel.label = label;
          sel.selector = { entity: {} };
          sel.value = value;
          sel.hass = this.hass;
          sel.addEventListener("value-changed", (e) => {
            const v = e.detail?.value ?? e.target.value;
            onChange(v);
          });
          sel.addEventListener("click", stop);
          return sel;
        }

        const ep = document.createElement("ha-entity-picker");
        ep.label = label;
        ep.allowCustomEntity = true;
        ep.value = value;
        ep.hass = this.hass;
        ep.addEventListener("value-changed", (e) => {
          const v = e.detail?.value ?? e.target.value;
          onChange(v);
        });
        ep.addEventListener("click", stop);
        return ep;
      }

      updated() {
        const root = this.renderRoot;
        const cfg = this._config;

        (cfg.layers || []).forEach((layer, idx) => {
          const container = root.querySelector(
            `#layer-entity-picker-${idx}`
          );
          if (container && !container._controlAttached) {
            container.innerHTML = "";
            const ctrl = this._mkEntityControl(
              "Entity",
              layer.entity || "",
              (val) => {
                this._config.layers[idx].entity = val;
                this._emitConfigChanged();
              }
            );
            container.appendChild(ctrl);
            container._controlAttached = true;
          }
        });

        (cfg.center_layers || []).forEach((cl, idx) => {
          if (cl.type !== "entity") return;
          const container = root.querySelector(
            `#center-entity-picker-${idx}`
          );
          if (container && !container._controlAttached) {
            container.innerHTML = "";
            const ctrl = this._mkEntityControl(
              "Entity",
              cl.entity || "",
              (val) => {
                this._config.center_layers[idx].entity = val;
                this._emitConfigChanged();
              }
            );
            container.appendChild(ctrl);
            container._controlAttached = true;
          }
        });

        (cfg.bottom_layers || []).forEach((cl, idx) => {
          if (cl.type !== "entity") return;
          const container = root.querySelector(
            `#bottom-entity-picker-${idx}`
          );
          if (container && !container._controlAttached) {
            container.innerHTML = "";
            const ctrl = this._mkEntityControl(
              "Entity",
              cl.entity || "",
              (val) => {
                this._config.bottom_layers[idx].entity = val;
                this._emitConfigChanged();
              }
            );
            container.appendChild(ctrl);
            container._controlAttached = true;
          }
        });
      }

      static get styles() {
        return css`
          :host {
            display: block;
          }
          .section {
            margin-bottom: 16px;
          }
          .section-header-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          }
          .section-header {
            font-weight: 600;
          }
          .section-header-right {
            font-size: 0.8rem;
            opacity: 0.7;
          }
          .row-inline {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: center;
            margin-bottom: 6px;
          }
          .small {
            font-size: 0.75rem;
            opacity: 0.8;
            margin-top: 2px;
          }
          ha-textfield,
          ha-select,
          ha-entity-picker,
          ha-icon-picker {
            min-width: 180px;
            flex: 1 1 160px;
          }
          .color-group {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: 1 1 180px;
          }
          .color-input {
            width: 36px;
            height: 36px;
            padding: 0;
            border-radius: 6px;
            border: 1px solid rgba(0, 0, 0, 0.4);
            background: transparent;
            cursor: pointer;
            flex: 0 0 auto;
          }
          .layer-block,
          .center-block,
          .bottom-block {
            border-radius: 8px;
            border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.15));
            background: var(--card-background-color, #fff);
            padding: 8px;
            margin-bottom: 10px;
          }
          .layer-header,
          .center-header,
          .bottom-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            padding: 4px 2px;
          }
          .layer-header-title,
          .center-header-title,
          .bottom-header-title {
            display: flex;
            flex-direction: column;
          }
          .layer-header-main {
            font-weight: 500;
          }
          .layer-header-sub {
            font-size: 0.75rem;
            opacity: 0.7;
          }
          .header-buttons {
            display: flex;
            gap: 4px;
            align-items: center;
          }
          .chevron {
            transition: transform 0.2s ease;
          }
          .chevron.expanded {
            transform: rotate(90deg);
          }
          .interval-block {
            border-radius: 6px;
            border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.15));
            padding: 6px;
            margin-bottom: 6px;
          }
          mwc-button {
            --mdc-theme-primary: var(--primary-color);
            text-transform: none;
            font-weight: 500;
            display: inline-block;
            padding: 4px 10px;
            margin: 2px 0;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 0.8rem;
            background: var(--primary-color, #03a9f4);
            color: #fff;
          }
          mwc-button.danger {
            --mdc-theme-primary: var(--error-color);
            background: var(--error-color, #ff5252);
          }
          mwc-button[disabled] {
            opacity: 0.5;
            cursor: default;
          }
          ha-switch {
            margin-right: 4px;
          }
        `;
      }

      render() {
        if (!this._config) return html``;
        const cfg = this._config;
        const layers = cfg.layers || [];
        const centerLayers = cfg.center_layers || [];
        const bottomLayers = cfg.bottom_layers || [];

        return html`
          <div class="section">
            <div class="section-header-bar">
              <div class="section-header">General</div>
              <div class="section-header-right">v0.3.5</div>
            </div>
            <div class="row-inline">
              <ha-select
                label="Clock mode"
                .value=${cfg.clock_mode || "24h"}
                @selected=${(e) =>
                  this._updateRoot("clock_mode", e.target.value || "24h")}
                @closed=${this._stopPropagation}
              >
                <mwc-list-item value="24h">24h</mwc-list-item>
                <mwc-list-item value="12h">12h</mwc-list-item>
              </ha-select>

              <ha-select
                label="Show hour labels"
                .value=${cfg.show_hour_labels === false ? "false" : "true"}
                @selected=${(e) =>
                  this._updateRoot(
                    "show_hour_labels",
                    e.target.value === "true"
                  )}
                @closed=${this._stopPropagation}
              >
                <mwc-list-item value="true">Yes</mwc-list-item>
                <mwc-list-item value="false">No</mwc-list-item>
              </ha-select>

              <ha-select
                label="Hands share center pivot"
                .value=${cfg.hands_center_pivot ? "true" : "false"}
                @selected=${(e) =>
                  this._updateRoot(
                    "hands_center_pivot",
                    e.target.value === "true"
                  )}
                @closed=${this._stopPropagation}
              >
                <mwc-list-item value="true">Yes</mwc-list-item>
                <mwc-list-item value="false">No</mwc-list-item>
              </ha-select>
            </div>

            <div class="row-inline">
              <ha-textfield
                type="number"
                label="Start angle"
                .value=${cfg.start_angle ?? -7.5}
                @input=${(e) =>
                  this._updateRoot("start_angle", Number(e.target.value))}
              ></ha-textfield>
              <ha-textfield
                type="number"
                label="End angle"
                .value=${cfg.end_angle ?? 352.5}
                @input=${(e) =>
                  this._updateRoot("end_angle", Number(e.target.value))}
              ></ha-textfield>
            </div>

            <div class="row-inline">
              <ha-textfield
                type="number"
                label="Base radius"
                .value=${cfg.radius ?? 45}
                @input=${(e) =>
                  this._updateRoot("radius", Number(e.target.value))}
              ></ha-textfield>
              <ha-textfield
                type="number"
                label="Layer gap"
                .value=${cfg.layer_gap ?? 2}
                @input=${(e) =>
                  this._updateRoot("layer_gap", Number(e.target.value))}
              ></ha-textfield>
            </div>

            <div class="row-inline">
              <ha-textfield
                label="Background CSS"
                .value=${cfg.style.background || ""}
                @input=${(e) =>
                  this._updateStyle("background", e.target.value)}
              ></ha-textfield>
            </div>
          </div>

          <div class="section">
            <div class="section-header-bar">
              <div class="section-header">Hour hand (hour sweeper)</div>
            </div>
            ${this._renderHourSweeperSection()}
          </div>

          <div class="section">
            <div class="section-header-bar">
              <div class="section-header">Minute hand</div>
            </div>
            ${this._renderMinuteSweeperSection()}
          </div>

          <div class="section">
            <div class="section-header-bar">
              <div class="section-header">Second hand</div>
            </div>
            ${this._renderSecondSweeperSection()}
          </div>

          <div class="section">
            <div class="section-header-bar">
              <div class="section-header">Layers (rings)</div>
              <mwc-button dense @click=${() => this._addLayer()}
                >Add layer</mwc-button
              >
            </div>

            ${layers.length === 0
              ? html`<div class="small">No layers yet.</div>`
              : layers.map((layer, idx) =>
                  this._renderLayerEditor(layer, idx, this._expandedLayerIndex === idx)
                )}
          </div>

          <div class="section">
            <div class="section-header-bar">
              <div class="section-header">CenterWatch</div>
              <mwc-button dense @click=${() => this._addCenterLayer()}
                >Add center item</mwc-button
              >
            </div>

            ${centerLayers.length === 0
              ? html`<div class="small">No center items yet.</div>`
              : centerLayers.map((cl, idx) =>
                  this._renderCenterLayerEditor(cl, idx, this._expandedCenterIndex === idx)
                )}
          </div>

          <div class="section">
            <div class="section-header-bar">
              <div class="section-header">Bottom (explanations / badges)</div>
              <mwc-button dense @click=${() => this._addBottomLayer()}
                >Add bottom item</mwc-button
              >
            </div>

            ${bottomLayers.length === 0
              ? html`<div class="small">No bottom items yet.</div>`
              : bottomLayers.map((cl, idx) =>
                  this._renderBottomLayerEditor(cl, idx, this._expandedBottomIndex === idx)
                )}
          </div>
        `;
      }

      // ---------- Root updates ----------

      _updateRoot(key, value) {
        this._config = { ...this._config, [key]: value };
        this._emitConfigChanged();
      }

      _updateStyle(key, value) {
        const style = { ...(this._config.style || {}) };
        style[key] = value;
        this._config = { ...this._config, style };
        this._emitConfigChanged();
      }

      // ---------- Hour / minute / second sweeper sections ----------

      _updateHourSweeper(key, value) {
        const sw = { ...(this._config.hour_sweeper || {}) };
        sw[key] = value;
        // Håll sweeper i sync för bakåtkompatibilitet
        this._config = {
          ...this._config,
          hour_sweeper: sw,
          sweeper: sw,
        };
        this._emitConfigChanged();
      }

      _updateMinuteSweeper(key, value) {
        const sw = { ...(this._config.minute_sweeper || {}) };
        sw[key] = value;
        this._config = { ...this._config, minute_sweeper: sw };
        this._emitConfigChanged();
      }

      _updateSecondSweeper(key, value) {
        const sw = { ...(this._config.second_sweeper || {}) };
        sw[key] = value;
        this._config = { ...this._config, second_sweeper: sw };
        this._emitConfigChanged();
      }

      _renderHourSweeperSection() {
        const sw = this._config.hour_sweeper || this._config.sweeper || {};
        return html`
          <div class="row-inline">
            <ha-select
              label="Enable hour hand"
              .value=${sw.enabled === false ? "false" : "true"}
              @selected=${(e) =>
                this._updateHourSweeper("enabled", e.target.value === "true")}
              @closed=${this._stopPropagation}
            >
              <mwc-list-item value="true">Enabled</mwc-list-item>
              <mwc-list-item value="false">Disabled</mwc-list-item>
            </ha-select>

            <ha-select
              label="Hour source"
              .value=${sw.use_system_time === false ? "entity" : "system"}
              @selected=${(e) =>
                this._updateHourSweeper(
                  "use_system_time",
                  e.target.value === "system"
                )}
              @closed=${this._stopPropagation}
            >
              <mwc-list-item value="system">System time</mwc-list-item>
              <mwc-list-item value="entity">From entity</mwc-list-item>
            </ha-select>
          </div>

          <div class="row-inline">
            <div class="color-group">
              <input
                type="color"
                class="color-input"
                .value=${this._normalizeColorInput(sw.color || "#FFFFFF")}
                @input=${(e) =>
                  this._updateHourSweeper("color", e.target.value)}
                @click=${this._stopPropagation}
              />
              <ha-textfield
                label="Hour hand color"
                .value=${sw.color || ""}
                @input=${(e) =>
                  this._updateHourSweeper("color", e.target.value)}
              ></ha-textfield>
            </div>

            <ha-textfield
              type="number"
              label="Hour hand width"
              .value=${sw.width ?? 1.5}
              @input=${(e) =>
                this._updateHourSweeper("width", Number(e.target.value))}
            ></ha-textfield>
          </div>

          <div class="row-inline">
            <ha-textfield
              label="Hour entity (when not system time)"
              .value=${sw.entity || ""}
              @input=${(e) =>
                this._updateHourSweeper("entity", e.target.value)}
            ></ha-textfield>
          </div>
        `;
      }

      _renderMinuteSweeperSection() {
        const sw = this._config.minute_sweeper || {};
        return html`
          <div class="row-inline">
            <ha-select
              label="Enable minute hand"
              .value=${sw.enabled ? "true" : "false"}
              @selected=${(e) =>
                this._updateMinuteSweeper(
                  "enabled",
                  e.target.value === "true"
                )}
              @closed=${this._stopPropagation}
            >
              <mwc-list-item value="true">Enabled</mwc-list-item>
              <mwc-list-item value="false">Disabled</mwc-list-item>
            </ha-select>
          </div>

          <div class="row-inline">
            <div class="color-group">
              <input
                type="color"
                class="color-input"
                .value=${this._normalizeColorInput(
                  sw.color || "#FFFFFF"
                )}
                @input=${(e) =>
                  this._updateMinuteSweeper("color", e.target.value)}
                @click=${this._stopPropagation}
              />
              <ha-textfield
                label="Minute hand color"
                .value=${sw.color || ""}
                @input=${(e) =>
                  this._updateMinuteSweeper("color", e.target.value)}
              ></ha-textfield>
            </div>

            <ha-textfield
              type="number"
              label="Minute hand width"
              .value=${sw.width ?? 1.2}
              @input=${(e) =>
                this._updateMinuteSweeper(
                  "width",
                  Number(e.target.value)
                )}
            ></ha-textfield>
          </div>
        `;
      }

      _renderSecondSweeperSection() {
        const sw = this._config.second_sweeper || {};
        return html`
          <div class="row-inline">
            <ha-select
              label="Enable second hand"
              .value=${sw.enabled ? "true" : "false"}
              @selected=${(e) =>
                this._updateSecondSweeper(
                  "enabled",
                  e.target.value === "true"
                )}
              @closed=${this._stopPropagation}
            >
              <mwc-list-item value="true">Enabled</mwc-list-item>
              <mwc-list-item value="false">Disabled</mwc-list-item>
            </ha-select>
          </div>

          <div class="row-inline">
            <div class="color-group">
              <input
                type="color"
                class="color-input"
                .value=${this._normalizeColorInput(
                  sw.color || "#FF4081"
                )}
                @input=${(e) =>
                  this._updateSecondSweeper("color", e.target.value)}
                @click=${this._stopPropagation}
              />
              <ha-textfield
                label="Second hand color"
                .value=${sw.color || ""}
                @input=${(e) =>
                  this._updateSecondSweeper("color", e.target.value)}
              ></ha-textfield>
            </div>

            <ha-textfield
              type="number"
              label="Second hand width"
              .value=${sw.width ?? 1.0}
              @input=${(e) =>
                this._updateSecondSweeper(
                  "width",
                  Number(e.target.value)
                )}
            ></ha-textfield>
          </div>

          <div class="small">
            Second hand is smooth (continuous) and rotates one full lap every 60 seconds.
          </div>
        `;
      }

      // ---------- Layers ----------

      _addLayer() {
        const layers = [...(this._config.layers || [])];
        layers.push({
          id: `layer_${layers.length + 1}`,
          name: `Layer ${layers.length + 1}`,
          type: "price",
          entity: "",
          price_source: "array",
          attribute: "today",
          value_path: "value",
          radius: this._config.radius ?? 45,
          thickness: 8,
          opacity: 1.0,
          color_mode: "intervals",
          segment_count: null,
          intervals: [
            { from: 0, to: 50, color_from: "#28c76f", color_to: "#9be15d" },
            { from: 50, to: 100, color_from: "#ff9f43", color_to: "#ffc26a" },
            { from: 100, to: 1000, color_from: "#ea5455", color_to: "#f86c7d" },
          ],
          gradient: {
            from: "#28c76f",
            to: "#ea5455",
          },
          stats_markers: {
            show_min: true,
            show_max: true,
            show_avg: false,
            color: "rgba(255,255,255,0.9)",
            font_size: 3,
            radius_offset: 2,
            decimals: 1,
            min_label: "",
            max_label: "",
            avg_label: "",
          },
        });
        this._config = { ...this._config, layers };
        this._expandedLayerIndex = layers.length - 1;
        this._emitConfigChanged();
      }

      _removeLayer(idx) {
        const layers = [...(this._config.layers || [])];
        layers.splice(idx, 1);
        this._config = { ...this._config, layers };
        if (this._expandedLayerIndex >= layers.length) {
          this._expandedLayerIndex = layers.length - 1;
        }
        this._emitConfigChanged();
      }

      _moveLayer(idx, dir) {
        const layers = [...(this._config.layers || [])];
        const newIndex = idx + dir;
        if (newIndex < 0 || newIndex >= layers.length) return;
        const [item] = layers.splice(idx, 1);
        layers.splice(newIndex, 0, item);
        this._config = { ...this._config, layers };
        this._expandedLayerIndex = newIndex;
        this._emitConfigChanged();
      }

      _updateLayer(idx, key, value) {
        const layers = [...(this._config.layers || [])];
        const layer = { ...(layers[idx] || {}) };
        layer[key] = value;
        layers[idx] = layer;
        this._config = { ...this._config, layers };
        this._emitConfigChanged();
      }

      _updateLayerGradient(idx, key, value) {
        const layers = [...(this._config.layers || [])];
        const layer = { ...(layers[idx] || {}) };
        const grad = { ...(layer.gradient || {}) };
        grad[key] = value;
        layer.gradient = grad;
        layers[idx] = layer;
        this._config = { ...this._config, layers };
        this._emitConfigChanged();
      }

      _updateLayerIntervalField(layerIdx, intIdx, field, value) {
        const layers = [...(this._config.layers || [])];
        const layer = { ...(layers[layerIdx] || {}) };
        const intervals = [...(layer.intervals || [])];
        if (!intervals[intIdx]) {
          intervals[intIdx] = {
            from: 0,
            to: 100,
            color_from: "#28c76f",
            color_to: "#ea5455",
          };
        }
        intervals[intIdx] = {
          ...intervals[intIdx],
          [field]: field === "from" || field === "to" ? Number(value) : value,
        };
        layer.intervals = intervals;
        layers[layerIdx] = layer;
        this._config = { ...this._config, layers };
        this._emitConfigChanged();
      }

      _updateLayerStatsMarkers(idx, key, value) {
        const layers = [...(this._config.layers || [])];
        const layer = { ...(layers[idx] || {}) };
        const sm = { ...(layer.stats_markers || {}) };
        sm[key] = value;
        layer.stats_markers = sm;
        layers[idx] = layer;
        this._config = { ...this._config, layers };
        this._emitConfigChanged();
      }

      _toggleLayerExpanded(idx) {
        this._expandedLayerIndex = this._expandedLayerIndex === idx ? -1 : idx;
      }

      _renderLayerEditor(layer, idx, expanded) {
        const intervals = layer.intervals || [];
        const sm = layer.stats_markers || {};

        return html`
          <div class="layer-block">
            <div
              class="layer-header"
              @click=${() => this._toggleLayerExpanded(idx)}
            >
              <div class="layer-header-title">
                <span class="layer-header-main">${layer.name || "Layer"}</span>
                <span class="layer-header-sub">
                  ID: ${layer.id || "-"} • Type: ${layer.type || "price"}
                </span>
              </div>
              <div class="header-buttons" @click=${this._stopPropagation}>
                <mwc-button
                  dense
                  @click=${() => this._moveLayer(idx, -1)}
                  ?disabled=${idx === 0}
                  >Up</mwc-button
                >
                <mwc-button
                  dense
                  @click=${() => this._moveLayer(idx, 1)}
                  ?disabled=${idx === (this._config.layers || []).length - 1}
                  >Down</mwc-button
                >
                <mwc-button
                  dense
                  class="danger"
                  @click=${() => this._removeLayer(idx)}
                  >Delete</mwc-button
                >
                <ha-icon
                  class="chevron ${expanded ? "expanded" : ""}"
                  icon="mdi:chevron-right"
                ></ha-icon>
              </div>
            </div>

            ${!expanded
              ? html``
              : html`
                  <div class="row-inline">
                    <ha-textfield
                      label="Layer name"
                      .value=${layer.name || ""}
                      @input=${(e) =>
                        this._updateLayer(idx, "name", e.target.value)}
                    ></ha-textfield>
                    <ha-textfield
                      label="ID"
                      .value=${layer.id || ""}
                      @input=${(e) =>
                        this._updateLayer(idx, "id", e.target.value)}
                    ></ha-textfield>
                  </div>

                  <div class="row-inline">
                    <ha-select
                      label="Layer type"
                      .value=${layer.type || "price"}
                      @selected=${(e) =>
                        this._updateLayer(
                          idx,
                          "type",
                          e.target.value || "price"
                        )}
                      @closed=${this._stopPropagation}
                    >
                      <mwc-list-item value="price">Electricity price</mwc-list-item>
                      <mwc-list-item value="consumption">Consumption</mwc-list-item>
                      <mwc-list-item value="history">Generic history</mwc-list-item>
                    </ha-select>

                    <div
                      class="color-group"
                      id=${`layer-entity-picker-${idx}`}
                    ></div>
                  </div>

                  <div class="row-inline">
                    <ha-select
                      label="Value source"
                      .value=${layer.price_source || "array"}
                      @selected=${(e) =>
                        this._updateLayer(
                          idx,
                          "price_source",
                          e.target.value || "array"
                        )}
                      @closed=${this._stopPropagation}
                    >
                      <mwc-list-item value="array"
                        >Array attribute (Nordpool/Tibber)</mwc-list-item
                      >
                      <mwc-list-item value="history"
                        >History/helper (array, JSON or attribute)</mwc-list-item
                      >
                    </ha-select>

                    <ha-textfield
                      label="Attribute (for array / history)"
                      .value=${layer.attribute || "today"}
                      @input=${(e) =>
                        this._updateLayer(idx, "attribute", e.target.value)}
                    ></ha-textfield>

                    <ha-textfield
                      label="Value path (if objects)"
                      .value=${layer.value_path || "value"}
                      @input=${(e) =>
                        this._updateLayer(idx, "value_path", e.target.value)}
                    ></ha-textfield>
                  </div>
                  <div class="small">
                    Attribute: name of the array attribute on the entity
                    (e.g. <code>today</code> for Nordpool).
                    Value path: property inside each array item (e.g. <code>value</code>).
                  </div>

                  <div class="row-inline" style="margin-top:4px;">
                    <ha-textfield
                      type="number"
                      label="Radius"
                      .value=${layer.radius ?? this._config.radius ?? 45}
                      @input=${(e) =>
                        this._updateLayer(idx, "radius", Number(e.target.value))}
                    ></ha-textfield>
                    <ha-textfield
                      type="number"
                      label="Thickness"
                      .value=${layer.thickness ?? 8}
                      @input=${(e) =>
                        this._updateLayer(
                          idx,
                          "thickness",
                          Number(e.target.value)
                        )}
                    ></ha-textfield>
                    <ha-textfield
                      type="number"
                      label="Opacity (0-1)"
                      .value=${layer.opacity ?? 1}
                      @input=${(e) =>
                        this._updateLayer(
                          idx,
                          "opacity",
                          Number(e.target.value)
                        )}
                    ></ha-textfield>
                    <ha-textfield
                      type="number"
                      label="Segment count (optional)"
                      .value=${layer.segment_count ?? ""}
                      @input=${(e) =>
                        this._updateLayer(
                          idx,
                          "segment_count",
                          e.target.value === ""
                            ? null
                            : Number(e.target.value)
                        )}
                    ></ha-textfield>
                  </div>
                  <div class="small">
                    Segment count: total number of slots around the ring.
                    Only the first <code>values.length</code> slots are filled.
                  </div>

                  <div class="row-inline" style="margin-top:4px;">
                    <ha-select
                      label="Color mode"
                      .value=${layer.color_mode || "intervals"}
                      @selected=${(e) =>
                        this._updateLayer(
                          idx,
                          "color_mode",
                          e.target.value || "intervals"
                        )}
                      @closed=${this._stopPropagation}
                    >
                      <mwc-list-item value="intervals"
                        >Intervals (value-based gradients)</mwc-list-item
                      >
                      <mwc-list-item value="gradient"
                        >Single gradient (min-max)</mwc-list-item
                      >
                    </ha-select>
                  </div>

                  ${layer.color_mode === "gradient"
                    ? html`
                        <div class="row-inline">
                          <div class="color-group">
                            <input
                              type="color"
                              class="color-input"
                              .value=${this._normalizeColorInput(
                                (layer.gradient && layer.gradient.from) ||
                                  "#28c76f"
                              )}
                              @input=${(e) =>
                                this._updateLayerGradient(
                                  idx,
                                  "from",
                                  e.target.value
                                )}
                              @click=${this._stopPropagation}
                            />
                            <ha-textfield
                              label="Gradient from"
                              .value=${(layer.gradient && layer.gradient.from) ||
                              ""}
                              @input=${(e) =>
                                this._updateLayerGradient(
                                  idx,
                                  "from",
                                  e.target.value
                                )}
                            ></ha-textfield>
                          </div>

                          <div class="color-group">
                            <input
                              type="color"
                              class="color-input"
                              .value=${this._normalizeColorInput(
                                (layer.gradient && layer.gradient.to) ||
                                  "#ea5455"
                              )}
                              @input=${(e) =>
                                this._updateLayerGradient(
                                  idx,
                                  "to",
                                  e.target.value
                                )}
                              @click=${this._stopPropagation}
                            />
                            <ha-textfield
                              label="Gradient to"
                              .value=${(layer.gradient && layer.gradient.to) ||
                              ""}
                              @input=${(e) =>
                                this._updateLayerGradient(
                                  idx,
                                  "to",
                                  e.target.value
                                )}
                            ></ha-textfield>
                          </div>
                        </div>
                      `
                    : html`
                        <div class="small">
                          Intervals are based on actual value (e.g. öre/kWh).
                          The gradient runs inside each interval.
                        </div>
                        ${intervals.map(
                          (intv, intIdx) => html`
                            <div class="interval-block">
                              <div class="row-inline">
                                <ha-textfield
                                  type="number"
                                  label="From"
                                  .value=${intv.from ?? 0}
                                  @input=${(e) =>
                                    this._updateLayerIntervalField(
                                      idx,
                                      intIdx,
                                      "from",
                                      e.target.value
                                    )}
                                ></ha-textfield>
                                <ha-textfield
                                  type="number"
                                  label="To"
                                  .value=${intv.to ?? 100}
                                  @input=${(e) =>
                                    this._updateLayerIntervalField(
                                      idx,
                                      intIdx,
                                      "to",
                                      e.target.value
                                    )}
                                ></ha-textfield>
                              </div>
                              <div class="row-inline">
                                <div class="color-group">
                                  <input
                                    type="color"
                                    class="color-input"
                                    .value=${this._normalizeColorInput(
                                      intv.color_from || "#28c76f"
                                    )}
                                    @input=${(e) =>
                                      this._updateLayerIntervalField(
                                        idx,
                                        intIdx,
                                        "color_from",
                                        e.target.value
                                      )}
                                    @click=${this._stopPropagation}
                                  />
                                  <ha-textfield
                                    label="Color from"
                                    .value=${intv.color_from || ""}
                                    @input=${(e) =>
                                      this._updateLayerIntervalField(
                                        idx,
                                        intIdx,
                                        "color_from",
                                        e.target.value
                                      )}
                                  ></ha-textfield>
                                </div>
                                <div class="color-group">
                                  <input
                                    type="color"
                                    class="color-input"
                                    .value=${this._normalizeColorInput(
                                      intv.color_to || "#28c76f"
                                    )}
                                    @input=${(e) =>
                                      this._updateLayerIntervalField(
                                        idx,
                                        intIdx,
                                        "color_to",
                                        e.target.value
                                      )}
                                    @click=${this._stopPropagation}
                                  />
                                  <ha-textfield
                                    label="Color to"
                                    .value=${intv.color_to || ""}
                                    @input=${(e) =>
                                      this._updateLayerIntervalField(
                                        idx,
                                        intIdx,
                                        "color_to",
                                        e.target.value
                                      )}
                                  ></ha-textfield>
                                </div>
                              </div>
                              <mwc-button
                                dense
                                class="danger"
                                @click=${() => {
                                  const layers = [...(this._config.layers || [])];
                                  const l = { ...(layers[idx] || {}) };
                                  const ints = [...(l.intervals || [])];
                                  ints.splice(intIdx, 1);
                                  l.intervals = ints;
                                  layers[idx] = l;
                                  this._config = { ...this._config, layers };
                                  this._emitConfigChanged();
                                }}
                                >Delete interval</mwc-button
                              >
                            </div>
                          `
                        )}
                        <mwc-button
                          dense
                          @click=${() => {
                            const layers = [...(this._config.layers || [])];
                            const l = { ...(layers[idx] || {}) };
                            const ints = [...(l.intervals || [])];
                            ints.push({
                              from: 0,
                              to: 100,
                              color_from: "#28c76f",
                              color_to: "#ea5455",
                            });
                            l.intervals = ints;
                            layers[idx] = l;
                            this._config = { ...this._config, layers };
                            this._emitConfigChanged();
                          }}
                          >Add interval</mwc-button
                        >
                      `}

                  <div class="small" style="margin-top:8px;">Stats markers (badges on ring)</div>
                  <div class="row-inline">
                    <ha-switch
                      .checked=${sm.show_min !== false}
                      @change=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "show_min",
                          e.target.checked
                        )}
                    ></ha-switch>
                    <span class="small">Show min</span>

                    <ha-switch
                      .checked=${sm.show_max !== false}
                      @change=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "show_max",
                          e.target.checked
                        )}
                    ></ha-switch>
                    <span class="small">Show max</span>

                    <ha-switch
                      .checked=${!!sm.show_avg}
                      @change=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "show_avg",
                          e.target.checked
                        )}
                    ></ha-switch>
                    <span class="small">Show avg</span>
                  </div>

                  <div class="row-inline">
                    <ha-textfield
                      label="Label for min badge"
                      .value=${sm.min_label ?? ""}
                      @input=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "min_label",
                          e.target.value
                        )}
                    ></ha-textfield>
                    <ha-textfield
                      label="Label for max badge"
                      .value=${sm.max_label ?? ""}
                      @input=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "max_label",
                          e.target.value
                        )}
                    ></ha-textfield>
                    <ha-textfield
                      label="Label for avg badge"
                      .value=${sm.avg_label ?? ""}
                      @input=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "avg_label",
                          e.target.value
                        )}
                    ></ha-textfield>
                  </div>
                  <div class="small">
                    Leave empty to show only value, or set e.g. "min", "max", "avg".
                  </div>

                  <div class="row-inline">
                    <div class="color-group">
                      <input
                        type="color"
                        class="color-input"
                        .value=${this._normalizeColorInput(
                          sm.color || "#ffffff"
                        )}
                        @input=${(e) =>
                          this._updateLayerStatsMarkers(
                            idx,
                            "color",
                            e.target.value
                          )}
                        @click=${this._stopPropagation}
                      />
                      <ha-textfield
                        label="Badge color"
                        .value=${sm.color || ""}
                        @input=${(e) =>
                          this._updateLayerStatsMarkers(
                            idx,
                            "color",
                            e.target.value
                          )}
                      ></ha-textfield>
                    </div>

                    <ha-textfield
                      type="number"
                      label="Badge font size (SVG units)"
                      .value=${sm.font_size ?? 3}
                      @input=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "font_size",
                          Number(e.target.value)
                        )}
                    ></ha-textfield>

                    <ha-textfield
                      type="number"
                      label="Radius offset"
                      .value=${sm.radius_offset ?? 2}
                      @input=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "radius_offset",
                          Number(e.target.value)
                        )}
                    ></ha-textfield>

                    <ha-textfield
                      type="number"
                      label="Decimals"
                      .value=${sm.decimals ?? 1}
                      @input=${(e) =>
                        this._updateLayerStatsMarkers(
                          idx,
                          "decimals",
                          Number(e.target.value)
                        )}
                    ></ha-textfield>
                  </div>
                `}
          </div>
        `;
      }

      // ---------- Center layers ----------

      _addCenterLayer() {
        const center_layers = [...(this._config.center_layers || [])];
        center_layers.push({
          id: `center_${center_layers.length + 1}`,
          type: "entity",
          entity: "sensor.time",
          show_icon: false,
          label_template: "<state>",
          decimals: "",
          font_size: 24,
          font_weight: 600,
          color: "var(--primary-text-color)",
        });
        this._config = { ...this._config, center_layers };
        this._expandedCenterIndex = center_layers.length - 1;
        this._emitConfigChanged();
      }

      _removeCenterLayer(idx) {
        const center_layers = [...(this._config.center_layers || [])];
        center_layers.splice(idx, 1);
        this._config = { ...this._config, center_layers };
        if (this._expandedCenterIndex >= center_layers.length) {
          this._expandedCenterIndex = center_layers.length - 1;
        }
        this._emitConfigChanged();
      }

      _moveCenterLayer(idx, dir) {
        const arr = [...(this._config.center_layers || [])];
        const newIndex = idx + dir;
        if (newIndex < 0 || newIndex >= arr.length) return;
        const [item] = arr.splice(idx, 1);
        arr.splice(newIndex, 0, item);
        this._config = { ...this._config, center_layers: arr };
        this._expandedCenterIndex = newIndex;
        this._emitConfigChanged();
      }

      _updateCenterLayer(idx, key, value) {
        const arr = [...(this._config.center_layers || [])];
        const cl = { ...(arr[idx] || {}) };
        cl[key] = value;
        arr[idx] = cl;
        this._config = { ...this._config, center_layers: arr };
        this._emitConfigChanged();
      }

      _toggleCenterExpanded(idx) {
        this._expandedCenterIndex =
          this._expandedCenterIndex === idx ? -1 : idx;
      }

      _renderCenterLayerEditor(cl, idx, expanded) {
        return html`
          <div class="center-block">
            <div
              class="center-header"
              @click=${() => this._toggleCenterExpanded(idx)}
            >
              <div class="center-header-title">
                <span class="layer-header-main">${cl.id || "Center item"}</span>
                <span class="layer-header-sub">
                  Type: ${cl.type || "entity"}
                </span>
              </div>
              <div class="header-buttons" @click=${this._stopPropagation}>
                <mwc-button
                  dense
                  @click=${() => this._moveCenterLayer(idx, -1)}
                  ?disabled=${idx === 0}
                  >Up</mwc-button
                >
                <mwc-button
                  dense
                  @click=${() => this._moveCenterLayer(idx, 1)}
                  ?disabled=${idx === (this._config.center_layers || []).length - 1}
                  >Down</mwc-button
                >
                <mwc-button
                  dense
                  class="danger"
                  @click=${() => this._removeCenterLayer(idx)}
                  >Delete</mwc-button
                >
                <ha-icon
                  class="chevron ${expanded ? "expanded" : ""}"
                  icon="mdi:chevron-right"
                ></ha-icon>
              </div>
            </div>

            ${!expanded
              ? html``
              : html`
                  <div class="row-inline">
                    <ha-textfield
                      label="ID"
                      .value=${cl.id || ""}
                      @input=${(e) =>
                        this._updateCenterLayer(idx, "id", e.target.value)}
                    ></ha-textfield>

                    <ha-select
                      label="Type"
                      .value=${cl.type || "entity"}
                      @selected=${(e) =>
                        this._updateCenterLayer(
                          idx,
                          "type",
                          e.target.value || "entity"
                        )}
                      @closed=${this._stopPropagation}
                    >
                      <mwc-list-item value="entity">Entity</mwc-list-item>
                      <mwc-list-item value="static">Static text</mwc-list-item>
                    </ha-select>
                  </div>

                  ${cl.type === "entity"
                    ? html`
                        <div class="row-inline">
                          <div
                            class="color-group"
                            id=${`center-entity-picker-${idx}`}
                          ></div>

                          <ha-textfield
                            label="Label template"
                            .value=${cl.label_template || "<state>"}
                            @input=${(e) =>
                              this._updateCenterLayer(
                                idx,
                                "label_template",
                                e.target.value
                              )}
                          ></ha-textfield>
                        </div>

                        <div class="row-inline">
                          <ha-textfield
                            type="number"
                            label="Decimals for numeric state (empty = raw)"
                            .value=${cl.decimals ?? ""}
                            @input=${(e) =>
                              this._updateCenterLayer(
                                idx,
                                "decimals",
                                e.target.value
                              )}
                          ></ha-textfield>
                        </div>

                        <div class="row-inline">
                          <ha-select
                            label="Show icon"
                            .value=${cl.show_icon ? "true" : "false"}
                            @selected=${(e) =>
                              this._updateCenterLayer(
                                idx,
                                "show_icon",
                                e.target.value === "true"
                              )}
                            @closed=${this._stopPropagation}
                          >
                            <mwc-list-item value="true">Yes</mwc-list-item>
                            <mwc-list-item value="false">No</mwc-list-item>
                          </ha-select>

                          <ha-icon-picker
                            label="Icon (optional)"
                            .hass=${this.hass}
                            .value=${cl.icon || ""}
                            @value-changed=${(e) =>
                              this._updateCenterLayer(
                                idx,
                                "icon",
                                e.detail.value
                              )}
                            @closed=${this._stopPropagation}
                          ></ha-icon-picker>
                        </div>
                      `
                    : html`
                        <div class="row-inline">
                          <ha-textfield
                            label="Text"
                            .value=${cl.text || ""}
                            @input=${(e) =>
                              this._updateCenterLayer(
                                idx,
                                "text",
                                e.target.value
                              )}
                          ></ha-textfield>
                        </div>
                      `}

                  <div class="row-inline">
                    <ha-textfield
                      type="number"
                      label="Font size (px)"
                      .value=${cl.font_size ?? 16}
                      @input=${(e) =>
                        this._updateCenterLayer(
                          idx,
                          "font_size",
                          Number(e.target.value)
                        )}
                    ></ha-textfield>
                    <ha-textfield
                      label="Font weight"
                      .value=${cl.font_weight ?? 400}
                      @input=${(e) =>
                        this._updateCenterLayer(
                          idx,
                          "font_weight",
                          e.target.value
                        )}
                    ></ha-textfield>
                    <div class="color-group">
                      <input
                        type="color"
                        class="color-input"
                        .value=${this._normalizeColorInput(
                          cl.color || "#ffffff"
                        )}
                        @input=${(e) =>
                          this._updateCenterLayer(
                            idx,
                            "color",
                            e.target.value
                          )}
                        @click=${this._stopPropagation}
                      />
                      <ha-textfield
                        label="Color"
                        .value=${cl.color || ""}
                        @input=${(e) =>
                          this._updateCenterLayer(
                            idx,
                            "color",
                            e.target.value
                          )}
                      ></ha-textfield>
                    </div>
                  </div>
                `}
          </div>
        `;
      }

      // ---------- Bottom layers ----------

      _addBottomLayer() {
        const bottom_layers = [...(this._config.bottom_layers || [])];
        bottom_layers.push({
          id: `bottom_${bottom_layers.length + 1}`,
          type: "static",
          text: "Explanation text",
          font_size: 11,
          font_weight: 400,
          color: "var(--secondary-text-color)",
        });
        this._config = { ...this._config, bottom_layers };
        this._expandedBottomIndex = bottom_layers.length - 1;
        this._emitConfigChanged();
      }

      _removeBottomLayer(idx) {
        const bottom_layers = [...(this._config.bottom_layers || [])];
        bottom_layers.splice(idx, 1);
        this._config = { ...this._config, bottom_layers };
        if (this._expandedBottomIndex >= bottom_layers.length) {
          this._expandedBottomIndex = bottom_layers.length - 1;
        }
        this._emitConfigChanged();
      }

      _moveBottomLayer(idx, dir) {
        const arr = [...(this._config.bottom_layers || [])];
        const newIndex = idx + dir;
        if (newIndex < 0 || newIndex >= arr.length) return;
        const [item] = arr.splice(idx, 1);
        arr.splice(newIndex, 0, item);
        this._config = { ...this._config, bottom_layers: arr };
        this._expandedBottomIndex = newIndex;
        this._emitConfigChanged();
      }

      _updateBottomLayer(idx, key, value) {
        const arr = [...(this._config.bottom_layers || [])];
        const cl = { ...(arr[idx] || {}) };
        cl[key] = value;
        arr[idx] = cl;
        this._config = { ...this._config, bottom_layers: arr };
        this._emitConfigChanged();
      }

      _toggleBottomExpanded(idx) {
        this._expandedBottomIndex =
          this._expandedBottomIndex === idx ? -1 : idx;
      }

      _renderBottomLayerEditor(cl, idx, expanded) {
        return html`
          <div class="bottom-block">
            <div
              class="bottom-header"
              @click=${() => this._toggleBottomExpanded(idx)}
            >
              <div class="bottom-header-title">
                <span class="layer-header-main">${cl.id || "Bottom item"}</span>
                <span class="layer-header-sub">
                  Type: ${cl.type || "static"}
                </span>
              </div>
              <div class="header-buttons" @click=${this._stopPropagation}>
                <mwc-button
                  dense
                  @click=${() => this._moveBottomLayer(idx, -1)}
                  ?disabled=${idx === 0}
                  >Up</mwc-button
                >
                <mwc-button
                  dense
                  @click=${() => this._moveBottomLayer(idx, 1)}
                  ?disabled=${idx === (this._config.bottom_layers || []).length - 1}
                  >Down</mwc-button
                >
                <mwc-button
                  dense
                  class="danger"
                  @click=${() => this._removeBottomLayer(idx)}
                  >Delete</mwc-button
                >
                <ha-icon
                  class="chevron ${expanded ? "expanded" : ""}"
                  icon="mdi:chevron-right"
                ></ha-icon>
              </div>
            </div>

            ${!expanded
              ? html``
              : html`
                  <div class="row-inline">
                    <ha-textfield
                      label="ID"
                      .value=${cl.id || ""}
                      @input=${(e) =>
                        this._updateBottomLayer(idx, "id", e.target.value)}
                    ></ha-textfield>

                    <ha-select
                      label="Type"
                      .value=${cl.type || "static"}
                      @selected=${(e) =>
                        this._updateBottomLayer(
                          idx,
                          "type",
                          e.target.value || "static"
                        )}
                      @closed=${this._stopPropagation}
                    >
                      <mwc-list-item value="static">Static text</mwc-list-item>
                      <mwc-list-item value="entity">Entity</mwc-list-item>
                    </ha-select>
                  </div>

                  ${cl.type === "entity"
                    ? html`
                        <div class="row-inline">
                          <div
                            class="color-group"
                            id=${`bottom-entity-picker-${idx}`}
                          ></div>

                          <ha-textfield
                            label="Label template"
                            .value=${cl.label_template ||
                            "<name>: <state><unit>"}
                            @input=${(e) =>
                              this._updateBottomLayer(
                                idx,
                                "label_template",
                                e.target.value
                              )}
                          ></ha-textfield>
                        </div>
                        <div class="row-inline">
                          <ha-textfield
                            type="number"
                            label="Decimals for numeric state (empty = raw)"
                            .value=${cl.decimals ?? ""}
                            @input=${(e) =>
                              this._updateBottomLayer(
                                idx,
                                "decimals",
                                e.target.value
                              )}
                          ></ha-textfield>
                        </div>
                        <div class="row-inline">
                          <ha-select
                            label="Show icon"
                            .value=${cl.show_icon ? "true" : "false"}
                            @selected=${(e) =>
                              this._updateBottomLayer(
                                idx,
                                "show_icon",
                                e.target.value === "true"
                              )}
                            @closed=${this._stopPropagation}
                          >
                            <mwc-list-item value="true">Yes</mwc-list-item>
                            <mwc-list-item value="false">No</mwc-list-item>
                          </ha-select>

                          <ha-icon-picker
                            label="Icon (optional)"
                            .hass=${this.hass}
                            .value=${cl.icon || ""}
                            @value-changed=${(e) =>
                              this._updateBottomLayer(
                                idx,
                                "icon",
                                e.detail.value
                              )}
                            @closed=${this._stopPropagation}
                          ></ha-icon-picker>
                        </div>
                      `
                    : html`
                        <div class="row-inline">
                          <ha-textfield
                            label="Text"
                            .value=${cl.text || ""}
                            @input=${(e) =>
                              this._updateBottomLayer(
                                idx,
                                "text",
                                e.target.value
                              )}
                          ></ha-textfield>
                        </div>
                      `}

                  <div class="row-inline">
                    <ha-textfield
                      type="number"
                      label="Font size (px)"
                      .value=${cl.font_size ?? 11}
                      @input=${(e) =>
                        this._updateBottomLayer(
                          idx,
                          "font_size",
                          Number(e.target.value)
                        )}
                    ></ha-textfield>
                    <ha-textfield
                      label="Font weight"
                      .value=${cl.font_weight ?? 400}
                      @input=${(e) =>
                        this._updateBottomLayer(
                          idx,
                          "font_weight",
                          e.target.value
                        )}
                    ></ha-textfield>
                    <div class="color-group">
                      <input
                        type="color"
                        class="color-input"
                        .value=${this._normalizeColorInput(
                          cl.color || "#ffffff"
                        )}
                        @input=${(e) =>
                          this._updateBottomLayer(
                            idx,
                            "color",
                            e.target.value
                          )}
                        @click=${this._stopPropagation}
                      />
                      <ha-textfield
                        label="Color"
                        .value=${cl.color || ""}
                        @input=${(e) =>
                          this._updateBottomLayer(
                            idx,
                            "color",
                            e.target.value
                          )}
                      ></ha-textfield>
                    </div>
                  </div>
                `}
          </div>
        `;
      }
    }

    customElements.define(EDITOR_TAG, AndyStatsClockEditor);
  }
})();
