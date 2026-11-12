// ---------------------------------------------------------------------
// Settings: change these to fit your demo
// ---------------------------------------------------------------------
const CONFIG = {
  dataUrl: "data.json",
  center: [49.255, -123.12],
  zoom: 12,
  minZoom: 11,
  maxZoom: 16,          // capped on purpose: VPD offsets locations, so street-level detail would mislead
  radiusMeters: 500,    // size of the area summarized when you click
  defaultView: "map",   // "map", "compare" or "trends"
  defaultYears: [],     // years selected when the page opens: [] = none (a clear map), [2026], "all", or several like [2024, 2025]
  defaultType: "all",   // or a label such as "Bike theft" to open on your demo situation
  defaultTime: "any",   // "any", "morning", "afternoon", "evening" or "overnight" (more can be picked in the app)
  heatStrength: 1.5,    // higher = more of the city lights up; lower = only the strongest hotspots show
  heatFloor: 0,         // faintest a reported spot can be: 0 = quiet areas fully see-through
  hotspotLevel: 0.99,   // how busy a spot must be to show in the top colour: 0.99 = the busiest 1% of the map
  minForChange: 10,     // don't show a % change when the previous year had fewer incidents than this
};

// Four equal six-hour parts of the day, in the order of the time-of-day track (6 am round to 6 am).
// Equal lengths mean their counts compare directly; uneven periods made the longest one look busiest.
const IN_BUCKET = {
  morning: (h) => h >= 6 && h < 12,
  afternoon: (h) => h >= 12 && h < 18,
  evening: (h) => h >= 18,
  overnight: (h) => h >= 0 && h < 6,
};
// The time-of-day filter is a set of clock hours (0-23), or null for any time (see "Time of day" below)
const blockHours = (k) => [...Array(24).keys()].filter(IN_BUCKET[k]);
const hoursFor = (k) => (IN_BUCKET[k] ? new Set(blockHours(k)) : null);
// A practical line shown under an area, keyed by crime type label
const TIPS = {
  "Bike theft": "Bike theft is common here. Use a U-lock through the frame and bring your bike inside overnight.",
  "Theft from cars": "Theft from cars is common here. Don't leave anything visible in a parked car, even a charging cable.",
  "Car theft": "Car theft shows up here. Park in a lit or secured spot and keep keys and fobs out of sight at home.",
  "Home break-ins": "Home break-ins show up here. When viewing a place, ask about building entry, locks and storage security.",
  "Business break-ins": "Business break-ins are common here, mostly overnight when shops are closed.",
  "Other theft": "Most reports here are everyday theft. Keep phones and bags close in busy spots.",
  "Mischief and vandalism": "Much of what's reported here is vandalism and property damage.",
  "Traffic collisions with injury": "Injury collisions show up here. Take extra care crossing busy streets, especially after dark.",
};

// Point layout the app works with: [lat, lng, typeIndex, hour (-1 = unknown), year, month*100 + day].
// data.json stores one list per field instead, see pointRows() below.
const LAT = 0, LNG = 1, TYPE = 2, HOUR = 3, YEAR = 4, MD = 5;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const CITY_BOUNDS = [[49.198, -123.225], [49.316, -123.023]];

const state = {
  data: null, years: new Set(), type: "all", hours: hoursFor(CONFIG.defaultTime), view: CONFIG.defaultView,
  selected: null,               // the spot clicked in Map view
  a: null, b: null, nextSlot: "a",   // the two spots in Compare view
  shown: null, compare: null,   // which incidents are on the map, and which they're compared with
  city: null,                   // city-wide totals for the current filters (see updateHeat)
};
const $ = (id) => document.getElementById(id);
const fmt = (n) => n.toLocaleString("en-CA");
const fmtHour = (h) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
const listJoin = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const bump = (counts, key) => counts.set(key, (counts.get(key) || 0) + 1);   // add one to a Map of counts
// Crime type counts as [typeIndex, count], most first (ties by type order)
const ranked = (types) => [...types.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
const isDark = () => document.documentElement.getAttribute("data-theme") === "dark";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phoneQuery = window.matchMedia("(max-width: 760px)");   // matches the phone layout in styles.css
const isPhone = () => phoneQuery.matches;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const ICON_BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

// ---------------------------------------------------------------------
// Step 1: the base map of Vancouver
// ---------------------------------------------------------------------
// Leaflet and leaflet.heat come from CDNs: if either didn't load, say so instead of showing "Loading" forever
if (!window.L?.heatLayer) {
  showError("couldn't load Leaflet or leaflet.heat from the CDN (see the script tags in index.html).");
  throw new Error("VanScene: map scripts didn't load");
}
const map = L.map("map", {
  minZoom: CONFIG.minZoom, maxZoom: CONFIG.maxZoom, zoomControl: false,
  // Quarter steps: whole steps made the opening view round down to half size whenever the city
  // didn't quite fit at the next level, and made each scroll a jarring jump
  zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 120,   // about a third of a step per mouse-wheel notch
  scrollWheelZoom: false,   // our own wheel zoom below
  // Leaflet's fling has no top speed, so a quick swipe kept gliding for ten seconds or more; this caps it near two
  inertiaMaxSpeed: 1500,
}).setView(CONFIG.center, CONFIG.zoom);

// Zooming glides. Leaflet zooms in fixed 0.25 s steps by stretching a picture of the old view, so street names grew
// or shrank and then snapped to size, and a wheel spin queued up jumps. Instead the wheel, the +/- buttons,
// double-click, the keyboard and every animated setView or fitBounds move the map a little each frame towards
// where it's heading, the way a touch pinch does: MapLibre redraws the streets and names at their real size
// (the bridge's pinch path), and the heat is redrawn with it each frame (see map.on("zoom") in step 2).
// More scrolling just moves the target on, so the zoom follows the wheel without steps
let glide = null;   // { at: the screen point that stays put, ll: the place under it, target: zoom, raw: the wheel's unrounded target, v: its speed, ms, input, t, stopped }
// Glide towards `zoom` around container point `at`. `ms` sets the pace: most of the way in ~4 × ms
function glideTo(at, zoom, ms) {
  if (!glide) { glide = { t: performance.now(), v: 0 }; map._moveStart(true, false); requestAnimationFrame(glideFrame); }
  Object.assign(glide, { at, ll: map.containerPointToLatLng(at), target: zoom, raw: zoom, ms, input: performance.now(), stopped: false });
}
map._tryAnimatedZoom = function (center, zoom, options = {}) {
  const z0 = this._zoom, s = this.getZoomScale(zoom, z0);
  if (options.animate === false || reduceMotion || Math.abs(s - 1) < 1e-3
      || Math.abs(zoom - z0) > this.options.zoomAnimationThreshold) return false;   // Leaflet jumps there
  // The one point that sits at the same place on screen before and after, so the zoom happens around it
  const shift = this.project(center, z0).subtract(this.project(this.getCenter(), z0));
  glideTo(this.getSize().divideBy(2).add(shift.divideBy(1 - 1 / s)), zoom, 45);
  return true;
};
function glideFrame(now) {
  const g = glide, dt = Math.min(Math.max(now - g.t, 0), 50);   // capped, so a stalled frame doesn't leap
  g.t = now;
  if (g.stopped) { glide = null; map._moveEnd(true); return; }   // left where the drag or jump put it
  // A spring with just enough damping not to overshoot, worked out exactly over the frame: it eases in from rest and
  // keeps its speed when more scrolling moves the target, where plain easing started every notch at full speed, a jolt
  const w = 1000 / g.ms, t = dt / 1000, x = map._zoom - g.target, k = Math.exp(-w * t);
  let z = g.target + (x + (g.v + w * x) * t) * k;
  g.v = (g.v - w * (g.v + w * x) * t) * k;
  if (Math.abs(z - g.target) < 0.005 && Math.abs(g.v) < 0.05) { z = g.target; g.v = 0; }   // too little left to see
  if (z !== map._zoom) {
    // The centre that keeps g.ll under g.at at zoom z
    map._move(map.unproject(map.project(g.ll, z).subtract(g.at).add(map.getSize().divideBy(2)), z), z, { pinch: true, glide: true });
  } else if (now - g.input > 200) {
    // Arrived, and no more scrolling for a moment. Waiting first means slow scrolling stays one glide, rather than a
    // stop and the heat's redraw at every notch
    glide = null; map._moveEnd(true); return;
  }
  requestAnimationFrame(glideFrame);
}
// A drag or another move stops the glide where it is (setView carries it on, by calling _tryAnimatedZoom straight after)
const leafletStop = map._stop;
map._stop = function () { if (glide) glide.stopped = true; return leafletStop.call(this); };
// The wheel moves the target zoom around the pointer. Scrolling adds up exactly, and the target is that total rounded
// on to the next quarter step (what the heat is worked out at), so the map never has to round off after it stops
// (shortcut: no faster rate for trackpad pinches, add one if they feel slow)
L.DomEvent.on(map.getContainer(), "wheel", (e) => {
  L.DomEvent.preventDefault(e);
  const at = map.mouseEventToContainerPoint(e), d = L.DomEvent.getWheelDelta(e) / map.options.wheelPxPerZoomLevel;
  const raw = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), (glide && !glide.stopped ? glide.raw : map.getZoom()) + d));
  const zoom = map._limitZoom(d > 0 ? Math.ceil(raw * 4 - 1e-6) / 4 : Math.floor(raw * 4 + 1e-6) / 4);
  if (reduceMotion) return map.setZoomAround(at, zoom);   // jumps there, see _tryAnimatedZoom
  if (zoom === map.getZoom() && !glide) return;
  glideTo(at, zoom, 65);   // a little softer than the buttons, so notches run together
  glide.raw = raw;
});
// The basemap bridge sizes MapLibre at 1.2 × the map, which is a fraction of a pixel on many window widths: MapLibre
// then took it for a resize and cleared its picture after every move
L.MaplibreGL && (L.MaplibreGL.prototype.getSize = function () { return this._map.getSize().multiplyBy(1 + 2 * this.options.padding).round(); });
// Only the credits the licences require (see ofmCredit); Leaflet's own "Leaflet" link is optional
map.attributionControl.setPrefix(false).setPosition("bottomleft");   // its own corner: see the styles
// Keeps people near Vancouver, with room to slide any part of the city out from behind the side panels
map.setMaxBounds([[49.10, -123.55], [49.40, -122.70]]);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.control.scale({ position: "bottomright", imperial: false, maxWidth: 110 }).addTo(map);   // sits above the zoom buttons

// The basemap: OpenFreeMap's vector tiles (free, no key) drawn by MapLibre in our own colours:
// blue water, green parks, white roads and warm highways by day; slate land, deep blue water and teal parks at night.
// Its names are drawn by a second layer in their own pane above the heat, so they stay readable where reports are densest
map.createPane("labels");
map.getPane("labels").style.zIndex = 395;        // above the heat (390), below the circles (400) and the outside shade (450)
map.getPane("labels").style.pointerEvents = "none";
// Roads in three steps: quiet side streets (road), stand-out main roads (major) and the
// brightest highways, so the city's structure reads at a glance
const MAP_COLOURS = {
  light: { land: "#eef1f4", built: "#e7ebef", building: "#dbe0e6", park: "#cbe7bd", water: "#9ecff2", road: "#ffffff", major: "#ffffff", secondary: "#ffffff",
    casing: "#d3d9e0", highway: "#f6d27c", rail: "#c9d0d8", text: "#323b44", halo: "rgba(238, 241, 244, 0.8)", waterText: "#3d6c9a", parkText: "#3c7f37",
    district: "#5d6670", city: "#1c252d" },
  dark: { land: "#2c333d", built: "#2f3640", building: "#363e49", park: "#1e5d55", water: "#1d2c76", road: "#3e4757", major: "#8a99b8", secondary: "#56627a",
    casing: "#2c333d", highway: "#b3c0db", rail: "#3a4351", text: "#e6ebf1", halo: "rgba(36, 42, 51, 0.8)", waterText: "#93a6e6", parkText: "#74d38f",
    district: "#aab3bf", city: "#f3f5f8" },
};
const OFM = "https://tiles.openfreemap.org/styles/positron";
let ofmStyle = null;   // OpenFreeMap's Positron style, which mapStyle() recolours for the theme
// Each of the style's layers gets a colour from MAP_COLOURS by what it draws; layers not listed are left out
const PAINT = [
  [/^background$/, "background-color", "land"], [/^park$|landcover_wood/, "fill-color", "park"], [/^water$/, "fill-color", "water"],
  [/^waterway$/, "line-color", "water"], [/landuse_residential|aeroway-area/, "fill-color", "built"], [/^building$/, "fill-color", "building"],
  [/casing/, "line-color", "casing"], [/motorway_(inner|subtle)|motorway_bridge_inner/, "line-color", "highway"],
  [/highway_(minor|path)|tunnel_motorway_inner|road_pier|aeroway-(runway|taxiway)$/, "line-color", "road"],
  [/highway_major_(inner|subtle)/, "line-color", "major"],
  [/^railway/, "line-color", "rail"],
  [/water_name/, "text-color", "waterText"], [/highway-name-(minor|major)|label_(city|town)$/, "text-color", "text"],
];
// Every label's outline is thin, soft and close to the land colour, so letters lift off busy
// ground without looking stickered on
const halo = (c) => ({ "text-halo-color": c.halo, "text-halo-width": 1, "text-halo-blur": 0.6 });
function mapStyle(labels) {
  const c = MAP_COLOURS[isDark() ? "dark" : "light"];
  const layers = [];
  for (const l of ofmStyle.layers) {
    const rule = PAINT.find(([re]) => re.test(l.id));
    if (!rule || (l.type === "symbol") !== labels) continue;
    const paint = { ...l.paint, [rule[1]]: c[rule[2]] };
    // Full-strength text (the style fades some names), so street names stay readable over the heat
    if (l.type === "symbol") Object.assign(paint, { "text-opacity": 1, ...halo(c) });
    if (l.id === "building") paint["fill-outline-color"] = c.building;
    // Only the arterials stand out: primary roads in full, secondary ones softer, and the many
    // tertiary roads drawn like side streets
    if (rule[2] === "major") paint["line-color"] = ["match", ["get", "class"], ["primary", "trunk"], c.major, "secondary", c.secondary, c.road];
    const layer = { ...l, paint };
    // Neighbouring cities named large; Vancouver itself is left out, since our neighbourhood names fill it
    if (/label_(city|town)$/.test(l.id)) {
      layer.filter = ["all", l.filter, ["!=", ["get", "name"], "Vancouver"]];
      layer.layout = { ...l.layout, "text-size": 17, "text-font": ["Noto Sans Bold"] };
    }
    // Main streets named from city zoom in small capitals: a regular weight and
    // smaller than the bold, wider-spaced district names, so the two never read as the same kind of label
    if (l.id === "highway-name-major") {
      layer.layout = { ...l.layout, "text-transform": "uppercase", "text-letter-spacing": 0.04,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 15, 10.5] };
    }
    layers.push(layer);
  }
  // Park names in green: the big parks from city zoom (named points in the tiles' park layer),
  // then every park at street zoom (points of interest, only in the tiles from z14, which this layer reaches at
  // Leaflet zoom 15 since the bridge runs MapLibre one level lower). Stanley Park is skipped: our neighbourhood label names it
  if (labels) {
    const parkName = (id, sourceLayer, filter, minzoom) => ({ id, type: "symbol", source: "openmaptiles", "source-layer": sourceLayer, minzoom, filter,
      layout: { "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-max-width": 7 },
      paint: { "text-color": c.parkText, ...halo(c) } });
    layers.push(parkName("park-name-big", "park", ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "name"], "Stanley Park"]], 9));
    layers.push(parkName("park-name", "poi", ["==", ["get", "class"], "park"], 13));
  }
  // Our neighbourhood names and the city's name, last so MapLibre places them first: every label on the map is then
  // placed by one system, and a street or park name that would collide with one of them is the one left out.
  // Both go at street zoom (MapLibre zoom 14 = Leaflet zoom 15), where street and park names take over
  if (labels && hoodNames) {
    const named = (id, filter, layout, color) => ({ id, type: "symbol", source: "hoods", maxzoom: 14, filter,
      layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], ...layout },
      paint: { "text-color": color, ...halo(c) } });
    layers.push(named("hood-names", ["!", ["has", "city"]], { "text-size": 11, "text-transform": "uppercase", "text-letter-spacing": 0.12,
      "text-max-width": 7, "text-padding": 4, "symbol-sort-key": ["get", "rank"] }, c.district));
    // Large and bold at a fixed size, so it stays big while the map zooms in around it
    layers.push(named("city-name", ["has", "city"], { "text-size": 28, "text-letter-spacing": -0.01 }, c.city));
    return { ...ofmStyle, sources: { ...ofmStyle.sources, hoods: { type: "geojson", data: hoodNames } }, layers };
  }
  return { ...ofmStyle, layers };
}
let hoodNames = null;   // GeoJSON of the neighbourhood names, made once the data has loaded
let boundaries = null;  // the City's local areas (boundaries.json); without them the app names spots by nearest centre
// What MapLibre starts with until the style arrives; it names the fonts too, or MapLibre logs "glyphsUrl is not set"
const emptyStyle = { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sources: {}, layers: [] };
// Only the credits the licences require: OpenMapTiles (CC-BY, for the tile schema) and OpenStreetMap (ODbL, linked to
// its copyright page; "© OpenStreetMap" is one of its accepted forms). OpenFreeMap says crediting it is optional
const ofmCredit = '&copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// If MapLibre or the style can't be fetched, fall back to plain OpenStreetMap tiles, greyed out, so there's always a map
const osmFallback = () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { className: "osm-fallback", maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
const glBase = L.maplibreGL ? L.maplibreGL({ style: emptyStyle, attribution: ofmCredit }).addTo(map) : null;
const glLabels = L.maplibreGL ? L.maplibreGL({ style: emptyStyle, pane: "labels" }).addTo(map) : null;
// Draws the basemap and its labels in the current theme; labelsOnly when only our names changed. Waits for the style
function paintBasemap(labelsOnly = false) {
  if (!ofmStyle) return;
  // Patched in place (MapLibre's diff), not replaced: replacing a style whose icon sprite is still downloading cancels
  // that download, which MapLibre reports as an uncaught AbortError. The starter style already names the fonts
  if (!labelsOnly) glBase.getMaplibreMap().setStyle(mapStyle(false));
  glLabels.getMaplibreMap().setStyle(mapStyle(true));
}
if (glBase) {
  fetch(OFM).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((s) => { ofmStyle = s; paintBasemap(); })
    .catch(() => { map.removeLayer(glBase); map.removeLayer(glLabels); osmFallback(); });
} else osmFallback();

// ---------------------------------------------------------------------
// Step 1b: lighter colour where our data covers, darker everywhere else
// ---------------------------------------------------------------------
// The covered area is worked out from the incidents in data.json, so no extra file is needed.
const SHADE = {
  // [red, green, blue, strength 0-1] for the area our data covers (inside) and everywhere else (outside)
  // Lighter than before so the basemap's water and parks keep their colour; outside stays dimmed but readable
  light: { inside: [255, 255, 255, 0], outside: [30, 40, 48, 0.45] },
  dark: { inside: [255, 255, 255, 0.03], outside: [8, 12, 24, 0.5] },
  cellMeters: 250,                 // grid size used to find the covered area
  smoothness: 2,                   // how rounded the border is: 0 = blocky, 1 = slight, 2 = smooth, 3 = very smooth
  edgeSoftness: 0.15,              // 0.05 = crisp edge, 0.5 = soft faded edge
};

// Two layers: the light inside tint sits below the heat; the dark outside shade sits above it,
// so any heat that blurs past the city edge (into the water or Burnaby) is dimmed.
map.createPane("maskInside");
map.getPane("maskInside").style.zIndex = 350;    // above the grey tiles, below the heat layer (390)
map.getPane("maskInside").style.pointerEvents = "none";
map.createPane("maskOutside");
map.getPane("maskOutside").style.zIndex = 450;   // above the heat layer
map.getPane("maskOutside").style.pointerEvents = "none";
let coverage = null;                             // the smoothed coverage grid, kept so the colours can change with the theme
// Each theme's shading, painted once and kept: repainting it took ~100 ms, which made the theme switch stutter.
// Both stay on the map and styles.css shows the current theme's, fading between them with the panels
const masks = {};

function addCoverageMask(points) {
  const SW = [49.0, -123.6], NE = [49.5, -122.7]; // a box bigger than anything the map can show
  const dLat = SHADE.cellMeters / 111320;
  const dLng = dLat / Math.cos((49.25 * Math.PI) / 180);
  const rows = Math.ceil((NE[0] - SW[0]) / dLat);
  const cols = Math.ceil((NE[1] - SW[1]) / dLng);
  const idx = (r, c) => r * cols + c;

  // 1. Mark every grid cell that has at least one incident
  const has = new Uint8Array(rows * cols);
  for (const p of points) {
    const r = Math.floor((p[LAT] - SW[0]) / dLat);
    const c = Math.floor((p[LNG] - SW[1]) / dLng);
    if (r >= 0 && r < rows && c >= 0 && c < cols) has[idx(r, c)] = 1;
  }

  // 2. Grow the marked cells by one so small gaps between them close up
  const covered = new Uint8Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    for (let a = -1; a <= 1 && !covered[idx(r, c)]; a++) for (let b = -1; b <= 1; b++) {
      const rr = r + a, cc = c + b;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && has[idx(rr, cc)]) { covered[idx(r, c)] = 1; break; }
    }
  }

  // 3. "Outside" = empty cells you can reach from the edge of the box.
  //    Empty pockets surrounded by covered cells (parks, etc.) count as inside.
  const outside = new Uint8Array(rows * cols);
  const stack = [];
  for (let r = 0; r < rows; r++) stack.push([r, 0], [r, cols - 1]);
  for (let c = 0; c < cols; c++) stack.push([0, c], [rows - 1, c]);
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    const i = idx(r, c);
    if (outside[i] || covered[i]) continue;
    outside[i] = 1;
    stack.push([r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]);
  }

  // 4. Smooth the border: blur the grid (three quick box blurs are close to a Gaussian blur)
  const field = Float32Array.from(outside);
  const k = SHADE.smoothness;
  if (k > 0) {
    const tmp = new Float32Array(rows * cols);
    for (let pass = 0; pass < 3; pass++) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0, n = 0;
        for (let d = -k; d <= k; d++) { const cc = c + d; if (cc >= 0 && cc < cols) { sum += field[idx(r, cc)]; n++; } }
        tmp[idx(r, c)] = sum / n;
      }
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sum = 0, n = 0;
        for (let d = -k; d <= k; d++) { const rr = r + d; if (rr >= 0 && rr < rows) { sum += tmp[idx(rr, c)]; n++; } }
        field[idx(r, c)] = sum / n;
      }
    }
  }

  const km2 = field.filter((v) => v <= 0.5).length * (SHADE.cellMeters / 1000) ** 2;   // the land the data covers
  coverage = { field, rows, cols, idx, SW, NE, dLat, dLng, km2 };
  for (const t in masks) { masks[t].forEach((l) => map.removeLayer(l)); delete masks[t]; }
  const theme = isDark() ? "dark" : "light";
  paintCoverage(theme);
  // The other theme's when the browser is idle, so it's ready before anyone clicks the switch
  (window.requestIdleCallback || setTimeout)(() => paintCoverage(theme === "dark" ? "light" : "dark"));
}

