# Smart cycling helmet: interactive prototype

High-fidelity, front-end-only prototype of a heads-up-display cycling helmet. A 3D model built from real STL
files sits next to a working companion app and a simulated rider's-eye view of the visor HUD.

**No backend.** No database, API calls, accounts or analytics. Settings, mode, pairing and connected apps are kept
in the browser's `localStorage` (key `helmet-proto-v1`); "Reset prototype" clears them. Transient things (kill switch,
simulated disconnects, ride progress) reset on refresh.

The helmet is meant to work without a cloud. Your rides, routes and settings stay on your own devices, you own the
helmet and its data, and there are no servers or accounts to depend on. Strava, Garmin and phone maps are optional extras.

## What's inside
| Path | Purpose |
| --- | --- |
| `models/*.stl` | CAD parts: shell, liner, eye-level visor, peak, chin straps, buckle, kill switch, sensor, status light, fit dial, plus `helmet_assembly.stl` |
| `tools/generate_stl.py` | Pure-Python generator for the STL parts (edit dimensions, re-run: `python3 tools/generate_stl.py`) |
| `js/helmet3d.js`, `js/stl.js` | Three.js viewer + STL loader: orbit/zoom, exploded view, hotspots, clickable kill switch, live HUD texture on the visor |
| `js/hud.js` | HUD renderer (canvas) shared by the 3D visor and the Rider view |
| `js/ride.js` | Sample routes + ride simulation (distance countdown, hazards, missed turns) |
| `js/nav.js` | Local navigation: a fictional street-grid city, address/place search, shortest-path routing into turn-by-turn steps, and the SVG map (no map or geocoding service) |
| `js/importer.js` | Route import: reads .gpx and .fit files in the browser, simplifies the track and builds waypoint or turn-by-turn routes |
| `js/app.js` | Companion app (Home / Mode / Setup / Settings (integrations live in Settings)), stage controls, state |

## Feedback implemented
- Compact HUD strip so directions/notifications don't obstruct the view
- Live phone / nav connection indicator on the HUD; nav loss pauses directions and says so
- None / Free ride (default): no route or pairing needed; the visor stays clear apart from edge status chips
- Route import (Navigate tab): .gpx and .fit files, ridden as a waypoint counter or detected turn-by-turn; a sample route is built in
- Dual rear lights (two multi-colour pods): red tail light, amber turn signals automatically from navigation or from the app
- Centre guidance is translucent text and icons with a halo, no background panels
- Trail mode: live distance to next waypoint
- House numbers shown as a bold yellow tag, distinct from street names
- Kill switch: a small dark push button on the helmet, plus large red buttons in the stage controls and in Settings
- Directional (stereo-panned) audio cues, wet-weather high-contrast mode, glove mode, battery saver, sensor toggle

## Demo (store) mode
The page starts a self-running tour on launch: it spins and explains the 3D helmet, explodes it, recolors it, pairs and syncs,
switches modes, rides a commuter/delivery route and a trail route, triggers warnings, uses the kill switch, and loops.
A pointer glides to each control so visitors can follow along. Touching, clicking or pressing a key hands control to the visitor
(their saved settings are restored); after 60 s idle the demo restarts. The header button toggles it. Add `?demo=0` to the URL to disable auto-start.
Demo mode never writes to localStorage.

On screens 1500 px or wider the 3D model and the rider view are shown side by side, with a panel to hide/show each STL part or download it.

## Navigation
The Navigate tab searches addresses (e.g. `412 Pine St`, numbers 100-599) and places (Work, Library, ...) in a small simulated city, or you can tap the map to drop a destination. The route is planned in the browser and drives the same ride simulation and HUD. Start is always Home (118 1st Ave).
