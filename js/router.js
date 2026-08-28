/*
  The router.

  Hash routing, because a static site has no server to rewrite paths: opening
  index.html from a folder, from GitHub Pages, or from a LAN address all have to
  work, and only the fragment is guaranteed not to hit the network.

  List state - search text, sort key and direction, page number, every filter -
  lives in the hash query rather than in page variables. That gives the back
  button and a shareable link for free, and it means a page can be re-mounted
  from nothing but its URL.

  The lifecycle rule that matters: everything a page attaches must be registered
  with ctx.onCleanup, or handed ctx.signal. Leaflet maps and intervals are the
  two that bite, and both are cleaned up by that one mechanism.
*/
window.SM = window.SM || {};

SM.router = (function () {
  'use strict';

  var ROUTES = [
    { id: 'dashboard', path: '/', page: 'dashboard', label: 'Dashboard', icon: 'map-pinned' },
    { id: 'systems', path: '/systems', page: 'systems', label: 'Systems', icon: 'layout-grid' },
    { id: 'locations', path: '/locations', page: 'locations', label: 'Locations', icon: 'activity-square' },
    { id: 'history', path: '/history', page: 'history', label: 'History', icon: 'table-properties' },
    { id: 'analytics', path: '/analytics', page: 'analytics', label: 'Analytics', icon: 'bar-chart-3' },
    { id: 'activity', path: '/activity', page: 'activity', label: 'Activity', icon: 'scroll-text' },
    { id: 'settings', path: '/settings', page: 'settings', label: 'Settings', icon: 'settings-2' }
  ];

  var view = null;
  var current = null;         /* { route, cleanups, controller } */
  var listeners = [];         /* route-change subscribers, for the sidebar */
  var scrollByRoute = {};

  /* ---------- hash parsing ---------- */

  function parse(hash) {
    var raw = String(hash || '').replace(/^#/, '');
    if (!raw) raw = '/';
    if (raw.charAt(0) !== '/') raw = '/' + raw;
    var at = raw.indexOf('?');
    var path = at === -1 ? raw : raw.slice(0, at);
    var query = at === -1 ? '' : raw.slice(at + 1);
    if (path.length > 1 && path.charAt(path.length - 1) === '/') path = path.slice(0, -1);

    var params = {};
    if (query) {
      var parts = query.split('&');
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        var eq = parts[i].indexOf('=');
        var key = eq === -1 ? parts[i] : parts[i].slice(0, eq);
        var value = eq === -1 ? '' : parts[i].slice(eq + 1);
        try {
          params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
        } catch (err) {
          params[key] = value;    /* a malformed escape is not worth a crash */
        }
      }
    }
    return { path: path, params: params };
  }

  function build(path, params) {
    var query = [];
    if (params) {
      Object.keys(params).forEach(function (key) {
        var value = params[key];
        if (value == null || value === '') return;
        query.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
      });
    }
    return '#' + path + (query.length ? '?' + query.join('&') : '');
  }

  function routeFor(path) {
    for (var i = 0; i < ROUTES.length; i++) if (ROUTES[i].path === path) return ROUTES[i];
    return null;
  }

  /* ---------- navigation ---------- */

  function go(path, params) {
    window.location.hash = build(path, params);
  }

  /*
    Rewrites the query of the route already on screen. `replace` is for
    keystroke-level changes - typing in a search box should not leave twenty
    entries in the back history - and the default is a real navigation.
  */
  function setParams(params, replace) {
    if (!current) return;
    var next = build(current.route.path, params);
    if (('#' + window.location.hash.replace(/^#/, '')) === next) return;
    if (replace && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', next);
      resolve(true);
    } else {
      window.location.hash = next;
    }
  }

  function patchParams(patch, replace) {
    var now = parse(window.location.hash).params;
    Object.keys(patch).forEach(function (key) {
      var value = patch[key];
      if (value == null || value === '') delete now[key];
      else now[key] = value;
    });
    setParams(now, replace);
  }

  /* ---------- mounting ---------- */

  function unmount() {
    if (!current) return;
    scrollByRoute[current.route.id] = window.scrollY;
    var cleanups = current.cleanups;
    current = null;
    /* Backwards, so a page tears down in the reverse order it built up. */
    for (var i = cleanups.length - 1; i >= 0; i--) {
      try { cleanups[i](); } catch (err) { console.error('SysMon: cleanup threw', err); }
    }
  }

  function resolve(paramsOnly) {
    var parsed = parse(window.location.hash);
    var route = routeFor(parsed.path);

    if (!route) {
      /* Unknown hash goes home rather than showing a dead end. */
      window.location.replace('#/');
      return;
    }

    /*
      Same route, different query: the page updates itself rather than being
      rebuilt, so a search box does not lose focus on every keystroke.
    */
    if (paramsOnly && current && current.route.id === route.id && current.controller &&
        current.controller.onParams) {
      current.controller.onParams(parsed.params);
      notify(route, parsed.params);
      return;
    }

    var sameRoute = current && current.route.id === route.id;
    unmount();

    var cleanups = [];
    var aborter = new AbortController();
    cleanups.push(function () { aborter.abort(); });

    var ctx = {
      view: view,
      route: route,
      params: parsed.params,
      signal: aborter.signal,
      onCleanup: function (fn) { cleanups.push(fn); }
    };

    view.innerHTML = '';
    document.body.dataset.page = route.id;
    current = { route: route, cleanups: cleanups, controller: null };

    var page = SM.pages && SM.pages[route.page];
    if (!page || typeof page.mount !== 'function') {
      /*
        A page whose script failed to load should say so, not show a blank
        panel. With no bundler this is a real failure mode - one bad path in
        index.html and one screen is missing.
      */
      view.innerHTML = SM.dom.html`
        <div class="page-body">
          <div class="card surface-card">
            <div class="empty">
              ${SM.dom.raw(SM.dom.icon('alert-triangle'))}
              <p class="empty-title">${route.label} could not be loaded</p>
              <p class="empty-desc">Its script did not run. Reload the page; if it
                keeps happening, check that js/pages/${route.page}.js is present.</p>
            </div>
          </div>`;
      notify(route, parsed.params);
      return;
    }

    try {
      current.controller = page.mount(ctx) || null;
    } catch (err) {
      console.error('SysMon: ' + route.id + ' failed to mount', err);
      view.innerHTML = SM.dom.html`
        <div class="page-body">
          <div class="card surface-card">
            <div class="empty">
              ${SM.dom.raw(SM.dom.icon('alert-triangle'))}
              <p class="empty-title">Something went wrong on ${route.label}</p>
              <p class="empty-desc">${String(err && err.message || err)}</p>
            </div>
          </div>`;
    }

    if (!sameRoute) window.scrollTo(0, 0);
    notify(route, parsed.params);
  }

  function notify(route, params) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](route, params); } catch (err) { console.error(err); }
    }
  }

  function onChange(fn) { listeners.push(fn); return function () {
    var at = listeners.indexOf(fn);
    if (at !== -1) listeners.splice(at, 1);
  }; }

  function start(mountPoint) {
    view = mountPoint;
    window.addEventListener('hashchange', function () { resolve(false); });
    resolve(false);
  }

  function currentRoute() { return current ? current.route : null; }
  function currentParams() { return parse(window.location.hash).params; }

  return {
    ROUTES: ROUTES,
    parse: parse, build: build,
    go: go, setParams: setParams, patchParams: patchParams,
    start: start, onChange: onChange,
    currentRoute: currentRoute, currentParams: currentParams
  };
})();