// Is this spot in the darkened area outside the data (the water, Burnaby, the North Shore)?
function isOutside(ll) {
  if (!coverage) return false;
  const { field, rows, cols, idx, SW, dLat, dLng } = coverage;
  const r = Math.floor((ll.lat - SW[0]) / dLat), c = Math.floor((ll.lng - SW[1]) / dLng);
  return r < 0 || r >= rows || c < 0 || c >= cols || field[idx(r, c)] > 0.5;
}

// Paint the coverage grid in one theme's colours, unless that theme's is already painted
function paintCoverage(theme) {
  if (!coverage || masks[theme]) return;
  const { field, rows, cols, idx, SW, NE } = coverage;
  const colours = SHADE[theme];
  // Paint at 4x the grid resolution so the curved edge stays smooth (row 0 is the south edge)
  const UP = 4, W = cols * UP, H = rows * UP;
  const e = Math.max(SHADE.edgeSoftness, 0.01);
  const at = (r, c) => field[idx(Math.min(rows - 1, Math.max(0, r)), Math.min(cols - 1, Math.max(0, c)))];
  const make = (rgba, outsideLayer) => {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const gr = (H - y - 0.5) / UP - 0.5, r0 = Math.floor(gr), fr = gr - r0;
      for (let x = 0; x < W; x++) {
        const gc = (x + 0.5) / UP - 0.5, c0 = Math.floor(gc), fc = gc - c0;
        const v = (at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc) * (1 - fr)
                + (at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc) * fr;
        let t = Math.min(1, Math.max(0, (v - 0.5) / e + 0.5));
        t = t * t * (3 - 2 * t);                      // 0 = inside, 1 = outside
        const o = (y * W + x) * 4;
        img.data[o] = rgba[0]; img.data[o + 1] = rgba[1]; img.data[o + 2] = rgba[2];
        img.data[o + 3] = 255 * rgba[3] * (outsideLayer ? t : 1 - t);
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  };
  const opts = (pane) => ({ pane, interactive: false, className: `mask-${theme}` });
  masks[theme] = [
    // The light theme's inside tint is fully clear, so it isn't drawn at all
    ...(colours.inside[3] ? [L.imageOverlay(make(colours.inside, false), [SW, NE], opts("maskInside")).addTo(map)] : []),
    L.imageOverlay(make(colours.outside, true), [SW, NE], opts("maskOutside")).addTo(map),
    // Past the box everything is outside: one flat sheet of the same shade with the box cut out, so a wide screen
    // zoomed out (which can see beyond the box) stays dimmed right to the edges
    L.polygon([[[-85, -180], [-85, 180], [85, 180], [85, -180]], [SW, [SW[0], NE[1]], NE, [NE[0], SW[1]]]], {
      // A whole screen of margin each way: Leaflet redraws shapes only when a drag ends, so no gap opens mid-drag
      ...opts("maskOutside"), renderer: L.svg({ pane: "maskOutside", padding: 1 }), stroke: false, fillColor: `rgb(${colours.outside.slice(0, 3)})`, fillOpacity: colours.outside[3],
    }).addTo(map),
  ];
}

// ---------------------------------------------------------------------
// Step 2: the heat layer (filled once the data loads)
// ---------------------------------------------------------------------
// leaflet.heat paints only the visible rectangle, so zooming out or panning showed a hard edge where the
// heat just off screen (under the top bar, say) had never been drawn. These versions of its methods paint
// a margin of HEAT_PAD around the view, the way Leaflet's own vector layers do. They also skip drawing
// while the map has no size: leaflet.heat threw there and stopped this whole script before the data loaded.
// What the heat draws (filled in by updateHeat, explained there), declared here because the layer draws on creation
let heatSpots = [], refSpots = [];
let refHours = null;                       // whether refSpots was last worked out for a time of day
const refScales = new Map();               // the colour scale at each zoom, for refSpots (see heatScale)
const HEAT_PAD = 0.35;   // of the map's size, on each side: covers a half-step zoom out or a short pan
Object.assign(L.HeatLayer.prototype, {
  _reset() {
    const map = this._map, size = map.getSize(), pad = size.multiplyBy(HEAT_PAD).round();
    this._pad = pad; this._center = map.getCenter(); this._zoom = map.getZoom();
    L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint(pad.multiplyBy(-1)));
    const w = size.x + 2 * pad.x, h = size.y + 2 * pad.y;
    if (this._heat._width !== w) this._canvas.width = this._heat._width = w;
    if (this._heat._height !== h) this._canvas.height = this._heat._height = h;
    L.Util.cancelAnimFrame(this._frame);   // a redraw drawHeat asked for at zoomend: this one covers it
    this._redraw();
    zoomStopped(this);   // a zoom's own frames, if any, finish settling from here
  },
  _redraw() {
    this._frame = null;
    if (!this._pad || !this._heat._width || !this._heat._height) return;
    // Hidden under a zoom's own frames: wait for them to finish (endMorph), so it doesn't hold them up
    if (this._morph?.parentNode) { this._stale = true; return; }
    const map = this._map, pad = this._pad, w = this._heat._width, h = this._heat._height, r = this._heat._r, data = [];
    for (const [lat, lng, v] of cellsAt(map.getZoom())) {
      const c = map.latLngToContainerPoint([lat, lng]), x = c.x + pad.x, y = c.y + pad.y;
      if (x > -r && y > -r && x < w + r && y < h + r) data.push([Math.round(x), Math.round(y), v]);
    }
    this._heat.data(data).draw(this.options.minOpacity);
  },
  _animateZoom(e) {
    placeHeat(this, e.zoom, e.center);
    startMorph(this, e);
  },
});
// Move and scale the drawn heat to where the map is heading. The same arithmetic as Leaflet's padded renderers, with
// a top-left transform origin
function placeHeat(layer, zoom, center) {
  const scale = map.getZoomScale(zoom, layer._zoom);
  const topLeft = map.getSize().multiplyBy(0.5 + HEAT_PAD).multiplyBy(-scale)
    .add(map.project(layer._center, zoom)).subtract(map._getNewPixelOrigin(center, zoom));
  L.DomUtil.setTransform(layer._canvas, topLeft, scale);
}
// Spots are merged into cells of half the radius + blur, as leaflet.heat does, but on a grid fixed to the map at each
// zoom rather than to the screen, so the same spots stay together while the map moves. Cells are [lat, lng, strength,
// x, y] at their spots' weighted centre (x, y in map pixels at that zoom). Kept per zoom until the heat's data changes (see updateHeat)
const heatCellCache = new Map();
// Spots summed into zoom z's cells as [x * n, y * n, n] (map pixels weighted by count), for cellsAt and heatScale
function binSpots(spots, z) {
  const radius = heatRadius(z), size = (radius + heatBlur(radius)) / 2, cells = new Map();
  for (const [lat, lng, n] of spots) {
    const p = map.project([lat, lng], z), key = Math.floor(p.x / size) * 1e8 + Math.floor(p.y / size), s = cells.get(key);
    if (s) { s[0] += p.x * n; s[1] += p.y * n; s[2] += n; } else cells.set(key, [p.x * n, p.y * n, n]);
  }
  return [...cells.values()];
}
function cellsAt(z) {
  if (!heatSpots.length) return [];   // also the layer's first draw, before the helpers below exist
  if (heatCellCache.has(z)) return heatCellCache.get(z);
  const scale = heatScale(z);
  // Square root: the busiest cells are many times the rest, so on a straight scale downtown saturated into one blob
  const out = binSpots(heatSpots, z).map(([x, y, n]) => {
    const ll = map.unproject([x / n, y / n], z);
    return [ll.lat, ll.lng, Math.min(Math.sqrt(n * scale), 1), x / n, y / n];   // and its map pixel, for liveSpots
  });
  heatCellCache.set(z, out);
  return out;
}

