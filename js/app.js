/* Smart helmet prototype: companion app UI, stage controls, state (localStorage only). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ icons */
  var P = {
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    mode: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"/>',
    nav: '<path d="M3 11l19-9-9 19-2-8z"/>',
    sync: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    play: '<path d="M6 3l14 9-14 9z"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2v10"/>',
    bt: '<path d="M7 7l10 10-5 5V2l5 5L7 17"/>',
    warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'
  };
  function ic(n, extra) { return '<svg class="i" viewBox="0 0 24 24"' + (extra || '') + '>' + P[n] + '</svg>'; }

  /* ------------------------------------------------------------------ state */
  var KEY = 'helmet-proto-v1';
  var DEFAULTS = {
    paired: false, services: { strava: false, garmin: false, maps: false },
    mode: 'free', routeId: null, compact: false, audio: true, block: true, sensors: true,
    saver: false, rearLight: 'blink', autoSignal: true, imports: [], impSel: null, dest: null, recent: [], glove: false, wet: false, color: '#e9edf2', speed: 4, tab: 'mode', stage: 'helmet'
  };
  function loadState() {
    try { var raw = localStorage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (!o.mode) o.mode = 'free'; o.services = Object.assign({}, DEFAULTS.services, o.services); return Object.assign({}, DEFAULTS, o); } } catch (e) { /* storage unavailable */ }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  var S = loadState();
  var saveT;
  function save() { if (T.demo) return; clearTimeout(saveT); saveT = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }, 150); }

  // transient (not persisted): resets on refresh
  var T = { impMsg: null, signal: null, killed: false, phone: true, nav: true, sun: false, started: false, power: 1, bootUntil: 0, pan: 0, panUntil: 0, msg: null, pairing: false, connecting: null, held: 0, last: performance.now() };

  var SERVICES = {
    strava: { name: 'Strava', letter: 'S', blurb: 'Routes, segments & saved activities', imports: 2, scopes: ['Read your saved routes', 'Read segment waypoints'] },
    garmin: { name: 'Garmin Connect', letter: 'G', blurb: 'Courses & device sync', imports: 1, scopes: ['Read your courses', 'Read device list'] },
    maps:   { name: 'Phone maps', letter: 'M', blurb: 'Addresses for commuting & delivery', imports: 1, scopes: ['Read saved places', 'Read recent destinations'] }
  };
  var SWATCHES = ['#0c0d10', '#e9edf2', '#3a4150', '#2f6fe4', '#f2b705', '#2fb67c', '#ff6a3d'];

  /* ------------------------------------------------------------------ helpers */
  function toast(msg, type, ms) {
    var el = document.createElement('div'); el.className = 'toast ' + (type || ''); el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 320); }, ms || 2800);
  }
  function routeAvailable(r) { return r.source === 'helmet' || r.source === 'address' || r.source === 'import' || !!S.services[r.source]; }
  function modeRoutes() { return RIDE.ROUTES.filter(function (r) { return r.mode === S.mode; }); }
  function currentRoute() { return RIDE.ROUTES.filter(function (r) { return r.id === S.routeId; })[0] || null; }
  function ensureRoute() {
    var cur = currentRoute();
    if (cur && cur.mode === S.mode && routeAvailable(cur)) return;
    var first = modeRoutes().filter(routeAvailable)[0];
    S.routeId = first ? first.id : null;
  }
  // the address route is rebuilt from the saved destination (all local; no map service)
  var navPlan = null;
  function refreshNavRoute() {
    RIDE.ROUTES = RIDE.ROUTES.filter(function (r) { return r.id !== 'nav-custom' && r.source !== 'import'; });
    (S.imports || []).forEach(function (imp) {   // each imported file gives a waypoint-counter route and a turn-by-turn route
      try { RIDE.ROUTES.push(IMPORT.trailRoute(imp, 'imp-' + imp.id + '-trail'), IMPORT.turnRoute(imp, 'imp-' + imp.id + '-turn')); } catch (e) { /* skip a bad saved route */ }
    });
    navPlan = S.dest ? NAV.route(NAV.PLACES.home, S.dest) : null;
    if (navPlan && navPlan.ok) RIDE.ROUTES.push(navPlan.route); else navPlan = null;
  }
  function syncRide() {
    refreshNavRoute(); ensureRoute();
    ride.setRoute(currentRoute()); ride.speedMul = S.speed; T.started = false;
  }
  var fmt = function (m) { return HUD.fmtDist(m); };
  // turn signal: the rear multi-colour LED pods flash amber on one side (auto from navigation, or manual)
  function setSignal(dir, auto) {
    T.signal = dir ? { dir: dir, auto: !!auto, until: performance.now() + (auto ? 25000 : 20000) } : null;
    if (viewer) viewer.setState({ signal: dir || null });
    if ($('#qSigL')) { $('#qSigL').classList.toggle('on', dir === 'left'); $('#qSigR').classList.toggle('on', dir === 'right'); }
  }
  var MODE_NAME = { free: 'None (free ride)', trail: 'Trail', commute: 'Commuter' };

  /* ------------------------------------------------------------------ audio (stereo-panned cues) */
  var ac = null;
  function audioCtx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }
  function beep(pan, seq) {
    if (!S.audio || T.killed) return;
    var c = audioCtx(); if (!c) return;
    var t = c.currentTime;
    seq.forEach(function (f, i) {
      var o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.16); g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.14);
      o.connect(g); if (p) { p.pan.value = pan; g.connect(p); p.connect(c.destination); } else g.connect(c.destination);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.16);
    });
  }

  /* ------------------------------------------------------------------ ride engine hooks */
  var ride = new RIDE.Ride({
    onCue: function (pan, st) {
      T.pan = pan; T.panUntil = performance.now() + 1200;
      beep(pan, [880, 1175]);
      if (S.autoSignal && st && (st.kind === 'left' || st.kind === 'right')) setSignal(st.kind, true);   // rear light flashes amber toward the turn
    },
    onManeuver: function () { if (T.signal && T.signal.auto) setSignal(null); },
    onAlert: function (a) {
      if (a.kind === 'hazard') beep(0, [520, 520, 520]);
      else if (a.kind === 'missed') beep(-1, [700, 520]);
    },
    onFinish: function () { if (T.signal && T.signal.auto) setSignal(null); toast('Ride complete', 'ok'); updateStage(); renderScreen(); }
  });

  /* ------------------------------------------------------------------ HUD state */
  function navFor(st) {
    var text = { left: 'Turn left', right: 'Turn right', straight: 'Continue', uturn: 'U-turn', arrive: st.stop || 'Arrive', waypoint: 'Next waypoint' }[st.kind];
    return { kind: st.kind, text: text, dist: ride.remaining, street: st.street, house: st.house, wpName: st.wpName };
  }
  function hudState(now) {
    var st = ride.step();
    var s = {
      t: now, mode: S.mode, compact: S.compact, contrast: S.wet || T.sun, large: S.wet, power: T.power,
      booting: now < T.bootUntil, phoneOk: T.phone, navOk: T.nav || S.mode === 'free', audio: S.audio,
      battery: S.saver ? 71 : 78, saver: S.saver, idle: !T.started,
      pan: (S.audio && now < T.panUntil) ? T.pan : 0, signal: T.signal ? T.signal.dir : null, nav: null, alert: null, msg: null
    };
    if (S.mode && S.mode !== 'free' && st) s.nav = navFor(st);
    var a = ride.alert;
    if (a && (a.kind === 'hazard' || a.kind === 'missed')) s.alert = a;
    else if (S.mode && S.mode !== 'free' && T.started && !T.nav) s.alert = { kind: 'navlost', title: 'NAV LOST', sub: 'Directions paused · reconnect' };
    else if (ride.finished) s.alert = { kind: 'arrived', title: 'RIDE COMPLETE', sub: currentRoute() ? currentRoute().name : '' };
    else if (ride.dwell > 0) {
      var prev = ride.route.steps[ride.idx - 1];
      s.alert = { kind: 'arrived', title: 'ARRIVED', sub: (prev.house ? '#' + prev.house + ' ' : '') + prev.street + (prev.stop ? ' · ' + prev.stop : '') };
    }
    if (T.msg && now < T.msg.until && !S.block) s.msg = T.msg;
    return s;
  }

  /* ------------------------------------------------------------------ 3D viewer + stage */
  var viewer = null, hudCanvas = $('#hud'), edgeCanvas = $('#hudEdge');
  // the 3D visor gets its own texture (with the status chips); the rider view shows the guidance block plus edge-drawn status
  var texCanvas = document.createElement('canvas'); texCanvas.width = 1200; texCanvas.height = 420;

  function initViewer() {
    try {
      viewer = new HelmetViewer($('#gl'), {
        onKill: toggleKill,
        onReady: function () { $('#loading').classList.add('done'); buildParts(); },
        onHotspot: showInfo
      });
      window.__viewer = viewer;
      viewer.setHudCanvas(texCanvas);
      viewer.setState({ color: S.color, sensors: S.sensors });
      viewer.load().catch(function (e) { $('#loading').innerHTML = '<div>Could not load the 3D model.<br><span class="small">' + e.message + '</span></div>'; });
    } catch (e) {
      $('#loading').innerHTML = '<div>WebGL isn’t available in this browser, so the 3D helmet can’t render.<br><span class="small">Rider view and the app still work.</span></div>';
      viewer = null;
    }
  }

  var INFO = {
    visor: { t: 'Eye-level HUD visor', b: 'A slim shield over just the eyes and nose bridge, so you can still drink and the helmet stays low-profile. Shows one icon and one number at a time; switches to high contrast in bright sun or rain.', a: ['See rider view', 'stage', 'rider'] },
    kill: { t: 'Emergency kill switch', b: 'A small push button on the right side. One press powers down the display, sensors and camera immediately; press again to restore.', a: ['toggleKill'] },
    sensor: { t: 'Sensor module', b: 'Hazard and crash sensing. Can be switched off in Settings; the lens goes dark when disabled.', a: ['Open privacy settings', 'tab', 'settings'] },
    audio: { t: 'Directional audio', b: 'Open-ear speakers sit in the strap junctions beside each ear, so nothing is mounted on the outside of the shell. Cues pan left or right toward the turn.', a: null },
    led: { t: 'Rear lights (dual, multi-colour)', b: 'Two LED pods act as a red tail light, and flash amber on the left or right to signal a turn, automatically from navigation or from the app. Steady or blinking, set in Settings. They stay on when the kill switch is engaged, which only powers down the display, sensors and camera.', a: ['Rear light settings', 'tab', 'settings'] }
  };
  function showInfo(id) {
    var d = INFO[id]; if (!d) return;
    $('#infoTitle').textContent = d.t; $('#infoBody').textContent = d.b;
    var box = $('#infoAction'); box.innerHTML = '';
    if (d.a) {
      var b = document.createElement('button'); b.className = 'chipbtn' + (id === 'kill' ? ' warn on' : '');
      if (d.a[0] === 'toggleKill') { b.textContent = T.killed ? 'Re-enable helmet' : 'Engage kill switch'; b.onclick = function () { toggleKill(); showInfo('kill'); }; }
      else { b.textContent = d.a[0]; b.onclick = function () { act(d.a[1], d.a[2]); }; }
      box.appendChild(b);
    }
    $('#infocard').classList.add('on');
  }

  function setStage(which) {
    S.stage = which; save();
    $('#tabHelmet').classList.toggle('on', which === 'helmet'); $('#tabRider').classList.toggle('on', which === 'rider');
    var wide = isWide();   // big screens show the 3D model and the rider view side by side
    $('#view3d').classList.toggle('on', wide || which === 'helmet'); $('#viewRider').classList.toggle('on', wide || which === 'rider');
    if (viewer) viewer.setActive(wide || which === 'helmet');
  }
  function isWide() { return window.matchMedia('(min-width: 1500px)').matches; }
  window.matchMedia('(min-width: 1500px)').addEventListener('change', function () { setStage(S.stage); });

  var PART_LABEL = { led_left: 'Rear light, left', led_right: 'Rear light, right', helmet_shell: 'Shell', helmet_liner: 'Liner', pads: 'Comfort pads', visor: 'Eye-level visor', peak: 'Peak', straps: 'Chin straps', buckle: 'Buckle', kill_switch: 'Kill switch base', kill_button: 'Kill switch button', sensor: 'Sensor', led: 'Rear light', dial: 'Fit dial' };
  function buildParts() {
    if (!viewer) return;
    $('#partsList').innerHTML = viewer.partNames().map(function (n) {
      return '<div class="partrow"><label><input type="checkbox" data-part="' + n + '" checked>' + (PART_LABEL[n] || n) + '</label><a href="models/' + n + '.stl" download title="Download ' + n + '.stl">STL</a></div>';
    }).join('');
    if (isWide()) $('#parts').open = true;
  }

  function updateStage() {
    var r = currentRoute();
    $('#playBtn').innerHTML = (ride.playing ? ic('pause') : ic('play')) + (ride.playing ? 'Pause' : (T.started && !ride.finished ? 'Resume' : 'Play ride'));
    var free = S.mode === 'free';
    $('#rideName').textContent = free ? 'Free ride · no route' : r ? r.name : 'No route selected';
    $('#rideLeft').textContent = free ? (ride.playing ? 'Riding' : 'Ready') : r ? (ride.finished ? 'Complete' : fmt(ride.remainingTotal()) + ' left') : '—';
    $('#rideBar').style.width = (ride.progress() * 100).toFixed(1) + '%';
    var k = $('#killBtn');
    k.classList.toggle('engaged', T.killed); k.setAttribute('aria-pressed', T.killed);
    k.innerHTML = ic('power') + '<span>' + (T.killed ? 'HELMET OFF' : 'KILL SWITCH') + '<small>' + (T.killed ? 'Tap to re-enable' : 'Emergency: display, sensors &amp; camera off') + '</small></span>';
    var pill = $('#stagePill'), txt = $('#stagePillText'), cls = 'pill', msg;
    if (T.killed) { cls += ' bad'; msg = 'Helmet off · kill switch'; }
    else if (!T.phone || (!T.nav && !free)) { cls += ' warn'; msg = !T.phone && !T.nav && !free ? 'Phone + nav lost' : !T.phone ? 'Phone lost' : 'Nav app lost'; }
    else if (!S.paired) { cls += ' warn'; msg = 'Not paired · demo'; }
    else { cls += ' ok'; msg = 'Connected · ' + (free ? 'Free ride' : (MODE_NAME[S.mode] || 'no mode')); }
    pill.className = cls; txt.textContent = msg;
    var rd = $('#rider');
    rd.classList.toggle('sun', T.sun); rd.classList.toggle('wet', S.wet); rd.classList.toggle('dim', T.killed);
    rd.classList.toggle('moving', ride.playing && (T.nav || free) && !ride.finished && ride.dwell <= 0);
    rd.dataset.env = S.mode === 'trail' ? 'trail' : 'city';
    $('#qSun').classList.toggle('on', T.sun); $('#qWet').classList.toggle('on', S.wet);
    $('#qNav').hidden = free;   // no nav app involved in free ride
    $('#qPhone').classList.toggle('on', !T.phone); $('#qNav').classList.toggle('on', !T.nav);
    $('#qPhone').lastChild.textContent = T.phone ? 'Drop phone' : 'Reconnect phone';
    $('#qNav').lastChild.textContent = T.nav ? 'Drop nav app' : 'Reconnect nav app';
    if (viewer) viewer.setState({ killed: T.killed, rear: S.rearLight, sensors: S.sensors, color: S.color, signal: T.signal ? T.signal.dir : null });
    $('#qSigL').classList.toggle('on', !!T.signal && T.signal.dir === 'left'); $('#qSigR').classList.toggle('on', !!T.signal && T.signal.dir === 'right');
    var ex = $('#explodeBtn'); if (ex) ex.classList.toggle('on', !!ex._on);
  }

  var skylineMode = null;
  function drawSkyline() {
    var mode = S.mode === 'trail' ? 'trail' : 'city';
    if (skylineMode === mode) return; skylineMode = mode;
    var seed = 7, rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    var svg = $('#skyline'), out = '';
    if (mode === 'city') {
      var x = -10;
      while (x < 1210) {
        var w = 50 + rnd() * 90, h = 40 + rnd() * 90;
        out += '<rect x="' + x + '" y="' + (140 - h) + '" width="' + w + '" height="' + h + '" fill="' + (rnd() > .5 ? '#6b7a93' : '#7d8ca6') + '"/>';
        for (var wy = 140 - h + 10; wy < 130; wy += 16) for (var wx = x + 8; wx < x + w - 10; wx += 18) if (rnd() > .55) out += '<rect x="' + wx + '" y="' + wy + '" width="7" height="8" fill="#d8e4f5" opacity=".6"/>';
        x += w + 4;
      }
    } else {
      out += '<path d="M0 140 L0 90 Q150 30 300 85 T620 70 T920 85 T1200 60 L1200 140z" fill="#7d9a86"/>';
      for (var t = 0; t < 40; t++) { var tx = rnd() * 1200, th = 40 + rnd() * 60; out += '<path d="M' + tx + ' 140 L' + (tx + 16) + ' ' + (140 - th) + ' L' + (tx + 32) + ' 140z" fill="#2f5a3a"/>'; }
    }
    svg.innerHTML = out;
  }

  /* ------------------------------------------------------------------ actions */
  function toggleKill() {
    T.killed = !T.killed;
    if (T.killed) { ride.playing = false; toast('Kill switch engaged — display, sensors and camera are off', 'bad'); }
    else { T.bootUntil = performance.now() + 1700; toast('Helmet re-enabled', 'ok'); beep(0, [660, 990]); }
    updateStage(); renderScreen();
  }

  var actions = {
    tab: function (a) { if (a === 'sync') a = 'mode'; S.tab = a; save(); renderScreen(true); },
    stage: function (a) { setStage(a); },
    explode: function () { var b = $('#explodeBtn'); b._on = !b._on; if (viewer) viewer.setExplode(b._on); updateStage(); },
    view: function (a) { if (!viewer) return; if (a === 'reset') viewer.resetView(); else viewer.view(a); },
    closeinfo: function () { $('#infocard').classList.remove('on'); },
    color: function (a) { S.color = a; save(); drawSwatches(); updateStage(); },
    kill: toggleKill,

    play: function () {
      if (T.killed) return toast('Helmet is off — re-enable it first', 'bad');
      if (!S.mode) { toast('Choose a riding mode first'); return actions.tab('mode'); }
      if (ride.finished) { ride.reset(); }
      T.started = true; ride.playing = !ride.playing;
      if (ride.playing) setStage('rider');
      if (ride.playing && !S.paired) toast('Demo mode: helmet not paired yet', '', 2200);
      updateStage();
    },
    next: function () {
      if (T.killed) return toast('Helmet is off — re-enable it first', 'bad');
      if (S.mode === 'free') return toast('Free ride has no route events. Pick Trail or Commuter to try alerts.');
      if (ride.finished) ride.reset();
      T.started = true; ride.skip(); setStage('rider'); updateStage();
    },
    restart: function () { ride.reset(); if (T.signal && T.signal.auto) setSignal(null); T.started = false; updateStage(); toast('Ride restarted'); },
    startRide: function () { if (!S.mode) { toast('Choose a riding mode first'); return actions.tab('mode'); } if (ride.finished) ride.reset(); ride.playing = false; actions.play(); },
    sun: function () { T.sun = !T.sun; toast(T.sun ? 'Bright sun: HUD switched to high contrast' : 'Normal light'); updateStage(); },
    wet: function () { S.wet = !S.wet; save(); toast(S.wet ? 'Wet-weather mode: larger, higher-contrast HUD' : 'Wet-weather mode off'); updateStage(); renderScreen(); },
    notif: function () {
      if (T.killed) return;
      if (!T.phone) return toast('Phone is disconnected — no notifications', 'bad');
      T.msg = { title: 'Sam: running late', sub: 'Can you grab the 412 drop?', until: performance.now() + 4500 };
      toast(S.block ? 'Message held back — notifications are blocked on the HUD' : 'Message shown on HUD');
      if (!S.block) beep(0, [988]);
    },
    dropPhone: function () { T.phone = !T.phone; toast(T.phone ? 'Phone reconnected' : 'Phone disconnected', T.phone ? 'ok' : 'bad'); updateStage(); renderScreen(); },
    dropNav: function () { T.nav = !T.nav; toast(T.nav ? 'Navigation app reconnected' : 'Navigation app disconnected', T.nav ? 'ok' : 'bad'); updateStage(); renderScreen(); },

    mode: function (a) {
      S.mode = a; syncRide(); save();
      toast((a === 'trail' ? 'Trail' : a === 'free' ? 'None (free ride)' : 'Commuter / Delivery') + ' mode active', 'ok'); updateStage(); renderScreen();
    },
    route: function (a) {
      var r = RIDE.ROUTES.filter(function (x) { return x.id === a; })[0];
      if (!routeAvailable(r)) { toast('Connect ' + RIDE.SOURCE_LABEL[r.source] + ' in Settings \u2192 Integrations to unlock this route'); S.tab = 'settings'; save(); renderScreen(true); var sec = $('#integrations'); if (sec) sec.scrollIntoView({ block: 'start' }); return; }
      S.routeId = a; syncRide(); save(); updateStage(); renderScreen();
    },
    speed: function (a) { S.speed = +a; ride.speedMul = S.speed; save(); renderScreen(); },
    signal: function (a) {
      if (T.signal && T.signal.dir === a) { setSignal(null); toast('Turn signal off'); }
      else { setSignal(a, false); toast('Rear light: flashing amber ' + a); }
    },
    rear: function (a) { S.rearLight = a; save(); updateStage(); renderScreen(); toast('Rear light: ' + { off: 'off', steady: 'steady red', blink: 'blinking red' }[a] + ' (both pods)'); },
    compact: function (a) { S.compact = a === 'on'; save(); renderScreen(); },

    pair: function () {
      if (T.pairing) return;
      T.pairing = true; renderScreen();
      setTimeout(function () { T.pairing = false; S.paired = true; save(); toast('Helmet paired', 'ok'); beep(0, [660, 880]); updateStage(); renderScreen(); }, 2300);
    },
    unpair: function () { S.paired = false; S.mode = 'free'; syncRide(); save(); updateStage(); renderScreen(); },
    connect: function (a) { openSheet(connectSheet(a)); },
    allow: function (a) {
      openSheet(progressSheet(a));
      var cur = S;
      setTimeout(function () {
        if (S !== cur) { closeSheet(); return; }   // the demo was stopped or the state was restored meanwhile
        S.services[a] = true; ensureRoute(); ride.setRoute(currentRoute()); save(); closeSheet();
        toast(SERVICES[a].name + ' connected · ' + SERVICES[a].imports + ' route' + (SERVICES[a].imports > 1 ? 's' : '') + ' imported', 'ok');
        updateStage(); renderScreen();
      }, 1400);
    },
    disconnect: function (a) { S.services[a] = false; syncRide(); save(); toast(SERVICES[a].name + ' disconnected'); updateStage(); renderScreen(); },
    closeSheet: closeSheet,
    askReset: function () { openSheet('<div class="grab"></div><h3>Reset prototype?</h3><p class="muted">Clears pairing, connected apps, mode and settings saved in this browser.</p><div class="swrow"><button class="btn" data-act="closeSheet">Cancel</button><button class="btn danger" data-act="doReset">Reset</button></div>'); },
    theme: function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next); try { localStorage.setItem('helmet-theme', next); } catch (e) { }
    },
    demoToggle: function () { if (T.demo) { demoAuto = false; stopDemo(); } else { demoAuto = true; startDemo(); } },
    demoStop: function () { stopDemo(); },
    navSelect: function (a) { var it = lastSug[+a]; if (it) setDestination(it.addr, it.place ? it.label : null); },
    navPlace: function (a) { var p = NAV.PLACES[a]; if (p) setDestination(p, p.name); },
    impSample: function () { addImport(Promise.resolve().then(function () { var r = IMPORT.parseGPX(IMPORT.sampleGPX()); return IMPORT.buildTrack(r, r.name || 'Sample loop', 'GPX'); })); },
    impSelect: function (a) { S.impSel = a; save(); renderScreen(); },
    impRemove: function (a) {
      S.imports = (S.imports || []).filter(function (i) { return i.id !== a; });
      if (S.impSel === a) S.impSel = null;
      refreshNavRoute(); ensureRoute(); ride.setRoute(currentRoute()); T.started = false; save(); updateStage(); renderScreen(); toast('Route removed');
    },
    impRide: function (a) {
      var imp = impById(S.impSel); if (!imp) return;
      S.mode = a === 'trail' ? 'trail' : 'commute'; S.routeId = 'imp-' + imp.id + '-' + a;
      syncRide(); save(); updateStage();
      actions.startRide();
    },
    navClear: function () { S.dest = null; save(); refreshNavRoute(); ensureRoute(); ride.setRoute(currentRoute()); updateStage(); renderScreen(); },
    navStart: function () {
      if (!navPlan) return;
      if (S.mode !== 'commute') { S.mode = 'commute'; toast('Commuter / Delivery mode selected for address navigation'); }
      S.routeId = 'nav-custom'; syncRide(); save(); updateStage();
      actions.startRide();
    },
    doReset: function () { try { localStorage.removeItem(KEY); } catch (e) { } location.reload(); }
  };

  // the helmet inverts with the theme: black on the light theme, white on the dark one.
  // Other finishes (blue, yellow...) are left alone.
  var HELMET_BLACK = '#0c0d10', HELMET_WHITE = '#e9edf2';
  function themeHelmetColor(t) { return t === 'dark' ? HELMET_WHITE : HELMET_BLACK; }
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    var b = $('#themeBtn'); if (b) b.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
    if (S.color === HELMET_BLACK || S.color === HELMET_WHITE) {
      S.color = themeHelmetColor(t); save();
      if ($('#swatches')) { drawSwatches(); updateStage(); }
    }
  }

  function act(name, arg) { if (actions[name]) actions[name](arg); }

  /* sheets */
  var sheetT;
  function openSheet(html) {
    var s = $('#sheet'); clearTimeout(sheetT);
    s.innerHTML = html; s.hidden = false; void s.offsetHeight;   // un-hide first so the slide-up still animates
    s.classList.add('on'); $('#sheetBack').classList.add('on');
  }
  function closeSheet() {
    var s = $('#sheet'); s.classList.remove('on'); $('#sheetBack').classList.remove('on');
    // once it has slid away, remove it entirely so a paused or interrupted transition can never leave it showing
    clearTimeout(sheetT); sheetT = setTimeout(function () { if (!s.classList.contains('on')) { s.hidden = true; s.innerHTML = ''; } }, 350);
  }
  function connectSheet(k) {
    var s = SERVICES[k];
    return '<div class="grab"></div><h3>Connect ' + s.name + '</h3><p class="muted small">Only your routes are read, so they can appear on your visor. No new account needed; you keep using ' + s.name + ' as you do today.</p>' +
      '<ul class="perm">' + s.scopes.map(function (x) { return '<li>' + ic('check') + x + '</li>'; }).join('') + '</ul>' +
      '<p class="muted small">Simulated for the prototype — no sign-in, nothing leaves your browser.</p>' +
      '<div class="swrow"><button class="btn" data-act="closeSheet">Cancel</button><button class="btn primary" data-act="allow" data-arg="' + k + '">Allow</button></div>';
  }
  function progressSheet(k) {
    return '<div class="grab"></div><h3>Connecting to ' + SERVICES[k].name + '…</h3><p class="muted small">Importing routes</p><div class="progress-ind"><i></i></div>';
  }

  /* ------------------------------------------------------------------ screens */
  function pillFor(ok, yes, no) { return '<span class="pill ' + (ok ? 'ok' : 'warn') + '"><span class="d"></span>' + (ok ? yes : no) + '</span>'; }

  function banners() {
    var b = '';
    if (T.killed) b += '<div class="banner bad">' + ic('power') + 'Helmet is off (kill switch). Display, sensors and camera are disabled.</div>';
    if (!T.phone) b += '<div class="banner">' + ic('warn') + 'Phone disconnected — notifications paused.</div>';
    if (!T.nav && S.mode !== 'free') b += '<div class="banner">' + ic('warn') + 'Navigation app disconnected — directions paused.</div>';
    return b;
  }

  function screenHome() {
    var r = currentRoute(), apps = Object.keys(S.services).filter(function (k) { return S.services[k]; }).map(function (k) { return SERVICES[k].name; });
    var html = banners() + '<h1 class="t">Ready to ride</h1><p class="sub">Glance-readable directions on your visor.</p>' +
      '<div class="pcard hero"><div class="row"><div class="grow"><b style="font-size:17px">Helmet</b><div class="small muted">' + (S.paired ? 'Connected over Bluetooth' : 'Not paired') + '</div></div>' + pillFor(S.paired, 'Paired', 'Not paired') + '</div>' +
      '<div class="batt"><i style="width:' + (S.saver ? 71 : 78) + '%"></i></div>' +
      '<div class="row small muted" style="margin-top:8px"><span>Battery ' + (S.saver ? 71 : 78) + '%' + (S.saver ? ' · saver on' : '') + '</span><span class="grow"></span><span>Mode: <b style="color:var(--text)">' + (MODE_NAME[S.mode] || 'None') + '</b></span></div>' +
      '<div class="small muted" style="margin-top:6px">Apps: ' + (apps.length ? apps.join(', ') : 'none connected (optional)') + '</div></div>';
    if (!S.paired) html += '<button class="btn primary" data-act="tab" data-arg="sync" style="margin-bottom:12px">' + ic('bt') + 'Pair your helmet</button>';
    html += '<h3 class="sec">Route</h3>';
    if (S.mode === 'free') html += '<div class="pcard"><b>Free ride</b><p class="small muted" style="margin:4px 0 10px">No route needed. Put the helmet on and ride anywhere; the visor stays clear. Pick Trail or Commuter in the Helmet tab, or search an address in Navigate, for directions.</p></div><h3 class="sec">Demo speed</h3><div class="seg" style="width:100%">' + [1, 4, 10].map(function (v) { return '<button style="flex:1;justify-content:center" class="' + (S.speed === v ? 'on' : '') + '" data-act="speed" data-arg="' + v + '">' + v + '×</button>'; }).join('') + '</div><button class="btn primary" style="margin-top:16px" data-act="startRide">' + ic('play') + 'Start ride</button>';
    else if (!S.mode) html += '<div class="pcard"><b>Choose a mode first</b><p class="small muted" style="margin:4px 0 10px">Trail keeps the display quiet. Commuter shows streets and house numbers.</p><button class="btn primary" data-act="tab" data-arg="mode">Choose mode</button></div>';
    else {
      html += modeRoutes().map(function (x) {
        var ok = routeAvailable(x);
        return '<button class="route ' + (S.routeId === x.id ? 'on ' : '') + (ok ? '' : 'locked') + '" data-act="route" data-arg="' + x.id + '"><span class="srcicon">' + (ok ? x.name[0] : ic('lock')) + '</span><span class="grow"><b>' + x.name + '</b><br><span class="small muted">' + x.meta + '</span></span><span class="tag">' + RIDE.SOURCE_LABEL[x.source] + '</span></button>';
      }).join('');
      html += '<h3 class="sec">Demo speed</h3><div class="seg" style="width:100%">' + [1, 4, 10].map(function (v) { return '<button style="flex:1;justify-content:center" class="' + (S.speed === v ? 'on' : '') + '" data-act="speed" data-arg="' + v + '">' + v + '×</button>'; }).join('') + '</div>';
      html += '<button class="btn primary" style="margin-top:16px" data-act="startRide">' + ic('play') + 'Start ride</button>';
    }
    return html;
  }

  function modesHTML() {
    var card = function (m, title, bullets) {
      return '<button class="mode-card ' + (S.mode === m ? 'on' : '') + '" data-act="mode" data-arg="' + m + '" data-m="' + m + '"><canvas class="prev" width="1200" height="420" data-prev="' + m + '"></canvas><h4>' + title + '<span class="check">' + ic('check') + '</span></h4><ul>' + bullets.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul></button>';
    };
    return '<h3 class="sec">Riding mode</h3><p class="small muted" style="margin:-4px 0 10px">Pick how much the visor tells you.</p>' +
      card('free', 'None · Free ride', ['Just put the helmet on and ride anywhere', 'Visor stays clear: status chips only', 'No route, app or pairing needed']) +
      card('trail', 'Trail Mode', ['Visor stays clear: only a waypoint counter', 'Alerts for missed turns and hazards', 'Lower power use']) +
      card('commute', 'Commuter / Delivery', ['Turn, distance, street name', 'House numbers highlighted for drops', 'Directional audio cues']) +
      '<h3 class="sec">HUD size</h3><div class="seg" style="width:100%"><button style="flex:1;justify-content:center" class="' + (!S.compact ? 'on' : '') + '" data-act="compact" data-arg="off">Standard</button><button style="flex:1;justify-content:center" class="' + (S.compact ? 'on' : '') + '" data-act="compact" data-arg="on">Compact</button></div>' +
      '<p class="small muted" style="margin-top:8px">Compact shrinks directions and notifications into a thin bottom strip so the road stays unobstructed.</p>';
  }

  function integrationsHTML() {
    return Object.keys(SERVICES).map(function (k) {
      var s = SERVICES[k], on = S.services[k];
      return '<div class="svc"><span class="srcicon">' + s.letter + '</span><div class="grow"><b>' + s.name + '</b><div class="small muted">' + (on ? 'Connected \u00B7 ' + s.imports + ' route' + (s.imports > 1 ? 's' : '') : s.blurb) + '</div></div>' +
        (on ? '<button class="btn" data-act="disconnect" data-arg="' + k + '">Disconnect</button>' : '<button class="btn primary" data-act="connect" data-arg="' + k + '">Connect</button>') + '</div>';
    }).join('') + '<p class="small muted">Optional. No proprietary app required; the helmet works on its own.</p>';
  }

  function screenHelmet() {
    var html = banners() + '<h1 class="t">Helmet</h1><p class="sub">Pair the helmet, then choose how it guides you.</p>' +
      '<div class="pcard"><div class="row"><div class="radar ' + (T.pairing ? 'go' : '') + '"><div class="core">' + ic('bt') + '</div></div><div class="grow"><b>Helmet</b><div class="small muted">' + (T.pairing ? 'Searching nearby\u2026' : S.paired ? 'Paired \u00B7 battery ' + (S.saver ? 71 : 78) + '%' : 'Hold the side button until the light blinks') + '</div></div>' + (S.paired ? pillFor(true, 'Paired', '') : '') + '</div>' +
      '<div style="margin-top:12px">' + (S.paired ? '<button class="btn" data-act="unpair">Unpair</button>' : '<button class="btn primary" data-act="pair" ' + (T.pairing ? 'disabled' : '') + '>' + (T.pairing ? 'Searching\u2026' : 'Search for helmet') + '</button>') + '</div></div>';
    if (!S.paired) {
      return html + '<div class="pcard muted"><b style="color:var(--text)">Riding modes</b><p class="small" style="margin:4px 0 0">The helmet starts in Free ride (no mode): just put it on and go. Pair it to choose Trail or Commuter. Routes from Strava, Garmin or phone maps can be added in Settings \u2192 Integrations.</p></div>';
    }
    return html + modesHTML();
  }

  function toggleRow(key, title, desc) {
    return '<div class="setrow"><div class="grow"><b>' + title + '</b><span>' + desc + '</span></div><label class="switch"><input type="checkbox" data-toggle="' + key + '" ' + (S[key] ? 'checked' : '') + ' aria-label="' + title + '"><span></span></label></div>';
  }
  function screenSettings() {
    return banners() + '<h1 class="t">Settings</h1><p class="sub">Safety, privacy and comfort.</p>' +
      '<div class="pcard" style="border-color:rgba(255,59,59,.5)"><div class="row"><div class="grow"><b>Emergency kill switch</b><div class="small muted">Same as the small push button on the helmet. Powers down display, sensors and camera.</div></div></div><div style="margin-top:12px"><button class="btn danger" data-act="kill" style="min-height:64px;font-size:17px">' + ic('power') + (T.killed ? 'Re-enable helmet' : 'KILL SWITCH') + '</button></div></div>' +
      '<h3 class="sec" id="integrations">Integrations</h3>' + integrationsHTML() +
      '<h3 class="sec">Alerts</h3><div class="pcard">' +
      toggleRow('audio', 'Directional audio cues', 'Cues pan left or right toward the turn.') +
      toggleRow('block', 'Block phone notifications on HUD', 'Keeps messages off the visor while riding.') + '</div>' +
      '<h3 class="sec">Display</h3><div class="pcard">' +
      toggleRow('compact', 'Compact HUD', 'Thin bottom strip; keeps the view clear.') +
      toggleRow('wet', 'Wet-weather mode', 'Larger, higher-contrast HUD. One tap.') + '</div>' +
      '<h3 class="sec">Rear light</h3><div class="pcard"><b>Rear safety light (two multi-colour pods)</b><p class="small muted" style="margin:4px 0 10px">Red tail light for riders and drivers behind you. Stays on if the kill switch is used. Turn signals flash amber on one side.</p><div class="seg" style="width:100%">' + [['blink', 'Blink'], ['steady', 'Steady'], ['off', 'Off']].map(function (o) { return '<button style="flex:1;justify-content:center" class="' + (S.rearLight === o[0] ? 'on' : '') + '" data-act="rear" data-arg="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div>' + toggleRow('autoSignal', 'Auto turn signals', 'Flash amber on the side of the next turn from navigation.') + '</div>' +
      '<h3 class="sec">Privacy &amp; power</h3><div class="pcard">' +
      toggleRow('sensors', 'Sensors &amp; camera', 'Hazard sensing. Turn off to disable the module.') +
      toggleRow('saver', 'Battery saver', 'Dimmer HUD, slower refresh. Longer off-road rides.') + '</div>' +
      '<h3 class="sec">Accessibility</h3><div class="pcard">' + toggleRow('glove', 'Large-button / glove mode', 'Bigger tap targets for thick gloves.') + '</div>' +
      '<h3 class="sec">Prototype</h3><div class="pcard"><button class="btn" data-act="askReset">Reset prototype data</button><p class="small muted" style="margin:10px 0 0">Everything is stored only in this browser (localStorage). No server, accounts or analytics.</p></div>';
  }


  /* ------------------------------------------------------------------ navigation tab */
  var lastSug = [];
  function stepText(st) {
    var t = st.kind === 'left' ? 'Turn left onto ' + st.street : st.kind === 'right' ? 'Turn right onto ' + st.street : 'Arrive at ' + (st.house ? st.house + ' ' : '') + st.street;
    return t;
  }
  /* ---- route import (.gpx / .fit) ---- */
  var impAt = null;
  function impById(id) { return (S.imports || []).filter(function (i) { return i.id === id; })[0] || null; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function impMeta(i) { return IMPORT.fmtKm(i.dist) + ' \u00B7 ' + i.fmt + (i.ascent != null ? ' \u00B7 ' + i.ascent + ' m climb' : '') + (i.wpts.length ? ' \u00B7 ' + i.wpts.length + ' waypoints' : ''); }
  function importHTML() {
    var sel = impById(S.impSel); impAt = null;
    var h = '<h3 class="sec">Import a route</h3><div class="pcard"><p class="small muted" style="margin:0 0 10px">Load a .gpx or .fit file from Strava, Garmin or a bike computer. It is read in this browser and never uploaded.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><label class="btn primary sm" for="impFile" style="cursor:pointer">Choose .gpx or .fit file</label><input id="impFile" type="file" accept=".gpx,.fit" hidden><button class="btn sm" data-act="impSample">Try a sample route</button></div>' +
      (T.impMsg ? '<div class="small" style="margin-top:8px;color:' + (T.impMsg.ok ? 'var(--text)' : 'var(--danger-text)') + '">' + esc(T.impMsg.text) + '</div>' : '') + '</div>';
    (S.imports || []).forEach(function (i) {
      h += '<div class="pcard"><div class="row"><div class="grow"><b>' + esc(i.name) + '</b><div class="small muted">' + impMeta(i) + '</div></div>' +
        (i.id === S.impSel ? '' : '<button class="btn sm" data-act="impSelect" data-arg="' + i.id + '">View</button>') + '<button class="btn sm" data-act="impRemove" data-arg="' + i.id + '" aria-label="Remove ' + esc(i.name) + '">Remove</button></div>';
      if (sel && i.id === sel.id) {
        var v = IMPORT.svg(sel); impAt = v.at;
        h += '<div style="margin-top:10px">' + v.html + '</div><div class="small muted" style="margin:6px 0 10px">Start (green) to finish (red). No base map, so the line shows the shape of the route only.</div>' +
          '<button class="btn primary" data-act="impRide" data-arg="trail">' + ic('play') + 'Ride with waypoint counter</button>' +
          '<button class="btn" data-act="impRide" data-arg="turn" style="margin-top:8px">' + ic('play') + 'Ride with turn-by-turn</button>' +
          '<p class="small muted" style="margin:8px 0 0">Turns are found from the shape of the track, so there are no street names.</p>';
      }
      h += '</div>';
    });
    return h;
  }
  function addImport(p) {
    return p.then(function (imp) {
      imp.id = 'i' + Date.now().toString(36);
      S.imports = (S.imports || []).concat([imp]).slice(-6); S.impSel = imp.id;
      T.impMsg = { ok: true, text: 'Imported ' + imp.name + ' \u00B7 ' + IMPORT.fmtKm(imp.dist) };
      refreshNavRoute(); save(); updateStage(); renderScreen();
      toast('Route imported: ' + imp.name, 'ok');
    }).catch(function (e) { T.impMsg = { ok: false, text: (e && e.message) || 'Could not read that file.' }; renderScreen(); });
  }

  function screenNav() {
    var d = S.dest, home = NAV.PLACES.home;
    var html = banners() + '<h1 class="t">Navigate</h1><p class="sub">Search an address or place, or tap the map.</p>' +
      '<form id="navForm" class="navsearch" autocomplete="off"><input id="navInput" type="search" placeholder="Address or place, e.g. 412 Pine St" aria-label="Destination"><button class="btn primary sm" type="submit">Go</button></form>' +
      '<div id="navSuggest" class="suggest" role="listbox"></div>' +
      '<div class="chips">' + ['work', 'cafe', 'library', 'grocery', 'park'].map(function (k) { return '<button class="chipbtn" data-act="navPlace" data-arg="' + k + '">' + NAV.PLACES[k].name + '</button>'; }).join('') + '</div>' + importHTML();
    if (d && navPlan) {
      html += '<div class="pcard"><div class="row"><div class="grow"><b>To ' + NAV.addrLabel(d) + '</b><div class="small muted">' + navPlan.meta + ' \u00B7 from ' + NAV.addrLabel(home) + '</div></div><button class="btn sm" data-act="navClear">Clear</button></div>' +
        '<button class="btn primary" data-act="navStart" style="margin-top:10px">' + ic('play') + 'Start navigation</button></div>';
    }
    html += '<div class="mapwrap">' + NAV.mapSVG(navPlan, home, d) + '</div><p class="small muted" style="margin:6px 0 10px">Simulated city map. Tap anywhere on it to set a destination.</p>';
    if (d && navPlan) {
      html += '<h3 class="sec">Directions</h3><div class="pcard"><ol class="steps" style="margin:0">' + navPlan.steps.map(function (st) { return '<li><span>' + stepText(st) + '</span><b>' + fmt(st.dist) + '</b></li>'; }).join('') + '</ol></div>';
    }
    return html;
  }
  function renderSuggest(text) {
    var box = $('#navSuggest'); if (!box) return;
    var res = text ? NAV.geocode(text) : { items: (S.recent || []).map(function (a) { return { label: a.name || NAV.addrLabel(a), sub: 'Recent', addr: a }; }) };
    lastSug = res.items;
    box.innerHTML = res.items.map(function (it, i) { return '<button type="button" class="sug" data-act="navSelect" data-arg="' + i + '" role="option"><b>' + it.label + '</b><span>' + it.sub + '</span></button>'; }).join('') +
      (res.error ? '<div class="small muted sugmsg">' + res.error + '</div>' : '');
  }
  function setDestination(addr, label) {
    var a = { kind: addr.kind, idx: addr.idx, n: addr.n }; if (label || addr.name) a.name = label || addr.name;
    S.dest = a;
    S.recent = [a].concat((S.recent || []).filter(function (r) { return !(r.kind === a.kind && r.idx === a.idx && r.n === a.n); })).slice(0, 4);
    save(); refreshNavRoute(); ensureRoute(); updateStage(); renderScreen();
    var sc = $('#screen'); if (sc) sc.scrollTop = 0;
    if (navPlan) toast('Route ready: ' + navPlan.meta);
  }
  function navSubmit() {
    var inp = $('#navInput'); if (!inp) return;
    var res = NAV.geocode(inp.value);
    if (res.items.length) setDestination(res.items[0].addr, res.items[0].place ? res.items[0].label : null);
    else { renderSuggest(inp.value); toast(res.error || 'No match', 'bad'); }
  }
  function mapTap(e) {
    var svg = $('#mapSvg'); if (!svg) return;
    var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    setDestination(NAV.nearest(p.x, p.y), null);
  }
  function updateMapMarker() {
    var idot = $('#impDot');
    if (idot) {
      var ir = currentRoute(), ion = ir && ir.source === 'import' && impAt && ir.id.indexOf('imp-' + S.impSel + '-') === 0 && T.started;
      idot.style.display = ion ? '' : 'none';
      if (ion) { var ip = impAt(ride.progress()); idot.setAttribute('cx', ip[0]); idot.setAttribute('cy', ip[1]); }
    }
    var dot = $('#mapDot'); if (!dot) return;
    var r = currentRoute(), on = navPlan && r && r.id === 'nav-custom' && T.started;
    dot.setAttribute('visibility', on ? 'visible' : 'hidden');
    if (on) { var p = NAV.pointAt(navPlan.points, ride.travelled); dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); }
  }

  var SCREENS = { home: screenHome, nav: screenNav, mode: screenHelmet, settings: screenSettings };
  var TABS = [['home', 'Home'], ['nav', 'Navigate'], ['mode', 'Helmet'], ['settings', 'Settings']];

  function renderTabbar() {
    $('#tabbar').innerHTML = TABS.map(function (t) { return '<button class="' + (S.tab === t[0] ? 'on' : '') + '" data-act="tab" data-arg="' + t[0] + '" aria-label="' + t[1] + '">' + ic(t[0]) + t[1] + '</button>'; }).join('');
  }
  function renderScreen(anim) {
    var scr = $('#screen'), top = scr.scrollTop;
    scr.innerHTML = '<div class="' + (anim ? 'screen-in' : '') + '">' + (SCREENS[S.tab] || screenHome)() + '</div>';
    if (!anim) scr.scrollTop = top; else scr.scrollTop = 0;
    renderTabbar(); drawPreviews();
  }

  var PREVIEWS = {
    free:    { mode: 'free', nav: null, idle: true },
    trail:   { mode: 'trail', nav: { kind: 'waypoint', text: 'Next waypoint', dist: 900, wpName: 'Waypoint 2' } },
    commute: { mode: 'commute', nav: { kind: 'arrive', text: 'Arrive', dist: 40, street: 'Pine St', house: '412' } }
  };
  function drawPreviews() {
    $$('canvas[data-prev]').forEach(function (c) {
      var p = PREVIEWS[c.dataset.prev];
      HUD.draw(c, { t: 0, mode: p.mode, compact: S.compact, contrast: false, power: 1, phoneOk: true, navOk: true, audio: S.audio, battery: 78, nav: p.nav, idle: !!p.idle });
    });
  }

  function drawSwatches() {
    $('#swatches').innerHTML = SWATCHES.map(function (c) { return '<button class="swatch ' + (S.color === c ? 'on' : '') + '" style="background:' + c + '" data-act="color" data-arg="' + c + '" aria-label="Shell colour ' + c + '"></button>'; }).join('');
  }

  /* ------------------------------------------------------------------ events */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    audioCtx();
    act(t.dataset.act, t.dataset.arg);
  });
  document.addEventListener('change', function (e) {
    if (e.target.dataset && e.target.dataset.part && viewer) { viewer.setPartVisible(e.target.dataset.part, e.target.checked); return; }
    var k = e.target.dataset && e.target.dataset.toggle;
    if (!k) return;
    S[k] = e.target.checked; save();
    if (k === 'glove') document.body.classList.toggle('glove', S.glove);
    if (k === 'wet') toast(S.wet ? 'Wet-weather mode on' : 'Wet-weather mode off');
    if (k === 'sensors') toast(S.sensors ? 'Sensors & camera on' : 'Sensors & camera off — module disabled', S.sensors ? 'ok' : '');
    if (k === 'audio' && S.audio) beep(0, [880]);
    updateStage(); drawPreviews();
  });
  document.addEventListener('change', function (e) {
    var f = e.target && e.target.id === 'impFile' && e.target.files && e.target.files[0];
    if (f) { addImport(IMPORT.parseFile(f)); e.target.value = ''; }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'navInput') renderSuggest(e.target.value); });
  document.addEventListener('focusin', function (e) { if (e.target.id === 'navInput' && !e.target.value) renderSuggest(''); });
  document.addEventListener('submit', function (e) { if (e.target.id === 'navForm') { e.preventDefault(); navSubmit(); } });
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('#mapSvg')) mapTap(e); });
  $('#resetBtn').addEventListener('click', function () { actions.askReset(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeSheet(); actions.closeinfo(); }
  });

  /* ------------------------------------------------------------------ main loop */
  function loop() {
    var now = performance.now(), dt = Math.min(0.25, (now - T.last) / 1000); T.last = now;
    T.power += ((T.killed ? 0 : 1) - T.power) * 0.22; if (Math.abs(T.power - (T.killed ? 0 : 1)) < 0.01) T.power = T.killed ? 0 : 1;
    if (T.signal && now > T.signal.until) setSignal(null);
    var wasDwell = ride.dwell > 0, hadAlert = !!ride.alert;
    ride.tick(dt, (T.nav || S.mode === 'free') && !T.killed);
    var hs = hudState(now);
    HUD.draw(texCanvas, hs);
    HUD.draw(hudCanvas, hs, { chips: false });
    HUD.drawEdge(edgeCanvas, hs);
    updateMapMarker();
    if (viewer) viewer.refreshHud();
    // light-weight DOM refresh for progress
    $('#rideBar').style.width = (ride.progress() * 100).toFixed(1) + '%';
    var r = currentRoute();
    if (r && S.mode === 'free') $('#rideLeft').textContent = ride.playing ? 'Riding' : 'Ready';
    else if (r) $('#rideLeft').textContent = ride.finished ? 'Complete' : fmt(ride.remainingTotal()) + ' left';
    if (ride.finished !== loop._fin || wasDwell !== ride.dwell > 0) { loop._fin = ride.finished; updateStage(); }
    if (ride.playing !== loop._pl) { loop._pl = ride.playing; updateStage(); }
  }


  /* ------------------------------------------------------------------ store demo mode */
  var demoAuto = !/[?&]demo=0/.test(location.search), demoToken = 0, snapshot = null, lastInput = performance.now(), swallowUntil = 0;
  var DEMO_N = 13;

  function baselineState() { var b = JSON.parse(JSON.stringify(DEFAULTS)); b.color = themeHelmetColor(document.documentElement.getAttribute('data-theme')); b.speed = 5; b.tab = 'mode'; b.stage = 'helmet'; return b; }
  function resetTransient() { T.killed = false; T.phone = true; T.nav = true; T.sun = false; T.started = false; T.power = 1; T.msg = null; T.pairing = false; T.bootUntil = 0; T.signal = null; closeSheet(); }
  function applyAll() {
    document.body.classList.toggle('glove', S.glove);
    drawSwatches(); syncRide(); setStage(S.stage); renderScreen(true); updateStage();
    var ex = $('#explodeBtn'); if (ex) ex._on = false;
    if (viewer) { viewer.setExplode(false); viewer.resetView(); viewer.partNames().forEach(function (n) { viewer.setPartVisible(n, true); }); }
    $$('#partsList input').forEach(function (i) { i.checked = true; });
    actions.closeinfo();
  }

  function startDemo() {
    if (T.demo) return;
    snapshot = JSON.parse(JSON.stringify(S));
    T.demo = true; S = baselineState(); resetTransient(); applyAll();
    document.body.classList.add('demoing'); $('#demoBar').classList.add('on');
    var b = $('#demoBtn'); b.textContent = '■ Stop demo'; b.classList.add('on');
    var token = ++demoToken;
    runDemo(token).catch(function (e) { if (!e || e.message !== 'demo-abort') console.error(e); });
  }
  function stopDemo() {
    if (!T.demo) return;
    demoToken++; T.demo = false;
    document.body.classList.remove('demoing'); $('#demoBar').classList.remove('on'); $('#demoCursor').classList.remove('on');
    var b = $('#demoBtn'); b.textContent = '▶ Demo mode'; b.classList.remove('on');
    S = snapshot || S; snapshot = null; resetTransient(); ride.playing = false; applyAll();
    lastInput = performance.now();
  }

  function say(i, title, text) {
    $('#demoTitle').textContent = title; $('#demoText').textContent = text;
    var d = ''; for (var k = 1; k <= DEMO_N; k++) d += '<i class="' + (k === i ? 'on' : k < i ? 'done' : '') + '"></i>';
    $('#demoDots').innerHTML = d;
  }

  async function runDemo(token) {
    var alive = function () { return token === demoToken; };
    var w = function (ms) { return new Promise(function (res, rej) { setTimeout(function () { alive() ? res() : rej(new Error('demo-abort')); }, ms); }); };
    var cur = $('#demoCursor');
    cur.style.transform = 'translate(' + innerWidth / 2 + 'px,' + innerHeight / 2 + 'px)';
    // move the on-screen pointer to an element, tap it, and fire its click
    var click = async function (sel) {
      var el = typeof sel === 'string' ? $(sel) : sel;
      if (!el || !el.offsetParent) return;
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await w(500);
      var r = el.getBoundingClientRect();
      cur.classList.add('on'); cur.style.transform = 'translate(' + (r.left + r.width / 2) + 'px,' + (r.top + r.height / 2) + 'px)';
      await w(950);
      cur.classList.add('tap'); el.click();
      await w(350); cur.classList.remove('tap');
    };
    var view = function (v) { if (viewer) viewer.view(v); };
    var tab = function (t) { return click('[data-act=tab][data-arg=' + t + ']'); };

    await w(600);
    while (alive()) {
      S = baselineState(); resetTransient(); applyAll();

      say(1, 'Meet the helmet', 'A cycling helmet with a heads-up display. On a big screen, drag the 3D model to spin it and scroll to zoom.');
      await w(5500);
      say(2, 'Eye-level HUD visor', 'A slim visor over just the eyes and nose bridge, so you can still drink water.');
      view('front'); await w(1000); showInfo('visor'); await w(5200); actions.closeinfo();
      say(3, 'Emergency kill switch', 'A small push button on the right side. One press powers down the display, sensors and camera.');
      view('right'); await w(1000); showInfo('kill'); await w(5200); actions.closeinfo();
      say(4, 'Dual rear lights', 'Two multi-colour LEDs: red tail light, and amber turn signals on the side you are turning.');
      view('rear'); await w(1000); showInfo('led'); await w(2500); actions.closeinfo();
      await click('#qSigL'); await w(3200); await click('#qSigR'); await w(3200); await click('#qSigR'); await w(600);

      say(5, 'Built from real STL parts', 'Explode the model, hide any part, or download its STL file.');
      if (viewer) viewer.resetView(); await w(800);
      await click('#explodeBtn'); await w(3200);
      var partBox = $('#partsList input[data-part=helmet_shell]');
      if (partBox && partBox.offsetParent) { await click(partBox); await w(1800); await click(partBox); await w(600); }
      await click('#explodeBtn'); await w(1800);

      say(6, 'Pick your finish', 'Matte black, white, blue and more. The 3D model updates live.');
      await click('.swatch:nth-child(4)'); await w(1800);
      await click('.swatch:nth-child(2)'); await w(1800);
      await click('.swatch:nth-child(1)'); await w(1500);

      say(7, 'Setup & integrations', 'Pair the helmet, then bring in Strava, Garmin or phone maps from Settings. No proprietary app needed.');
      await tab('mode'); await w(500);
      await click('[data-act=pair]'); await w(3200);
      await tab('settings'); await w(600);
      await click('[data-act=connect][data-arg=strava]'); await w(1200);
      await click('[data-act=allow][data-arg=strava]'); await w(2600);

      say(8, 'Three riding modes', 'None is the default: put the helmet on and ride anywhere. Trail keeps the visor almost empty, and Compact shrinks guidance into a thin strip.');
      await tab('mode'); await w(400);
      await click('[data-act=mode][data-arg=free]'); await w(1800);
      await click('[data-act=mode][data-arg=trail]'); await w(2200);
      await click('[data-act=compact][data-arg=on]'); await w(2600);
      await click('[data-act=compact][data-arg=off]'); await w(900);
      await click('[data-act=mode][data-arg=commute]'); await w(1800);

      say(9, 'Navigate to an address', 'Type an address or tap the map. The route is planned on the phone, then guidance shows on the visor: turn, distance, street and a bold house number.');
      await tab('nav'); await w(500);
      var inp = $('#navInput');
      if (inp && inp.offsetParent) {
        await click(inp);
        var q = '412 Pine';
        for (var ci = 1; ci <= q.length; ci++) { inp.value = q.slice(0, ci); inp.dispatchEvent(new Event('input', { bubbles: true })); await w(170); }
        await w(900);
        await click('[data-act=navSelect][data-arg="0"]'); await w(3500);
        await click('[data-act=navStart]'); await w(14000);
      }
      say(9, 'Import a route', 'Bring in a .gpx or .fit file from Strava, Garmin or a bike computer. It is read in the browser and ridden as waypoints or turn-by-turn.');
      await tab('nav'); await w(500);
      await click('[data-act=impSample]'); await w(4200);
      var impBox = $('#screen'); if (impBox) impBox.scrollTop = 420; await w(3500);
      say(9, 'Connection warnings', 'If the phone or navigation app drops, the HUD says so right away. Phone messages stay off the visor.');
      await click('[data-act=notif]'); await w(2500);
      await click('#qNav'); await w(4000);
      await click('#qNav'); await w(3000);
      say(9, 'Bright sun & rain', 'The HUD switches to high contrast in bright sun, and wet-weather mode makes it larger.');
      await click('#qSun'); await w(3500); await click('#qSun'); await w(600);
      await click('#qWet'); await w(4500); await click('#qWet'); await w(800);

      say(10, 'Trail mode', 'Only the distance to the next waypoint, plus missed-turn and hazard alerts.');
      await tab('mode'); await w(300);
      await click('[data-act=mode][data-arg=trail]'); await w(800);
      await tab('home'); await w(300);
      await click('[data-act=startRide]'); await w(6000);
      await click('[data-act=next]'); await w(4200);
      await click('[data-act=next]'); await w(4200);
      await click('[data-act=next]'); await w(4200);

      say(11, 'Kill switch in action', 'The display goes dark immediately and the helmet shows it is off. The rear light stays on.');
      await click('#killBtn'); await w(4200);
      await click('#killBtn'); await w(3200);

      say(12, 'Settings for real riders', 'Glove-friendly buttons, battery saver, sensor and camera control, and rear-light options.');
      await tab('settings'); await w(600);
      await click('[data-act=rear][data-arg=steady]'); await w(2200);
      await click('[data-act=rear][data-arg=blink]'); await w(2200);

      say(13, 'Your turn', 'Tap anywhere to take control. The demo restarts when the screen is idle.');
      ride.playing = false; if (viewer) viewer.resetView(); setStage('helmet');
      await w(6000);
    }
  }

  // any real user input hands control to the visitor; the demo restarts after 60 s idle
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      lastInput = performance.now();
      if (T.demo && e.isTrusted && !e.target.closest('#demoBtn')) {
        swallowUntil = performance.now() + 450;
        stopDemo();
        if (ev !== 'keydown' && ev !== 'wheel') { e.preventDefault(); e.stopPropagation(); }
      }
    }, true);
  });
  document.addEventListener('click', function (e) { if (e.isTrusted && performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.addEventListener('pointermove', function () { lastInput = performance.now(); }, { passive: true });
  setInterval(function () { if (!T.demo && demoAuto && performance.now() - lastInput > 60000) startDemo(); }, 3000);

  /* ------------------------------------------------------------------ boot */
  function boot() {
    applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
    if (S.glove) document.body.classList.add('glove');
    if (S.tab === 'sync') S.tab = 'mode';
    drawSwatches();
    syncRide();
    setStage(S.stage);
    initViewer();
    renderScreen(); updateStage(); drawSkyline();
    var clock = function () { var d = new Date(); $('#clock').textContent = (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0'); };
    clock(); setInterval(clock, 30000);
    setInterval(loop, 50);
    setInterval(drawSkyline, 500);
    if (demoAuto) setTimeout(startDemo, 2500);   // store mode: starts on launch (add ?demo=0 to disable)
  }
  boot();
})();
