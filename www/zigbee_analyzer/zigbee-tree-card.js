/**
 * Zigbee Tree Card
 * Custom Lovelace card that renders the Zigbee2MQTT network map
 * (sensor.zigbee2mqtt_network_map) with a reconstructed single-parent
 * hierarchy plus thin router<->router mesh links.
 *
 * v2 added three switchable layouts (tree / radial / force) and
 * label-readability improvements.
 *
 * v3 added: a force-layout bug fix (parent-child edges now render
 * correctly for every device, not just routers), blue dashed styling
 * for mesh-only links, draggable nodes in all three layouts (with
 * double-click reset/unpin), and numeric LQI labels on edges.
 *
 * v4 redesigned the radial layout as a role-based ring (coordinator
 * center, routers on an inner ring, end devices/orphans on an outer
 * ring, clustered by parent router) instead of polar tree depth.
 *
 * v5 fixes buildTree(): a device with no valid link of its own to a
 * parent, but which other devices reconstruct AS their parent (most
 * commonly a router whose own uplink link is currently flagged stale/
 * relationship 2 in the Z2M networkmap), is reachable and functioning
 * — it is attached directly under the coordinator instead of being
 * bucketed as an orphan. Only devices with neither a valid parent link
 * NOR any children are true orphans.
 *
 * v6 removes the synthetic "Orphans" container node entirely.
 * buildTree() now returns true orphans as a flat `orphans` array
 * alongside `root`, instead of nesting them under a fake tree node.
 * Every layout renders orphans identically: grey (regardless of their
 * real device type), no connecting edge, normal label/tooltip/drag —
 * the radial layout already worked this way; tree and force previously
 * still showed a grey container node with its (real-colored) children
 * hanging off it, which was an inconsistent leftover from before the
 * shared reconstruction existed. Tree positions orphans in their own
 * row below the connected part of the tree; force feeds them into the
 * simulation as ordinary nodes with no forceLink, so they settle near
 * the rest via forceManyBody/forceCenter without being pulled anywhere
 * specific; radial is unchanged (it already sourced orphans this way).
 *
 * v7 adds a second button group (LQI display mode: weak / all / none)
 * controlling WHEN the numeric LQI label on an edge is shown, independent
 * of layout. Toggling it never re-runs a layout — it only flips label
 * `display` styles on the already-rendered edge groups, so node
 * positions, zoom/pan and any dragged positions are untouched. "all"
 * always shows every number regardless of zoom level (no new zoom-gated
 * special case, unlike node labels which do hide at low zoom to reduce
 * clutter) — edge labels were never zoom-gated before this change either.
 *
 * No build step, no npm, no TypeScript. D3 v7 is loaded on demand via
 * dynamic import from a CDN.
 */

const D3_CDN_URL = 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const NODE_COLORS = {
  Coordinator: '#f1c40f',
  Router: '#3498db',
  EndDevice: '#2ecc71',
  Orphan: '#95a5a6',
};

const MESH_LINK_COLOR = '#3498db';
const WEAK_LQI_THRESHOLD = 40;

const LAYOUTS = ['tree', 'radial', 'force'];
const LAYOUT_LABELS = { tree: 'Baum', radial: 'Radial', force: 'Force' };

const LQI_MODES = ['weak', 'all', 'none'];
const LQI_MODE_LABELS = { weak: 'Schwache', all: 'Alle', none: 'Keine' };

// --- Shared datum accessors -------------------------------------------
// Work uniformly for d3.hierarchy nodes (datum.data holds our plain node
// object) and for the flat plain node objects used by the force layout.
function nodeType(d) {
  const n = d.data || d;
  return (n && n.type) || 'EndDevice';
}
function nodeFriendlyName(d) {
  const n = d.data || d;
  return (n && (n.friendlyName || n.id)) || '';
}
function nodeParentLqi(d) {
  const n = d.data || d;
  return n ? n.parentLqi : null;
}
function nodeFill(d) {
  return NODE_COLORS[nodeType(d)] || NODE_COLORS.Orphan;
}
function nodeRadius(d) {
  return nodeType(d) === 'Coordinator' ? 12 : 8;
}
// Waisen werden IMMER grau gezeichnet, unabhängig von ihrem echten
// Gerätetyp (Router/EndDevice) — Grau ist ein Status, kein Typ. Der
// Tooltip zeigt weiterhin den echten Typ (siehe showTooltip), nur die
// Füllfarbe wird hier überschrieben. Von allen drei Layouts gemeinsam
// genutzt, damit die Waisen-Darstellung garantiert einheitlich bleibt.
function resolveNodeFill(d, orphanIds) {
  const id = (d.data || d).id;
  return orphanIds && orphanIds.has(id) ? NODE_COLORS.Orphan : nodeFill(d);
}

function truncateLabel(name, maxLen = 18) {
  if (!name) return '';
  if (name.length <= maxLen) return name;
  const keep = maxLen - 1; // reserve one char for the ellipsis
  const front = Math.ceil(keep / 2);
  const back = keep - front;
  return `${name.slice(0, front)}…${name.slice(name.length - back)}`;
}

/**
 * Flattens the tree produced by buildTree() into a flat node array plus
 * parent-child edges, for use with d3.forceSimulation. Returns copies of
 * the node objects so the force simulation (which mutates x/y/vx/vy/fx/fy
 * directly on the datum) never touches the cached hierarchy data reused
 * by the tree/radial layouts. The edge objects are likewise fresh per
 * call so d3.forceLink can safely mutate their source/target in place
 * (see _renderForceLayout for why that mutation matters).
 */
function flattenTree(rootData) {
  const nodes = [];
  const edges = [];
  const walk = (n, parentCopy) => {
    const copy = { ...n };
    nodes.push(copy);
    if (parentCopy) {
      edges.push({ source: parentCopy.id, target: copy.id, lqi: n.parentLqi || 0 });
    }
    (n.children || []).forEach((c) => walk(c, copy));
  };
  walk(rootData, null);
  return { nodes, edges };
}