// Zooming, so it feels like zooming into the same map rather than switching to another one. The heat you were
// looking at stays stuck to the map: every blob moves and grows with the streets under it, redrawn each frame
// (Leaflet would only stretch the old picture, which blurs). From the moment the zoom starts, it also eases into the
// new zoom's own detail, blobs settling to their usual size and splitting into finer hotspots (or merging, zooming
// out), finishing just after the map stops. A scroll or pinch of several steps carries on from whatever blend is on
// screen, so nothing snaps back.
// Frames go to a second canvas covering only the visible map, at half resolution and stretched back up: a quarter of
// the pixels to fill each frame, and the blur hides the softer pixels
const MORPH_Q = 0.5, SETTLE_MS = 450;
const smooth = (u) => u * u * (3 - 2 * u);
// Draw `sets` of [cells, weight, place] with blobs of `radius`: place(z, i) gives cell i of zoom z's [x, y] on screen
function drawMorph(layer, radius, sets, place) {
  if (layer._morphGL?.gl.isContextLost()) { layer._morph.remove(); layer._morph = layer._morphGL = layer._morphHeat = null; }   // start afresh
  const view = map.getSize(), cv = layer._morph ??= Object.assign(document.createElement("canvas"), { className: "leaflet-layer heat-morph" });
  layer._morphGL ??= WEBKIT ? null : glHeat(cv);   // before simpleheat asks for a 2D canvas, which would rule WebGL out
  const w = Math.ceil(view.x * MORPH_Q), h = Math.ceil(view.y * MORPH_Q);
  if (cv.width !== w || cv.height !== h || !layer._morphHeat) {
    cv.width = w; cv.height = h; cv.style.width = `${view.x}px`; cv.style.height = `${view.y}px`;
    layer._morphHeat = simpleheat(cv);   // leaflet.heat's drawing engine, a global from its script
  }
  const sh = layer._morphHeat, reach = (radius + heatBlur(radius)) * MORPH_Q;
  // A blob keeps its shape at any size (the blur is a fixed share of the radius), so WebGL stretches one blob picture
  // instead of making a new one every frame: a new canvas and upload 60 times a second piled up and heated laptops
  if (!layer._morphGL || !(Math.abs(Math.log(reach / sh._r)) < 0.2)) sh.radius(radius * MORPH_Q, heatBlur(radius) * MORPH_Q);
  L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
  if (!cv.parentNode) layer._canvas.parentNode.appendChild(cv);
  const r = layer._morphGL ? reach : sh._r, data = [];
  for (const [z, weight] of sets) {
    if (weight < 0.002) continue;
    cellsAt(z).forEach((cell, i) => {
      const [x, y] = place(z, i);
      if (x > -r && y > -r && x < w + r && y < h + r) data.push([x, y, cell[2] * weight]);
    });
  }
  if (layer._morphGL) drawGL(layer._morphGL, sh._circle, r, data, layer.options.minOpacity);
  else sh.data(data).draw(layer.options.minOpacity);
  layer._morphR = radius;
  layer._canvas.style.visibility = "hidden";
}
// Safari, and every browser on an iPhone (all built on WebKit), shows nothing through the #heat-ramp filter on a WebGL
// canvas, so a pinch made the heat vanish until the fingers let go. There the frames use the 2D canvas, which it colours
// shortcut: spots WebKit by its gesture events rather than testing the filter itself; switch to a real test if a WebKit browser fixes this
const WEBKIT = "GestureEvent" in window;
// Zoom frames draw with WebGL where it's there: the 2D canvas spends ~2 µs on every blob, and a few quick wheel notches
// stack up ~7,000 blobs (~15 ms a frame, which made zooming judder), where WebGL draws them all in one go. Each blob is
// two triangles showing leaflet.heat's own blob picture for this radius, so the frames look just like the still heat
function glHeat(cv) {
  const gl = cv.getContext("webgl", { antialias: false, depth: false });
  if (!gl) return null;
  const prog = gl.createProgram();
  for (const [type, src] of [
    [gl.VERTEX_SHADER, "attribute vec4 p; attribute float a; uniform vec2 view; varying vec2 uv; varying float v;"
      + "void main() { gl_Position = vec4(p.xy / view * vec2(2, -2) + vec2(-1, 1), 0, 1); uv = p.zw; v = a; }"],
    [gl.FRAGMENT_SHADER, "precision mediump float; uniform sampler2D blob; varying vec2 uv; varying float v;"
      + "void main() { gl_FragColor = vec4(0, 0, 0, texture2D(blob, uv).a * v); }"],
  ]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s); gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, "p"); gl.bindAttribLocation(prog, 1, "a");
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);    // x, y on the canvas, u, v in the blob
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);   // strength
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   // layered like the 2D canvas
  return { gl, view: gl.getUniformLocation(prog, "view"), blob: null };
}
const QUAD = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]];
// simpleheat's draw, on WebGL: `data` is [x, y, strength] per blob, drawn as the `blob` picture reaching `r` each way
function drawGL(g, blob, r, data, minOpacity) {
  const gl = g.gl, w = gl.canvas.width, h = gl.canvas.height, n = data.length * 30;
  if (g.blob !== blob) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blob); g.blob = blob; }
  if (!(g.buf?.length >= n)) g.buf = new Float32Array(n * 1.5);   // kept between frames, so there's nothing to clear up
  const f = g.buf;
  let i = 0;
  for (const [x, y, v] of data) {
    const a = Math.max(v, minOpacity);
    for (const [u, t] of QUAD) { f[i++] = x + (2 * u - 1) * r; f[i++] = y + (2 * t - 1) * r; f[i++] = u; f[i++] = t; f[i++] = a; }
  }
  gl.viewport(0, 0, w, h); gl.uniform2f(g.view, w, h);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bufferData(gl.ARRAY_BUFFER, f.subarray(0, i), gl.STREAM_DRAW);
  gl.drawArrays(gl.TRIANGLES, 0, data.length * 6);
}
// A new zoom step towards zoom `target`, starting at visual zoom `zNow`. What's on screen is kept as the blend to
// ease out of: the cells shown so far with their weights, and the blob size
function beginStep(layer, target, zNow) {
  const m = layer._step, now = performance.now();
  let sets = [[layer._zoom, 1]], r = heatRadius(layer._zoom);
  if (m && layer._morph?.parentNode) {
    const k = smooth(Math.min(1, (now - m.start) / SETTLE_MS)), kept = new Map();
    for (const [z, w] of m.sets) kept.set(z, (kept.get(z) || 0) + w * (1 - k));
    kept.set(m.target, (kept.get(m.target) || 0) + k);
    sets = [...kept].filter(([, w]) => w > 0.01);
    r = layer._morphR;
  }
  layer._step = { sets, target, r, zNow, start: now };
  return layer._step;
}
// One frame: the map is zoomed by `s` against the step's start, cells are placed by `place`
function drawStep(layer, s, place) {
  const m = layer._step, k = smooth(Math.min(1, (performance.now() - m.start) / SETTLE_MS));
  const radius = m.r * s + (heatRadius(m.zNow + Math.log2(s)) - m.r * s) * k;
  drawMorph(layer, radius, [...m.sets.map(([z, w]) => [z, w * (1 - k)]), [m.target, k]], place);
  return k;
}
// Cell i of zoom z on screen as the map is now: its map pixel at zoom z (see cellsAt), scaled to the map's zoom. Asking
// Leaflet for each cell's place took thousands of projections and objects every frame of a glide, most of its work
function liveSpots() {
  const zoom = map.getZoom(), o = map.getPixelOrigin().subtract(map._getMapPanePos());   // the map's top-left, in map pixels
  let zl, cells, k;
  return (z, i) => {
    if (z !== zl) { zl = z; cells = cellsAt(z); k = map.getZoomScale(zoom, z); }
    return [(cells[i][3] * k - o.x) * MORPH_Q, (cells[i][4] * k - o.y) * MORPH_Q];
  };
}
// An animated zoom (buttons, wheel, trackpad, the end of a pinch). The stretching canvas stays, hidden, because its
// transition tells us how far along the zoom is, so the heat moves in step with the streets
function startMorph(layer, e) {
  cancelAnimationFrame(layer._morphFrame);
  layer._morphRun = (layer._morphRun || 0) + 1;
  const s1 = map.getZoomScale(e.zoom, layer._zoom), pane = map._getMapPanePos(), q = MORPH_Q;
  if (reduceMotion || !heatSpots.length || !layer._pad || Math.abs(s1 - 1) < 1e-3) return endMorph(layer);
  const zNow = map.getZoom(), m = beginStep(layer, e.zoom, zNow), sEnd = map.getZoomScale(e.zoom, zNow);
  // Where each cell sits on screen now and after the zoom, by Leaflet's own (rounded) sums so it lands exactly
  // where the streets do; in between it moves in a straight line, as the map's own zoom transition does
  const ends = new Map();
  const endsOf = (z) => {
    if (!ends.has(z)) ends.set(z, cellsAt(z).map(([lat, lng]) => {
      const a = map.latLngToContainerPoint([lat, lng]), b = map._latLngToNewLayerPoint(L.latLng(lat, lng), e.zoom, e.center).add(pane);
      return [a.x * q, a.y * q, (b.x - a.x) * q, (b.y - a.y) * q];
    }));
    return ends.get(z);
  };
  const frame = () => {
    const t = new DOMMatrixReadOnly(getComputedStyle(layer._canvas).transform).a;   // the stretch so far
    const p = Math.min(1, Math.max(0, (t - 1) / (s1 - 1)));
    drawStep(layer, 1 + (sEnd - 1) * p, (z, i) => { const [x, y, dx, dy] = endsOf(z)[i]; return [x + dx * p, y + dy * p]; });
    layer._morphFrame = requestAnimationFrame(frame);   // until the map stops (zoomStopped takes over)
  };
  frame();
}
// A pinch on a touch screen, and a glide (see the top), move the map itself frame by frame, with no zoom animation.
// A pinch starts a new step each time it passes a quarter zoom (the steps cellsAt works in); a glide eases straight
// towards the zoom it's heading for, so it works out only that zoom's cells (up to ~35 ms), not every quarter on the way
map.on("zoom", (e) => {
  if (!e.pinch || reduceMotion || !heatSpots.length) return;
  cancelAnimationFrame(heat._morphFrame);
  heat._morphRun = (heat._morphRun || 0) + 1;
  const draw = () => {
    const z = map.getZoom(), target = e.glide ? glide.target : quarterZoom(z);
    if (!heat._step || !heat._morph?.parentNode || heat._step.target !== target) beginStep(heat, target, z);
    drawStep(heat, map.getZoomScale(z, heat._step.zNow), liveSpots());
  };
  // A glide moves once a frame, from its own animation frame: draw straight away, so the heat moves with the streets
  if (e.glide) draw(); else heat._morphFrame = requestAnimationFrame(draw);
});
const quarterZoom = (z) => Math.round(z * 4) / 4;
// The map has stopped (from _reset, just after the full redraw underneath, which waits for these frames to end):
// finish settling where everything now is
function zoomStopped(layer) {
  const m = layer._step;
  if (!m || !layer._morph?.parentNode) return endMorph(layer);
  cancelAnimationFrame(layer._morphFrame);
  m.target = layer._zoom;   // the same, unless a pinch let go between quarter steps
  const run = layer._morphRun, live = liveSpots(), sEnd = map.getZoomScale(layer._zoom, m.zNow);
  const frame = () => {
    if (drawStep(layer, sEnd, live) >= 1) return endMorph(layer);
    layer._morphFrame = requestAnimationFrame(frame);
  };
  frame();
  // Frames pause in a background tab, which would leave a half-way picture up: finish anyway
  setTimeout(() => { if (layer._morphRun === run) endMorph(layer); }, SETTLE_MS + 300);
}
// Work out the zoom steps around this one while the page is idle (~35 ms each), so a zoom's first frame doesn't wait
// for them and the heat doesn't lag behind the streets as it starts
function warmCells() {
  if (!heatSpots.length) return;
  const z = map.getZoom(), idle = window.requestIdleCallback ?? ((f) => setTimeout(f, 50));
  const todo = [0.5, -0.5, 0.25, -0.25, 1, -1, 0.75, -0.75].map((d) => z + d).filter((q) => q >= map.getMinZoom() && q <= map.getMaxZoom());
  const next = () => { const q = todo.shift(); if (q === undefined) return; cellsAt(q); idle(next); };
  idle(next);
}
function endMorph(layer) {
  warmCells();
  layer._morphRun = (layer._morphRun || 0) + 1;
  layer._step = null;
  cancelAnimationFrame(layer._morphFrame);
  if (layer._morph?.parentNode) {
    layer._morph.remove();
    if (layer._stale) { layer._stale = false; layer._redraw(); }   // in the same frame, so the swap doesn't show
  }
  layer._canvas.style.visibility = "";
}
// The colours come from --ramp-1..5, so the map and its legend always match the theme. Below the first stop the
// ramp fades to nothing, so streets with only the odd report stay clear instead of a haze over the whole city
const heatGradient = () => ({ 0.4: `${cssVar("--ramp-1")}00`, 0.6: cssVar("--ramp-1"), 0.74: cssVar("--ramp-2"), 0.84: cssVar("--ramp-3"), 0.92: cssVar("--ramp-4"), 1: cssVar("--ramp-5") });
const heat = L.heatLayer([], {
  radius: 11,
  blur: 14,
  maxZoom: CONFIG.minZoom,   // stops leaflet.heat fading points when zoomed out; drawHeat() scales them instead
  minOpacity: CONFIG.heatFloor,
  gradient: heatGradient(),
}).addTo(map);
// leaflet.heat read its whole canvas back to colour it pixel by pixel, ~80 ms for the padded heat and ~20 ms for a
// zoom frame, too slow to keep up with a zoom. Now it draws only each spot's strength (a few ms) and the #heat-ramp
// filter (index.html, styles.css) colours that on the graphics card. Each pixel takes the ramp's opacity as well as
// its colour, so the ramp can fade in
const heatProto = Object.getPrototypeOf(heat._heat), setGradient = heatProto.gradient;
heatProto.draw = function (minOpacity) {
  const ctx = this._ctx;
  ctx.clearRect(0, 0, this._width, this._height);
  for (const [x, y, v] of this._data) {
    ctx.globalAlpha = Math.max(v / this._max, minOpacity);
    ctx.drawImage(this._circle, x - this._r, y - this._r);
  }
  return this;
};
// The filter's red, green, blue and opacity tables: entry i is the ramp at strength i / 255
let rampShown = null, rampRun = 0;
function setRamp(grad) {
  rampShown = grad;
  document.querySelectorAll("#heat-ramp feComponentTransfer > *").forEach((f, c) =>
    f.setAttribute("tableValues", Array.from({ length: 256 }, (_, i) => grad[i * 4 + c] / 255).join(" ")));
}
// A new ramp (a theme switch) eases in over 0.3 s, in step with the panels' colour fade, instead of jumping
heatProto.gradient = function (stops) {
  setGradient.call(this, stops);
  const from = rampShown, to = this._grad, run = ++rampRun, t0 = performance.now();
  if (!from || reduceMotion) { setRamp(to); return this; }
  const step = (t) => {
    if (run !== rampRun) return;   // a newer switch took over
    const k = Math.min(1, (t - t0) / 300);
    setRamp(k < 1 ? from.map((v, i) => v + (to[i] - v) * k) : to);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return this;
};
heat._heat.gradient(heat.options.gradient);   // it was set before these existed
// Its own pane, drawn see-through (see --heat-opacity) so streets and names show through
map.createPane("heat");
map.getPane("heat").style.zIndex = 390;          // above the inside tint, below the circles (400)
map.getPane("heat").style.pointerEvents = "none";
map.getPane("heat").appendChild(heat._canvas);
heat._canvas.style.transformOrigin = "0 0";      // what _animateZoom above expects (leaflet.heat sets 50% 50%)

// Crossfade from the old heat to the new one when the filters change, instead of swapping it in one frame: a copy of
// the old picture fades out in a pane of its own while the heat pane fades back in (see .heat-snap-pane)
function fadeHeat() {
  const old = heat._canvas, pane = map.getPane("heat");
  if (reduceMotion || !old.width || !old.height) return;
  const snap = document.createElement("canvas");
  snap.width = old.width;
  snap.height = old.height;
  snap.getContext("2d").drawImage(old, 0, 0);
  snap.className = "leaflet-layer heat-snap";
  snap.style.transform = old.style.transform;
  const holder = L.DomUtil.create("div", "leaflet-pane heat-snap-pane", map.getPane("mapPane"));
  holder.append(snap);
  pane.style.transition = "none";
  pane.style.opacity = 0;
  getComputedStyle(pane).opacity;   // take the hidden state now, so it fades back even if the redraw holds up the timer
  // A timer, not animation frames: frames pause in background tabs and would leave the heat hidden
  setTimeout(() => {
    pane.style.transition = "";
    pane.style.opacity = "";
    holder.style.opacity = 0;
  }, 40);
  setTimeout(() => holder.remove(), isPhone() ? 1000 : 600);   // once its fade is over (slower on phones, see styles.css)
}

// Circles for the two areas (Compare view): the true 500 m edge, drawn faint so the handle at the centre is what reads first
const circleStyle = (color) => ({ radius: CONFIG.radiusMeters, color, weight: 1.5, opacity: 0.6, fillOpacity: 0.04, interactive: false });
// The clicked spot reads like a phone's own location: a blue dot ringed in white, in a soft blue 500 m circle
const pinStyle = () => ({ color: cssVar("--pin"), fillColor: cssVar("--pin") });
const areaCircle = L.circle(CONFIG.center, { radius: CONFIG.radiusMeters, ...pinStyle(), weight: 1, opacity: 0.5, fillOpacity: 0.22, interactive: false, className: "area-circle" });
const areaPin = L.marker(CONFIG.center, { icon: L.divIcon({ className: "area-pin", iconSize: [22, 22] }), interactive: false, keyboard: false });
const circleA = L.circle(CONFIG.center, circleStyle(cssVar("--circle")));
const circleB = L.circle(CONFIG.center, circleStyle(cssVar("--circle")));
// The A and B labels in the middle of each circle are handles: drag one to move that area
const handleIcon = (slot) => L.divIcon({ className: "ab-handle", html: slot.toUpperCase(), iconSize: [34, 34] });
const handleA = L.marker(CONFIG.center, { icon: handleIcon("a"), draggable: true, title: "Drag to move area A" });
const handleB = L.marker(CONFIG.center, { icon: handleIcon("b"), draggable: true, title: "Drag to move area B" });
const OUTSIDE_NOTE = "That's outside the City of Vancouver, so there's no VPD data for it. Pick a spot in the lit area.";
// A dashed preview of the area under the cursor, so you can see what a click will summarize
const ghost = L.circle(CONFIG.center, { radius: CONFIG.radiusMeters, weight: 1.5, dashArray: "4 6", fill: false, interactive: false });
function paintCircles() {
  for (const c of [circleA, circleB, ghost]) c.setStyle({ color: cssVar("--circle") });
  areaCircle.setStyle(pinStyle());
}
// A clicked area grows out from the click instead of appearing at full size
function growCircle(c) {
  if (reduceMotion) return;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 380);
    c.setRadius(CONFIG.radiusMeters * (0.15 + 0.85 * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------
// Years: which incidents are shown, and which year they're compared with
// ---------------------------------------------------------------------
const latestMd = () => { const [, m, d] = state.data.latestDate.split("-").map(Number); return m * 100 + d; };
const throughLabel = () => { const md = latestMd(); return `${MONTHS[Math.floor(md / 100) - 1]} ${md % 100}`; };
const isPartial = (y) => y === state.data.partialYear;
// Days covered by these years: a full year, or for the year in progress, Jan 1 to the latest report
const daysIn = (years) => Math.max(1, years.reduce((sum, y) => sum + (isPartial(y)
  ? Math.round((new Date(state.data.latestDate + "T12:00:00") - new Date(y, 0, 1, 12)) / 864e5) + 1
  : new Date(y, 1, 29).getMonth() === 1 ? 366 : 365), 0));
// Every year from the first to the last in the data, oldest first, missing years included
function yearSpan() {
  const ys = state.data.years, span = [];
  for (let y = ys[0]; y <= ys[ys.length - 1]; y++) span.push(y);
  return span;
}
// Years inside the data's range that have no incidents at all (e.g. a year missing from the CSV)
const missingYears = () => yearSpan().filter((y) => !state.data.years.includes(y));
const selectedYears = () => state.data.years.filter((y) => state.years.has(y));   // oldest first
const allSelected = () => state.years.size === state.data.years.length;

function buildPeriods() {
  const ys = selectedYears();
  state.shown = { years: new Set(ys), maxMd: 1231 };
  state.compare = null;
  // With exactly one year selected, compare it with the year before (if that year is in the data).
  // A part year (like 2026 so far) is compared with the same dates of the year before, so it's fair.
  if (ys.length === 1 && state.data.years.includes(ys[0] - 1)) {
    state.compare = { years: new Set([ys[0] - 1]), maxMd: isPartial(ys[0]) ? latestMd() : 1231 };
  }
}

// Does an incident pass the type and (unless ignoreTime) time-of-day filters? Years are not checked
function passesFilters(p, ignoreTime = false) {
  if (state.type !== "all" && p[TYPE] !== state.type) return false;
  return ignoreTime || !state.hours || (p[HOUR] >= 0 && state.hours.has(p[HOUR]));
}
function matches(p, period, ignoreTime = false) {
  if (!period || !period.years.has(p[YEAR]) || p[MD] > period.maxMd) return false;
  return passesFilters(p, ignoreTime);
}

// "in 2026 (Jan 1 to Oct 2)", "from 2016 to 2026", or "in 2016–2018 and 2024"
function periodLabel() {
  const ys = selectedYears();
  if (!ys.length) return "with no year picked";
  if (ys.length === 1) return isPartial(ys[0]) ? `in ${ys[0]} (Jan 1 to ${throughLabel()})` : `in ${ys[0]}`;
  const runs = [];
  for (const y of ys) {
    const last = runs[runs.length - 1];
    if (last && y === last[1] + 1) last[1] = y; else runs.push([y, y]);
  }
  if (runs.length === 1) return `from ${runs[0][0]} to ${runs[0][1]}`;
  const parts = runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`));
  return `in ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
function compareName() {
  const y = selectedYears()[0];
  return isPartial(y) ? `the same dates in ${y - 1}` : String(y - 1);
}
const typeLabel = () => (state.type === "all" ? "All types" : state.data.types[state.type].label);
const filterLine = () => `${typeLabel()}, ${timeLabel()}`;

// Up / down / about the same, compared with the year before
function changeInfo(now, before) {
  const single = state.years.size === 1 ? selectedYears()[0] : null;
  if (!state.compare) {
    if (single && missingYears().includes(single - 1)) return { cls: "", text: `No ${single - 1} data to compare` };
    return null;
  }
  const y = selectedYears()[0], name = isPartial(y) ? `same dates ${y - 1}` : String(y - 1);
  if (before < CONFIG.minForChange) return { cls: "", text: `Too few in ${y - 1} to compare` };
  const pct = Math.round(((now - before) / before) * 100);
  if (Math.abs(pct) < 5) return { cls: "", text: `Steady vs ${name}`, pct };
  return pct > 0 ? { cls: "up", text: `↑ ${pct}% vs ${name}`, pct } : { cls: "down", text: `↓ ${Math.abs(pct)}% vs ${name}`, pct };
}

// ---------------------------------------------------------------------
// Time of day: the picked hours, what they're called, and when an area is busiest
// ---------------------------------------------------------------------
// The four parts of the day are shortcuts that add or remove six hours each; the bars under them add or
// remove single hours. Everything is read from 6 am round to 6 am, like the track.
const TRACK_ORDER = Array.from({ length: 24 }, (_, i) => (i + 6) % 24);
// None or all 24 hours both mean any time
function setHours(set) { state.hours = !set || set.size === 0 || set.size === 24 ? null : set; }
// The picked hours in words: "any time", whole parts of the day ("afternoon and evening"),
// or runs of hours ("5 pm–9 pm and 12 am–2 am")
function timeLabel() {
  if (!state.hours) return "any time";
  const whole = Object.keys(IN_BUCKET).filter((k) => blockHours(k).every((h) => state.hours.has(h)));
  if (whole.flatMap(blockHours).length === state.hours.size) return listJoin(whole);
  const runs = [];
  for (const h of TRACK_ORDER) {
    if (!state.hours.has(h)) continue;
    const last = runs[runs.length - 1];
    if (last && last[1] % 24 === h) last[1] = h + 1; else runs.push([h, h + 1]);
  }
  if (runs.length > 1 && runs[runs.length - 1][1] % 24 === runs[0][0]) runs[0][0] = runs.pop()[0];   // joined across 6 am
  return listJoin(runs.map(([a, b]) => `${fmtHour(a)}–${fmtHour(b % 24)}`));
}

// Reports per part of the day, from reports per clock hour
const partCounts = (hours) => Object.fromEntries(Object.keys(IN_BUCKET).map((k) => [k, blockHours(k).reduce((s, h) => s + hours[h], 0)]));
const periodTotal = (buckets) => sum(Object.values(buckets));
// "Busiest" compares incidents per hour. With four equal six-hour parts that's the same as comparing counts,
// but keeping it per hour means the rule stays right if the parts ever change length.
const MIN_FOR_BUSIEST = 20;   // too few incidents with a known time and any "busiest" is mostly chance
const CLEAR_LEAD = 1.25;      // the busiest period's rate must beat the next one by a quarter to be named
function busiestTime(buckets) {
  const total = periodTotal(buckets);
  if (total < MIN_FOR_BUSIEST) return null;
  const [first, second] = Object.keys(IN_BUCKET)
    .map((k) => [k, buckets[k] / blockHours(k).length])
    .sort((a, b) => b[1] - a[1]);
  return first[1] >= second[1] * CLEAR_LEAD ? first[0] : null;
}
// The parts of the day as tiles, styled like the Time of day filter: the picked parts in its grey pill, a part with
// only some hours picked underlined, the rest faded. The busiest part says so in words, not in the "picked" colour.
function timeTiles(buckets) {
  const top = busiestTime(buckets);
  return `<div class="tiles${state.hours ? "" : " all-in"}">${Object.keys(IN_BUCKET).map((k) => {
    const n = state.hours ? blockHours(k).filter((h) => state.hours.has(h)).length : 0;
    return `<div class="${n === 6 ? "on" : n ? "some" : ""}"><p>${cap(k)}</p><p>${fmt(buckets[k])}</p>${k === top ? `<p class="tag">Busiest</p>` : ""}</div>`;
  }).join("")}</div>`;
}
// One line that makes the per-hour comparison readable without new units
function busiestLine(buckets) {
  const total = periodTotal(buckets), top = busiestTime(buckets);
  if (!total) return "";
  if (!top) return `<p class="hint">${total < MIN_FOR_BUSIEST ? "Too few with a known time to say when is busiest." : "No part of the day stands out."}</p>`;
  return `<p class="hint">${cap(top)} is the busiest part of the day: ${Math.round((buckets[top] / total) * 100)}% of reports in ${blockHours(top).length} of 24 hours.</p>`;
}
// The same answer in a few words, for Compare's cards
function busiestShort(buckets) {
  const total = periodTotal(buckets), top = busiestTime(buckets);
  if (!total) return "–";
  return top ?? (total < MIN_FOR_BUSIEST ? "too few to tell" : "no clear peak");
}
// One sentence a screen reader reads in place of an hour chart (its bars are pictures)
function hourSummary(hours, what) {
  const total = sum(hours);
  if (!total) return `${what} by hour of the day: none with a known time.`;
  const peak = hours.indexOf(Math.max(...hours)), low = hours.indexOf(Math.min(...hours));
  return `${what} by hour of the day: busiest at ${fmtHour(peak)} with ${fmt(hours[peak])}, quietest at ${fmtHour(low)} with ${fmt(hours[low])}.`;
}
const attr = (t) => t.replace(/"/g, "&quot;");
// The labels under an hour chart, which runs from 6 am round to 6 am like the track
const HOUR_AXIS = `<div class="hbars-x"><span>6 am</span><span>12 pm</span><span>6 pm</span><span>12 am</span><span>6 am</span></div>`;
// The area card's bar per hour, coloured like the filter's hour bars: the picked hours in the accent, or every hour
// in a softer accent for any time
function hourStrip(hours) {
  const max = Math.max(1, ...hours);
  return `<div class="hbars hbars-sm${state.hours ? "" : " all-in"}" role="img" aria-label="${attr(hourSummary(hours, "Reports near here"))}">${TRACK_ORDER.map((h, i) =>
    `<i class="${state.hours?.has(h) ? "on" : ""}" style="height:${(hours[h] / max) * 100}%;--i:${i}" title="${fmtHour(h)}: ${fmt(hours[h])}"></i>`).join("")}</div>
    ${HOUR_AXIS}`;
}

// The chart inside the time-of-day track: `hours` is reports per clock hour for the chosen years and crime type
// (counted by updateHeat). Each bar is a button for its hour; the picked hours are in the accent.
function drawTrackBars(hours) {
  const max = Math.max(1, ...hours), strip = $("track-bars");
  if (strip.children.length !== 24)   // made once, so later changes animate
    strip.innerHTML = TRACK_ORDER.map((h) => `<button type="button" class="hr" data-hour="${h}"><i></i></button>`).join("");
  for (const bar of strip.children) {
    const h = Number(bar.dataset.hour);
    bar.firstChild.style.height = `${(hours[h] / max) * 100}%`;
    bar.setAttribute("aria-pressed", String(!!state.hours?.has(h)));   // blue only for hours you picked; grey for any time
    bar.title = `${fmtHour(h)}: ${fmt(hours[h])} reports`;
    bar.setAttribute("aria-label", bar.title);
  }
  // The summary is in the name: NVDA read the group's name on the way in but skipped a separate description
  strip.setAttribute("aria-label", `Hours of the day. ${hourSummary(hours, "Reports city-wide")} ${isPhone() ? "Tap" : "Click"} or drag across them to pick hours, or use the arrow keys and Enter.`);
  // One Tab stop for the 24 hours (the focused one, else the first picked, else 6 am); arrows move between them
  const stop = strip.contains(document.activeElement) ? document.activeElement : strip.querySelector('[aria-pressed="true"]') || strip.firstChild;
  for (const bar of strip.children) bar.tabIndex = bar === stop ? 0 : -1;
}
function syncTimeButtons() {
  $("time").classList.toggle("any", !state.hours);
  for (const btn of document.querySelectorAll("#time button[data-time]")) {
    if (btn.dataset.time === "any") {   // says the whole day is in; becomes "Clear" once the day is narrowed down
      btn.textContent = state.hours ? "Clear" : "All 24 hours";
      btn.disabled = !state.hours;
      continue;
    }
    // Any time includes every part without picking one (like the years under "All years"): a tap picks just that part
    const hs = blockHours(btn.dataset.time), n = state.hours ? hs.filter((h) => state.hours.has(h)).length : 0;
    btn.setAttribute("aria-pressed", n === hs.length ? "true" : n ? "mixed" : "false");
  }
}

function bindTimeControls() {
  // The parts of the day: from any time, a tap picks just that part (like years); after that each tap adds
  // or removes its six hours. The "any" link clears the selection.
  $("time").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-time]");
    if (!btn) return;
    const k = btn.dataset.time;
    if (k === "any") setHours(null);
    else if (!state.hours) setHours(hoursFor(k));
    else {
      const set = new Set(state.hours), hs = blockHours(k), all = hs.every((h) => set.has(h));
      for (const h of hs) all ? set.delete(h) : set.add(h);
      setHours(set);
    }
    refresh();
  });

  // The hour bars: click one to add or remove it, or drag across several to paint a range. Only the bars
  // update while dragging; the map catches up when the pointer is let go.
  const strip = $("track-bars");
  let painting = null, paintSet = null;   // while dragging: whether hours are being added or removed, and the working set
  const paintHour = (h) => {
    if (paintSet.has(h) === painting) return;
    painting ? paintSet.add(h) : paintSet.delete(h);
    strip.querySelector(`[data-hour="${h}"]`).setAttribute("aria-pressed", String(painting));
  };
  strip.addEventListener("pointerdown", (e) => {
    const bar = e.target.closest("[data-hour]");
    if (!bar) return;
    e.preventDefault();
    paintSet = state.hours ? new Set(state.hours) : new Set();   // from any time, start from no hours
    painting = !paintSet.has(Number(bar.dataset.hour));
    paintHour(Number(bar.dataset.hour));
  });
  strip.addEventListener("pointermove", (e) => {
    if (painting === null) return;
    const bar = document.elementFromPoint(e.clientX, e.clientY)?.closest("#track-bars [data-hour]");
    if (bar) paintHour(Number(bar.dataset.hour));
  });
  window.addEventListener("pointerup", () => {
    if (painting === null) return;
    painting = null;
    setHours(paintSet);
    refresh();
  });
  strip.addEventListener("keydown", (e) => {
    const bars = [...strip.children], i = bars.indexOf(document.activeElement);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: bars.length - 1 }[e.key];
    if (i < 0 || to === undefined) return;
    e.preventDefault();
    const next = bars[(to + bars.length) % bars.length];
    for (const b of bars) b.tabIndex = b === next ? 0 : -1;
    next.focus();
  });
  // Keyboard (Enter or Space on a bar) arrives as a click with no pointer
  strip.addEventListener("click", (e) => {
    const bar = e.target.closest("[data-hour]");
    if (!bar || e.detail !== 0) return;
    const set = state.hours ? new Set(state.hours) : new Set(), h = Number(bar.dataset.hour);
    set.has(h) ? set.delete(h) : set.add(h);
    setHours(set);
    refresh();
  });
}

// ---------------------------------------------------------------------
// The heat map
// ---------------------------------------------------------------------
// Incidents per year at each location: [lat, lng, count]. heatSpots is what you selected; refSpots is
// the average year across all the data (every crime type, all times of day), which sets one fixed colour
// scale, so a year with fewer incidents really does look fainter, and so does a rarer crime type: with its
// own scale, an evenly spread type like home break-ins turned the whole city red. A part of the day is drawn
// per hour on that same scale (see updateHeat), so it compares fairly with "Any time" too.

// A part year (2026 so far) counts as a full year's rate, so it compares fairly with whole years
function yearWeight(y) {
  if (!isPartial(y)) return 1;
  const md = latestMd(), day = (Date.UTC(y, Math.floor(md / 100) - 1, md % 100) - Date.UTC(y, 0, 0)) / 864e5;
  return 365 / day;
}

// Many incidents share the same hundred-block location, so count repeats as one spot.
// This looks the same and keeps the map fast with ten years of data.
function spotsPerYear(points, years, scale = 1) {
  const spots = new Map(), weight = {};
  for (const p of points) {
    const key = Math.round(p[LAT] * 1e4) * 1e7 + Math.round((p[LNG] + 180) * 1e4);
    const w = (weight[p[YEAR]] ??= (yearWeight(p[YEAR]) / years) * scale);
    const spot = spots.get(key);
    if (spot) spot[2] += w; else spots.set(key, [p[LAT], p[LNG], w]);
  }
  return [...spots.values()];
}

function updateHeat() {
  const n = state.shown.years.size;
  // One pass over every incident: per clock hour ignoring the time of day (for the track's chart), and the ones
  // the filters show, used for both the city-wide totals and the heat
  const shown = [], byHour = new Array(24).fill(0);
  if (n) for (const p of state.data.points) {
    if (!matches(p, state.shown, true)) continue;
    if (p[HOUR] >= 0) byHour[p[HOUR]]++;
    if (passesFilters(p)) shown.push(p);
  }
  const count = shown.length, cityTypes = new Map();
  for (const p of shown) bump(cityTypes, p[TYPE]);
  state.city = { count, types: cityTypes };   // overall and per crime type, for the area card's comparisons
  // A part of the day is drawn per hour (scaled up by 24 / its hours) against the all-day reference, so a part
  // exactly as busy per hour as the whole day looks like "Any time"; busier parts glow more, quieter ones less.
  const hrs = state.hours ? state.hours.size : 0;   // 0 for "Any time"
  heatSpots = n ? spotsPerYear(shown, n, hrs ? 24 / hrs : 1) : [];
  heatCellCache.clear();
  // refSpots only changes when a time of day is turned on or off, so it isn't rebuilt on every filter change
  if (refHours !== !!hrs) {
    refHours = !!hrs;
    refSpots = spotsPerYear(hrs ? state.data.points.filter((p) => p[HOUR] >= 0) : state.data.points, state.data.years.length);
    refScales.clear();
    heatCellCache.clear();   // its cells carry the old scale
  }
  fadeHeat();
  drawHeat();
  // With a time of day picked, say how its share of reports compares with its share of the clock
  let share = "";
  drawTrackBars(byHour);
  if (n && hrs && count) {
    const known = sum(byHour);   // reports with a known time, at any hour
    const rate = count / known / (hrs / 24);
    share = `<span class="share">${cap(timeLabel())}: ${Math.round((count / known) * 100)}% of reports in ${hrs} of 24 hours, ` +
      `${Math.abs(rate - 1) < 0.1 ? "about the same as the average hour" : `about ${rate.toFixed(1)}× the average hour`}.</span>`;
  }
  $("citywide").innerHTML = n
    ? `<strong data-count="${count}" data-key="city">${fmt(count)}</strong> reported city-wide ${periodLabel()}${share}`
    : `Pick a year to see reported incidents.`;
  countUp($("citywide"));
}

// Smaller blobs when zoomed out, so heat stays on land
// Not rounded, so blobs grow smoothly as the map zooms
const heatRadius = (z) => 8 + (z - CONFIG.minZoom) * 3;
const heatBlur = (radius) => radius * 1.25;
// Scale the heat so only real hotspots of the average year reach the top colour and quiet areas fade out
// (instead of the whole city turning orange). Add up the average year's incidents in the same cells the heat
// is drawn in, then find how busy a "hotspot" cell is. That only depends on the zoom and refSpots, so it's
// worked out once for each zoom
function heatScale(z) {
  if (refScales.has(z)) return refScales.get(z);
  const counts = binSpots(refSpots, z).map((c) => c[2]).sort((a, b) => a - b);
  const busy = counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * CONFIG.hotspotLevel))] : 1;
  const scale = CONFIG.heatStrength / Math.max(busy, 1);   // a cell as busy as `busy` shows at full strength
  refScales.set(z, scale);
  return scale;
}
// The heat layer draws cellsAt(zoom) itself (see _redraw); this sets the blob size and asks for a redraw
function drawHeat() {
  const radius = heatRadius(map.getZoom());
  heat.setOptions({ radius, blur: heatBlur(radius) });
  warmCells();
}
map.on("zoomend", () => { if (heatSpots.length) drawHeat(); });

