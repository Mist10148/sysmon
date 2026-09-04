# SysMon — System Monitoring

Monitoring for the LHIO systems across Western Visayas: a status map, the paper
monitoring form filled in for you, uptime analytics, and a log of everything that
happened. It is one HTML file, some CSS, some JavaScript, and a PowerShell script
that does the pinging.

> **Where this came from.** The original was `QMon.bat`, a Windows batch file that
> pinged eight offices one after another and appended the output to `QM.txt`. That
> became SysMon: a React front end over a FastAPI service with a SQLite database, a
> background scheduler and an installer. This is the same application again with all
> of that taken away — no server, no database, no build step, nothing to install —
> but with the one thing `QMon.bat` had and a web page cannot: it really does ping
> the offices. Double-click `SysMon.bat` and it runs.

**Live:** <https://mist10148.github.io/sysmon/>

---

## What it does

| | |
| --- | --- |
| **Status map** | Every site as a pin on a map of Western Visayas. The pin's body is its health; its collar is which system it belongs to, so one glyph answers both questions without a legend. |
| **Systems, not servers** | A system is a service every office runs a copy of — the queueing system, Nclaims, Mcris, Pmais, Ipas. Each one owns the question asked of its sites: ping this address, or fetch this path and expect this status. |
| **Sites per system** | One row per office per system, managed in a table rather than in code. BACOLOD running the queueing system and BACOLOD running Nclaims are two rows, because they fail independently. |
| **The monitoring form** | The paper form the office already keeps, filled in automatically. Issues and Remarks are editable in place; the measurements are not. |
| **Uptime analytics** | Overall uptime, outage count, mean time to recovery, average latency, a daily uptime chart, and uptime broken down by system and by site — worst first. |
| **Outage list** | Every run of failed checks, with when it started, when it recovered, how long it lasted, and how many checks failed. Anything still down is listed first. |
| **Activity log** | A diary of sweeps, outages, recoveries, edits and settings changes. Grouped by day, with the day heading pinned to the top of the scroll. |
| **Search and sort** | Multi-word search on every list, sortable columns on a desktop and a sort control in the toolbar on a phone, manual ordering with arrows. |
| **Exports** | CSV for Excel, a printable form for paper or PDF, the legacy `QM.txt` block format, and the five `.txt` data files. |
| **Data in text files** | Everything lives in this browser and leaves as tab-separated `.txt` you can read in Notepad. Import reads them back. |
| **Desktop notifications** | Tells the machine running SysMon when a site goes down or comes back. |
| **Light and dark** | Follows the operating system by default, and keeps following it. |
| **Built for a phone** | Tables become card lists, dialogs become bottom sheets, the sidebar becomes a drawer, and the map hands one-finger scrolling back to the page. |

## Tech stack

**All of it.** HTML, CSS and JavaScript, hand-written, no build step — plus one
PowerShell script, the probe agent, which serves the folder and does the pinging.
PowerShell 5.1 and the framework it needs ship with Windows. One external file:
Leaflet 1.9.4 from a CDN, pinned with subresource integrity, for the map.

**None of this.** No framework, no bundler, no package manager, no `node_modules`,
no database, no Python, no virtualenv. There is nothing to install and nothing to
compile.

## Quick start

**To monitor for real, double-click `SysMon.bat`.** A window opens, your browser
opens on SysMon, and the checks are real ICMP and HTTP from this PC. That window is
the probe agent — leave it open; closing it stops the real checks. Nothing is
installed: it runs on the PowerShell that comes with Windows.

**Or just open `index.html`.** Everything works, except that the check results are
simulated rather than measured, and the interface says so on every screen that
shows one. It works by double-clicking the file from disk and it works served from
a web server; the scripts are ordinary `<script>` tags rather than ES modules
precisely so that the first of those is true.

The first time it opens, SysMon seeds itself with the five systems and eight sites
the previous build shipped with, and generates six weeks of history so the History
and Analytics pages have something real to show. Everything after that is yours.

To put it on a phone or tablet, open the Pages URL above, or run `SysMon.bat --lan`
and open the address the agent prints. See [docs/AGENT.md](docs/AGENT.md) for what
`--lan` needs.

