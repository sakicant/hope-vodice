<?php
/**
 * Copy this file to config.php on the server and fill it in.
 *
 * config.php is git-ignored and never leaves the host. Nothing here is a
 * secret as such, but the address the site sends from decides whether the
 * mail arrives at all, so it is worth getting right rather than guessing.
 */

return [
    // Where booking requests are delivered.
    'to' => 'apartment.hope.vodice@gmail.com',

    // Who the mail is from. This MUST be an address on the site's own domain,
    // or SPF and DMARC will send the message to spam - or refuse it. Do not
    // put the guest's address here; it goes in Reply-To instead, so hitting
    // reply in the mailbox answers the guest.
    'from' => 'website@hope-vodice.com',
    'from_name' => 'Hope Apartments website',

    // Shown in the subject line.
    'site_name' => 'Hope Apartments',

    // Send the guest a copy of what they wrote. Off by default: on a shared
    // host every extra message is another chance to be marked as spam, and
    // Bernard answers by hand anyway.
    'copy_to_guest' => false,

    // Requests allowed from one IP address per hour.
    'rate_limit' => 5,
];