// ---------------------------------------------------------------------
// Keeping the city in view around the floating panels
// ---------------------------------------------------------------------
// How much of the map each visible panel covers, as Leaflet padding, for showing `bounds` as large as possible
function panelPadding(bounds) {
  const mr = $("map").getBoundingClientRect(), W = mr.width, H = mr.height;
  const pad = { l: 0, r: 0, t: 0, b: 0 }, corners = [];
  for (const el of document.querySelectorAll(".panel, .site-head")) {   // on wider screens the header floats over the map too
    const rr = el.getBoundingClientRect();
    if (!rr.width || !rr.height || getComputedStyle(el).display === "none") continue;
    // The views bar along the bottom is narrow but sits in the middle, not a corner: as a corner card it could be
    // taken for a block over the whole left half, which pushed the city off to the right
    if (el.id === "rail" && !document.body.classList.contains("rail-on")) { pad.b = Math.max(pad.b, mr.bottom - rr.top); continue; }
    if (rr.width < W * 0.6) {
      const left = rr.left - mr.left < W / 2;
      const side = left ? "l" : "r", across = left ? rr.right - mr.left : mr.right - rr.left;
      // A tall panel blocks its whole side. A short card in a corner (like "Pick a spot") can be
      // kept clear from below instead, which matters on tablets where both sides together leave a sliver.
      if (rr.height > H * 0.5) pad[side] = Math.max(pad[side], across);
      else corners.push({ side, across, below: rr.top - mr.top < H / 2 ? ["t", rr.bottom - mr.top] : ["b", mr.bottom - rr.top] });
    } else if (rr.top - mr.top < H / 2) pad.t = Math.max(pad.t, rr.bottom - mr.top);
    else pad.b = Math.max(pad.b, mr.bottom - rr.top);
  }
  const gap = 16;
  const asPadding = (p) => ({ paddingTopLeft: [p.l + gap, p.t + gap], paddingBottomRight: [p.r + gap, p.b + gap] });
  // Try each corner card as a side block or as a top/bottom block, and keep whichever shows `bounds` largest
  let options = [pad];
  for (const c of corners) {
    options = options.flatMap((p) => [
      { ...p, [c.side]: Math.max(p[c.side], c.across) },
      { ...p, [c.below[0]]: Math.max(p[c.below[0]], c.below[1]) },
    ]);
  }
  const zoomFor = (p) => {
    const o = asPadding(p);
    return map.getBoundsZoom(bounds, false, L.point(o.paddingTopLeft).add(o.paddingBottomRight));
  };
  return asPadding(options.reduce((best, p) => (zoomFor(p) > zoomFor(best) ? p : best)));
}
function fitTo(bounds, maxZoom = 14) {
  // A normal zoom, not flyTo: the heat layer can follow a normal zoom, but drifts during a flyTo
  map.fitBounds(bounds, { ...panelPadding(L.latLngBounds(bounds)), maxZoom, animate: !reduceMotion });
}
const areaBounds = (ll) => ll.toBounds(CONFIG.radiusMeters * 3.2);
// Move the map only if part of `bounds` is hidden behind a panel or off screen, and never zoom in to do it
function keepInView(bounds) {
  const o = panelPadding(bounds), size = map.getSize();
  const seen = L.latLngBounds(map.containerPointToLatLng(o.paddingTopLeft), map.containerPointToLatLng(size.subtract(o.paddingBottomRight)));
  if (!seen.contains(bounds)) fitTo(bounds, map.getZoom());
}
// The max bounds leave room around the city for the panels, so a fling could stop with the city all but off screen.
// Then bring the middle of the city back to the middle of the uncovered map, at the same zoom.
map.on("moveend", () => {
  if (L.Draggable._dragging) return;   // a press stops a glide (ending a move); wait for that drag to end instead
  // Two pans started on one moveend cancel each other, so let Leaflet bring the map inside its max bounds first
  // (_limitCenter is the check Leaflet 1.9 makes for that; the version is pinned in index.html)
  const c = map.getCenter();
  if (!c.equals(map._limitCenter(c, map.getZoom(), map.options.maxBounds))) return;
  const o = panelPadding(L.latLngBounds(CITY_BOUNDS)), [[s, w], [n, e]] = CITY_BOUNDS;
  const tl = L.point(o.paddingTopLeft), br = map.getSize().subtract(o.paddingBottomRight), mid = tl.add(br).divideBy(2);
  // Panels covering the whole map (a hidden or very narrow window) leave nowhere to centre the city in
  if (br.x <= tl.x || br.y <= tl.y) return;
  const a = map.latLngToContainerPoint([n, w]), b = map.latLngToContainerPoint([s, e]);   // the city's box on screen
  const near = L.point(Math.min(b.x, Math.max(a.x, mid.x)), Math.min(b.y, Math.max(a.y, mid.y)));
  // Within a quarter of the uncovered map from its middle is close enough, so the city's edges can still be looked at
  if (Math.abs(near.x - mid.x) <= (br.x - tl.x) / 4 && Math.abs(near.y - mid.y) <= (br.y - tl.y) / 4) return;
  // A pan that rounds to nothing makes Leaflet fire moveend at once, which would run this again in a loop
  const shift = a.add(b).divideBy(2).subtract(mid).round();
  if (shift.x || shift.y) map.panBy(shift, { animate: !reduceMotion });
});
function fitForView() {
  if (state.view === "map" && state.selected) return fitTo(areaBounds(state.selected));
  if (state.view === "compare" && state.a && state.b) return fitTo(areaBounds(state.a).extend(areaBounds(state.b)), 15);
  if (state.view === "compare" && state.a) return fitTo(areaBounds(state.a));
  fitTo(L.latLngBounds(CITY_BOUNDS), 13);
}

