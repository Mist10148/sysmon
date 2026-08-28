/*
  The store.

  State is four plain arrays and one settings object, holding exactly the
  columns in the schema and nothing else. Denormalised display fields - the
  system name on a location, the site name on a check - are joined at read time
  in queries.js rather than stored, so there is never a copy to keep in step.

  Writes go through store.tx(). A transaction records which tables it touched,
  and on the outermost commit it notifies subscribers once and schedules one
  persist. That is what lets a sweep write forty checks and forty activity rows
  and cost a single render.
*/
window.SM = window.SM || {};

SM.store = (function () {
  'use strict';

  var TABLES = ['system_types', 'locations', 'checks', 'activity'];

  var state = {
    system_types: [],
    locations: [],
    checks: [],
    activity: [],
    settings: {}
  };

  var revs = { system_types: 0, locations: 0, checks: 0, activity: 0, settings: 0 };
  var bus = SM.emitter.create();

  var depth = 0;
  var touched = null;
  var loadWarnings = [];

  /* ---------- reading ---------- */

  function get() { return state; }
  function rev(table) { return revs[table]; }

  function settings() { return state.settings; }

  function setting(key) {
    var value = state.settings[key];
    return value == null ? SM.schema.DEFAULT_SETTINGS[key] : value;
  }

  function settingInt(key) {
    var n = parseInt(setting(key), 10);
    if (isNaN(n)) n = parseInt(SM.schema.DEFAULT_SETTINGS[key], 10);
    var range = SM.schema.SETTING_RANGES[key];
    if (range) {
      if (n < range[0]) n = range[0];
      if (n > range[1]) n = range[1];
    }
    return n;
  }

  function settingOn(key) {
    var v = String(setting(key));
    return v === '1' || v === 'yes' || v === 'true';
  }

  /* ---------- writing ---------- */

  /*
    fn receives the state and mutates the arrays in place. Nested calls join the
    outer transaction, which is why a mutation is free to call another mutation.
  */
  function tx(label, fn) {
    var outermost = depth === 0;
    if (outermost) touched = Object.create(null);
    depth++;
    var result;
    try {
      result = fn(state, mark);
    } finally {
      depth--;
      if (outermost) {
        var tables = Object.keys(touched);
        touched = null;
        if (tables.length) {
          for (var i = 0; i < tables.length; i++) revs[tables[i]]++;
          SM.storage.markDirty(tables);
          bus.emit(tables);
        }
      }
    }
    return result;
  }

  function mark(tables) {
    var list = typeof tables === 'string' ? [tables] : tables;
    for (var i = 0; i < list.length; i++) {
      if (touched) touched[list[i]] = true;
      else {
        /* A write outside a transaction is a bug; persist it anyway. */
        revs[list[i]]++;
        SM.storage.markDirty(list[i]);
        bus.emit(list[i]);
      }
    }
  }

  function subscribe(topics, fn, options) {
    return bus.subscribe(topics, fn, options);
  }

  /* ---------- serialising ---------- */

  function serialize(table) {
    if (table === 'settings') return SM.txt.serializeSettings(state.settings);
    return SM.txt.serialize(table, state[table]);
  }

  function serializeAll() {
    var out = {};
    var at = SM.fmt.iso();
    for (var i = 0; i < TABLES.length; i++) {
      out[TABLES[i]] = SM.txt.serialize(TABLES[i], state[TABLES[i]], at);
    }
    out.settings = SM.txt.serializeSettings(state.settings, at);
    return out;
  }

  /* ---------- loading ---------- */

  function loadTable(table) {
    var stored = SM.storage.getRaw(table);
    var text = stored;
    var fromSeed = false;
    if (text == null) {
      text = SM.seed.text(table);
      fromSeed = true;
    }
    if (text == null) return { rows: [], fromSeed: true };

    try {
      var parsed = SM.txt.parse(table, text);
      for (var i = 0; i < parsed.warnings.length; i++) {
        loadWarnings.push(table + ': ' + parsed.warnings[i]);
      }
      return { rows: parsed.rows, fromSeed: fromSeed };
    } catch (err) {
      /*
        A corrupt stored table falls back to the seed rather than to an empty
        screen, and says so. Losing the stored rows is bad; looking like the
        application is broken is worse.
      */
      loadWarnings.push('Stored ' + table + ' could not be read (' + err.message +
        '); started from the built-in seed instead.');
      var seedText = SM.seed.text(table);
      if (seedText == null) return { rows: [], fromSeed: true };
      return { rows: SM.txt.parse(table, seedText).rows, fromSeed: true };
    }
  }

  function init() {
    loadWarnings = [];

    SM.storage.init({
      serialize: serialize,
      onQuotaError: function (table, err) {
        loadWarnings.push('Ran out of room saving ' + table + '.');
        if (SM.store.onQuotaError) SM.store.onQuotaError(table, err);
      }
    });

    var freshInstall = SM.storage.getRaw('system_types') == null;

    for (var i = 0; i < TABLES.length; i++) {
      var table = TABLES[i];
      var loaded = loadTable(table);
      state[table] = loaded.rows;
      SM.ids.seedFrom(table, loaded.rows);
    }

    /* Settings: defaults, then whatever was stored on top. */
    state.settings = {};
    Object.keys(SM.schema.DEFAULT_SETTINGS).forEach(function (k) {
      state.settings[k] = SM.schema.DEFAULT_SETTINGS[k];
    });
    var storedSettings = SM.storage.getRaw('settings');
    if (storedSettings != null) {
      var parsed = SM.txt.parseSettings(storedSettings);
      Object.keys(parsed).forEach(function (k) { state.settings[k] = parsed[k]; });
    }

    /* Sort every table into its manual order once, so pages can rely on it. */
    state.system_types.sort(bySortOrder);
    state.locations.sort(bySortOrder);
    state.checks.sort(byCheckedAt);
    state.activity.sort(byActivityAt);

    /*
      Write the seed out straight away on a fresh install.

      Loading from the seed does not mark anything dirty - nothing was edited -
      so without this the seeded tables were never saved, every reload looked
      like another fresh install, and the backfill ran again on top of the
      history it had already generated. Persisting immediately rather than on the
      debounce also means a reload two hundred milliseconds later is safe.
    */
    if (freshInstall) {
      for (var t = 0; t < TABLES.length; t++) {
        SM.storage.setRaw(TABLES[t], serialize(TABLES[t]));
      }
      SM.storage.setRaw('settings', serialize('settings'));
    }

    return {
      freshInstall: freshInstall,
      warnings: loadWarnings.slice()
    };
  }

  function bySortOrder(a, b) {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  }
  function byCheckedAt(a, b) {
    if (a.checked_at === b.checked_at) return a.id - b.id;
    return a.checked_at < b.checked_at ? -1 : 1;
  }
  function byActivityAt(a, b) {
    if (a.at === b.at) return a.id - b.id;
    return a.at < b.at ? -1 : 1;
  }

  /*
    Replaces everything. Used by Import and by "start again from the seed", both
    of which are whole-dataset operations rather than edits.
  */
  function replaceAll(next) {
    tx('replace all', function (s, markTouched) {
      for (var i = 0; i < TABLES.length; i++) {
        var table = TABLES[i];
        if (next[table]) {
          s[table] = next[table];
          SM.ids.seedFrom(table, s[table]);
        }
      }
      if (next.settings) {
        var merged = {};
        Object.keys(SM.schema.DEFAULT_SETTINGS).forEach(function (k) {
          merged[k] = SM.schema.DEFAULT_SETTINGS[k];
        });
        Object.keys(next.settings).forEach(function (k) { merged[k] = next.settings[k]; });
        s.settings = merged;
      }
      s.system_types.sort(bySortOrder);
      s.locations.sort(bySortOrder);
      s.checks.sort(byCheckedAt);
      s.activity.sort(byActivityAt);
      markTouched(TABLES.concat(['settings']));
    });
  }

  function resetToSeed() {
    SM.storage.clearAll();
    var next = {};
    for (var i = 0; i < TABLES.length; i++) {
      var text = SM.seed.text(TABLES[i]);
      next[TABLES[i]] = text ? SM.txt.parse(TABLES[i], text).rows : [];
    }
    next.settings = {};
    replaceAll(next);
    return next;
  }

  return {
    TABLES: TABLES,
    get: get, rev: rev, subscribe: subscribe, tx: tx,
    settings: settings, setting: setting, settingInt: settingInt, settingOn: settingOn,
    serialize: serialize, serializeAll: serializeAll,
    init: init, replaceAll: replaceAll, resetToSeed: resetToSeed,
    bySortOrder: bySortOrder,
    onQuotaError: null
  };
})();
