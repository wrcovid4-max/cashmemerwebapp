# Putting Cash Memer on the internet

This turns Cash Memer into a real website you open with a link — from any phone
or any computer, anywhere, like YouTube — with **no terminal and no `npm start`
ever again**. You do it once. After that you just open the link.

Read this first, because it is the honest trade-off:

- **Your data moves onto a rented computer.** Right now your receipts and your
  customers' phone numbers live only on your own machine. Once it is on the
  internet, they live on the host's computer instead. The app is locked with
  your passcode, and the connection is encrypted — but the data is no longer
  only in your shop.
- **It is not free.** To keep your data safe across restarts it needs a
  permanent disk, and that needs a paid plan — about **a few dollars a month**.
  The free plans throw the data away when the server restarts, which for a
  receipts app is not acceptable, so this guide uses the paid one on purpose.
- **You still get a backup.** Just like on your computer, use
  **Settings → Backup & restore → Export** now and then, and keep that file. The
  host is where it runs, not your only copy.

If you would rather keep it free and fully private on your own computer, stop
here — that is the other path, and it does not need any of this.

---

## What you need

- The Cash Memer code on GitHub (it already is:
  `github.com/wrcovid4-max/cashmemerwebapp`).
- A credit or debit card, for the few-dollars-a-month plan.
- About ten minutes, once.

You do **not** need to install anything or type any commands.

---

## Step 1 — get the code ready on GitHub

Everything the host needs is already in the project — a file called
`render.yaml` that tells the host exactly how to run the app. It only has to be
on your **main** branch on GitHub.

If you have been given a "pull request" for this change, open it on GitHub and
press the green **Merge** button, the same way you did before. That copies
`render.yaml` onto main. If it is already on main, skip this step.

---

## Step 2 — make a Render account

1. Go to **<https://render.com>** in your browser.
2. Press **Get Started** and choose **GitHub** to sign up. This lets Render see
   your code. It is free to make the account — you only pay when a paid service
   is running.
3. When it asks which repositories Render may access, allow it to see
   **cashmemerwebapp** (either "all repositories" or just that one).

---

## Step 3 — deploy, by clicking

1. In the Render dashboard, press **New +** (top right), then **Blueprint**.
2. Pick the **cashmemerwebapp** repository from the list and press **Connect**.
3. Render reads the `render.yaml` file and shows you one service called
   **cashmemer**. You do not have to understand the settings — they are already
   filled in.
4. It will ask you to fill in **SETUP_PASSCODE**. **Type the passcode you want
   for your shop here.** This is the code you (and your phone) will type to get
   in. Write it down somewhere safe — there is no email reset.
   - You can leave `EXCHANGE_RATE_API_KEY` and `GEMINI_API_KEY` blank. Those
     features just stay off, exactly like on your computer. You can add them
     later without touching code.
5. Press **Apply** (or **Create**). Render now builds and starts the app. This
   takes a few minutes — you will see logs scrolling. It is done when the
   service shows a green **Live**.

---

## Step 4 — open your app

At the top of the service page Render shows your address. It looks like:

```
https://cashmemer.onrender.com
```

(the exact name may have a few extra letters). **That link is your app.** Open
it, type your passcode once, and you are in. Put it on your phone's home screen
and on the shop computer — it is the only link you need from now on.

The phone scanner works the same way: open **New receipt → Phone scanner**, and
the QR code now points at your real internet address, so your phone connects
from anywhere — not just the shop Wi-Fi. It asks for the passcode once per
phone.

---

## After it is live

- **Change the passcode:** do it inside the app, **Settings → Passcode**. That
  change sticks and beats the one you first typed into Render.
- **Lost phone:** **Settings → Passcode → Sign out everywhere** kicks every
  device off until it types the passcode again.
- **Back up your shop:** **Settings → Backup & restore → Export** every so
  often, and keep the file. The host is not a backup.
- **It costs money while it runs.** If you ever want to stop paying, suspend or
  delete the service in the Render dashboard. Export your data first.

---

## If something goes wrong

- **The build failed.** Open the **Logs** tab on the Render service and read the
  last red lines. The most common cause is the paid plan not being confirmed —
  the permanent disk needs it.
- **"Application failed to respond".** Give it a minute after "Live"; the first
  open can be slow. If it stays broken, check the Logs tab.
- **You forgot the passcode.** There is no reset — the app has no idea who you
  are, on purpose. You would have to set a new `SETUP_PASSCODE` in Render's
  **Environment** tab and clear the old one from the disk, which loses the shop
  data. So keep the passcode written down.