// ---------------------------------------------------------------------
// Area numbers (used by Map and Compare)
// ---------------------------------------------------------------------
function nearFn(center) {
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  const r2 = CONFIG.radiusMeters ** 2;
  return (p) => {
    const dy = (p[LAT] - center.lat) * 111320;
    const dx = (p[LNG] - center.lng) * 111320 * cosLat;
    return dx * dx + dy * dy <= r2;
  };
}

// Distance in km from a spot to a neighbourhood's centre (flat-earth, fine across one city)
const kmTo = (ll, h) => Math.hypot(h.lat - ll.lat, (h.lng - ll.lng) * Math.cos((ll.lat * Math.PI) / 180)) * 111.32;
// The neighbourhood whose centre is closest: the fallback name for a clicked spot when the boundaries didn't load
function nearestHood(ll) {
  let best = null;
  for (const h of state.data.neighbourhoods) if (!best || kmTo(ll, h) < kmTo(ll, best)) best = h;
  return best && kmTo(ll, best) < 2.5 ? best.name : "this spot";
}
// Ray casting: is the spot inside this ring of [lng, lat] corners?
function inRing(ll, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    if ((y1 > ll.lat) !== (y2 > ll.lat) && ll.lng < x1 + ((ll.lat - y1) * (x2 - x1)) / (y2 - y1)) inside = !inside;
  }
  return inside;
}
// The VPD neighbourhood a spot is in, from the City's local-area boundaries (null outside the city or without them).
// VPD has two neighbourhoods the City doesn't: Stanley Park lies outside every City area, and Musqueam sits inside
// Dunbar-Southlands, so the spot goes to whichever of the two centres is nearer.
// shortcut: Musqueam by nearest centre also takes in the rest of Southlands; use a reserve outline if that matters
function hoodAt(ll) {
  if (!boundaries) return null;
  const area = boundaries.features.find((f) => f.geometry.coordinates.some(([outer, ...holes]) => inRing(ll, outer) && !holes.some((h) => inRing(ll, h))));
  const centre = (name) => state.data.neighbourhoods.find((h) => h.name === name);
  if (!area) return nearestHood(ll) === "Stanley Park" ? "Stanley Park" : null;
  const name = area.properties.name, musqueam = centre("Musqueam"), own = centre(name);
  return name === "Dunbar-Southlands" && musqueam && own && kmTo(ll, musqueam) < kmTo(ll, own) ? "Musqueam" : name;
}
// Offences against a person in a whole neighbourhood over the picked years: VPD gives them no map location, only a
// neighbourhood, so they can't be counted in a 500 m circle (null when there's no neighbourhood or no counts)
function violentIn(hood) {
  const counts = hood && state.data.violentByHood?.[hood];
  if (!counts) return null;
  let n = 0;
  for (const y of state.shown.years) n += counts[y] || 0;
  return n;
}

function areaStats(ll) {
  const local = state.data.points.filter(nearFn(ll));
  let now = 0, before = 0, unknownHour = 0;
  const types = new Map(), hours = new Array(24).fill(0), perYear = new Map();
  for (const p of local) {
    if (matches(p, state.compare)) before++;
    if (passesFilters(p)) bump(perYear, p[YEAR]);   // every year, for the trend
    if (matches(p, state.shown, true)) {                            // time of day uses all times
      if (p[HOUR] < 0) unknownHour++; else hours[p[HOUR]]++;
    }
    if (!matches(p, state.shown)) continue;
    now++;
    bump(types, p[TYPE]);
  }
  const sorted = ranked(types);
  const top = sorted.map(([t, n]) => [state.data.types[t].label, n]);
  const hood = hoodAt(ll);
  return { name: hood || nearestHood(ll), hood, violent: violentIn(hood), now, before, change: changeInfo(now, before), top, typeIds: sorted.map(([t]) => t),
    buckets: partCounts(hours), hours, unknownHour, perYear, vsCity: vsCity(now) };
}

// Small HTML pieces
function typeBars(top, count = 4) {
  if (!top.length) return `<p class="hint">Nothing reported for these filters.</p>`;
  const max = top[0][1];
  return `<div class="bars">${top.slice(0, count).map(([t, n], i) =>
    `<span>${t}</span><div class="bar"><span style="width:${(n / max) * 100}%;--i:${i}"></span></div><span class="n">${fmt(n)}</span>`).join("")}</div>`;
}
// One year's bar. The year in progress is drawn as a dashed outline at its full-year pace (the rate so far, over
// 365 days) with the count so far filled in at the bottom, so it doesn't read as a drop against whole years.
const fullYearPace = (y, n) => (isPartial(y) ? n * yearWeight(y) : n);
const paceMax = (span, perYear) => Math.max(1, ...span.map((y) => fullYearPace(y, perYear.get(y) || 0)));   // a year chart's top
function yearBar(y, n, max, i) {
  const on = state.years.has(y) ? "on" : "";
  if (!isPartial(y)) return `<i class="${on}" style="height:${(n / max) * 100}%;--i:${i}" title="${y}: ${fmt(n)}"></i>`;
  const pace = fullYearPace(y, n);
  return `<i class="part ${on}" style="height:${(pace / max) * 100}%;--i:${i}" title="${y}: ${fmt(n)} to ${throughLabel()}, about ${fmt(Math.round(pace))} at this pace for the whole year"><b style="height:${pace ? (n / pace) * 100 : 0}%"></b></i>`;
}
// One sentence a screen reader reads in place of a year chart
function yearSummary(span, perYear, what) {
  const whole = span.filter((y) => !isPartial(y) && !missingYears().includes(y));
  const n = (y) => perYear.get(y) || 0;
  const hi = whole.reduce((a, y) => (n(y) > n(a) ? y : a), whole[0]), lo = whole.reduce((a, y) => (n(y) < n(a) ? y : a), whole[0]);
  const p = state.data.partialYear;
  return `${what} per year, ${span[0]} to ${span[span.length - 1]}: highest in ${hi} with ${fmt(n(hi))}, lowest in ${lo} with ${fmt(n(lo))}.` +
    (span.includes(p) ? ` ${p} so far: ${fmt(n(p))} to ${throughLabel()}, about ${fmt(Math.round(fullYearPace(p, n(p))))} at that pace for the year.` : "");
}
const paceNote = () => `${state.data.partialYear} is Jan 1 to ${throughLabel()}; the dashed outline is its pace for a full year.`;
function yearSpark(perYear) {
  const span = yearSpan(), first = span[0], last = span[span.length - 1], missing = missingYears();
  const max = paceMax(span, perYear);
  return `<div class="spark" role="img" aria-label="${attr(yearSummary(span, perYear, "Reports near here"))}">${span.map((y, i) => missing.includes(y)
    ? `<i class="gap" title="No ${y} data"></i>`
    : yearBar(y, perYear.get(y) || 0, max, i)).join("")}</div>
    <div class="spark-x"><span>${first}</span>${missing.length ? `<span>${missing.join(", ")} no data</span>` : ""}<span>${last}</span></div>
    ${state.data.partialYear ? `<p class="hint">${paceNote()}</p>` : ""}`;
}
// A tip says a crime "is common here", so only give one where that's true compared with the city: a bigger share
// of this area's reports than of the city's, or, with one type picked, clearly more of it than an average area
function tipFor(s) {
  if (state.type !== "all") return s.vsCity > 1.5 ? TIPS[typeLabel()] || "" : "";
  const city = state.city?.count;
  const over = (i) => !!city && s.top[i][1] / s.now > (state.city.types.get(s.typeIds[i]) || 0) / city;
  for (const t of ["Bike theft", "Theft from cars", "Home break-ins", "Car theft"]) {
    const i = s.top.slice(0, 3).findIndex(([name]) => name === t);
    if (i >= 0 && over(i)) return TIPS[t];
  }
  return s.top.length && over(0) ? TIPS[s.top[0][0]] || "" : "";
}
// This area against the city average for a circle of the same size (null when that can't be worked out)
function vsCity(now) {
  if (!coverage?.km2 || !state.city?.count) return null;
  return now / ((state.city.count * Math.PI * (CONFIG.radiusMeters / 1000) ** 2) / coverage.km2);
}
function cityLine(r) {
  if (r == null) return "";
  const size = `for a ${CONFIG.radiusMeters} m circle`;
  if (r > 1.5) return `<p class="context"><b>About ${r < 10 ? r.toFixed(1) : Math.round(r)}× the city average</b> ${size}. Busy areas show more because more people are there.</p>`;
  if (r < 0.67) return `<p class="context"><b>Below the city average</b> ${size} (about ${r < 0.1 ? "a tenth" : `${r.toFixed(1)}×`}).</p>`;
  return `<p class="context"><b>About the city average</b> ${size}.</p>`;
}
const blurredNote = () => {
  const blurred = state.type === "all" ? state.data.types.some((t) => t.blurred) : state.data.types[state.type].blurred;
  return blurred ? `<p class="foot">VPD spreads the locations of offences against a person across several blocks, so read those as area-level only.</p>` : "";
};
// Offences against a person for the whole neighbourhood, kept apart from the circle's count since it covers a different
// area and ignores the picked hours (VPD gives these no time). Only with all crime types: a picked type is a map type
const violentSection = (s) => (state.type !== "all" || s.violent == null ? "" : `<h3 class="sec">Offences against a person</h3>
  <p class="context"><b>${fmt(s.violent)}</b> in ${s.hood} as a whole ${periodLabel()}, at any time of day.</p>
  <p class="hint">VPD gives these no map location, only a neighbourhood, so they aren't in the count above or on the map.</p>`);
// The grip at the top of a bottom sheet on phones (hidden on wider screens)
const sheetHandle = `<button type="button" class="sheet-handle" aria-label="Show or hide details" aria-expanded="true"></button>`;
// With every year unticked there's nothing to count, so panels say so instead of showing zeros
const noYears = () => !state.shown.years.size;
const pickYear = `<div class="tip">${ICON_INFO}<span>Pick a year in the filters to see what's been reported.</span></div>`;

// ---------------------------------------------------------------------
// Feedback: numbers that roll, panels that arrive, notes over the map
// ---------------------------------------------------------------------
// Numbers roll from their last value to the new one, so a change in the filters reads as a change
const lastCount = {};
function countUp(root) {
  for (const el of root.querySelectorAll("[data-count]")) {
    const to = Number(el.dataset.count), key = el.dataset.key, from = lastCount[key] ?? 0;
    lastCount[key] = to;
    if (reduceMotion || from === to) continue;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 650);
      el.textContent = fmt(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(step);
  }
}
// Replay the panel's arrival when it shows a new spot or view (not on every filter change)
function enter(el) {
  el.classList.remove("enter");
  void el.offsetWidth;   // restart the CSS animation
  el.classList.add("enter");
  clearTimeout(el.enterTimer);
  el.enterTimer = setTimeout(() => el.classList.remove("enter"), 900);   // after the longest bar has grown
}

