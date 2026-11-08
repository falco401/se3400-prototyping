/* Route import (front-end only): parses .gpx and .fit files in the browser, simplifies the track,
   and turns it into ride-engine routes (waypoint counter or turn-by-turn). Nothing is uploaded. */
(function () {
  'use strict';

  var D2R = Math.PI / 180, MAX_PTS = 400;

  /* ---------------------------------------------------------------- geometry */
  function project(pts) {
    var lat0 = pts[0][0], lon0 = pts[0][1], kx = Math.cos(lat0 * D2R) * 111320, ky = 110540;
    return pts.map(function (p) { return { x: (p[1] - lon0) * kx, y: (p[0] - lat0) * ky }; });
  }
  function cumulative(P) {
    var c = [0];
    for (var i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
    return c;
  }
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  // Douglas-Peucker (iterative); returns the kept indices in order
  function simplify(P, tol) {
    var keep = new Uint8Array(P.length), stack = [[0, P.length - 1]];
    keep[0] = keep[P.length - 1] = 1;
    while (stack.length) {
      var se = stack.pop(), s = se[0], e = se[1], idx = -1, md = tol;
      for (var i = s + 1; i < e; i++) { var d = segDist(P[i], P[s], P[e]); if (d > md) { md = d; idx = i; } }
      if (idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
    }
    var out = []; for (var k = 0; k < P.length; k++) if (keep[k]) out.push(k);
    return out;
  }
  function bearing(a, b) { return Math.atan2(b.x - a.x, b.y - a.y) / D2R; }   // clockwise from north

  /* ---------------------------------------------------------------- track normalising */
  function buildTrack(raw, name, fmt) {
    var pts = raw.points.filter(function (p) {
      return isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && !(p[0] === 0 && p[1] === 0);
    });
    var clean = [];
    pts.forEach(function (p) { var q = clean[clean.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) clean.push(p); });
    if (clean.length < 2) throw new Error('No GPS track points found in this file.');
    var P = project(clean), c = cumulative(P), total = c[c.length - 1];
    if (total < 50) throw new Error('This track is shorter than 50 m.');
    var ascent = null;
    if (clean.some(function (p) { return p[2] != null; })) {
      ascent = 0; var last = null;
      clean.forEach(function (p) { if (p[2] == null) return; if (last != null && p[2] - last > 1) { ascent += p[2] - last; last = p[2]; } else if (last == null || last - p[2] > 1) last = p[2]; });
    }
    var tol = 2, keep;
    do { keep = simplify(P, tol); tol *= 1.5; } while (keep.length > MAX_PTS);
    return {
      name: name, fmt: fmt, dist: Math.round(total), ascent: ascent == null ? null : Math.round(ascent),
      pts: keep.map(function (i) { return [+clean[i][0].toFixed(5), +clean[i][1].toFixed(5)]; }),
      wpts: (raw.wpts || []).filter(function (w) { return isFinite(w[0]) && isFinite(w[1]); }).slice(0, 12).map(function (w) { return [+w[0].toFixed(5), +w[1].toFixed(5), String(w[2] || '').slice(0, 40)]; })
    };
  }

  /* ---------------------------------------------------------------- GPX */
  function parseGPX(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('That file is not valid GPX (XML error).');
    var val = function (el, tag) { var n = el.getElementsByTagName(tag)[0]; return n ? n.textContent : null; };
    var pts = [], list = doc.getElementsByTagName('trkpt');
    if (!list.length) list = doc.getElementsByTagName('rtept');
    for (var i = 0; i < list.length; i++) {
      var e = val(list[i], 'ele');
      pts.push([parseFloat(list[i].getAttribute('lat')), parseFloat(list[i].getAttribute('lon')), e == null ? null : parseFloat(e)]);
    }
    var wpts = [], wl = doc.getElementsByTagName('wpt');
    for (var j = 0; j < wl.length; j++) wpts.push([parseFloat(wl[j].getAttribute('lat')), parseFloat(wl[j].getAttribute('lon')), val(wl[j], 'name')]);
    var nm = doc.getElementsByTagName('trk')[0] ? val(doc.getElementsByTagName('trk')[0], 'name') : null;
    if (!nm) nm = doc.getElementsByTagName('rte')[0] ? val(doc.getElementsByTagName('rte')[0], 'name') : null;
    if (!nm && doc.getElementsByTagName('metadata')[0]) nm = val(doc.getElementsByTagName('metadata')[0], 'name');
    return { points: pts, wpts: wpts, name: nm };
  }

  /* ---------------------------------------------------------------- FIT (minimal decoder: record + course_point messages) */
  function parseFIT(buf) {
    var dv = new DataView(buf), bytes = new Uint8Array(buf);
    if (buf.byteLength < 14) throw new Error('That file is too small to be a FIT file.');
    var hs = dv.getUint8(0), sig = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (sig !== '.FIT') throw new Error('That file is not a FIT file.');
    var end = Math.min(buf.byteLength - 2, hs + dv.getUint32(4, true)), pos = hs, defs = {}, pts = [], wpts = [], SC = 180 / 2147483648;
    function readStr(o, n) { var s = ''; for (var i = 0; i < n && bytes[o + i]; i++) s += String.fromCharCode(bytes[o + i]); return s; }
    while (pos < end) {
      var h = dv.getUint8(pos++), local, def;
      if (h & 0x80) {                       // compressed-timestamp data message
        local = (h >> 5) & 3; def = defs[local];
      } else if (h & 0x40) {                // definition message
        local = h & 0x0f;
        var little = dv.getUint8(pos + 1) === 0, gnum = dv.getUint16(pos + 2, little), nf = dv.getUint8(pos + 4), fields = [];
        pos += 5;
        for (var f = 0; f < nf; f++) { fields.push({ n: dv.getUint8(pos), size: dv.getUint8(pos + 1) }); pos += 3; }
        var devSize = 0;
        if (h & 0x20) { var nd = dv.getUint8(pos++); for (var q = 0; q < nd; q++) { devSize += dv.getUint8(pos + 1); pos += 3; } }
        defs[local] = { little: little, gnum: gnum, fields: fields, devSize: devSize };
        continue;
      } else { local = h & 0x0f; def = defs[local]; }   // normal data message
      if (!def) throw new Error('Could not read this FIT file (missing definition).');
      var lat = null, lon = null, alt = null, nm = null, o = pos;
      def.fields.forEach(function (fd) {
        var isRec = def.gnum === 20, isCp = def.gnum === 32;
        if (isRec && fd.size === 4 && fd.n === 0) lat = dv.getInt32(o, def.little);
        else if (isRec && fd.size === 4 && fd.n === 1) lon = dv.getInt32(o, def.little);
        else if (isRec && fd.size === 2 && fd.n === 2) { var a = dv.getUint16(o, def.little); if (a !== 0xffff) alt = a / 5 - 500; }
        else if (isCp && fd.size === 4 && fd.n === 2) lat = dv.getInt32(o, def.little);
        else if (isCp && fd.size === 4 && fd.n === 3) lon = dv.getInt32(o, def.little);
        else if (isCp && fd.n === 6) nm = readStr(o, fd.size);
        o += fd.size;
      });
      pos = o + def.devSize;
      if (def.gnum === 20 && lat != null && lon != null && lat !== 0x7fffffff && lon !== 0x7fffffff) pts.push([lat * SC, lon * SC, alt]);
      else if (def.gnum === 32 && lat != null && lon != null && lat !== 0x7fffffff && lon !== 0x7fffffff) wpts.push([lat * SC, lon * SC, nm]);
    }
    if (!pts.length) throw new Error('No GPS positions in this FIT file (it may be an indoor activity).');
    return { points: pts, wpts: wpts, name: null };
  }

  function baseName(fn) { return String(fn || 'Imported route').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').slice(0, 40) || 'Imported route'; }

  function parseFile(file) {
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('That file is larger than 8 MB.'));
    if (ext === 'gpx') return file.text().then(function (t) { var r = parseGPX(t); return buildTrack(r, r.name || baseName(file.name), 'GPX'); });
    if (ext === 'fit') return file.arrayBuffer().then(function (b) { var r = parseFIT(b); return buildTrack(r, baseName(file.name), 'FIT'); });
    return Promise.reject(new Error('Only .gpx and .fit files can be imported.'));
  }

  /* A generated loop used by "Try a sample route"; goes through the same GPX parser as a real file. */
  function sampleGPX() {
    var lat0 = 44.9778, lon0 = -93.2650, kx = Math.cos(lat0 * D2R) * 111320, ky = 110540, trk = '', n = 220;
    for (var i = 0; i <= n; i++) {
      var t = (i / n) * Math.PI * 2, r = 700 + 220 * Math.sin(3 * t) + 120 * Math.cos(2 * t);
      var x = r * Math.cos(t) * 1.3, y = r * Math.sin(t), ele = 250 + 25 * Math.sin(2 * t) + 12 * Math.sin(5 * t);
      trk += '<trkpt lat="' + (lat0 + y / ky).toFixed(6) + '" lon="' + (lon0 + x / kx).toFixed(6) + '"><ele>' + ele.toFixed(1) + '</ele></trkpt>';
    }
    var wp = function (t, name) {
      var r = 700 + 220 * Math.sin(3 * t) + 120 * Math.cos(2 * t);
      return '<wpt lat="' + (lat0 + r * Math.sin(t) / ky).toFixed(6) + '" lon="' + (lon0 + r * Math.cos(t) * 1.3 / kx).toFixed(6) + '"><name>' + name + '</name></wpt>';
    };
    return '<?xml version="1.0"?><gpx version="1.1" creator="prototype"><metadata><name>Sample loop</name></metadata>' +
      wp(Math.PI / 2, 'Lookout') + wp(Math.PI, 'Creek crossing') + wp(Math.PI * 1.5, 'Picnic area') +
      '<trk><name>Sample loop</name><trkseg>' + trk + '</trkseg></trk></gpx>';
  }

  /* ---------------------------------------------------------------- ride routes */
  function nearestIndex(P, w) {
    var bi = 0, bd = Infinity;
    for (var i = 0; i < P.length; i++) { var d = Math.hypot(P[i].x - w.x, P[i].y - w.y); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }

  function trailRoute(imp, id) {
    var P = project(imp.pts), c = cumulative(P), total = c[c.length - 1], marks = [];
    if (imp.wpts.length) {
      var W = project([imp.pts[0]].concat(imp.wpts.map(function (w) { return [w[0], w[1]]; }))).slice(1);
      W.forEach(function (w, i) { marks.push({ at: c[nearestIndex(P, w)], name: imp.wpts[i][2] || '' }); });
      marks.sort(function (a, b) { return a.at - b.at; });
      marks = marks.filter(function (m, i) { return m.at > 100 && m.at < total - 100 && (i === 0 || m.at - marks[i - 1].at > 100); });
    } else {
      var n = Math.max(2, Math.min(8, Math.round(total / 1500)));
      for (var k = 1; k < n; k++) marks.push({ at: total * k / n, name: '' });
    }
    marks.push({ at: total, name: 'Finish' });
    var steps = [], prev = 0;
    marks.forEach(function (m, i) {
      steps.push({ kind: 'waypoint', wpName: m.name || ('Waypoint ' + (i + 1)), dist: Math.max(10, Math.round(m.at - prev)) });
      prev = m.at;
    });
    return { id: id, mode: 'trail', source: 'import', name: imp.name, meta: fmtKm(imp.dist) + ' · ' + imp.fmt + ' · waypoints', steps: steps };
  }

  function turnRoute(imp, id) {
    var P = project(imp.pts), c = cumulative(P), total = c[c.length - 1];
    var keep = simplify(P, 12), V = keep.map(function (i) { return P[i]; }), VC = keep.map(function (i) { return c[i]; });
    var steps = [], prev = 0;
    for (var i = 1; i < V.length - 1 && steps.length < 60; i++) {
      if (Math.hypot(V[i].x - V[i - 1].x, V[i].y - V[i - 1].y) < 15 && Math.hypot(V[i + 1].x - V[i].x, V[i + 1].y - V[i].y) < 15) continue;
      var delta = bearing(V[i], V[i + 1]) - bearing(V[i - 1], V[i]);
      delta = ((delta + 540) % 360) - 180;
      if (Math.abs(delta) < 40) continue;
      if (VC[i] - prev < 25) continue;
      steps.push({ kind: Math.abs(delta) > 150 ? 'uturn' : delta > 0 ? 'right' : 'left', street: '', dist: Math.round(VC[i] - prev) });
      prev = VC[i];
    }
    steps.push({ kind: 'arrive', street: '', dist: Math.max(10, Math.round(total - prev)) });
    return { id: id, mode: 'commute', source: 'import', name: imp.name, meta: fmtKm(imp.dist) + ' · ' + imp.fmt + ' · ' + (steps.length - 1) + ' turns', steps: steps };
  }

  function fmtKm(m) { return (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km'; }

  /* Track preview (no base map): returns { html, at(fraction) -> [x, y] in SVG units }. */
  function svg(imp) {
    var W = 320, H = 190, pad = 16, P = project(imp.pts);
    var xs = P.map(function (p) { return p.x; }), ys = P.map(function (p) { return p.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var sc = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
    var ox = (W - (x1 - x0) * sc) / 2, oy = (H - (y1 - y0) * sc) / 2;
    var X = function (p) { return +(ox + (p.x - x0) * sc).toFixed(1); }, Y = function (p) { return +(H - (oy + (p.y - y0) * sc)).toFixed(1); };
    var line = P.map(function (p) { return X(p) + ',' + Y(p); }).join(' ');
    var c = cumulative(P), total = c[c.length - 1];
    var wl = project([imp.pts[0]].concat(imp.wpts.map(function (w) { return [w[0], w[1]]; }))).slice(1).map(function (p, i) {
      return '<circle cx="' + X(p) + '" cy="' + Y(p) + '" r="3.5" class="imp-wp"/><text x="' + (X(p) + 6) + '" y="' + (Y(p) + 3) + '" class="imp-lbl">' + String(imp.wpts[i][2] || '').replace(/[<>&]/g, '') + '</text>';
    }).join('');
    var html = '<svg class="impsvg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Route preview: ' + imp.name.replace(/[<>&"]/g, '') + '">' +
      '<polyline points="' + line + '" class="imp-line"/>' + wl +
      '<circle cx="' + X(P[0]) + '" cy="' + Y(P[0]) + '" r="5" class="imp-start"/>' +
      '<circle cx="' + X(P[P.length - 1]) + '" cy="' + Y(P[P.length - 1]) + '" r="5" class="imp-end"/>' +
      '<circle id="impDot" cx="' + X(P[0]) + '" cy="' + Y(P[0]) + '" r="6" class="imp-dot" style="display:none"/></svg>';
    function at(f) {
      var d = Math.max(0, Math.min(1, f)) * total, i = 1;
      while (i < c.length - 1 && c[i] < d) i++;
      var seg = c[i] - c[i - 1] || 1, t = Math.max(0, Math.min(1, (d - c[i - 1]) / seg));
      return [X({ x: P[i - 1].x + (P[i].x - P[i - 1].x) * t }) , Y({ y: P[i - 1].y + (P[i].y - P[i - 1].y) * t })];
    }
    return { html: html, at: at };
  }

  window.IMPORT = { parseFile: parseFile, parseGPX: parseGPX, parseFIT: parseFIT, buildTrack: buildTrack, sampleGPX: sampleGPX, trailRoute: trailRoute, turnRoute: turnRoute, svg: svg, fmtKm: fmtKm };
  if (typeof module !== 'undefined') module.exports = window.IMPORT;
})();
