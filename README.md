# ha_zigbee_analyzer
Home Assistant ZigBee Analyser for Zigbee2MQTT

## Überblick

`zigbee_analyzer` ist eine Home-Assistant-Integration, die das Zigbee2MQTT-Netzwerk
analysiert (u.a. Topologie, Mesh-Gesundheit, Parent-/Router-Beziehungen, Hotspots,
Empfehlungen).

Das Repository enthält zusätzlich die **Zigbee Tree Card**
(`www/zigbee_analyzer/zigbee-tree-card.js`), eine eigenständige custom Lovelace-Karte.
Sie visualisiert das Zigbee2MQTT-Netzwerk als interaktiven Graphen (Baum, Radial oder
Force-Directed) direkt auf Basis des Sensors `sensor.zigbee2mqtt_network_map`
(Attribute `nodes`/`links`) und hängt **nicht** von der `zigbee_analyzer`-Integration
ab.

## Installation der Zigbee Tree Card

1. Datei nach `/config/www/zigbee_analyzer/zigbee-tree-card.js` kopieren.
2. Ressource eintragen: **Einstellungen → Dashboards → Ressourcen** → Ressource
   hinzufügen mit URL `/local/zigbee_analyzer/zigbee-tree-card.js`, Typ
   **JavaScript-Modul**.
3. Nach Änderungen an der Datei: Browser-Hard-Reload (Strg+F5), da das Modul sonst
   im Browser-Cache hängen bleibt.

Die Karte lädt D3.js v7 dynamisch per `import()` von einem CDN
(`https://cdn.jsdelivr.net/npm/d3@7/+esm`) nach — kein Build-Schritt, kein npm, kein
TypeScript, eine einzige Datei. Ist der CDN-Zugriff nicht möglich, zeigt die Karte
eine Fehlermeldung statt abzustürzen.

## Konfiguration

```yaml
type: custom:zigbee-tree-card
entity: sensor.zigbee2mqtt_network_map
height: 800
show_mesh_links: true
layout: radial   # tree | radial | force
```

| Option             | Standard                          | Bedeutung                                                                 |
|--------------------|------------------------------------|-----------------------------------------------------------------------------|
| `entity`           | `sensor.zigbee2mqtt_network_map`  | Entität mit den Attributen `nodes`/`links`.                               |
| `height`           | `600`                             | Höhe der SVG-Zeichenfläche in Pixel.                                      |
| `show_mesh_links`  | `true`                            | Zusätzliche Router-zu-Router-Mesh-Linien ein-/ausblenden.                 |
| `layout`           | `tree`                            | Start-Layout (`tree`, `radial`, `force`); auch live über drei Buttons oben rechts in der Karte umschaltbar. |

## Die drei Layouts

**Baum** — statischer Top-down-Baum (`d3.tree()`), Koordinator oben, Ebenen darunter,
Kanten als sanfte Bezier-Kurven.

**Radial** — Rollen-basiertes Ring-Layout: der Radius codiert die Geräterolle, nicht
die Baumtiefe. Koordinator im Zentrum, alle Router auf einem inneren Ring,
EndDevices und verwaiste Geräte auf einem äußeren Ring. Jedes EndDevice sitzt im
Winkel-Sektor seines Parent-Routers (Sektorbreite proportional zur Anzahl seiner
Kinder), sodass Router-Cluster entstehen statt Linien kreuz und quer durch die
Mitte. Verwaiste Geräte haben hier keinen eigenen Sammelknoten mehr — sie werden
einzeln, grau, ohne Kante in einem gemeinsamen Sektor platziert.

**Force** — kräftebasierte Simulation (`d3.forceSimulation`): Kantendistanz ist
invers zur LQI (starke Links kurz, schwache lang), Knoten stoßen sich ab
(`forceManyBody`) und werden zur Mitte gezogen (`forceCenter`). Gezogene Knoten
bleiben nach dem Loslassen fixiert; ein Doppelklick löst die Fixierung wieder.

