#!/bin/bash
#
# Cash Memer — turn OFF "always on" (undo install-mac-autostart.command).
#
# This stops Cash Memer running in the background and stops it starting itself
# at login. Your shop data is left completely untouched — this only turns off
# the auto-start, nothing else.

LABEL="com.cashmemer.app"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

echo ""
echo "  Turning off Cash Memer auto-start…"

if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  echo "  Done. Cash Memer will no longer start on its own."
  echo "  Your receipts and settings are untouched."
else
  echo "  It was not set to auto-start, so there was nothing to turn off."
fi

# Tidy up the Desktop link if it is still there.
rm -f "$HOME/Desktop/Cash Memer.webloc" 2>/dev/null

echo ""
echo "  You can still start it by hand any time with start-mac.command."
echo "  Press any key to close."
read -n 1 -s -r