> **One thing that catches everybody.** Data is kept per origin, so SysMon opened
> through `SysMon.bat` is a different store from SysMon opened by double-clicking
> `index.html`. The first time you use the launcher it will look like a fresh
> install, because for that origin it is. Nothing is lost — Export from one and
> Import into the other.

## What is measured, and what is not

**Be clear about this before relying on it.** Every check record says which it was,
in a `source` column that reads `live` or `sim`, and the interface says so wherever
it shows you a number. A green dashboard should never be able to imply something it
should not.

**Measured, when the probe agent is running.** Real ICMP and real HTTP from the PC
the agent is on. The packets-per-site and timeout on the Settings page are the
actual ping arguments, the transcript in the raw output dialog is the reply that
came back, and a site that shows 100% loss is a site that did not answer.

**Simulated, when it is not.** A web page cannot send an ICMP echo request — there
is no raw socket in a browser — so with no agent the answers come from a seeded
stream instead of the network. This is what the published copy above does, and what
double-clicking `index.html` does.

Three things stay simulated even with the agent running, and they are the ones
worth knowing about:

- **The six weeks of backfilled history** on a fresh install. You cannot
  retroactively measure last month.
- **Any site the agent did not answer for**, per row. An agent that stops answering
  half way through a sweep leaves the rest of that sweep simulated rather than
  losing it — and a partly simulated sweep says so in the toast, the activity log
  and the rows themselves. An outage and a helper that went away are different
  facts.
- **Everything on the published copy.** A page served over `https` may not fetch
  `http://localhost`, so it does not try.

The simulation itself is built to be honest in two ways, and both still matter
because it is what History is full of:

- **It is deterministic.** Every number comes from a stream seeded by the site's
  address and the half-hour slot it falls in, so regenerating a month gives the same
  month. A report that changed its own figures on reload would be worse than
  useless. Change `seed_salt` in the settings file to get a different month out of
  the same eight sites.
- **Outages are episodes, not noise.** A coin flip per check would give three per
  cent downtime scattered as isolated failures, which makes mean time to recovery
  meaningless and the uptime chart a band of static. Here an outage starts, persists
  across consecutive half-hour slots, and ends — so it has a length worth measuring.

**Everything built on either kind is real.** The records are real records, the
status derivation is the same code the previous build used, the outages on the
Analytics page are computed from the stored rows, and an export is an export of what
actually happened in this application.

The agent, its protocol and its limits are written up in
[docs/AGENT.md](docs/AGENT.md).

## Finding things in a long list

**Search takes several words, and means all of them.** Typing `sara queue` matches
a row only if both words appear somewhere in it. That is how a person narrowing a
list expects a second word to behave, and it is why there is no need for a filter
per column.

**Sort lives in two places, deliberately.** From 768 pixels up you click a column
header; a second click reverses it. Below that width the header row does not exist,
because the table has become a list of cards — so the same sort keys appear as a
select in the toolbar. Both write to the same place, so the two cannot disagree.

**Manual reordering switches itself off when it would be meaningless.** The up and
down arrows on Systems and Locations move a row within the saved order. While a
search is narrowing the list, or it is sorted by something other than that order,
moving row 3 above row 2 has no meaning — so the arrows go grey and say why rather
than reordering something you cannot see.

## Systems and sites

A **system** is a service. A **site** is one office running one system. The system
decides how its sites are checked:

| Method | What it asks | When to use it |
| --- | --- | --- |
| `ping` | Is anything at this address answering? | Network devices, terminals, the queueing displays. |
| `http` | Does the service answer on this path with this status? | Anything with a web front end. A ping only proves the box is powered on, which for a web system is not the question worth asking. |

Removing a system that still has sites asks what should happen to them —
deactivate it and keep everything, move its sites to another system, or delete it
and their history. Guessing would either orphan the sites or throw away records,
and neither can be undone.

Removing a site defaults to switching it off, which keeps its history and keeps
checking it for any other system it also runs. The toast that confirms it carries
an Undo. Deleting a site outright asks a second time.

## Your data

There is no database. Everything is kept in this browser's local storage, in the
same tab-separated text format that Export writes.

**Export** (Settings → Data) writes five files:

