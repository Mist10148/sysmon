# SysMon — product requirements

**Project:** SysMon (static build)
**Version:** 3.0
**Date:** August 29, 2026
**Status:** Implemented

> **On this document.** Sections 1 to 9 describe the product, and are carried
> forward from the previous build's requirements because the product has not
> changed. Section 10 is the record of the rewrite: what was removed, what replaced
> it, and which decisions are worth being able to look up later. Requirement
> numbers are not reused; where the rewrite withdrew one, it is marked in place
> rather than deleted, so the record stays continuous.

---

## 1. Background

The original was `QMon.bat`: a Windows batch file that pinged eight LHIO offices in
sequence, printed the date and time, and appended the raw output to `QM.txt`.

```bat
@echo off
:loop
date /t >> C:\temp\QM.txt
time /t >> C:\temp\QM.txt
echo ANTIQUE >> C:\temp\QM.txt
ping 172.24.142.144 >> C:\temp\QM.txt
...
```

### 1.1 The problems with it

| | |
| --- | --- |
| **P1** | Sequential. Eight sites, each waiting for the last, so one unreachable office delayed everything behind it. |
| **P2** | Write-only. `QM.txt` grew without bound and could not be searched, filtered or summarised. |
| **P3** | No status model. A person had to read ping output to decide whether a site was up. |
| **P4** | Targets were in the code. Adding an office meant editing a batch file. |
| **P5** | One system only. The queueing system was hard-coded; the other four were not monitored at all. |
| **P6** | No history worth the name. Nobody could answer "how much of last month was Bacolod down?" |
| **P7** | The paper form was filled in by hand from the log. |

## 2. Goals

| | |
| --- | --- |
| **G1** | Show current status for every site at a glance. |
| **G2** | Check all sites without one blocking another. |
| **G3** | Keep a searchable, filterable history that mirrors the paper form. |
| **G4** | Let an operator manage systems and sites without touching code. |
| **G5** | Produce the monthly figures — uptime, outages, recovery time — automatically. |
| **G6** | Record what changed and when. |
| **G7** | Export in the formats the office already uses. |
| **G8** | Work on a phone as well as on the PC in the office. |

### 2.1 Non-goals

Alerting on thresholds other than up/down. Configuration management. Anything
resembling a full NMS. This is a monitoring form that keeps itself.

## 3. Users

**The duty operator.** Opens the dashboard in the morning, wants to know what is
broken, and writes what they did about it into the form.

**The office head.** Wants last month's uptime per site, once a month, in a form
that can be printed.

**Whoever set it up.** Wants it not to need them again.

## 4. Functional requirements

**FR-1 Systems.** A system is a service every site runs a copy of, and owns the
check method used for its sites. Create, edit, reorder, deactivate, delete. Deleting
one that still has sites must ask what happens to them.

**FR-2 Sites.** One record per site per system, with name, address, coordinates and
region. Create, edit, reorder, deactivate, delete. Deactivating must not affect the
same office's other systems.

**FR-3 Checks.** Every check records the time, whether it passed, packet counts,
loss, latency, HTTP status where applicable, the full transcript, and a derived
status.

**FR-4 Status model.** `Down` when a check fails; `Restored` when a check passes and
the previous one failed; `Functional` otherwise. An operator may override a status,
and the record must show that they did.

**FR-5 Dashboard.** Map and list views, filterable by system, with counts of
functional, down and unchecked sites and the time of the last sweep. A pin must
convey both health and system identity.

**FR-6 History.** The paper form: a numbered row per check with site, address,
system, date, a functional mark, issues, status and remarks. Filter by text, date
range, site, system and status. Issues, remarks and status editable in place.
Paginated.

**FR-7 Analytics.** Over a date range: overall uptime, outage count and duration,
mean time to recovery, average latency, daily uptime, and uptime by system and by
site. An outage still open must be shown as such and excluded from the recovery
average.

