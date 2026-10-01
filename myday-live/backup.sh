#!/usr/bin/env bash
# MYDAY — a single archive of everything, for keeping off the droplet.
#   bash backup.sh            writes to /var/backups/myday
#   bash backup.sh /some/dir  writes there instead
set -euo pipefail
DATA_DIR="${DATA_DIR:-/var/lib/myday}"
OUT="${1:-/var/backups/myday}"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT/myday-$STAMP.tar.gz"
tar -czf "$FILE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
# keep the last 30
ls -1t "$OUT"/myday-*.tar.gz 2>/dev/null | tail -n +31 | xargs -r rm -f
echo "$FILE  ($(du -h "$FILE" | cut -f1))"