// A short note over the map that goes away by itself
function showToast(message, ms = 4000) {
  const t = $("toast");
  t.innerHTML = ICON_INFO;
  t.append(Object.assign(document.createElement("span"), { textContent: message }));
  t.classList.add("show");
  clearTimeout(t.hideTimer);
  t.hideTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// ---------------------------------------------------------------------
// Map view: the area card
// ---------------------------------------------------------------------
function renderArea() {
  // No card until a spot is picked, so it doesn't sit over the map; the hint shows once as a note on open
  if (!state.selected) { $("area").innerHTML = ""; return; }
  const head = (name, when) => `${sheetHandle}
    <div class="card-head"><div><h2 class="place" tabindex="-1">Near ${name}</h2>
      <p class="when">Within ${CONFIG.radiusMeters} m${when}</p></div>
      <button type="button" class="x" data-action="clear" aria-label="Close area summary">${ICON_X}</button></div>`;
  if (noYears()) { $("area").innerHTML = head(nearestHood(state.selected), "") + pickYear; return; }
  const s = areaStats(state.selected);
  const tip = s.now ? tipFor(s) : "";
  $("area").innerHTML = `${head(s.name, ` · ${periodLabel()}`)}
    <p class="big" data-count="${s.now}" data-key="area">${fmt(s.now)}</p>
    <p class="big-label">reported incidents · ${filterLine()}</p>
    ${s.now ? cityLine(s.vsCity) : ""}
    ${s.change ? `<span class="pill ${s.change.cls}">${s.change.text}</span>` : ""}
    ${state.type === "all" ? `<h3 class="sec">Most common here</h3>${typeBars(s.top)}` : ""}
    <h3 class="sec">When they happen</h3>${timeTiles(s.buckets)}${busiestLine(s.buckets)}${periodTotal(s.buckets) ? hourStrip(s.hours) : ""}
    ${s.unknownHour ? `<p class="hint">${fmt(s.unknownHour)} with no time recorded</p>` : ""}
    <h3 class="sec">Year by year</h3>${yearSpark(s.perYear)}
    ${violentSection(s)}
    ${tip ? `<div class="tip">${ICON_BULB}<span>${tip}</span></div>` : ""}
    ${blurredNote()}
    <p class="foot">Awareness, not a safety score for any address.</p>`;
}

function selectPoint(ll) {
  state.selected = ll;
  areaCircle.setLatLng(ll);
  syncCircles();
  growCircle(areaCircle);
  enter($("area"));
  renderPanels();
  $("area").querySelector(".place")?.focus({ preventScroll: true });
  announce($("area").querySelector(".place")?.textContent, $("area").querySelector(".big")?.dataset.count, $("area").querySelector(".context")?.textContent);
}
// One short sentence for screen readers when something is placed; the panels themselves aren't live regions,
// so a filter change doesn't re-read a whole card
function announce(place, count, extra = "") {
  if (!place) return;
  $("announce").textContent = `${place}: ${count != null ? `${fmt(Number(count))} reported incidents. ` : ""}${extra}`;
}

// ---------------------------------------------------------------------
// Compare view: two areas side by side
// ---------------------------------------------------------------------
// A click places whichever area is picked in the A | B toggle (state.nextSlot). After placing one while the
// other is still empty, the toggle moves on to the empty one, so setting up both is still just two clicks.
function setCompareSpot(ll) {
  const slot = state.nextSlot, other = slot === "a" ? "b" : "a";
  state[slot] = ll;
  if (!state[other]) state.nextSlot = other;
  syncCircles();
  growCircle(slot === "a" ? circleA : circleB);
  if (isPhone() && cardHeight($("compare")) === "tall") setCard($("compare"), "open");   // a tap on the map wants the map in view
  renderPanels();
  // With both placed, show both: area B could land behind the bottom sheet on a phone once its card filled in
  if (state.a && state.b) keepInView(areaBounds(state.a).extend(areaBounds(state.b)));
  const card = $("compare").querySelector(`[data-key="${slot.toUpperCase()}"]`);
  announce(`Area ${slot.toUpperCase()} placed near ${nearestHood(ll)}`, card?.dataset.count);
}
function pickSlot(slot) {
  state.nextSlot = slot;
  syncCircles();
  // Only the highlight moves, so it can glide across; rebuilding the cards would make it jump
  for (const c of $("compare").querySelectorAll(".cmp[data-slot]")) c.classList.toggle("placing", c.dataset.slot === slot);
  for (const b of $("compare").querySelectorAll(".slot-pick .ab")) b.setAttribute("aria-pressed", String(b.dataset.action === `slot-${slot}`));
}
// Dragging a handle moves its circle live and updates the card when it's let go
for (const [slot, handle, circle] of [["a", handleA, circleA], ["b", handleB, circleB]]) {
  handle.on("dragstart", () => ghost.remove());
  handle.on("drag", () => circle.setLatLng(handle.getLatLng()));
  handle.on("dragend", () => {
    const ll = handle.getLatLng();
    if (isOutside(ll)) { showToast(OUTSIDE_NOTE); syncCircles(); return; }   // back to where it was
    state[slot] = ll;
    state.nextSlot = slot;
    syncCircles();
    renderPanels();
  });
  handle.on("click", () => pickSlot(slot));
}

// One area's card, or an empty card for an area not placed yet (slot is "A" or "B"). On phones, tapping either card
// picks which area the next map tap places, and "fresh" marks a card whose area just changed so it fades in
let lastCompare = {};
function compareCard(s, slot, fresh) {
  const phone = isPhone(), key = slot.toLowerCase(), act = phone ? "Tap" : "Click";
  const cls = `cmp${state.nextSlot === key ? " placing" : ""}${fresh && phone ? " fresh" : ""}`;
  // An empty card is a button; it says what to do whether or not it's the picked one, and CSS shows the right line
  if (!s) return `<button type="button" class="${cls} empty" data-slot="${key}" data-action="slot-${key}">
    <span class="if-placing"><b>${slot}</b> · ${phone ? `Tap the map to place ${slot}` : `Click the map to place area ${slot}, then drag its label to move it`}</span>
    <span class="if-waiting"><b>${slot}</b> · ${phone ? `Tap here, then the map` : `Pick ${slot}, then click the map`}</span></button>`;
  return `<div class="${cls}" data-slot="${key}"${phone ? ` data-action="slot-${key}"` : ""}><h3 class="who"><b>${slot}</b>Near ${s.name}</h3>
    <p class="big" data-count="${s.now}" data-key="${slot}">${fmt(s.now)}</p>${s.change ? `<span class="pill ${s.change.cls}" title="${s.change.text}">${s.change.text.replace("same dates ", "")}</span>` : ""}
    <p class="hint">Busiest per hour: ${busiestShort(s.buckets)}</p>
    ${state.type === "all" && s.violent != null ? `<p class="hint">Offences against a person in all of ${s.hood}: ${fmt(s.violent)}</p>` : ""}</div>`;
}
// Head to head: one row per crime type (the top three of each area) or per part of the day, as [name, A's count, B's count]
function compareRows(A, B) {
  const countOf = (s, t) => s?.top.find(([x]) => x === t)?.[1] || 0;
  return state.type === "all"
    ? [...new Set([...(A?.top || []).slice(0, 3), ...(B?.top || []).slice(0, 3)].map(([t]) => t))].map((t) => [t, countOf(A, t), countOf(B, t)])
    : Object.keys(IN_BUCKET).map((k) => [cap(k), A?.buckets[k] || 0, B?.buckets[k] || 0]);
}
// The rows with A and B side by side, each with its share of that area's reports so a quiet and a busy area can still be compared
function compareTable(A, B, rows) {
  if (!A && !B) return "";
  // Each share is out of what its rows add up to: the area's count for crime types, but for parts of the day every
  // hour (the rows ignore the picked hours), or a picked evening would make morning's share over 100% or 0%
  const total = (s) => (state.type === "all" ? s.now : periodTotal(s.buckets));
  const cell = (s, n) => (s ? `<span class="n">${fmt(n)} <small>${total(s) ? Math.round((n / total(s)) * 100) : 0}%</small></span>` : `<span class="n">–</span>`);
  return `<div class="h2h"><h3 class="sec">${state.type === "all" ? "Most common" : "By time of day"}</h3><b>A</b><b>B</b>
    ${rows.map(([t, a, b]) => `<span>${t}</span>${cell(A, a)}${cell(B, b)}`).join("")}</div>`;
}
// A line or two on how the two areas differ, once both are placed
function compareInsight(A, B, rows) {
  if (!A || !B || (!A.now && !B.now)) return "";
  const [hi, lo, hiN, loN] = A.now >= B.now ? [A, B, "A", "B"] : [B, A, "B", "A"];
  const ratio = hi.now / Math.max(lo.now, 1);
  // A ratio against a handful of reports ("524.0×") says less than the two counts do
  const parts = [ratio < 1.15 ? "A and B have a similar number of reports."
    : lo.now < CONFIG.minForChange ? `Area ${hiN} has ${fmt(hi.now)} reports against ${fmt(lo.now)} at area ${loN}.`
    : `Area ${hiN} has about ${ratio.toFixed(1)}× the reports of area ${loN}.`];
  // The crime type whose share differs most between the two areas
  if (state.type === "all" && A.now >= 20 && B.now >= 20) {
    const share = (s) => new Map(s.top.map(([t, n]) => [t, n / s.now]));
    const sa = share(A), sb = share(B);
    let best = null;
    for (const [t] of rows) {   // only types in the table, so the insight never names one it doesn't show
      const pa = sa.get(t) || 0, pb = sb.get(t) || 0, hiShare = Math.max(pa, pb), loShare = Math.min(pa, pb);
      if (hiShare < 0.06) continue;
      const r = hiShare / Math.max(loShare, 0.01);
      if (r >= 1.6 && (!best || r > best.r)) best = { t, r, where: pa > pb ? "A" : "B", hiShare, loShare };
    }
    if (best) parts.unshift(`${best.t} is a bigger share at ${best.where} (${Math.round(best.hiShare * 100)}% vs ${Math.round(best.loShare * 100)}%).`);
  }
  parts.push("Busier spots usually have more people, shops and transit, so they get more reports.");
  return `<div class="tip">${ICON_INFO}<span>${parts.join(" ")}</span></div>`;
}

// Compare and Trends close back to the map view with their own close button
const closeView = (what) => `<button type="button" class="x" data-action="open-map" aria-label="Close ${what}">${ICON_X}</button>`;
function renderCompare() {
  const A = state.a && areaStats(state.a), B = state.b && areaStats(state.b), rows = compareRows(A, B);
  $("compare").innerHTML = `${sheetHandle}
    <div class="cmp-head"><div class="card-head"><div><h2>Compare two areas</h2>
      <p>Within ${CONFIG.radiusMeters} m of each spot, ${periodLabel()} · ${filterLine()}.</p></div>${closeView("Compare")}</div>
      <div class="cmp-actions">
        <div class="slot-pick" role="group" aria-label="Which area a map click places"><span>Place</span>
          <button type="button" class="ab a" data-action="slot-a" aria-pressed="${state.nextSlot === "a"}">A</button><button type="button" class="ab b" data-action="slot-b" aria-pressed="${state.nextSlot === "b"}">B</button></div>
        <button type="button" class="btn" data-action="swap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg><span class="lbl">Swap</span></button><button type="button" class="btn" data-action="reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg><span class="lbl">Clear</span></button></div></div>
    ${noYears() ? pickYear : `<div class="cmp-grid">${compareCard(A, "A", changed("a"))}${compareCard(B, "B", changed("b"))}</div>${compareTable(A, B, rows)}${compareInsight(A, B, rows)}`}`;
  lastCompare = { a: state.a, b: state.b };
  $("compare").classList.toggle("incomplete", !(A && B));   // phones keep the card slim until both areas are down
}
// Whether an area was placed, moved or cleared since the cards were last drawn
const changed = (slot) => slot in lastCompare && lastCompare[slot] !== state[slot];

// ---------------------------------------------------------------------
// Trends view: the whole city for the current filters
// ---------------------------------------------------------------------
function weekday(y, m, d) {   // 0 = Sunday (Sakamoto's method)
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (m < 3) y -= 1;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[m - 1] + d) % 7;
}

function renderTrends() {
  if (noYears()) {
    $("trends").innerHTML = `${sheetHandle}<div class="card-head"><div><h2>Vancouver</h2><p class="sub">${filterLine()}.</p></div>${closeView("Trends")}</div>${pickYear}`;
    return;
  }
  const perYear = new Map(), types = new Map(), hours = new Array(24).fill(0), days = new Array(7).fill(0);
  let total = 0, before = 0;
  for (const p of state.data.points) {
    if (!passesFilters(p)) continue;
    bump(perYear, p[YEAR]);
    if (matches(p, state.compare)) before++;
    if (!state.shown.years.has(p[YEAR])) continue;
    total++;
    bump(types, p[TYPE]);
    if (p[HOUR] >= 0) hours[p[HOUR]]++;
    days[weekday(p[YEAR], Math.floor(p[MD] / 100), p[MD] % 100)]++;
  }
  const top = ranked(types).map(([t, n]) => [state.data.types[t].label, n]);
  const span = yearSpan(), missing = missingYears();
  const maxY = paceMax(span, perYear);
  const maxH = Math.max(1, ...hours);

  let areaHtml = "";
  if (state.selected) {
    const s = areaStats(state.selected);
    areaHtml = `<div class="tsec"><h3>Near ${s.name} (${CONFIG.radiusMeters} m)</h3>
      <p class="big" style="font-size:1.9rem" data-count="${s.now}" data-key="trend-area">${fmt(s.now)}</p>${s.change ? `<span class="pill ${s.change.cls}">${s.change.text}</span>` : ""}
      <p class="hint" style="margin-top:8px"><a href="#" data-action="open-map">See the full area summary</a></p></div>`;
  }

  $("trends").innerHTML = `${sheetHandle}
    <div class="card-head"><div><h2>Vancouver ${periodLabel()}</h2>
      <p class="sub">${filterLine()}. ${isPhone() ? "Tap" : "Click"} the map to add an area.</p></div>${closeView("Trends")}</div>
    ${trendMetrics({ total, before, perYear, top, hours, days })}
    <div class="tsec"><h3>Year by year</h3>
      <div class="ybars" role="img" aria-label="${attr(yearSummary(span, perYear, "Reports city-wide"))}">${span.map((y, i) => `<div>${missing.includes(y)
        ? `<i class="gap" style="height:30%" title="No ${y} data"></i>`
        : yearBar(y, perYear.get(y) || 0, maxY, i)}<span>${String(y).slice(2)}</span></div>`).join("")}</div>
      <p class="hint">Highlighted bars are the years you've selected.${missing.length ? ` No data for ${missing.join(", ")}.` : ""}${state.data.partialYear ? ` ${paceNote()}` : ""}</p></div>
    <div class="tsec"><h3>Hour of the day</h3>
      <div class="hbars" role="img" aria-label="${attr(hourSummary(hours, "Reports city-wide"))}">${TRACK_ORDER.map((h, i) => `<i style="height:${(hours[h] / maxH) * 100}%;--i:${i}" title="${fmtHour(h)}: ${fmt(hours[h])}"></i>`).join("")}</div>
      ${HOUR_AXIS}</div>
    ${state.type === "all" ? `<div class="tsec"><h3>Most common</h3>${typeBars(top, 6)}</div>` : ""}
    ${areaHtml}`;
}

// The four tiles at the top of Trends: per day, change (or busiest year), busiest hour, and most common type (or busiest day)
function trendMetrics({ total, before, perYear, top, hours, days }) {
  const ch = changeInfo(total, before);
  const peakHour = hours.indexOf(Math.max(...hours));
  const sel = selectedYears();
  let second;
  if (ch && ch.pct !== undefined) second = `<p>vs ${compareName()}</p><p class="${ch.cls}">${ch.pct > 0 ? "+" : ""}${ch.pct}%</p><p>${fmt(before)} then</p>`;
  else if (sel.length > 1) {
    const busiestYear = sel.reduce((a, y) => ((perYear.get(y) || 0) > (perYear.get(a) || 0) ? y : a), sel[0]);
    second = `<p>Busiest year</p><p>${busiestYear}</p><p>${fmt(perYear.get(busiestYear) || 0)} incidents</p>`;
  } else second = `<p>Change</p><p>–</p><p>${ch ? ch.text : "No earlier year"}</p>`;
  const fourth = state.type === "all" && top.length
    ? `<p>Most common</p><p>${Math.round((top[0][1] / Math.max(total, 1)) * 100)}%</p><p>${top[0][0]}</p>`
    : total
      ? `<p>Busiest day</p><p>${WEEKDAYS[days.indexOf(Math.max(...days))].slice(0, 3)}</p><p>${Math.round((Math.max(...days) / total) * 100)}% of reports</p>`
      : `<p>Busiest day</p><p>–</p><p>No reports</p>`;
  return `<div class="metrics">
      <div class="metric"><p>Per day</p><p>${fmt(Math.round(total / daysIn(sel)))}</p><p>${fmt(total)} ${sel.length === 1 && isPartial(sel[0]) ? `from Jan 1 to ${throughLabel()}` : `over ${sel.length} year${sel.length !== 1 ? "s" : ""}`}</p></div>
      <div class="metric">${second}</div>
      <div class="metric"><p>Busiest hour</p><p>${total ? fmtHour(peakHour) : "–"}</p><p>${total ? `${Math.round((hours[peakHour] / Math.max(1, sum(hours))) * 100)}% of reports` : "No times recorded"}</p></div>
      <div class="metric">${fourth}</div>
    </div>`;
}

// ---------------------------------------------------------------------
// Views, panels and circles
// ---------------------------------------------------------------------
function renderPanels() {
  if (state.view === "map") renderArea();
  else if (state.view === "compare") renderCompare();
  else renderTrends();
  const panel = $(PANEL_FOR[state.view]);
  panel.querySelector(".sheet-handle")?.setAttribute("aria-expanded", String(!panel.classList.contains("collapsed")));
  countUp(panel);
  writeUrl();
}

// ---------------------------------------------------------------------
// The link: view, filters and spots live in the address (after #), so a reload or a shared link opens the same thing
// ---------------------------------------------------------------------
const llText = (ll) => `${ll.lat.toFixed(4)},${ll.lng.toFixed(4)}`;
function writeUrl() {
  const q = new URLSearchParams({ view: state.view });
  q.set("years", allSelected() ? "all" : selectedYears().join(",") || "none");
  if (state.type !== "all") q.set("type", typeLabel());
  if (state.hours) q.set("hours", TRACK_ORDER.filter((h) => state.hours.has(h)).join(","));
  for (const k of ["selected", "a", "b"]) if (state[k]) q.set(k === "selected" ? "spot" : k, llText(state[k]));
  history.replaceState(null, "", `#${String(q).replaceAll("%2C", ",")}`);   // plain commas read better in a shared link
}
// Anything missing or not valid is skipped (and drops out of the address on the next write)
function readUrl() {
  const q = new URLSearchParams(location.hash.slice(1)), ys = state.data.years;
  const years = q.get("years");
  if (years === "all") state.years = new Set(ys);
  else if (years === "none") state.years = new Set();
  else if (years) {
    const picked = years.split(",").map(Number).filter((y) => ys.includes(y));
    if (picked.length) state.years = new Set(picked);
  }
  const type = state.data.types.findIndex((t) => t.label === q.get("type"));
  if (type >= 0) { state.type = type; showType(); }
  if (q.get("hours")) setHours(new Set(q.get("hours").split(",").map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h < 24)));
  const spot = (k) => {
    const [lat, lng] = (q.get(k) || "").split(",").map(Number), ll = Number.isFinite(lat) && Number.isFinite(lng) && L.latLng(lat, lng);
    return ll && !isOutside(ll) ? ll : null;
  };
  state.selected = spot("spot"); state.a = spot("a"); state.b = spot("b");
  state.nextSlot = state.a && !state.b ? "b" : "a";
  if (state.selected) areaCircle.setLatLng(state.selected);
  const view = q.get("view");
  return Object.hasOwn(PANEL_FOR, view) ? view : null;
}
function syncCircles() {
  const show = (layer, on) => { if (on && !map.hasLayer(layer)) layer.addTo(map); if (!on && map.hasLayer(layer)) map.removeLayer(layer); };
  show(areaCircle, state.view !== "compare" && !!state.selected);
  if (state.selected) areaPin.setLatLng(state.selected);
  show(areaPin, state.view !== "compare" && !!state.selected);
  if (state.a) { circleA.setLatLng(state.a); handleA.setLatLng(state.a); }
  if (state.b) { circleB.setLatLng(state.b); handleB.setLatLng(state.b); }
  show(circleA, state.view === "compare" && !!state.a);
  show(circleB, state.view === "compare" && !!state.b);
  show(handleA, state.view === "compare" && !!state.a);
  show(handleB, state.view === "compare" && !!state.b);
  // Ring the handle of the area a click will move
  for (const [slot, handle] of [["a", handleA], ["b", handleB]]) handle.getElement()?.classList.toggle("placing", state.nextSlot === slot);
}
// Each view's panel, and how far it was scrolled, so switching views puts you back where you were
const PANEL_FOR = { map: "area", compare: "compare", trends: "trends" };
const panelScroll = {};

