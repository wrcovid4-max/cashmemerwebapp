# Cash Memer — web app

Cash memo / receipt app for the shop counter. It runs on your own computer, in
a browser, and uses your phone as the barcode scanner.

---

## ⚠️ Read this first: what a `git clone` will NOT give you

You said GitHub is your only copy of anything. So be clear about what GitHub is
holding and what it is not.

If you clone this project onto a new computer, **these files do not come with
it, and you must recreate them by hand:**

| File / folder | What is in it | How to get it back |
| --- | --- | --- |
| **`.env`** | Your API keys | Copy `.env.example` to `.env` and paste your keys in again. Get fresh ones from the links in that file. |
| **`data/`** | **Every receipt, product, customer and setting you have ever entered** | **Only from a JSON export you made yourself.** Nothing else brings it back. |
| `node_modules/` | Installed packages | `npm install` |
| `certs/` | The https certificate | Made automatically on next start |

**The middle row is the one that matters.** Your receipts are not in git and
never will be — a database full of customer phone numbers does not belong in a
public repository. The only thing that moves your shop between machines is the
JSON export:

> **Settings → Backup & restore → Export everything as JSON**

Do that now, before you need it. Then turn on **Automatic daily backup** on the
same screen and point it at a folder that syncs off this machine — a Google
Drive, Dropbox, OneDrive or iCloud folder. After that it keeps the newest 30
snapshots on its own and you never have to think about it again.

---

## Starting it

You need **Node.js version 22.5 or newer**. Check what you have by opening a
terminal and typing:

```bash
node --version
```

If it says something lower than `v22.5`, or "command not found", install the
LTS version from <https://nodejs.org> first.

Then, once:

```bash
npm install
```

And every time you want to use it:

```bash
npm start
```

Leave that terminal window open. Closing it stops the app. To stop it on
purpose, click that window and press **Ctrl+C**.

---

## Don't want to type `npm start`? Two ways to skip it

**On a Mac, for free — a double-click icon.** The app still runs on your own
Mac, your data never leaves it, but you open it by double-clicking an icon
instead of typing anything. It opens on that Mac and on phones on the same
Wi-Fi — not from anywhere in the world. Step-by-step, with the exact clicks, in
**[RUN-ON-MAC.md](RUN-ON-MAC.md)**. (There is a `start-mac.command` icon in the
project for exactly this.)

**From anywhere, like a website — put it on the internet.** You open a link like
`https://cashmemer.onrender.com`, type your passcode once, and use it from any
phone or computer, anywhere. The trade-off is real: your receipts and customers'
phone numbers then live on a **rented computer**, and keeping that data safe
costs about **a few dollars a month**. It is all set up by clicking through a
website — the guide is in **[DEPLOY.md](DEPLOY.md)**, and `render.yaml` is what
makes it a few clicks.

Everything below this line is about running it on **your own computer**.

---

## The two addresses

When it starts, it prints something like this:

```
  ON THIS COMPUTER — open this in your browser:
      http://localhost:4000

  ON YOUR PHONE — same Wi-Fi as this computer:
      http://192.168.100.9:4000    <- normal use, no warning
      https://192.168.100.9:4001   <- needed for the camera
```

**Where those come from.** The first is always `localhost`, which means "this
same computer". The second is this computer's address on your Wi-Fi — the app
reads it off your network card at startup, so you never have to go looking for
it. If this computer has more than one address, it prints the extras
underneath.

**Why the phone gets two.** Phone browsers refuse to open the camera on a plain
`http` address — a rule in the browser, with no way around it on a home
network. So the app runs a second, encrypted server on the next port up, purely
so the camera works. Use the plain `http` one for everything else, including
typing barcodes by hand; it never warns you about anything.

---

## The passcode

Because the app is served to your whole Wi-Fi so the phone can reach it,
**anyone else on that Wi-Fi can reach it too** — a customer, a neighbour, a
guest. So the app is locked with a single passcode.

- **The first time you open it, it asks you to set a passcode.** Pick one and
  type it twice. That is the only account there is — there is no username, no
  email, no sign-up.
- After that, every device that opens the app is asked for it **once**, then
  stays signed in for **30 days**. Your own computer answers once and is done.
- **The phone scanner is behind the same passcode.** The QR code alone is not
  the lock — the phone is asked for the passcode the first time it opens the
  scanner page, and then it too stays signed in for a month. So a stranger who
  photographs your QR code over your shoulder still cannot use it, and neither
  can anyone who simply guesses the scanner address.
- Wrong guesses are **slowed down** — after five, each further try has to wait,
  and the wait grows — so nobody can sit on your Wi-Fi and machine-guess it.

