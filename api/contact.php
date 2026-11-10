<?php
/**
 * Booking request handler.
 *
 *   POST /api/contact.php  ->  {"ok": true} | {"ok": false, "error": "..."}
 *
 * Needs api/config.php, copied from config.sample.php and filled in. The site
 * works without this file - the form falls back to opening the visitor's mail
 * client - so a missing config is reported, not fatal.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// This endpoint answers in JSON. A PHP notice printed into that body makes it
// unparseable, and a fatal error would otherwise print the server's file
// paths to anyone who posted a malformed request.
@ini_set('display_errors', '0');
error_reporting(E_ALL);

register_shutdown_function(static function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode(['ok' => false, 'error' => 'The message could not be sent from here.']);
    }
});

require __DIR__ . '/calendar.php';

/* --- text helpers --------------------------------------------------------
   mbstring is not installed everywhere, and this file has to run on whatever
   the host gives us. PCRE's /u flag understands UTF-8 on its own, so these
   cut and measure by character either way - a plain substr() would slice a
   Croatian č in half and leave broken bytes in the email. */

function u_cut(string $s, int $max): string
{
    if (function_exists('mb_substr')) {
        return mb_substr($s, 0, $max, 'UTF-8');
    }
    return preg_match('/^.{0,' . $max . '}/us', $s, $m) ? $m[0] : substr($s, 0, $max);
}

function u_len(string $s): int
{
    if (function_exists('mb_strlen')) {
        return mb_strlen($s, 'UTF-8');
    }
    $n = preg_match_all('/./us', $s);
    return $n === false ? strlen($s) : $n;
}

/**
 * Answer and stop.
 *
 * Typed void rather than never, so this file still runs on PHP 7.4 hosts;
 * shared hosting is not always on a current version.
 */
function out(bool $ok, string $error = '', int $code = 200): void
{
    http_response_code($code);
    echo json_encode($ok ? ['ok' => true] : ['ok' => false, 'error' => $error]);
    exit;
}

/* --- preconditions ------------------------------------------------------- */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(false, 'Send the form, do not open this address directly.', 405);
}

$configPath = __DIR__ . '/config.php';
if (!is_file($configPath)) {
    out(false, 'The site is not finished being set up. Please write to us directly.', 503);
}
$cfg = require $configPath;

/* --- rate limit ----------------------------------------------------------
   A flat file keyed by a hash of the IP, so the log holds no addresses. Not a
   defence against anyone determined; it is there to stop a bot emptying a
   mailbox overnight. */

$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$throttle = __DIR__ . '/.throttle.json';
$now = time();
$seen = is_file($throttle)
    ? (json_decode((string) file_get_contents($throttle), true) ?: [])
    : [];
$key = substr(hash('sha256', $ip), 0, 16);
foreach ($seen as $k => $times) {
    if (!is_array($times)) {
        unset($seen[$k]);
        continue;
    }
    $recent = array_values(array_filter($times, static function ($t) use ($now) {
        return is_int($t) && $t > $now - 3600;
    }));
    if ($recent) {
        $seen[$k] = $recent;
    } else {
        unset($seen[$k]);
    }
}
if (count($seen[$key] ?? []) >= (int) ($cfg['rate_limit'] ?? 5)) {
    out(false, 'That is a lot of messages in one hour. Please call or write to us instead.', 429);
}

/**
 * Record a send against the limit.
 *
 * Called only once a message has actually gone out, not on arrival. Counting
 * every request would mean someone who mistyped their email address twice and
 * a bot posting rubbish both eat the same allowance - and the person who
 * genuinely wants to book is the one who gets locked out. A flood of invalid
 * requests costs a little CPU and sends no mail, which is the part that
 * matters.
 */
function remember_send(string $throttle, array $seen, string $key, int $now): void
{
    $seen[$key][] = $now;
    @file_put_contents($throttle, json_encode($seen), LOCK_EX);
}

/* --- read the form -------------------------------------------------------- */

/** Trim, cap and strip control characters, so nothing can be smuggled. */
function field(string $name, int $max = 2000): string
{
    $v = (string) ($_POST[$name] ?? '');
    // No /u here on purpose: control characters are ASCII, and on malformed
    // input a /u pattern returns null and would silently empty the field.
    $v = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $v);
    return u_cut(trim((string) $v), $max);
}

/** A value safe to put in a mail header: no newlines, ever. */
function headerSafe(string $v): string
{
    return trim(str_replace(["\r", "\n"], ' ', $v));
}

