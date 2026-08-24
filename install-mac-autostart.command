#!/bin/bash
#
# Cash Memer — "always on" setup for a Mac (do this once).
#
# After you run this, Cash Memer starts by itself every time your Mac turns on
# and keeps running quietly in the background — no window to keep open, nothing
# to double-click each day. You just click your saved link and it opens.
#
# It also puts a "Cash Memer" link on your Desktop you can drag to the Dock.
#
# To undo all of this later, run uninstall-mac-autostart.command in this folder.

cd "$(dirname "$0")" || exit 1

# Finder does not share a terminal's PATH; look where a Mac keeps Node.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

APPDIR="$(pwd)"
LABEL="com.cashmemer.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo ""
echo "  Cash Memer — always-on setup"
echo "  ============================"
echo ""

# --- Node present? -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed yet — Cash Memer needs it."
  echo "  The download page is opening. Get the green 'LTS' version, install it,"
  echo "  then run this again."
  open "https://nodejs.org/en/download" 2>/dev/null
  echo ""
  echo "  Press any key to close."
  read -n 1 -s -r
  exit 1
fi

NODE_BIN="$(command -v node)"
NODE_DIR="$(dirname "$NODE_BIN")"
echo "  Using Node at: $NODE_BIN"

# --- Install / update the app's parts ---------------------------------------
# Always run install, not just the first time, so an update picks up any new
# parts (it is quick when everything is already there).
echo "  Making sure the app's parts are installed (quick if already done)…"
if ! npm install; then
  echo "  Setup did not finish. Check your internet and run this again."
  echo "  Press any key to close."
  read -n 1 -s -r
  exit 1
fi

mkdir -p data "$HOME/Library/LaunchAgents"

# --- Write the "start me at login and keep me running" instruction -----------
# This is a LaunchAgent: macOS's own way to keep a background program running.
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$APPDIR/scripts/run.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$APPDIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$NODE_DIR:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$APPDIR/data/cashmemer.log</string>
    <key>StandardErrorPath</key>
    <string>$APPDIR/data/cashmemer.log</string>
</dict>
</plist>
PLIST

echo "  Wrote startup instruction to:"
echo "    $PLIST"

# --- Turn it on now (and every login from here on) ---------------------------
launchctl unload "$PLIST" 2>/dev/null
if launchctl load -w "$PLIST" 2>/dev/null; then
  echo "  Started. Cash Memer will now also start on its own at every login."
else
  echo "  Could not start it automatically. You can still use start-mac.command."
fi

# --- A clickable link on the Desktop -----------------------------------------
mkdir -p "$HOME/Desktop"
cat > "$HOME/Desktop/Cash Memer.webloc" <<'WEBLOC'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>URL</key>
    <string>http://localhost:4000</string>
</dict>
</plist>
WEBLOC
echo "  Put a 'Cash Memer' link on your Desktop — drag it to your Dock if you like."

# --- Open it once now, when it is ready --------------------------------------
echo ""
echo "  Opening Cash Memer…"
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://localhost:4000/login"; then
    open "http://localhost:4000"
    break
  fi
  sleep 1
done

# --- Show both links, including the one for the phone ------------------------
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
echo ""
echo "  Done. From now on, just click your saved link. Your links:"
echo "    On this Mac:  http://localhost:4000"
if [ -n "$IP" ]; then
  echo "    On the phone: http://$IP:4000   (same Wi-Fi as this Mac)"
fi
echo ""
echo "  Set your passcode the first time you open it, and write it down."
echo "  Press any key to close this window (the app keeps running)."
read -n 1 -s -r
