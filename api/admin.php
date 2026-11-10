<?php
/**
 * Calendar admin API.
 *
 *   GET  ?action=state         -> {authed, needsSetup, apartments}
 *   POST action=setup          -> choose the first password
 *   POST action=login          -> sign in
 *   POST action=logout
 *   GET  ?action=load&apt=h1   -> that apartment's calendar
 *   POST action=save           -> validate and write it back
 *
 * The password hash lives in api/admin-hash.php, which this file writes on
 * first run and which is never committed. Nothing a browser sends is written
 * to disk unchecked: save() rebuilds the file from values it has validated
 * itself, so a tampered payload cannot put arbitrary keys into the JSON the
 * public site reads.
 */

declare(strict_types=1);

@ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

const APARTMENTS = ['h1' => 'Apartment H1', 'h2' => 'Apartment H2', 'h3' => 'Apartment H3'];
const HASH_FILE = __DIR__ . '/admin-hash.php';
const DATA_DIR = __DIR__ . '/../assets/data';
const MAX_DAYS = 2000;
const MAX_SEASONS = 12;

register_shutdown_function(static function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['ok' => false, 'error' => 'Something went wrong on the server.']);
    }
});

function reply(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload);
    exit;
}

function fail(string $error, int $code = 400): void
{
    reply(['ok' => false, 'error' => $error], $code);
}

/* --- session ------------------------------------------------------------- */

session_set_cookie_params([
    'httponly' => true,
    'samesite' => 'Strict',
    'secure' => (($_SERVER['HTTPS'] ?? '') === 'on')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https'),
]);
session_name('hopeadmin');
session_start();

$storedHash = is_file(HASH_FILE) ? (string) (require HASH_FILE) : '';
$needsSetup = $storedHash === '';
$authed = !$needsSetup && !empty($_SESSION['admin']);

/* --- input --------------------------------------------------------------- */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = [];
if ($method === 'POST') {
    $raw = (string) file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        $body = $_POST;
    }
}
$action = (string) ($_GET['action'] ?? $body['action'] ?? '');

/* --- throttle sign-in attempts ------------------------------------------- */

