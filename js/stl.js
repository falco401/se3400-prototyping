/* Minimal binary/ASCII STL loader -> THREE.BufferGeometry (no extra dependencies). */
(function () {
  'use strict';

  function parseBinary(buf) {
    var dv = new DataView(buf);
    var count = dv.getUint32(80, true);
    var pos = new Float32Array(count * 9);
    var nrm = new Float32Array(count * 9);
    var off = 84;
    for (var i = 0; i < count; i++) {
      var nx = dv.getFloat32(off, true), ny = dv.getFloat32(off + 4, true), nz = dv.getFloat32(off + 8, true);
      off += 12;
      for (var v = 0; v < 3; v++) {
        var o = i * 9 + v * 3;
        pos[o] = dv.getFloat32(off, true);
        pos[o + 1] = dv.getFloat32(off + 4, true);
        pos[o + 2] = dv.getFloat32(off + 8, true);
        nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
        off += 12;
      }
      off += 2;
    }
    return { pos: pos, nrm: nrm, count: count };
  }

  /* Re-computes vertex normals, smoothing only across faces that are within `angle` of each other
     so curved shells look smooth while wall edges / rims stay crisp. */
  function smooth(pos, nrm, count, angleDeg) {
    var cosT = Math.cos((angleDeg || 55) * Math.PI / 180);
    var map = Object.create(null);
    var key = function (x, y, z) { return Math.round(x * 100) + '_' + Math.round(y * 100) + '_' + Math.round(z * 100); };
    var f, v, k, o;
    for (f = 0; f < count; f++) {
      for (v = 0; v < 3; v++) {
        o = f * 9 + v * 3;
        k = key(pos[o], pos[o + 1], pos[o + 2]);
        (map[k] || (map[k] = [])).push(f);
      }
    }
    var out = new Float32Array(count * 9);
    for (f = 0; f < count; f++) {
      var fx = nrm[f * 9], fy = nrm[f * 9 + 1], fz = nrm[f * 9 + 2];
      for (v = 0; v < 3; v++) {
        o = f * 9 + v * 3;
        var list = map[key(pos[o], pos[o + 1], pos[o + 2])];
        var sx = 0, sy = 0, sz = 0;
        for (var n = 0; n < list.length; n++) {
          var g = list[n] * 9;
          var gx = nrm[g], gy = nrm[g + 1], gz = nrm[g + 2];
          if (gx * fx + gy * fy + gz * fz >= cosT) { sx += gx; sy += gy; sz += gz; }
        }
        var l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
        out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l;
      }
    }
    return out;
  }

  function toGeometry(buf, smoothShade) {
    var d = parseBinary(buf);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
    // smoothShade: false = flat, true = 55 degree crease angle, number = that crease angle (higher softens cut edges)
    var ang = typeof smoothShade === 'number' ? smoothShade : 55;
    g.setAttribute('normal', new THREE.BufferAttribute(smoothShade ? smooth(d.pos, d.nrm, d.count, ang) : d.nrm, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  function b64ToBuffer(b64) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  /* Fetches models/<name>.stl; falls back to the base64 copy in models-data.js (works from file://). */
  function loadPart(name) {
    return fetch('models/' + name + '.stl')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .catch(function () {
        if (window.HELMET_STL && window.HELMET_STL[name]) return b64ToBuffer(window.HELMET_STL[name]);
        throw new Error('Missing STL part: ' + name);
      });
  }

  window.STL = { toGeometry: toGeometry, loadPart: loadPart };
})();
