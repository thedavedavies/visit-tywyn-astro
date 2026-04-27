#!/usr/bin/env bash
# Sync the legacy WordPress uploads directory into public/wp-content/uploads/.
#
# Why: the markdown content references `/wp-content/uploads/...` URLs,
# so the dev server and production build need those files to exist
# under `public/`. We don't commit them — too much binary data — so
# this script keeps the local working tree in sync with the backup.
#
# Run once after cloning the repo, or any time the backup updates.
#
# Usage:
#   tools/copy-uploads.sh                   # default backup path
#   tools/copy-uploads.sh /path/to/backup   # explicit override

set -euo pipefail

BACKUP_ROOT="${1:-/Users/dave/Downloads/visit-tywyn.co.uk_2026-Mar-13_backup_69b436db1a3c81.57399253}"
SRC="$BACKUP_ROOT/wp-content/uploads/"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/wp-content/uploads/"

if [ ! -d "$SRC" ]; then
	echo "✗ Source not found: $SRC" >&2
	exit 1
fi

mkdir -p "$DEST"

echo "Syncing uploads…"
echo "  from: $SRC"
echo "  to:   $DEST"

rsync -a --delete --stats \
	--exclude '*.bak' \
	--exclude 'cache/' \
	--exclude 'shortpixel-meta/' \
	--exclude 'smush-webp/' \
	"$SRC" "$DEST" \
	| tail -20

echo "Done."
