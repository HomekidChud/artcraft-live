/* ============================================================
   inspector/inspector.js — shared DevTools-style page inspector
   for every ArtCraft app (editable apps load it directly; catalog
   crafts get it injected via the assistant widget).

   Features:
   - Elements: lazily expandable DOM tree, hover + click picking,
     selection highlight with box model, breadcrumbs, live updates,
     editable attributes and text nodes.
   - Styles: editable inline declarations, matched stylesheet rules
     (inaccessible sheets labeled, never faked), computed props,
     box model.
   - Console: captured messages + command eval, safe text rendering.
   - Network: only actually observed fetch/XHR requests, labeled.

   Honesty notes: this is an in-page DOM inspector — it cannot see
   the browser's network stack, cross-origin stylesheet rules, or
   objects rendered inside a <canvas> (3D scene inspection lives in
   the apps' own tools). Ctrl+Shift+I is best-effort: some browsers
   reserve it for their built-in DevTools; the floating button always
   works.

   Public API: window.ArtCraftInspector = { open, close, toggle,
   isOpen, onOpen, onClose }
   ============================================================ */
(function () {
  'use strict';
  if (window.ArtCraftInspector) return; // idempotent

  var PREFIX = 'acpi';
  var S = {
    open: false,
    tab: 'elements',
    selected: null,
    expanded: new Set(),
    pickMode: false,
    detailTab: 'styles',
    focusBefore: null,
    onOpenCbs: [],
    onCloseCbs: [],
    net: [],
    consoleHistory: [],
    dragging: false,
    width: 420,
  };

  function el(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function safeText(args) {
    return args.map(function (a) {
      try {
        if (typeof a === 'string') return a;
        return JSON.stringify(a, function (k, v) { return typeof v === 'function' ? '[fn]' : v; }, 1);
      } catch (e) { return String(a); }
    }).join(' ');
  }

  /* ---------------- console capture ---------------- */
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
    var orig = console[m].bind(console);
    console[m] = function () {
      pushMessage(m === 'debug' ? 'log' : m, Array.prototype.slice.call(arguments));
      orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function (e) {
    pushMessage('error', [e.message + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '')]);
  });
  window.addEventListener('unhandledrejection', function (e) {
    pushMessage('error', ['Unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason))]);
  });
  function pushMessage(kind, args) {
    S.consoleHistory.push({ kind: kind, text: safeText(args), t: Date.now() });
    if (S.consoleHistory.length > 300) S.consoleHistory.shift();
    if (S.open && S.tab === 'console') renderConsole();
  }

  /* ---------------- network capture ---------------- */
  var origFetch = window.fetch;
  window.fetch = function () {
    var a = arguments;
    var url = String(a[0] instanceof Request ? a[0].url : a[0]);
    var t0 = performance.now();
    return origFetch.apply(this, a).then(
      function (res) { recordNet('fetch', url, res.status, performance.now() - t0); return res; },
      function (err) { recordNet('fetch', url, 0, performance.now() - t0); throw err; }
    );
  };
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var t0 = performance.now();
    var self = this;
    this.addEventListener('load', function () { recordNet('xhr ' + method, String(url), self.status, performance.now() - t0); });
    this.addEventListener('error', function () { recordNet('xhr ' + method, String(url), 0, performance.now() - t0); });
    return origOpen.apply(this, arguments);
  };
  function recordNet(type, url, status, ms) {
    S.net.push({ type: type, url: url, status: status || '—', ms: Math.round(ms) });
    if (S.net.length > 200) S.net.shift();
    if (S.open && S.tab === 'network') renderNetwork();
  }

  /* ---------------- host + shadow root ---------------- */
  var host = document.createElement('div');
  host.id = PREFIX + '-host';
  host.style.cssText = 'position:fixed;top:0;right:0;bottom:0;z-index:2147483647;width:0;';
  var root = host.attachShadow({ mode: 'open' });

  var hl = document.createElement('div');
  hl.id = PREFIX + '-hl';
  hl.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;display:none;';
  var hlBoxes = ['margin', 'border', 'padding', 'content'].map(function (k) {
    var d = document.createElement('div');
    var colors = { margin: 'rgba(246,178,107,.35)', border: 'rgba(224,220,90,.4)', padding: 'rgba(132,193,90,.4)', content: 'rgba(120,170,255,.4)' };
    d.style.cssText = 'position:absolute;background:' + colors[k] + ';';
    hl.appendChild(d);
    return d;
  });
  function showHighlight(elm) {
    if (!elm || !elm.getBoundingClientRect) { hl.style.display = 'none'; return; }
    var r = elm.getBoundingClientRect();
    if (!r.width && !r.height) { hl.style.display = 'none'; return; }
    var cs = getComputedStyle(elm);
    var m = { t: parseFloat(cs.marginTop) || 0, r: parseFloat(cs.marginRight) || 0, b: parseFloat(cs.marginBottom) || 0, l: parseFloat(cs.marginLeft) || 0 };
    var p = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    var b = { t: parseFloat(cs.borderTopWidth) || 0, r: parseFloat(cs.borderRightWidth) || 0, b: parseFloat(cs.borderBottomWidth) || 0, l: parseFloat(cs.borderLeftWidth) || 0 };
    function set(d, x, y, w, h) { d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.width = Math.max(0, w) + 'px'; d.style.height = Math.max(0, h) + 'px'; }
    set(hlBoxes[0], r.left - m.l, r.top - m.t, r.width + m.l + m.r, r.height + m.t + m.b);
    set(hlBoxes[1], r.left, r.top, r.width, r.height);
    set(hlBoxes[2], r.left + b.l, r.top + b.t, r.width - b.l - b.r, r.height - b.t - b.b);
    set(hlBoxes[3], r.left + b.l + p.l, r.top + b.t + p.t, r.width - b.l - b.r - p.l - p.r, r.height - b.t - b.b - p.l - p.r);
    hl.style.display = 'block';
  }
  function hideHighlight() { hl.style.display = 'none'; }

  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; font: 12px/1.45 system-ui, sans-serif; }',
    '.panel { position: fixed; top: 0; right: 0; bottom: 0; width: var(--w, 420px); background: #202124; color: #e8eaed;',
    '  border-left: 1px solid #3c4043; display: flex; flex-direction: column; transform: translateX(100%); transition: transform .18s ease; }',
    '.panel.open { transform: none; }',
    '.drag { position: absolute; left: -4px; top: 0; bottom: 0; width: 8px; cursor: ew-resize; }',
    '.bar { display: flex; align-items: center; gap: 2px; padding: 4px 6px; background: #292a2d; border-bottom: 1px solid #3c4043; flex: none; }',
    '.tab { background: none; border: none; color: #9aa0a6; padding: 5px 10px; cursor: pointer; border-radius: 4px; font-weight: 600; font-size: 12px; }',
    '.tab.active { color: #8ab4f8; background: #3c4043; }',
    '.spacer { flex: 1; }',
    '.icon-btn { background: none; border: none; color: #9aa0a6; cursor: pointer; padding: 4px 7px; border-radius: 4px; font-size: 13px; }',
    '.icon-btn:hover { background: #3c4043; color: #e8eaed; }',
    '.icon-btn.on { color: #8ab4f8; }',
    '.content { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }',
    '.pane { flex: 1; overflow-y: auto; overflow-x: auto; min-height: 0; }',
    '.tree { padding: 4px 0; }',
    '.trow { display: flex; align-items: baseline; gap: 3px; padding: 0 6px 0 0; white-space: nowrap; border-radius: 3px; }',
    '.trow:hover { background: #2d2e31; }',
    '.trow.sel { background: #2a4d7a; }',
    '.tw { width: 12px; flex: none; cursor: pointer; color: #9aa0a6; text-align: center; }',
    '.tag { color: #8ab4f8; cursor: pointer; }',
    '.attr-n { color: #ff8b7b; }',
    '.attr-v { color: #a5d6a7; cursor: text; }',
    '.txt { color: #c9c9c9; cursor: text; }',
    '.dim { color: #9aa0a6; }',
    '.crumbs { display: flex; gap: 4px; padding: 5px 8px; background: #292a2d; border-bottom: 1px solid #3c4043; overflow-x: auto; white-space: nowrap; flex: none; }',
    '.crumb { cursor: pointer; color: #8ab4f8; border-radius: 3px; padding: 1px 4px; font-size: 12px; }',
    '.crumb:hover { background: #3c4043; }',
    '.dtabs { display: flex; gap: 2px; padding: 4px 8px 0; background: #292a2d; flex: none; }',
    '.dtab { background: none; border: none; color: #9aa0a6; padding: 4px 8px; cursor: pointer; border-radius: 4px 5px 0 0; font-size: 12px; }',
    '.dtab.active { color: #8ab4f8; background: #202124; }',
    '.details { border-top: 1px solid #3c4043; height: 45%; display: flex; flex-direction: column; min-height: 120px; flex: none; }',
    '.dpane { flex: 1; overflow-y: auto; padding: 6px 10px; }',
    '.sv { display: flex; gap: 6px; align-items: baseline; padding: 1px 2px; flex-wrap: wrap; }',
    '.sv:hover { background: #2d2e31; }',
    '.sv .pn { color: #c586c0; }',
    '.sv .pv { color: #a5d6a7; cursor: text; outline: none; }',
    '.sv .pv:focus { background: #1b1b1b; }',
    '.sv .rm { color: #9aa0a6; cursor: pointer; padding: 0 4px; }',
    '.rule-h { color: #9aa0a6; margin: 8px 0 2px; word-break: break-all; font-size: 12px; }',
    '.boxm table { border-collapse: collapse; margin: 8px auto; font-size: 12px; }',
    '.boxm td { border: 1px solid #555; padding: 3px 10px; text-align: center; color: #ddd; }',
    '.msg { padding: 2px 8px; border-bottom: 1px solid #292a2d; white-space: pre-wrap; word-break: break-word; font-size: 12px; }',
    '.msg.error { color: #f28b82; background: #2d1a1a; }',
    '.msg.warn { color: #fdd663; background: #2d261a; }',
    '.msg.result { color: #81c995; }',
    '.cin { display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid #3c4043; flex: none; }',
    '.cin .chev { color: #8ab4f8; }',
    '.cin input { flex: 1; background: #292a2d; border: 1px solid #3c4043; border-radius: 4px; color: #e8eaed; padding: 5px 8px; outline: none; font-family: ui-monospace, monospace; font-size: 12px; }',
    '.netrow { display: flex; gap: 8px; padding: 2px 8px; font-size: 12px; }',
    '.netrow:hover { background: #2d2e31; }',
    '.netrow .st { width: 34px; flex: none; }',
    '.netrow .st.ok { color: #81c995; } .netrow .st.bad { color: #f28b82; }',
    '.netrow .ty { width: 70px; flex: none; color: #9aa0a6; }',
    '.netrow .url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
    '.hint { color: #9aa0a6; padding: 10px; font-size: 12px; }',
    '.fab { position: fixed; right: 14px; bottom: 14px; width: 34px; height: 34px; border-radius: 50%; background: #292a2d; color: #9aa0a6;',
    '  border: 1px solid #3c4043; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 15px; z-index: 2147483646; }',
    '.fab:hover { color: #8ab4f8; background: #3c4043; }',
  ].join('\n');
  root.appendChild(style);

  var panel = el('div', 'panel', root);
  var fab = el('button', 'fab', root);
  fab.title = 'Inspect (Ctrl+Shift+I)';
  fab.textContent = '◎';
  fab.addEventListener('click', function () { toggle(); });

  /* ---------------- toolbar ---------------- */
  var bar = el('div', 'bar', panel);
  var dragHandle = el('div', 'drag', panel);
  var TABS = [['elements', 'Elements'], ['console', 'Console'], ['network', 'Network']];
  TABS.forEach(function (t) {
    var b = el('button', 'tab', bar);
    b.textContent = t[1];
    b.dataset.tab = t[0];
    b.addEventListener('click', function () { S.tab = t[0]; syncTabs(); render(); });
  });
  el('div', 'spacer', bar);
  var pickBtn = el('button', 'icon-btn', bar);
  pickBtn.textContent = '⌖';
  pickBtn.title = 'Pick element from page';
  pickBtn.addEventListener('click', function () {
    S.pickMode = !S.pickMode;
    pickBtn.classList.toggle('on', S.pickMode);
  });
  var closeBtn = el('button', 'icon-btn', bar);
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', function () { close(); });

  var content = el('div', 'content', panel);

  dragHandle.addEventListener('pointerdown', function (e) {
    S.dragging = true;
    dragHandle.setPointerCapture(e.pointerId);
  });
  dragHandle.addEventListener('pointermove', function (e) {
    if (!S.dragging) return;
    S.width = Math.max(300, Math.min(720, window.innerWidth - e.clientX));
    panel.style.setProperty('--w', S.width + 'px');
  });
  dragHandle.addEventListener('pointerup', function () { S.dragging = false; });

  /* ---------------- DOM helpers ---------------- */
  function skipNode(n) {
    return n === host || n === hl || (n.nodeType === 1 && n.id === PREFIX + '-host');
  }
  function interestingChildren(elm) {
    var out = [];
    for (var n = elm.firstChild; n; n = n.nextSibling) {
      if (skipNode(n)) continue;
      if (n.nodeType === 3) { if (n.textContent.trim().length) out.push(n); continue; }
      if (n.nodeType === 8) continue;
      out.push(n);
    }
    return out;
  }
  function expandPath(node) {
    var n = node;
    while (n && n !== document.documentElement) {
      if (n.parentElement) S.expanded.add(n.parentElement);
      n = n.parentElement;
    }
  }

  /* ---------------- elements pane ---------------- */
  var treeWrap, crumbs, details, dPane;
  function buildElementsPane() {
    content.innerHTML = '';
    crumbs = el('div', 'crumbs', content);
    treeWrap = el('div', 'pane tree', content);
    details = el('div', 'details', content);
    var dTabs = el('div', 'dtabs', details);
    DTABS.forEach(function (t) {
      var b = el('button', 'dtab', dTabs);
      b.textContent = t[1];
      b.addEventListener('click', function () { S.detailTab = t[0]; syncDTabs(); renderDetails(); });
    });
    dPane = el('div', 'dpane', details);
  }
  var DTABS = [['styles', 'Styles'], ['computed', 'Computed'], ['box', 'Box Model'], ['attrs', 'Attributes']];

  function renderTreeFlat() {
    if (!treeWrap) return;
    treeWrap.innerHTML = '';
    (function walk(node, depth) {
      treeWrap.appendChild(rowFor(node, depth));
      if (S.expanded.has(node)) {
        interestingChildren(node).forEach(function (k) { walk(k, depth + 1); });
      }
    })(document.documentElement, 0);
  }

  function rowFor(node, depth) {
    if (node.nodeType === 3) return textRow(node, depth);
    var r = el('div', 'trow');
    r.style.paddingLeft = (depth * 12 + 6) + 'px';
    var kids = interestingChildren(node);
    var tw = el('span', 'tw', r);
    tw.textContent = kids.length ? (S.expanded.has(node) ? '▾' : '▸') : '';
    if (kids.length) {
      tw.addEventListener('click', function (e) {
        e.stopPropagation();
        if (S.expanded.has(node)) S.expanded.delete(node); else S.expanded.add(node);
        renderTreeFlat();
      });
    }
    var tag = el('span', 'tag', r);
    tag.textContent = '<' + node.localName;
    if (node.attributes) {
      for (var i = 0; i < node.attributes.length; i++) {
        var a = node.attributes[i];
        r.appendChild(document.createTextNode(' '));
        var an = el('span', 'attr-n', r); an.textContent = a.name;
        r.appendChild(document.createTextNode('="'));
        var av = el('span', 'attr-v', r); av.textContent = a.value;
        r.appendChild(document.createTextNode('"'));
        bindEdit(av, a.value, function (v) { node.setAttribute(a.name, v); renderTreeFlat(); });
      }
    }
    r.appendChild(document.createTextNode('>'));
    if (node === S.selected) r.classList.add('sel');
    r.addEventListener('mousemove', function () { if (S.pickMode || S.selected !== node) showHighlight(node); });
    r.addEventListener('mouseleave', function () { if (!S.pickMode) { if (S.selected) showHighlight(S.selected); else hideHighlight(); } });
    r.addEventListener('click', function () { select(node); });
    return r;
  }

  function textRow(node, depth) {
    var r = el('div', 'trow');
    r.style.paddingLeft = (depth * 12 + 18) + 'px';
    var t = el('span', 'txt', r);
    t.textContent = '"' + node.textContent.trim().slice(0, 80) + '"';
    t.title = 'Double-click to edit text';
    bindEdit(t, node.textContent.trim(), function (v) { node.textContent = v; renderTreeFlat(); });
    return r;
  }

  function bindEdit(target, current, commit) {
    target.addEventListener('dblclick', function () {
      var input = document.createElement('input');
      input.value = current;
      input.style.cssText = 'flex:1;min-width:80px;background:#1b1b1b;color:#e8eaed;border:1px solid #3c4043;border-radius:3px;padding:1px 4px;';
      target.style.display = 'none';
      target.parentElement.insertBefore(input, target.nextSibling);
      input.focus();
      function done(save) {
        input.remove();
        target.style.display = '';
        if (save) commit(input.value);
      }
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', function () { done(true); });
    });
  }

  function select(node) {
    S.selected = node;
    expandPath(node);
    renderTreeFlat();
    renderCrumbs();
    renderDetails();
    showHighlight(node);
  }
  function renderCrumbs() {
    crumbs.innerHTML = '';
    if (!S.selected) return;
    var chain = [];
    var n = S.selected;
    while (n && n.nodeType === 1 && !skipNode(n)) { chain.unshift(n); n = n.parentElement; }
    chain.forEach(function (c, i) {
      var b = el('span', 'crumb', crumbs);
      b.textContent = c.localName + (c.id && c.id !== PREFIX + '-host' ? '#' + c.id : '');
      b.addEventListener('click', function () { select(c); });
      if (i < chain.length - 1) crumbs.appendChild(document.createTextNode(' › '));
    });
  }

  /* ---------------- details panes ---------------- */
  function renderDetails() {
    if (!dPane) return;
    syncDTabs();
    dPane.innerHTML = '';
    var node = S.selected;
    if (!node || node.nodeType !== 1) {
      dPane.appendChild(mkHint('Select an element in the tree, or use the pick tool (⌖).'));
      return;
    }
    if (S.detailTab === 'styles') renderStyles(dPane, node);
    else if (S.detailTab === 'computed') renderComputed(dPane, node);
    else if (S.detailTab === 'box') renderBox(dPane, node);
    else renderAttrs(dPane, node);
  }
  function mkHint(text) { var d = el('div', 'hint'); d.textContent = text; return d; }

  function renderStyles(p, node) {
    var h1 = el('div', 'rule-h', p);
    h1.textContent = 'element.style';
    var inline = node.getAttribute('style') || '';
    inline.split(';').map(function (d) { return d.trim(); }).filter(Boolean).map(function (d) {
      var i = d.indexOf(':');
      return i < 0 ? null : [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    }).filter(Boolean).forEach(function (pair) {
      declRow(p, pair[0], pair[1], function (prop, val, remove) {
        if (remove) node.style.removeProperty(prop);
        else node.style.setProperty(prop, val);
        renderDetails();
      });
    });
    var add = el('button', 'icon-btn', p);
    add.textContent = '+ property';
    add.style.marginTop = '4px';
    add.addEventListener('click', function () {
      var row = el('div', 'sv', p);
      var pn = el('span', 'pn', row); pn.textContent = 'prop';
      var pv = el('span', 'pv', row); pv.textContent = 'value';
      pn.contentEditable = 'true'; pv.contentEditable = 'true';
      pn.focus();
      function commit() {
        node.style.setProperty(pn.textContent.trim(), pv.textContent.trim());
        renderDetails();
      }
      [pn, pv].forEach(function (x) {
        x.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } e.stopPropagation(); });
        x.addEventListener('blur', commit, { once: true });
      });
    });

    var shown = 0;
    for (var si = 0; si < document.styleSheets.length; si++) {
      var sheet = document.styleSheets[si];
      var rules;
      try { rules = sheet.cssRules; } catch (e) {
        var h2 = el('div', 'rule-h', p);
        h2.textContent = 'stylesheet not accessible (cross-origin) — rules cannot be shown';
        continue;
      }
      if (!rules) continue;
      for (var ri = 0; ri < rules.length; ri++) {
        var rule = rules[ri];
        if (!rule.selectorText || !rule.style) continue;
        var match = false;
        try { match = node.matches(rule.selectorText); } catch (e) { continue; }
        if (!match) continue;
        shown++;
        var h3 = el('div', 'rule-h', p);
        h3.textContent = rule.selectorText + ' { }';
        for (var di = 0; di < rule.style.length; di++) {
          var prop = rule.style[di];
          var row = el('div', 'sv', p);
          var pn2 = el('span', 'pn', row); pn2.textContent = prop;
          var pv2 = el('span', 'pv', row); pv2.textContent = rule.style.getPropertyValue(prop);
        }
      }
    }
    if (!shown) {
      var h4 = el('div', 'rule-h', p);
      h4.textContent = '(no matching stylesheet rules)';
    }
  }

  function declRow(p, prop, val, onChange) {
    var row = el('div', 'sv', p);
    var pn = el('span', 'pn', row); pn.textContent = prop;
    var pv = el('span', 'pv', row); pv.textContent = val;
    var rm = el('span', 'rm', row); rm.textContent = '✕'; rm.title = 'Remove';
    rm.addEventListener('click', function () { onChange(prop, '', true); });
    pv.addEventListener('dblclick', function () {
      pv.contentEditable = 'true';
      pv.focus();
      document.execCommand('selectAll', false, null);
      function commit() { onChange(prop, pv.textContent.trim()); }
      pv.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); pv.blur(); }
        e.stopPropagation();
      });
      pv.addEventListener('blur', commit, { once: true });
    });
  }

  function renderComputed(p, node) {
    var cs = getComputedStyle(node);
    var search = el('input', '', p);
    search.placeholder = 'Filter computed properties';
    search.style.cssText = 'width:100%;margin-bottom:6px;background:#292a2d;border:1px solid #3c4043;border-radius:4px;color:#e8eaed;padding:4px 8px;';
    var list = el('div', '', p);
    search.addEventListener('input', fill);
    search.addEventListener('keydown', function (e) { e.stopPropagation(); });
    function fill() {
      list.innerHTML = '';
      var q = search.value.toLowerCase();
      for (var i = 0; i < cs.length; i++) {
        var prop = cs[i];
        if (q && prop.toLowerCase().indexOf(q) === -1) continue;
        var row = el('div', 'sv', list);
        var pn = el('span', 'pn', row); pn.textContent = prop;
        var pv = el('span', 'pv', row); pv.textContent = cs.getPropertyValue(prop);
      }
    }
    fill();
  }

  function renderBox(p, node) {
    var cs = getComputedStyle(node);
    var r = node.getBoundingClientRect();
    var box = el('div', 'boxm', p);
    var t = el('table', '', box);
    function row(cells) {
      var tr = t.insertRow();
      cells.forEach(function (c) {
        var td = tr.insertCell();
        td.textContent = c;
      });
    }
    row(['', cs.marginTop, '']);
    row([cs.marginLeft, Math.round(r.width) + ' × ' + Math.round(r.height), cs.marginRight]);
    row(['', cs.marginBottom, '']);
    var hint = el('div', 'hint', p);
    hint.textContent = 'content ' + Math.round(r.width) + ' × ' + Math.round(r.height) +
      ' · padding ' + cs.paddingTop + ' / ' + cs.paddingRight + ' · border ' + cs.borderTopWidth + ' · margin ' + cs.marginTop;
  }

  function renderAttrs(p, node) {
    if (!node.attributes.length) { p.appendChild(mkHint('(no attributes)')); return; }
    for (var i = 0; i < node.attributes.length; i++) {
      var a = node.attributes[i];
      var row = el('div', 'sv', p);
      var pn = el('span', 'pn', row); pn.textContent = a.name;
      var pv = el('span', 'pv', row); pv.textContent = '"' + a.value + '"';
      pv.addEventListener('dblclick', function () {
        var input = this;
        input.contentEditable = 'true';
        input.focus();
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
          e.stopPropagation();
        });
        input.addEventListener('blur', function () {
          node.setAttribute(a.name, input.textContent.replace(/^"|"$/g, ''));
          renderDetails();
        }, { once: true });
      }.bind(pv));
      var rm = el('span', 'rm', row); rm.textContent = '✕'; rm.title = 'Remove attribute';
      rm.addEventListener('click', function () { node.removeAttribute(a.name); renderDetails(); renderTreeFlat(); });
    }
  }

  /* ---------------- console pane ---------------- */
  var consolePane, consoleInput;
  function buildConsolePane() {
    content.innerHTML = '';
    consolePane = el('div', 'pane', content);
    var cin = el('div', 'cin', content);
    var chev = el('span', 'chev', cin); chev.textContent = '›';
    consoleInput = el('input', '', cin);
    consoleInput.placeholder = 'Run JavaScript and press Enter';
    consoleInput.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        var cmd = consoleInput.value.trim();
        if (!cmd) return;
        consoleInput.value = '';
        S.consoleHistory.push({ kind: 'input', text: cmd, t: Date.now() });
        try {
          var result = (0, eval)(cmd);
          pushMessage('result', ['→ ' + safeText([result])]);
        } catch (err) {
          pushMessage('error', [String(err)]);
        }
      }
    });
    renderConsole();
  }
  function renderConsole() {
    if (!consolePane) return;
    consolePane.innerHTML = '';
    S.consoleHistory.forEach(function (m) {
      var d = el('div', 'msg ' + m.kind, consolePane);
      var k = el('span', 'k', d);
      k.textContent = m.kind === 'result' ? '◂' : (m.kind === 'input' ? '▸' : m.kind);
      d.appendChild(document.createTextNode(m.text));
    });
    consolePane.scrollTop = consolePane.scrollHeight;
  }

  /* ---------------- network pane ---------------- */
  function buildNetworkPane() {
    content.innerHTML = '';
    var pane = el('div', 'pane', content);
    var label = el('div', 'hint', pane);
    label.textContent = 'Requests observed since page load (fetch/XHR only — a page cannot read the browser network stack).';
    S.net.forEach(function (n) {
      var row = el('div', 'netrow', pane);
      var st = el('span', 'st ' + (n.status >= 200 && n.status < 400 ? 'ok' : 'bad'), row);
      st.textContent = n.status;
      var ty = el('span', 'ty', row); ty.textContent = n.type;
      var url = el('span', 'url', row); url.textContent = n.url; url.title = n.url;
    });
  }

  /* ---------------- picking ---------------- */
  function deepestElementAt(x, y) {
    var stack = document.elementsFromPoint(x, y);
    for (var i = 0; i < stack.length; i++) {
      var s = stack[i];
      if (s === host || s === hl) continue;
      var n = s, inHost = false;
      while (n) { if (n === host) { inHost = true; break; } n = n.parentElement; }
      if (!inHost) return s;
    }
    return null;
  }
  document.addEventListener('mousemove', function (e) {
    if (!S.open || !S.pickMode) return;
    showHighlight(deepestElementAt(e.clientX, e.clientY));
  }, true);
  document.addEventListener('click', function (e) {
    if (!S.open || !S.pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    var t = deepestElementAt(e.clientX, e.clientY);
    if (t) {
      if (S.tab !== 'elements') { S.tab = 'elements'; syncTabs(); render(); }
      select(t);
      S.pickMode = false;
      pickBtn.classList.remove('on');
    }
  }, true);

  /* ---------------- keyboard ---------------- */
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyI' || e.key === 'I' || e.key === 'i')) {
      e.preventDefault();
      e.stopPropagation();
      toggle();
      return;
    }
    if (S.open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't let the page's own Escape handler fire too
      close();
    }
  }, true);
  // isolate typing inside the panel: events bubbling out through the
  // host are cut so page-level handlers never see them
  ['keydown', 'keyup', 'keypress'].forEach(function (type) {
    host.addEventListener(type, function (e) { e.stopPropagation(); });
  });

  /* ---------------- open / close / render ---------------- */
  function open() {
    if (S.open) return;
    S.open = true;
    S.focusBefore = document.activeElement;
    panel.classList.add('open');
    panel.style.setProperty('--w', S.width + 'px');
    host.style.width = S.width + 'px';
    render();
    S.onOpenCbs.forEach(function (cb) { try { cb(); } catch (e) {} });
  }
  function close() {
    if (!S.open) return;
    S.open = false;
    S.pickMode = false;
    pickBtn.classList.remove('on');
    panel.classList.remove('open');
    host.style.width = '0px';
    hideHighlight();
    S.onCloseCbs.forEach(function (cb) { try { cb(); } catch (e) {} });
    if (S.focusBefore && S.focusBefore.focus) { try { S.focusBefore.focus(); } catch (e) {} }
    S.focusBefore = null;
  }
  function toggle() { if (S.open) close(); else open(); }

  function render() {
    if (S.tab === 'elements') {
      buildElementsPane();
      renderTreeFlat();
      renderCrumbs();
      renderDetails();
    } else if (S.tab === 'console') buildConsolePane();
    else buildNetworkPane();
  }
  function syncTabs() {
    var tabs = bar.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('active', TABS[i][0] === S.tab);
  }
  function syncDTabs() {
    if (!details) return;
    var dt = details.querySelectorAll('.dtab');
    for (var i = 0; i < dt.length; i++) dt[i].classList.toggle('active', DTABS[i][0] === S.detailTab);
  }

  /* ---------------- live updates ---------------- */
  var treeDirty = false;
  function scheduleTree() {
    treeDirty = true;
    requestAnimationFrame(function () {
      if (!treeDirty) return;
      treeDirty = false;
      if (S.open && S.tab === 'elements') { renderTreeFlat(); renderCrumbs(); }
    });
  }
  var mo = new MutationObserver(function () { scheduleTree(); });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

  /* ---------------- boot ---------------- */
  function mount() {
    document.documentElement.appendChild(hl);
    document.documentElement.appendChild(host);
    // start with html > head/body expanded so the tree is useful immediately
    S.expanded.add(document.documentElement);
    if (document.head) S.expanded.add(document.head);
    if (document.body) S.expanded.add(document.body);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.ArtCraftInspector = {
    open: open,
    close: close,
    toggle: toggle,
    isOpen: function () { return S.open; },
    onOpen: function (cb) { S.onOpenCbs.push(cb); },
    onClose: function (cb) { S.onCloseCbs.push(cb); },
    version: '1.0.0',
  };
})();
