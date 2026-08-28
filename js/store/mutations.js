/*
  Writes.

  Every change to the data goes through a function here. Pages never touch the
  arrays, which means validation, the sort_order bookkeeping and the activity
  log entry all happen in one place rather than in seven.
*/
window.SM = window.SM || {};

SM.mutate = (function () {
  'use strict';

  var L = SM.schema.LIMITS;

  function clip(value, max) {
    return String(value == null ? '' : value).trim().slice(0, max);
  }

  function log(entry) {
    /* activity-log.js loads after this file but is only called at runtime. */
    if (SM.activityLog) SM.activityLog.write(entry);
  }

  /* Renumbers sort_order to 1..n over an array already in the wanted order. */
  function renumber(rows) {
    for (var i = 0; i < rows.length; i++) rows[i].sort_order = i + 1;
  }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------- system types ---------- */

  function slugify(name, existing) {
    var base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'system';
    var slug = base, n = 2;
    while (existing.indexOf(slug) !== -1) slug = base + '-' + (n++);
    return slug;
  }

  function createSystemType(input) {
    return SM.store.tx('create system type', function (s, mark) {
      var slugs = s.system_types.map(function (t) { return t.slug; });
      var row = {
        id: SM.ids.take('system_types'),
        sort_order: s.system_types.length + 1,
        slug: slugify(input.name, slugs),
        name: clip(input.name, L.system_name),
        description: clip(input.description, L.description),
        color: input.color || 'slate',
        icon: input.icon || 'monitor',
        check_method: input.check_method === 'http' ? 'http' : 'ping',
        http_scheme: input.http_scheme || 'http',
        http_port: input.http_port == null || input.http_port === '' ? null : Number(input.http_port),
        http_path: input.http_path || '/',
        http_expect_status: Number(input.http_expect_status) || 200,
        active: input.active !== false
      };
      s.system_types.push(row);
      renumber(s.system_types);
      mark('system_types');
      log({ kind: 'system_type', action: 'system_type.create', severity: 'info',
            subject: row.name + ' added',
            detail: SM.fmt.describeCheckMethod(row), system_type_id: row.id });
      return row;
    });
  }

  function updateSystemType(id, patch) {
    return SM.store.tx('update system type', function (s, mark) {
      var row = find(s.system_types, id);
      if (!row) return null;
      var before = row.name;

      if (patch.name != null) row.name = clip(patch.name, L.system_name);
      if (patch.description != null) row.description = clip(patch.description, L.description);
      if (patch.color != null) row.color = patch.color;
      if (patch.icon != null) row.icon = patch.icon;
      if (patch.check_method != null) row.check_method = patch.check_method === 'http' ? 'http' : 'ping';
      if (patch.http_scheme != null) row.http_scheme = patch.http_scheme;
      if (patch.http_port !== undefined) {
        row.http_port = patch.http_port === '' || patch.http_port == null ? null : Number(patch.http_port);
      }
      if (patch.http_path != null) row.http_path = patch.http_path || '/';
      if (patch.http_expect_status != null) row.http_expect_status = Number(patch.http_expect_status) || 200;
      if (patch.active != null) row.active = !!patch.active;

      mark('system_types');
      if (patch.active != null && Object.keys(patch).length === 1) {
        log({ kind: 'system_type', action: 'system_type.update', severity: 'info',
              subject: row.name + (row.active ? ' switched on' : ' switched off'),
              detail: row.active ? 'Its sites are checked again' : 'Its sites are no longer checked',
              system_type_id: row.id });
      } else {
        log({ kind: 'system_type', action: 'system_type.update', severity: 'info',
              subject: (before === row.name ? row.name : before + ' renamed to ' + row.name) + ' edited',
              detail: SM.fmt.describeCheckMethod(row), system_type_id: row.id });
      }
      return row;
    });
  }

  /*
    Three dispositions, because deleting a system that still has sites is
    ambiguous and guessing would lose data:
      deactivate  keep everything, just stop checking
      move        reassign its sites to another system, then remove it
      purge       remove it, its sites, and their history
  */
  function deleteSystemType(id, disposition, moveToId) {
    return SM.store.tx('delete system type', function (s, mark) {
      var row = find(s.system_types, id);
      if (!row) return null;

      if (disposition === 'deactivate') {
        row.active = false;
        mark('system_types');
        log({ kind: 'system_type', action: 'system_type.update', severity: 'warning',
              subject: row.name + ' deactivated', detail: 'Kept, but no longer checked',
              system_type_id: row.id });
        return row;
      }

      var moved = 0, purgedSites = 0, purgedChecks = 0;

      if (disposition === 'move' && moveToId) {
        for (var i = 0; i < s.locations.length; i++) {
          if (s.locations[i].system_type_id === id) {
            s.locations[i].system_type_id = moveToId;
            moved++;
          }
        }
        mark('locations');
      } else if (disposition === 'purge') {
        var doomedIds = {};
        s.locations = s.locations.filter(function (loc) {
          if (loc.system_type_id === id) { doomedIds[loc.id] = true; purgedSites++; return false; }
          return true;
        });
        var beforeChecks = s.checks.length;
        s.checks = s.checks.filter(function (c) { return !doomedIds[c.location_id]; });
        purgedChecks = beforeChecks - s.checks.length;
        mark(['locations', 'checks']);
      }

      s.system_types = s.system_types.filter(function (t) { return t.id !== id; });
      renumber(s.system_types);
      mark('system_types');

      var detail = disposition === 'move'
        ? SM.fmt.plural(moved, 'site') + ' moved to ' +
          ((find(s.system_types, moveToId) || {}).name || 'another system')
        : SM.fmt.plural(purgedSites, 'site') + ' and ' +
          SM.fmt.plural(purgedChecks, 'record') + ' removed with it';

      log({ kind: 'system_type', action: 'system_type.delete', severity: 'warning',
            subject: row.name + ' removed', detail: detail });
      return { moved: moved, purgedSites: purgedSites, purgedChecks: purgedChecks };
    });
  }

  function reorder(table, id, direction) {
    return SM.store.tx('reorder ' + table, function (s, mark) {
      var rows = s[table].slice().sort(SM.store.bySortOrder);
      var at = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i].id === id) { at = i; break; }
      var to = at + (direction === 'up' ? -1 : 1);
      if (at === -1 || to < 0 || to >= rows.length) return false;
      var tmp = rows[at]; rows[at] = rows[to]; rows[to] = tmp;
      renumber(rows);
      s[table] = rows;
      mark(table);
      return true;
    });
  }

  /* ---------- locations ---------- */

  function createLocation(input) {
    return SM.store.tx('create location', function (s, mark) {
      var row = {
        id: SM.ids.take('locations'),
        sort_order: s.locations.length + 1,
        system_type_id: Number(input.system_type_id) || 0,
        name: clip(input.name, L.location_name),
        ip: clip(input.ip, 64),
        lat: clampNum(input.lat, -90, 90),
        lng: clampNum(input.lng, -180, 180),
        region: clip(input.region, L.region),
        active: input.active !== false
      };
      s.locations.push(row);
      renumber(s.locations);
      mark('locations');
      var system = SM.queries.systemById(row.system_type_id);
      log({ kind: 'location', action: 'location.create', severity: 'info',
            subject: row.name + ' added',
            detail: (system ? system.name + ' - ' : '') + row.ip,
            location_id: row.id, system_type_id: row.system_type_id });
      return row;
    });
  }

  function clampNum(value, lo, hi) {
    var n = Number(value);
    if (isNaN(n)) return 0;
    return Math.max(lo, Math.min(hi, n));
  }

  function updateLocation(id, patch) {
    return SM.store.tx('update location', function (s, mark) {
      var row = find(s.locations, id);
      if (!row) return null;
      var before = row.name;

      if (patch.name != null) row.name = clip(patch.name, L.location_name);
      if (patch.ip != null) row.ip = clip(patch.ip, 64);
      if (patch.region != null) row.region = clip(patch.region, L.region);
      if (patch.lat != null) row.lat = clampNum(patch.lat, -90, 90);
      if (patch.lng != null) row.lng = clampNum(patch.lng, -180, 180);
      if (patch.system_type_id != null) row.system_type_id = Number(patch.system_type_id);
      if (patch.active != null) row.active = !!patch.active;

      mark('locations');

      /* A bare active toggle reads better as its own sentence. */
      if (patch.active != null && Object.keys(patch).length === 1) {
        log({ kind: 'location', action: 'location.update', severity: 'info',
              subject: row.name + (row.active ? ' switched on' : ' switched off'),
              detail: row.active ? 'Included in sweeps again' : 'Left out of sweeps',
              location_id: row.id, system_type_id: row.system_type_id });
      } else {
        log({ kind: 'location', action: 'location.update', severity: 'info',
              subject: (before === row.name ? row.name : before + ' renamed to ' + row.name) + ' edited',
              detail: row.ip + ' - ' + SM.fmt.coords(row.lat, row.lng),
              location_id: row.id, system_type_id: row.system_type_id });
      }
      return row;
    });
  }

  /*
    Soft by default. A site that is switched off keeps its history and keeps
    being checked for any other system it also runs, which is the behaviour an
    operator expects from a list they can switch things back on in.
  */
  function deleteLocation(id, hard) {
    return SM.store.tx('delete location', function (s, mark) {
      var row = find(s.locations, id);
      if (!row) return null;

      if (!hard) {
        row.active = false;
        mark('locations');
        log({ kind: 'location', action: 'location.update', severity: 'warning',
              subject: row.name + ' switched off', detail: 'History kept; left out of sweeps',
              location_id: row.id, system_type_id: row.system_type_id });
        return { soft: true, row: row };
      }

      var beforeChecks = s.checks.length;
      s.checks = s.checks.filter(function (c) { return c.location_id !== id; });
      var removedChecks = beforeChecks - s.checks.length;
      s.locations = s.locations.filter(function (l) { return l.id !== id; });
      renumber(s.locations);
      mark(['locations', 'checks']);
      log({ kind: 'location', action: 'location.delete', severity: 'warning',
            subject: row.name + ' removed',
            detail: SM.fmt.plural(removedChecks, 'record') + ' removed with it',
            system_type_id: row.system_type_id });
      return { soft: false, removedChecks: removedChecks };
    });
  }

  /* ---------- checks ---------- */

  /*
    Only the three columns an operator owns. The measurements are what the sweep
    recorded and are not editable - a form whose numbers can be typed over is not
    a record of anything.
  */
  function updateCheck(id, patch) {
    return SM.store.tx('update check', function (s, mark) {
      var row = find(s.checks, id);
      if (!row) return null;

      var changed = [];
      if (patch.issues !== undefined) {
        var issues = clip(patch.issues, L.issues);
        if (issues !== row.issues) { row.issues = issues; changed.push('Issues'); }
      }
      if (patch.remarks !== undefined) {
        var remarks = clip(patch.remarks, L.remarks);
        if (remarks !== row.remarks) { row.remarks = remarks; changed.push('Remarks'); }
      }
      if (patch.status !== undefined && patch.status !== row.status) {
        row.status = patch.status;
        row.status_overridden = true;
        changed.push('Status');
      }
      if (!changed.length) return row;

      mark('checks');
      var loc = SM.queries.locationById(row.location_id);
      log({ kind: 'check', action: 'check.edit', severity: 'info',
            subject: changed.join(' and ') + ' edited on ' + (loc ? loc.name : 'a removed site'),
            detail: SM.fmt.dateLabel(row.checked_at) + ' ' + SM.fmt.timeLabel(row.checked_at),
            location_id: row.location_id,
            system_type_id: loc ? loc.system_type_id : null });
      return row;
    });
  }

  /* Bulk insert, used by the sweep engine and the backfill. */
  function addChecks(rows) {
    return SM.store.tx('add checks', function (s, mark) {
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].id) rows[i].id = SM.ids.take('checks');
        s.checks.push(rows[i]);
      }
      mark('checks');
      return rows.length;
    });
  }

  /* ---------- activity ---------- */

  function addActivity(rows) {
    return SM.store.tx('add activity', function (s, mark) {
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].id) rows[i].id = SM.ids.take('activity');
        s.activity.push(rows[i]);
      }
      mark('activity');
      return rows.length;
    });
  }

  function pruneActivity(beforeDay) {
    return SM.store.tx('prune activity', function (s, mark) {
      var before = s.activity.length;
      s.activity = s.activity.filter(function (row) {
        return SM.fmt.dayOf(row.at) >= beforeDay;
      });
      var removed = before - s.activity.length;
      if (!removed) return 0;
      mark('activity');
      /* Logged after the prune, so the entry describing it survives. */
      log({ kind: 'settings', action: 'activity.prune', severity: 'warning',
            subject: SM.fmt.plural(removed, 'entry', 'entries') + ' pruned',
            detail: 'Everything before ' + SM.fmt.dateLabel(beforeDay) });
      return removed;
    });
  }

  /* Keeps the checks table from outgrowing the storage quota. */
  function pruneChecks(beforeDay) {
    return SM.store.tx('prune checks', function (s, mark) {
      var before = s.checks.length;
      s.checks = s.checks.filter(function (row) {
        return SM.fmt.dayOf(row.checked_at) >= beforeDay;
      });
      var removed = before - s.checks.length;
      if (removed) mark('checks');
      return removed;
    });
  }

  /* ---------- settings ---------- */

  function updateSettings(patch, describe) {
    return SM.store.tx('update settings', function (s, mark) {
      var changed = [];
      Object.keys(patch).forEach(function (key) {
        var value = String(patch[key]);
        var range = SM.schema.SETTING_RANGES[key];
        if (range) {
          var n = parseInt(value, 10);
          if (isNaN(n)) return;
          value = String(Math.max(range[0], Math.min(range[1], n)));
        }
        if (s.settings[key] !== value) { s.settings[key] = value; changed.push(key); }
      });
      if (!changed.length) return [];
      mark('settings');
      if (describe) {
        log({ kind: 'settings', action: 'settings.update', severity: 'info',
              subject: describe.subject, detail: describe.detail });
      }
      return changed;
    });
  }

  return {
    createSystemType: createSystemType,
    updateSystemType: updateSystemType,
    deleteSystemType: deleteSystemType,
    createLocation: createLocation,
    updateLocation: updateLocation,
    deleteLocation: deleteLocation,
    reorder: reorder,
    updateCheck: updateCheck,
    addChecks: addChecks,
    addActivity: addActivity,
    pruneActivity: pruneActivity,
    pruneChecks: pruneChecks,
    updateSettings: updateSettings,
    slugify: slugify
  };
})();
