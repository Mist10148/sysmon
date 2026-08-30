# How this was built

Companion to [PRD.md](PRD.md). Each phase left the application in a state that
opened without errors, which is the only definition of "working" available to a
project with no test suite and no build step.

---

## Phase 0 — scaffold

- [x] `index.html` — the shell, the ordered script list, the pre-paint theme script
- [x] the icon sprite, inline in `index.html` — external `<use>` is CORS-blocked
      on `file://`, which would make every icon vanish when double-clicked
- [x] `assets/favicon.svg`, `LICENSE`, `.gitignore`, `.gitattributes`, `.nojekyll`

**Verify:** the page loads, the sprite resolves, nothing 404s.

## Phase 1 — the design system

- [x] `css/tokens.css` — every colour, shadow, radius and easing curve; `.dark`
      redefines only what differs
- [x] `css/base.css` — reset, document defaults, the one `.icon` rule, focus rings,
      reduced motion
- [x] `css/utilities.css` — the spacing, type and colour vocabulary the markup is
      written in
- [x] `css/layout.css` — the frame, the sidebar and drawer, the top bar, the glass
      materials, the vibrancy wash
- [x] `css/components/*.css` — buttons, fields, cards, tables, overlays, badges
- [x] `css/map.css`, `css/pages.css`, `css/print.css`

**Verify:** no colour literal outside `tokens.css`. `.table-stack` and the three
rail layouts are each written once.

## Phase 2 — core

- [x] `js/core/dom.js` — the `html` tag with escaping by default, delegation, `raw`
- [x] `js/core/emitter.js` — topic pub/sub, coalesced onto a microtask
- [x] `js/core/format.js` — local ISO timestamps parsed by hand, relative time,
      durations, the octet-aware IP comparator
- [x] `js/core/rng.js` — FNV-1a plus mulberry32, and id allocation
- [x] `js/core/storage.js` — one key per table, debounced, dirty-tracked

**Verify:** `SM.dom.html` escapes an interpolated `<script>`. A date at 00:30 keeps
its own day.

## Phase 3 — data and store

- [x] `js/store/schema.js` — the single description of every column
- [x] `js/data/txt.js` — the record format, both directions, plus table detection
- [x] `js/data/seed.js` — five systems and eight sites, as text
- [x] `data/*.txt` — sample exports, and the format's reference
- [x] `js/store/store.js` — state, transactions, subscription, load and reset
- [x] `js/store/queries.js` — read-time joins, memoised on table revisions
- [x] `js/store/mutations.js` — every write, with its validation and its log entry

**Verify:** export, clear storage, import, and arrive at the same application.

## Phase 4 — routing and shell

- [x] `js/router.js` — hash routing, list state in the query, mount/unmount with a
      cleanup registry
- [x] `js/shell/theme.js` — three states, and "system" keeps following
- [x] `js/shell/shell.js` — sidebar, drawer with scrim and scroll lock, top bar
- [x] `js/main.js` — boot order: theme, store, backfill, shell, router, scheduler

**Verify:** navigate away from the Dashboard and back; no Leaflet instance and no
interval survives. Cross 1024px with the drawer open and the scroll lock releases.

## Phase 5 — components

- [x] `js/ui/primitives.js` — buttons, fields, native selects, switches, segmented
      controls, cards, tiles
- [x] `js/ui/badges.js` — health and identity badges, status cards, chips
- [x] `js/ui/table.js` — the one table renderer, sortable heads, pagination, keyed
      row patching
- [x] `js/ui/toolbar.js` — search and sort, both surfaces, bound to the hash
- [x] `js/ui/toast.js` — one stack, updatable, with an action slot for Undo
- [x] `js/ui/overlay.js` — native dialogs, alert dialogs, menus, tooltips
- [x] `js/ui/inline-edit.js` — the two prose columns of the form

**Verify:** a dialog traps focus and returns it. Tab order is sane. Tooltips do not
appear on touch.

## Phase 6 — the domain

- [x] `js/domain/status.js` — Down, Restored, Functional
- [x] `js/domain/activity-log.js` — one place that writes the diary
- [x] `js/domain/sweep.js` — the deterministic probe, episode-based outages, the
      ping and HTTP transcripts
- [x] `js/domain/backfill.js` — six weeks from the same streams
- [x] `js/domain/analytics.js` — uptime, outages, recovery time, daily series
- [x] `js/domain/notify.js` — permission from a gesture, repeats collapsed by tag
- [x] `js/domain/scheduler.js` — the in-tab timer
- [x] `js/domain/io/exports.js`, `js/domain/io/import.js`

**Verify:** clear storage twice and get the same month both times. An outage's
duration on Analytics matches the rows in History for that site.

