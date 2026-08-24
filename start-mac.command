#!/bin/bash
#
# Cash Memer — double-click to start (macOS).
#
# You do not type anything. Double-click this icon and, a moment later, your
# browser opens with Cash Memer ready to use. Keep the little black window that
# appears open while you work; closing it stops the app. To start again the next
# day, just double-click this icon again.
#
# The first time only, it sets itself up, which takes a minute.

# Work from the folder this icon lives in, wherever you moved it to.
cd "$(dirname "$0")" || exit 1

# Finder does not always share the same PATH as a terminal, so make sure the
# usual places Node gets installed are found: the nodejs.org installer puts it
# in /usr/local/bin, and Homebrew on Apple-Silicon Macs uses /opt/homebrew/bin.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo ""
echo "  Cash Memer"
echo "  =========="
echo ""

# --- Is Node installed? ------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed yet — Cash Memer needs it to run."
  echo ""
  echo "  1. The download page is opening in your browser now."
  echo "  2. Get the big green 'LTS' version and install it (just keep"
  echo "     clicking Continue, then Install)."
  echo "  3. When that is done, double-click this Cash Memer icon again."
  echo ""
  open "https://nodejs.org/en/download" 2>/dev/null
  echo "  Press any key to close this window."
  read -n 1 -s -r
  exit 1
fi

# --- Install / update the app's parts ---------------------------------------
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "  Installing what the app needs (quick if already done)…"
  echo ""
  if ! npm install; then
    echo ""
    echo "  Setup did not finish. Check you are connected to the internet and"
    echo "  double-click the icon again. Press any key to close this window."
    read -n 1 -s -r
    exit 1
  fi
  echo ""
fi

# --- Open the browser once the app is actually answering ---------------------
# Waits for the app to come up, then opens it. Runs in the background so it can
# watch while the server starts below.
(
  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "http://localhost:4000/login"; then
      open "http://localhost:4000"
      exit 0
    fi
    sleep 1
  done
) &

echo "  Starting Cash Memer. Your browser will open in a second."
echo ""
echo "  KEEP THIS WINDOW OPEN while you use the app."
echo "  Closing it (or pressing Ctrl+C) stops Cash Memer."
echo ""

# Start with the same Node we just checked for above, rather than through npm —
# npm can reach for a different Node than the one on your PATH, and on this app
# that matters because of the sqlite feature. This runs the app and does not
# return until you close the window or press Ctrl+C.
node scripts/run.js