**FR-8 Activity.** Sweeps, status crossings, record edits, and site, system and
settings changes, with severity, grouped by day and filterable. Only crossings, not
the steady state.

**FR-9 Export.** The monitoring form as CSV and as a printable document, the legacy
`QM.txt` block format, and the complete dataset in a form that can be read back.

## 5. Non-functional requirements

| | |
| --- | --- |
| **NFR-1** | No installation. Opening the application must be the whole procedure. |
| **NFR-2** | Usable on a phone: touch targets, no horizontal scrolling of the page, no trapped scroll. |
| **NFR-3** | Light and dark, following the operating system, with no flash of the wrong theme. |
| **NFR-4** | Keyboard-navigable throughout; colour never the only carrier of meaning. |
| **NFR-5** | Data must be exportable and re-importable in a format a person can read. |
| **NFR-6** | Degrade rather than break when a dependency or a browser capability is missing. |
| **NFR-7** | Honest about its own limits in the interface, not only in the documentation. |

## 6. Technical approach

HTML, CSS and JavaScript, hand-written, with no build step and no package manager.
Ordered classic `<script>` tags rather than ES modules, so the application can be
opened from the filesystem. One external file: Leaflet 1.9.4 from a CDN with
subresource integrity, for the map. State in browser storage, serialised as
tab-separated text.

## 7. Data model

Five tables: `system_types`, `locations`, `checks`, `activity` and a key/value
`settings`. Specified column by column in [DATA-FORMAT.md](DATA-FORMAT.md).

Display fields that could be denormalised — the system's name on a location, the
site's name on a check — are joined on read rather than stored, so there is never a
copy to keep in step.

## 8. Seed data

Five systems: Queueing System (ping), Nclaims, Mcris, Pmais, Ipas (HTTP). Eight
sites, all on the queueing system: ANTIQUE, CAPIZ, BACOLOD, KABANKALAN, SARA,
PASSI, AKLAN, GUIMARAS, with their addresses and approximate municipal coordinates.

## 9. Design language

Warm neutrals rather than white; one clay accent used for the single primary action
on a screen; four health colours and eight categorical system colours that never
overlap; blurred translucent panels over a soft radial wash; one spring easing
curve. Breakpoints at 640, 768, 1024 and 1280, each with one job. Tokens are the
only place a colour literal appears.

---

# 10. Version 3.0 — the same product with the server taken away

## Why

The previous build worked, and the cost of it working was Python, Node, a virtual
environment, a build step, a database file, a background process and a launcher that
existed to hide all of that. Every one of those is a thing that can be missing on
the machine that needs it, and the launcher had already grown code to install Python
on the operator's behalf.

The question this version answers: how much of SysMon survives if there is no server
at all? The answer turned out to be all of the product and none of the network
access — which is a clean split, and worth having made explicit.

## What changed

| | | |
| --- | --- | --- |
| **R28** | The stack is HTML, CSS and JavaScript with no build step. | Done |
| **R29** | Data is kept in browser storage and moves as `.txt` files. | Done |
| **R30** | The application opens from the filesystem by double-clicking `index.html`, and from a web server unchanged. | Done |
| **R31** | Check results are simulated, deterministically, and the interface says so. | Done |
| **R32** | Accounts, sign-in and password reset are removed. | Done |
| **R33** | SMTP settings and outage email are removed; desktop notifications replace them. | Done |
| **R34** | The TXT backup folder is removed; Export replaces it. | Done |
| **R35** | `.xlsx` export is replaced by CSV; PDF export is replaced by a print view. | Done |
| **R36** | The background scheduler becomes an in-tab timer, and says so where it is configured. | Done |
| **R37** | The map degrades to a coordinate-placed pin board when Leaflet is unavailable. | Done |
| **R38** | A fresh install generates six weeks of history so History and Analytics are not empty. | Done |

## Decisions worth recording

