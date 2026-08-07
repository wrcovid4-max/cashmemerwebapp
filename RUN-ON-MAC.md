# Running Cash Memer on your Mac — free, no terminal

This is the free way. Cash Memer runs **on your own Mac**, your receipts and
customer numbers **never leave the machine**, and you open it with a
**double-click** — no terminal, no typing, nothing to pay.

The one honest limit, so it does not surprise you later:

> It opens on **this Mac**, and on **phones on the same Wi-Fi** as this Mac (that
> is what the phone scanner needs). It is **not** reachable from anywhere in the
> world like a normal website — for that you would use the paid internet version
> in [DEPLOY.md](DEPLOY.md). For a shop counter, "open it on the shop Mac, scan
> with the phone on the shop Wi-Fi" is the normal way to use it.

---

## First time only — three steps

### 1. Install Node.js (once)

Node.js is the engine Cash Memer runs on. It is free.

1. Go to **<https://nodejs.org>**.
2. Download the big green **LTS** button.
3. Open the downloaded file and keep clicking **Continue**, then **Install**.
   (It may ask for your Mac password — that is normal for installing.)

You only ever do this once.

### 2. Get the Cash Memer folder onto your Mac (once)

1. Go to **<https://github.com/wrcovid4-max/cashmemerwebapp>**.
2. Press the green **Code** button, then **Download ZIP**.
3. Open your **Downloads**, and double-click the ZIP to unzip it. You now have a
   folder called **cashmemerwebapp**.
4. Drag that folder somewhere you will find it again — your **Documents**, say.

### 3. Allow the icon to run (once)

Because you downloaded it, macOS is cautious the first time:

1. Open the **cashmemerwebapp** folder.
2. Find the file **`start-mac.command`**.
3. **Right-click it** (or Control-click), choose **Open**, and in the box that
   appears choose **Open** again.

That first time teaches your Mac to trust it. After that, a normal double-click
is enough.

---

## Every day after — one double-click

Double-click **`start-mac.command`**.

- A small black window appears (that is the app running — **leave it open**).
- A second later, your browser opens with Cash Memer.
- The very first time, it asks you to **choose a passcode**. Pick one, write it
  down. Everyone — including your phone — types this to get in.

That is it. Use the app in your browser like any website.

**To stop it:** close the small black window, or click it and press
**Ctrl+C**.

**Tip:** drag `start-mac.command` to your **Dock** so it is one click every
morning. You can also rename it to just **Cash Memer** if you like.

---

## Using your phone as the scanner

1. In Cash Memer, open **New receipt** and press **📱 Phone scanner**.
2. On your phone (on the **same Wi-Fi** as the Mac), point the camera at the QR
   code and open the link.
3. Your phone asks for the passcode once, then remembers it for a month.
4. Scan barcodes — they appear on the Mac instantly.

Your phone's browser will warn "not private" the first time, because the Mac
signs its own certificate. That is expected on a home network — tap **Advanced**
→ **Proceed** (once per phone). The full explanation is in the main
[README](README.md).

---

## If something does not work

- **"Node.js is not installed"** in the black window — do step 1 above, then
  double-click the icon again.
- **Nothing opens / it says it cannot be opened** — you skipped step 3.
  Right-click the icon → **Open** → **Open**.
- **The browser says it cannot reach the app** — the little black window was
  closed. Double-click the icon again.
- **The black window mentions Node 22.5** — your Node is too old. Install the
  latest LTS from <https://nodejs.org> (step 1) and try again.
- **You forgot the passcode** — there is no email reset, on purpose. You would
  have to delete the `data` folder inside `cashmemerwebapp`, which starts the
  shop over. So keep the passcode written down, and use
  **Settings → Backup & restore → Export** now and then to keep a copy of your
  data.
