#!/usr/bin/env python3
"""Procedurally generates the smart-helmet CAD model as binary STL parts.

Coordinates are millimetres, Z-up, +X = forward (towards the visor), +Y = rider's left.
Run:  python3 tools/generate_stl.py
Outputs: models/*.stl  (one file per part + helmet_assembly.stl)
         js/models-data.js (same parts base64-embedded so the site also works from file://)
"""
import base64
import math
import os
import struct

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "models")
os.makedirs(OUT, exist_ok=True)

# ---------------------------------------------------------------- vector helpers
def add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return (a[0] / l, a[1] / l, a[2] / l)
def avg(pts):
    n = len(pts)
    return (sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n, sum(p[2] for p in pts) / n)

class Mesh:
    def __init__(self): self.tris = []
    def tri(self, a, b, c, hint=None):
        """Add a triangle; if hint (a direction) is given, wind it so its normal faces hint."""
        n = cross(sub(b, a), sub(c, a))
        if dot(n, n) < 1e-12: return  # degenerate
        if hint is not None and dot(n, hint) < 0: b, c = c, b
        self.tris.append((a, b, c))
    def quad(self, a, b, c, d, hint=None):
        self.tri(a, b, c, hint); self.tri(a, c, d, hint)
    def extend(self, other): self.tris.extend(other.tris)

# ---------------------------------------------------------------- generic thick sheet
def build_sheet(fn, nu, nv, wrap_u=False, kept=None, split=False, inside=None, project=None):
    """fn(u, v) with u,v in [0,1] -> (outer_point, inner_point). Returns a closed-wall mesh.
    kept(u_mid, v_mid) -> bool selects which quads exist (to cut openings)."""
    m = Mesh()
    liner = Mesh()
    cols = nu if wrap_u else nu + 1
    O = [[None] * (nv + 1) for _ in range(cols)]
    I = [[None] * (nv + 1) for _ in range(cols)]
    ins = [[False] * (nv + 1) for _ in range(cols)]
    for i in range(cols):
        for j in range(nv + 1):
            u, v = i / nu, j / nv
            if inside is not None:
                ins[i][j] = inside(u, v)
            O[i][j], I[i][j] = fn(u, v)
    if inside is not None:
        # a quad is kept if any corner survives; corners inside the cut are snapped onto the cut curve
        def corner(i, j): return ins[i % nu][j] if wrap_u else ins[i][j]
        keep = {}
        for i in range(nu):
            for j in range(nv):
                i2 = (i + 1) % nu if wrap_u else i + 1
                keep[(i, j)] = not (ins[i][j] and ins[i2][j] and ins[i2][j + 1] and ins[i][j + 1])
        snapped = set()
        for (i, j), k in keep.items():
            if not k: continue
            i2 = (i + 1) % nu if wrap_u else i + 1
            for (a, b) in ((i, j), (i2, j), (i2, j + 1), (i, j + 1)):
                if ins[a][b] and (a, b) not in snapped:
                    u2, v2 = project(a / nu, b / nv)
                    O[a][b], I[a][b] = fn(u2, v2)
                    snapped.add((a, b))
        kept = lambda um, vm: keep[(int(um * nu), int(vm * nv))]
    def q(i, j):
        if j < 0 or j >= nv: return False
        if wrap_u: i %= nu
        elif i < 0 or i >= nu: return False
        return kept is None or kept((i + .5) / nu, (j + .5) / nv)
    for i in range(nu):
        for j in range(nv):
            if not q(i, j): continue
            i2 = (i + 1) % nu if wrap_u else i + 1
            o = [O[i][j], O[i2][j], O[i2][j + 1], O[i][j + 1]]
            n = [I[i][j], I[i2][j], I[i2][j + 1], I[i][j + 1]]
            thick = avg([sub(o[k], n[k]) for k in range(4)])
            m.quad(*o, hint=thick)
            (liner if split else m).quad(*n, hint=mul(thick, -1))
            centre = avg(o + n)
            # walls on every side that borders a missing quad / the grid edge
            sides = [((i, j - 1), 0, 1), ((i + 1, j), 1, 2), ((i, j + 1), 2, 3), ((i - 1, j), 3, 0)]
            for (ni, nj), a, b in sides:
                if q(ni, nj): continue
                wall = Mesh()
                wall.quad(o[a], o[b], n[b], n[a])
                for t in wall.tris:
                    g = avg(list(t))
                    nn = cross(sub(t[1], t[0]), sub(t[2], t[0]))
                    m.tri(*t, hint=sub(g, centre))
    return (m, liner) if split else m