function setView(view) {
  panelScroll[state.view] = $(PANEL_FOR[state.view]).scrollTop;   // remember the panel you're leaving
  state.view = view;
  $("app").dataset.view = view;
  for (const b of document.querySelectorAll(".rail button[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  if (view === "compare" && !state.a && state.selected) { state.a = state.selected; state.nextSlot = "b"; }
  syncCircles();
  enter($(PANEL_FOR[view]));
  renderPanels();
  $(PANEL_FOR[view]).scrollTop = panelScroll[view] || 0;          // and put this one back where it was
  // The map isn't moved or zoomed: it stays exactly where you left it.
}
// ---------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------
function buildControls() {
  buildYearPicker();
  buildTypePicker();
  bindTimeControls();
  bindSearch();
  bindMapClicks();
  bindPanelButtons();
}

// Years: an "All years" button, then one button per year, newest first
function buildYearPicker() {
  const ys = state.data.years;
  const missing = missingYears();
  const span = yearSpan().reverse();   // newest first, gaps included
  // "Clear" and "All years" sit on the heading's line; Clear only shows while something is selected
  $("years").innerHTML = `<span class="year-actions"><button type="button" class="clear" data-year="none">Clear</button>` +
    (ys.length > 1 ? `<button type="button" class="all" data-year="all">All years</button>` : "") + `</span>` +
    span.map((y) => missing.includes(y)
      ? `<button type="button" disabled title="No data for ${y}">${y}</button>`
      : `<button type="button" data-year="${y}">${y}</button>`).join("");
  // The part year's end date already shows with the count below, so only a gap in the data is worth a line here
  $("year-hint").textContent = missing.length ? `No data for ${missing.join(", ")}.` : "";

  const start = CONFIG.defaultYears === "all" ? ys : [].concat(CONFIG.defaultYears).map(Number).filter((y) => ys.includes(y));
  // Fall back to the latest year only when the settings named years that aren't in the data
  state.years = new Set(start.length || ![].concat(CONFIG.defaultYears).length ? start : [ys[ys.length - 1]]);

  $("years").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-year]");
    if (!btn || btn.disabled) return;
    if (btn.dataset.year === "all") {
      state.years = new Set(ys);
    } else if (btn.dataset.year === "none") {
      state.years = new Set();                                // untick everything in one go
    } else {
      const y = Number(btn.dataset.year);
      if (allSelected()) state.years = new Set([y]);          // from "All years", a tap picks just that year
      else if (!state.years.has(y)) state.years.add(y);       // add a year
      else state.years.delete(y);                             // remove it, even the last one (the map then clears)
    }
    refresh();
  });
}

// Crime types, most common first (across all years)
function buildTypePicker() {
  const { types, points } = state.data;
  const totals = new Array(types.length).fill(0);
  for (const p of points) totals[p[TYPE]]++;
  const order = types.map((_, i) => i).sort((a, b) => totals[b] - totals[a]);
  const values = ["all", ...order], btn = $("type"), list = $("type-list");
  list.replaceChildren(...values.map((v, i) => Object.assign(document.createElement("li"),
    { id: `type-${i}`, role: "option", textContent: v === "all" ? "All types" : types[v].label })));
  document.body.append(list);   // out of the panel, whose blur would clip it
  const preset = types.findIndex((t) => t.label === CONFIG.defaultType);
  if (preset >= 0) state.type = preset;
  showType();
  // Arrows move, Enter or Space picks, Escape closes, like the neighbourhood search
  let active = -1;
  const setActive = (i) => {
    list.children[active]?.classList.remove("active");
    active = i;
    const li = list.children[i];
    if (li) { li.classList.add("active"); li.scrollIntoView({ block: "nearest" }); btn.setAttribute("aria-activedescendant", li.id); }
    else btn.removeAttribute("aria-activedescendant");
  };
  const close = () => { if (list.hidden) return; list.hidden = true; btn.setAttribute("aria-expanded", "false"); setActive(-1); };
  const open = () => {
    const r = btn.getBoundingClientRect();
    Object.assign(list.style, { top: `${r.bottom + 6}px`, left: `${r.left}px`, width: `${r.width}px`,
      maxHeight: `${Math.max(160, Math.min(360, innerHeight - r.bottom - 16))}px` });
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    setActive(values.indexOf(state.type));
  };
  const pick = (i) => { close(); if (values[i] === state.type) return; state.type = values[i]; showType(); refresh(); };
  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  btn.addEventListener("blur", close);
  // A tap anywhere else closes it too: Safari doesn't focus a tapped button, so on phones the blur never comes
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#type, #type-list")) close(); });
  // mousedown, not click, so the button's blur doesn't close the list before the pick lands
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); pick([...list.children].indexOf(li)); } });
  list.addEventListener("mousemove", (e) => { const li = e.target.closest("li"); if (li && li !== list.children[active]) setActive([...list.children].indexOf(li)); });
  btn.addEventListener("keydown", (e) => {
    const n = values.length, keys = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: n - 1 };
    if (e.key in keys) {
      e.preventDefault();
      if (list.hidden) open(); else setActive((keys[e.key] + n) % n);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (list.hidden) open(); else pick(active);
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();
      close();
    }
  });
  // It's placed under the button when it opens, so anything that moves the button closes it
  $("filters").addEventListener("scroll", close);
  addEventListener("resize", close);
}
// The picker's label and tick follow state.type
function showType() {
  const i = state.type === "all" ? 0 : [...$("type-list").children].findIndex((li) => li.textContent === typeLabel());
  [...$("type-list").children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
  $("type-value").textContent = $("type-list").children[i]?.textContent ?? "All types";
}

// Neighbourhood search: pick from the list (or type part of a name and press Enter)
function bindSearch() {
  const { neighbourhoods } = state.data;
  const goToHood = () => {
    const q = $("search").value.trim().toLowerCase();
    if (!q) return;
    const h = neighbourhoods.find((n) => n.name.toLowerCase() === q) || neighbourhoods.find((n) => n.name.toLowerCase().includes(q));
    if (!h) return;
    $("search").value = h.name;
    const ll = L.latLng(h.lat, h.lng);
    if (state.view === "compare") setCompareSpot(ll); else selectPoint(ll);
    if (isPhone()) closeFilters();
    fitForView();
  };
  // The suggestion list: names containing what's typed, alphabetical; arrows move, Enter picks, Escape closes
  const input = $("search"), list = $("hood-list");
  const names = neighbourhoods.map((h) => h.name).sort((a, b) => a.localeCompare(b));
  let shownNames = [], active = -1;
  const option = (i) => list.children[i];
  const setActive = (i) => {
    if (option(active)) option(active).setAttribute("aria-selected", "false");
    active = i;
    if (option(i)) { option(i).setAttribute("aria-selected", "true"); option(i).scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", option(i).id); }
    else input.removeAttribute("aria-activedescendant");
  };
  const closeList = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); setActive(-1); };
  const openList = () => {
    const q = input.value.trim().toLowerCase();
    shownNames = names.filter((n) => n.toLowerCase().includes(q));
    list.replaceChildren(...shownNames.map((n, i) =>
      Object.assign(document.createElement("li"), { id: `hood-${i}`, role: "option", textContent: n })));
    list.hidden = !shownNames.length;
    input.setAttribute("aria-expanded", String(!list.hidden));
    setActive(-1);
  };
  const pick = (name) => { input.value = name; closeList(); goToHood(); };
  input.addEventListener("focus", openList);
  input.addEventListener("input", openList);
  input.addEventListener("blur", closeList);
  // mousedown, not click, so the input's blur doesn't close the list before the pick lands
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) { e.preventDefault(); pick(li.textContent); } });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.hidden) openList();
      const n = shownNames.length;
      if (n) setActive(e.key === "ArrowDown" ? (active + 1) % n : (active - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) pick(shownNames[active]); else { closeList(); goToHood(); }
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();   // a search box clears itself on Escape, which would reopen the list
      closeList();
    }
  });
  input.addEventListener("click", () => { if (list.hidden) openList(); });   // already focused, so no focus event
}

// A click on the map picks a spot; on screens with a cursor, a dashed circle previews it
function bindMapClicks() {
  map.on("click", (e) => {
    // Outside the data there's nothing to summarize, so say so and keep whatever was selected
    if (isOutside(e.latlng)) return showToast(OUTSIDE_NOTE);
    $("toast").classList.remove("show");   // the opening hint has done its job
    if (state.view === "compare") setCompareSpot(e.latlng); else selectPoint(e.latlng);
    if (isPhone()) closeFilters();   // lower the pulled-up sheet so the new card can be seen
  });
  if (window.matchMedia("(hover: hover)").matches) {   // no cursor to follow on touch screens
    map.on("mousemove", (e) => {
      const out = isOutside(e.latlng);
      ghost.setLatLng(e.latlng).setStyle({ opacity: out ? 0.25 : 1 });   // the preview fades where a click won't do anything
      $("map").style.cursor = out ? "default" : "";
      if (!map.hasLayer(ghost)) ghost.addTo(map);
    });
    map.on("mouseout", () => ghost.remove());
  }
}

// Buttons inside the panels (sheet handle, close, swap, clear, open map, place A or B)
function bindPanelButtons() {
  for (const id of ["area", "compare", "trends"]) {
    $(id).addEventListener("click", (e) => {
      if (e.target.closest(".sheet-handle")) {
        const collapsed = $(id).classList.toggle("collapsed");
        e.target.closest(".sheet-handle").setAttribute("aria-expanded", String(!collapsed));
        return;
      }
      const action = e.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      e.preventDefault();
      if (action === "clear") { state.selected = null; syncCircles(); renderPanels(); }
      if (action === "swap") { [state.a, state.b] = [state.b, state.a]; syncCircles(); renderPanels(); }
      if (action === "reset") { state.a = state.b = null; state.nextSlot = "a"; syncCircles(); renderPanels(); }
      if (action === "open-map") setView("map");
      if (action === "slot-a" || action === "slot-b") pickSlot(action.slice(-1));
    });
  }
}

function syncYearButtons() {
  const all = allSelected() && state.data.years.length > 1;
  for (const btn of document.querySelectorAll("#years button")) {
    if (btn.dataset.year === "none") { btn.hidden = !state.years.size; continue; }
    // Under "All years" each year is included but not picked: a tap picks just that year, so it isn't "pressed"
    const on = btn.dataset.year === "all" ? all : !all && state.years.has(Number(btn.dataset.year));
    btn.setAttribute("aria-pressed", String(on));
  }
  $("years").classList.toggle("all-in", all);
}

function refresh() {
  buildPeriods();
  syncYearButtons();
  syncTimeButtons();
  updateHeat();
  renderPanels();
  renderAbout();
}

function noLocationCount() {
  let n = 0;
  for (const [y, count] of Object.entries(state.data.noLocationByYear || {})) if (state.shown.years.has(Number(y))) n += count;
  return n;
}
// The legend is a picture of the heat colours, so it gets one sentence (redone when the theme or filters change)
function labelLegend() {
  $("legend").setAttribute("aria-label", `Map key, ${$("legend-title").textContent.toLowerCase()}: ` +
    "green where fewer are reported, through yellow and orange, to red where most are." +
    ($("legend-note").hidden ? "" : ` ${$("legend-note").textContent}`));
}
function renderAbout() {
  const d = state.data;
  const day = (iso) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const through = day(d.latestDate);
  // VPD asks sites using GeoDASH to show when their copy was last refreshed, in plain sight rather than inside About
  $("updated").innerHTML = `Updated ${day(d.generated)} from <a href="https://geodash.vpd.ca/opendata/">VPD GeoDASH</a>. Data through ${through}.`;
  $("about-body").innerHTML = `
    <p>Source: Vancouver Police Department, <a href="https://geodash.vpd.ca/opendata/">GeoDASH open data</a>, for free, non-commercial use only. Data through ${through}. To look up single incidents, use VPD's <a href="https://geodash.vpd.ca/">GeoDASH crime map</a>.</p>
    <p>Shows reported incidents that police confirmed occurred, not all crime. Busy areas show more because more people are there. This is for awareness, not a safety score for any address.</p>
    <p>VPD counts every offence in an incident, while Statistics Canada counts only the most serious one, so these totals can't be compared with Statistics Canada crime figures or rates.</p>
    <p>VPD offsets locations for privacy: property crimes to the hundred block, offences against a person across several blocks. ${fmt(noLocationCount())} incidents ${periodLabel()} have no location and aren't shown on the map; click a spot to see offences against a person counted for its whole neighbourhood. Neighbourhood boundaries: City of Vancouver open data.</p>
    <p>Far more reports are timed at midnight than at 1 am, which usually means some incidents with no exact time are recorded as 12 am. Overnight counts may run a little high.</p>`;
  const p = d.partialYear;
  const full = state.shown.years.has(p) ? `${p} scaled to a full year` : "";
  $("legend-note").hidden = state.type === "all";
  $("legend-title").textContent = state.hours
    ? `${cap(timeLabel())}, per hour${full ? `; ${full}` : ""}`
    : full ? `Per year, ${full}` : "Incidents per year";
  labelLegend();
}

// Visitors get a plain message and a way to retry; the steps for whoever runs the site go to the console
function showError(devHint) {
  console.error(`VanScene: ${devHint}`);
  $("status").innerHTML = `<div><p>Couldn't load the crime data.</p><p class="hint">Check your connection, then try again.</p>
    <button type="button" class="btn" style="margin-top:12px" onclick="location.reload()">Reload</button></div>`;
  $("status").classList.add("show");
}