**Classic scripts, not ES modules.** `<script type="module">` is CORS-blocked on
`file://` with no workaround, so modules would have meant SysMon could only be
opened through a web server. The cost is an ordered list of script tags in
`index.html`; that list is the dependency graph, written down once, and it is the
price of NFR-1.

**The seed is JavaScript, not a fetched file.** Same reason: `fetch()` is blocked on
`file://`. The files in `data/` are sample exports and the format's reference, not
the source of the seed, so there is no pair of files to keep in sync.

**Simulated, and said out loud.** A browser cannot send an ICMP echo request. The
alternative to simulating was to remove monitoring entirely, or to fetch HTTP
targets and call a CORS-opaque response "up", which would have been a green
dashboard that means nothing. Simulation is stated in the README, on the Settings
page beside the options that shape it, and in this document.

**Deterministic, and outages as episodes.** Results are seeded by
`(salt, address, half-hour slot)`, so regenerating a month produces that month
again — a report that changed its own figures on reload would be worse than no
report. Keying continuity to a wall-clock slot rather than a sweep counter is what
lets the backfill and a live sweep agree about the same afternoon. Outages persist
across consecutive slots rather than being an independent coin flip per check,
because isolated failures make mean time to recovery meaningless and the uptime
chart a band of static.

**Read-time joins, and no cached denormalisation.** The previous build denormalised
display fields into its API responses to save a round trip. With no round trip to
save, the same fields are computed on read and memoised against a table revision
counter, which removes a whole class of stale-copy bug for no measurable cost.

**One transaction per sweep.** Writes go through a transaction that records which
tables it touched; nested calls join the outer one. A sweep writing forty checks and
forty activity rows costs one notification and one save. This is what makes the
subscribe-and-re-render model affordable without a virtual DOM.

**Native `<dialog>`.** It supplies the focus trap, initial focus, Escape, the inert
background and top-layer stacking above Leaflet — all of it known-hard to
reimplement and all of it already correct in the browser. A bottom sheet below
640px and a centred modal above it is the same element with different CSS.

**Native `<select>`, custom menus.** Every select in the application picks a value,
where native wins the phone wheel, the keyboard and the screen reader outright. The
row and export menus run a command, which is a different thing, so they are
`role="menu"` with roving focus on a shared anchored-layer primitive.

**Rows are patched where focus lives.** History and Locations diff rows by a cheap
signature and swap only what changed, because a sweep landing mid-sentence must not
take the caret out of a remark someone is typing. Everywhere else, replacing a
section's `innerHTML` is simpler and is what is used.

**The dashboard rail never moves in the DOM.** Three layouts — floating over the map
at 1280px, a column beside it at 1024px, a card grid below — are all CSS on one
element in one position. Moving the node on resize would force Leaflet to re-measure
mid-transition, which is how you get a grey half-rendered map.

**The sweep button waits.** The simulated probe is instantaneous, and a button
labelled "Check All Now" that answers in the same frame reads as a button that did
nothing. The pins pulse for roughly as long as the configured packet count and
timeout say a real sweep would have taken.

## Deliberate non-goals

**A service worker.** It would let sweeps run with the tab closed, and it would
require a served origin — breaking NFR-1 — while adding a cache-invalidation story
to a project whose main virtue is that it has none. The Settings card is honest
about the timer's limits instead.

**The File System Access API for real `.txt` files on disk.** Chrome and Edge only,
with a permission prompt every session. Export and Import cover the same need
everywhere.

**A zip of the export.** Writing a valid archive by hand is a few hundred lines of
CRC and header packing. Five files a person can open in Notepad is a better answer
than one they cannot.

**Reinstating email by way of a third-party mail API.** It would need a key in the
page, which is the same as publishing it, and the point of this version is to have
no server-side secrets because there is no server side.

**Licensing and copy protection.** The previous build carried a design document for
it. The deliverable here is its own source, served from a public repository; there
is nothing to protect and pretending otherwise would be theatre.