# ---------------------------------------------------------------- helmet parametrisation
# Trail/commuter bike helmet: low vented shell, long peak, chin straps, and a slim
# eye-level visor (eyes + nose bridge only, so the rider can still drink).
A, B, C = 155.0, 120.0, 108.0   # half length, height, half width of the shell (mm)
D2R = math.pi / 180.0
PHI_MAX = 90 * D2R

def pw(x, e):
    return math.copysign(abs(x) ** e, x)

def rim_deg(th_deg):
    """Lower edge of the shell: high at the brow, sweeping down to the nape."""
    s = min(1.0, max(0.0, (abs(th_deg) - 25.0) / 155.0))
    return 10.0 - 44.0 * (s * s * (3 - 2 * s))

def shell_point(theta, phi, sx=1.0, sy=1.0, sz=1.0, lift=0.0):
    ct, st, cp, sp = math.cos(theta), math.sin(theta), math.cos(phi), math.sin(phi)
    a = A * (1 + 0.12 * max(0.0, -ct))
    x = a * pw(cp, 0.9) * pw(ct, 0.9) * sx
    y = C * pw(cp, 0.9) * pw(st, 0.9) * sy * (1 - 0.08 * max(0.0, -ct))
    z = B * pw(sp, 0.85) * sz - 14.0 * max(0.0, -ct) * cp * cp
    p = (x, y, z)
    if lift:
        return add(p, mul(snormal(theta, phi, sx, sy, sz), lift))
    return p

def snormal(theta, phi, sx=1.0, sy=1.0, sz=1.0):
    e = 1e-3
    p = shell_point(theta, phi, sx, sy, sz)
    pt = sub(shell_point(theta + e, phi, sx, sy, sz), shell_point(theta - e, phi, sx, sy, sz))
    pp = sub(shell_point(theta, min(phi + e, math.pi / 2 - 1e-4), sx, sy, sz), shell_point(theta, phi - e, sx, sy, sz))
    n = norm(cross(pt, pp))
    if dot(n, p) < 0: n = mul(n, -1)
    return n

def _newton(f, grad, x, y, iters=10):
    for _ in range(iters):
        fv = f(x, y); gx, gy = grad(x, y)
        d = gx * gx + gy * gy
        if d < 1e-12: break
        x -= fv * gx / d; y -= fv * gy / d
    return x, y

# vent windows cut through the shell: (theta centre, phi centre, half width deg, half height deg)
HOLES = []
for sgn in (1, -1):
    HOLES += [(sgn * 22, 58, 12, 14), (sgn * 55, 47, 14, 13), (sgn * 93, 47, 14, 12), (sgn * 132, 42, 12, 12), (sgn * 160, 36, 8, 9)]

def _hole_f(h, x, y): return (abs(x) / h[2]) ** 3 + (abs(y) / h[3]) ** 3 - 1.0
def _hole_g(h, x, y): return (3 * math.copysign(x * x, x) / h[2] ** 3, 3 * math.copysign(y * y, y) / h[3] ** 3)

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)

# raised ridges (ribs) between the vent windows, as on moulded in-mould shells
RIDGES = []
for _s in (1, -1):
    RIDGES += [_s * 38, _s * 74, _s * 112, _s * 146]
RIDGE_H = 3.2

def ridge_disp(th_deg, ph_deg):
    m = smoothstep(26, 52, ph_deg) * (1 - smoothstep(76, 90, ph_deg))
    if m <= 0: return 0.0
    d = 0.0
    for c in RIDGES:
        dt = ((th_deg - c + 180) % 360) - 180
        d = max(d, math.exp(-(dt / 8.0) ** 2))
    return RIDGE_H * m * d

