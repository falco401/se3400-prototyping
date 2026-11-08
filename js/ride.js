/* Route data + ride simulation engine (front-end only, sample data). */
(function () {
  'use strict';

  /* kind: left | right | straight | uturn | arrive | waypoint
     dist: metres from the previous maneuver to this one. hazardAt / missAt: metres remaining when an alert fires. */
  var ROUTES = [
    { id: 'free-ride', mode: 'free', source: 'helmet', name: 'Free ride', meta: 'No route \u00B7 ride anywhere', steps: [
      { kind: 'free', dist: 1000000000 }
    ] },
    { id: 'commute-work', mode: 'commute', source: 'maps', name: 'Home → Work', meta: '2.5 km · 9 min', steps: [
      { kind: 'left', street: 'Main St', dist: 260 },
      { kind: 'right', street: 'Oak Ave', dist: 420 },
      { kind: 'straight', street: 'Oak Ave', dist: 1100, hazardAt: 480, hazardText: 'Car door ahead' },
      { kind: 'left', street: 'Pine St', dist: 380 },
      { kind: 'arrive', street: 'Pine St', house: '412', dist: 140 }
    ] },
    { id: 'delivery-run', mode: 'commute', source: 'helmet', name: 'Delivery run · 3 stops', meta: '1.9 km · 3 drops', steps: [
      { kind: 'left', street: 'Elm St', dist: 240 },
      { kind: 'right', street: '1st Ave', dist: 180 },
      { kind: 'arrive', street: '1st Ave', house: '118', dist: 120, stop: 'Stop 1 of 3' },
      { kind: 'left', street: 'Maple Dr', dist: 420, hazardAt: 160, hazardText: 'Pedestrian crossing' },
      { kind: 'arrive', street: 'Maple Dr', house: '1207', dist: 260, stop: 'Stop 2 of 3' },
      { kind: 'right', street: 'Cedar Ct', dist: 300 },
      { kind: 'arrive', street: 'Cedar Ct', house: '45', dist: 150, stop: 'Stop 3 of 3' }
    ] },
    { id: 'trail-demo', mode: 'trail', source: 'helmet', name: 'Demo trail loop', meta: '4.2 km \u00B7 built-in', steps: [
      { kind: 'waypoint', wpName: 'Trailhead', dist: 1300 },
      { kind: 'waypoint', wpName: 'Waypoint 2', dist: 1500, missAt: 600 },
      { kind: 'waypoint', wpName: 'Waypoint 3', dist: 1100, hazardAt: 350, hazardText: 'Loose rock ahead' },
      { kind: 'waypoint', wpName: 'Lookout', dist: 700 }
    ] },
    { id: 'trail-ridge', mode: 'trail', source: 'strava', name: 'Ridge Loop', meta: '18 km · Strava route', steps: [
      { kind: 'waypoint', wpName: 'Trailhead gate', dist: 1400 },
      { kind: 'waypoint', wpName: 'Waypoint 2', dist: 1900, missAt: 700 },
      { kind: 'waypoint', wpName: 'Waypoint 3', dist: 1200, hazardAt: 400, hazardText: 'Loose rock ahead' },
      { kind: 'waypoint', wpName: 'Summit', dist: 800 }
    ] },
    { id: 'trail-canyon', mode: 'trail', source: 'strava', name: 'Canyon Singletrack', meta: '11 km · Strava route', steps: [
      { kind: 'waypoint', wpName: 'Junction A', dist: 1100 },
      { kind: 'waypoint', wpName: 'Creek crossing', dist: 1500, hazardAt: 600, hazardText: 'Wet crossing ahead' },
      { kind: 'waypoint', wpName: 'Overlook', dist: 900, missAt: 450 }
    ] },
    { id: 'trail-lake', mode: 'trail', source: 'garmin', name: 'Lakeshore Course', meta: '32 km · Garmin course', steps: [
      { kind: 'waypoint', wpName: 'North pier', dist: 1700 },
      { kind: 'waypoint', wpName: 'Boat ramp', dist: 1300, missAt: 520 },
      { kind: 'waypoint', wpName: 'Finish', dist: 1000, hazardAt: 300, hazardText: 'Gravel patch' }
    ] }
  ];

  var SOURCE_LABEL = { helmet: 'Built-in', import: 'Imported', address: 'Address', maps: 'Phone maps', strava: 'Strava', garmin: 'Garmin' };

  function Ride(handlers) {
    this.h = handlers || {};
    this.route = null;
    this.playing = false;
    this.speedMul = 4;
    this.reset();
  }

  Ride.prototype.setRoute = function (route) { this.route = route; this.reset(); };

  Ride.prototype.reset = function () {
    this.idx = 0; this.finished = false; this.playing = false;
    this.alert = null; this.dwell = 0; this.cued = false; this.hazardFired = false; this.missFired = false;
    this.remaining = this.route ? this.route.steps[0].dist : 0;
    this.travelled = 0;
    if (this.route) this.total = this.route.steps.reduce(function (a, s) { return a + s.dist; }, 0);
  };

  Ride.prototype.step = function () { return this.route ? this.route.steps[this.idx] : null; };

  Ride.prototype.progress = function () {
    if (!this.route) return 0;
    return Math.min(1, this.travelled / this.total);
  };

  Ride.prototype.remainingTotal = function () { return Math.max(0, this.total - this.travelled); };

  Ride.prototype._cue = function (st) {
    if (this.h.onCue) this.h.onCue(st.kind === 'left' ? -1 : st.kind === 'right' ? 1 : 0, st);
  };

  Ride.prototype._raise = function (kind, title, sub, secs) {
    this.alert = { kind: kind, title: title, sub: sub, until: secs };
    if (this.h.onAlert) this.h.onAlert(this.alert);
  };

  Ride.prototype._next = function () {
    var st = this.step();
    if (this.h.onManeuver) this.h.onManeuver(st);
    if (this.idx >= this.route.steps.length - 1) {
      this.finished = true; this.playing = false;
      if (this.h.onFinish) this.h.onFinish();
      return;
    }
    this.idx++;
    this.remaining = this.route.steps[this.idx].dist;
    this.cued = false; this.hazardFired = false; this.missFired = false;
    if (st.kind === 'arrive') this.dwell = 2.4; // linger on the "arrived" card
  };

  Ride.prototype._checks = function (st) {
    if (!this.cued && this.remaining <= Math.min(st.dist, 160)) { this.cued = true; this._cue(st); }
    if (st.hazardAt != null && !this.hazardFired && this.remaining <= st.hazardAt) {
      this.hazardFired = true; this._raise('hazard', 'HAZARD', st.hazardText || 'Obstacle ahead', 3.6);
    }
    if (st.missAt != null && !this.missFired && this.remaining <= st.missAt) {
      this.missFired = true; this._raise('missed', 'MISSED TURN', 'Turn around · 40 m back', 4.5);
    }
  };

  /* Advance the simulation by dt seconds of real time. */
  Ride.prototype.tick = function (dt, navOk) {
    if (this.alert) { this.alert.until -= dt; if (this.alert.until <= 0) this.alert = null; }
    if (!this.route || !this.playing || this.finished) return;
    if (!navOk) return; // no navigation data -> no progress to announce
    if (this.dwell > 0) { this.dwell -= dt; return; }
    var st = this.step();
    var baseSpeed = this.route.mode === 'trail' ? 4.5 : 7;
    var d = baseSpeed * this.speedMul * dt;
    this.remaining -= d; this.travelled += d;
    this._checks(st);
    if (this.remaining <= 0) { this.travelled += this.remaining; this.remaining = 0; this._next(); }
  };

  /* "Next ride event": jump to the next alert or maneuver. */
  Ride.prototype.skip = function () {
    if (!this.route || this.finished) return;
    var st = this.step();
    var target = 0;
    if (st.hazardAt != null && !this.hazardFired && this.remaining > st.hazardAt) target = st.hazardAt;
    else if (st.missAt != null && !this.missFired && this.remaining > st.missAt) target = st.missAt;
    var gap = this.remaining - target;
    this.travelled += gap; this.remaining = target;
    if (target === 0) { this.dwell = 0; this._next(); }
    else this._checks(st);
  };

  window.RIDE = { Ride: Ride, ROUTES: ROUTES, SOURCE_LABEL: SOURCE_LABEL };
})();