## Phase 7 — the pages

- [x] `js/map/map.js`, `js/map/picker.js` — Leaflet, the CSS pins, the fallback
- [x] `js/pages/dashboard.js` — built once, updated in pieces so the map survives
- [x] `js/pages/systems.js` — CRUD, reordering, the three delete dispositions
- [x] `js/pages/locations.js` — CRUD, the click-to-place editor, Undo
- [x] `js/pages/history.js` — filters, inline editing, raw output, exports
- [x] `js/pages/analytics.js` — the SVG chart, the breakdowns, the outage table
- [x] `js/pages/activity.js` — the grouped feed and prune
- [x] `js/pages/settings.js` — sweeps, options, data, notifications, appearance

**Verify:** every page at 375, 700, 900, 1100 and 1400 pixels wide.

## Phase 8 — documentation

- [x] `README.md` — what it is, how to run it, what is measured, what was removed
- [x] `docs/PRD.md` — requirements, and the record of the rewrite
- [x] `docs/DATA-FORMAT.md` — the normative format
- [x] `docs/PHASE_TASKS.md` — this file

**Verify:** someone who has never seen it can open it and know what they are
looking at, including the parts that are not real measurements.

---

## Phase 9 — real checks

The static build did everything the product does except the one thing it exists to
do. This phase is the probe agent, and the honesty machinery that has to come with
it.

- [x] Six fixes first, so they are not buried in a feature: the ongoing-outage
      duration measured to now in a past range, the backfill's off-by-one (six
      weeks was always forty-six days), the second settings file that silently won
      an import, the sample check row pointing at a site that did not exist, and a
      `.gitignore` negation that negated nothing
- [x] `js/domain/sweep.js` — `probe()` split into `simulate()` and `buildRow()`,
      verified byte-identical over 1080 generated rows before wiring anything up
- [x] `js/store/schema.js` — a `source` column on checks, `live` or `sim`
- [x] `js/domain/probe.js` — agent detection, batching, and coercion of everything
      that comes back
- [x] `agent/sysmon-agent.ps1` — real ICMP and HTTP, and the folder served so the
      page is same-origin with the API
- [x] `SysMon.bat` — the double-click entry
- [x] `js/domain/sweep.js` — `run()` returns a Promise; scheduler, dashboard and
      locations await it
- [x] `js/pages/dashboard.js` — the staged delay replaced by measured elapsed time
- [x] Settings, Dashboard and History say which kind of number they are showing
- [x] `docs/AGENT.md` — the protocol and the limits

**Verify:** a site pointed at `127.0.0.1` reports real sub-millisecond replies with
a real TTL; an unroutable address reports a real timeout after `packets × timeout`;
killing the agent mid-session falls back to simulated rows without an error; and the
published copy over `https` behaves exactly as it did before.

---

## Bugs worth remembering

**The seed was never saved.** Loading from the seed marked nothing dirty, so the
seeded tables were never written. Every reload therefore looked like another fresh
install and ran the backfill again on top of the history it had already generated —
five thousand records where there should have been a thousand. Fixed by writing the
seed out immediately on a fresh install, and guarded a second time by refusing to
backfill when checks already exist.

**The map fitted itself to nothing.** Created inside a section that had just been
assigned `innerHTML`, Leaflet measured a zero-height container and answered with a
zoomed-out view of the whole world. Fixed by refusing to consider the map fitted
until the container has a real size, and retrying from the `ResizeObserver`.

**Two failures that both looked exactly like a site being down.** Both in the agent,
both found by pointing it at something that definitely answers.

PowerShell 5.1 does not load `System.Net.Http`, so every HTTP check failed with
"cannot find type HttpClientHandler". And the TLS callback cannot be the obvious
`{ $true }` scriptblock: .NET invokes it on a worker thread where a PowerShell
scriptblock has no runspace, so every HTTPS check failed with "There is no Runspace
available to run scripts in this thread". Both surfaced as a timed-out probe and a
red site.

The lesson is not either fix. It is that a monitoring tool's failures all wear the
same costume, so the first target you point it at must be one you can prove is up.

## Backlog

- [ ] A second seed of demo HTTP systems, so the four non-queueing systems have
      sites out of the box
- [ ] Keyboard shortcuts for the seven pages
- [ ] A compare-two-ranges mode on Analytics
- [ ] Optional CSV import for sites, for an office that keeps its list in a
      spreadsheet
- [ ] An `apple-touch-icon` that is a PNG. It currently points at the SVG favicon,
      which iOS has never supported, so "add to home screen" gets a screenshot
- [ ] A live-versus-simulated split on Analytics, so a month that was partly
      measured can be read as such rather than averaged together