// The views bar along the bottom: Map, Compare and Trends
for (const b of document.querySelectorAll(".rail button[data-view]")) {
  b.addEventListener("click", () => {
    if (!state.data) return;
    if (isPhone()) closeFilters();   // the open filters hide every view panel, so the tap would look like it did nothing
    setView(b.dataset.view);
  });
}
// Phones have no header, so its parts move: the search onto the bottom sheet's resting capsule, the name and theme
// switch to the sheet's foot (above the refresh date), and the map key onto the map as a chip. Wider screens put them
// all back
function placeSearch() {
  const phone = isPhone(), search = document.querySelector(".search"), brand = document.querySelector(".brand"),
    head = document.querySelector(".site-head"), theme = $("theme-toggle"), legend = $("legend");
  // The map credit sits in its map corner (setPosition rebuilds it there). On phones it moves to the sheet's foot,
  // after the refresh date, rather than running across the top of a small map
  map.attributionControl.setPosition("bottomleft");
  if (phone) {
    $("filters-top").append(search);
    $("updated").before(brand);
    brand.append(theme);   // the theme switch sits on the right of the name in the sheet's foot
    $("updated").after(map.attributionControl.getContainer());
    $("app").append(legend);   // out of the sheet: inside its blur, a chip couldn't sit on the map
  } else {
    $("head-search").prepend(search);
    head.prepend(brand);
    head.append(theme);
    $("filters-body").after(legend);
  }
}
phoneQuery.addEventListener("change", placeSearch);
placeSearch();
// Phones: the filters' sheet has three heights: at rest (just the search), half the screen (.open) and all of it (.full)
const SHEET_HEIGHTS = ["rest", "half", "full"];
function sheetHeight() {
  const f = $("filters");
  return f.classList.contains("full") ? "full" : f.classList.contains("open") ? "half" : "rest";
}
function setSheet(height) {
  const f = $("filters");
  f.classList.toggle("open", height !== "rest");
  f.classList.toggle("full", height === "full");
  $("filters-handle").setAttribute("aria-expanded", String(height !== "rest"));
  if (height !== "rest") $("toast").classList.remove("show");   // the note would sit on top of the open sheet
}
function closeFilters() { setSheet("rest"); }
// A real pull-up of the sheet closes the card under it: the area card lets go of its spot, and Compare or Trends go
// back to the map view. Putting the sheet back down then shows the map and the search. It waits for the card to fade
// out, and keeps the card if the sheet went straight back down (just a peek)
function releaseCard() {
  if (state.view === "map" && !state.selected) return;
  setTimeout(() => {
    if (sheetHeight() === "rest") return;
    if (state.view === "map") { state.selected = null; syncCircles(); renderPanels(); } else setView("map");
  }, 300);
}
$("filters-handle").addEventListener("click", () => {
  const up = sheetHeight() === "rest";
  setSheet(up ? "half" : "rest");
  if (up) releaseCard();
});
// (Searching in Compare places an area by name, so there the search leaves the Compare card be)
$("search").addEventListener("focus", () => { if (isPhone()) { setSheet("full"); if (state.view === "map") releaseCard(); } });   // typing lifts the sheet clear of the keyboard
// The bottom bar's search. Wider screens: it jumps into the search box in the header. Phones: it brings the sheet
// up halfway, so the year, type and time can be picked first; tapping the search box there takes it to full
$("rail-search").addEventListener("click", () => {
  if (!isPhone()) { $("search").focus(); return; }
  setSheet("half"); releaseCard();
});
// Dragging any sheet's handle moves the sheet with the finger, as on iPhone. On release it settles at the nearest
// height it can rest at (the filters: rest, half, full; a card: shrunk or open), carried on a step by a quick flick.
// A tap still works through the handle's own click; after a drag, the click the browser may send as well is ignored
let swallowClickUntil = 0, drag = null;
// A card rests shrunk to its heading, open (a third of the screen, set in the styles) or tall. Dragged right down
// ("gone") it closes, as its hidden close button would: the area card lets go of its spot, Compare and Trends go back to the map
const cardHeight = (panel) => panel.classList.contains("collapsed") ? "shrunk" : panel.classList.contains("tall") ? "tall" : "open";
function setCard(panel, name) {
  panel.classList.toggle("collapsed", name === "shrunk");
  panel.classList.toggle("tall", name === "tall");
  panel.querySelector(".sheet-handle").setAttribute("aria-expanded", String(name !== "shrunk"));
}
// Each height a sheet can rest at, in pixels, read by trying each one on with animations off
function restingHeights(panel) {
  const filters = panel.id === "filters", was = filters ? sheetHeight() : cardHeight(panel);
  const tryOn = (h) => filters ? setSheet(h) : setCard(panel, h);
  panel.style.transition = "none";
  // (the filters at rest are put away below the screen, so a drag let go low shrinks them to nothing)
  const heights = (filters ? SHEET_HEIGHTS : ["shrunk", "open", "tall"]).map((h) => { tryOn(h); return [h, filters && h === "rest" ? 0 : panel.offsetHeight]; });
  tryOn(was);
  // A swipe down closes a card in one go; shrunk stays a resting height only for a card that's already shrunk (a tap on
  // its handle shrinks it), so a short drag doesn't throw it away
  return filters ? heights : [["gone", 0], ...heights.filter(([h]) => h !== "shrunk" || was === "shrunk")];
}
function settleSheet(panel, name, px) {
  const clear = () => ["height", "max-height", "transition", "overflow", "transform", "opacity"].forEach((p) => panel.style.removeProperty(p));
  // A card let go to close settles onto the bottom bar: its bottom edge comes to rest just above the bar while it
  // folds down towards it and fades, then it closes
  if (name === "gone") {
    const app = $("app"), stripTop = $("rail").getBoundingClientRect().top - app.getBoundingClientRect().top;
    panel.style.transformOrigin = "50% 100%";
    panel.style.transition = "transform 0.32s var(--ease), opacity 0.26s ease-in";
    panel.style.transform = `translateY(${stripTop - 8 - (panel.offsetTop + panel.offsetHeight)}px) scale(0.94, 0.5)`;
    panel.style.opacity = "0";
    setTimeout(() => {
      swallowClickUntil = 0;   // not the stray click the drag guard drops
      panel.querySelector(".x").click();
      clear(); panel.style.removeProperty("transform-origin");
    }, 330);
    return;
  }
  const low = name === "rest" || name === "shrunk";
  const apply = () => panel.id === "filters" ? setSheet(name) : setCard(panel, name);
  if (!low) apply();   // going up: show the content as it rises; going down: hide it once there
  if (!low && panel.id === "filters") releaseCard();
  panel.style.transition = ["height", "left", "right", "bottom", "border-radius"].map((p) => p + " 0.28s var(--ease)").join(", ");
  panel.style.height = px + "px";
  // Going down, the lower height is put on while the drag's own transitions still hold, so the put-away sheet drops out
  // of sight at once rather than popping back to full size as it slides away
  setTimeout(() => { if (low) { apply(); void panel.offsetHeight; } clear(); }, 290);
}
// Where a finger can grab a sheet: its handle, the search row, a card's heading, and the bottom bar (phones), which
// pulls the put-away filters sheet up from where the bar is, the two sharing a bottom edge, so it's caught under the finger.
// A wide target matters on a phone, where the thin handle alone took a precise touch
const GRAB = ".sheet-handle, .filters-top, .card-head, .cmp-head, .rail";
document.addEventListener("pointerdown", (e) => {
  if (!isPhone() || e.button > 0) return;
  // A card's content, or the pulled-up sheet's, can be pulled down too once it's scrolled to its top, as phone sheets
  // work. Not from the hours track or a list, which take their own drags and scrolls
  if (e.target.closest(".track-bars, .suggest")) return;
  const zone = e.target.closest(GRAB), card = !zone && e.target.closest(".area, .compare, .trends, .filters.open");
  if (!zone && !(card && card.scrollTop <= 0)) return;
  const bar = !!zone?.matches(".rail"), panel = bar ? $("filters") : (zone || card).closest(".panel");
  drag = { panel, body: !!card, id: e.pointerId, x0: e.clientX, y0: e.clientY, h0: bar ? zone.offsetHeight : panel.offsetHeight, y: e.clientY, t: e.timeStamp, v: 0, moved: false, frame: 0 };
});
// Safari starts scrolling a card's content as soon as a finger moves on it, and then stops sending the drag. While a
// card scrolled to its top is pulled down, keep the browser from taking the gesture; pulled up, its content scrolls.
// Listened for on the sheet and cards only: a page-wide listener that can cancel touches makes the browser wait on
// this script before every scroll or pinch of the map, which made panning and zooming stutter
const holdSwipe = (e) => { if (drag?.body && e.touches[0].clientY > drag.y0) e.preventDefault(); };
for (const id of ["filters", "area", "compare", "trends"]) $(id).addEventListener("touchmove", holdSwipe, { passive: false });
document.addEventListener("pointermove", (e) => {
  const d = drag;
  if (!d || e.pointerId !== d.id) return;
  const { panel, y0 } = d;
  if (!d.moved) {
    const dx = Math.abs(e.clientX - d.x0), dy = Math.abs(e.clientY - y0);
    if (dy < 8 && dx < 8) return;   // not a drag yet: could still be a tap on the search or a button
    if (dx > dy || (d.body && e.clientY < y0)) { drag = null; return; }   // sideways isn't for the sheet, nor up on a card's content
    d.moved = true;
    try { panel.setPointerCapture(e.pointerId); } catch (err) {}   // keep the finger if it slides off the sheet
    d.heights = restingHeights(panel);   // read once the drag starts, so a plain tap costs nothing
    if (panel.id === "filters" && sheetHeight() === "rest") setSheet("half");   // let the content show as it's pulled up
    // Held at its starting height from the first move, or it shows at full height for a frame before the drag sizes it
    panel.style.transition = "none"; panel.style.maxHeight = "none"; panel.style.overflow = "hidden"; panel.style.height = d.h0 + "px";
  }
  d.v = (e.clientY - d.y) / Math.max(1, e.timeStamp - d.t);   // px per ms, downward positive
  d.y = e.clientY; d.t = e.timeStamp;
  // Touch events can come faster than the screen draws; resize the sheet at most once a frame
  if (!d.frame) d.frame = requestAnimationFrame(() => {
    d.frame = 0;
    if (drag !== d) return;
    const lo = d.heights[0][1], hi = d.heights[d.heights.length - 1][1];
    panel.style.height = Math.max(0, Math.min(d.h0, lo - 30), Math.min(hi + 30, d.h0 - (d.y - y0))) + "px";
  });
});
function endDrag(e) {
  const d = drag;
  if (!d || (e && e.pointerId !== d.id)) return;
  drag = null;
  if (!d.moved) return;   // a tap: the handle's own click, the search or a button takes it
  cancelAnimationFrame(d.frame);
  const { panel, heights, v } = d;
  panel.style.height = Math.max(0, d.h0 - (d.y - d.y0)) + "px";   // the last move, in case its frame hadn't drawn
  const aim = panel.offsetHeight - v * 150;   // where a flick would carry it
  const [name, px] = heights.reduce((best, h) => Math.abs(h[1] - aim) < Math.abs(best[1] - aim) ? h : best);
  settleSheet(panel, name, px);
  swallowClickUntil = performance.now() + 400;
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
// After a drag, the click the browser may send as well mustn't press whatever the finger ended on
document.addEventListener("click", (e) => {
  if (performance.now() < swallowClickUntil && e.target.closest(".panel")) { e.preventDefault(); e.stopPropagation(); swallowClickUntil = 0; }
}, true);
// Wider screens: the header's sidebar button, or the name beside it, slides the filters drawer away to give the map the
// whole width, and the name folds down to the mark. Not remembered: every visit opens with the filters showing,
// so newcomers see what they can pick before anything else
function setSidebar(open) {
  document.body.classList.toggle("side-hidden", !open);
  const label = open ? "Hide filters" : "Show filters", brand = $("brand-btn"), live = !isPhone();
  $("side-toggle").setAttribute("aria-expanded", String(open));
  $("side-toggle").setAttribute("aria-label", label);
  brand.tabIndex = live ? 0 : -1;   // phones have no sidebar, so there the name is just the name
  if (live) {
    brand.removeAttribute("aria-hidden");
    Object.entries({ "aria-label": label, "aria-expanded": String(open), "aria-controls": "filters" }).forEach(([a, v]) => brand.setAttribute(a, v));
  } else {
    brand.setAttribute("aria-hidden", "true");
    ["aria-label", "aria-expanded", "aria-controls", "title"].forEach((a) => brand.removeAttribute(a));
  }
}
$("side-toggle").addEventListener("click", () => setSidebar(document.body.classList.contains("side-hidden")));
$("brand-btn").addEventListener("click", () => { if (!isPhone()) setSidebar(document.body.classList.contains("side-hidden")); });
phoneQuery.addEventListener("change", () => setSidebar(!document.body.classList.contains("side-hidden")));
setSidebar(true);
try { localStorage.removeItem("sidebar"); } catch (e) {}   // clear the choice older versions saved
// The rail button moves the views bar from the bottom of the map into a slim rail down the right edge, and back.
// Not remembered: every visit opens with the bar at the bottom, where newcomers look for it first
function setRail(on) {
  document.body.classList.toggle("rail-on", on);
  $("rail-toggle").setAttribute("aria-pressed", String(on));
}
// The shapes the bar flows through like slime on its way into the rail: it stretches as it runs right along the
// bottom, splats flat against the edge, shoots up it in a long drip, pulls its tail in and wobbles to rest.
// The way back plays them in reverse. bar and rail are the two resting boxes, in the page's coordinates
function slimeFrames(bar, rail, edge) {
  const f = (offset, x, y, w, h, r) => ({ offset, left: x + "px", top: y + "px", width: w + "px", height: h + "px",
    borderRadius: r, right: "auto", bottom: "auto", transform: "none" });
  const floor = bar.bottom, pill = bar.height / 2 + "px";
  return [
    f(0, bar.left, bar.top, bar.width, bar.height, pill),
    f(0.28, bar.left + bar.width * 0.35, floor - bar.height * 0.78, bar.width * 1.45, bar.height * 0.78, pill),
    f(0.44, edge - bar.width * 0.72, floor - bar.height * 1.12, bar.width * 0.72, bar.height * 1.12, `${pill} 0 0 ${pill}`),
    f(0.54, edge - rail.width * 1.3, floor - bar.height * 2.2, rail.width * 1.3, bar.height * 2.2, "40px 0 0 40px"),
    f(0.72, edge - rail.width * 0.75, rail.top, rail.width * 0.75, floor - rail.top, "0 0 0 30px"),
    f(0.86, edge - rail.width * 0.92, rail.top, rail.width * 0.92, rail.height * 1.15, "0 0 0 26px"),
    f(0.94, edge - rail.width * 1.06, rail.top, rail.width * 1.06, rail.height * 0.95, "0 0 0 14px"),
    f(1, rail.left, rail.top, rail.width, rail.height, "0 0 0 16px"),
  ];
}
// The bar changes shape (a row becomes a column), which CSS can't animate, so the switch moves the glass itself
// through slimeFrames. People who asked for less motion get the switch at once
$("rail-toggle").addEventListener("click", () => {
  const body = document.body, rail = $("rail");
  if (body.classList.contains("rail-morph")) return;   // mid-switch: let it finish
  const on = !body.classList.contains("rail-on");
  if (reduceMotion) { setRail(on); return; }
  body.classList.add("rail-morph");   // the icons fade out first
  setTimeout(() => {
    const page = body.getBoundingClientRect(), box = (r) => ({ left: r.left - page.left, top: r.top - page.top,
      width: r.width, height: r.height, bottom: r.bottom - page.top });
    const from = box(rail.getBoundingClientRect());
    setRail(on);
    const to = box(rail.getBoundingClientRect());
    const frames = on ? slimeFrames(from, to, page.width) : slimeFrames(to, from, page.width).reverse().map((k) => ({ ...k, offset: 1 - k.offset }));
    rail.animate(frames, { duration: 450, easing: "cubic-bezier(0.45, 0.05, 0.35, 1)" })
      .finished.then(() => body.classList.remove("rail-morph"));   // and fade back in once it has settled
  }, 60);
});
try { localStorage.removeItem("rail"); } catch (e) {}   // clear the choice older versions saved

function syncThemeButton() {
  const label = isDark() ? "Switch to light mode" : "Switch to dark mode";
  $("theme-toggle").setAttribute("aria-label", label);
}
$("theme-toggle").addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (e) {}   // remember the choice for next visit
  syncThemeButton();
  paintCoverage(next);                                        // normally painted already (see addCoverageMask)
  paintCircles();
  paintBasemap();
  // Only the colour ramp changes: the heat canvas holds strength alone, so it needs no redraw
  heat.options.gradient = heatGradient();
  heat._heat.gradient(heat.options.gradient);
  if (state.data) labelLegend();
});
syncThemeButton();

// ---------------------------------------------------------------------
// Load the data and start
// ---------------------------------------------------------------------
// Version 3 of data.json keeps each field in its own list (it downloads much smaller);
// this puts them back into one row per point. Latitude and longitude are stored as whole
// numbers of 1/10,000 degree counted from lat0/lng0, so dividing gives the same 4 decimals as before.
function pointRows(c) {
  const rows = new Array(c.type.length);
  for (let i = 0; i < rows.length; i++) {
    rows[i] = [(c.lat0 + c.lat[i]) / 1e4, (c.lng0 + c.lng[i]) / 1e4, c.type[i], c.hour[i], c.year[i], c.md[i]];
  }
  return rows;
}

async function start() {
  if (location.protocol === "file:") {
    showError("this page needs a local web server to load its data. In a terminal, go to the web folder and run python -m http.server 8000, then open http://localhost:8000.");
    return;
  }
  // Small, and only needed for the neighbourhood counts, so it loads alongside the data and the app carries on without it
  const gotBoundaries = fetch("boundaries.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  try {
    const res = await fetch(CONFIG.dataUrl);
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
  } catch (err) {
    showError(`couldn't load ${CONFIG.dataUrl} (${err.message}). Run python scripts/prepare_data.py from the project folder to create it, then reload this page.`);
    return;
  }
  if (state.data.version !== 3) {
    showError("this data.json was made by an older script. Run python scripts/prepare_data.py from the project folder, then reload this page.");
    return;
  }
  state.data.points = pointRows(state.data.points);
  boundaries = await gotBoundaries;
  $("status").classList.remove("show");
  addCoverageMask(state.data.points);
  // Neighbourhood names for the map's label layer (see mapStyle), ranked busiest first by reports within about 1 km of
  // each centre, so where names would collide the busier area keeps its name. The city's own name sits in the open
  // space between Fairview, Mount Pleasant and Shaughnessy, clear of the neighbourhood names
  const hoods = state.data.neighbourhoods, busy = new Array(hoods.length).fill(0);
  for (const p of state.data.points) {   // plain index loops: this runs hoods × incidents times at startup
    for (let i = 0; i < hoods.length; i++) if (Math.abs(p[LAT] - hoods[i].lat) < 0.009 && Math.abs(p[LNG] - hoods[i].lng) < 0.014) busy[i]++;
  }
  const point = (lat, lng, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties });
  const byBusy = hoods.map((h, i) => [h, busy[i]]).sort((a, b) => b[1] - a[1]);
  hoodNames = { type: "FeatureCollection", features: [
    point(49.2555, -123.123, { name: "Vancouver", city: true }),
    ...byBusy.map(([h], rank) => point(h.lat, h.lng, { name: h.name, rank })),
  ] };
  paintBasemap(true);
  buildControls();
  const linked = readUrl();
  buildPeriods();
  setView(linked || (Object.hasOwn(PANEL_FOR, CONFIG.defaultView) ? CONFIG.defaultView : "map"));
  refresh();
  const spotted = state.view === "compare" ? state.a : state.selected;
  if (noYears()) showToast("Pick a year in the filters to see where incidents were reported.", 7000);
  else if (!spotted) showToast(`${isPhone() ? "Tap" : "Click"} anywhere on the map to see what's been reported within ${CONFIG.radiusMeters} m, or search a neighbourhood.`, 7000);
  requestAnimationFrame(() => {
    map.invalidateSize();
    if (spotted) fitForView();   // a link with a spot opens on it
    else {
      const o = panelPadding(L.latLngBounds(CITY_BOUNDS));
      map.fitBounds(CITY_BOUNDS, { ...o, maxZoom: 13, animate: false });
      // Fill rather than fit: a step closer so the city fills the open map (its very top and bottom may sit just off screen)
      const mid = L.point(o.paddingTopLeft).add(map.getSize().subtract(o.paddingBottomRight)).divideBy(2);
      map.setZoomAround(mid, Math.min(13, map.getZoom() + 0.25), { animate: false });
    }
  });
}

start();
