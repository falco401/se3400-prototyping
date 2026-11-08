/* Three.js viewer for the helmet STL parts: orbit/zoom, picking, hotspots, exploded view,
   and a live HUD projection texture on the visor. */
(function () {
  'use strict';

  var PARTS = {
    helmet_shell: { smooth: 100, mat: 'shell', explode: [0, 0, 0] },
    helmet_liner: { smooth: 100, mat: 'liner', explode: [0, 0, -60] },
    pads:         { smooth: 100, mat: 'pad',   explode: [0, 0, -95] },
    visor:        { smooth: true, mat: 'visor', explode: [70, 0, -22] },
    peak:         { smooth: true, mat: 'trim',  explode: [45, 0, 55] },
    straps:       { smooth: false, mat: 'strap', explode: [0, 0, -70] },
    buckle:       { smooth: false, mat: 'trim',  explode: [0, 0, -105] },
    kill_switch:  { smooth: false, mat: 'trim', explode: [0, 70, 20] },
    kill_button:  { smooth: false, mat: 'kill', explode: [0, 70, 20] },
    sensor:       { smooth: false, mat: 'dark', explode: [55, 0, 75] },
    led_left:     { smooth: false, mat: 'ledL', explode: [-70, 0, 0] },
    led_right:    { smooth: false, mat: 'ledR', explode: [-70, 0, 0] },
    dial:         { smooth: false, mat: 'trim', explode: [-80, 0, -40] }
  };

  /* Z-up helmet space (mm). Positions + surface normals computed by tools/generate_stl.py */
  var HD = window.HELMET_HOTSPOTS;
  var HOTSPOTS = [
    { id: 'visor',  label: 'HUD visor',         pos: HD.visor.pos,  n: HD.visor.n },
    { id: 'kill',   label: 'Kill switch',       pos: HD.kill.pos,   n: HD.kill.n },
    { id: 'sensor', label: 'Sensor / camera',   pos: HD.sensor.pos, n: HD.sensor.n },
    { id: 'audio',  label: 'Directional audio', pos: HD.audio.pos,  n: HD.audio.n },
    { id: 'led',    label: 'Rear status light', pos: HD.led.pos,    n: HD.led.n }
  ];

  var KILL_N = new THREE.Vector3(HD.kill.n[0], HD.kill.n[1], HD.kill.n[2]).normalize();

  /* ---- procedural surface textures (no image files) ---- */
  function seeded(seed) { var s = seed; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  function mkTex(canvas, aniso) {
    var t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso || 4;
    return t;
  }
  // soft speckle: fine "orange peel" on paint, or pitted foam when blobs are larger
  function speckleTex(size, n, rmin, rmax, seed) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var g = c.getContext('2d'), rnd = seeded(seed);
    g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
    for (var i = 0; i < n; i++) {
      var x = rnd() * size, y = rnd() * size, r = rmin + rnd() * (rmax - rmin), l = rnd() > 0.5 ? 255 : 0;
      for (var dx = -size; dx <= size; dx += size) for (var dy = -size; dy <= size; dy += size) {
        if (x + dx < -r || x + dx > size + r || y + dy < -r || y + dy > size + r) continue;
        var rg = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        rg.addColorStop(0, 'rgba(' + l + ',' + l + ',' + l + ',.35)'); rg.addColorStop(1, 'rgba(' + l + ',' + l + ',' + l + ',0)');
        g.fillStyle = rg; g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
    return mkTex(c);
  }
  // woven strap webbing: diagonal twill lines
  function webbingTex() {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d');
    g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, 128, 128);
    g.lineWidth = 3;
    for (var i = -128; i < 256; i += 8) {
      g.strokeStyle = '#d8d8d8'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
      g.strokeStyle = '#303030'; g.beginPath(); g.moveTo(i + 4, 0); g.lineTo(i + 132, 128); g.stroke();
    }
    return mkTex(c, 8);
  }
  // per-triangle box-projected UVs (STL has none); u,v are in units of `mm` per texture tile
  function addUVs(geo, mm) {
    var p = geo.attributes.position.array, uv = new Float32Array((p.length / 3) * 2);
    for (var f = 0; f < p.length; f += 9) {
      var ux = p[f + 3] - p[f], uy = p[f + 4] - p[f + 1], uz = p[f + 5] - p[f + 2];
      var vx = p[f + 6] - p[f], vy = p[f + 7] - p[f + 1], vz = p[f + 8] - p[f + 2];
      var nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
      for (var k = 0; k < 3; k++) {
        var o = f + k * 3, x = p[o], y = p[o + 1], z = p[o + 2], a, b;
        if (nz >= nx && nz >= ny) { a = x; b = y; } else if (ny >= nx) { a = x; b = z; } else { a = y; b = z; }
        uv[((f / 3) + k) * 2] = a / mm; uv[((f / 3) + k) * 2 + 1] = b / mm;
      }
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  function HelmetViewer(container, opts) {
    this.el = container;
    this.opts = opts || {};
    this.ready = false;
    this.active = true;
    this.state = { color: '#e9edf2', killed: false, hud: true, connected: true, sensors: true, lost: false, rear: 'blink', signal: null };
    this.meshes = {};
    this.explode = 0; this.explodeTarget = 0;
    this.killPress = 0; this.killPressTarget = 0;
    this.sph = { theta: 0.95, phi: 1.2, r: 520, tTheta: 0.95, tPhi: 1.2, tR: 520 };
    this.autoRotate = true; this.lastInteract = 0;
    this.hotspotEls = {};
    this.hover = null;
    this._init();
  }

  HelmetViewer.prototype._init = function () {
    var self = this, el = this.el;
    var renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'gl';
    el.appendChild(renderer.domElement);

    var scene = this.scene = new THREE.Scene();
    var cam = this.camera = new THREE.PerspectiveCamera(32, 1, 20, 4000);

    // lighting + generated studio environment (soft boxes) for glossy shell reflections
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3140, 0.35));
    var key = new THREE.DirectionalLight(0xfff4e6, 1.0); key.position.set(300, 520, 240);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -300; key.shadow.camera.right = 300; key.shadow.camera.top = 300; key.shadow.camera.bottom = -300;
    key.shadow.camera.near = 100; key.shadow.camera.far = 1500;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 1.6; key.shadow.radius = 4;
    scene.add(key);
    var rim = new THREE.DirectionalLight(0x9fdcff, 0.8); rim.position.set(-380, 220, -300); scene.add(rim);
    var fill = new THREE.DirectionalLight(0xffd7b0, 0.25); fill.position.set(-200, 60, 380); scene.add(fill);
    try {
      // studio environment: dim room, large soft boxes, a strip light and a bounce floor, for believable reflections
      var c = document.createElement('canvas'); c.width = 1024; c.height = 512;
      var g = c.getContext('2d');
      var grad = g.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, '#5c6880'); grad.addColorStop(.42, '#2a313f'); grad.addColorStop(.5, '#1b2029'); grad.addColorStop(.62, '#2b2926'); grad.addColorStop(1, '#4a463f');
      g.fillStyle = grad; g.fillRect(0, 0, 1024, 512);
      var box = function (x, y, w, h, col, blur) {
        g.save(); g.shadowColor = col; g.shadowBlur = blur; g.fillStyle = col; g.fillRect(x, y, w, h); g.restore();
      };
      box(120, 70, 200, 110, '#ffffff', 36);      // big key softbox
      box(600, 90, 90, 150, '#fff2e0', 30);       // warm side panel
      box(860, 60, 40, 210, '#cfe9ff', 26);       // cool strip
      box(440, 20, 150, 36, '#ffffff', 22);       // overhead
      box(20, 210, 16, 120, '#ffffff', 18);       // wrap-around edge strip
      var tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping; tex.encoding = THREE.sRGBEncoding;
      var pm = new THREE.PMREMGenerator(renderer);
      this.env = pm.fromEquirectangular(tex).texture;
      scene.environment = this.env;
      pm.dispose();
    } catch (e) { /* env is a nicety */ }

    // soft contact shadow
    var sc = document.createElement('canvas'); sc.width = sc.height = 128;
    var sg = sc.getContext('2d'); var rg = sg.createRadialGradient(64, 64, 4, 64, 64, 64);
    rg.addColorStop(0, 'rgba(0,0,0,.55)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = rg; sg.fillRect(0, 0, 128, 128);
    var shadow = this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -150; scene.add(shadow);
    // real cast shadow of the helmet on the floor
    var floor = this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.ShadowMaterial({ opacity: 0.32 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -149.5; floor.receiveShadow = true; scene.add(floor);

    this.root = new THREE.Group();           // Z-up CAD space -> Y-up scene
    this.root.rotation.x = -Math.PI / 2;
    this.pivot = new THREE.Group(); this.pivot.add(this.root); scene.add(this.pivot);
    this.pivot.position.y = 0;

    var peel = speckleTex(256, 1400, 1.5, 4, 11), foam = speckleTex(256, 520, 3, 9, 23), grain = speckleTex(128, 500, 1, 3, 37), weave = webbingTex();
    var aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);
    peel.anisotropy = foam.anisotropy = grain.anisotropy = aniso;
    this.mats = {
      shell: new THREE.MeshPhysicalMaterial({ color: this.state.color, roughness: 0.3, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.35, bumpMap: peel, bumpScale: 0.35, side: THREE.DoubleSide }),
      liner: new THREE.MeshStandardMaterial({ color: 0x23272f, roughness: 0.97, metalness: 0, bumpMap: foam, bumpScale: 2.2, side: THREE.DoubleSide }),
      pad:   new THREE.MeshStandardMaterial({ color: 0x2f353f, roughness: 1, metalness: 0, bumpMap: foam, bumpScale: 1.6, side: THREE.DoubleSide }),
      strap: new THREE.MeshStandardMaterial({ color: 0x0d0f13, roughness: 0.88, metalness: 0, envMapIntensity: 0.35, bumpMap: weave, bumpScale: 3, side: THREE.DoubleSide }),
      trim:  new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.55, metalness: 0.2, envMapIntensity: 0.6, bumpMap: grain, bumpScale: 0.8 }),
      dark:  new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.4, metalness: 0.5 }),
      kill:  new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.32, metalness: 0.75, emissive: 0x000000, emissiveIntensity: 0, envMapIntensity: 0.9 }),
      ledL:  new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff1414, emissiveIntensity: 1.4, roughness: 0.3 }),
      ledR:  new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff1414, emissiveIntensity: 1.4, roughness: 0.3 }),
      visor: new THREE.MeshPhysicalMaterial({ color: 0x05080f, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.72, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.7, depthWrite: false })
    };

    this._buildHudPlane();
    this._bindControls();
    this._resizeObs = new ResizeObserver(function () { self.resize(); });
    this._resizeObs.observe(el);
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  };

  HelmetViewer.prototype.load = function () {
    var self = this;
    var names = Object.keys(PARTS);
    return Promise.all(names.map(function (n) {
      return window.STL.loadPart(n).then(function (buf) { return [n, window.STL.toGeometry(buf, PARTS[n].smooth)]; });
    })).then(function (list) {
      var box = new THREE.Box3();
      list.forEach(function (pair) {
        var n = pair[0], geo = pair[1];
        addUVs(geo, { shell: 34, liner: 22, pad: 22, strap: 10, trim: 18 }[PARTS[n].mat] || 30);
        var mesh = new THREE.Mesh(geo, self.mats[PARTS[n].mat]);
        mesh.name = n;
        mesh.castShadow = PARTS[n].mat !== 'visor' && PARTS[n].mat !== 'ledL' && PARTS[n].mat !== 'ledR';
        mesh.receiveShadow = PARTS[n].mat !== 'visor';
        if (n === 'visor') mesh.renderOrder = 2;
        self.root.add(mesh); self.meshes[n] = mesh;
        if (n === 'helmet_shell') box.copy(geo.boundingBox);
      });
      var ctr = new THREE.Vector3(); box.getCenter(ctr);
      self.root.position.set(-ctr.x, -ctr.z, ctr.y); // centre in scene (Z-up -> Y-up after rotation)
      var kh = new THREE.Mesh(new THREE.SphereGeometry(11, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      kh.position.set(HD.kill.pos[0], HD.kill.pos[1], HD.kill.pos[2]).sub(KILL_N.clone().multiplyScalar(4));
      kh.name = 'kill_hit'; kh.userData.base = kh.position.clone(); self.root.add(kh); self.meshes.kill_hit = kh;
      self.ready = true;
      self._applyState();
      self._buildHotspots();
      if (self.opts.onReady) self.opts.onReady();
    });
  };

  HelmetViewer.prototype._buildHudPlane = function () {
    // HUD projection preview: a strip that hugs the slim eye-level visor and shows the live HUD canvas.
    var A = 155, B = 120, C = 108, SX = 1.035, SY = 1.06, TH = 36, P0 = -11, P1 = 8;
    var pw = function (x, e) { return (x < 0 ? -1 : 1) * Math.pow(Math.abs(x), e); };
    var geo = new THREE.PlaneGeometry(1, 1, 32, 8);
    var p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var u = p.getX(i) + 0.5, v = p.getY(i) + 0.5;
      var th = (u * 2 - 1) * TH * Math.PI / 180, ph = (P0 + v * (P1 - P0)) * Math.PI / 180;
      var cp = Math.cos(ph);
      p.setXYZ(i, A * pw(cp, 0.9) * pw(Math.cos(th), 0.9) * SX + 3.5, C * pw(cp, 0.9) * pw(Math.sin(th), 0.9) * SY, B * pw(Math.sin(ph), 0.85));
    }
    geo.computeVertexNormals();
    var tex = this.hudTex = new THREE.CanvasTexture(document.createElement('canvas'));
    tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 4;
    this.hudMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.hudPlane = new THREE.Mesh(geo, this.hudMat);
    this.hudPlane.renderOrder = 3;
    this.root.add(this.hudPlane);
  };

  HelmetViewer.prototype.setHudCanvas = function (canvas) {
    this.hudTex.image = canvas; this.hudTex.needsUpdate = true;
  };
  HelmetViewer.prototype.refreshHud = function () { this.hudTex.needsUpdate = true; };

  HelmetViewer.prototype.setState = function (patch) {
    for (var k in patch) this.state[k] = patch[k];
    if (patch.killed !== undefined) this.killPressTarget = patch.killed ? 1 : 0;
    this._applyState();
  };

  HelmetViewer.prototype._applyState = function () {
    var s = this.state;
    this.mats.shell.color.set(s.color);
    var dark = new THREE.Color(s.color).getHSL({}).l < 0.12;   // near-black reads as a matte finish
    this.mats.shell.roughness = dark ? 0.62 : 0.32;
    this.mats.shell.clearcoat = dark ? 0.15 : 1;
    this.mats.shell.envMapIntensity = dark ? 0.45 : 1.35;
    var on = !s.killed;
    this.mats.visor.opacity = on ? 0.66 : 0.88;
    this.mats.visor.color.set(on ? 0x060b14 : 0x020306);
    this.hudPlane.visible = on && s.hud;
    // rear light stays on regardless of the kill switch (pattern and colour are set every frame)
    this.mats.dark.color.set(s.sensors && on ? 0x15181e : 0x0b0c0f);
    this.mats.kill.color.set(s.killed ? 0x7a1a20 : 0x3a3f48);   // cap tints red once pressed (off)
  };

  HelmetViewer.prototype.partNames = function () { return Object.keys(PARTS); };
  HelmetViewer.prototype.setPartVisible = function (name, vis) {
    var m = this.meshes[name]; if (!m) return;
    m.visible = vis;
    if (name === 'visor') { this.state.hud = vis; this._applyState(); }
    if (name === 'kill_switch' && this.meshes.kill_hit) this.meshes.kill_hit.visible = vis;
  };

  HelmetViewer.prototype.setExplode = function (on) {
    var s = this.sph;
    if (on && !this.explodeTarget) { this._r0 = s.tR; s.tR = Math.min(1900, s.tR * 1.35); }   // pull back so the parts fit
    else if (!on && this.explodeTarget && this._r0) { s.tR = this._r0; }
    this.explodeTarget = on ? 1 : 0;
  };

  HelmetViewer.prototype.resetView = function () {
    var s = this.sph; s.tTheta = 0.95; s.tPhi = 1.2; s.tR = this._fitRadius(); this.autoRotate = true; this._userZoomed = false;
  };
  HelmetViewer.prototype.view = function (name) {
    var s = this.sph; this.autoRotate = false;
    var v = { front: [0, 1.45], right: [Math.PI / 2, 1.5], rear: [Math.PI, 1.45], top: [0.95, 0.3] }[name];
    if (!v) return;
    // snap theta to the equivalent angle nearest the current one so the camera takes the short way round
    var t = v[0], cur = s.tTheta;
    while (t - cur > Math.PI) t -= 2 * Math.PI;
    while (t - cur < -Math.PI) t += 2 * Math.PI;
    s.tTheta = t; s.tPhi = v[1];
  };

  HelmetViewer.prototype.setActive = function (a) { this.active = a; if (a) this.resize(); };

  HelmetViewer.prototype._fitRadius = function () {
    var w = this.el.clientWidth || 600, h = this.el.clientHeight || 500;
    var aspect = w / h;
    return Math.max(640, 410 / (0.46 * aspect));
  };

  HelmetViewer.prototype.resize = function () {
    var w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%'; this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    if (w > 900) this.camera.setViewOffset(w, h, 60, 0, w, h);   // nudge the model left of the STL parts panel
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    // keep the model framed as the container changes size, until the visitor zooms by hand
    if (!this._userZoomed && !this.explodeTarget) {
      this.sph.tR = this._fitRadius();
      if (!this._sized) { this.sph.r = this.sph.tR; this._sized = true; }
    }
  };

  /* ------------------------------------------------------------- interaction */
  HelmetViewer.prototype._bindControls = function () {
    var self = this, dom = this.renderer.domElement;
    var pts = {}, last = null, moved = 0, down = null;
    var ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

    function ptrCount() { return Object.keys(pts).length; }
    function pinchDist() { var k = Object.keys(pts); var a = pts[k[0]], b = pts[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }

    dom.addEventListener('pointerdown', function (e) {
      dom.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      last = { x: e.clientX, y: e.clientY }; moved = 0; down = { x: e.clientX, y: e.clientY };
      self.autoRotate = false; self.lastInteract = performance.now();
      if (ptrCount() === 2) self._pinch0 = pinchDist();
    });
    dom.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) { self._hoverAt(e); return; }
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (ptrCount() === 2) {
        var d = pinchDist();
        self.sph.tR = Math.max(450, Math.min(1900, self.sph.tR * (self._pinch0 / d))); self._userZoomed = true;
        self._pinch0 = d; return;
      }
      var dx = e.clientX - last.x, dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      last = { x: e.clientX, y: e.clientY };
      self.sph.tTheta -= dx * 0.008;
      self.sph.tPhi = Math.max(0.15, Math.min(Math.PI - 0.35, self.sph.tPhi - dy * 0.008));
    });
    function up(e) {
      delete pts[e.pointerId];
      if (moved < 6 && down && ptrCount() === 0) self._pick(e);
      down = null;
    }
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', function (e) { delete pts[e.pointerId]; });
    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      self.sph.tR = Math.max(450, Math.min(1900, self.sph.tR * (1 + e.deltaY * 0.0012)));
      self.autoRotate = false; self._userZoomed = true;
    }, { passive: false });
    dom.addEventListener('dblclick', function () { self.resetView(); });

    this._ray = ray; this._ndc = ndc;
  };

  HelmetViewer.prototype._rayHit = function (e, names) {
    var r = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    var objs = names.map(function (n) { return this.meshes[n]; }, this).filter(Boolean);
    var hit = this._ray.intersectObjects(objs, false);
    return hit.length ? hit[0].object.name : null;
  };

  HelmetViewer.prototype._hoverAt = function (e) {
    if (!this.ready) return;
    var h = this._rayHit(e, ['kill_switch', 'kill_button', 'kill_hit']);
    if (h) h = 'kill_switch';
    this.hover = h;
    this.renderer.domElement.style.cursor = h ? 'pointer' : 'grab';
  };

  HelmetViewer.prototype._pick = function (e) {
    if (!this.ready) return;
    var h = this._rayHit(e, ['kill_switch', 'kill_button', 'kill_hit']);
    if ((h === 'kill_switch' || h === 'kill_button' || h === 'kill_hit') && this.opts.onKill) this.opts.onKill();
  };

  /* ------------------------------------------------------------- hotspots */
  HelmetViewer.prototype._buildHotspots = function () {
    var self = this;
    this.hsLayer = document.createElement('div'); this.hsLayer.className = 'hotspots';
    this.el.appendChild(this.hsLayer);
    HOTSPOTS.forEach(function (h) {
      var b = document.createElement('button');
      b.className = 'hotspot' + (h.id === 'kill' ? ' danger' : '');
      b.setAttribute('aria-label', h.label);
      b.innerHTML = '<span class="dot"></span><span class="tag">' + h.label + '</span>';
      b.addEventListener('click', function (ev) { ev.stopPropagation(); if (self.opts.onHotspot) self.opts.onHotspot(h.id, h.label); });
      self.hsLayer.appendChild(b);
      self.hotspotEls[h.id] = b;
    });
  };

  HelmetViewer.prototype.showHotspots = function (v) { if (this.hsLayer) this.hsLayer.style.display = v ? '' : 'none'; };

  HelmetViewer.prototype._updateHotspots = function () {
    if (!this.hsLayer) return;
    var w = this.el.clientWidth, h = this.el.clientHeight;
    var camPos = this.camera.position, v = new THREE.Vector3(), n = new THREE.Vector3(), toCam = new THREE.Vector3();
    var e = this.explode;
    HOTSPOTS.forEach(function (hs) {
      var part = { visor: 'visor', kill: 'kill_switch', sensor: 'sensor', audio: 'straps', led: 'led_left' }[hs.id];
      var ex = PARTS[part].explode;
      v.set(hs.pos[0] + ex[0] * e, hs.pos[1] + ex[1] * e, hs.pos[2] + ex[2] * e);
      v.applyMatrix4(this.root.matrixWorld);
      n.set(hs.n[0], hs.n[1], hs.n[2]).transformDirection(this.root.matrixWorld);
      toCam.copy(camPos).sub(v).normalize();
      var facing = n.dot(toCam);
      v.project(this.camera);
      var el = this.hotspotEls[hs.id];
      var x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      var shown = facing > 0.12 && this.meshes[part] && this.meshes[part].visible;
      el.style.opacity = shown ? 1 : 0;
      el.style.pointerEvents = shown ? 'auto' : 'none';
    }, this);
  };

  /* ------------------------------------------------------------- loop */
  HelmetViewer.prototype._loop = function (t) {
    requestAnimationFrame(this._loop);
    if (!this.active || !this.ready) return;
    var s = this.sph;
    if (this.autoRotate && !this.opts.noAuto) s.tTheta += 0.0035;
    s.theta += (s.tTheta - s.theta) * 0.12;
    s.phi += (s.tPhi - s.phi) * 0.12;
    s.r += (s.tR - s.r) * 0.12;
    var sinP = Math.sin(s.phi);
    this.camera.position.set(s.r * sinP * Math.cos(s.theta), s.r * Math.cos(s.phi), s.r * sinP * Math.sin(s.theta));
    this.camera.lookAt(0, 8, 0);

    // exploded view + kill-button press animation
    this.explode += (this.explodeTarget - this.explode) * 0.1;
    this.killPress += (this.killPressTarget - this.killPress) * 0.25;
    for (var n in this.meshes) {
      if (!PARTS[n]) continue;
      var ex = PARTS[n].explode, m = this.meshes[n];
      m.position.set(ex[0] * this.explode, ex[1] * this.explode, ex[2] * this.explode);
    }
    this.meshes.kill_button.position.add(KILL_N.clone().multiplyScalar(-1.4 * this.killPress));   // push the cap in
    if (this.meshes.kill_hit) this.meshes.kill_hit.position.copy(this.meshes.kill_hit.userData.base).add(this.meshes.kill_switch.position);
    this.hudPlane.position.set(PARTS.visor.explode[0] * this.explode, 0, PARTS.visor.explode[2] * this.explode);
    this.hudPlane.position.x += 4 * this.explode;

    // gentle LED pulse, kill-switch hover glow
    var pulse = 1.1 + 0.5 * Math.sin(t * 0.004);
    var rl = this.state.rear, sig = this.state.signal;
    var tail = rl === 'off' ? 0 : rl === 'steady' ? 2.2 : (Math.floor(t / 450) % 2 === 0 ? 3.0 : 0.15);
    var flash = Math.floor(t / 380) % 2 === 0;
    [['left', this.mats.ledL], ['right', this.mats.ledR]].forEach(function (p) {
      var m = p[1];
      if (sig === p[0]) { m.emissive.set(0xffa51a); m.emissiveIntensity = flash ? 3.6 : 0.1; }   // amber turn signal, flashing
      else { m.emissive.set(0xff1414); m.emissiveIntensity = sig && rl !== 'off' ? 2.2 : tail; }  // red tail (steady on the other side while signalling)
    });
    this.mats.kill.emissive.set(0xff2a2a);
    this.mats.kill.emissiveIntensity = this.hover === 'kill_switch' ? 0.5 : 0;   // faint glow on hover

    this.shadow.scale.setScalar(1 + this.explode * 0.15);
    this.root.updateMatrixWorld(true);
    this._updateHotspots();
    this.renderer.render(this.scene, this.camera);
  };

  window.HelmetViewer = HelmetViewer;
})();
