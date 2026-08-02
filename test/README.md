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
```

Each prints PASS or FAIL per check.

`backup.mjs` and `receipt-pdf.mjs` need nothing but Node — only the two browser
tests need Playwright.

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
