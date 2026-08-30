# The probe agent

**Version 1 · Implemented**

SysMon is a web page. A web page cannot send an ICMP echo request — there is no raw
socket in a browser — so for the whole life of this build the check results were
simulated, and the interface said so.

The probe agent is the small program that lets it stop. `SysMon.bat` starts it,
it serves the SysMon folder and answers probes, and the page uses it when it is
there. When it is not, SysMon simulates and says which is which. Nothing about the
static build's promise changes: there is still nothing to install.

---

## 1. Running it

```
SysMon.bat              this PC only, port 8765
SysMon.bat 9000         a different port
SysMon.bat --lan        also reachable from phones on the same Wi-Fi
SysMon.bat 9000 --lan   both
```

The window that opens **is** the agent. Closing it stops the real checks. SysMon
keeps working and goes back to simulating them.

Port **8765**, not 8000, so the agent never collides with the previous build's
FastAPI server. Both can run at once.

### Why it is written in PowerShell

Because PowerShell 5.1 ships with Windows, and `System.Net.NetworkInformation.Ping`
is in the framework that comes with it. The previous build needed a Python venv, a
`pip install` and an `npm run build` before it could ping anything; its own setup
notes budget about five minutes of installers, and its "Install Python" button does
not exist, so on a PC without Python on `PATH` the setup window simply fails.

Nothing here is downloaded and nothing is installed. The one thing compiled at
startup is a four-line C# class, by the compiler already on the machine — see §5.

### `--lan`, and why it is not the default

The agent will ping any address it is asked to. On loopback that is a tool; on a
network it is an open ping proxy for anything that can reach the port. So the
default binds `localhost` and `127.0.0.1` only.

Windows will not let an ordinary user bind a non-loopback address, so `--lan` needs
either an Administrator window or a one-off grant. The agent prints the exact
command rather than the words "Access is denied":

```
netsh http add urlacl url=http://+:8765/ user=DOMAIN\username
```

---

## 2. Storage lives with the origin, and that will surprise someone

SysMon keeps everything in the browser's local storage, which is **per origin**.
These are three different origins and therefore three separate datasets:

| How it was opened | Origin |
| --- | --- |
| Double-clicking `index.html` | `file://` |
| Through the agent | `http://localhost:8765` |
| The published copy | `https://…github.io` |

So opening SysMon through `SysMon.bat` for the first time shows a fresh install
seeded from scratch, **not** the data from double-clicking `index.html`. Nothing is
lost; it is in the other origin's store. Export from one and Import into the other
is how data moves — that is what those buttons are for.

---

## 3. The protocol

Two endpoints. Both answer `Access-Control-Allow-Origin: *`, which is what lets a
page opened from `file://` — whose origin is the string `null` — talk to the agent
at all.

### `GET /api/health`

```json
{
  "status": "ok",
  "agent": "sysmon-agent",
  "version": "1.0",
  "capabilities": ["ping", "http"],
  "host": "LAPTOP-KES7NBN0"
}
```

The handshake. The browser caches a positive answer for 30 seconds and a negative
one for 60 — present is trusted for longer than absent, because an agent that has
answered is unlikely to vanish within half a minute, while an agent that has not
answered is quite likely to have just been started by someone reading the message
telling them to start it.

### `POST /api/probe`

```json
{
  "run_id": "r-20260830-141500",
  "packets": 4,
  "timeout_ms": 1000,
  "targets": [
    { "id": 3, "host": "172.24.143.10", "method": "ping" },
    { "id": 9, "host": "172.24.143.10", "method": "http",
      "scheme": "https", "port": null, "path": "/", "expect_status": 200 }
  ]
}
```

`id` is SysMon's `location_id` and is the only correlation key. `packets` and
`timeout_ms` come straight from the Sweep options page, which is how those two
fields stopped being decoration and became the real ping arguments.

The request is sent as `Content-Type: text/plain;charset=UTF-8`. The body is JSON
and the agent reads it as JSON regardless — but only `text/plain` is on the CORS
safelist, and the difference is a preflight round trip on every sweep from a
`file://` page.

```json
{
  "agent": { "name": "sysmon-agent", "version": "1.0" },
  "at": "2026-08-30T14:15:03",
  "results": [
    { "id": 3, "ok": false, "method": "ping",
      "packets_sent": 4, "packets_lost": 4, "loss_pct": 100,
      "avg_latency_ms": null, "http_status": null,
      "raw_output": "Pinging 172.24.143.10 with 32 bytes of data:\nRequest timed out.\n…",
      "error": "Request timed out on every packet" }
  ]
}
```

**A result that is present but `ok: false` is a measured failure.** A result that is
*absent* was not measured at all, and SysMon simulates that row instead. Those are
different facts and the `source` column keeps them apart: an outage must never be
indistinguishable from an agent that went away.

