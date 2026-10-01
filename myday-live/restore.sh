#!/usr/bin/env bash
# MYDAY — look at your backups, and put one back.
#
#   bash restore.sh                 list what's available
#   bash restore.sh <snapshot file> put that one back
#
# Nothing is thrown away: whatever is live now is saved first.

set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/myday}"
SNAPS="$DATA_DIR/snapshots"

ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$1"; }
say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31mStopped:\033[0m %s\n' "$1" >&2; exit 1; }

[ -d "$DATA_DIR" ] || die "No data directory at $DATA_DIR"

human() {
  node -e "
    const fs=require('fs');
    try {
      const j=JSON.parse(fs.readFileSync('$1','utf8'));
      const v=JSON.parse(j.value||'{}');
      const bits=[];
      if (v.tasks) bits.push(v.tasks.length+' tasks');
      if (v.entries) bits.push(v.entries.length+' auction rows');
      if (v.notes) bits.push(v.notes.length+' notes');
      if (v.sketches) bits.push(v.sketches.length+' scribbles');
      console.log(bits.join(', ') || 'readable');
    } catch(e) { console.log('unreadable'); }
  " 2>/dev/null || echo "?"
}

if [ $# -eq 0 ]; then
  say "Live data"
  for f in "$DATA_DIR"/state-*.json; do
    [ -e "$f" ] || continue
    printf '    %-52s %8s   %s\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)" "$(human "$f")"
  done

  say "Backups, newest first"
  if [ -d "$SNAPS" ] && [ -n "$(ls -A "$SNAPS" 2>/dev/null)" ]; then
    ls -1t "$SNAPS" | head -40 | while read -r f; do
      printf '    %-62s %8s   %s\n' "$f" "$(du -h "$SNAPS/$f" | cut -f1)" "$(human "$SNAPS/$f")"
    done
    echo
    echo "    $(ls -1 "$SNAPS" | wc -l) backups in total, going back up to two months."
    echo
    echo "To put one back:"
    echo "    bash restore.sh $(ls -1t "$SNAPS" | head -1)"
  else
    echo "    None yet. They appear the first time your data changes."
  fi
  exit 0
fi

WANT="$1"
[ -f "$SNAPS/$WANT" ] || WANT_PATH="$1"
SRC="${SNAPS}/${WANT}"
[ -f "$SRC" ] || SRC="$1"
[ -f "$SRC" ] || die "Can't find $1"

node -e "JSON.parse(require('fs').readFileSync('$SRC','utf8'))" \
  || die "That file isn't readable, so restoring it would make things worse."

BASE="$(basename "$SRC")"
TARGET_NAME="$(echo "$BASE" | sed -E 's/\.[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9-]+Z\.json$/.json/')"
TARGET="$DATA_DIR/$TARGET_NAME"

say "About to restore"
echo "    from: $BASE"
echo "          $(human "$SRC")"
echo "    to:   $TARGET_NAME"
echo "          $( [ -f "$TARGET" ] && human "$TARGET" || echo "nothing there yet" )"
echo
read -r -p "Go ahead? [y/N] " YES </dev/tty
[ "$YES" = "y" ] || [ "$YES" = "Y" ] || die "Left alone."

systemctl stop myday 2>/dev/null || true
if [ -f "$TARGET" ]; then
  KEEP="$DATA_DIR/before-restore-$(date +%Y%m%d-%H%M%S)-$TARGET_NAME"
  cp "$TARGET" "$KEEP"
  ok "what was live is saved as $(basename "$KEEP")"
fi
cp "$SRC" "$TARGET"
chmod 600 "$TARGET"
ok "restored"
systemctl start myday 2>/dev/null || true
sleep 1
systemctl is-active --quiet myday 2>/dev/null && ok "app restarted" || echo "    start it with: systemctl start myday"

say "Done"
echo "Reload the site. If it looks wrong, the copy from a moment ago is in $DATA_DIR."
