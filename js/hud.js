/* HUD renderer: draws what the rider sees on the visor onto a 1200x420 canvas.
   The same canvas is shown in the Rider view and mapped onto the 3D visor.
   Design rules: glance-readable (one icon + one number), bottom-weighted, house numbers pop. */
(function () {
  'use strict';

  var W = 1200, H = 420;
  var FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  function font(w, px) { return w + ' ' + px + 'px ' + FONT; }

  function palette(contrast) {
    return contrast
      ? { plate: 'rgba(255,255,255,0.97)', stroke: '#000', text: '#000', sub: '#222', accent: '#0047c8', chip: 'rgba(255,255,255,0.96)', chipText: '#000', shadow: 'rgba(0,0,0,0.5)', lw: 3 }
      : { plate: 'rgba(8,13,24,0.74)', stroke: 'rgba(255,255,255,0.28)', text: '#fff', sub: '#c9d4e8', accent: '#5ef0ff', chip: 'rgba(8,13,24,0.66)', chipText: '#dfe8f7', shadow: 'rgba(0,0,0,0.45)', lw: 1.5 };
  }
  var TONES = {
    warn:   function (c) { return { fill: c ? '#ffd21a' : 'rgba(255,176,32,0.96)', text: '#14110a', stroke: c ? '#000' : 'rgba(255,255,255,0.35)' }; },
    danger: function (c) { return { fill: c ? '#e60000' : 'rgba(255,59,59,0.96)', text: '#fff', stroke: c ? '#000' : 'rgba(255,255,255,0.35)' }; },
    ok:     function (c) { return { fill: c ? '#0b7a3d' : 'rgba(30,200,120,0.95)', text: c ? '#fff' : '#04180d', stroke: c ? '#000' : 'rgba(255,255,255,0.35)' }; }
  };

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* Centre guidance has no background panel: only translucent glyphs with a thin halo, so the road stays visible.
     plate() keeps its name and signature but draws nothing; it returns the text colour for the tone. */
  var haloOn = false, haloColor = 'rgba(0,0,0,0.6)';
  var GHOST = {
    normal:   { warn: '#ffb020', danger: '#ff5a5a', ok: '#3fe08f' },
    contrast: { warn: '#8a4b00', danger: '#c40000', ok: '#0b7a3d' }
  };
  function plate(ctx, x, y, w, h, pal, tone, contrast) {
    return tone ? GHOST[contrast ? 'contrast' : 'normal'][tone] : pal.text;
  }

  /* ----------------------------------------------------------- icons (unit box -1..1) */
  function icon(ctx, kind, cx, cy, size, color, lw) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(size / 2, size / 2);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = (lw || 12) / (size / 2);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var haloLw = haloOn ? ctx.lineWidth + 7 / (size / 2) : 0;
    ctx.beginPath();
    switch (kind) {
      case 'straight':
        ctx.moveTo(0, 0.85); ctx.lineTo(0, -0.7); ctx.moveTo(-0.45, -0.25); ctx.lineTo(0, -0.75); ctx.lineTo(0.45, -0.25); break;
      case 'right':
        ctx.moveTo(-0.45, 0.85); ctx.lineTo(-0.45, -0.1); ctx.lineTo(0.55, -0.1);
        ctx.moveTo(0.15, -0.55); ctx.lineTo(0.62, -0.1); ctx.lineTo(0.15, 0.35); break;
      case 'left':
        ctx.moveTo(0.45, 0.85); ctx.lineTo(0.45, -0.1); ctx.lineTo(-0.55, -0.1);
        ctx.moveTo(-0.15, -0.55); ctx.lineTo(-0.62, -0.1); ctx.lineTo(-0.15, 0.35); break;
      case 'uturn':
        ctx.moveTo(-0.45, 0.85); ctx.lineTo(-0.45, -0.1); ctx.arc(-0.05, -0.1, 0.4, Math.PI, 0, false); ctx.lineTo(0.35, 0.4);
        ctx.moveTo(0.05, 0.12); ctx.lineTo(0.35, 0.55); ctx.lineTo(0.65, 0.12); break;
      case 'arrive':
        ctx.arc(0, -0.2, 0.5, Math.PI * 0.8, Math.PI * 2.2, false); ctx.lineTo(0, 0.9); ctx.closePath();
        ctx.moveTo(0.2, -0.2); ctx.arc(0, -0.2, 0.2, 0, Math.PI * 2); break;
      case 'hazard':
        ctx.moveTo(0, -0.8); ctx.lineTo(0.88, 0.72); ctx.lineTo(-0.88, 0.72); ctx.closePath();
        ctx.moveTo(0, -0.2); ctx.lineTo(0, 0.25); ctx.moveTo(0, 0.5); ctx.lineTo(0, 0.52); break;
      case 'waypoint':
        ctx.moveTo(-0.4, 0.9); ctx.lineTo(-0.4, -0.85); ctx.lineTo(0.65, -0.45); ctx.lineTo(-0.4, -0.05); break;
      case 'message':
        ctx.rect(-0.85, -0.55, 1.7, 1.1); ctx.moveTo(-0.85, -0.5); ctx.lineTo(0, 0.15); ctx.lineTo(0.85, -0.5); break;
      case 'navlost':
        ctx.arc(0, 0, 0.55, 0, Math.PI * 2); ctx.moveTo(0, -0.9); ctx.lineTo(0, -0.55); ctx.moveTo(0, 0.55); ctx.lineTo(0, 0.9);
        ctx.moveTo(-0.9, 0); ctx.lineTo(-0.55, 0); ctx.moveTo(0.55, 0); ctx.lineTo(0.9, 0);
        ctx.moveTo(-0.75, 0.75); ctx.lineTo(0.75, -0.75); break;
      case 'check':
        ctx.moveTo(-0.7, 0.05); ctx.lineTo(-0.2, 0.55); ctx.lineTo(0.75, -0.5); break;
      case 'speaker':
        ctx.moveTo(-0.9, -0.25); ctx.lineTo(-0.5, -0.25); ctx.lineTo(-0.05, -0.7); ctx.lineTo(-0.05, 0.7); ctx.lineTo(-0.5, 0.25); ctx.lineTo(-0.9, 0.25); ctx.closePath();
        ctx.moveTo(0.3, -0.35); ctx.arc(0.1, 0, 0.45, -0.7, 0.7); ctx.moveTo(0.65, -0.7); ctx.arc(0.1, 0, 0.9, -0.7, 0.7); break;
      case 'mute':
        ctx.moveTo(-0.9, -0.25); ctx.lineTo(-0.5, -0.25); ctx.lineTo(-0.05, -0.7); ctx.lineTo(-0.05, 0.7); ctx.lineTo(-0.5, 0.25); ctx.lineTo(-0.9, 0.25); ctx.closePath();
        ctx.moveTo(0.3, -0.35); ctx.lineTo(0.9, 0.35); ctx.moveTo(0.9, -0.35); ctx.lineTo(0.3, 0.35); break;
    }
    if (haloOn) { ctx.save(); ctx.strokeStyle = haloColor; ctx.lineWidth = haloLw; ctx.stroke(); ctx.restore(); }
    ctx.stroke();
    ctx.restore();
  }

  function dirIcon(nav) {
    return { left: 'left', right: 'right', straight: 'straight', uturn: 'uturn', arrive: 'arrive', waypoint: 'waypoint' }[nav.kind] || 'straight';
  }

  function fit(ctx, text, weight, px, maxW) {
    ctx.font = font(weight, px);
    while (ctx.measureText(text).width > maxW && px > 18) { px -= 2; ctx.font = font(weight, px); }
    return px;
  }

  function fmtDist(m) {
    if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
    if (m < 50) return Math.max(0, Math.round(m / 5) * 5) + ' m';
    return Math.round(m / 10) * 10 + ' m';
  }

  function houseBadge(ctx, x, yMid, number, px, contrast) {
    // high-visibility yellow tag with black bold digits: stands apart from the street name
    var label = '#' + number, wasHalo = haloOn; haloOn = false;
    ctx.font = font(900, px);
    var tw = ctx.measureText(label).width, pad = px * 0.38, h = px * 1.28;
    ctx.save();
    rr(ctx, x, yMid - h / 2, tw + pad * 2, h, px * 0.3);
    ctx.fillStyle = '#ffe14d'; ctx.fill();
    ctx.lineWidth = contrast ? 4 : 2; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(label, x + pad, yMid + px * 0.04);
    ctx.restore(); haloOn = wasHalo;
    return tw + pad * 2;
  }

  /* ----------------------------------------------------------- chips */
  function chip(ctx, x, y, text, pal, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = font(700, 22);
    var tw = ctx.measureText(text).width, h = 38, w = tw + 28 + (opts.dot ? 22 : 0) + (opts.icon ? 30 : 0);
    if (opts.align === 'right') x -= w;
    rr(ctx, x, y, w, h, 19);
    ctx.fillStyle = opts.fill || pal.chip; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = opts.stroke || pal.stroke; ctx.stroke();
    var cx = x + 14;
    if (opts.dot) { ctx.beginPath(); ctx.arc(cx + 6, y + h / 2, 6, 0, Math.PI * 2); ctx.fillStyle = opts.dot; ctx.fill(); cx += 22; }
    if (opts.icon) { icon(ctx, opts.icon, cx + 11, y + h / 2, 24, opts.color || pal.chipText, 2.4); cx += 30; }
    ctx.fillStyle = opts.color || pal.chipText; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, cx, y + h / 2 + 1);
    ctx.restore();
    return w;
  }

  function connChip(ctx, s, pal, x, y, align) {
    var blink = Math.floor(s.t / 450) % 2 === 0;
    var contrast = s.contrast;
    if (!s.phoneOk || !s.navOk) {
      var label = !s.phoneOk && !s.navOk ? 'PHONE + NAV LOST' : !s.phoneOk ? 'PHONE LOST' : 'NAV LOST';
      var t = TONES.warn(contrast);
      return chip(ctx, x, y, '⚠ ' + label, pal, { fill: blink ? t.fill : (contrast ? '#fff' : 'rgba(255,176,32,0.55)'), color: blink ? t.text : pal.chipText, stroke: t.stroke, align: align });
    }
    var g = contrast ? '#0b7a3d' : '#2fe38a';
    return chip(ctx, x, y, 'PHONE · NAV', pal, { dot: g, align: align });
  }

  /* ----------------------------------------------------------- scenes */
  function sceneAlert(ctx, s, pal, compact) {
    var a = s.alert, tone = a.kind === 'hazard' || a.kind === 'missed' ? 'danger' : a.kind === 'arrived' ? 'ok' : 'warn';
    var ic = { hazard: 'hazard', missed: 'uturn', navlost: 'navlost', arrived: 'arrive' }[a.kind];
    if (compact) {
      var x = 60, y = H - 104, w = W - 120, h = 84;
      var txt = plate(ctx, x, y, w, h, pal, tone, s.contrast);
      icon(ctx, ic, x + 56, y + h / 2, 52, txt, 7);
      ctx.fillStyle = txt; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = font(900, 44); ctx.fillText(a.title, x + 108, y + h / 2 + 2);
      var tw = ctx.measureText(a.title).width;
      if (a.sub) { ctx.font = font(600, 30); ctx.globalAlpha = .9; ctx.fillText(a.sub, x + 108 + tw + 26, y + h / 2 + 2); ctx.globalAlpha = 1; }
      return;
    }
    // small bottom-anchored alert block: leaves the middle of the view clear
    ctx.font = font(900, 46); var tW = ctx.measureText(a.title).width;
    ctx.font = font(600, 24); var sW = a.sub ? ctx.measureText(a.sub).width : 0;
    var bw = Math.min(900, 150 + Math.max(tW, sW) + 40), bh = 120, bx = (W - bw) / 2, by = H - bh - 26;
    var t = plate(ctx, bx, by, bw, bh, pal, tone, s.contrast);
    icon(ctx, ic, bx + 70, by + bh / 2, 68, t, 8);
    ctx.fillStyle = t; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = font(900, 46); ctx.fillText(a.title, bx + 124, by + (a.sub ? 58 : 74));
    if (a.sub) { ctx.font = font(600, 24); ctx.globalAlpha = .92; ctx.fillText(a.sub, bx + 124, by + 94); ctx.globalAlpha = 1; }
  }

  function sceneNavFull(ctx, s, pal) {
    // small bottom-anchored guidance block: one icon, one number, the street
    var n = s.nav, accent = pal.accent, street = n.street || '';
    ctx.font = font(900, 64); var dTxt = fmtDist(n.dist), dW = ctx.measureText(dTxt).width;
    ctx.font = font(700, 30); var tW = ctx.measureText(n.text).width;
    ctx.font = font(600, 26); var sW = ctx.measureText(street).width;
    var hW = n.house ? 120 : 0;
    var textW = Math.max(dW, tW, sW + (n.house ? hW + 12 : 0));
    var bh = 150, bw = Math.min(900, 140 + textW + 40), bx = (W - bw) / 2, by = H - bh - 26;
    var txt = plate(ctx, bx, by, bw, bh, pal, null, s.contrast);
    icon(ctx, dirIcon(n), bx + 70, by + bh / 2, 80, accent, 9);
    var x = bx + 130;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = txt; ctx.font = font(700, 30); ctx.fillText(n.text, x, by + 38);
    ctx.fillStyle = accent; ctx.font = font(900, 64); ctx.fillText(dTxt, x, by + 98);
    ctx.fillStyle = pal.sub; ctx.font = font(600, 26); ctx.fillText(street, x, by + 133);
    if (n.house) houseBadge(ctx, x + sW + 14, by + 124, n.house, 28, s.contrast);
  }

  function sceneNavCompact(ctx, s, pal) {
    var n = s.nav, x = 60, y = H - 104, w = W - 120, h = 84;
    var txt = plate(ctx, x, y, w, h, pal, null, s.contrast);
    icon(ctx, dirIcon(n), x + 56, y + h / 2, 52, pal.accent, 7);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var cx = x + 108, my = y + h / 2 + 2;
    ctx.fillStyle = txt; ctx.font = font(800, 40); ctx.fillText(n.text, cx, my); cx += ctx.measureText(n.text).width + 22;
    if (n.dist != null) { ctx.fillStyle = pal.accent; ctx.font = font(900, 46); var d = fmtDist(n.dist); ctx.fillText(d, cx, my); cx += ctx.measureText(d).width + 24; }
    if (n.street && s.mode === 'commute') {
      ctx.fillStyle = pal.sub; ctx.font = font(600, 32); ctx.fillText(n.street, cx, my); cx += ctx.measureText(n.street).width + 18;
      if (n.house) houseBadge(ctx, cx, my, n.house, 36, s.contrast);
    }
  }

  function sceneTrailIdle(ctx, s, pal, compact) {
    // minimal: a single small bottom plate, rest of the visor stays clear
    var n = s.nav, w = compact ? 560 : 600, h = compact ? 80 : 96;
    var x = (W - w) / 2, y = H - h - 24;
    var txt = plate(ctx, x, y, w, h, pal, null, s.contrast);
    icon(ctx, 'waypoint', x + 52, y + h / 2, h * 0.5, pal.accent, 6);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = pal.accent; ctx.font = font(900, compact ? 46 : 54); var d = fmtDist(n.dist);
    ctx.fillText(d, x + 100, y + h / 2 + 2);
    var dw = ctx.measureText(d).width;
    ctx.fillStyle = pal.sub; ctx.font = font(600, compact ? 28 : 32);
    ctx.fillText('to ' + (n.wpName || 'next waypoint'), x + 100 + dw + 20, y + h / 2 + 4);
  }

  var MODE_NAME = { trail: 'Trail', commute: 'Commuter', free: 'Free ride' };
  var MODE_CHIP = { trail: 'TRAIL', commute: 'COMMUTE', free: 'FREE' };

  // free ride: no directions, so the visor stays clear. Only a tiny hint before the ride starts.
  function sceneFree(ctx, s, pal) {
    if (!s.idle) return;
    var w = 470, h = 76, x = (W - w) / 2, y = H - h - 24;
    var txt = plate(ctx, x, y, w, h, pal, null, s.contrast);
    ctx.fillStyle = txt; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = font(700, 32);
    ctx.fillText('Free ride \u00B7 visor stays clear', W / 2, y + h / 2 + 2);
  }

  function sceneBoot(ctx, s, pal) {
    var w = 520, h = 120, x = (W - w) / 2, y = H - h - 40;
    var t = plate(ctx, x, y, w, h, pal, 'ok', s.contrast);
    icon(ctx, 'check', x + 70, y + h / 2, 56, t, 9);
    ctx.fillStyle = t; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = font(900, 44); ctx.fillText('HELMET ON', x + 120, y + h / 2 - 12);
    ctx.font = font(600, 28); ctx.fillText('Battery ' + s.battery + '%  ·  ' + (MODE_NAME[s.mode] || 'Free ride') + ' mode', x + 120, y + h / 2 + 30);
  }

  function sceneReady(ctx, s, pal, compact) {
    var w = 520, h = 84, x = (W - w) / 2, y = H - h - 24;
    var txt = plate(ctx, x, y, w, h, pal, null, s.contrast);
    ctx.fillStyle = txt; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = font(700, 34);
    ctx.fillText(s.mode ? 'Ready · press play to ride' : 'Choose a mode in the app', W / 2, y + h / 2 + 2);
  }

  /* ----------------------------------------------------------- main entry */
  function drawHud(canvas, s, opts) {
    var chips = !(opts && opts.chips === false);
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var alpha = s.power == null ? 1 : s.power;
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    var pal = palette(s.contrast);

    // wet-weather / high-contrast: scale the whole HUD up around its anchor
    var k = s.large ? 1.1 : 1;
    if (k !== 1) { ctx.translate(W / 2, H); ctx.scale(k, k); ctx.translate(-W / 2, -H); }

    var compact = !!s.compact;
    var showMessage = !!s.msg;

    // status chips (3D visor texture only; the rider view draws them at the true edges of the view)
    if (!chips) { /* drawn by drawEdge */ }
    else if (!compact) {
      if (s.mode) chip(ctx, 70, 30, MODE_CHIP[s.mode] || 'FREE', pal, { color: pal.accent });
      chip(ctx, W - 70, 30, s.audio ? 'AUDIO' : 'MUTED', pal, { icon: s.audio ? 'speaker' : 'mute', align: 'right' });
      connChip(ctx, s, pal, W - 70 - 140 - (s.audio ? 8 : 0), 30, 'right');
      chip(ctx, 70, 350, 'BAT ' + s.battery + '%' + (s.saver ? ' · SAVER' : ''), pal, {});
    } else {
      connChip(ctx, s, pal, W - 70, 30, 'right');
    }

    // centre scenes: translucent glyphs with a halo (no panels)
    var plainFill = ctx.fillText;
    haloOn = true; haloColor = s.contrast ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.6)';
    ctx.fillText = function (t, tx, ty) {
      if (haloOn) { ctx.save(); ctx.lineWidth = 9; ctx.lineJoin = 'round'; ctx.strokeStyle = haloColor; ctx.strokeText(t, tx, ty); ctx.restore(); }
      plainFill.call(ctx, t, tx, ty);
    };
    ctx.globalAlpha = alpha * 0.94;
    if (s.booting) {
      sceneBoot(ctx, s, pal);
    } else if (s.alert) {
      sceneAlert(ctx, s, pal, compact);
    } else if (s.mode === 'free') {
      sceneFree(ctx, s, pal);
    } else if (!s.nav || s.idle) {
      sceneReady(ctx, s, pal, compact);
    } else if (s.mode === 'trail') {
      sceneTrailIdle(ctx, s, pal, compact);
    } else if (compact) {
      sceneNavCompact(ctx, s, pal);
    } else {
      sceneNavFull(ctx, s, pal);
    }

    if (showMessage) {
      // allowed-through notification: small, top-right, never covers the guidance
      var w = 470, h = 84, x = W - w - 70, y = 84;
      var t = plate(ctx, x, y, w, h, pal, 'warn', s.contrast);
      icon(ctx, 'message', x + 52, y + h / 2, 44, t, 6);
      ctx.fillStyle = t; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = font(800, 30); ctx.fillText(s.msg.title, x + 96, y + h / 2 - 14);
      ctx.font = font(600, 24); ctx.fillText(s.msg.sub, x + 96, y + h / 2 + 18);
    }
    haloOn = false; delete ctx.fillText;
    ctx.restore();

    // directional audio cue indicator (left / right) at the visor edges
    if (chips && s.pan && alpha > 0.3) {
      ctx.save();
      var side = s.pan < 0 ? 'L' : 'R', px = s.pan < 0 ? 40 : W - 40;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = s.contrast ? '#000' : '#5ef0ff';
      ctx.beginPath();
      if (s.pan < 0) { ctx.moveTo(px - 10, 210); ctx.lineTo(px + 30, 160); ctx.lineTo(px + 30, 260); }
      else { ctx.moveTo(px + 10, 210); ctx.lineTo(px - 30, 160); ctx.lineTo(px - 30, 260); }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  /* Status chips + audio-cue arrows for the rider view, drawn at the far left/right edges of the whole
     visor window (not inside the central HUD block). Canvas is sized to its on-screen box. */
  function drawEdge(canvas, s) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    var alpha = s.power == null ? 1 : s.power;
    if (alpha <= 0.01) return;
    var pal = palette(s.contrast), k = Math.max(0.6, Math.min(1, ch / 360));
    var inset = Math.max(26, 54 * k), top = Math.max(30, 50 * k), gap = 46 * k;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(0, 0);
    // left edge column: mode, battery.  right edge column: connection, audio
    ctx.save(); ctx.translate(inset, top); ctx.scale(k, k);
    if (!s.compact) {
      if (s.mode) chip(ctx, 0, 0, MODE_CHIP[s.mode] || 'FREE', pal, { color: pal.accent });
      chip(ctx, 0, gap / k, 'BAT ' + s.battery + '%' + (s.saver ? ' \u00B7 SAVER' : ''), pal, {});
    }
    ctx.restore();
    ctx.save(); ctx.translate(cw - inset, top); ctx.scale(k, k);
    connChip(ctx, s, pal, 0, 0, 'right');
    if (!s.compact) chip(ctx, 0, gap / k, s.audio ? 'AUDIO' : 'MUTED', pal, { icon: s.audio ? 'speaker' : 'mute', align: 'right' });
    ctx.restore();
    // turn signal indicator: amber, flashing in step with the rear lights, on the side being signalled
    if (s.signal && Math.floor(s.t / 380) % 2 === 0) {
      var sl = s.signal === 'left', amber = s.contrast ? '#8a4b00' : '#ffb020';
      ctx.save(); ctx.translate(sl ? inset : cw - inset, ch * 0.66); ctx.scale(k, k);
      chip(ctx, 0, 0, 'SIGNAL', pal, { icon: sl ? 'left' : 'right', color: amber, stroke: amber, align: sl ? 'left' : 'right' });
      ctx.restore();
    }
    // directional audio cue: arrow on the side the turn is on
    if (s.pan) {
      ctx.fillStyle = s.contrast ? '#000' : '#5ef0ff'; ctx.globalAlpha = 0.9 * alpha;
      var cy = ch * 0.5, ax = s.pan < 0 ? inset * 0.45 : cw - inset * 0.45, d = s.pan < 0 ? 1 : -1;
      ctx.beginPath(); ctx.moveTo(ax - d * 12 * k, cy); ctx.lineTo(ax + d * 22 * k, cy - 34 * k); ctx.lineTo(ax + d * 22 * k, cy + 34 * k); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  window.HUD = { draw: drawHud, drawEdge: drawEdge, W: W, H: H, fmtDist: fmtDist };
})();