if (field('website') !== '') {
    out(true);                       // honeypot: answer as if sent, drop it
}

$name = field('name', 120);
$email = field('email', 190);
$message = field('message', 4000);
$apartment = field('apartment', 12);
$arrival = field('arrival', 10);
$departure = field('departure', 10);
$guests = field('guests', 3);

if ($name === '' || $message === '') {
    out(false, 'Please fill in your name and a message.', 422);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    out(false, 'That email address does not look right.', 422);
}
if (u_len($message) < 10) {
    out(false, 'Please write a little more so we know what you need.', 422);
}

$isDate = static fn(string $d): bool =>
    (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $d) && strtotime($d) !== false;

/* --- price it here, not in the browser ------------------------------------
   The dates and the apartment arrive as form values, and form values can be
   edited. Whatever total the visitor was shown, the one in this email is the
   one these rules produce from the calendar file on this server. */

$APARTMENTS = ['h1' => 'Apartment H1', 'h2' => 'Apartment H2', 'h3' => 'Apartment H3'];
$aptName = $APARTMENTS[$apartment] ?? ($apartment === 'two' ? 'Two apartments' : 'Not specified');

$quoteLine = 'Not calculated.';
if (isset($APARTMENTS[$apartment]) && $isDate($arrival) && $isDate($departure)) {
    $cal = hope_calendar(dirname(__DIR__) . '/assets/data', $apartment);
    if ($cal === null) {
        $quoteLine = 'No calendar file for that apartment.';
    } else {
        $q = hope_quote($cal, $arrival, $departure);
        $quoteLine = $q['ok']
            ? sprintf(
                '%d nights, total %s %s (%s-%s per night)',
                $q['nights'],
                number_format($q['total'], 0, '.', ','),
                $q['currency'],
                number_format($q['lowest'], 0, '.', ','),
                number_format($q['highest'], 0, '.', ',')
            )
            : 'Could not be priced: ' . $q['message'];
    }
}

/* --- compose -------------------------------------------------------------- */

$siteName = (string) ($cfg['site_name'] ?? 'Hope Apartments');
$subject = sprintf('Booking request: %s%s', $aptName,
    $isDate($arrival) ? ', ' . $arrival . ' to ' . $departure : '');

$body = implode("\n", [
    'New booking request from the website.',
    '',
    'Apartment:  ' . $aptName,
    'Arrival:    ' . ($isDate($arrival) ? $arrival : '-'),
    'Departure:  ' . ($isDate($departure) ? $departure : '-'),
    'Guests:     ' . ($guests !== '' ? $guests : '-'),
    'Quote:      ' . $quoteLine,
    '',
    'Name:       ' . $name,
    'Email:      ' . $email,
    '',
    'Message:',
    $message,
    '',
    str_repeat('-', 56),
    'Sent ' . date('Y-m-d H:i') . ' from ' . $siteName,
    'Reply to this message and the answer goes straight to the guest.',
]);

$from = headerSafe((string) ($cfg['from'] ?? ''));
$fromName = headerSafe((string) ($cfg['from_name'] ?? $siteName));
$to = headerSafe((string) ($cfg['to'] ?? ''));
if ($from === '' || $to === '') {
    out(false, 'The site is not finished being set up. Please write to us directly.', 503);
}

$headers = [
    'From: ' . sprintf('=?UTF-8?B?%s?= <%s>', base64_encode($fromName), $from),
    'Reply-To: ' . headerSafe($email),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'X-Mailer: hope-vodice',
];

$sent = @mail(
    $to,
    '=?UTF-8?B?' . base64_encode($subject) . '?=',
    $body,
    implode("\r\n", $headers),
    '-f' . $from
);

if (!$sent) {
    out(false, 'The message could not be sent from here.', 502);
}

remember_send($throttle, $seen, $key, $now);

if (!empty($cfg['copy_to_guest'])) {
    @mail(
        headerSafe($email),
        '=?UTF-8?B?' . base64_encode('Your booking request - ' . $siteName) . '?=',
        "Thank you, we have your request and will reply shortly.\n\n"
            . str_repeat('-', 56) . "\n" . $body,
        implode("\r\n", array_merge(
            array_slice($headers, 0, 1),
            ['Reply-To: ' . $to],
            array_slice($headers, 2)
        )),
        '-f' . $from
    );
}

out(true);