In allen drei Layouts sind Knoten per Maus verschiebbar (Baum/Radial: nur visuell,
Doppelklick setzt auf die berechnete Position zurück; Force: physikalisch fixiert,
Doppelklick hebt die Fixierung auf), Pan/Zoom funktioniert per Ziehen/Scrollen auf
freier Fläche, und Hover/Klick auf einen Knoten zeigt ein Tooltip mit friendlyName,
Typ, IEEE-Adresse, Modell, Hersteller, LQI zum Parent und "zuletzt gesehen".

## Designentscheidungen

### Parent-Rekonstruktion

Die Zigbee2MQTT-Networkmap liefert pro Gerät potenziell mehrere, teils
widersprüchliche Links (Nachbarschaftsbeziehungen, veraltete Einträge,
Mess-Artefakte). Die Karte rekonstruiert daraus **genau einen** Parent pro Gerät:

1. Links mit `lqi <= 1` oder `relationship === 2` (stale/ehemaliges Kind) werden
   verworfen.
2. Pro Gerät werden bevorzugt Links mit `relationship === 1` (Child) verwendet; nur
   wenn keiner existiert, wird `relationship === 0` (Neighbor) als Fallback
   zugelassen.
3. Aus den verbleibenden Kandidaten wird der mit der höchsten LQI als Parent
   gewählt.
4. Entsteht durch diese Auswahl ein Zyklus in der Parent-Kette, wird der schwächste
   Link im Zyklus entfernt, damit `d3.hierarchy` nicht crasht.
5. Ein Gerät ohne eigenen gültigen Parent-Link, das aber von einem ANDEREN Gerät
   als dessen Parent referenziert wird (z.B. ein Router, dessen eigener Uplink
   gerade als `relationship: 2`/stale markiert ist, der aber weiterhin sichtbar
   Kinder bedient), gilt als erreichbar und wird direkt an den Koordinator gehängt
   (LQI unbekannt → 0) statt fälschlich als Waise zu gelten.
6. Nur Geräte, die WEDER einen eigenen gültigen Parent-Link NOCH irgendwelche
   Kinder haben, gelten als **echte Waise**. Im Baum- und Force-Layout hängen sie
   sichtbar an einem eigenen "Orphans"-Zweig (der die reale Gerätefarbe behält); im
   Radial-Layout gibt es diesen Sammelknoten nicht — echte Waisen werden dort
   einzeln, grau, ohne Kante in einem gemeinsamen Sektor dargestellt.

Diese Rekonstruktion (`buildTree()`) ist die EINE gemeinsame Datenquelle für alle
drei Layouts — Baum und Force lesen sie über `d3.hierarchy()` bzw. eine flache
Kantenliste, Radial über einen eigenen Rollen-Walk, aber alle drei sehen exakt
dieselbe Parent-/Waisen-Zuordnung.

### LQI-Farbskala

Kanten werden nach der Link-Qualität (LQI, 0–255) eingefärbt, mit einer Farbskala
rot → orange → gelb → grün an den Stützstellen `0, 80, 150, 255`, und mit einer
Strichbreite von 1–4px linear zur LQI. Mesh-Zusatzlinien folgen dieser Skala nicht,
sondern sind einheitlich blau (siehe unten).

### LQI-Zahlen-Regel

Auf jeder Kante kann der LQI-Wert numerisch angezeigt werden: bei **LQI < 40
dauerhaft sichtbar** (schwache Verbindungen sollen sofort auffallen), bei LQI ≥ 40
nur beim Hovern über die Kante. Dafür liegt unter jeder sichtbaren Linie eine
unsichtbare, ca. 10px breite Hit-Area, damit auch dünne Kanten leicht zu treffen
sind. Die Zahl folgt der Kantenmitte live mit, wenn ein Knoten verschoben wird.

### Blaue Mesh-Linien

Router-zu-Router-Nachbarschaften, die nicht bereits eine rekonstruierte
Parent-Kante sind, werden zusätzlich als dünne, gestrichelte, blaue Linien
(`#3498db`, `stroke-dasharray: 4 3`, 50% Deckkraft) eingeblendet, sofern
`show_mesh_links: true` gesetzt ist. So bleiben echte Baum-/Ring-Kanten
(durchgezogen, LQI-farbig) klar von zusätzlichen Mesh-Nachbarschaften (gestrichelt,
blau) unterscheidbar.