**In Settings → Passcode** you can change the passcode, see how many devices
are currently signed in, **lock this device now** (asks again next time), or
**sign out everywhere** (every device, including every phone, has to type the
passcode again — use it if a phone is lost).

If you forget the passcode there is no e-mail reset — this app has no idea who
you are, on purpose. Delete `data/app.db`'s session and passcode by removing
the `data/` folder and it will ask you to set a new one on the next start (you
lose your shop data doing that, so it is a last resort — keep the passcode
somewhere).

---

## Pairing your phone as the scanner

1. On the computer, open **New receipt**
2. Press **📱 Phone scanner** in the top right
3. Point your phone's camera at the QR code on screen and tap the link
4. **The phone asks for the passcode the first time** — the same one you set on
   the computer. It is asked once per phone, then stays signed in for a month.
5. **Your phone will warn that the connection "is not private".** This is
   expected. It means the certificate was signed by your own computer rather
   than bought from a company, because a shop computer has no domain name to
   buy one for. Nothing is wrong.
   - **iPhone / iPad (Safari):** tap **Show Details**, then **visit this website**, then **Visit Website**
   - **Android (Chrome):** tap **Advanced**, then **Proceed to … (unsafe)**
   - You are asked once per phone, not once per sale.
6. Allow the camera when the phone asks
7. Point it at a barcode

The barcode appears in the receipt on your computer immediately.

- If the barcode **matches a product** in your Inventory, it is added as a line
  with its price already filled in.
- If it **matches nothing**, the computer asks you to name and price it once.
  After that, the same barcode adds itself every time.

The green dot next to **Phone scanner** — and the badge at the bottom of the
sidebar — tell you whether the phone is connected right now.

### It is built for a real counter

Your phone will lock, walk out of range, and come back. That is handled:

- The phone **reconnects on its own**, and keeps trying — there is no "pair
  again" step
- Scans made **while the phone is offline are queued on the phone** and sent
  when it comes back
- Scans made **while the computer's page is closed or reloading are held by the
  app** and delivered when the page returns
- Delivery is acknowledged, and each scan carries an id, so a scan can arrive
  late but **cannot be lost, and cannot be counted twice**

### If the camera will not open

The scanner page always has a **type-it-by-hand box** underneath, and a
barcode typed there reaches the computer exactly the same way. So a phone with
a broken camera, or a browser that refuses, is an inconvenience and not a stop.

---

## The receipt

**Every receipt is always a two-page PDF.** There is no one-page option — a
memo without its own record is not worth keeping. The two pages are
deliberately different:

**Page 1 — the customer's copy.** Store, receipt number, date, time, category,
payment method, **the customer's name and email**, the items, subtotal,
discount, tax, grand total, cash given, change, the page-1 note, the signature,
the saved location, and a QR code.

**Page 2 — your copy.** Everything, with nothing held back: full customer
details including phone, email and address, the saved location and GPS
coordinates, **both** notes, the issuer account name and email (from your
Google sign-in, or typed into Settings), the signature and the QR code.

Page 1 deliberately leaves off the customer's **phone number** and **home
address**, the page-2 note, and your own account details — that page gets
handed across a counter and does not always stay with the person it belongs to.

The QR holds four short fields — receipt number, store, total, timestamp —
rather than a block of data, so it still scans off thermal paper.

Note 1 defaults to **`Thank You for shopping !!!`** on every receipt. You can
change it on the receipt itself, or change the default in Settings. Note 2
starts empty, is yours, and never appears on page 1.

### How tax is worked out

**Settings → Tax** chooses what the tax percentage applies to:

| Choice | A ₨60 sale, ₨50 discount, 15% tax |
| --- | --- |
| **After the discount** (default) | tax on the ₨10 paid = ₨1.50, total **₨11.50** |
| Before the discount | tax on the full ₨60 = ₨9.00, total **₨19.00** |

Each receipt records the rule it was issued under. Changing this setting
affects new receipts only — it can never re-total a memo you already handed to
a customer.

Downloads are named the same way your Android app names them:

```
Receipt_41___Mart_Example___20260801_22_32_29___Cash_Memer.pdf
```

---

## Where your keys go

