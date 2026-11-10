<?php
/**
 * The pricing rules, in PHP.
 *
 * A mirror of assets/js/calendar-core.js. The browser prices a stay so the
 * guest sees a total before sending, and this prices the same stay again when
 * the request arrives - because the arrival, departure and apartment reach the
 * server as query parameters, and anyone can edit those. The number in the
 * email is the one this file worked out, never the one the browser sent.
 *
 * Both read the same assets/data/calendar-<id>.json, so they cannot disagree
 * about availability. If you change a rule here, change it there too.
 */

/** Load one apartment's calendar. Returns null if there is no such file. */
function hope_calendar(string $dir, string $id): ?array
{
    if (!preg_match('/^[a-z0-9-]{1,12}$/', $id)) {
        return null;
    }
    $path = $dir . '/calendar-' . $id . '.json';
    if (!is_file($path)) {
        return null;
    }
    $data = json_decode((string) file_get_contents($path), true);
    return is_array($data) ? $data : null;
}

/**
 * A price that is really a price.
 *
 * A season with no rate set yet carries null, and (float) null is 0.0 - so
 * without this a stay priced from an empty season totals zero and the email
 * says the week is free. Anything that is not a positive number means "no
 * rate published".
 */
function hope_price($value): ?float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        return null;
    }
    $n = (float) $value;
    return $n < 0 ? null : $n;
}

/**
 * Seasons are stored as MM-DD so they repeat every year, and one may wrap the
 * year end (off-season runs 10-16 to 04-30), hence the wrapped comparison.
 */
function hope_season_for(array $cal, string $date): ?array
{
    $md = substr($date, 5);
    foreach ($cal['seasons'] ?? [] as $s) {
        if (empty($s['from']) || empty($s['to'])) {
            continue;
        }
        $wraps = $s['from'] > $s['to'];
        $hit = $wraps
            ? ($md >= $s['from'] || $md <= $s['to'])
            : ($md >= $s['from'] && $md <= $s['to']);
        if ($hit) {
            return $s;
        }
    }
    return null;
}

/** Everything known about one date. */
function hope_day(array $cal, string $date): array
{
    $override = $cal['days'][$date] ?? null;
    $season = hope_season_for($cal, $date);

    $price = $override !== null && array_key_exists('price', $override)
        ? hope_price($override['price'])
        : ($season ? hope_price($season['price'] ?? null) : null);

    $min = $override !== null && isset($override['minNights'])
        ? (int) $override['minNights']
        : (int) ($season['minNights'] ?? 1);

    $status = $override['status'] ?? 'available';

    return [
        'price' => $price,
        'minNights' => max(1, $min),
        'booked' => $status === 'booked',
        'past' => $date < date('Y-m-d'),
    ];
}

/**
 * Quote a stay. The guest pays for every night from arrival up to, but not
 * including, the departure day, so those are the nights that must be free.
 */
function hope_quote(array $cal, string $arrival, string $departure): array
{
    $a = DateTimeImmutable::createFromFormat('!Y-m-d', $arrival);
    $b = DateTimeImmutable::createFromFormat('!Y-m-d', $departure);
    if (!$a || !$b) {
        return ['ok' => false, 'message' => 'Those dates could not be read.'];
    }

    $nights = (int) $a->diff($b)->format('%r%a');
    if ($nights < 1) {
        return ['ok' => false, 'message' => 'The departure date is not after the arrival date.'];
    }
    if ($nights > 120) {
        return ['ok' => false, 'message' => 'That is a longer stay than we can quote automatically.'];
    }

    $total = 0.0;
    $prices = [];
    $taken = 0;

    for ($i = 0; $i < $nights; $i++) {
        $day = hope_day($cal, $a->modify("+$i day")->format('Y-m-d'));
        if ($day['booked'] || $day['past']) {
            $taken++;
        }
        if ($day['price'] === null) {
            return ['ok' => false, 'message' => 'No rate is published for those dates yet.'];
        }
        $prices[] = $day['price'];
        $total += $day['price'];
    }

    if ($taken > 0) {
        return ['ok' => false, 'message' => $taken . ' night(s) in that range are already taken.'];
    }

    $min = hope_day($cal, $arrival)['minNights'];
    if ($nights < $min) {
        return ['ok' => false, 'message' => 'Those dates need a minimum stay of ' . $min . ' nights.'];
    }

    return [
        'ok' => true,
        'nights' => $nights,
        'total' => $total,
        'lowest' => min($prices),
        'highest' => max($prices),
        'currency' => $cal['currency'] ?? 'EUR',
    ];
}
