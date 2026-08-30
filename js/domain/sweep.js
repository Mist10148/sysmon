/*
  The sweep engine.

  Be clear about what this is: a browser cannot send an ICMP echo request and
  cannot open a raw socket, so nothing here touches the network. The results are
  simulated. Everything downstream of them is real - the records are real
  records, the status derivation is the same code the previous build used, the
  outages in Analytics are computed from the stored rows, and an export is an
  export of what actually happened in this application.

  The simulation is built to be honest in two ways.

  It is deterministic. Every number comes from a stream seeded by the site's
  address and the time slot it falls in, so regenerating a month produces the
  same month. A monitoring report that changed its own figures on reload would
  be worse than useless.

  Outages are episodes, not noise. A naive coin flip per check gives 3% downtime
  spread as single failures, which makes mean-time-to-recovery meaningless and
  the daily uptime chart a flat band of static. Here an outage starts and then
  persists across consecutive 30-minute slots, so it has a beginning, a length
  and an end - the shape a real outage has.
*/
window.SM = window.SM || {};

SM.sweep = (function () {
  'use strict';

  /*
    Outage continuity is keyed to a wall-clock slot rather than to a sweep
    counter, so a site that is down stays down whether the next sweep comes two
    minutes or two hours later - and the backfill and the live sweep agree.
  */
  var SLOT_MS = 30 * 60 * 1000;
  /*
    A single episode runs 1 to 6 slots, so up to three hours. Measured downtime
    can exceed that: a fresh episode may start while one is still running, and
    the two chain. Over thirty days that produces a mean of about four and a half
    slots with the occasional eight-hour outage, which is the distribution a real
    network has and is the reason not to cap it.
  */
  var MAX_EPISODE = 6;
  var MEAN_EPISODE = 3;

  var running = false;

  function salt() { return SM.store.setting('seed_salt') || 'sysmon'; }

  function slotOf(date) { return Math.floor(date.getTime() / SLOT_MS); }

  /* Per-site character, stable for the life of the salt. */
  function reliability(ip) { return 0.965 + SM.rng.unit(salt() + '|rel|' + ip) * 0.033; }
  function baseLatency(ip) { return 16 + SM.rng.unit(salt() + '|lat|' + ip) * 92; }

  /*
    Is this site inside an outage at this slot?

    Rather than storing episode state, each slot is asked whether an episode
    started there, and the answer is checked back over the longest episode a site
    can have. Six lookups, no state, same answer every time.
  */
  function isDown(ip, slot) {
    var downtime = 1 - reliability(ip);
    var startChance = downtime / MEAN_EPISODE;
    for (var back = 0; back < MAX_EPISODE; back++) {
      var s = slot - back;
      var seed = salt() + '|ep|' + ip + '|' + s;
      if (SM.rng.unit(seed) >= startChance) continue;
      /* An episode did start at s. Does it still cover `slot`? */
      var length = 1 + Math.floor(SM.rng.unit(seed + '|len') * MAX_EPISODE);
      if (back < length) return true;
    }
    return false;
  }

  /* Latency drifts up during office hours, which is when anyone is looking. */
  function diurnal(hour) {
    if (hour >= 8 && hour <= 17) {
      var peak = 1 - Math.abs(hour - 13) / 5.5;
      return 22 * Math.max(0, peak);
    }
    return 0;
  }

  /* ---------- one probe ---------- */

  /*
    A measurement: what a check found, and nothing about the check record it
    will become. The simulator below and the probe agent both produce exactly
    this shape, which is what lets one builder write both kinds of row.
  */

  /*
    The deterministic simulated measurement.

    The order the stream is consumed in is part of the format: regenerating a
    month has to produce the same month, so the latency draw must come before
    the transcript, and the transcript must be built here rather than by the
    caller. Do not reorder these lines.
  */
  function simulate(location, system, at, options) {
    var opts = options || {};
    var packets = opts.packets || SM.store.settingInt('sweep_packets');
    var slot = slotOf(at);
    var down = opts.forceDown != null ? opts.forceDown : isDown(location.ip, slot);
    var method = system && system.check_method === 'http' ? 'http' : 'ping';

    var next = SM.rng.stream(salt() + '|run|' + location.ip + '|' + slot);
    var latency = null;
    var lost = 0;
    var httpStatus = null;
    var functional = !down;

    if (down) {
      lost = method === 'http' ? 1 : packets;
    } else {
      /* A quarter of the way to failure is still a working site, and it is the
         kind of detail that makes the numbers worth reading. */
      var lossy = next() < 0.055;
      if (lossy && method === 'ping' && packets > 1) lost = 1;
      var jitter = 0.86 + next() * 0.3;
      latency = Math.round((baseLatency(location.ip) + diurnal(at.getHours())) * jitter +
        (lossy ? 45 : 0));
      if (method === 'http') {
        /* An HTTP system can answer and still answer wrongly. */
        var wrong = next() < 0.012;
        if (wrong) {
          httpStatus = SM.rng.pick(next, [500, 502, 503, 504]);
          functional = false;
          lost = 1;
        } else {
          httpStatus = (system && system.http_expect_status) || 200;
        }
      }
    }

    var packetsSent = method === 'http' ? 1 : packets;
    var lossPct = packetsSent ? Math.round((lost / packetsSent) * 1000) / 10 : 0;

    return {
      source: 'sim',
      method: method,
      functional: functional,
      packets_sent: packetsSent,
      packets_lost: lost,
      loss_pct: lossPct,
      avg_latency_ms: functional ? latency : null,
      http_status: httpStatus,
      issues: null,
      raw_output: method === 'http'
        ? httpTranscript(location, system, functional, httpStatus, latency)
        : pingTranscript(location, packetsSent, lost, latency, next)
    };
  }

  /*
    Turns a measurement into a check row without an id. `previousStatus` decides
    Functional vs Restored and nothing else.

    This is the only place a check row is shaped, so a measured row and a
    simulated one cannot drift apart in the columns that matter.
  */
  function buildRow(location, system, at, previousStatus, m, options) {
    var opts = options || {};
    var functional = !!m.functional;
    var lossPct = m.loss_pct == null
      ? (m.packets_sent ? Math.round((m.packets_lost / m.packets_sent) * 1000) / 10 : 0)
      : m.loss_pct;

    return {
      run_id: opts.runId || '',
      location_id: location.id,
      checked_at: SM.fmt.iso(at),
      check_method: m.method,
      functional: functional,
      packets_sent: m.packets_sent,
      packets_lost: m.packets_lost,
      loss_pct: lossPct,
      avg_latency_ms: functional ? m.avg_latency_ms : null,
      http_status: m.http_status == null ? null : m.http_status,
      status: SM.status.derive(functional, previousStatus),
      status_overridden: false,
      issues: functional ? '' : (m.issues || describeFailure(m.method, m.http_status, lossPct)),
      remarks: '',
      /* Measured or simulated. Never inferred later: a real outage and an
         agent that stopped answering must not be indistinguishable. */
      source: m.source === 'live' ? 'live' : 'sim',
      raw_output: m.raw_output || ''
    };
  }

  /*
    The simulated probe, as one call. The backfill runs this thousands of times
    inside one loop, so it stays synchronous and stays simulated: you cannot
    retroactively measure last month, and pretending otherwise is the exact
    dishonesty the source column exists to prevent.
  */
  function probe(location, system, at, previousStatus, options) {
    return buildRow(location, system, at, previousStatus,
                    simulate(location, system, at, options), options);
  }

  function describeFailure(method, httpStatus, lossPct) {
    if (method === 'http') {
      return httpStatus
        ? 'Answered HTTP ' + httpStatus + ' instead of the expected status'
        : 'No response from the web service';
    }
    return lossPct >= 100
      ? 'Request timed out on every packet'
      : 'Packet loss at ' + lossPct + '%';
  }

  /* ---------- the transcripts ---------- */

  /*
    Windows `ping` output, reproduced closely enough that the QM.txt export is
    the same shape as the one the old batch file wrote. Things outside SysMon
    read that file, so its contents are an interface.
  */
  function pingTranscript(location, sent, lost, latency, next) {
    var lines = ['Pinging ' + location.ip + ' with 32 bytes of data:'];
    var received = sent - lost;
    var times = [];

    for (var i = 0; i < sent; i++) {
      if (i < received) {
        var t = Math.max(1, Math.round(latency * (0.9 + next() * 0.2)));
        times.push(t);
        lines.push('Reply from ' + location.ip + ': bytes=32 time=' + t + 'ms TTL=124');
      } else {
        lines.push('Request timed out.');
      }
    }

    lines.push('');
    lines.push('Ping statistics for ' + location.ip + ':');
    var pct = Math.round((lost / sent) * 100);
    lines.push('    Packets: Sent = ' + sent + ', Received = ' + received +
      ', Lost = ' + lost + ' (' + pct + '% loss),');

    if (times.length) {
      var min = Math.min.apply(null, times);
      var max = Math.max.apply(null, times);
      var avg = Math.round(times.reduce(function (a, b) { return a + b; }, 0) / times.length);
      lines.push('Approximate round trip times in milli-seconds:');
      lines.push('    Minimum = ' + min + 'ms, Maximum = ' + max + 'ms, Average = ' + avg + 'ms');
    }
    return lines.join('\n');
  }

  function httpTranscript(location, system, functional, httpStatus, latency) {
    var scheme = (system && system.http_scheme) || 'http';
    var port = system && system.http_port ? ':' + system.http_port : '';
    var path = (system && system.http_path) || '/';
    var url = scheme + '://' + location.ip + port + path;
    var lines = ['GET ' + url];

    if (!functional && !httpStatus) {
      lines.push('');
      lines.push('curl: (28) Connection timed out after ' +
        SM.store.settingInt('sweep_timeout_ms') + ' ms');
      return lines.join('\n');
    }

    var text = { 200: 'OK', 500: 'Internal Server Error', 502: 'Bad Gateway',
                 503: 'Service Unavailable', 504: 'Gateway Timeout' }[httpStatus] || 'OK';
    lines.push('< HTTP/1.1 ' + httpStatus + ' ' + text);
    lines.push('< server: nginx');
    lines.push('< content-type: text/html; charset=utf-8');
    lines.push('');
    lines.push('time_total=' + ((latency || 0) / 1000).toFixed(3) + 's');
    return lines.join('\n');
  }

  /* ---------- a whole sweep ---------- */

  /*
    options: { locationIds, at, quiet }
    Everything is written in one transaction, so forty sites cost one render.
  */
  function run(options) {
    var opts = options || {};
    if (running) return null;
    running = true;

    try {
      var at = opts.at || new Date();
      var runId = SM.ids.runId(at);
      var latest = SM.queries.latestByLocation();
      var systems = {};
      var all = SM.store.get().system_types;
      for (var s = 0; s < all.length; s++) systems[all[s].id] = all[s];

      var targets = [];
      var locations = SM.store.get().locations;
      for (var i = 0; i < locations.length; i++) {
        var loc = locations[i];
        if (opts.locationIds) {
          if (opts.locationIds.indexOf(loc.id) === -1) continue;
        } else {
          if (!loc.active) continue;
          var system = systems[loc.system_type_id];
          if (!system || !system.active) continue;
        }
        targets.push(loc);
      }

      var checks = [];
      var transitions = [];
      var functional = 0, down = 0;

      for (var t = 0; t < targets.length; t++) {
        var target = targets[t];
        var sys = systems[target.system_type_id];
        var previous = latest[target.id] ? latest[target.id].status : null;
        var check = probe(target, sys, at, previous, { runId: runId });
        checks.push(check);
        if (check.functional) functional++; else down++;

        if (SM.status.isTransition(previous, check.status)) {
          transitions.push(buildTransition(target, sys, check, previous, latest, runId));
        }
      }

      var result = { runId: runId, at: SM.fmt.iso(at), targets: targets.length,
                     functional: functional, down: down,
                     checks: checks, transitions: transitions };

      if (!checks.length) { running = false; return result; }

      SM.store.tx('sweep', function () {
        SM.mutate.addChecks(checks);
        var entries = transitions.slice();
        if (!opts.quiet) {
          entries.unshift({
            at: SM.fmt.iso(at), kind: 'sweep', action: 'sweep.run', severity: 'info',
            subject: 'Checked ' + SM.fmt.plural(targets.length, 'site'),
            detail: functional + ' functional, ' + down + ' down',
            run_id: runId
          });
        }
        SM.activityLog.writeMany(entries);
      });

      if (SM.notify) SM.notify.announce(transitions);
      return result;
    } finally {
      running = false;
    }
  }

  /*
    A Down or Restored entry. For a recovery it also says how long the site was
    out, which is the one number an operator is asked for afterwards.
  */
  function buildTransition(location, system, check, previous, latest, runId) {
    var systemName = system ? system.name : 'Unassigned';
    if (check.status === 'Down') {
      return {
        at: check.checked_at, kind: 'status', action: 'status.down', severity: 'critical',
        subject: location.name + ' went down',
        detail: systemName + ' - ' + check.issues + ' on ' + location.ip,
        location_id: location.id, system_type_id: location.system_type_id, run_id: runId
      };
    }

    var since = firstDownSince(location.id, check.checked_at);
    var out = since
      ? 'down for ' + SM.fmt.duration(SM.fmt.parse(check.checked_at) - SM.fmt.parse(since))
      : 'back up';
    return {
      at: check.checked_at, kind: 'status', action: 'status.restored', severity: 'success',
      subject: location.name + ' is back',
      detail: systemName + ' - ' + out + ', now ' + SM.fmt.latency(check.avg_latency_ms),
      location_id: location.id, system_type_id: location.system_type_id, run_id: runId
    };
  }

  /* When the outage that just ended began. */
  function firstDownSince(locationId, before) {
    var list = SM.store.get().checks;
    var start = null;
    for (var i = list.length - 1; i >= 0; i--) {
      var row = list[i];
      if (row.location_id !== locationId) continue;
      if (row.checked_at >= before) continue;
      if (row.status === 'Down') start = row.checked_at;
      else break;
    }
    return start;
  }

  function isRunning() { return running; }

  return {
    run: run, probe: probe, simulate: simulate, buildRow: buildRow,
    isDown: isDown, slotOf: slotOf, isRunning: isRunning, SLOT_MS: SLOT_MS
  };
})();
