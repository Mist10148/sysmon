/*
  The shell: sidebar, mobile top bar, and the drawer behaviour that joins them.

  The sidebar is one element in both layouts. Below 1024px it is a fixed
  off-canvas drawer with a scrim; at 1024px and above the same element is a
  sticky column and the drawer machinery is inert. Rebuilding the navigation on
  resize would be pointless work and would lose the focus ring mid-keyboard-use.
*/
window.SM = window.SM || {};

SM.shell = (function () {
  'use strict';

  var html = SM.dom.html;
  var raw = SM.dom.raw;
  var icon = SM.dom.icon;

  var sidebar = null;
  var topbar = null;
  var scrim = null;
  var drawerOpen = false;

  /* ---------- rendering ---------- */

  function renderSidebar() {
    var route = SM.router.currentRoute();
    var activeId = route ? route.id : 'dashboard';

    sidebar.innerHTML = html`
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">SM</div>
        <div class="min-w-0">
          <div class="brand-name">SysMon</div>
          <div class="brand-sub">System monitoring</div>
        </div>
      </div>

      <nav class="nav">
        ${SM.router.ROUTES.map(function (r) {
          return raw(html`
            <a class="nav-item" href="${SM.router.build(r.path)}"
               ${raw(r.id === activeId ? 'aria-current="page"' : '')}>
              ${raw(icon(r.icon))}
              <span>${r.label}</span>
            </a>`);
        })}
      </nav>

      <div class="sidebar-foot">
        <div class="sweep-box" id="sweep-box">${raw(sweepBoxInner())}</div>
      </div>`;
  }

  /*
    The sidebar's footer answers "is this thing still watching?" without making
    anyone open Settings.
  */
  function sweepBoxInner() {
    var on = SM.store.settingOn('auto_sweep_enabled');
    var mins = SM.store.settingInt('auto_sweep_minutes');
    var last = SM.queries.lastSweepAt();
    return html`
      <div class="sweep-box-label">Auto sweep</div>
      <div class="sweep-box-value">${on ? 'Every ' + SM.fmt.plural(mins, 'min') : 'Paused'}</div>
      <div class="sweep-box-hint">${last ? 'Last run ' + SM.fmt.relative(last) : 'Never run'}</div>`;
  }

  function renderTopBar() {
    topbar.innerHTML = html`
      <button class="icon-button-44" type="button" data-act="open-drawer"
              aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">
        ${raw(icon('menu', 'icon-lg'))}
      </button>
      <div class="brand-mark" aria-hidden="true" style="width:28px;height:28px;font-size:11px">SM</div>
      <span class="topbar-title">SysMon</span>
      <div class="ml-auto flex items-center gap-1">
        <button class="icon-button-44" type="button" data-act="cycle-theme"
                aria-label="Change theme">${raw(themeIcon())}</button>
      </div>`;
  }

  function themeIcon() {
    var mode = SM.theme.get();
    if (mode === 'light') return icon('sun', 'icon-lg');
    if (mode === 'dark') return icon('moon', 'icon-lg');
    return icon('monitor', 'icon-lg');
  }

  /* ---------- keyboard shortcuts ---------- */

  /*
    g-then-letter, the way Gmail and GitHub do it.

    A bare letter would be a worse choice than it looks: this application is
    full of text fields, and a single key that navigates is a single key that
    throws away what someone was typing the moment focus is anywhere unexpected.
    The g prefix makes the gesture deliberate, and it costs nothing to learn
    because the letters are the page names.

    Letters are paired to route ids rather than to positions, so re-ordering
    the sidebar cannot silently re-point somebody's muscle memory.
  */
  var KEYS = {
    d: 'dashboard', y: 'systems', l: 'locations', h: 'history',
    a: 'analytics', v: 'activity', s: 'settings'
  };

  var PENDING_MS = 1500;
  var pending = false;
  var pendingTimer = null;

  function armPending() {
    pending = true;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { pending = false; }, PENDING_MS);
  }

  function clearPending() {
    pending = false;
    clearTimeout(pendingTimer);
  }

  /*
    Everything that means "these keys are not ours right now".

    Dialogs are native showModal(), so the browser has already made the rest of
    the document inert - but keydown still reaches document, which is why the
    dialog[open] test is here and not left to the platform. The menu preventDefaults
    its own arrow keys, so defaultPrevented covers it without needing state
    the overlay module does not expose.
  */
  function busy(event) {
    if (event.defaultPrevented) return true;
    if (event.altKey || event.ctrlKey || event.metaKey) return true;
    if (drawerOpen) return true;
    if (document.querySelector('dialog[open]')) return true;
    if (document.querySelector('#layers .menu')) return true;

    var target = event.target;
    if (target && target.closest &&
        target.closest('input, textarea, select, [contenteditable]')) return true;

    return false;
  }

  function onShortcut(event) {
    if (busy(event)) { clearPending(); return; }

    var key = event.key;

    if (pending) {
      clearPending();
      var id = KEYS[key.toLowerCase()];
      if (!id) return;
      var route = findRoute(id);
      if (!route) return;
      event.preventDefault();
      SM.router.go(route.path);
      return;
    }

    if (key === 'g' || key === 'G') { armPending(); return; }

    if (key === '/') {
      var search = SM.dom.qs('[data-act="search"]');
      if (!search) return;
      event.preventDefault();
      search.focus();
      search.select();
      return;
    }

    if (key === '?') {
      event.preventDefault();
      openShortcutSheet();
    }
  }

  function findRoute(id) {
    var list = SM.router.ROUTES;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  /*
    No open/closed flag here: busy() already refuses every shortcut while a
    dialog is open, so a second ? cannot reach this function to stack a second
    copy of the sheet.
  */
  function openShortcutSheet() {
    var rows = SM.router.ROUTES.map(function (route) {
      var key = null;
      for (var k in KEYS) { if (KEYS[k] === route.id) key = k; }
      return key ? ['g ' + key, route.label] : null;
    }).filter(Boolean).concat([
      ['/', 'Focus the search box'],
      ['?', 'This list'],
      ['Esc', 'Close a dialog, menu or drawer']
    ]);

    SM.ui.openDialog({
      title: 'Keyboard shortcuts',
      desc: 'Press g, then the letter of the page you want.',
      size: 'md',
      body: SM.dom.raw('<dl class="shortcuts">' + rows.map(function (row) {
        return '<dt><kbd>' + SM.dom.esc(row[0]) + '</kbd></dt>' +
               '<dd>' + SM.dom.esc(row[1]) + '</dd>';
      }).join('') + '</dl>'),
      footer: SM.ui.Button({ label: 'Close', variant: 'secondary', act: 'sheet-close' }),
      onMount: function (panel, api) {
        SM.dom.delegate(panel, 'click', '[data-act="sheet-close"]', function () { api.close(); });
      }
    });
  }

  /* ---------- drawer ---------- */

  function openDrawer() {
    if (drawerOpen) return;
    drawerOpen = true;
    sidebar.dataset.open = 'true';
    scrim.hidden = false;
    document.body.dataset.scrollLocked = 'true';
    var trigger = SM.dom.qs('[data-act="open-drawer"]', topbar);
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    /* Focus the first link so the keyboard lands inside the thing that opened. */
    var first = SM.dom.qs('.nav-item', sidebar);
    if (first) first.focus();
  }

  function closeDrawer(returnFocus) {
    if (!drawerOpen) return;
    drawerOpen = false;
    sidebar.dataset.open = 'false';
    scrim.hidden = true;
    delete document.body.dataset.scrollLocked;
    var trigger = SM.dom.qs('[data-act="open-drawer"]', topbar);
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    }
  }

  /* ---------- wiring ---------- */

  function init() {
    sidebar = SM.dom.qs('#sidebar');
    topbar = SM.dom.qs('#topbar');
    scrim = SM.dom.qs('#scrim');

    renderSidebar();
    renderTopBar();

    /* Navigation always closes the drawer; it is a mobile-only thing anyway. */
    SM.dom.delegate(sidebar, 'click', '.nav-item', function () { closeDrawer(false); });

    SM.dom.delegate(topbar, 'click', '[data-act="open-drawer"]', function () { openDrawer(); });
    SM.dom.delegate(topbar, 'click', '[data-act="cycle-theme"]', function () {
      var order = ['system', 'light', 'dark'];
      var at = order.indexOf(SM.theme.get());
      SM.theme.set(order[(at + 1) % order.length]);
    });

    scrim.addEventListener('click', function () { closeDrawer(true); });

    /*
      #view already carries tabindex="-1" so it can take focus without joining
      the tab order. Focusing it is what actually moves a screen reader on;
      scrolling alone would leave the reading cursor in the sidebar.
    */
    SM.dom.delegate(document, 'click', '[data-act="skip-to-content"]', function (event) {
      event.preventDefault();
      var view = SM.dom.qs('#view');
      if (!view) return;
      view.focus();
      view.scrollIntoView({ block: 'start' });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && drawerOpen) {
        event.stopPropagation();
        closeDrawer(true);
      }
    });

    document.addEventListener('keydown', onShortcut);

    /*
      Crossing 1024px with the drawer open would leave the scroll lock and the
      scrim in place over a layout that no longer has a drawer.
    */
    var wide = window.matchMedia('(min-width: 1024px)');
    var onWide = function (e) { if (e.matches) closeDrawer(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else if (wide.addListener) wide.addListener(onWide);

    SM.router.onChange(function () { renderSidebar(); });
    SM.theme.onChange(function () { renderTopBar(); });

    /* The footer box tracks sweeps and the interval setting. */
    SM.store.subscribe(['checks', 'settings'], function () {
      var box = SM.dom.qs('#sweep-box');
      if (box) box.innerHTML = sweepBoxInner();
    });

    watchOnline();
  }

  function watchOnline() {
    var banner = SM.dom.qs('#offline-banner');
    function paint() { banner.hidden = navigator.onLine !== false; }
    window.addEventListener('online', paint);
    window.addEventListener('offline', paint);
    paint();
  }

  return { init: init, closeDrawer: closeDrawer };
})();