def helmet_shell():
    nu, nv = 168, 60
    def ph_of(th, v):
        r = rim_deg(th)
        return (r + v * (90.0 - r)) * D2R
    def fn(u, v):
        th = (u * 2 - 1) * math.pi
        ph = ph_of(th / D2R, v)
        o0 = shell_point(th, ph)
        n = snormal(th, ph)
        o = add(o0, mul(n, ridge_disp(th / D2R, ph / D2R)))
        i = sub(o0, mul(n, 6.0))
        return o, i
    def deg(u, v):
        th = (u * 2 - 1) * 180.0
        return th, ph_of(th, v) / D2R
    def which(th, ph):
        for h in HOLES:
            dth = ((th - h[0] + 180) % 360) - 180
            if _hole_f(h, dth, ph - h[1]) < 0: return h
        return None
    def inside(u, v): return which(*deg(u, v)) is not None
    def project(u, v):
        th, ph = deg(u, v)
        h = which(th, ph)
        x, y = _newton(lambda a, b: _hole_f(h, a, b), lambda a, b: _hole_g(h, a, b), ((th - h[0] + 180) % 360) - 180, ph - h[1])
        th2, ph2 = h[0] + x, h[1] + y
        r = rim_deg(th2)
        return (th2 / 180.0 + 1) / 2, max(0.0, min(1.0, (ph2 - r) / (90.0 - r)))
    return build_sheet(fn, nu, nv, wrap_u=True, split=True, inside=inside, project=project)

VISOR_S = (1.035, 1.06, 1.0)
VISOR_TH, VISOR_PH0, VISOR_PH1 = 54.0, -11.0, 9.0

def visor():
    """Slim eye-level shield: covers eyes and nose bridge only, leaving the mouth free."""
    nu, nv = 80, 22
    def fn(u, v):
        th = (u * 2 - 1) * VISOR_TH * D2R
        ph = (VISOR_PH0 + v * (VISOR_PH1 - VISOR_PH0)) * D2R
        o = shell_point(th, ph, *VISOR_S)
        i = sub(o, mul(snormal(th, ph, *VISOR_S), 2.4))
        return o, i
    def xy(u, v): return u * 2 - 1, v * 2 - 1
    def f_v(x, y): return abs(x) ** 6 + abs(y) ** 4 - 1.0
    def g_v(x, y): return (6 * math.copysign(abs(x) ** 5, x), 4 * math.copysign(abs(y) ** 3, y))
    def inside(u, v): return f_v(*xy(u, v)) >= 0
    def project(u, v):
        x, y = _newton(f_v, g_v, *xy(u, v))
        return (x + 1) / 2, (y + 1) / 2
    return build_sheet(fn, nu, nv, inside=inside, project=project)

def peak():
    """Long upturned MTB-style peak, plus the visor pivot bosses."""
    nu, nv = 64, 8
    def fn(u, v):
        th = (u * 2 - 1) * 56 * D2R
        base = shell_point(th, (rim_deg(th / D2R) + 11) * D2R, 1.01, 1.01, 1.0)
        d = norm((math.cos(th) * 0.8, math.sin(th) * 0.8, 0.42))
        length = 54.0 * max(0.0, math.cos(th * 90.0 / 56.0)) ** 0.8 + 4.0
        top = add(base, mul(d, v * length))
        top = (top[0], top[1], top[2] - 4.0 * v * v)
        return add(top, (0, 0, 1.8)), add(top, (0, 0, -1.8))
    m = build_sheet(fn, nu, nv)
    for side in (1, -1):
        p, n, t, w = frame_at(side * VISOR_TH * D2R, 1 * D2R, lift=3.0, s=VISOR_S)
        m.extend(cylinder(sub(p, mul(n, 4)), n, 8.0, 8.0, seg=28))
    return m

def frame_at(theta, phi, lift=0.0, s=(1.0, 1.0, 1.0)):
    p = shell_point(theta, phi, *s, lift=lift)
    n = snormal(theta, phi, *s)
    up = (0, 0, 1)
    t = norm(cross(up, n)) if abs(n[2]) < 0.97 else (0, 1, 0)
    w = norm(cross(n, t))
    return p, n, t, w

def rim_point(th_deg, lift=-1.0):
    return shell_point(th_deg * D2R, (rim_deg(th_deg) + 2.0) * D2R, lift=lift)