class ZigbeeTreeCard extends HTMLElement {
  constructor() {
    super();
    this._config = null;
    this._hass = null;
    this._lastChanged = null;
    this._d3 = null;
    this._d3LoadPromise = null;
    this._d3LoadFailed = false;

    this._currentLayout = 'tree';
    this._lastBuilt = null;
    this._simulation = null;
    this._labelSelection = null;
    this._currentZoomScale = 1;
    this._currentZoomTransform = null;

    // LQI-Anzeigemodus für die Kanten-Zahlen: nicht über YAML konfigurierbar,
    // startet immer bei "weak" (aktuelles Verhalten). Bleibt über
    // Layout-Wechsel/Re-Renders hinweg erhalten (Instanz-Zustand, kein
    // Config-Feld), setzt sich nur zurück, wenn die Karte neu erzeugt wird.
    this._lqiMode = 'weak';
    this._lqiApplyFns = [];
    this._lqiButtonsEl = null;

    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        .card {
          position: relative;
          background: transparent;
          color: var(--primary-text-color, #000);
          font-family: var(--paper-font-body1_-_font-family, sans-serif);
          border-radius: var(--ha-card-border-radius, 12px);
          overflow: hidden;
        }
        .card-header {
          padding: 12px 16px 0 16px;
          font-size: 1.2em;
          font-weight: 500;
        }
        .content {
          position: relative;
          width: 100%;
        }
        svg {
          display: block;
          width: 100%;
          cursor: grab;
        }
        svg:active {
          cursor: grabbing;
        }
        .message {
          padding: 24px 16px;
          text-align: center;
          color: var(--secondary-text-color, #888);
        }
        .message.error {
          color: var(--error-color, #db4437);
        }
        .node-label {
          font-size: 10px;
          fill: var(--primary-text-color, #000);
          pointer-events: none;
          user-select: none;
          paint-order: stroke;
          stroke: var(--card-background-color, #111);
          stroke-width: 3px;
          stroke-linejoin: round;
        }
        .edge-lqi-label {
          font-size: 9px;
          fill: var(--primary-text-color, #000);
          text-anchor: middle;
          pointer-events: none;
          user-select: none;
          paint-order: stroke;
          stroke: var(--card-background-color, #111);
          stroke-width: 3px;
          stroke-linejoin: round;
        }
        .tooltip {
          position: absolute;
          pointer-events: none;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 12px;
          line-height: 1.5;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
          max-width: 260px;
          z-index: 10;
          display: none;
        }
        .tooltip strong {
          display: block;
          margin-bottom: 2px;
          font-size: 13px;
        }
        .legend {
          position: absolute;
          bottom: 8px;
          left: 8px;
          background: var(--card-background-color, #fff);
          border: 1px solid var(--divider-color, #ccc);
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 11px;
          line-height: 1.6;
          opacity: 0.92;
        }
        .legend-row {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-bottom: 2px;
        }
        .legend-swatch {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
          flex: none;
        }
        .legend-lqi-gradient {
          width: 80px;
          height: 8px;
          border-radius: 4px;
          background: linear-gradient(to right, #e74c3c, #e67e22, #f1c40f, #2ecc71);
          display: inline-block;
        }
        .legend-mesh-swatch {
          width: 20px;
          height: 0;
          border-top: 2px dashed ${MESH_LINK_COLOR};
          display: inline-block;
        }
        .switch-group {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 6;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
          max-width: calc(100% - 16px);
        }
        .switch-row {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }
        .switch-label {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--secondary-text-color, #888);
          padding-right: 2px;
        }
        .button-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 4px;
        }
        .layout-btn {
          font: inherit;
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          cursor: pointer;
          opacity: 0.85;
        }
        .layout-btn:hover {
          opacity: 1;
        }
        .layout-btn.active {
          background: var(--primary-color, #03a9f4);
          color: var(--text-primary-color, #fff);
          border-color: var(--primary-color, #03a9f4);
          opacity: 1;
        }
      </style>
      <ha-card class="card">
        <div class="card-header" id="header" style="display:none;"></div>
        <div class="content" id="content"></div>
      </ha-card>
    `;

    this._contentEl = this.shadowRoot.getElementById('content');
    this._headerEl = this.shadowRoot.getElementById('header');
  }

  setConfig(config) {
    if (!config) {
      throw new Error('Zigbee Tree Card: keine Konfiguration übergeben.');
    }
    const entity = config.entity || 'sensor.zigbee2mqtt_network_map';
    if (!entity) {
      throw new Error('Zigbee Tree Card: "entity" muss konfiguriert sein.');
    }
    const layout = LAYOUTS.includes(config.layout) ? config.layout : 'tree';
    this._config = {
      entity,
      title: config.title,
      height: config.height ? Number(config.height) : 600,
      show_mesh_links: config.show_mesh_links !== undefined ? !!config.show_mesh_links : true,
      layout,
    };
    this._currentLayout = layout;
    this._lastChanged = null;
    this._headerEl.style.display = this._config.title ? '' : 'none';
    this._headerEl.textContent = this._config.title || '';
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    const stateObj = hass.states[this._config.entity];

    if (!stateObj) {
      this._lastChanged = null;
      this._renderMessage(
        `Entität "${this._config.entity}" wurde nicht gefunden.`,
        true
      );
      return;
    }

    const changedAt = stateObj.last_changed;
    if (this._lastChanged === changedAt) {
      // Render-Throttling: nichts geändert, kein Re-Render.
      return;
    }
    this._lastChanged = changedAt;

    const nodes = stateObj.attributes && stateObj.attributes.nodes;
    const links = stateObj.attributes && stateObj.attributes.links;

    if (!Array.isArray(nodes) || nodes.length === 0) {
      this._renderMessage(
        'Keine Zigbee-Netzwerkdaten vorhanden (Attribut "nodes" ist leer).'
      );
      return;
    }

    this._renderTree(nodes, Array.isArray(links) ? links : []);
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    return 8;
  }

  disconnectedCallback() {
    if (this._simulation) {
      this._simulation.stop();
      this._simulation = null;
    }
  }

  _renderMessage(text, isError) {
    if (this._simulation) {
      this._simulation.stop();
      this._simulation = null;
    }
    this._contentEl.innerHTML = `<div class="message${isError ? ' error' : ''}">${this._escapeHtml(text)}</div>`;
  }

  _escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  async _loadD3() {
    if (this._d3) return this._d3;
    if (this._d3LoadFailed) return null;
    if (!this._d3LoadPromise) {
      this._d3LoadPromise = import(/* webpackIgnore: true */ D3_CDN_URL)
        .then((mod) => {
          this._d3 = mod;
          return mod;
        })
        .catch((err) => {
          this._d3LoadFailed = true;
          console.error('Zigbee Tree Card: Laden von D3.js fehlgeschlagen.', err);
          return null;
        });
    }
    return this._d3LoadPromise;
  }

  async _renderTree(rawNodes, rawLinks) {
    const d3 = await this._loadD3();
    if (!d3) {
      this._renderMessage(
        'D3.js konnte nicht geladen werden (CDN nicht erreichbar). Baumansicht kann nicht gezeichnet werden.',
        true
      );
      return;
    }

    let built;
    try {
      built = buildTree(rawNodes, rawLinks);
    } catch (err) {
      console.error('Zigbee Tree Card: Fehler beim Aufbau des Baums.', err);
      this._renderMessage(`Fehler beim Aufbau der Baumstruktur: ${err.message}`, true);
      return;
    }

    this._lastBuilt = built;
    this._draw();
  }

  /** Setzt den Layout-Modus, stoppt eine laufende Force-Simulation und rendert sauber neu. */
  _setLayout(mode) {
    if (!LAYOUTS.includes(mode) || mode === this._currentLayout) return;
    this._currentLayout = mode;
    this._draw();
  }

  /**
   * Setzt den LQI-Anzeigemodus (weak/all/none). Löst bewusst KEIN Redraw
   * aus: nur die Button-Hervorhebung und die Sichtbarkeit der bereits
   * gerenderten Kanten-Zahlen (via applyMode(), siehe _renderEdgeGroup)
   * werden aktualisiert — Knotenpositionen, Zoom/Pan-Transform und
   * gedraggte Positionen bleiben unangetastet.
   */
  _setLqiMode(mode) {
    if (!LQI_MODES.includes(mode) || mode === this._lqiMode) return;
    this._lqiMode = mode;
    if (this._lqiButtonsEl) {
      Array.from(this._lqiButtonsEl.children).forEach((btn, i) => {
        btn.classList.toggle('active', LQI_MODES[i] === mode);
      });
    }
    this._lqiApplyFns.forEach((applyMode) => applyMode());
  }

  _applyLabelVisibility(scale) {
    this._currentZoomScale = scale;
    if (!this._labelSelection) return;
    this._labelSelection.style('display', (d) => (scale < 0.6 && nodeType(d) === 'EndDevice' ? 'none' : null));
  }

  /**
   * Zeichnet eine Kantengruppe: sichtbare Linie/Kurve (LQI-Farbe/Dicke),
   * eine unsichtbare breite Hit-Area (für leichtes Hovern dünner Linien)
   * und eine LQI-Zahl an der Linienmitte. OB die Zahl sichtbar ist, richtet
   * sich nach dem aktuellen LQI-Anzeigemodus (this._lqiMode, umschaltbar
   * über die zweite Button-Gruppe, siehe _setLqiMode):
   *   - "weak": wie bisher — LQI < 40 immer sichtbar, sonst nur bei Hover.
   *   - "all":  immer sichtbar, auch bei Mesh-Linien.
   *   - "none": nie sichtbar, auch nicht bei Hover (Kantenfarbe bleibt).
   * Liefert refresh(), um Positionen nach Drag/Zoom/Simulations-Tick neu
   * zu berechnen, und applyMode(), um nur die Zahlen-Sichtbarkeit nach
   * einem Moduswechsel zu aktualisieren — OHNE Positionen anzufassen.
   * applyMode() wird automatisch in this._lqiApplyFns registriert, damit
   * _setLqiMode() alle Kantengruppen aller Layouts auf einen Schlag
   * aktualisieren kann, ohne dass jeder Layout-Renderer das selbst tun muss.
   */
  _renderEdgeGroup(layer, edges, opts) {
    const { shape, sourcePos, targetPos, stroke, width, dash, opacity, lqi, className } = opts;

    const group = layer.append('g').attr('class', `edge-group edge-group-${className}`);

    const pathFn = (d) => {
      const s = sourcePos(d);
      const t = targetPos(d);
      if (shape === 'curve') {
        const my = (s.y + t.y) / 2;
        return `M${s.x},${s.y} C${s.x},${my} ${t.x},${my} ${t.x},${t.y}`;
      }
      return `M${s.x},${s.y} L${t.x},${t.y}`;
    };

    const visible = group
      .selectAll(`path.${className}`)
      .data(edges)
      .join('path')
      .attr('class', className)
      .attr('fill', 'none')
      .attr('stroke', stroke)
      .attr('stroke-width', width)
      .attr('stroke-opacity', opacity !== undefined ? opacity : 1)
      .attr('stroke-dasharray', dash || null)
      .attr('d', pathFn);

    const hit = group
      .selectAll(`path.${className}-hit`)
      .data(edges)
      .join('path')
      .attr('class', `${className}-hit`)
      .attr('fill', 'none')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 10)
      .style('pointer-events', 'stroke')
      .attr('d', pathFn);

    const label = group
      .selectAll(`text.${className}-lqi`)
      .data(edges)
      .join('text')
      .attr('class', `edge-lqi-label ${className}-lqi`)
      .attr('dy', '0.32em')
      .text((d) => Math.round(lqi(d) || 0));

    const computeDisplay = (d) => {
      if (this._lqiMode === 'none') return 'none';
      if (this._lqiMode === 'all') return null;
      return lqi(d) < WEAK_LQI_THRESHOLD ? null : 'none'; // 'weak' (Default)
    };
    const applyMode = () => label.style('display', computeDisplay);
    applyMode();
    this._lqiApplyFns.push(applyMode);

    const positionLabels = () => {
      label.attr('x', (d) => (sourcePos(d).x + targetPos(d).x) / 2).attr('y', (d) => (sourcePos(d).y + targetPos(d).y) / 2);
    };
    positionLabels();

    // Hover schaltet Zahlen nur im Modus "weak" für Links >= 40 LQI um; in
    // "all" sind sie schon dauerhaft sichtbar, in "none" bewusst nie.
    hit
      .on('mouseenter', (event, d) => {
        if (this._lqiMode === 'weak' && lqi(d) >= WEAK_LQI_THRESHOLD) {
          label.filter((dd) => dd === d).style('display', null);
        }
      })
      .on('mouseleave', (event, d) => {
        if (this._lqiMode === 'weak' && lqi(d) >= WEAK_LQI_THRESHOLD) {
          label.filter((dd) => dd === d).style('display', 'none');
        }
      });

    const refresh = () => {
      visible.attr('d', pathFn);
      hit.attr('d', pathFn);
      positionLabels();
    };

    return { visible, hit, label, refresh, applyMode };
  }

  /** Baut Card-Chrome (SVG, Zoom, Tooltip, Legende, Layout-/LQI-Switcher) neu auf und delegiert an das aktive Layout. */
  _draw() {
    const d3 = this._d3;
    const built = this._lastBuilt;
    if (!d3 || !built) return;

    if (this._simulation) {
      this._simulation.stop();
      this._simulation = null;
    }
    this._labelSelection = null;
    this._lqiApplyFns = [];
    this._lqiButtonsEl = null;

    const width = this._contentEl.clientWidth || this.clientWidth || 600;
    const height = this._config.height || 600;

    this._contentEl.innerHTML = '';

    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = `${height}px`;
    this._contentEl.appendChild(container);

    // Zwei getrennte Umschalter-Gruppen (Layout oben, LQI-Anzeige darunter),
    // gleicher Button-Stil, aber eigene Beschriftung, damit klar ist, dass
    // es zwei unabhängige Schalter sind.
    const switchGroup = document.createElement('div');
    switchGroup.className = 'switch-group';

    const layoutRow = document.createElement('div');
    layoutRow.className = 'switch-row';
    const layoutLabel = document.createElement('div');
    layoutLabel.className = 'switch-label';
    layoutLabel.textContent = 'Layout';
    const layoutButtons = document.createElement('div');
    layoutButtons.className = 'button-row';
    LAYOUTS.forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = LAYOUT_LABELS[mode];
      btn.className = `layout-btn${this._currentLayout === mode ? ' active' : ''}`;
      btn.addEventListener('click', () => this._setLayout(mode));
      layoutButtons.appendChild(btn);
    });
    layoutRow.appendChild(layoutLabel);
    layoutRow.appendChild(layoutButtons);

    const lqiRow = document.createElement('div');
    lqiRow.className = 'switch-row';
    const lqiLabel = document.createElement('div');
    lqiLabel.className = 'switch-label';
    lqiLabel.textContent = 'LQI';
    const lqiButtons = document.createElement('div');
    lqiButtons.className = 'button-row';
    LQI_MODES.forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = LQI_MODE_LABELS[mode];
      btn.className = `layout-btn${this._lqiMode === mode ? ' active' : ''}`;
      btn.addEventListener('click', () => this._setLqiMode(mode));
      lqiButtons.appendChild(btn);
    });
    lqiRow.appendChild(lqiLabel);
    lqiRow.appendChild(lqiButtons);
    this._lqiButtonsEl = lqiButtons;

    switchGroup.appendChild(layoutRow);
    switchGroup.appendChild(lqiRow);
    container.appendChild(switchGroup);

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height]);

    const zoomLayer = svg.append('g').attr('class', 'zoom-layer');
    const meshLayer = zoomLayer.append('g').attr('class', 'mesh-layer');
    const treeLayer = zoomLayer.append('g').attr('class', 'tree-layer');

    this._currentZoomTransform = d3.zoomIdentity;
    const zoom = d3
      .zoom()
      .scaleExtent([0.05, 6])
      .on('zoom', (event) => {
        this._currentZoomTransform = event.transform;
        zoomLayer.attr('transform', event.transform);
        this._applyLabelVisibility(event.transform.k);
      });
    svg.call(zoom);

    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    container.appendChild(tooltip);

    const showTooltip = (event, dRaw) => {
      const info = dRaw.data || dRaw;
      const lastSeenText = formatLastSeen(info.lastSeen);
      tooltip.innerHTML = `
        <strong>${this._escapeHtml(info.friendlyName || info.id)}</strong>
        Typ: ${this._escapeHtml(info.type || 'unbekannt')}<br/>
        IEEE: ${this._escapeHtml(info.ieeeAddr || info.id)}<br/>
        Modell: ${this._escapeHtml(info.modelID || 'unbekannt')}<br/>
        Hersteller: ${this._escapeHtml(info.manufacturerName || 'unbekannt')}<br/>
        LQI zum Parent: ${info.parentLqi !== undefined && info.parentLqi !== null ? info.parentLqi : 'unbekannt'}<br/>
        Zuletzt gesehen: ${this._escapeHtml(lastSeenText)}
      `;
      const rect = container.getBoundingClientRect();
      let left = event.clientX - rect.left + 12;
      const top = event.clientY - rect.top + 12;
      tooltip.style.display = 'block';
      const maxLeft = rect.width - 220;
      if (left > maxLeft) left = Math.max(0, maxLeft);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };
    const hideTooltip = () => {
      tooltip.style.display = 'none';
    };
    svg.on('click', hideTooltip);

    const lqiColor = d3
      .scaleLinear()
      .domain([0, 80, 150, 255])
      .range(['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71'])
      .clamp(true);
    const lqiWidth = d3.scaleLinear().domain([0, 255]).range([1, 4]).clamp(true);

    // Einmal zentral berechnet, von allen drei Layouts identisch genutzt
    // (siehe resolveNodeFill), damit die Waisen-Darstellung garantiert
    // überall gleich ist.
    const orphanIds = new Set((built.orphans || []).map((o) => o.id));

    const ctx = { d3, meshLayer, treeLayer, width, height, built, showTooltip, hideTooltip, lqiColor, lqiWidth, orphanIds };

    if (this._currentLayout === 'radial') {
      this._renderRadialLayout(ctx);
    } else if (this._currentLayout === 'force') {
      this._renderForceLayout(ctx);
    } else {
      this._renderTreeLayout(ctx);
    }

    this._applyLabelVisibility(this._currentZoomScale || 1);

    // Legende
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = `
      <div class="legend-row"><span class="legend-swatch" style="background:${NODE_COLORS.Coordinator}"></span>Coordinator</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${NODE_COLORS.Router}"></span>Router</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${NODE_COLORS.EndDevice}"></span>EndDevice</div>
      <div class="legend-row"><span class="legend-swatch" style="background:${NODE_COLORS.Orphan}"></span>Orphan</div>
      <div class="legend-row"><span class="legend-lqi-gradient"></span>&nbsp;LQI: schwach&nbsp;→&nbsp;stark</div>
      <div class="legend-row"><span class="legend-mesh-swatch"></span>&nbsp;Mesh-Zusatzlink</div>
    `;
    container.appendChild(legend);
  }

  /**
   * Statischer Top-down-Baum (Standard-Layout). d3.hierarchy/d3.tree
   * brauchen einen zusammenhängenden Baum, daher besteht dieser NUR aus
   * Koordinator + verbundenen Geräten. Echte Waisen (built.orphans) sind
   * kein Teil der Hierarchie — sie werden separat als eigene Reihe
   * unterhalb des Baums platziert (eigene y-Ebene, gleichmäßig über die
   * x-Breite verteilt), grau, ohne Kante, aber sonst wie jeder normale
   * Knoten (Label, Tooltip, Drag).
   */
  _renderTreeLayout(ctx) {
    const { d3, treeLayer, meshLayer, width, lqiColor, lqiWidth, built, showTooltip, hideTooltip, orphanIds } = ctx;

    const root = d3.hierarchy(built.root);
    const treeLayout = d3.tree().nodeSize([70, 110]);
    treeLayout(root);

    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    root.each((d) => {
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
      if (d.y > maxY) maxY = d.y;
    });
    const treeWidth = maxX - minX || 1;
    const xOffset = width / 2 - (minX + treeWidth / 2);
    const yOffset = 50;
    const basePos = (d) => ({ x: d.x + xOffset, y: d.y + yOffset });
    // Gedraggte Knoten behalten ihre frei gezogene Position (_dragX/_dragY),
    // bis ein Doppelklick sie auf die berechnete Basis (Baum-Position oder
    // Waisen-Reihe) zurücksetzt.
    const getPos = (d) => {
      if (d._dragX !== undefined) return { x: d._dragX, y: d._dragY };
      if (d._orphanX !== undefined) return { x: d._orphanX, y: d._orphanY };
      return basePos(d);
    };

    // Waisen als eigene Reihe unterhalb des restlichen Baums: genug
    // vertikaler Abstand zur letzten Baum-Ebene reicht als dezente
    // Trennung, kein Sammelknoten nötig.
    const orphans = built.orphans || [];
    const orphanRowY = maxY + yOffset + 90;
    const orphanSpacing = 90;
    const orphanStartX = width / 2 - ((orphans.length - 1) * orphanSpacing) / 2;
    const orphanWrappers = orphans.map((node, i) => ({
      data: node,
      id: node.id,
      _orphanX: orphanStartX + i * orphanSpacing,
      _orphanY: orphanRowY,
    }));

    const nodeById = new Map();
    root.each((d) => nodeById.set(d.data.id, d));
    for (const w of orphanWrappers) nodeById.set(w.id, w);

    const treeEdges = this._renderEdgeGroup(treeLayer, root.links(), {
      shape: 'curve',
      sourcePos: (d) => getPos(d.source),
      targetPos: (d) => getPos(d.target),
      stroke: (d) => lqiColor(nodeParentLqi(d.target) || 0),
      width: (d) => lqiWidth(nodeParentLqi(d.target) || 0),
      lqi: (d) => nodeParentLqi(d.target) || 0,
      className: 'tree-link',
    });

    let meshEdges = null;
    if (this._config.show_mesh_links && built.meshLinks.length) {
      const validMesh = built.meshLinks.filter((l) => nodeById.has(l.source) && nodeById.has(l.target));
      meshEdges = this._renderEdgeGroup(meshLayer, validMesh, {
        shape: 'line',
        sourcePos: (d) => getPos(nodeById.get(d.source)),
        targetPos: (d) => getPos(nodeById.get(d.target)),
        stroke: () => MESH_LINK_COLOR,
        width: () => 1.5,
        dash: '4 3',
        opacity: 0.5,
        lqi: (d) => d.lqi || 0,
        className: 'mesh-link',
      });
    }

    const allNodeData = root.descendants().concat(orphanWrappers);

    const nodeG = treeLayer
      .selectAll('g.node')
      .data(allNodeData, (d) => (d.data || d).id)
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => {
        const p = getPos(d);
        return `translate(${p.x},${p.y})`;
      })
      .style('cursor', 'grab');

    nodeG
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => resolveNodeFill(d, orphanIds))
      .attr('stroke', 'var(--card-background-color, #fff)')
      .attr('stroke-width', 1.5);

    this._labelSelection = nodeG
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('y', (d) => (nodeType(d) === 'Coordinator' ? 26 : 22))
      .text((d) => truncateLabel(nodeFriendlyName(d)));

    const refreshPositions = () => {
      nodeG.attr('transform', (d) => {
        const p = getPos(d);
        return `translate(${p.x},${p.y})`;
      });
      treeEdges.refresh();
      if (meshEdges) meshEdges.refresh();
    };

    const drag = d3
      .drag()
      .on('start', (event) => {
        // Verhindert, dass ein Knoten-Drag gleichzeitig das Pan/Zoom der
        // Ansicht auslöst (Pointerdown würde sonst bis zur svg bubbeln).
        event.sourceEvent.stopPropagation();
      })
      .on('drag', (event, d) => {
        const base = getPos(d);
        const k = (this._currentZoomTransform && this._currentZoomTransform.k) || 1;
        d._dragX = base.x + event.dx / k;
        d._dragY = base.y + event.dy / k;
        refreshPositions();
      });

    nodeG
      .call(drag)
      .on('mouseenter', showTooltip)
      .on('mousemove', showTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', (event, d) => {
        event.stopPropagation();
        showTooltip(event, d);
      })
      .on('dblclick', (event, d) => {
        event.stopPropagation();
        d._dragX = undefined;
        d._dragY = undefined;
        refreshPositions();
      });
  }

  /**
   * Radiales "Rollen-Ring"-Layout: Koordinator im Zentrum, ALLE Router auf
   * einem inneren Ring (Ring 1), EndDevices + Waisen auf einem äußeren Ring
   * (Ring 2). Der Radius codiert die GERÄTEROLLE, nicht mehr die Baumtiefe.
   * EndDevices werden im Winkel-Sektor ihres Parent-Routers gruppiert
   * (Sektorbreite proportional zur Kinderzahl, damit sich Cluster nicht
   * überlappen) statt zufällig über den ganzen Kreis verteilt zu sein.
   *
   * Waisen (built.orphans, von buildTree() bereits als flache Liste ohne
   * Sammelknoten geliefert) landen einzeln, grau, ohne Kante, in einem
   * eigenen Sektor auf Ring 2 — identisch zur Waisen-Darstellung in
   * Baum/Force (siehe _renderTreeLayout/_renderForceLayout).
   */
  _renderRadialLayout(ctx) {
    const { d3, treeLayer, meshLayer, width, height, lqiColor, lqiWidth, built, showTooltip, hideTooltip, orphanIds } = ctx;

    const coordinatorNode = built.root;
    const orphans = built.orphans || [];

    // --- Rollen-Klassifikation --------------------------------------------
    // routers: alle Router, unabhängig von Baumtiefe/Router-Ketten.
    // routerChildren: Map<routerId, Kindgeräte[]> — direkte Kinder je Router.
    // directCoordChildren: Geräte, deren rekonstruierter Parent direkt der
    // Koordinator ist (kein Router dazwischen).
    const routers = [];
    const routerChildren = new Map();
    const directCoordChildren = [];

    const classify = (node) => {
      for (const child of node.children || []) {
        if (child.type === 'Router') {
          routers.push(child);
          routerChildren.set(child.id, []);
          classify(child);
        } else if (node === coordinatorNode) {
          directCoordChildren.push(child);
        } else {
          routerChildren.get(node.id).push(child);
        }
      }
    };
    classify(coordinatorNode);

    // Stabile Reihenfolge: meiste Kinder zuerst, sonst nach ID.
    routers.sort((a, b) => {
      const ca = (routerChildren.get(a.id) || []).length;
      const cb = (routerChildren.get(b.id) || []).length;
      if (cb !== ca) return cb - ca;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    // --- Winkel-Sektoren ---------------------------------------------------
    // Jeder Router (+ ggf. ein Sektor für Koordinator-Direktkinder, + ggf.
    // ein Sektor für Waisen) bekommt einen Kreissektor proportional zu
    // seiner Kinderzahl, damit Cluster einander nicht überlappen.
    const slices = routers.map((r) => ({
      kind: 'router',
      node: r,
      weight: Math.max(1, (routerChildren.get(r.id) || []).length),
    }));
    if (directCoordChildren.length) {
      slices.push({ kind: 'coord', weight: Math.max(1, directCoordChildren.length) });
    }
    if (orphans.length) {
      slices.push({ kind: 'orphan', weight: Math.max(1, orphans.length) });
    }

    const totalWeight = slices.reduce((sum, s) => sum + s.weight, 0) || 1;
    let cursor = 0;
    for (const slice of slices) {
      const span = (slice.weight / totalWeight) * 2 * Math.PI;
      slice.span = span;
      slice.center = cursor + span / 2;
      cursor += span;
    }

    const normalizeAngle = (a) => {
      const twoPi = 2 * Math.PI;
      const x = a % twoPi;
      return x < 0 ? x + twoPi : x;
    };

    const maxRadius = Math.max(100, Math.min(width, height) / 2 - 70);
    const ring1Radius = maxRadius * 0.32; // Router
    const ring2Radius = maxRadius * 0.68; // EndDevices + Waisen

    // --- Knoten-Wrapper erzeugen --------------------------------------------
    // Frische Wrapper-Objekte pro Render (wie d3.hierarchy es für den Baum
    // tut), damit Drag-Zustand (_dragX/_dragY) NIE auf den gecachten, mit
    // anderen Layouts geteilten Baumknoten (built.root) landet.
    const wrapperById = new Map();

    const addNode = (node, angle, baseRadius) => {
      const norm = normalizeAngle(angle);
      const w = {
        data: node,
        id: node.id,
        _angle: norm,
        _baseX: baseRadius * Math.cos(norm - Math.PI / 2),
        _baseY: baseRadius * Math.sin(norm - Math.PI / 2),
      };
      wrapperById.set(node.id, w);
      return w;
    };

    const spreadWithinSlice = (slice, items, radius) => {
      const usable = slice.span * 0.8; // kleine Lücke zwischen Clustern lassen
      const startAngle = slice.center - usable / 2;
      items.forEach((item, i) => {
        const angle = items.length === 1 ? slice.center : startAngle + (usable * i) / (items.length - 1);
        addNode(item, angle, radius);
      });
    };

    addNode(coordinatorNode, 0, 0);
    for (const slice of slices) {
      if (slice.kind === 'router') {
        addNode(slice.node, slice.center, ring1Radius);
        spreadWithinSlice(slice, routerChildren.get(slice.node.id) || [], ring2Radius);
      } else if (slice.kind === 'coord') {
        spreadWithinSlice(slice, directCoordChildren, ring2Radius);
      } else if (slice.kind === 'orphan') {
        spreadWithinSlice(slice, orphans, ring2Radius);
      }
    }

    const getPos = (w) => (w._dragX !== undefined ? { x: w._dragX, y: w._dragY } : { x: w._baseX, y: w._baseY });

    const centerX = width / 2;
    const centerY = height / 2;
    const radialTree = treeLayer.append('g').attr('class', 'radial-root').attr('transform', `translate(${centerX},${centerY})`);
    const radialMesh = meshLayer.append('g').attr('class', 'radial-mesh').attr('transform', `translate(${centerX},${centerY})`);

    // --- Kanten: Router -> Koordinator, EndDevice -> Parent-Router/-Koord.
    // Waisen bekommen bewusst KEINE Kante.
    const roleEdges = [];
    for (const slice of slices) {
      if (slice.kind === 'router') {
        roleEdges.push({
          source: wrapperById.get(slice.node.id),
          target: wrapperById.get(coordinatorNode.id),
          lqi: slice.node.parentLqi || 0,
        });
        for (const child of routerChildren.get(slice.node.id) || []) {
          roleEdges.push({
            source: wrapperById.get(child.id),
            target: wrapperById.get(slice.node.id),
            lqi: child.parentLqi || 0,
          });
        }
      } else if (slice.kind === 'coord') {
        for (const child of directCoordChildren) {
          roleEdges.push({
            source: wrapperById.get(child.id),
            target: wrapperById.get(coordinatorNode.id),
            lqi: child.parentLqi || 0,
          });
        }
      }
    }

    const treeEdges = this._renderEdgeGroup(radialTree, roleEdges, {
      shape: 'line',
      sourcePos: (d) => getPos(d.source),
      targetPos: (d) => getPos(d.target),
      stroke: (d) => lqiColor(d.lqi || 0),
      width: (d) => lqiWidth(d.lqi || 0),
      lqi: (d) => d.lqi || 0,
      className: 'tree-link',
    });

    let meshEdges = null;
    if (this._config.show_mesh_links && built.meshLinks.length) {
      const validMesh = built.meshLinks.filter((l) => wrapperById.has(l.source) && wrapperById.has(l.target));
      meshEdges = this._renderEdgeGroup(radialMesh, validMesh, {
        shape: 'line',
        sourcePos: (d) => getPos(wrapperById.get(d.source)),
        targetPos: (d) => getPos(wrapperById.get(d.target)),
        stroke: () => MESH_LINK_COLOR,
        width: () => 1.5,
        dash: '4 3',
        opacity: 0.5,
        lqi: (d) => d.lqi || 0,
        className: 'mesh-link',
      });
    }

    const allWrappers = Array.from(wrapperById.values());

    const nodeG = radialTree
      .selectAll('g.node')
      .data(allWrappers, (w) => w.id)
      .join('g')
      .attr('class', 'node')
      .attr('transform', (w) => {
        const p = getPos(w);
        return `translate(${p.x},${p.y})`;
      })
      .style('cursor', 'grab');

    nodeG
      .append('circle')
      .attr('r', (w) => nodeRadius(w))
      .attr('fill', (w) => resolveNodeFill(w, orphanIds))
      .attr('stroke', 'var(--card-background-color, #fff)')
      .attr('stroke-width', 1.5);

    // Koordinator: einfaches Label unter dem Knoten (keine radiale Richtung
    // sinnvoll bei r=0). Ring 1/2: radial ausgerichtet, linke Hälfte um
    // 180° gedreht + text-anchor:end, damit der Text nie auf dem Kopf steht.
    this._labelSelection = nodeG
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', (w) => (nodeType(w) === 'Coordinator' ? null : '0.31em'))
      .attr('y', (w) => (nodeType(w) === 'Coordinator' ? 26 : null))
      .attr('x', (w) => (nodeType(w) === 'Coordinator' ? null : w._angle < Math.PI ? 8 : -8))
      .attr('text-anchor', (w) => (nodeType(w) === 'Coordinator' ? 'middle' : w._angle < Math.PI ? 'start' : 'end'))
      .attr('transform', (w) => {
        if (nodeType(w) === 'Coordinator') return null;
        const angleDeg = (w._angle * 180) / Math.PI - 90;
        return `rotate(${w._angle >= Math.PI ? angleDeg + 180 : angleDeg})`;
      })
      .text((w) => truncateLabel(nodeFriendlyName(w)));

    const refreshPositions = () => {
      nodeG.attr('transform', (w) => {
        const p = getPos(w);
        return `translate(${p.x},${p.y})`;
      });
      treeEdges.refresh();
      if (meshEdges) meshEdges.refresh();
    };

    const drag = d3
      .drag()
      .on('start', (event) => {
        event.sourceEvent.stopPropagation();
      })
      .on('drag', (event, w) => {
        const base = getPos(w);
        const k = (this._currentZoomTransform && this._currentZoomTransform.k) || 1;
        w._dragX = base.x + event.dx / k;
        w._dragY = base.y + event.dy / k;
        refreshPositions();
      });

    nodeG
      .call(drag)
      .on('mouseenter', showTooltip)
      .on('mousemove', showTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', (event, w) => {
        event.stopPropagation();
        showTooltip(event, w);
      })
      .on('dblclick', (event, w) => {
        event.stopPropagation();
        w._dragX = undefined;
        w._dragY = undefined;
        refreshPositions();
      });
  }

  /**
   * Force-directed Layout mit draggbaren Knoten; Mesh-Links als schwache
   * Zusatzkräfte. Waisen (built.orphans) fließen als ganz normale
   * Simulationsknoten ein, bekommen aber KEINEN forceLink — sie werden
   * also nie zu einem Parent gezogen. forceManyBody + forceCenter wirken
   * trotzdem weiterhin auf sie, sodass sie sich locker im freien Raum
   * einpendeln statt ins Unendliche zu driften.
   */
  _renderForceLayout(ctx) {
    const { d3, treeLayer, meshLayer, width, height, lqiColor, lqiWidth, built, showTooltip, hideTooltip, orphanIds } = ctx;

    const { nodes: flatNodes, edges: treeEdgesData } = flattenTree(built.root);
    const orphanNodes = (built.orphans || []).map((n) => ({ ...n }));
    const allFlatNodes = flatNodes.concat(orphanNodes);
    const meshEdgesData = (this._config.show_mesh_links ? built.meshLinks : []).map((l) => ({
      source: l.source,
      target: l.target,
      lqi: l.lqi || 0,
      mesh: true,
    }));

    // WICHTIG: d3.forceLink() mutiert source/target (String-ID -> Node-
    // Objekt) NUR auf den Objekten, die ihm selbst übergeben wurden. Diese
    // Objekte müssen daher IDENTISCH (dieselbe Referenz) mit denen sein,
    // die zum Rendern der Kanten verwendet werden — sonst bleiben die
    // gerenderten Kanten bei String-IDs stehen und kollabieren auf (0,0).
    // treeEdgesData/meshEdgesData werden hier direkt (ohne Kopie) sowohl
    // für die Simulation als auch fürs Rendering benutzt. orphanNodes
    // tauchen bewusst in KEINEM Link auf.
    treeEdgesData.forEach((e) => {
      e.mesh = false;
    });
    const allLinks = treeEdgesData.concat(meshEdgesData);

    // Distanz invers zur LQI: starke Links (hohe LQI) kurz, schwache lang.
    const distanceScale = d3.scaleLinear().domain([0, 255]).range([170, 45]).clamp(true);

    const simulation = d3
      .forceSimulation(allFlatNodes)
      .force(
        'link',
        d3
          .forceLink(allLinks)
          .id((d) => d.id)
          .distance((d) => (d.mesh ? 190 : distanceScale(d.lqi || 0)))
          .strength((d) => (d.mesh ? 0.08 : 0.5))
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force(
        'collide',
        d3.forceCollide().radius((d) => nodeRadius(d) + Math.min(60, truncateLabel(nodeFriendlyName(d)).length * 3.2))
      );

    this._simulation = simulation;

    // Ab hier (nach dem .force('link', ...)-Aufruf) sind source/target auf
    // treeEdgesData/meshEdgesData bereits zu echten Node-Objekten aufgelöst
    // (forceLink.initialize() läuft synchron beim Anhängen der Force).
    const treeEdges = this._renderEdgeGroup(treeLayer, treeEdgesData, {
      shape: 'line',
      sourcePos: (d) => d.source,
      targetPos: (d) => d.target,
      stroke: (d) => lqiColor(d.lqi || 0),
      width: (d) => lqiWidth(d.lqi || 0),
      lqi: (d) => d.lqi || 0,
      className: 'tree-link',
    });

    const meshEdges = meshEdgesData.length
      ? this._renderEdgeGroup(meshLayer, meshEdgesData, {
          shape: 'line',
          sourcePos: (d) => d.source,
          targetPos: (d) => d.target,
          stroke: () => MESH_LINK_COLOR,
          width: () => 1.5,
          dash: '4 3',
          opacity: 0.5,
          lqi: (d) => d.lqi || 0,
          className: 'mesh-link',
        })
      : null;

    const nodeG = treeLayer
      .selectAll('g.node')
      .data(allFlatNodes, (d) => d.id)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'grab');

    nodeG
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => resolveNodeFill(d, orphanIds))
      .attr('stroke', 'var(--card-background-color, #fff)')
      .attr('stroke-width', 1.5);

    this._labelSelection = nodeG
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('y', (d) => nodeRadius(d) + 14)
      .text((d) => truncateLabel(nodeFriendlyName(d)));

    nodeG
      .on('mouseenter', showTooltip)
      .on('mousemove', showTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', (event, d) => {
        event.stopPropagation();
        showTooltip(event, d);
      })
      .on('dblclick', (event, d) => {
        // Löst die Fixierung: Knoten wird wieder von der Simulation bewegt.
        event.stopPropagation();
        d.fx = null;
        d.fy = null;
        simulation.alpha(0.5).restart();
      });

    const dragBehavior = d3
      .drag()
      .on('start', (event, d) => {
        event.sourceEvent.stopPropagation();
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        const k = (this._currentZoomTransform && this._currentZoomTransform.k) || 1;
        d.fx += event.dx / k;
        d.fy += event.dy / k;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        // fx/fy bleiben bewusst gesetzt: Knoten bleibt fixiert, bis ein
        // Doppelklick die Fixierung wieder aufhebt (kein Zurückspringen).
      });
    nodeG.call(dragBehavior);

    simulation.on('tick', () => {
      treeEdges.refresh();
      if (meshEdges) meshEdges.refresh();
      nodeG.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });
  }
}

/**
 * Baut aus den rohen Z2M-Netzwerkdaten eine d3.hierarchy-kompatible
 * Baumstruktur mit genau einem Parent pro Gerät (root = Koordinator),
 * eine separate flache Liste echter Waisen (Geräte ohne gültigen
 * Parent-Link UND ohne eigene Kinder — kein Sammelknoten mehr, siehe
 * `orphans` im Rückgabewert), sowie die Liste zusätzlicher
 * Router<->Router Mesh-Links.
 */
function buildTree(rawNodes, rawLinks) {
  const nodeMap = new Map();
  for (const n of rawNodes) {
    if (!n || !n.ieeeAddr) continue;
    nodeMap.set(n.ieeeAddr, n);
  }

  const coordinator = rawNodes.find((n) => n && n.type === 'Coordinator');
  if (!coordinator) {
    throw new Error('Kein Koordinator (type "Coordinator") in den Netzwerkdaten gefunden.');
  }

  // Kandidaten-Links filtern: Artefakte raus.
  const candidateLinks = (rawLinks || []).filter((l) => {
    if (!l || !l.sourceIeeeAddr || !l.targetIeeeAddr) return false;
    if (!(l.lqi > 1)) return false;
    if (l.relationship === 2) return false;
    if (!nodeMap.has(l.sourceIeeeAddr) || !nodeMap.has(l.targetIeeeAddr)) return false;
    return true;
  });

  // Pro Source-Gerät: bevorzugt relationship==1 Links, sonst relationship==0 als Fallback.
  const linksBySource = new Map();
  for (const l of candidateLinks) {
    if (!linksBySource.has(l.sourceIeeeAddr)) linksBySource.set(l.sourceIeeeAddr, []);
    linksBySource.get(l.sourceIeeeAddr).push(l);
  }

  const parentOf = new Map(); // ieeeAddr -> { parentId, lqi }

  for (const node of rawNodes) {
    if (!node || !node.ieeeAddr) continue;
    if (node.ieeeAddr === coordinator.ieeeAddr) continue;

    const candidates = linksBySource.get(node.ieeeAddr) || [];
    const childLinks = candidates.filter((l) => l.relationship === 1);
    const pool = childLinks.length > 0 ? childLinks : candidates.filter((l) => l.relationship === 0);

    if (pool.length === 0) {
      continue; // -> Orphan, wird unten behandelt
    }

    let best = pool[0];
    for (const l of pool) {
      if (l.lqi > best.lqi) best = l;
    }
    parentOf.set(node.ieeeAddr, { parentId: best.targetIeeeAddr, lqi: best.lqi });
  }

  // Zyklenschutz: Ketten auflösen; falls ein Zyklus entsteht, den
  // schwächeren Link in der Kette entfernen (-> Orphan).
  for (const node of rawNodes) {
    if (!node || !node.ieeeAddr) continue;
    if (node.ieeeAddr === coordinator.ieeeAddr) continue;
    const visited = new Set();
    let current = node.ieeeAddr;
    while (true) {
      if (current === coordinator.ieeeAddr) break;
      const entry = parentOf.get(current);
      if (!entry) break;
      if (visited.has(current)) {
        // Zyklus gefunden: schwächsten Link in der besuchten Kette entfernen.
        let weakestId = null;
        let weakestLqi = Infinity;
        for (const id of visited) {
          const e = parentOf.get(id);
          if (e && e.lqi < weakestLqi) {
            weakestLqi = e.lqi;
            weakestId = id;
          }
        }
        if (weakestId) parentOf.delete(weakestId);
        break;
      }
      visited.add(current);
      current = entry.parentId;
    }
  }

  // Baumknoten aufbauen.
  const treeNodeById = new Map();
  const makeTreeNode = (node, parentLqi) => ({
    id: node.ieeeAddr,
    ieeeAddr: node.ieeeAddr,
    friendlyName: node.friendlyName || node.ieeeAddr,
    type: node.type || 'EndDevice',
    networkAddress: node.networkAddress,
    modelID: node.modelID,
    manufacturerName: node.manufacturerName,
    lastSeen: node.lastSeen,
    parentLqi: parentLqi,
    children: [],
  });

  const rootTreeNode = makeTreeNode(coordinator, null);
  treeNodeById.set(coordinator.ieeeAddr, rootTreeNode);

  for (const node of rawNodes) {
    if (!node || !node.ieeeAddr) continue;
    if (node.ieeeAddr === coordinator.ieeeAddr) continue;
    const entry = parentOf.get(node.ieeeAddr);
    const parentLqi = entry ? entry.lqi : 0;
    treeNodeById.set(node.ieeeAddr, makeTreeNode(node, parentLqi));
  }

  // Geräte, die von KEINEM anderen Gerät als Parent referenziert werden UND
  // selbst keinen gültigen Parent-Link haben, sind die einzigen ECHTEN
  // Waisen. Ein Gerät ohne eigenen gültigen Uplink, das aber andere Geräte
  // als IHREN Parent bedienen (z.B. ein Router, dessen eigener Link zum
  // Koordinator gerade als "stale"/relationship 2 markiert ist, der aber
  // weiterhin sichtbar Kinder hat), ist erkennbar Teil des funktionierenden
  // Mesh — es fehlt nur die eigene Uplink-Information. Ein solches Gerät
  // wird daher direkt an den Koordinator gehängt (LQI unbekannt -> 0),
  // statt es fälschlich als Waise zu markieren.
  const nodesWithChildren = new Set();
  for (const entry of parentOf.values()) {
    nodesWithChildren.add(entry.parentId);
  }

  // Es gibt KEINEN synthetischen "Orphans"-Sammelknoten mehr: echte Waisen
  // werden als flache Liste separat von der Baumstruktur zurückgegeben.
  // Jedes Layout positioniert sie selbst passend (Ring-Sektor, eigene
  // Zeile unterhalb des Baums, freie Simulationsknoten ohne Kante), statt
  // sie künstlich in die Hierarchie einzuhängen.
  const orphans = [];
  for (const node of rawNodes) {
    if (!node || !node.ieeeAddr) continue;
    if (node.ieeeAddr === coordinator.ieeeAddr) continue;
    const treeNode = treeNodeById.get(node.ieeeAddr);
    const entry = parentOf.get(node.ieeeAddr);
    if (entry && treeNodeById.has(entry.parentId)) {
      treeNodeById.get(entry.parentId).children.push(treeNode);
    } else if (nodesWithChildren.has(node.ieeeAddr)) {
      rootTreeNode.children.push(treeNode);
    } else {
      orphans.push(treeNode);
    }
  }

  // Mesh-Links: Router<->Router (inkl. Coordinator), nicht bereits Baumkante, lqi > 1.
  const treeEdgeKeys = new Set();
  for (const [childId, entry] of parentOf.entries()) {
    treeEdgeKeys.add(`${childId}|${entry.parentId}`);
    treeEdgeKeys.add(`${entry.parentId}|${childId}`);
  }

  const isRouterLike = (ieeeAddr) => {
    const n = nodeMap.get(ieeeAddr);
    return !!n && (n.type === 'Router' || n.type === 'Coordinator');
  };

  const meshLinkKeys = new Set();
  const meshLinks = [];
  for (const l of rawLinks || []) {
    if (!l || !l.sourceIeeeAddr || !l.targetIeeeAddr) continue;
    if (!(l.lqi > 1)) continue;
    if (!nodeMap.has(l.sourceIeeeAddr) || !nodeMap.has(l.targetIeeeAddr)) continue;
    if (!isRouterLike(l.sourceIeeeAddr) || !isRouterLike(l.targetIeeeAddr)) continue;
    const key = `${l.sourceIeeeAddr}|${l.targetIeeeAddr}`;
    if (treeEdgeKeys.has(key)) continue;
    const dedupeKey = [l.sourceIeeeAddr, l.targetIeeeAddr].sort().join('|');
    if (meshLinkKeys.has(dedupeKey)) continue;
    meshLinkKeys.add(dedupeKey);
    meshLinks.push({ source: l.sourceIeeeAddr, target: l.targetIeeeAddr, lqi: l.lqi });
  }

  return { root: rootTreeNode, orphans, meshLinks, nodeById: treeNodeById };
}

function formatLastSeen(lastSeenMs) {
  if (lastSeenMs === undefined || lastSeenMs === null) return 'unbekannt';
  const ts = Number(lastSeenMs);
  if (!Number.isFinite(ts)) return 'unbekannt';

  const date = new Date(ts);
  const now = Date.now();
  const diffMs = now - ts;
  const diffSec = Math.round(diffMs / 1000);

  const absolute = date.toLocaleString();

  if (diffSec < 0) return absolute;
  if (diffSec < 60) return `vor ${diffSec} Sek. (${absolute})`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} min (${absolute})`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `vor ${diffHours} Std. (${absolute})`;
  const diffDays = Math.round(diffHours / 24);
  return `vor ${diffDays} Tagen (${absolute})`;
}

customElements.define('zigbee-tree-card', ZigbeeTreeCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'zigbee-tree-card',
  name: 'Zigbee Tree Card',
  description: 'Zeigt das Zigbee2MQTT-Netzwerk als Baum/Radial/Force-Layout mit Mesh-Zusatzlinien.',
});
