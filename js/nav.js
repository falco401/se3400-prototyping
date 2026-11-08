/* Local navigation model: a small fictional city grid, an address/place search, shortest-path routing,
   turn-by-turn steps for the ride engine, and an SVG map. Everything runs in the browser; no map or geocoding service. */
(function () {
  'use strict';

  // block boundaries in metres (columns = avenues running north-south, rows = streets running east-west)
  var X = [0, 240, 520, 740, 1010, 1250], Y = [0, 200, 420, 700, 900, 1160];
  var H = ['Elm St', 'Main St', 'Oak Ave', 'Pine St', 'Maple Dr', 'Cedar Ct'];
  var V = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave', '6th Ave'];
  var NR = Y.length, NC = X.length;

  // kind 'h' = on an east-west street (idx = row), 'v' = on a north-south avenue (idx = column). n = house number (100-599)
  var PLACES = {
    home:    { name: 'Home',          kind: 'v', idx: 0, n: 118 },
    work:    { name: 'Work',          kind: 'h', idx: 3, n: 412 },
    cafe:    { name: 'Corner Café', kind: 'h', idx: 1, n: 205 },
    library: { name: 'Library',       kind: 'v', idx: 2, n: 330 },
    grocery: { name: 'Grocery',       kind: 'h', idx: 2, n: 150 },
    park:    { name: 'Riverside Park', kind: 'v', idx: 4, n: 480 }
  };

  function streetName(a) { return a.kind === 'h' ? H[a.idx] : V[a.idx]; }
  function addrLabel(a) { return (a.n ? a.n + ' ' : '') + streetName(a); }

  function pos(a) {
    var b = Math.max(0, Math.min(4, Math.floor(a.n / 100) - 1)), f = (a.n % 100) / 100;
    return a.kind === 'h'
      ? { x: X[b] + f * (X[b + 1] - X[b]), y: Y[a.idx] }
      : { x: X[a.idx], y: Y[b] + f * (Y[b + 1] - Y[b]) };
  }

  /* ---------------------------------------------------------------- search */
  function geocode(text) {
    text = (text || '').trim().toLowerCase();
    if (!text) return { items: [] };
    var items = [];
    Object.keys(PLACES).forEach(function (k) {
      var p = PLACES[k];
      if (k !== 'home' || text.indexOf('home') === 0) { if (p.name.toLowerCase().indexOf(text) !== -1) items.push({ label: p.name, sub: addrLabel(p), addr: p, place: k }); }
    });
    var m = text.match(/^(\d{1,4})(?:\s+(.*))?$/), num = m ? parseInt(m[1], 10) : null, q = m ? (m[2] || '').trim() : text;
    if (q) {
      var streets = [];
      H.forEach(function (n, i) { if (n.toLowerCase().indexOf(q) !== -1) streets.push({ kind: 'h', idx: i }); });
      V.forEach(function (n, i) { if (n.toLowerCase().indexOf(q) !== -1) streets.push({ kind: 'v', idx: i }); });
      streets.forEach(function (st) {
        if (num == null) items.push({ label: streetName(st), sub: 'Street · numbers 100–599', addr: { kind: st.kind, idx: st.idx, n: 250 } });
        else if (num >= 100 && num <= 599) items.push({ label: num + ' ' + streetName(st), sub: 'Address', addr: { kind: st.kind, idx: st.idx, n: num } });
        else if (!items.length) return;
      });
      if (num != null && (num < 100 || num > 599) && streets.length) return { items: items, error: 'Numbers on ' + streetName(streets[0]) + ' run from 100 to 599.' };
    } else if (num != null) {
      return { items: items, error: 'Add a street name, for example ' + num + ' Pine St.' };
    }
    if (!items.length) return { items: [], error: 'No match. Try an address like 412 Pine St, or a place like Library.' };
    return { items: items.slice(0, 6) };
  }

  /* nearest address to a map point (metres) */
  function nearest(x, y) {
    var best = null;
    function consider(kind, idx, d, along) {
      if (!best || d < best.d) best = { kind: kind, idx: idx, d: d, along: along };
    }
    var cx = Math.max(X[0], Math.min(X[NC - 1], x)), cy = Math.max(Y[0], Math.min(Y[NR - 1], y));
    for (var r = 0; r < NR; r++) consider('h', r, Math.abs(y - Y[r]) + (x - cx) * (x - cx) * 0 + Math.abs(x - cx), cx);
    for (var c = 0; c < NC; c++) consider('v', c, Math.abs(x - X[c]) + Math.abs(y - cy), cy);
    var arr = best.kind === 'h' ? X : Y, b = 0;
    for (var i = 0; i < arr.length - 1; i++) if (best.along >= arr[i]) b = i;
    var n = 100 * (b + 1) + Math.min(99, Math.round(100 * (best.along - arr[b]) / (arr[b + 1] - arr[b])));
    return { kind: best.kind, idx: best.idx, n: n };
  }

  /* ---------------------------------------------------------------- routing */
  function route(startAddr, destAddr) {
    var nodes = [], adj = [];
    for (var r = 0; r < NR; r++) for (var c = 0; c < NC; c++) { nodes.push({ x: X[c], y: Y[r] }); adj.push([]); }
    function link(a, b, w) { adj[a].push([b, w]); adj[b].push([a, w]); }
    for (r = 0; r < NR; r++) for (c = 0; c < NC; c++) {
      var id = r * NC + c;
      if (c < NC - 1) link(id, id + 1, X[c + 1] - X[c]);
      if (r < NR - 1) link(id, id + NC, Y[r + 1] - Y[r]);
    }
    function addPoint(a) {
      var p = pos(a), id = nodes.length, b = Math.max(0, Math.min(4, Math.floor(a.n / 100) - 1)), n1, n2, off;
      nodes.push({ x: p.x, y: p.y }); adj.push([]);
      if (a.kind === 'h') { n1 = a.idx * NC + b; n2 = n1 + 1; off = p.x - X[b]; }
      else { n1 = b * NC + a.idx; n2 = n1 + NC; off = p.y - Y[b]; }
      var len = Math.hypot(nodes[n2].x - nodes[n1].x, nodes[n2].y - nodes[n1].y);
      link(id, n1, off); link(id, n2, len - off);
      return { id: id, edge: n1 + ':' + n2, off: off };
    }
    var S = addPoint(startAddr), D = addPoint(destAddr);
    if (S.edge === D.edge) link(S.id, D.id, Math.abs(S.off - D.off));

    var dist = [], prev = [], done = [];
    for (var i = 0; i < nodes.length; i++) { dist[i] = Infinity; prev[i] = -1; done[i] = false; }
    dist[S.id] = 0;
    for (;;) {
      var u = -1;
      for (i = 0; i < nodes.length; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity || u === D.id) break;
      done[u] = true;
      adj[u].forEach(function (e) { if (dist[u] + e[1] < dist[e[0]]) { dist[e[0]] = dist[u] + e[1]; prev[e[0]] = u; } });
    }
    if (dist[D.id] === Infinity) return { ok: false };
    var path = []; for (var n = D.id; n !== -1; n = prev[n]) path.unshift(n);

    // segments with street names, merged into legs of constant heading
    var pts = path.map(function (id) { return { x: nodes[id].x, y: nodes[id].y }; });
    var legs = [];
    for (i = 0; i < pts.length - 1; i++) {
      var dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, len = Math.hypot(dx, dy);
      if (len < 0.5) continue;
      var hx = Math.sign(dx), hy = Math.sign(dy), street;
      if (hy === 0) { for (r = 0; r < NR; r++) if (Math.abs(Y[r] - pts[i].y) < 1) street = H[r]; }
      else { for (c = 0; c < NC; c++) if (Math.abs(X[c] - pts[i].x) < 1) street = V[c]; }
      var last = legs[legs.length - 1];
      if (last && last.hx === hx && last.hy === hy) last.len += len;
      else legs.push({ hx: hx, hy: hy, len: len, street: street });
    }
    var total = dist[D.id], steps = [];
    legs.forEach(function (lg, k) {
      if (k < legs.length - 1) {
        var nx = legs[k + 1], cr = lg.hx * nx.hy - lg.hy * nx.hx;     // y axis points south: cross > 0 = right turn
        steps.push({ kind: cr > 0 ? 'right' : 'left', street: nx.street, dist: Math.round(lg.len) });
      } else {
        steps.push({ kind: 'arrive', street: lg.street, house: String(destAddr.n), dist: Math.round(lg.len) });
      }
    });
    if (!steps.length) steps.push({ kind: 'arrive', street: streetName(destAddr), house: String(destAddr.n), dist: 20 });
    // one simulated hazard on the longest leg so the alert can be seen
    var li = 0; steps.forEach(function (s, k) { if (s.dist > steps[li].dist) li = k; });
    if (total > 700) { steps[li].hazardAt = Math.round(steps[li].dist * 0.45); steps[li].hazardText = 'Pedestrian crossing'; }

    var tot = steps.reduce(function (a, s) { return a + s.dist; }, 0);
    var mins = Math.max(1, Math.round(total / 4.5 / 60));
    var meta = (total >= 1000 ? (total / 1000).toFixed(1) + ' km' : Math.round(total / 10) * 10 + ' m') + ' · ' + mins + ' min';
    return {
      ok: true, dist: total, mins: mins, meta: meta, points: pts, steps: steps,
      route: { id: 'nav-custom', mode: 'commute', source: 'address', name: 'To ' + addrLabel(destAddr), meta: meta, steps: steps },
      total: tot
    };
  }

  function pointAt(points, d) {
    var acc = 0;
    for (var i = 0; i < points.length - 1; i++) {
      var a = points[i], b = points[i + 1], l = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= acc + l || i === points.length - 2) { var t = l ? Math.max(0, Math.min(1, (d - acc) / l)) : 0; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
      acc += l;
    }
    return points[0];
  }

  /* ---------------------------------------------------------------- map (SVG) */
  function mapSVG(plan, startAddr, destAddr) {
    var s = '<svg id="mapSvg" class="map" viewBox="-200 -90 1640 1420" role="img" aria-label="City map" preserveAspectRatio="xMidYMid meet">';
    s += '<rect x="-30" y="-30" width="1310" height="1220" rx="24" class="m-land"/>';
    for (var r = 0; r < NR; r++) s += '<line x1="-30" y1="' + Y[r] + '" x2="1280" y2="' + Y[r] + '" class="m-street"/>';
    for (var c = 0; c < NC; c++) s += '<line x1="' + X[c] + '" y1="-30" x2="' + X[c] + '" y2="1190" class="m-street"/>';
    for (r = 0; r < NR; r++) s += '<text x="-50" y="' + (Y[r] + 14) + '" text-anchor="end" class="m-label">' + H[r] + '</text>';
    for (c = 0; c < NC; c++) s += '<text x="' + X[c] + '" y="-52" text-anchor="middle" class="m-label">' + V[c] + '</text>';
    Object.keys(PLACES).forEach(function (k) {
      var p = pos(PLACES[k]);
      s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="13" class="m-poi"/>';
      s += '<text x="' + (p.x + 22) + '" y="' + (p.y - 16) + '" class="m-poilabel">' + PLACES[k].name + '</text>';
    });
    if (plan && plan.ok) {
      s += '<polyline class="m-route" points="' + plan.points.map(function (p) { return p.x + ',' + p.y; }).join(' ') + '"/>';
    }
    var sp = pos(startAddr);
    s += '<circle cx="' + sp.x + '" cy="' + sp.y + '" r="20" class="m-start"/>';
    if (destAddr) { var dp = pos(destAddr); s += '<circle cx="' + dp.x + '" cy="' + dp.y + '" r="26" class="m-dest"/><circle cx="' + dp.x + '" cy="' + dp.y + '" r="9" class="m-destdot"/>'; }
    s += '<circle id="mapDot" r="19" cx="' + sp.x + '" cy="' + sp.y + '" class="m-you" visibility="hidden"/>';
    return s + '</svg>';
  }

  window.NAV = { PLACES: PLACES, geocode: geocode, nearest: nearest, route: route, pointAt: pointAt, mapSVG: mapSVG, addrLabel: addrLabel, streetName: streetName, pos: pos };
})();