def cylinder(centre, axis, radius, height, seg=36, radius_top=None):
    """Capped cylinder whose base sits at `centre` and extends along `axis`."""
    m = Mesh()
    axis = norm(axis)
    ref = (0, 0, 1) if abs(axis[2]) < 0.9 else (1, 0, 0)
    u = norm(cross(axis, ref)); v = cross(axis, u)
    rt = radius if radius_top is None else radius_top
    top = add(centre, mul(axis, height))
    ring0 = [add(centre, add(mul(u, math.cos(2 * math.pi * k / seg) * radius), mul(v, math.sin(2 * math.pi * k / seg) * radius))) for k in range(seg)]
    ring1 = [add(top, add(mul(u, math.cos(2 * math.pi * k / seg) * rt), mul(v, math.sin(2 * math.pi * k / seg) * rt))) for k in range(seg)]
    for k in range(seg):
        k2 = (k + 1) % seg
        mid = avg([ring0[k], ring0[k2]])
        m.quad(ring0[k], ring0[k2], ring1[k2], ring1[k], hint=sub(mid, centre))
        m.tri(centre, ring0[k2], ring0[k], hint=mul(axis, -1))
        m.tri(top, ring1[k], ring1[k2], hint=axis)
    return m

def annulus(centre, axis, r_in, r_out, height, seg=48):
    m = Mesh()
    axis = norm(axis)
    ref = (0, 0, 1) if abs(axis[2]) < 0.9 else (1, 0, 0)
    u = norm(cross(axis, ref)); v = cross(axis, u)
    def ring(c, r): return [add(c, add(mul(u, math.cos(2 * math.pi * k / seg) * r), mul(v, math.sin(2 * math.pi * k / seg) * r))) for k in range(seg)]
    top = add(centre, mul(axis, height))
    a0, a1, b0, b1 = ring(centre, r_out), ring(top, r_out), ring(centre, r_in), ring(top, r_in)
    for k in range(seg):
        k2 = (k + 1) % seg
        m.quad(a0[k], a0[k2], a1[k2], a1[k], hint=sub(avg([a0[k], a0[k2]]), centre))
        m.quad(b0[k], b0[k2], b1[k2], b1[k], hint=sub(centre, avg([b0[k], b0[k2]])))
        m.quad(a1[k], a1[k2], b1[k2], b1[k], hint=axis)
        m.quad(a0[k], a0[k2], b0[k2], b0[k], hint=mul(axis, -1))
    return m

def box(centre, ex, ey, ez, hx, hy, hz):
    """Oriented box; ex/ey/ez are orthonormal axes, hx/hy/hz half sizes."""
    m = Mesh()
    pts = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                pts[(sx, sy, sz)] = add(centre, add(mul(ex, sx * hx), add(mul(ey, sy * hy), mul(ez, sz * hz))))
    def face(keys, hint): m.quad(*[pts[k] for k in keys], hint=hint)
    face([(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)], ex)
    face([(-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1)], mul(ex, -1))
    face([(-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)], ey)
    face([(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)], mul(ey, -1))
    face([(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)], ez)
    face([(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)], mul(ez, -1))
    return m

# ---------------------------------------------------------------- straps
def ribbon(p0, p1, p2, width, thick):
    mid_t = norm(sub(p2, p0))
    ref = (0, 1, 0) if abs(dot(mid_t, (0, 1, 0))) < 0.7 else (0, 0, 1)
    def fn(u, v):
        t = 1 - u
        c = add(add(mul(p0, t * t), mul(p1, 2 * t * u)), mul(p2, u * u))
        d = add(mul(sub(p1, p0), 2 * t), mul(sub(p2, p1), 2 * u))
        tang = norm(d)
        w = norm(cross(tang, ref)); n = norm(cross(w, tang))
        base = add(c, mul(w, (v - 0.5) * width))
        return add(base, mul(n, thick / 2)), sub(base, mul(n, thick / 2))
    return build_sheet(fn, 26, 3)

def strap_points(side):
    f = rim_point(side * 56); r = rim_point(side * 124)
    j = (-8.0, side * 100.0, -88.0)
    k = (44.0, side * 36.0, -126.0)
    return f, r, j, k

def straps():
    m = Mesh()
    for side in (1, -1):
        f, r, j, k = strap_points(side)
        m.extend(ribbon(f, ((f[0] + j[0]) / 2 + 4, (f[1] + j[1]) / 2 + side * 6, (f[2] + j[2]) / 2), j, 20.0, 2.2))
        m.extend(ribbon(r, ((r[0] + j[0]) / 2 - 4, (r[1] + j[1]) / 2 + side * 4, (r[2] + j[2]) / 2), j, 20.0, 2.2))
        m.extend(ribbon(j, ((j[0] + k[0]) / 2 + 6, (j[1] + k[1]) / 2, (j[2] + k[2]) / 2 - 8), k, 20.0, 2.2))
    return m

