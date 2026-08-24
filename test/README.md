# Tests

**You do not need any of this to use Cash Memer.** Skip this folder entirely
unless you want to check the app still works after a change.

These are the checks that were actually run while building the app, kept so
they can be run again.

## Running them

They drive a real browser, which is an extra download the app itself does not
need. So it is not installed by default:

```bash
npm install --no-save playwright ws
npx playwright install chromium
```

Then, in one terminal:

```bash
npm start
```

and in a second terminal:

```bash
node test/screens.mjs        # every screen loads with no console errors
node test/scanner-flow.mjs   # the phone-scanner feature, end to end
node test/backup.mjs         # export/restore, pruning, and an unreachable folder
node test/receipt-pdf.mjs    # the memo PDF renders and is named correctly
node test/lock.mjs           # the passcode: a stranger is turned away, you get in
```

Each prints PASS or FAIL per check.

`backup.mjs`, `receipt-pdf.mjs` and `lock.mjs` need nothing but Node — only the
two browser tests need Playwright (`lock.mjs` also needs `ws`, which the install
line above already pulls in).

### The passcode gets in the way of the tests too — on purpose

The app is locked, so every test has to sign in before it can do anything. They
handle this for you: on a fresh install with no passcode yet they set one, and
on an install that already has a passcode they sign in with it. If your install
already has a passcode, tell the tests what it is:

```bash
PASSCODE=your-passcode node test/screens.mjs
```

Without it, the first check will fail with a message saying exactly that.

If Playwright complains that its browser is missing and you already have a
Chrome or Chromium on the machine, point it at that one instead of downloading
another:

```bash
CHROME_PATH=/path/to/chrome node test/screens.mjs
```

## What `scanner-flow.mjs` covers

It opens a real browser page as the shop computer and a second connection
pretending to be the phone, then checks the cases that actually go wrong at a
counter:

1. The pairing dialog produces a QR and a code
2. The computer notices the phone connect
3. A known barcode becomes a priced line item with no typing
4. The phone is told what happened, by name
5. Scanning the same thing twice means two of it, not two lines
6. An unknown barcode prompts to create the product
7. The product created that way lands on the receipt
8. The totals update
9. A phone that drops and reconnects still scans into the same sale
10. Reloading the page mid-sale restores the draft
11. A scan made while the page was reloading is delivered afterwards, not lost

## What `lock.mjs` covers

The app is served to the whole Wi-Fi so the phone can reach it, which means
anyone else on that Wi-Fi can reach it too. This test plays that stranger — a
device with no passcode — and tries every door:

1. The app itself is closed (sent to the login screen)
2. **The phone scanner page is closed** — the door people assume the QR alone
   protects
3. The receipts, the settings and the pairing endpoint are all closed
4. **The phone's WebSocket refuses a stranger** — not just the page, the socket
5. The login screen itself, and its stylesheet, still load — so you can sign in

Then, signed in, it checks you get through all of the above. Finally it checks
that repeated wrong guesses get slowed down, and that the slowdown lifts so it
can never lock the shopkeeper out for good.

## Why `backup.mjs` exists

Its last three checks are there because of a bug that was found and fixed
during the build, and they would catch it coming back.

The app used to do its backup file writing **synchronously**. That is fine
against a local folder. It is not fine against the folder the README actually
tells you to use — a Google Drive, Dropbox or OneDrive folder, or a drive on
the network. When one of those is disconnected, a write to it does not fail
quickly; it hangs. And because Node runs your whole app on one thread, that
hang froze the entire server: no screens, no receipts, nothing, in the middle
of a sale. The process had to be killed outright.

All of it is asynchronous now, and capped at 20 seconds. A folder that has gone
away costs you a failed backup and a message naming the likely cause, and
nothing else stops working. The test proves the app still answers while a
backup to an unreachable folder is failing.

## Note on the receipt PDF test

`receipt-pdf.mjs` checks the file is produced and the download name matches the
exact convention. The visual layout was verified separately by measuring the
sample PDF supplied by the shop, pixel by pixel, and comparing coordinates
against the generated output — see the LAYOUT block in `server/pdf.js`, where
every number came from that measurement.