Every key is optional. Without any of them the app starts normally and
everything except that one feature works. Each screen says exactly what is
missing and where to get it.

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```
   (On Windows, copy `.env.example` in File Explorer and rename the copy to
   `.env`.)
2. Open `.env` in any text editor and replace the `PUT_..._HERE` text
3. Save, and restart the app

| Key | What it turns on | Where to get it |
| --- | --- | --- |
| `EXCHANGE_RATE_API_KEY` | Live rates on the Rates screen | <https://www.exchangerate-api.com> |
| `GEMINI_API_KEY` | One sentence of interpretation on the weekly summary | <https://aistudio.google.com/apikey> |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | Google sign-in, which fills the issuer name on page 2 | <https://console.cloud.google.com/apis/credentials> |

The six weekly numbers are worked out on your own computer and always appear.
The AI key only ever adds a sentence on top of them.

### The app will refuse to start if a real key ends up in `.env.example`

`.env.example` is tracked by git. Anything in it is visible to everyone who can
see the repository, forever, even after you delete it. So on every start the
app checks that file, and if a value in it looks like a real credential it
stops and tells you how to fix it rather than letting the key leak quietly.

`.env` is in `.gitignore` and is never committed.

---

## The screens

| Screen | What it does |
| --- | --- |
| **Dashboard** | Fourteen figures — today, this month, all time, averages, highest and lowest, most-visited store, top product, storage used, pending sync — plus sales over the last 30 days and spend by category |
| **Receipts** | Every memo issued. Search by title, place or customer; filter by date range; select some or all; bulk print, share or delete. Expand a row for its items, notes, location, payment method and change. Per row: Share, PDF, Print, Duplicate, Edit, Pin, Delete |
| **New receipt** | Build a memo with a live preview beside the form |
| **Inventory** | Products with barcode, brand, category, cost, price, stock and unit. Search, All/Active/Archived, low-stock warning, add / edit / duplicate / archive / delete |
| **Price list** | The short quick-pick list of what you sell most, separate from Inventory. One click puts it on a receipt |
| **Members** | Customer directory. Picking one on the receipt form fills name, phone, email and address at once |
| **Terminal** | Scanner pairing state, an event log, diagnostics, and a serial printer connection where the browser supports one |
| **Rates** | Live exchange rates, USD base, with search and manual refresh. **1 Toman = 10 Iranian Rial** is shown as a fixed conversion and Toman appears in the live table alongside the Rial. Rates you enter by hand are never overwritten by a refresh |
| **Settings** | Shop details, theme, printing, backup and restore, Google sign-in |

**Edit** updates the original receipt. **Duplicate** deliberately makes a new
one. The end date in History covers the whole of that day, not just midnight.

**Drafts save themselves** a beat after you stop typing. If the browser closes
mid-sale, the sale is waiting for you when you reopen it.

---

## Language and appearance

English and **Urdu** (**کیش میمر**), switched from the bottom of the sidebar
with no reload. Urdu flips the whole layout right-to-left, not just the text.

Theme is System, Light or Dark in Settings. Dark is the default.

---

## What I ran, and what I did not

I would rather tell you this than have you find out at the counter.

### Verified — I watched these work

- All nine screens load in a real browser with no errors in the console
- **The phone-scanner feature end to end**, including the awkward parts: a
  known barcode becoming a priced line; the same barcode twice becoming a
  quantity rather than a second line; an unknown barcode prompting to create
  the product and that product landing on the receipt; a phone that
  disconnects and reconnects still scanning into the same sale; reloading the
  page mid-sale restoring the draft; and a scan made during that reload being
  delivered afterwards rather than lost. Eleven checks, all passing —
  `node test/scanner-flow.mjs`
- The receipt PDF renders, and its filename matches your sample character for
  character
- The receipt layout, checked by measuring your sample PDF pixel by pixel and
  comparing coordinates with the generated file: the masthead, both rules, the
  meta block, the items table, every total, the notes and the address block all
  land on the same coordinates
- Every API endpoint, against a running server
- **Backup export, wipe and restore as a round trip** — the data came back
  intact, and a file that is not a Cash Memer backup is refused rather than
  half-imported. Also that only the newest 30 snapshots survive, that unrelated
  files in that folder are left alone, and that a backup folder which has gone
  offline fails with a message instead of taking the app down —
  `node test/backup.mjs`
- **Which fields appear on which page of the memo** — 28 checks that read the
  text back out of the generated PDF, confirming page 1 does not carry the
  customer's phone, email or address, the page-2 note or the issuer account,
  and that page 2 carries all of it — `node test/pdf-pages.mjs`
- **The passcode lock, from a stranger's point of view** — that someone on your
  Wi-Fi with no passcode is turned away from the app, the receipts, the
  settings, the pairing endpoint, **the phone scanner page and its socket**, and
  the login screen and its stylesheet still load so you can sign in; that once
  signed in you get through all of it; and that repeated wrong guesses get
  slowed down without locking you out for good — `node test/lock.mjs`
- The tax setting, both ways, including that flipping it leaves an existing
  receipt's total untouched
- Urdu right-to-left, and the light theme
- The startup banner, on a machine with a real network address
- **A fresh `git clone` on a clean machine**: cloned, `npm install`,
  `npm start`, and the app came up and served pages with no `.env`, no
  database and no keys

### Not verified — I could not test these here

- **Printing to an actual printer.** The PDF is produced and opens in the print
  dialog; I have no printer attached to this machine.
- **A real phone camera.** I drove the pairing with a simulated phone
  connection, which exercises the whole link, but not the camera or the barcode
  reader on real hardware. The reader uses the browser's own barcode support
  where it exists (Chrome on Android) and a bundled library where it does not
  (Safari).
- **The self-signed certificate warning on a real phone.** The certificate is
  generated and https serves correctly; I have not tapped through the warning
  on an actual iPhone.
- **Google sign-in.** No OAuth credentials here, so the round trip to Google is
  written but unrun. The failure path is handled and names the likely cause.
- **The live rates and Gemini calls.** No keys here. The missing-key paths are
  tested; the successful calls are not.
- **Automatic daily backup firing on its schedule.** "Back up now" works,
  writes a snapshot and prunes correctly; the once-a-day timer itself has not
  been watched for a day.

### One bug found and fixed while testing

Worth telling you about, because it would have hit you and not most people.

The backup was originally written using Node's synchronous file calls. Against
a folder on this computer that is perfectly fine. Against the folder this
README tells you to use — a Google Drive, Dropbox or OneDrive folder, or a
drive on the network — it is not, because when one of those is disconnected a
write to it does not fail, it hangs. Node runs the whole app on a single
thread, so that hang froze **everything**: no screens, no receipts, no
scanner, mid-sale. I reproduced it, and the server had to be killed outright
rather than stopped.

It is all asynchronous now and capped at 20 seconds. An unreachable backup
folder costs you a failed backup and a message naming the likely cause; the
till keeps working. `node test/backup.mjs` checks the app still answers while
a backup to a dead folder is failing.

### One thing in your sample PDF that does not add up — now a setting

Your sample receipt shows: subtotal ₨ 60.00, discount ₨ 50.00, tax 15% shown
as ₨ 1.50, and a grand total of **₨ 16.50**.

Those do not reconcile, and not because of a different convention — I checked
both. Tax after the discount gives ₨ 11.50; tax on the full price gives
₨ 19.00. Neither produces 16.50. The change given (₨ 483.50 from ₨ 500)
matches 16.50 too, so the old app was consistently wrong rather than mistyped
once.

Rather than pick for you, **Settings → Tax** now offers both rules, defaulting
to tax-after-discount. Whichever you choose is stamped onto each receipt as it
is issued, so changing your mind later cannot alter a memo you have already
given someone.

### Two other deliberate differences from the sample

- **Page 2 wraps a long customer address instead of clipping it.** Your sample
  runs the address off the right edge of the paper and cuts it mid-word. Page 2
  is your own copy, where the whole address is the reason for printing it.
- **The address on page 1 may wrap onto a different number of lines** than your
  sample, because the fonts are not byte-identical. Everything above it lands
  on exactly the same coordinate.

---

## When something goes wrong

**"Port 4000 is already being used."** Cash Memer is probably already running
in another terminal window — look for it before doing anything else. To use a
different port, open `.env` and change `PORT=4000` to `PORT=4010`.

**The phone cannot open the address.** Check the phone is on the same Wi-Fi,
not mobile data. Some routers have "client isolation" or "AP isolation" turned
on, which stops devices seeing each other — that setting has to be off. If the
computer printed more than one address, try the others.

**The page says it cannot reach Cash Memer.** The terminal window was closed.
Start it again with `npm start`.

**`npm install` fails.** Check `node --version` is 22.5 or newer. This project
has no packages that need a compiler, so that is nearly always the cause.

---

## What is in the project

```
server/       the server: database, API, PDF, pairing hub, backups, the passcode lock
public/       everything the browser loads — no build step, no bundler
shared/       money and totals code used by BOTH the server and the browser,
              so a total cannot be right on screen and wrong on paper
assets/fonts/ the fonts the PDF is set in (they carry the ₨ sign)
test/         optional checks — see test/README.md
data/         your shop. NOT in git.
```

There is no build step and no framework. `public/js/dom.js` is 130 lines and is
the entire rendering toolkit. That is on purpose: the usual reason a project
stops working on a new machine is a toolchain that will not install, and this
one has none.

---

## Licence

Private project. Do what you like with it.
