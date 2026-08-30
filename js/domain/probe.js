/*
  The probe agent transport.

  This is the only module that knows a probe agent can exist. Everything else
  asks it for measurements and is told either "here they are" or "there is no
  agent" - and the sweep engine decides what to do about that.

  Two rules shape the whole file.

  It never rejects. detect() and measureAll() always resolve. An agent that is
  not running, a request that times out half way through, a reply that is not
  the JSON it should be: all of those are ordinary answers, not errors. A
  monitoring dashboard that stops monitoring because its optional helper went
  away would be worse than one that never had a helper.

  A missing measurement is not a failed check. If the agent does not answer for
  a site, that site has not been measured, and the caller simulates it and marks
  the row as simulated. What must never happen is a real-looking Down record
  invented out of a transport failure: an outage and a helper that went away are
  different facts, and telling them apart afterwards is the entire reason the
  source column exists.
*/
window.SM = window.SM || {};

SM.probe = (function () {
  'use strict';

  var PORT = 8765;

  /*
    Detection is cached, because it is on the path of every sweep and every
    render of the Settings page. Present is trusted for longer than absent is:
    an agent that has answered is very unlikely to have vanished within thirty
    seconds, and an agent that has not answered is quite likely to have just
    been started by someone reading the message telling them to start it.
  */
  var OK_TTL_MS = 30000;
  var MISS_TTL_MS = 60000;
  var FIRST_TIMEOUT_MS = 1500;
  var RECHECK_TIMEOUT_MS = 800;

  /*
    Targets per request. This is what makes a partial result possible: a batch
    that times out costs its own twelve sites and no more, and the sites in
    every other batch are still measured. Batches run one after another because
    an office PC firing forty concurrent probes is a worse citizen than one
    making four round trips; the agent fans out within a batch.
  */
  var BATCH = 12;

  /* A ping transcript is a few hundred bytes; something is wrong past this,
     and check rows live in a storage quota measured in megabytes. */
  var MAX_RAW_OUTPUT = 8192;

  var cache = null;      /* { at, available, agent, reason, base } */
  var inflight = null;   /* the detect() in progress, so N callers make 1 request */
  var bus = SM.emitter.create();

  /* ---------- where the agent is ---------- */

  /*
    The addresses worth trying, in order.

    Same-origin first whenever the page was served over http, because if the
    agent served this page then its API is right here - no CORS, no preflight,
    and it works from a phone on the LAN, which a hardcoded localhost never
    could. Then localhost on the default port, which is the file:// case and
    the case where some other local server is serving the folder.
  */
  function candidates() {
    var override = SM.store && SM.store.setting ? SM.store.setting('agent_url') : '';
    if (override) return [String(override).replace(/\/+$/, '')];

    var loc = window.location;
    var localhost = 'http://localhost:' + PORT;

    if (loc.protocol === 'file:') return [localhost];

    var isLocal = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' ||
                  loc.hostname === '[::1]';

    /*
      An https page may not fetch http://localhost. Chrome makes an exception
      for loopback, Firefox and Safari do not, and a blocked request is a
      console error on every single sweep. So the Pages deployment does not
      look for an agent at all, and behaves exactly as it does today.
    */
    if (loc.protocol === 'https:' && !isLocal) return [];

    return ['', localhost];
  }

  function reasonOf(err) {
    var message = String(err && err.message || err);
    if (message === 'timeout') return 'timeout';
    if (/^HTTP /.test(message)) return 'http';
    return 'unreachable';
  }

  /* ---------- one request ---------- */

  /*
    fetch with a deadline. AbortController is the mechanism, but the timer
    rejects on its own account too, so a browser without it still gets a
    bounded wait rather than an open one.
  */
  function request(method, url, body, timeoutMs) {
    var controller = null;
    if (window.AbortController) {
      try { controller = new AbortController(); } catch (err) { controller = null; }
    }

    var options = { method: method, credentials: 'omit', cache: 'no-store' };
    if (controller) options.signal = controller.signal;
    if (body != null) {
      options.body = JSON.stringify(body);
      /*
        Deliberately not application/json. That content type is not on the CORS
        safelist, so it turns every sweep from a file:// page into a preflight
        and then a POST. text/plain is safelisted, the body is still JSON, and
        the agent parses it as JSON regardless of what this header claims.
      */
      options.headers = { 'Content-Type': 'text/plain;charset=UTF-8' };
    }

    var timer = null;
    return new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (err) { /* already gone */ } }
        reject(new Error('timeout'));
      }, timeoutMs);

      fetch(url, options).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      }).then(resolve, reject);
    }).then(function (value) {
      clearTimeout(timer);
      return value;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ---------- detection ---------- */

  function fresh() {
    if (!cache) return false;
    var ttl = cache.available ? OK_TTL_MS : MISS_TTL_MS;
    return (new Date().getTime() - cache.at) < ttl;
  }

  function remember(state) {
    var changed = !cache || cache.available !== state.available;
    cache = state;
    if (changed) bus.emit('probe');
    return state;
  }

  /*
    Is there an agent, and where? Resolves with the cache entry, always.
    options: { force } to ignore a cached answer - what the Settings page's
    "Check again" button does.
  */
  function detect(options) {
    var force = options && options.force;
    if (force) cache = null;
    if (!force && fresh()) return Promise.resolve(cache);
    if (inflight) return inflight;

    var bases = candidates();
    var at = new Date().getTime();

    if (!bases.length) {
      /* Nothing to try, and nothing to retry either. */
      return Promise.resolve(remember({
        at: at, available: false, agent: null, reason: 'https', base: null
      }));
    }

    var timeout = cache ? RECHECK_TIMEOUT_MS : FIRST_TIMEOUT_MS;

    /* Try each address in turn; the first that answers wins. */
    function attempt(index, lastReason) {
      if (index >= bases.length) {
        return Promise.resolve(remember({
          at: new Date().getTime(), available: false, agent: null,
          reason: lastReason || 'unreachable', base: null
        }));
      }
      var base = bases[index];
      return request('GET', base + '/api/health', null, timeout).then(function (body) {
        return remember({
          at: new Date().getTime(), available: true, base: base, reason: null,
          agent: {
            name: body && body.agent ? String(body.agent) : 'sysmon-agent',
            version: body && body.version ? String(body.version) : '?',
            host: body && body.host ? String(body.host) : '',
            capabilities: body && body.capabilities ? body.capabilities : ['ping']
          }
        });
      }, function (err) {
        return attempt(index + 1, reasonOf(err));
      });
    }

    inflight = attempt(0, null).then(function (state) {
      inflight = null;
      return state;
    }, function (err) {
      /* Cannot happen - attempt() resolves - but a thrown detect would be a
         rejection nobody is handling, so it is closed off here. */
      inflight = null;
      return remember({
        at: new Date().getTime(), available: false, agent: null,
        reason: reasonOf(err), base: null
      });
    });

    return inflight;
  }

  /* A synchronous snapshot for render paths. Null means "never looked". */
  function status() { return cache; }

  /* Forget what we know, so the next detect() actually asks. */
  function forget() { cache = null; }

  function describe() {
    if (!cache) return 'Not checked yet';
    if (cache.available) {
      return 'Measuring for real' +
        (cache.agent && cache.agent.version ? ' · agent ' + cache.agent.version : '');
    }
    if (cache.reason === 'https') return 'Not available over https';
    return 'No probe agent is running';
  }

  /* ---------- targets ---------- */

  /*
    The wire form of one site. The single place that knows how a system type's
    http_* columns map onto what the agent is asked for.
  */
  function targetFor(location, system) {
    var method = system && system.check_method === 'http' ? 'http' : 'ping';
    var target = { id: location.id, host: location.ip, method: method };
    if (method === 'http') {
      target.scheme = (system && system.http_scheme) || 'http';
      target.port = system && system.http_port ? system.http_port : null;
      target.path = (system && system.http_path) || '/';
      target.expect_status = (system && system.http_expect_status) || 200;
    }
    return target;
  }

  /* ---------- reading a reply ---------- */

  function number(value) {
    if (value == null || value === '') return null;
    var n = Number(value);
    return isNaN(n) ? null : n;
  }

  /*
    Turn one agent result into a measurement of exactly the shape
    SM.sweep.simulate() produces, so SM.sweep.buildRow() cannot tell them apart.

    Everything is coerced rather than trusted. The agent is a local program a
    person can edit, and a bad number here becomes a permanent record in the
    monitoring form.
  */
  function toMeasurement(result) {
    if (!result || result.id == null) return null;

    var method = result.method === 'http' ? 'http' : 'ping';
    var sent = number(result.packets_sent);
    var lost = number(result.packets_lost);
    if (sent == null || sent < 0) sent = method === 'http' ? 1 : 0;
    if (lost == null || lost < 0) lost = 0;
    if (lost > sent) lost = sent;

    var loss = number(result.loss_pct);
    if (loss == null) loss = sent ? Math.round((lost / sent) * 1000) / 10 : 0;
    if (loss < 0) loss = 0;
    if (loss > 100) loss = 100;

    var functional = !!result.ok;
    var raw = result.raw_output == null ? '' : String(result.raw_output);
    if (raw.length > MAX_RAW_OUTPUT) raw = raw.slice(0, MAX_RAW_OUTPUT) + '\n[truncated]';

    return {
      source: 'live',
      method: method,
      functional: functional,
      packets_sent: sent,
      packets_lost: lost,
      loss_pct: loss,
      avg_latency_ms: functional ? number(result.avg_latency_ms) : null,
      http_status: number(result.http_status),
      /* The agent's own words when it has any; buildRow falls back to the
         same describeFailure() the simulation uses. */
      issues: functional ? null : (result.error ? String(result.error) : null),
      raw_output: raw
    };
  }

  /* ---------- measuring ---------- */

  function chunk(list, size) {
    var out = [];
    for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  /*
    How long to wait for one batch. Derived from what was asked for rather than
    fixed, because "20 packets at 20 seconds each" is a legitimate setting and
    a fixed ceiling would abandon a sweep that was working.
  */
  function budgetFor(batch, packets, timeoutMs) {
    var worst = packets * timeoutMs * 1.6 + 2000;
    if (worst < 4000) worst = 4000;
    if (worst > 120000) worst = 120000;
    return Math.round(worst);
  }

  /*
    targets: from targetFor(), in any number.
    options: { packets, timeout_ms, runId }

    Resolves with:
      available    was there an agent at all
      agent        its name and version, or null
      measurements { locationId: measurement } - only what was measured
      degraded     true if an agent answered for some targets but not all
      errors       what went wrong, for the log rather than for the operator
  */
  function measureAll(targets, options) {
    var opts = options || {};
    var empty = { available: false, agent: null, measurements: {},
                  degraded: false, errors: [] };

    if (!targets || !targets.length) return Promise.resolve(empty);
    if (!window.fetch || !window.Promise) return Promise.resolve(empty);

    return detect().then(function (state) {
      if (!state.available) return empty;

      var packets = opts.packets || SM.store.settingInt('sweep_packets');
      var timeout = opts.timeout_ms || SM.store.settingInt('sweep_timeout_ms');
      var batches = chunk(targets, BATCH);
      var measurements = {};
      var errors = [];

      /* One batch at a time, and a failure moves on to the next rather than
         abandoning the sites that have not been tried yet. */
      function step(index) {
        if (index >= batches.length) {
          var measured = Object.keys(measurements).length;
          return {
            available: true,
            agent: state.agent,
            measurements: measurements,
            degraded: measured > 0 && measured < targets.length,
            errors: errors
          };
        }

        var batch = batches[index];
        var body = { run_id: opts.runId || '', packets: packets,
                     timeout_ms: timeout, targets: batch };

        return request('POST', state.base + '/api/probe', body,
                       budgetFor(batch, packets, timeout))
          .then(function (reply) {
            var results = reply && reply.results ? reply.results : [];
            var wanted = {};
            for (var w = 0; w < batch.length; w++) wanted[batch[w].id] = true;

            for (var r = 0; r < results.length; r++) {
              var measurement = toMeasurement(results[r]);
              /* A result for something we did not ask about is dropped rather
                 than written to whatever row happens to share its id. */
              if (!measurement || !wanted[results[r].id]) continue;
              measurements[results[r].id] = measurement;
            }
          }, function (err) {
            errors.push(reasonOf(err));
            /* The agent has stopped answering. Ask again before the next
               sweep rather than paying this batch's full budget twice. */
            if (index === 0) forget();
          })
          .then(function () { return step(index + 1); });
      }

      return step(0);
    }, function () {
      return empty;   /* detect() does not reject, but nothing depends on that */
    });
  }

  return {
    PORT: PORT,
    detect: detect,
    status: status,
    forget: forget,
    describe: describe,
    targetFor: targetFor,
    measureAll: measureAll,
    subscribe: function (fn, options) { return bus.subscribe('probe', fn, options); }
  };
})();
