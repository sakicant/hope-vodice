/**
 * Hope Apartments calendar rules.
 *
 * Each apartment has its own data file, but they all obey these rules, and the
 * public calendar and any admin tool must share them so the price a guest sees
 * and the price the owner set can never disagree.
 *
 * Seasons repeat every year and give the default nightly rate and minimum
 * stay; the `days` map holds only the exceptions.
 *
 * Exposes window.HopeCal.
 */
(function (global) {
  'use strict';

  var MS_DAY = 86400000;

  /* --- dates ------------------------------------------------------------- */

  /** "2027-06-24" for a Date, in local time (never UTC, which shifts the day). */
  function key(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /** Parse "2027-06-24" as local midnight. */
  function parse(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function startOfDay(d) {
    var c = new Date(d.getTime());
    c.setHours(0, 0, 0, 0);
    return c;
  }

  function addDays(d, n) {
    var c = new Date(d.getTime());
    c.setDate(c.getDate() + n);
    return c;
  }

  function nightsBetween(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / MS_DAY);
  }

  function today() {
    return startOfDay(new Date());
  }

  /* --- season lookup ------------------------------------------------------ */

  /**
   * Seasons are stored as MM-DD so they repeat every year. A season may wrap
   * the year end (off-season runs 10-16 to 04-30), which is why this compares
   * against a wrapped range rather than a plain from <= x <= to.
   */
  function seasonFor(data, date) {
    var md = String(date.getMonth() + 1).padStart(2, '0') + '-' +
             String(date.getDate()).padStart(2, '0');
    var seasons = (data && data.seasons) || [];
    for (var i = 0; i < seasons.length; i++) {
      var s = seasons[i];
      if (!s.from || !s.to) continue;
      var wraps = s.from > s.to;
      var hit = wraps ? (md >= s.from || md <= s.to) : (md >= s.from && md <= s.to);
      if (hit) return s;
    }
    return null;
  }

  /**
   * A price that is really a price.
   *
   * A season with no rate set yet carries null, and Number(null) is 0, not
   * NaN - so without this a stay priced from an empty season quotes a total of
   * zero and tells the guest the week is free. Anything that is not a positive
   * number means "no rate published", which quote() turns into "ask us".
   */
  function toPrice(v) {
    if (v == null || v === '') return null;
    var n = Number(v);
    return isNaN(n) || n < 0 ? null : n;
  }

  /** Everything known about one date, and where those values came from. */
  function dayInfo(data, date) {
    var k = key(date);
    var override = (data && data.days && data.days[k]) || null;
    var season = seasonFor(data, date);

    var price = override && override.price != null ? toPrice(override.price)
              : season ? toPrice(season.price) : null;
    var minNights = override && override.minNights != null ? Number(override.minNights)
                  : season ? Number(season.minNights) : 1;
    var status = override && override.status ? override.status : 'available';

    return {
      key: k,
      date: date,
      price: price,
      minNights: minNights || 1,
      status: status,
      booked: status === 'booked',
      past: startOfDay(date) < today(),
      season: season,
      hasOverride: !!override
    };
  }

  /* --- stay quoting ------------------------------------------------------- */

  /**
   * Quote a stay from `arrival` to `departure`.
   *
   * The guest pays for every night from arrival up to, but not including, the
   * departure day, so those are the nights that must be free. The departure
   * day itself can be the next guest's arrival.
   */
  function quote(data, arrival, departure) {
    var a = startOfDay(parse(arrival));
    var b = startOfDay(parse(departure));
    var nights = nightsBetween(a, b);

    if (nights < 1) {
      return { ok: false, reason: 'range', message: 'Choose a departure date after your arrival.' };
    }

    var lines = [];
    var total = 0;
    var unavailable = [];

    for (var i = 0; i < nights; i++) {
      var info = dayInfo(data, addDays(a, i));
      if (info.booked || info.past) unavailable.push(info.key);
      if (info.price == null) {
        return {
          ok: false, reason: 'noprice',
          message: 'We have not published a rate for those dates yet. Send us the dates and we will quote you.'
        };
      }
      lines.push({ key: info.key, price: info.price });
      total += info.price;
    }

    if (unavailable.length) {
      return {
        ok: false, reason: 'unavailable', unavailable: unavailable,
        message: unavailable.length === 1
          ? 'One night in that range is already taken.'
          : unavailable.length + ' nights in that range are already taken.'
      };
    }

    var minNights = dayInfo(data, a).minNights;
    if (nights < minNights) {
      return {
        ok: false, reason: 'minstay', minNights: minNights, nights: nights,
        message: 'Those dates need a minimum stay of ' + minNights + ' nights.'
      };
    }

    var prices = lines.map(function (l) { return l.price; });
    return {
      ok: true,
      arrival: key(a),
      departure: key(b),
      nights: nights,
      lines: lines,
      total: total,
      minNights: minNights,
      lowest: Math.min.apply(null, prices),
      highest: Math.max.apply(null, prices),
      average: Math.round(total / nights)
    };
  }

  /** The cheapest published season rate, for "from €X" lines. */
  function lowestRate(data) {
    var prices = ((data && data.seasons) || [])
      .map(function (s) { return toPrice(s.price); })
      .filter(function (n) { return n != null && n > 0; });
    return prices.length ? Math.min.apply(null, prices) : null;
  }

  /* --- formatting --------------------------------------------------------- */

  function money(n, currency) {
    if (n == null) return '';
    var symbol = currency === 'EUR' || !currency ? '€' : currency + ' ';
    return symbol + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function prettyDate(k) {
    var d = parse(k);
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
  }

  /** "24 Jun – 1 Jul 2027", collapsing the year when both sides share it. */
  function prettyRange(from, to) {
    var a = parse(from), b = parse(to);
    var left = a.getDate() + ' ' + MONTHS[a.getMonth()].slice(0, 3);
    if (a.getFullYear() !== b.getFullYear()) left += ' ' + a.getFullYear();
    return left + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()].slice(0, 3) + ' ' + b.getFullYear();
  }

  /** "1 July – 31 August" from a stored MM-DD pair. */
  function seasonDates(s) {
    function label(md) {
      var p = String(md).split('-');
      return Number(p[1]) + ' ' + MONTHS[Number(p[0]) - 1];
    }
    return label(s.from) + ' – ' + label(s.to);
  }

  global.HopeCal = {
    MONTHS: MONTHS,
    key: key,
    parse: parse,
    addDays: addDays,
    startOfDay: startOfDay,
    today: today,
    nightsBetween: nightsBetween,
    seasonFor: seasonFor,
    toPrice: toPrice,
    dayInfo: dayInfo,
    quote: quote,
    lowestRate: lowestRate,
    money: money,
    prettyDate: prettyDate,
    prettyRange: prettyRange,
    seasonDates: seasonDates
  };
})(window);
