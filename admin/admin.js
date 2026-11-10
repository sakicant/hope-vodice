/* Calendar admin.
   Edits one apartment's calendar-<id>.json at a time through api/admin.php.
   Nothing is written until Save, so a wrong click costs nothing.
   Prices and seasons are read with the same HopeCal rules the public site
   uses, so what is previewed here is what a guest will be shown. */
(function () {
  'use strict';

  var C = window.HopeCal;
  var API = '../api/admin.php';
  var DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    apt: 'h1',
    apartments: {},
    cal: null,
    dirty: false,
    cursor: null,
    from: null,
    to: null
  };

  /* --- transport --------------------------------------------------------- */

  function call(action, opts) {
    opts = opts || {};
    var url = API + '?action=' + encodeURIComponent(action) + (opts.query || '');
    var init = { credentials: 'same-origin' };
    if (opts.body) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body);
    }
    return fetch(url, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'The server did not answer properly.' }; })
        .then(function (data) {
          if (!data.ok) throw new Error(data.error || 'Something went wrong.');
          return data;
        });
    });
  }

  function notice(text, kind) {
    var el = $('notice');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'notice notice--' + (kind || 'warn');
  }

  /* --- sign in ----------------------------------------------------------- */

  var setup = false;

  function showGate(needsSetup) {
    setup = needsSetup;
    $('gate').hidden = false;
    $('app').hidden = true;
    $('gate-title').textContent = needsSetup ? 'Choose a password' : 'Sign in';
    $('gate-lead').textContent = needsSetup
      ? 'Nobody has set one yet. Pick something long, write it down, and keep it.'
      : 'Enter the calendar password.';
    $('gate-btn').textContent = needsSetup ? 'Set the password' : 'Sign in';
    $('pw2-wrap').hidden = !needsSetup;
    $('pw').setAttribute('autocomplete', needsSetup ? 'new-password' : 'current-password');
    $('pw').focus();
  }

  $('gate-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $('gate-msg');
    var pw = $('pw').value;
    msg.textContent = '';
    msg.className = 'msg';

    if (setup && pw !== $('pw2').value) {
      msg.textContent = 'The two passwords are not the same.';
      msg.className = 'msg is-err';
      return;
    }

    $('gate-btn').disabled = true;
    call(setup ? 'setup' : 'login', { body: { password: pw } })
      .then(function () {
        $('pw').value = '';
        $('pw2').value = '';
        $('gate').hidden = true;
        $('app').hidden = false;
        return boot();
      })
      .catch(function (err) {
        msg.textContent = err.message;
        msg.className = 'msg is-err';
      })
      .then(function () { $('gate-btn').disabled = false; });
  });

  $('logout').addEventListener('click', function () {
    if (state.dirty && !confirm('There are unsaved changes. Sign out anyway?')) return;
    call('logout').then(function () { location.reload(); });
  });

  /* --- calendar rendering ------------------------------------------------ */

  function markDirty(on) {
    state.dirty = on;
    $('save').disabled = !on;
    $('state').textContent = on ? 'Unsaved changes' : 'Saved';
    $('state').className = 'bar__state' + (on ? ' is-dirty' : '');
  }

  function dayCell(date) {
    var info = C.dayInfo(state.cal, date);
    var key = info.key;
    var cls = 'day';
    if (info.past) cls += ' day--past';
    if (info.booked) cls += ' day--booked';
    if (info.hasOverride && !info.booked) cls += ' day--override';
    if (state.from && state.to && key >= state.from && key <= state.to) cls += ' day--sel';
    else if (key === state.from) cls += ' day--sel';

    var price = info.price != null
      ? '<span class="day__p">' + C.money(info.price, state.cal.currency) + '</span>'
      : '<span class="day__p">—</span>';

    return '<button type="button" class="' + cls + '" data-day="' + key + '">' +
      '<span class="day__n">' + date.getDate() + '</span>' + price + '</button>';
  }

  function monthHtml(base, offset) {
    var d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    var y = d.getFullYear(), m = d.getMonth();
    var days = new Date(y, m + 1, 0).getDate();
    var lead = (new Date(y, m, 1).getDay() + 6) % 7;

    var cells = '';
    for (var p = 0; p < lead; p++) cells += '<div class="day day--pad"></div>';
    for (var n = 1; n <= days; n++) cells += dayCell(new Date(y, m, n));

    return '<div><div class="month__name">' + C.MONTHS[m] + ' ' + y + '</div>' +
      '<div class="cells">' +
      DOW.map(function (x) { return '<div class="dow">' + x + '</div>'; }).join('') +
      cells + '</div></div>';
  }

  function render() {
    $('months').innerHTML = monthHtml(state.cursor, 0) + monthHtml(state.cursor, 1);
    var end = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 1);
    $('range').textContent = C.MONTHS[state.cursor.getMonth()] + ' – ' +
      C.MONTHS[end.getMonth()] + ' ' + end.getFullYear();
    renderSelection();
  }

  function renderSelection() {
    var has = !!state.from;
    $('sel-fields').disabled = !has;
    if (!has) {
      $('sel-label').textContent = 'Nothing selected yet.';
      return;
    }
    var to = state.to || state.from;
    var nights = C.nightsBetween(C.parse(state.from), C.parse(to)) + 1;
    $('sel-label').textContent = state.from === to
      ? C.prettyDate(state.from)
      : C.prettyRange(state.from, to) + ' · ' + nights + ' dates';

    // Show what the first selected date currently holds, as a starting point.
    var info = C.dayInfo(state.cal, C.parse(state.from));
    var override = (state.cal.days || {})[state.from] || {};
    document.querySelector('input[name="status"][value="' + (info.booked ? 'booked' : 'available') + '"]').checked = true;
    $('price').value = override.price != null ? override.price : '';
    $('minn').value = override.minNights != null ? override.minNights : '';
  }

  $('months').addEventListener('click', function (e) {
    var cell = e.target.closest('[data-day]');
    if (!cell) return;
    var k = cell.getAttribute('data-day');
    if (!state.from || state.to || k < state.from) {
      state.from = k;
      state.to = null;
    } else {
      state.to = k;
    }
    render();
  });

  $('prev').addEventListener('click', function () { step(-2); });
  $('next').addEventListener('click', function () { step(2); });

  function step(n) {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + n, 1);
    render();
  }

  /* --- editing ----------------------------------------------------------- */

  function eachSelected(fn) {
    var a = C.parse(state.from);
    var b = C.parse(state.to || state.from);
    for (var d = a; d <= b; d = C.addDays(d, 1)) fn(C.key(d));
  }

  $('apply').addEventListener('click', function () {
    if (!state.from) return;
    var booked = document.querySelector('input[name="status"]:checked').value === 'booked';
    var price = $('price').value.trim();
    var minn = $('minn').value.trim();

    state.cal.days = state.cal.days || {};
    eachSelected(function (k) {
      var entry = {};
      if (booked) entry.status = 'booked';
      if (price !== '') entry.price = Number(price);
      if (minn !== '') entry.minNights = Number(minn);
      // A date that overrides nothing is removed, so the file stays small and
      // a later season change still reaches it.
      if (Object.keys(entry).length) state.cal.days[k] = entry;
      else delete state.cal.days[k];
    });
    markDirty(true);
    render();
  });

  $('reset').addEventListener('click', function () {
    if (!state.from) return;
    eachSelected(function (k) { delete (state.cal.days || {})[k]; });
    $('price').value = '';
    $('minn').value = '';
    document.querySelector('input[name="status"][value="available"]').checked = true;
    markDirty(true);
    render();
  });

  /* --- seasons ----------------------------------------------------------- */

  function renderSeasons() {
    $('seasons').innerHTML = (state.cal.seasons || []).map(function (s, i) {
      return '<div class="season seasons" data-i="' + i + '">' +
        '<div class="season__name">' + s.name + '</div>' +
        '<div class="season__row">' +
          '<div><label>From (MM-DD)</label><input data-f="from" value="' + s.from + '"></div>' +
          '<div><label>To (MM-DD)</label><input data-f="to" value="' + s.to + '"></div>' +
          '<div><label>Price €</label><input data-f="price" type="number" min="0" step="1" placeholder="not set" value="' +
            (s.price == null ? '' : s.price) + '"></div>' +
          '<div><label>Min nights</label><input data-f="minNights" type="number" min="1" step="1" value="' +
            (s.minNights || 1) + '"></div>' +
        '</div></div>';
    }).join('');
  }

  $('seasons').addEventListener('input', function (e) {
    var input = e.target.closest('input[data-f]');
    if (!input) return;
    var i = Number(input.closest('[data-i]').getAttribute('data-i'));
    var f = input.getAttribute('data-f');
    var v = input.value.trim();
    state.cal.seasons[i][f] = (f === 'price')
      ? (v === '' ? null : Number(v))
      : (f === 'minNights' ? Number(v || 1) : v);
    markDirty(true);
    render();
  });

  /* --- save -------------------------------------------------------------- */

  $('save').addEventListener('click', function () {
    $('save').disabled = true;
    notice('');
    call('save', { body: { apt: state.apt, calendar: state.cal } })
      .then(function (res) {
        markDirty(false);
        notice('Saved. ' + res.days + ' dates have their own setting.', 'ok');
        setTimeout(function () { notice(''); }, 4000);
      })
      .catch(function (err) {
        notice(err.message, 'warn');
        $('save').disabled = false;
      });
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* --- boot -------------------------------------------------------------- */

  function loadApartment(id) {
    if (state.dirty && !confirm('There are unsaved changes. Leave them?')) return Promise.resolve();
    return call('load', { query: '&apt=' + encodeURIComponent(id) }).then(function (res) {
      state.apt = id;
      state.cal = res.calendar;
      state.cal.days = state.cal.days || {};
      state.from = state.to = null;
      state.cursor = new Date(C.today().getFullYear(), C.today().getMonth(), 1);
      markDirty(false);
      renderTabs();
      renderSeasons();
      render();
    });
  }

  function renderTabs() {
    $('tabs').innerHTML = Object.keys(state.apartments).map(function (id) {
      return '<button type="button" data-apt="' + id + '" aria-pressed="' +
        (id === state.apt) + '">' + state.apartments[id] + '</button>';
    }).join('');
  }

  $('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-apt]');
    if (b) loadApartment(b.getAttribute('data-apt'));
  });

  function boot() {
    return call('state').then(function (s) {
      state.apartments = s.apartments;
      if (!s.writable) {
        notice('assets/data is not writable on this server, so nothing can be saved. Give the folder write permission.', 'warn');
      }
      return loadApartment(Object.keys(s.apartments)[0]);
    });
  }

  call('state')
    .then(function (s) {
      if (s.needsSetup) return showGate(true);
      if (!s.authed) return showGate(false);
      $('app').hidden = false;
      return boot();
    })
    .catch(function () {
      document.body.innerHTML =
        '<div class="gate"><div class="gate__card"><h1>No server here</h1>' +
        '<p class="gate__lead">This panel needs PHP. It works on the live host, ' +
        'not on a static preview.</p></div></div>';
    });
})();
