(function () {
  'use strict';

  var SUITS = ['♠︎', '♥︎', '♦︎', '♣︎']; // spade, heart, diamond, club
  var SUIT_ART = [
    '<path d="M50 5C40 25 7 41 7 62c0 12 9 21 21 21 8 0 15-4 19-11-1 10-5 18-13 23h32c-8-5-12-13-13-23 4 7 11 11 19 11 12 0 21-9 21-21C93 41 60 25 50 5z"/>',
    '<path d="M50 90C20 64 6 47 6 30 6 16 17 7 29 7c9 0 17 5 21 14C54 12 62 7 71 7c12 0 23 9 23 23 0 17-14 34-44 60z"/>',
    '<path d="M50 3c8 19 21 35 39 47-18 12-31 28-39 47-8-19-21-35-39-47C29 38 42 22 50 3z"/>',
    '<circle cx="50" cy="27" r="20"/><circle cx="27" cy="57" r="20"/><circle cx="73" cy="57" r="20"/><circle cx="50" cy="50" r="12"/><path d="M47 58c0 18-4 30-13 37h32c-9-7-13-19-13-37z"/>'
  ];
  function suitSvg(s, cls) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = SUIT_ART[s];
    return svg;
  }
  var RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var isRed = function (s) { return s === 1 || s === 2; };
  var $ = function (id) { return document.getElementById(id); };
  var board = $('board');

  var G = null;            // game state
  var history = [];        // undo snapshots
  var stats = { wins: 0, best: null };
  var els = {};            // card id -> element
  var slots = {};          // slot elements
  var L = {};              // layout numbers
  var auto = null;         // auto-finish timer
  var STATE_KEY = 'solitaire.state', STATS_KEY = 'solitaire.stats';

  // ---------- storage ----------
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function save() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(G)); localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  }

  // ---------- game setup ----------
  function rand(n) {
    if (window.crypto && crypto.getRandomValues) {
      var a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n;
      do { crypto.getRandomValues(a); } while (a[0] >= lim);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  function newGame(draw) {
    stopAuto();
    var deck = [];
    for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) deck.push({ id: s * 13 + r - 1, s: s, r: r, up: false });
    for (var i = deck.length - 1; i > 0; i--) { var j = rand(i + 1); var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    var tab = [];
    for (var c = 0; c < 7; c++) {
      var col = deck.splice(deck.length - (c + 1), c + 1);
      col[col.length - 1].up = true;
      tab.push(col);
    }
    G = { stock: deck, waste: [], found: [[], [], [], []], tab: tab, moves: 0, time: 0, draw: draw, won: false, started: false };
    history = [];
    save();
    board.classList.add('notrans'); render(); board.offsetHeight; board.classList.remove('notrans');
  }

  // ---------- rules ----------
  function canFound(card, fi) {
    var p = G.found[fi];
    return p.length ? (p[p.length - 1].s === card.s && card.r === p[p.length - 1].r + 1) : card.r === 1;
  }
  function canTab(card, ti) {
    var p = G.tab[ti];
    if (!p.length) return card.r === 13;
    var top = p[p.length - 1];
    return top.up && isRed(top.s) !== isRed(card.s) && top.r === card.r + 1;
  }
  function pileOf(loc) { return loc.t === 'tab' ? G.tab[loc.i] : loc.t === 'found' ? G.found[loc.i] : loc.t === 'waste' ? G.waste : G.stock; }
  function locate(id) {
    var i, j;
    for (j = 0; j < G.stock.length; j++) if (G.stock[j].id === id) return { t: 'stock', idx: j };
    for (j = 0; j < G.waste.length; j++) if (G.waste[j].id === id) return { t: 'waste', idx: j };
    for (i = 0; i < 4; i++) for (j = 0; j < G.found[i].length; j++) if (G.found[i][j].id === id) return { t: 'found', i: i, idx: j };
    for (i = 0; i < 7; i++) for (j = 0; j < G.tab[i].length; j++) if (G.tab[i][j].id === id) return { t: 'tab', i: i, idx: j };
    return null;
  }
  function movable(loc) {
    var p = pileOf(loc);
    if (loc.t === 'tab') return p[loc.idx].up;
    if (loc.t === 'waste' || loc.t === 'found') return loc.idx === p.length - 1;
    return false;
  }

  // ---------- actions ----------
  function snapshot() {
    history.push(JSON.stringify({ stock: G.stock, waste: G.waste, found: G.found, tab: G.tab, moves: G.moves }));
    if (history.length > 600) history.shift();
  }
  function afterAction(movedIds) {
    G.moves++; G.started = true;
    if (G.found.every(function (p) { return p.length === 13; })) win();
    save(); render(movedIds);
  }
  function doMove(src, dst) {
    snapshot();
    var from = pileOf(src), cards = from.splice(src.idx), to = pileOf(dst);
    Array.prototype.push.apply(to, cards);
    if (src.t === 'tab' && from.length) from[from.length - 1].up = true;
    afterAction(cards.map(function (c) { return c.id; }));
  }
  function drawStock() {
    if (!G.stock.length && !G.waste.length) return;
    snapshot();
    var moved = [];
    if (!G.stock.length) {
      G.stock = G.waste.reverse(); G.waste = [];
      G.stock.forEach(function (c) { c.up = false; });
    } else {
      for (var n = 0; n < G.draw && G.stock.length; n++) { var c = G.stock.pop(); c.up = true; G.waste.push(c); moved.push(c.id); }
    }
    afterAction(moved);
  }
  function undo() {
    if (!history.length || G.won) return;
    stopAuto();
    var s = JSON.parse(history.pop());
    G.stock = s.stock; G.waste = s.waste; G.found = s.found; G.tab = s.tab; G.moves = s.moves;
    save(); render();
  }
  // Tap a card: send it to the best legal spot.
  function autoMove(loc) {
    var p = pileOf(loc), cards = p.slice(loc.idx), lead = cards[0], i;
    if (cards.length === 1 && loc.t !== 'found') {
      for (i = 0; i < 4; i++) if (canFound(lead, i)) { doMove(loc, { t: 'found', i: i }); return true; }
    }
    var empty = -1;
    for (i = 0; i < 7; i++) {
      if (loc.t === 'tab' && loc.i === i) continue;
      if (!canTab(lead, i)) continue;
      if (G.tab[i].length) { doMove(loc, { t: 'tab', i: i }); return true; }
      if (empty < 0 && !(loc.t === 'tab' && loc.idx === 0)) empty = i; // moving a king between empty columns is pointless
    }
    if (empty >= 0) { doMove(loc, { t: 'tab', i: empty }); return true; }
    cards.forEach(function (c) {
      var el = els[c.id]; el.classList.remove('shake'); el.offsetWidth; el.classList.add('shake');
    });
    return false;
  }

  // ---------- auto finish ----------
  function canAutoFinish() {
    if (!G || G.won) return false;
    var allUp = G.tab.every(function (col) { return col.every(function (c) { return c.up; }); });
    return allUp && (G.draw === 1 || (!G.stock.length && !G.waste.length));
  }
  function stepAuto() {
    var best = null, i;
    for (i = 0; i < 7; i++) {
      var col = G.tab[i];
      if (col.length) for (var f = 0; f < 4; f++) if (canFound(col[col.length - 1], f) && (!best || col[col.length - 1].r < best.r)) best = { r: col[col.length - 1].r, src: { t: 'tab', i: i, idx: col.length - 1 }, f: f };
    }
    if (G.waste.length) { var w = G.waste[G.waste.length - 1]; for (var g = 0; g < 4; g++) if (canFound(w, g) && (!best || w.r < best.r)) best = { r: w.r, src: { t: 'waste', idx: G.waste.length - 1 }, f: g }; }
    if (best) { doMove(best.src, { t: 'found', i: best.f }); return true; }
    if (G.stock.length || G.waste.length) { drawStock(); return true; }
    return false;
  }
  function startAuto() {
    if (auto || !canAutoFinish()) return;
    var guard = 0;
    auto = setInterval(function () { if (G.won || ++guard > 600 || !stepAuto()) stopAuto(); }, 85);
  }
  function stopAuto() { if (auto) { clearInterval(auto); auto = null; } }

  // ---------- win ----------
  function fmt(t) { var m = Math.floor(t / 60), s = t % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function win() {
    G.won = true; stopAuto();
    stats.wins++;
    var best = stats.best === null || G.time < stats.best;
    if (best) stats.best = G.time;
    $('win-text').textContent = 'Finished in ' + fmt(G.time) + ' with ' + G.moves + ' moves.' + (best && stats.wins > 1 ? ' New best time!' : '');
    setTimeout(function () { if (G.won) $('win').hidden = false; }, 700);
  }

  // ---------- layout & render ----------
  function layout() {
    var W = board.clientWidth, H = board.clientHeight;
    var g = Math.max(4, Math.round(W * 0.012));
    var cw = Math.min((W - g * 8) / 7, 96, (H - g * 4) / 1.42 / 3.2);
    var ch = cw * 1.42;
    L = { W: W, H: H, g: g, cw: cw, ch: ch, x0: (W - (7 * cw + 6 * g)) / 2, y0: g * 1.5, y1: g * 1.5 + ch + g * 2 };
    board.style.setProperty('--cw', cw + 'px'); board.style.setProperty('--ch', ch + 'px');
  }
  function xc(c) { return L.x0 + c * (L.cw + L.g); }
  function place(el, x, y, z) { el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)'; el.style.zIndex = z; el._x = x; el._y = y; }

  var renderToken = 0;
  function render(movedIds) {
    layout();
    var token = ++renderToken, boost = {};
    (movedIds || []).forEach(function (id) { boost[id] = true; });
    function put(card, x, y, z, under) {
      var el = els[card.id]; el.classList.toggle('under', !!under);
      el.classList.toggle('up', card.up); el.classList.remove('drag');
      place(el, x, y, boost[card.id] ? z + 1000 : z); el._z = z;
    }
    var i, j;
    for (i = 0; i < 4; i++) place(slots['f' + i], xc(i), L.y0, 0);
    place(slots.stock, xc(6), L.y0, 0);
    for (i = 0; i < 7; i++) place(slots['t' + i], xc(i), L.y1, 0);
    slots.stock.textContent = G.waste.length ? '↻' : '';

    for (j = 0; j < G.stock.length; j++) put(G.stock[j], xc(6), L.y0, j + 1, j < G.stock.length - 1);
    var n = G.waste.length, fan = G.draw === 3 ? 3 : 1;
    for (j = 0; j < n; j++) { var k = n - 1 - j; put(G.waste[j], xc(5) - Math.min(k, fan - 1) * L.cw * 0.6, L.y0, j + 1, k > fan); }
    for (i = 0; i < 4; i++) for (j = 0; j < G.found[i].length; j++) put(G.found[i][j], xc(i), L.y0, j + 1, j < G.found[i].length - 2);
    for (i = 0; i < 7; i++) {
      var col = G.tab[i], total = 0;
      for (j = 0; j < col.length - 1; j++) total += col[j].up ? L.ch * 0.3 : L.ch * 0.14;
      var avail = L.H - L.y1 - L.ch - L.g, scale = total > avail ? avail / total : 1, y = L.y1;
      for (j = 0; j < col.length; j++) { put(col[j], xc(i), y, j + 1); y += (col[j].up ? L.ch * 0.3 : L.ch * 0.14) * scale; }
    }
    if (movedIds && movedIds.length) setTimeout(function () {
      if (token !== renderToken) return;
      movedIds.forEach(function (id) { els[id].style.zIndex = els[id]._z; });
    }, 240);

    $('moves').textContent = G.moves; $('time').textContent = fmt(G.time); $('wins').textContent = stats.wins;
    $('btn-undo').disabled = !history.length || G.won;
    $('btn-finish').hidden = !canAutoFinish() || !!auto;
  }

  function build() {
    function slot(key, label) { var s = document.createElement('div'); s.className = 'slot'; s.textContent = label || ''; board.appendChild(s); slots[key] = s; }
    for (var i = 0; i < 4; i++) slot('f' + i, 'A');
    slot('stock');
    for (i = 0; i < 7; i++) slot('t' + i);
    for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) {
      var el = document.createElement('div'); el.className = 'card'; el.dataset.id = s * 13 + r - 1;
      var face = document.createElement('div');
      face.className = 'face ' + (isRed(s) ? 'red' : 'black') + (r > 10 ? ' court' : r === 1 ? ' ace' : '');
      var idx = document.createElement('div'); idx.className = 'idx';
      var rk = document.createElement('span'); rk.className = 'rk' + (r === 10 ? ' ten' : ''); rk.textContent = RANKS[r];
      idx.appendChild(rk); idx.appendChild(suitSvg(s, 'st'));
      var mid = document.createElement('div'); mid.className = 'mid';
      if (r > 10) { var lt = document.createElement('span'); lt.className = 'letter'; lt.textContent = RANKS[r]; mid.appendChild(lt); }
      mid.appendChild(suitSvg(s, 'pip'));
      face.appendChild(idx); face.appendChild(mid);
      var back = document.createElement('div'); back.className = 'back';
      el.appendChild(face); el.appendChild(back); board.appendChild(el); els[s * 13 + r - 1] = el;
    }
  }

  // ---------- input: tap to auto-move, or drag ----------
  var P = null; // active pointer
  board.addEventListener('pointerdown', function (e) {
    if (P || auto || G.won || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var cardEl = e.target.closest ? e.target.closest('.card') : null;
    if (!cardEl) { if (e.target === slots.stock) drawStock(); return; }
    var loc = locate(+cardEl.dataset.id);
    if (!loc) return;
    if (loc.t === 'stock') { P = { id: e.pointerId, stock: true }; }
    else if (movable(loc)) { P = { id: e.pointerId, loc: loc, cards: pileOf(loc).slice(loc.idx), sx: e.clientX, sy: e.clientY, drag: false }; }
    else return;
    try { board.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  board.addEventListener('pointermove', function (e) {
    if (!P || e.pointerId !== P.id || P.stock) return;
    var dx = e.clientX - P.sx, dy = e.clientY - P.sy;
    if (!P.drag) {
      if (dx * dx + dy * dy < 64) return;
      P.drag = true;
      P.cards.forEach(function (c, k) { var el = els[c.id]; el.classList.add('drag'); el.style.zIndex = 2000 + k; el._bx = el._x; el._by = el._y; });
    }
    P.cards.forEach(function (c) { var el = els[c.id]; el.style.transform = 'translate(' + (el._bx + dx) + 'px,' + (el._by + dy) + 'px)'; });
    P.dx = dx; P.dy = dy;
  });
  function endPointer(e, cancelled) {
    if (!P || e.pointerId !== P.id) return;
    var p = P; P = null;
    try { board.releasePointerCapture(e.pointerId); } catch (err) {}
    if (p.stock) { if (!cancelled) drawStock(); return; }
    if (!p.drag) { if (!cancelled) autoMove(p.loc); return; }
    var lead = els[p.cards[0].id], cx = lead._bx + p.dx + L.cw / 2, cy = lead._by + p.dy + L.ch / 2;
    var col = Math.round((cx - L.cw / 2 - L.x0) / (L.cw + L.g)), dst = null;
    if (!cancelled && col >= 0 && col <= 6) {
      if (cy < L.y1 - L.g) { if (col <= 3 && p.cards.length === 1 && p.loc.t !== 'found' && canFound(p.cards[0], col)) dst = { t: 'found', i: col }; }
      else if (!(p.loc.t === 'tab' && p.loc.i === col) && canTab(p.cards[0], col)) dst = { t: 'tab', i: col };
    }
    p.cards.forEach(function (c) { els[c.id].classList.remove('drag'); });
    if (dst) doMove(p.loc, dst); else render(p.cards.map(function (c) { return c.id; }));
  }
  board.addEventListener('pointerup', function (e) { endPointer(e, false); });
  board.addEventListener('pointercancel', function (e) { endPointer(e, true); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---------- buttons ----------
  $('btn-undo').addEventListener('click', undo);
  $('btn-finish').addEventListener('click', function () { startAuto(); render(); });
  $('btn-new').addEventListener('click', function () { $('sheet').hidden = false; });
  $('sheet-cancel').addEventListener('click', function () { $('sheet').hidden = true; });
  document.querySelectorAll('[data-draw]').forEach(function (b) {
    b.addEventListener('click', function () { $('sheet').hidden = true; $('win').hidden = true; newGame(+b.dataset.draw); });
  });
  $('win-new').addEventListener('click', function () { $('win').hidden = true; $('sheet').hidden = false; });

  // ---------- timer ----------
  setInterval(function () {
    if (G && G.started && !G.won && !document.hidden) { G.time++; $('time').textContent = fmt(G.time); if (G.time % 5 === 0) save(); }
  }, 1000);
  document.addEventListener('visibilitychange', function () { if (document.hidden && G) save(); });
  window.addEventListener('resize', function () { board.classList.add('notrans'); render(); board.offsetHeight; board.classList.remove('notrans'); });

  // ---------- start ----------
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) $('install-hint').hidden = true;
  stats = load(STATS_KEY) || stats;
  build();
  var saved = load(STATE_KEY);
  if (saved && saved.tab && saved.tab.length === 7 && !saved.won) {
    G = saved; board.classList.add('notrans'); render(); board.offsetHeight; board.classList.remove('notrans');
  } else newGame(saved && saved.draw === 3 ? 3 : 1);

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });

  // Exposed for automated testing.
  window.__sol = { state: function () { return G; }, set: function (s) { G = s; history = []; render(); }, autoMove: autoMove, locate: locate, draw: drawStock, canAutoFinish: canAutoFinish };
})();
