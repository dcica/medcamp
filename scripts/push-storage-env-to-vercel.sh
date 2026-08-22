#!/usr/bin/env bash
#
# Push Supabase Storage env vars to a Vercel project, so song and banner uploads
# switch on. Sibling of push-ses-env-to-vercel.sh.
#
# SECRETS ARE NOT STORED IN THIS FILE. Export them in your shell first:
#
#   export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
#   bash scripts/push-storage-env-to-vercel.sh test        # or: prod
#
# WHY A TARGET ARGUMENT INSTEAD OF THE AMBIENT LINK. This repo is Vercel-linked
# to medcamp-test, and push-ses-env-to-vercel.sh inherits that link silently.
# For storage that is dangerous rather than merely surprising: test and prod
# share ONE Supabase project (nuexbellwwxbimosibxi), isolated only by Postgres
# schema — and STORAGE HAS NO SCHEMA. If both environments get the same bucket
# names, test uploads land in prod's buckets. So the target is explicit and the
# bucket names are derived from it, never from a default.
#
# Run in Git Bash / WSL (printf '%s' avoids a trailing newline that would
# corrupt the key). Vercel CLI is invoked via npx, so no global install needed.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
case "$TARGET" in
  test) PROJECT="medcamp-test"; SONGS="event-songs-test"; BANNERS="event-banners-test" ;;
  prod) PROJECT="medcamp-prod"; SONGS="event-songs";      BANNERS="event-banners" ;;
  *)
    echo "usage: $0 <test|prod>" >&2
    echo "  test -> medcamp-test  (buckets: event-songs-test / event-banners-test)" >&2
    echo "  prod -> medcamp-prod  (buckets: event-songs / event-banners)" >&2
    exit 1 ;;
esac

: "${NEXT_PUBLIC_SUPABASE_URL:?Export NEXT_PUBLIC_SUPABASE_URL before running.}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Export SUPABASE_SERVICE_ROLE_KEY before running (service_role, NOT anon).}"

# The anon key is public by design; the service_role key bypasses RLS entirely.
# Catching a swap here is cheaper than discovering it when uploads 403 — or,
# worse, when a service_role key reaches the browser.
case "$SUPABASE_SERVICE_ROLE_KEY" in
  *anon*) echo "ERROR: that looks like the ANON key, not service_role." >&2; exit 1 ;;
esac

VERCEL="npx --yes vercel@latest"
echo "Target project: $PROJECT   environment: production"
echo "Buckets:        $SONGS (private) / $BANNERS (public)"
echo

put() {
  local name="$1" value="$2"
  # Remove first so re-runs don't fail on a duplicate.
  $VERCEL env rm "$name" production --scope "$PROJECT" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | $VERCEL env add "$name" production --scope "$PROJECT" >/dev/null
  echo "  set $name"
}

put NEXT_PUBLIC_SUPABASE_URL  "$NEXT_PUBLIC_SUPABASE_URL"
put SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
put SUPABASE_STORAGE_BUCKET   "$SONGS"
put SUPABASE_BANNER_BUCKET    "$BANNERS"

cat <<EOF

Done. Three things remain, none of them automatic:

  1. The buckets must EXIST in Supabase, with these settings:
       $SONGS      private,  audio/mpeg,                        10485760 bytes
       $BANNERS    PUBLIC,   image/jpeg,image/png,image/webp,    5242880 bytes
     The public/private flag is the one that cannot be wrong: songs are served
     only as signed attachments, banners must be world-readable for next/image.

  2. Mark SUPABASE_SERVICE_ROLE_KEY as Sensitive in the Vercel dashboard. It
     bypasses RLS, and 'vercel env add' does not set that flag.

  3. REDEPLOY. Vercel bakes env at build time, so nothing changes until you do:
       $VERCEL deploy --prod --scope $PROJECT
     (or trigger a redeploy from the dashboard)

Then check: an event page should offer "Upload banner" instead of the amber
"not configured" notice, and /perform/<code> should enable the MP3 option.
EOF
