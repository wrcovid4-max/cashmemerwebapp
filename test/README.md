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
node test/receipt-pdf.mjs    # the memo PDF renders and is named correctly
```

Each prints PASS or FAIL per check.

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

## Note on the receipt PDF test

`receipt-pdf.mjs` checks the file is produced and the download name matches the
exact convention. The visual layout was verified separately by measuring the
sample PDF supplied by the shop, pixel by pixel, and comparing coordinates
against the generated output — see the LAYOUT block in `server/pdf.js`, where
every number came from that measurement.