Twelve targets per request, sent one batch after another. That is what makes a
partial answer possible — a batch that times out costs its own twelve sites and the
rest are still measured, which is reported as a partly simulated sweep rather than
as a failure.

### Pointing at an agent somewhere else

Set `agent_url` in the settings file (or `sysmon-settings.txt`) to something like
`http://192.168.1.50:8765`, and the page will use that instead of looking locally.
That is how a phone uses the PC's agent when it was not served by it.

---

## 4. What the measurements are

**Ping.** `Ping.SendPingAsync`, real ICMP. Packets go out one round at a time:
sequential within a host, because that is what `ping` does and what an average
latency means, and parallel across hosts, because forty offices checked one after
another is forty seconds nobody has. Worst case for a sweep is therefore
`packets × timeout`, which is exactly what the Sweep options page already predicts.

A site is functional if **any** packet came back. Total loss is down. Windows'
"Destination host unreachable" pseudo-replies are failures, not replies — the same
call the previous build's `pinger.py` made.

**HTTP.** `HttpClient`, redirects followed, functional only if the status equals the
system's `http_expect_status`. Answering `503` is a different fact from not
answering, and the transcript records which.

**The transcript is Windows `ping`'s own output**, rebuilt from the replies that
actually came back — `time<1ms` rather than a rounded-up `1ms`, real TTLs, the
summary lines in `ping`'s order. That text is an interface, not decoration:
`QM.txt` is read by things outside SysMon and has looked like this since the batch
file this application descends from.

---

## 5. What it will not do

Written down because a program that pings whatever it is told is worth being
explicit about.

- **No state.** No database, no files written, nothing remembered between requests.
  Everything SysMon knows stays in the browser.
- **Loopback unless asked otherwise.** See §1.
- **Targets are validated.** Anything that is not a host name or an IP literal is
  refused rather than resolved. Nothing here reaches a shell, but a target that is
  not a host means a bug somewhere upstream.
- **Requests are bounded.** 200 targets, 256KB of body, packets and timeouts clamped
  to the same ranges the Settings page enforces.
- **Static files come from the SysMon folder only.** Path containment is checked
  with the separator attached, so a sibling folder named `sysmon-static-backup`
  cannot be reached by a request that walks out of `sysmon-static`.
- **Anything unknown under `/api/` is a JSON 404**, never the index page. An API
  path that answers with HTML is a bug that takes an hour to find.
- **TLS certificates are not verified.** These are offices on a private network with
  self-signed certificates, and the question a monitor asks is "does the service
  answer", not "is its certificate any good" — the same choice `http_probe.py` made
  with `verify=False`.

  This is why a C# delegate is compiled at startup. The obvious `{ $true }`
  scriptblock cannot work: .NET invokes that callback on a worker thread where a
  PowerShell scriptblock has no runspace, so every HTTPS check fails with "There is
  no Runspace available to run scripts in this thread" — which reads exactly like
  the site being down.

- **One request at a time.** The listener is single-threaded, so a sweep in progress
  delays a file request behind it. For one operator and a page that is already
  loaded this is not worth the concurrency, and a probe is bounded by
  `packets × timeout` anyway.

---

## 6. What is still simulated, agent or no agent

**Backfilled history.** A fresh install generates six weeks of history so that
History and Analytics have something to show. Those rows are simulated and say so,
and they always will be — you cannot retroactively measure last month, and
pretending otherwise is the exact dishonesty the `source` column exists to prevent.

**Anything the agent did not answer for**, per row, per sweep.

**Everything, on the published copy.** A page served over `https` from a real host
may not fetch `http://localhost` — Chrome makes an exception for loopback, Firefox
and Safari do not, and a blocked request would be a console error on every sweep.
So the published copy does not look for an agent at all and behaves exactly as it
always has.

---

## 7. Troubleshooting

**"Port 8765 is already in use."** The agent is probably already running; look for
its window. Otherwise `SysMon.bat 8766`.

**Settings says simulated but the agent window is open.** Press **Check again** on
the Settings page. If it still says simulated, check the port in the agent's banner
matches the page's address.

**Every site went down the moment I started the agent.** Then the agent is working
and this PC cannot reach those addresses. That is the answer, not a fault — the
seeded sites are private LHIO addresses, and from anywhere else they are
unreachable. Point one at `127.0.0.1` to see the difference.

**A site is down here but fine in a browser.** Check the system's method. `ping`
only proves the box is powered on; a web system answering on a path is a different
question, which is what the `http` method is for. Firewalls also very commonly drop
ICMP while serving HTTP perfectly happily.

**Nothing about the agent appears at all.** It is not looked for over `https` on a
real host; see §6. Open it from the folder instead.
