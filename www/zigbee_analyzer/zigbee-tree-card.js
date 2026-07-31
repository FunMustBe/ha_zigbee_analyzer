/**
 * Zigbee Tree Card (v2)
 * Custom Lovelace card that renders the Zigbee2MQTT network map
 * (sensor.zigbee2mqtt_network_map) with a reconstructed single-parent
 * hierarchy plus thin router<->router mesh links.
 *
 * v2 adds three switchable layouts (tree / radial / force) and
 * label-readability improvements (middle-ellipsis truncation, halo,
 * zoom-dependent visibility, radial label orientation, force collision).
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

const ORPHAN_ROOT_ID = '__orphans__';

const LAYOUTS = ['tree', 'radial', 'force'];
const LAYOUT_LABELS = { tree: 'Baum', radial: 'Radial', force: 'Force' };

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
 * by the tree/radial layouts.
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
        .layout-switch {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 6;
          display: flex;
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

  _applyLabelVisibility(scale) {
    this._currentZoomScale = scale;
    if (!this._labelSelection) return;
    this._labelSelection.style('display', (d) => (scale < 0.6 && nodeType(d) === 'EndDevice' ? 'none' : null));
  }

  /** Baut Card-Chrome (SVG, Zoom, Tooltip, Legende, Layout-Switcher) neu auf und delegiert an das aktive Layout. */
  _draw() {
    const d3 = this._d3;
    const built = this._lastBuilt;
    if (!d3 || !built) return;

    if (this._simulation) {
      this._simulation.stop();
      this._simulation = null;
    }
    this._labelSelection = null;

    const width = this._contentEl.clientWidth || this.clientWidth || 600;
    const height = this._config.height || 600;

    this._contentEl.innerHTML = '';

    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = `${height}px`;
    this._contentEl.appendChild(container);

    // Layout-Umschalter
    const switcher = document.createElement('div');
    switcher.className = 'layout-switch';
    LAYOUTS.forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = LAYOUT_LABELS[mode];
      btn.className = `layout-btn${this._currentLayout === mode ? ' active' : ''}`;
      btn.addEventListener('click', () => this._setLayout(mode));
      switcher.appendChild(btn);
    });
    container.appendChild(switcher);

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

    const ctx = { d3, meshLayer, treeLayer, width, height, built, showTooltip, hideTooltip, lqiColor, lqiWidth };

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
    `;
    container.appendChild(legend);
  }

  /** Statischer Top-down-Baum (Standard-Layout). */
  _renderTreeLayout(ctx) {
    const { d3, treeLayer, meshLayer, width, lqiColor, lqiWidth, built, showTooltip, hideTooltip } = ctx;

    const root = d3.hierarchy(built.root);
    const treeLayout = d3.tree().nodeSize([70, 110]);
    treeLayout(root);

    let minX = Infinity;
    let maxX = -Infinity;
    root.each((d) => {
      if (d.x < minX) minX = d.x;
      if (d.x > maxX) maxX = d.x;
    });
    const treeWidth = maxX - minX || 1;
    const xOffset = width / 2 - (minX + treeWidth / 2);
    const yOffset = 50;
    const posOf = (d) => ({ x: d.x + xOffset, y: d.y + yOffset });

    treeLayer
      .selectAll('path.tree-link')
      .data(root.links())
      .join('path')
      .attr('class', 'tree-link')
      .attr('fill', 'none')
      .attr('stroke', (d) => lqiColor(nodeParentLqi(d.target) || 0))
      .attr('stroke-width', (d) => lqiWidth(nodeParentLqi(d.target) || 0))
      .attr('d', (d) => {
        const s = posOf(d.source);
        const t = posOf(d.target);
        return `M${s.x},${s.y} C${s.x},${(s.y + t.y) / 2} ${t.x},${(s.y + t.y) / 2} ${t.x},${t.y}`;
      });

    if (this._config.show_mesh_links && built.meshLinks.length) {
      const posById = new Map();
      root.each((d) => posById.set(d.data.id, posOf(d)));
      meshLayer
        .selectAll('line.mesh-link')
        .data(built.meshLinks.filter((l) => posById.has(l.source) && posById.has(l.target)))
        .join('line')
        .attr('class', 'mesh-link')
        .attr('stroke', '#888')
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.25)
        .attr('x1', (d) => posById.get(d.source).x)
        .attr('y1', (d) => posById.get(d.source).y)
        .attr('x2', (d) => posById.get(d.target).x)
        .attr('y2', (d) => posById.get(d.target).y);
    }

    const nodeG = treeLayer
      .selectAll('g.node')
      .data(root.descendants())
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => {
        const p = posOf(d);
        return `translate(${p.x},${p.y})`;
      })
      .style('cursor', 'pointer');

    nodeG
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => nodeFill(d))
      .attr('stroke', 'var(--card-background-color, #fff)')
      .attr('stroke-width', 1.5);

    this._labelSelection = nodeG
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('y', (d) => (nodeType(d) === 'Coordinator' ? 26 : 22))
      .text((d) => truncateLabel(nodeFriendlyName(d)));

    nodeG
      .on('mouseenter', showTooltip)
      .on('mousemove', showTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', (event, d) => {
        event.stopPropagation();
        showTooltip(event, d);
      });
  }

  /** Radialer Baum: Koordinator im Zentrum, Ebenen als konzentrische Ringe. */
  _renderRadialLayout(ctx) {
    const { d3, treeLayer, meshLayer, width, height, lqiColor, lqiWidth, built, showTooltip, hideTooltip } = ctx;

    const radius = Math.max(80, Math.min(width, height) / 2 - 70);
    const root = d3.hierarchy(built.root);
    const treeLayout = d3.tree().size([2 * Math.PI, radius]);
    treeLayout(root);

    const centerX = width / 2;
    const centerY = height / 2;
    const radialTree = treeLayer.append('g').attr('class', 'radial-root').attr('transform', `translate(${centerX},${centerY})`);
    const radialMesh = meshLayer.append('g').attr('class', 'radial-mesh').attr('transform', `translate(${centerX},${centerY})`);

    // Kartesische Projektion (nur für die Mesh-Linien-Endpunkte benötigt;
    // Knoten selbst werden per rotate()+translate() positioniert).
    const posOf = (d) => ({
      x: d.y * Math.cos(d.x - Math.PI / 2),
      y: d.y * Math.sin(d.x - Math.PI / 2),
    });

    const linkRadial = d3.linkRadial().angle((d) => d.x).radius((d) => d.y);

    radialTree
      .selectAll('path.tree-link')
      .data(root.links())
      .join('path')
      .attr('class', 'tree-link')
      .attr('fill', 'none')
      .attr('stroke', (d) => lqiColor(nodeParentLqi(d.target) || 0))
      .attr('stroke-width', (d) => lqiWidth(nodeParentLqi(d.target) || 0))
      .attr('d', linkRadial);

    if (this._config.show_mesh_links && built.meshLinks.length) {
      const posById = new Map();
      root.each((d) => posById.set(d.data.id, posOf(d)));
      radialMesh
        .selectAll('line.mesh-link')
        .data(built.meshLinks.filter((l) => posById.has(l.source) && posById.has(l.target)))
        .join('line')
        .attr('class', 'mesh-link')
        .attr('stroke', '#888')
        .attr('stroke-width', 0.5)
        .attr('stroke-opacity', 0.25)
        .attr('x1', (d) => posById.get(d.source).x)
        .attr('y1', (d) => posById.get(d.source).y)
        .attr('x2', (d) => posById.get(d.target).x)
        .attr('y2', (d) => posById.get(d.target).y);
    }

    const nodeG = radialTree
      .selectAll('g.node')
      .data(root.descendants())
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y},0)`)
      .style('cursor', 'pointer');

    nodeG
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => nodeFill(d))
      .attr('stroke', 'var(--card-background-color, #fff)')
      .attr('stroke-width', 1.5);

    // Label entlang des Radius ausgerichtet: rechte Hälfte startet nach
    // außen, linke Hälfte wird um 180° gedreht (+ text-anchor end),
    // damit der Text nie auf dem Kopf steht.
    this._labelSelection = nodeG
      .append('text')
      .attr('class', 'node-label')
      .attr('dy', '0.31em')
      .attr('x', (d) => (d.x < Math.PI ? 8 : -8))
      .attr('text-anchor', (d) => (d.x < Math.PI ? 'start' : 'end'))
      .attr('transform', (d) => (d.x >= Math.PI ? 'rotate(180)' : null))
      .text((d) => truncateLabel(nodeFriendlyName(d)));

    nodeG
      .on('mouseenter', showTooltip)
      .on('mousemove', showTooltip)
      .on('mouseleave', hideTooltip)
      .on('click', (event, d) => {
        event.stopPropagation();
        showTooltip(event, d);
      });
  }

  /** Force-directed Layout mit draggbaren Knoten; Mesh-Links als schwache Zusatzkräfte. */
  _renderForceLayout(ctx) {
    const { d3, treeLayer, meshLayer, width, height, lqiColor, lqiWidth, built, showTooltip, hideTooltip } = ctx;

    const { nodes: flatNodes, edges: treeEdges } = flattenTree(built.root);
    const meshEdges = (this._config.show_mesh_links ? built.meshLinks : []).map((l) => ({
      source: l.source,
      target: l.target,
      mesh: true,
    }));
    const allLinks = treeEdges.map((e) => ({ ...e, mesh: false })).concat(meshEdges);

    // Distanz invers zur LQI: starke Links (hohe LQI) kurz, schwache lang.
    const distanceScale = d3.scaleLinear().domain([0, 255]).range([170, 45]).clamp(true);

    const simulation = d3
      .forceSimulation(flatNodes)
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

    const meshSel = meshLayer
      .selectAll('line.mesh-link')
      .data(meshEdges)
      .join('line')
      .attr('class', 'mesh-link')
      .attr('stroke', '#888')
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.25);

    const linkSel = treeLayer
      .selectAll('line.tree-link')
      .data(treeEdges)
      .join('line')
      .attr('class', 'tree-link')
      .attr('stroke', (d) => lqiColor(d.lqi || 0))
      .attr('stroke-width', (d) => lqiWidth(d.lqi || 0));

    const nodeG = treeLayer
      .selectAll('g.node')
      .data(flatNodes, (d) => d.id)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'grab');

    nodeG
      .append('circle')
      .attr('r', (d) => nodeRadius(d))
      .attr('fill', (d) => nodeFill(d))
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
      });

    const dragBehavior = d3
      .drag()
      .on('start', (event, d) => {
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
        d.fx = null;
        d.fy = null;
      });
    nodeG.call(dragBehavior);

    simulation.on('tick', () => {
      linkSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      meshSel
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);
      nodeG.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });
  }
}

