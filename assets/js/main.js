/* Hope Apartments site behaviour. No dependencies.
   Nav, gallery lightbox, per-apartment calendars, "from" prices, inquiry form. */
(function () {
  'use strict';

  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();

  /* --- mobile nav -------------------------------------------------------- */
  var burger = document.querySelector('.burger');
  var mnav = document.getElementById('mobile-nav');
  if (burger && mnav) {
    burger.addEventListener('click', function () {
      var open = burger.getAttribute('aria-expanded') === 'true';
      burger.setAttribute('aria-expanded', String(!open));
      mnav.classList.toggle('is-open', !open);
    });
    mnav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        burger.setAttribute('aria-expanded', 'false');
        mnav.classList.remove('is-open');
      }
    });
  }

  /* --- gallery lightbox -------------------------------------------------- */
  var tiles = Array.prototype.slice.call(document.querySelectorAll('.gal__item'));
  if (tiles.length) {
    var lb = document.createElement('div');
    lb.className = 'lb';
    lb.innerHTML =
      '<button class="lb__btn lb__close" type="button" aria-label="Close">&times;</button>' +
      '<button class="lb__btn lb__prev" type="button" aria-label="Previous photo">&#8249;</button>' +
      '<button class="lb__btn lb__next" type="button" aria-label="Next photo">&#8250;</button>' +
      '<div><img alt=""><p class="lb__cap"></p></div>';
    document.body.appendChild(lb);

    var lbImg = lb.querySelector('img');
    var lbCap = lb.querySelector('.lb__cap');
    var i = 0;
    var opener = null;

    function show(n) {
      i = (n + tiles.length) % tiles.length;
      lbImg.src = tiles[i].getAttribute('data-full');
      lbImg.alt = tiles[i].getAttribute('data-cap') || '';
      lbCap.textContent = tiles[i].getAttribute('data-cap') || '';
    }
    function open(n) {
      opener = tiles[n];
      show(n);
      lb.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      lb.querySelector('.lb__close').focus();
    }
    function close() {
      lb.classList.remove('is-open');
      document.body.style.overflow = '';
      if (opener) opener.focus();
    }

    tiles.forEach(function (t, n) {
      t.addEventListener('click', function () { open(n); });
    });
    lb.querySelector('.lb__close').addEventListener('click', close);
    lb.querySelector('.lb__prev').addEventListener('click', function () { show(i - 1); });
    lb.querySelector('.lb__next').addEventListener('click', function () { show(i + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(i - 1);
      if (e.key === 'ArrowRight') show(i + 1);
    });

    var x0 = null;
    lb.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(dx > 0 ? i - 1 : i + 1);
      x0 = null;
    });
  }

  /* --- calendars ----------------------------------------------------------
     Each apartment owns its own calendar file, so a calendar is built per
     [data-cal] element rather than once per page. Two calendars can sit on the
     same page without sharing state: every selector below is scoped to its own
     root, and the selected range lives in the closure, not in a global. */

  var C = window.HopeCal;
  var DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  var fileCache = {};

  /** Fetch an apartment's calendar once, however many widgets want it. */
  function loadCal(src) {
    if (!fileCache[src]) {
      fileCache[src] = fetch(src, { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); });
    }
    return fileCache[src];
  }

  function initCalendar(root) {
    var src = root.getAttribute('data-cal-src');
    var aptId = root.getAttribute('data-cal') || '';
    var aptName = root.getAttribute('data-cal-name') || '';
    if (!src) return;

    var monthsEl = root.querySelector('[data-cal-months]');
    var rangeEl = root.querySelector('[data-cal-range]');
    var prevBtn = root.querySelector('[data-cal-prev]');
    var nextBtn = root.querySelector('[data-cal-next]');
    var updEl = root.querySelector('[data-cal-updated]');
    var summaryEl = root.querySelector('[data-cal-summary]');
    if (!monthsEl) return;

    var data = null;
    var today = C.today();
    var firstMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    var lastMonth = new Date(today.getFullYear() + 2, today.getMonth(), 1);
    var cursor = new Date(firstMonth);
    var arrival = null;
    var departure = null;

    /* one month as HTML */
    function monthHtml(base, offset) {
      var d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
      var y = d.getFullYear(), m = d.getMonth();
      var days = new Date(y, m + 1, 0).getDate();
      var lead = (new Date(y, m, 1).getDay() + 6) % 7;   // Monday first

      var cells = '';
      for (var p = 0; p < lead; p++) cells += '<div class="cal-day cal-day--pad"></div>';

      for (var n = 1; n <= days; n++) {
        var date = new Date(y, m, n);
        var info = C.dayInfo(data, date);
        var cls = 'cal-day';
        var label;

        if (info.past) { cls += ' cal-day--past'; label = 'in the past'; }
        else if (info.booked) { cls += ' cal-day--booked'; label = 'booked'; }
        else { cls += ' cal-day--free'; label = 'available'; }

        // The departure day is not a night anyone pays for, so it reads as an
        // endpoint rather than part of the selected block.
        if (arrival && departure && info.key > arrival && info.key < departure) cls += ' cal-day--in-range';
        if (info.key === arrival) cls += ' cal-day--start';
        if (info.key === departure) cls += ' cal-day--end';
        if (date.getTime() === today.getTime()) cls += ' cal-day--today';

        var showPrice = info.price != null && !info.past && !info.booked;
        var price = showPrice
          ? '<span class="cal-day__price">' + C.money(info.price, data && data.currency) + '</span>'
          : '';
        var selectable = !info.past && (!info.booked || info.key === departure);

        cells += '<' + (selectable ? 'button type="button"' : 'div') +
          ' class="' + cls + '" data-day="' + info.key + '"' +
          (selectable ? '' : ' aria-disabled="true"') + '>' +
          '<span class="cal-day__n" aria-hidden="true">' + n + '</span>' + price +
          '<span class="sr-only">' + n + ' ' + C.MONTHS[m] + ' ' + y + ', ' + label +
          (showPrice ? ', ' + C.money(info.price, data && data.currency) + ' per night' : '') +
          '</span></' + (selectable ? 'button' : 'div') + '>';
      }

      return '<div class="cal-month"><div class="cal-month__name">' + C.MONTHS[m] + ' ' + y +
        '</div><div class="cal-grid" role="group" aria-label="' + C.MONTHS[m] + ' ' + y +
        (aptName ? ', ' + aptName : '') + '">' +
        DOW.map(function (x) { return '<div class="cal-dow" aria-hidden="true">' + x + '</div>'; }).join('') +
        cells + '</div></div>';
    }

    function renderSummary() {
      if (!summaryEl) return;

      if (!arrival) {
        summaryEl.className = 'cal-summary';
        summaryEl.innerHTML = '<p class="cal-summary__hint">Pick your arrival date, then your departure date, and the total for ' +
          (aptName || 'this apartment') + ' appears here.</p>';
        return;
      }

      if (!departure) {
        summaryEl.className = 'cal-summary is-partial';
        summaryEl.innerHTML = '<p class="cal-summary__hint">Arriving <strong>' + C.prettyDate(arrival) +
          '</strong>. Now pick your departure date.</p>' +
          '<button class="cal-summary__clear" type="button" data-cal-clear>Clear</button>';
        return;
      }

      var q = C.quote(data, arrival, departure);
      if (!q.ok) {
        summaryEl.className = 'cal-summary is-error';
        summaryEl.innerHTML = '<p class="cal-summary__hint">' + q.message + '</p>' +
          '<button class="cal-summary__clear" type="button" data-cal-clear>Start again</button>';
        return;
      }

      var cur = data && data.currency;
      var spread = q.lowest === q.highest
        ? C.money(q.lowest, cur) + ' per night'
        : C.money(q.lowest, cur) + ' – ' + C.money(q.highest, cur) + ' per night';

      summaryEl.className = 'cal-summary is-ok';
      summaryEl.innerHTML =
        '<div class="cal-summary__main">' +
          '<p class="cal-summary__dates">' + C.prettyRange(q.arrival, q.departure) + '</p>' +
          '<p class="cal-summary__meta">' + (aptName ? aptName + ' · ' : '') + q.nights +
            ' night' + (q.nights > 1 ? 's' : '') + ' · ' + spread + '</p>' +
        '</div>' +
        '<div class="cal-summary__total">' +
          '<span class="cal-summary__totallabel">Total</span>' +
          '<strong>' + C.money(q.total, cur) + '</strong>' +
        '</div>' +
        '<div class="cal-summary__actions">' +
          '<a class="btn btn--primary" href="/contact/?apt=' + encodeURIComponent(aptId) +
            '&amp;arrival=' + q.arrival + '&amp;departure=' + q.departure + '">Request these dates</a>' +
          '<button class="cal-summary__clear" type="button" data-cal-clear>Clear</button>' +
        '</div>';
    }

    function render() {
      monthsEl.innerHTML = monthHtml(cursor, 0) + monthHtml(cursor, 1);
      var end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      if (rangeEl) {
        rangeEl.textContent = C.MONTHS[cursor.getMonth()] + ' – ' +
          C.MONTHS[end.getMonth()] + ' ' + end.getFullYear();
      }
      if (prevBtn) prevBtn.disabled = cursor <= firstMonth;
      if (nextBtn) nextBtn.disabled = cursor >= lastMonth;
      renderSummary();
    }

    function pick(k) {
      if (!arrival || departure) { arrival = k; departure = null; }
      else if (k === arrival) { arrival = null; departure = null; }
      else if (k < arrival) { arrival = k; departure = null; }
      else { departure = k; }
      render();
    }

    monthsEl.addEventListener('click', function (e) {
      var cell = e.target.closest('[data-day]');
      if (!cell || cell.tagName !== 'BUTTON') return;
      pick(cell.getAttribute('data-day'));
    });

    root.addEventListener('click', function (e) {
      if (e.target.closest('[data-cal-clear]')) {
        arrival = null; departure = null; render();
      }
    });

    function step(n) {
      var next = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1);
      if (next < firstMonth || next > lastMonth) return;
      cursor = next;
      render();
    }
    if (prevBtn) prevBtn.addEventListener('click', function () { step(-2); });
    if (nextBtn) nextBtn.addEventListener('click', function () { step(2); });

    render();

    loadCal(src)
      .then(function (json) {
        data = json;
        render();
        if (updEl) {
          updEl.textContent = 'Availability and prices updated ' +
            String(data.updated || '').slice(0, 10) +
            '. We confirm the exact dates when you send your request.';
        }
      })
      .catch(function () {
        if (updEl) {
          updEl.textContent = 'We could not load live availability just now. Send us a message and we will confirm your dates.';
        }
      });
  }

  /* --- rate cards ---------------------------------------------------------
     A rates block is its own widget rather than a part of the calendar: it
     usually sits in a different section of the page, and putting it here means
     a page can show one apartment's prices without also drawing its calendar.
     Both read the same file, so the published price list cannot drift from
     what availability is priced at. */
  function initRates(el) {
    var src = el.getAttribute('data-cal-src');
    var aptName = el.getAttribute('data-cal-name') || 'this apartment';
    if (!src) return;

    function fail(message) {
      el.innerHTML = '<div class="rates__empty">' + message + '</div>';
    }

    loadCal(src)
      .then(function (data) {
        if (!data || !data.seasons || !data.seasons.length) {
          return fail('<strong>Rates for ' + aptName + ' are not published yet.</strong> ' +
            'Send us your dates and we will quote you directly.');
        }
        var cur = data.currency;

        // Only a season carrying a real number can be the peak. With no prices
        // loaded yet every Number(null) is 0, and the cheapest month would get
        // flagged "busiest", so the badge stays off until there is something
        // to compare.
        var priced = data.seasons.filter(function (s) {
          return s.price != null && !isNaN(Number(s.price)) && Number(s.price) > 0;
        });
        var peak = priced.length
          ? priced.reduce(function (a, b) { return Number(b.price) > Number(a.price) ? b : a; })
          : null;

        el.innerHTML = data.seasons.map(function (s) {
          var isPeak = peak && s.id === peak.id;
          var price = s.price == null
            ? '<span class="rate__onreq">Rate on request</span>'
            : C.money(s.price, cur) + '<span> / night</span>';
          return '<div class="rate' + (isPeak ? ' rate--peak' : '') + '">' +
            (isPeak ? '<span class="rate__tag">Busiest</span>' : '') +
            '<h3>' + s.name + '</h3>' +
            '<p class="rate__dates">' + C.seasonDates(s) + '</p>' +
            '<p class="rate__price">' + price + '</p>' +
            '<p class="rate__min">Minimum ' + s.minNights + ' night' + (s.minNights > 1 ? 's' : '') + '</p>' +
          '</div>';
        }).join('');

        if (!priced.length) {
          el.insertAdjacentHTML('beforeend',
            '<div class="rates__empty">The rates for ' + aptName +
            ' are not published yet. Pick your dates in the calendar above and ask ' +
            'us for a quote, and we will reply with the exact total.</div>');
        }
      })
      .catch(function () {
        fail('We could not load the rates just now. Send us your dates and we will quote you.');
      });
  }

  if (C) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-cal-months]'), function (el) {
      initCalendar(el.closest('[data-cal]') || el.parentNode);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-cal-rates]'), initRates);
  }

  /* --- "from €X" prices on the compare page ------------------------------- */
  if (C) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-from-src]'), function (el) {
      loadCal(el.getAttribute('data-from-src'))
        .then(function (data) {
          var low = C.lowestRate(data);
          el.innerHTML = low == null
            ? '<span>Ask us for a quote</span>'
            : C.money(low, data.currency) + '<span> / night, low season</span>';
        })
        .catch(function () { el.innerHTML = '<span>Ask us for a quote</span>'; });
    });
  }

  /* --- dates carried over from a calendar ---------------------------------
     A calendar links to /contact/?apt=&arrival=&departure=. The quote is
     recalculated here from the apartment's own file and never trusted from
     the URL, which anyone can edit. */
  var quoteBox = document.querySelector('[data-quote]');
  if (quoteBox && C) {
    var params = new URLSearchParams(location.search);
    var apt = (params.get('apt') || '').replace(/[^a-z0-9-]/gi, '');
    var arrival = params.get('arrival');
    var departure = params.get('departure');
    var isDate = function (s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); };

    if (apt && isDate(arrival) && isDate(departure)) {
      var aptField = document.getElementById('apartment');
      if (aptField) aptField.value = apt;

      loadCal('/assets/data/calendar-' + apt + '.json')
        .then(function (data) {
          var q = C.quote(data, arrival, departure);
          var name = (data && data.apartment) || apt.toUpperCase();
          var msg = document.getElementById('message');

          if (q.ok) {
            quoteBox.innerHTML =
              '<strong>' + name + ' · ' + C.prettyRange(q.arrival, q.departure) + '</strong><br>' +
              q.nights + ' night' + (q.nights > 1 ? 's' : '') + ' · total ' +
              C.money(q.total, data.currency) +
              '<br><span class="muted small">We confirm this when we reply.</span>';
            quoteBox.hidden = false;
            if (msg && !msg.value) {
              msg.value = 'Hello,\n\nI would like to book ' + name + ' from ' +
                C.prettyDate(q.arrival) + ' to ' + C.prettyDate(q.departure) +
                ' (' + q.nights + ' nights).\n\n';
            }
          } else {
            quoteBox.innerHTML = '<strong>' + name + '</strong><br>' + q.message;
            quoteBox.hidden = false;
          }
        })
        .catch(function () { /* the form still works without the quote */ });
    }
  }

  /* --- inquiry form -------------------------------------------------------
     Posts to api/contact.php where PHP exists. Without a backend it says so
     rather than pretending the message was sent. */
  var form = document.querySelector('[data-form]');
  if (form) {
    var out = form.querySelector('.form__msg');
    var btn = form.querySelector('button[type="submit"]');

    function say(text, ok) {
      if (!out) return;
      out.textContent = text;
      out.className = 'form__msg ' + (ok ? 'is-ok' : 'is-err');
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (form.querySelector('[name="website"]').value) return;   // honeypot
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      fetch(form.action, { method: 'POST', body: new FormData(form) })
        .then(function (r) {
          return r.text().then(function (text) {
            var data = {};
            try { data = JSON.parse(text); } catch (err) { /* not JSON */ }
            if (r.ok && data.ok) {
              say('Thank you. Your message is on its way and we will reply shortly.', true);
              form.reset();
            } else {
              say(data.error || 'The message could not be sent. Please write to us directly instead.', false);
            }
          });
        })
        .catch(function () {
          say('The message could not be sent. Please write to us directly instead.', false);
        })
        .then(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Send the request'; }
        });
    });
  }
})();