```
sysmon-system-types-20260828-1402.txt
sysmon-locations-20260828-1402.txt
sysmon-checks-20260828-1402.txt
sysmon-activity-20260828-1402.txt
sysmon-settings-20260828-1402.txt
```

Each is a comment header, a line naming the columns, and one record per line with
tabs between fields:

```
# SysMon - locations (site x system)
# @version 1
# @table locations
@columns	id	sort_order	system_type_id	name	ip	lat	lng	region	active
1	1	1	ANTIQUE	172.24.142.144	10.7402	121.9391	Region VI	yes
```

Tabs rather than CSV because the fields that most need to survive a round trip are
the free text an operator types into Issues and Remarks, and those are full of
commas and quotation marks. Quoting is the part of CSV that everyone implements
slightly differently; a tab is a character nobody types into a form.

**Import** reads them back. Files are identified by their own `@table` line rather
than by filename, so you can rename them, edit them in Notepad, drop them in any
order, or select only the two you actually changed — the tables you supply are
replaced and the rest are left alone. Nothing is written until every chosen file
has parsed, so a bad file cannot leave you holding half of one dataset and half of
another.

Sample files are in [`data/`](data/), and the format is specified in
[docs/DATA-FORMAT.md](docs/DATA-FORMAT.md).

**The limit worth knowing.** Browser storage is a few megabytes, and a check record
carries its full ping output. Six weeks of three-sweeps-a-day across eight sites is
about 1.2 MB, so there is plenty of room — but a year of five-minute sweeps would
not fit. Settings shows how much is being used, and the Activity page can prune
itself. Export before you prune.

**Storage is per browser, per device, and per origin.** Opening the same folder
from a different browser, or the Pages URL after using a local copy, is a different
store with its own data. **So is opening it through `SysMon.bat`**, which serves the
folder from `http://localhost:8765` rather than `file://` — the first launch will
look like a fresh install because for that origin it is. Export and Import are how
data moves between them.

## The pages

| Page | For |
| --- | --- |
| **Dashboard** | What is broken right now. Map or list, filtered by system, with the four numbers that matter and a Check All Now button. |
| **Systems** | What a system is and how its sites are checked. |
| **Locations** | One row per site per system, with a map you click to place them. |
| **History** | The monitoring form. Filter it, edit the two prose columns, export it. |
| **Analytics** | Uptime, outages, mean time to recovery and latency over a date range. |
| **Activity** | Everything that happened, by day. |
| **Settings** | Where the checks come from, the sweep schedule and options, your data, notifications, appearance. |

## What is different from the previous build

Everything above is the same product. These are the places where a static page
genuinely cannot do what a server did, and what happens instead:

| Removed | Why | Instead |
| --- | --- | --- |
| Accounts, sign-in, password reset | There is nobody to authenticate against and nowhere to keep a session. | Nothing. The application never needed an account to do its job; accounts existed to address email. |
| Email alerts and SMTP settings | A browser cannot speak SMTP, and there is no server to ask. | Desktop notifications, which reach whoever is at this machine — and, honestly, nobody who has gone home. |
| The TXT backup folder | A browser cannot write to a folder on its own schedule. | Export, which writes the same data when asked. The `QM.txt` block format is still one of the export options. |
| Real ping and HTTP probes *(back)* | A browser has no raw socket, so the page still cannot do it. | The probe agent does, in one PowerShell script rather than a venv and a pip install. Without it, deterministic simulated sweeps. See above. |
| `.xlsx` export | It needed a Python library, and no static page can honestly write a workbook. | CSV, which Excel opens directly. Not a file named `.xls` that is really HTML. |
| The background scheduler | Nothing runs when the tab is closed. The agent answers probes; it does not hold a schedule. | A timer in the tab. Automatic sweeps run while SysMon is open, including in the background, and the Settings card says exactly that. |
| PDF generation | It needed a PDF library. | A printable version of the form and the browser's own print dialog, where "Save as PDF" is a destination. |
| The installer | Nothing to install. | Nothing. `SysMon.bat` starts the agent from the PowerShell already on the machine — no venv, no `pip install`, no `npm run build`, and no five minutes of installers before the first ping. |
| Accounts and email as the reason for a server | — | The agent is not a server in that sense: no state, no database, nothing written to disk. |