/**
 * Baut aus den rohen Z2M-Netzwerkdaten eine d3.hierarchy-kompatible
 * Baumstruktur mit genau einem Parent pro Gerät plus Orphan-Zweig,
 * sowie die Liste zusätzlicher Router<->Router Mesh-Links.
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

  const orphanRoot = {
    id: ORPHAN_ROOT_ID,
    ieeeAddr: ORPHAN_ROOT_ID,
    friendlyName: 'Orphans',
    type: 'Orphan',
    parentLqi: 0,
    children: [],
  };

  for (const node of rawNodes) {
    if (!node || !node.ieeeAddr) continue;
    if (node.ieeeAddr === coordinator.ieeeAddr) continue;
    const entry = parentOf.get(node.ieeeAddr);
    const parentLqi = entry ? entry.lqi : 0;
    treeNodeById.set(node.ieeeAddr, makeTreeNode(node, parentLqi));
  }

  for (const node of rawNodes) {
    if (!node || !node.ieeeAddr) continue;
    if (node.ieeeAddr === coordinator.ieeeAddr) continue;
    const treeNode = treeNodeById.get(node.ieeeAddr);
    const entry = parentOf.get(node.ieeeAddr);
    if (entry && treeNodeById.has(entry.parentId)) {
      treeNodeById.get(entry.parentId).children.push(treeNode);
    } else {
      orphanRoot.children.push(treeNode);
    }
  }

  if (orphanRoot.children.length > 0) {
    rootTreeNode.children.push(orphanRoot);
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
    meshLinks.push({ source: l.sourceIeeeAddr, target: l.targetIeeeAddr });
  }

  return { root: rootTreeNode, meshLinks, nodeById: treeNodeById };
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