def buckle():
    m = Mesh()
    ex, ey, ez = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    k1 = (44.0, 36.0, -126.0)
    k2 = (44.0, -36.0, -126.0)
    c1 = add(k1, (0, -10, 0))
    m.extend(box(c1, ex, ey, ez, 14, 14, 5.5))                      # female housing
    m.extend(box(add(c1, (0, 2, 5.6)), ex, ey, ez, 8, 7, 1.4))      # raised release button
    for sx in (-1, 1):                                              # side latch lips
        m.extend(box(add(c1, (sx * 14.8, -4, 0)), ex, ey, ez, 1.2, 9, 3.4))
    c2 = add(k2, (0, 10, 0))
    m.extend(box(c2, ex, ey, ez, 11, 11, 4))                        # male body
    for g in (-1, 0, 1):                                            # grip ridges
        m.extend(box(add(c2, (g * 6.0, 0, 4.4)), ex, ey, ez, 1.3, 8, 0.8))
    m.extend(box(add(k2, (0, 26, 0)), ex, ey, ez, 8.5, 12, 1.3))    # tongue that slides into the housing
    for side in (1, -1):                                            # slide adjusters at the ear junction
        f, r, j, k = strap_points(side)
        c = sub(j, (0, side * 2.5, 0))
        m.extend(annulus(c, (0, side, 0), 9.0, 13.5, 5.0, seg=32))
        m.extend(box(add(c, (0, side * 2.5, 0)), ex, ey, ez, 11.0, 2.5, 1.5))   # centre bar
    return m

# soft comfort pads on the inside of the liner: (theta, phi, half-width deg, half-height deg)
PADS = [(0, 20, 36, 7), (76, 24, 16, 9), (-76, 24, 16, 9), (128, 16, 14, 8), (-128, 16, 14, 8), (180, -16, 24, 10)]

def pads():
    m = Mesh()
    def f_p(x, y): return x ** 4 + y ** 4 - 1.0
    def g_p(x, y): return (4 * x ** 3, 4 * y ** 3)
    for (th0, ph0, dth, dph) in PADS:
        def fn(u, v, th0=th0, ph0=ph0, dth=dth, dph=dph):
            th = (th0 + (u * 2 - 1) * dth) * D2R
            ph = (ph0 + (v * 2 - 1) * dph) * D2R
            p = shell_point(th, ph); n = snormal(th, ph)
            return sub(p, mul(n, 5.6)), sub(p, mul(n, 14.5))
        def inside(u, v): return f_p(u * 2 - 1, v * 2 - 1) >= 0
        def project(u, v):
            x, y = _newton(f_p, g_p, u * 2 - 1, v * 2 - 1)
            return (x + 1) / 2, (y + 1) / 2
        m.extend(build_sheet(fn, 28, 14, inside=inside, project=project))
    return m

# ---------------------------------------------------------------- accessories
KILL_TH, KILL_PH = -108, 22   # position on the rider's right side

def kill_frame():
    p, n, t, w = frame_at(math.radians(KILL_TH), math.radians(KILL_PH))
    return p, n, t, w

def kill_switch():
    """Low-profile base of the push button on the rider's right side (Y negative): stadium plate and collar."""
    p, n, t, w = kill_frame()
    m = box(sub(p, mul(n, 0.2)), t, w, n, 5.0, 4.0, 1.4)
    for s in (-1, 1):
        m.extend(cylinder(sub(add(p, mul(t, s * 5.0)), mul(n, 1.6)), n, 4.0, 2.8, seg=28))
    m.extend(cylinder(add(p, mul(n, 0.9)), n, 3.0, 1.5, seg=24))
    return m

def kill_button():
    """Small dark push-button cap that sits on the collar; the viewer presses it in."""
    p, n, t, w = kill_frame()
    return cylinder(add(p, mul(n, 2.3)), n, 3.4, 2.8, seg=32, radius_top=3.0)

def sensor():
    p, n, t, w = frame_at(0.0, math.radians(71))
    m = annulus(sub(p, mul(n, 2)), n, 8.5, 12.0, 4.0)
    m.extend(cylinder(sub(p, mul(n, 1)), n, 8.0, 6.0, seg=32))
    m.extend(cylinder(add(p, mul(n, 5)), n, 4.2, 1.2, seg=24))
    return m