function attempts(): array
{
    $f = __DIR__ . '/.admin-attempts.json';
    $all = is_file($f) ? (json_decode((string) file_get_contents($f), true) ?: []) : [];
    $key = substr(hash('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? '0')), 0, 16);
    $now = time();
    $mine = array_values(array_filter(
        is_array($all[$key] ?? null) ? $all[$key] : [],
        static function ($t) use ($now) { return is_int($t) && $t > $now - 900; }
    ));
    return [$f, $all, $key, $mine, $now];
}

/* --- actions ------------------------------------------------------------- */

if ($action === 'state') {
    reply([
        'ok' => true,
        'authed' => $authed,
        'needsSetup' => $needsSetup,
        'writable' => is_writable(DATA_DIR),
        'apartments' => APARTMENTS,
    ]);
}

if ($action === 'setup') {
    if (!$needsSetup) {
        fail('A password has already been set. Delete api/admin-hash.php on the server to choose a new one.', 409);
    }
    $pw = (string) ($body['password'] ?? '');
    if (strlen($pw) < 10) {
        fail('Use at least 10 characters.', 422);
    }
    $php = "<?php\n// Written by the admin panel. Delete this file to choose a new password.\n"
        . 'return ' . var_export(password_hash($pw, PASSWORD_DEFAULT), true) . ";\n";
    if (@file_put_contents(HASH_FILE, $php, LOCK_EX) === false) {
        fail('api/ is not writable, so the password could not be saved. Create api/admin-hash.php by hand, or make the folder writable.', 500);
    }
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    reply(['ok' => true]);
}

if ($action === 'login') {
    [$f, $all, $key, $mine, $now] = attempts();
    if (count($mine) >= 8) {
        fail('Too many attempts. Wait fifteen minutes.', 429);
    }
    if ($needsSetup) {
        fail('No password is set yet.', 409);
    }
    if (!password_verify((string) ($body['password'] ?? ''), $storedHash)) {
        $mine[] = $now;
        $all[$key] = $mine;
        @file_put_contents($f, json_encode($all), LOCK_EX);
        usleep(400000);
        fail('Wrong password.', 401);
    }
    unset($all[$key]);
    @file_put_contents($f, json_encode($all), LOCK_EX);
    session_regenerate_id(true);
    $_SESSION['admin'] = true;
    reply(['ok' => true]);
}

if ($action === 'logout') {
    $_SESSION = [];
    session_destroy();
    reply(['ok' => true]);
}

if (!$authed) {
    fail('Please sign in.', 401);
}

/* --- the calendar files -------------------------------------------------- */

function apartmentId($v): string
{
    $id = is_string($v) ? $v : '';
    if (!isset(APARTMENTS[$id])) {
        fail('Unknown apartment.', 422);
    }
    return $id;
}

if ($action === 'load') {
    $id = apartmentId($_GET['apt'] ?? '');
    $path = DATA_DIR . '/calendar-' . $id . '.json';
    if (!is_file($path)) {
        fail('No calendar file for that apartment.', 404);
    }
    reply(['ok' => true, 'calendar' => json_decode((string) file_get_contents($path), true)]);
}

if ($action === 'save') {
    $id = apartmentId($body['apt'] ?? '');
    $path = DATA_DIR . '/calendar-' . $id . '.json';
    if (!is_file($path)) {
        fail('No calendar file for that apartment.', 404);
    }

    $existing = json_decode((string) file_get_contents($path), true);
    if (!is_array($existing)) {
        fail('The existing calendar file could not be read.', 500);
    }

    $in = $body['calendar'] ?? null;
    if (!is_array($in)) {
        fail('Nothing to save.', 422);
    }

    /** A price: null (none published) or a number from 0 to 10000. */
    $price = static function ($v) {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_numeric($v)) {
            fail('A price is not a number.', 422);
        }
        $n = round((float) $v, 2);
        if ($n < 0 || $n > 10000) {
            fail('A price is outside the range we allow.', 422);
        }
        return $n;
    };
    $minNights = static function ($v) {
        $n = (int) $v;
        return max(1, min(60, $n ?: 1));
    };

    // Seasons: rebuilt field by field, so nothing unexpected survives.
    $seasons = [];
    foreach ((array) ($in['seasons'] ?? []) as $s) {
        if (!is_array($s)) {
            continue;
        }
        if (count($seasons) >= MAX_SEASONS) {
            fail('Too many seasons.', 422);
        }
        foreach (['from', 'to'] as $k) {
            if (!preg_match('/^\d{2}-\d{2}$/', (string) ($s[$k] ?? ''))) {
                fail('A season date is not in MM-DD form.', 422);
            }
        }
        $seasons[] = [
            'id' => preg_replace('/[^a-z0-9_-]/', '', strtolower((string) ($s['id'] ?? ''))) ?: 's' . count($seasons),
            'name' => trim(substr((string) ($s['name'] ?? ''), 0, 60)) ?: 'Season',
            'from' => (string) $s['from'],
            'to' => (string) $s['to'],
            'price' => $price($s['price'] ?? null),
            'minNights' => $minNights($s['minNights'] ?? 1),
        ];
    }
    if (!$seasons) {
        fail('Keep at least one season.', 422);
    }

    // Days: only dates, and only the three things a day can override. A day
    // that says nothing is dropped rather than stored as an empty object.
    $days = [];
    foreach ((array) ($in['days'] ?? []) as $date => $d) {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $date) || !is_array($d)) {
            continue;
        }
        [$y, $m, $dd] = array_map('intval', explode('-', (string) $date));
        if (!checkdate($m, $dd, $y)) {
            continue;
        }
        if (count($days) >= MAX_DAYS) {
            fail('Too many individual dates. Set season defaults instead.', 422);
        }
        $entry = [];
        if (($d['status'] ?? '') === 'booked') {
            $entry['status'] = 'booked';
        }
        if (array_key_exists('price', $d) && $d['price'] !== null && $d['price'] !== '') {
            $entry['price'] = $price($d['price']);
        }
        if (array_key_exists('minNights', $d) && $d['minNights'] !== null && $d['minNights'] !== '') {
            $entry['minNights'] = $minNights($d['minNights']);
        }
        if ($entry) {
            $days[$date] = $entry;
        }
    }
    ksort($days);

    // Metadata stays as it was; the browser does not get to change it.
    $out = $existing;
    $out['seasons'] = $seasons;
    $out['days'] = (object) $days;
    $out['updated'] = gmdate('Y-m-d\TH:i:s\Z');

    $json = json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        fail('The calendar could not be encoded.', 500);
    }

    // Keep the previous version, then swap the new one in atomically, so a
    // failed write never leaves the public site with half a file.
    @copy($path, $path . '.bak');
    $tmp = $path . '.tmp';
    if (@file_put_contents($tmp, $json . "\n", LOCK_EX) === false || !@rename($tmp, $path)) {
        @unlink($tmp);
        fail('Could not write the calendar. Check that assets/data is writable.', 500);
    }

    reply(['ok' => true, 'updated' => $out['updated'], 'days' => count($days)]);
}

fail('Unknown action.', 400);