## The look

The interface follows a set of mockups drawn for it, and the rules those
mockups settle are worth stating because they are what keep the screens
consistent:

- **Two colour vocabularies that never overlap.** Health - functional,
  restored, down, unknown - is the only family allowed to fill a badge. System
  identity is categorical and lives in a dot, never in a fill and never in the
  text colour, so a blue system is never mistaken for a healthy one.
- **Colour is never the only cue.** Every badge carries a word, every field
  error carries a glyph, and the four toast tones have four different
  silhouettes. A printed monitoring form is grey and still has to be readable.
- **Shape says what a thing does.** Commands are rounded rectangles; filters
  are pills. They were both pills once and read as interchangeable.
- **A map pin is a teardrop whose body is health and whose collar is the
  system.** The legend in the corner of the map says so out loud.
- **Where a number came from is part of the number.** Every page header can
  carry a provenance clause - "simulated, not measured" - set one step fainter
  than the sentence around it.
- **44px for a thumb, 38px for a pointer.** Buttons, fields, nav items and
  switches all carry both sizes.

Colour, radius, shadow and motion live in [`css/tokens.css`](css/tokens.css)
and nowhere else. If a component needs a shade that is not there, the shade is
missing from the system rather than from the component.

## Browser support

Anything current: Chrome, Edge, Firefox and Safari, on desktop and on a phone. The
features it leans on — CSS custom properties, `backdrop-filter`, native `<dialog>`,
`ResizeObserver` — have been widely available for several years.

Two things degrade rather than break:

- **No Leaflet.** If the CDN is unreachable the map becomes a plain grid with the
  same pins placed by their coordinates. It is not a map, and it says so, but the
  dashboard still shows which sites are down.
- **No storage.** In a private window, or with site data blocked, SysMon runs from
  the seed and the Settings page says plainly that nothing is being saved.

## Troubleshooting

**Nothing appears, or one page says its script did not load.** With no bundler,
each file is fetched on its own, so a missing or blocked file takes out exactly one
screen. Reload; if it persists, check that the file named in the message exists.

**The map is a grey box.** Leaflet or the tile server is unreachable. The pins
still work; see Browser support.

**Changes disappear when I reload.** Storage is not available — a private window,
or site data blocked for this origin. The Data card on Settings says so when this
is the case.

**"Storage is full."** Export your data, then prune. The Activity page prunes its
feed by date; the biggest consumer is usually check records with their ping output.

**Automatic sweeps are not running.** They only run while SysMon is open in a tab.
The status box under the switch says whether the timer is going.

**The printed form has a URL at the bottom.** That is the browser's own header and
footer, which a page cannot control. Switch them off in the print dialog.

**I get different data on my phone than on my PC.** Storage is per browser and per
device. Export from one and Import into the other.

**Settings says the checks are simulated, but I started `SysMon.bat`.** Press
**Check again** on the Settings page. If it still says simulated, check that the
port in the agent's window matches the address the page is open on. And note that
opening SysMon through the agent is a different origin from opening `index.html`,
so it has its own data.

**Every site went down the moment I started the agent.** Then the agent is working
and this PC cannot reach those addresses. The eight seeded sites are private LHIO
addresses; from anywhere else they are unreachable, and a monitor that said
otherwise would be the broken one. Point a site at `127.0.0.1` to see the
difference.

**A site is down in SysMon but fine in my browser.** Check which method its system
uses. A `ping` only proves the box is powered on, and plenty of firewalls drop ICMP
while serving HTTP perfectly happily — which is what the `http` method is for.

More in [docs/AGENT.md](docs/AGENT.md).

## Documentation

- [docs/PRD.md](docs/PRD.md) — what this is for, what it must do, and the record of
  what changed in the rewrite and why.
- [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md) — the `.txt` format, column by column.
- [docs/AGENT.md](docs/AGENT.md) — the probe agent: running it, its protocol, what
  it measures and what it refuses to do.
- [docs/PHASE_TASKS.md](docs/PHASE_TASKS.md) — how it was built, in order.

## Licence

MIT. See [LICENSE](LICENSE).