def speakers():
    m = Mesh()
    for side in (1, -1):
        p, n, t, w = frame_at(side * math.radians(100), math.radians(-1))
        m.extend(annulus(sub(p, mul(n, 2)), n, 14.0, 17.0, 3.6))
        for row in range(-2, 3):
            for col in range(-2, 3):
                if abs(row) + abs(col) > 3: continue
                off = add(mul(t, col * 5.2 + (2.6 if row % 2 else 0)), mul(w, row * 4.5))
                if math.hypot(dot(off, t), dot(off, w)) > 12: continue
                m.extend(cylinder(add(sub(p, mul(n, 1)), off), n, 1.7, 3.4, seg=10))
    return m

def _led_pod(side):
    """One of two rear multi-colour LED pods. +t at the rear points to the rider's right."""
    p, n, t, w = frame_at(math.pi, math.radians(10))
    c = add(p, mul(t, 16.0 * side))
    m = box(c, t, w, n, 12.0, 5.0, 2.2)
    m.extend(box(add(c, mul(n, 1.9)), t, w, n, 9.5, 3.2, 0.8))      # slightly raised lens
    return m

def led_left(): return _led_pod(-1)
def led_right(): return _led_pod(1)

def dial():
    p, n, t, w = frame_at(math.pi, math.radians(-14))
    m = cylinder(sub(p, mul(n, 3)), n, 19.0, 9.0, seg=48, radius_top=17.5)
    m.extend(annulus(add(p, mul(n, 5.5)), n, 8.0, 13.5, 1.6, seg=32))
    return m

PARTS = {
    "helmet_shell": lambda: helmet_shell()[0],
    "helmet_liner": lambda: helmet_shell()[1],
    "pads": pads,
    "visor": visor,
    "peak": peak,
    "straps": straps,
    "buckle": buckle,
    "kill_switch": kill_switch,
    "kill_button": kill_button,
    "sensor": sensor,
    "led_left": led_left,
    "led_right": led_right,
    "dial": dial,
}

def write_stl(path, name, mesh):
    with open(path, "wb") as f:
        header = (name + " - smart helmet HUD prototype").encode()[:80].ljust(80, b" ")
        f.write(header)
        f.write(struct.pack("<I", len(mesh.tris)))
        for a, b, c in mesh.tris:
            n = norm(cross(sub(b, a), sub(c, a)))
            f.write(struct.pack("<12fH", *n, *a, *b, *c, 0))

def hotspots():
    out = {}
    def put(k, th, ph, lift=0):
        p, n, t, w = frame_at(math.radians(th), math.radians(ph), lift)
        out[k] = {"pos": [round(c, 1) for c in p], "n": [round(c, 3) for c in n]}
    put("kill", -108, 22, 6); put("sensor", 0, 71, 7);  put("led", 180, 10, 5)
    f, r, j, k = strap_points(-1)
    out["audio"] = {"pos": [round(j[0], 1), round(j[1] - 8, 1), round(j[2], 1)], "n": [0, -1, 0]}
    p = shell_point(0, math.radians(-2), *VISOR_S)
    out["visor"] = {"pos": [round(p[0] + 8, 1), 0.0, round(p[2], 1)], "n": [1, 0, 0]}
    return out

def main():
    assembly = Mesh()
    embedded = {}
    for name, fn in PARTS.items():
        mesh = fn()
        path = os.path.join(OUT, name + ".stl")
        write_stl(path, name, mesh)
        assembly.extend(mesh)
        with open(path, "rb") as f:
            embedded[name] = base64.b64encode(f.read()).decode()
        print(f"{name:14s} {len(mesh.tris):6d} triangles  {os.path.getsize(path) / 1024:7.1f} KB")
    write_stl(os.path.join(OUT, "helmet_assembly.stl"), "assembly", assembly)
    print(f"{'assembly':14s} {len(assembly.tris):6d} triangles")
    with open(os.path.join(ROOT, "js", "models-data.js"), "w") as f:
        f.write("/* Auto-generated by tools/generate_stl.py - base64 copies of models/*.stl */\n")
        f.write("window.HELMET_STL = {\n")
        for k, v in embedded.items():
            f.write(f'  "{k}": "{v}",\n')
        f.write("};\n")
        import json
        f.write("window.HELMET_HOTSPOTS = " + json.dumps(hotspots()) + ";\n")

if __name__ == "__main__":
    main()
