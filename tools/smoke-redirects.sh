#!/usr/bin/env bash
# Edge smoke test: confirm _redirects actually fires on the deployed
# host. _redirects is host-evaluated (Cloudflare Pages / Netlify), so
# this is the only check that proves redirects work in production.
# The build-time link checker only validates the file's contents, not
# the live edge behaviour.
#
# Usage:
#   tools/smoke-redirects.sh https://preview-branch.visit-tywyn.pages.dev
#
# Run against the PREVIEW deploy before flipping DNS. Exit 0 = all pass.

set -uo pipefail
BASE="${1:?Usage: smoke-redirects.sh <base-url> (e.g. https://preview.pages.dev)}"
BASE="${BASE%/}"
# Require an explicit scheme. Without it curl defaults to http://, and
# the host's http->https upgrade 301 would show up on every row and
# mask the real redirect behaviour we are testing.
if [[ "$BASE" != http://* && "$BASE" != https://* ]]; then
  echo "Base URL must include the scheme, e.g. https://${BASE}" >&2
  exit 2
fi

# from-path | expected-status | expected-location-substring
CHECKS=(
  "/accommodation/tyn-y-cornel-hotel/|301|/holiday-accommodation/bed-and-breakfast/"
  "/accommodation/dolphin-beach-house/|301|/holiday-accommodation/self-catering/"
  "/accommodation/bryn-y-mor/|301|/holiday-accommodation/caravan/"
  "/accommodation/cedris-farm/|301|/holiday-accommodation/camping/"
  "/accommodation/this-slug-never-existed/|301|/where-to-stay/"
  "/cinema/|301|/things-to-do/magic-lantern-cinema/"
  "/tywyn-beach/|301|/things-to-do/tywyn-beach/"
  "/places-to-stay/|301|/where-to-stay/"
  "/event/race-the-train/|301|/events/"
  "/category/uncategorized/|301|/"
  "/holiday-accommodation/caravan/2/|301|/holiday-accommodation/caravan/"
  "/wp-content/uploads/2023/01/example.jpg|404|"
  "/holiday-accommodation/bed-and-breakfast/|200|"
)
# Notes on the two non-301 rows:
#   wp-content/uploads/* : rule was removed on purpose, so it must 404
#                          (a 301 here means the old broken rule is back).
#   bed-and-breakfast/   : a real built page, confirms we did not
#                          accidentally shadow a live URL with a redirect.

fail=0
for row in "${CHECKS[@]}"; do
  IFS='|' read -r path want_status want_loc <<<"$row"
  # -s silent, -o /dev/null, -D - dump headers to stdout, no follow.
  headers=$(curl -sS -o /dev/null -D - -A 'Mozilla/5.0 (smoke-test)' "${BASE}${path}")
  status=$(printf '%s' "$headers" | awk 'NR==1{print $2}')
  loc=$(printf '%s' "$headers" | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')

  ok="PASS"
  if [[ "$status" != "$want_status" ]]; then ok="FAIL"; fi
  if [[ -n "$want_loc" && "$loc" != *"$want_loc"* ]]; then ok="FAIL"; fi

  if [[ "$ok" == "FAIL" ]]; then
    fail=1
    printf 'FAIL %-46s got %s -> %s  (want %s -> %s)\n' "$path" "$status" "${loc:-<none>}" "$want_status" "${want_loc:-<none>}"
  else
    printf 'ok   %-46s %s %s\n' "$path" "$status" "${loc:+-> $loc}"
  fi
done

echo
if [[ "$fail" == 0 ]]; then
  echo "All redirect smoke tests passed. Safe to flip DNS."
else
  echo "FAILURES above. Do NOT launch until these fire correctly at the edge."
  exit 1
fi
