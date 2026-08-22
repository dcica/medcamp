#!/usr/bin/env bash
#
# Push Supabase Storage env vars to a Vercel project, so song and banner uploads
# switch on. Sibling of push-ses-env-to-vercel.sh.
#
# SECRETS ARE NOT STORED IN THIS FILE. Export them in your shell first:
#
#   export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
#   export SUPABASE_SECRET_KEY=sb_secret_...   # or a legacy service_role JWT
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
  test) PROJECT="prj_Zh6SGe3rUhdF9m89jGwGmSsml9Ok"; NAME="medcamp-test"; SONGS="event-songs-test"; BANNERS="event-banners-test" ;;
  prod) PROJECT="prj_QQGdr3qAmh2mS07qpKaX9Poa1TRP"; NAME="medcamp-prod"; SONGS="event-songs";      BANNERS="event-banners" ;;
  *)
    echo "usage: $0 <test|prod>" >&2
    echo "  test -> medcamp-test  (buckets: event-songs-test / event-banners-test)" >&2
    echo "  prod -> medcamp-prod  (buckets: event-songs / event-banners)" >&2
    exit 1 ;;
esac

: "${NEXT_PUBLIC_SUPABASE_URL:?Export NEXT_PUBLIC_SUPABASE_URL before running.}"
: "${SUPABASE_SECRET_KEY:?Export SUPABASE_SECRET_KEY before running (secret/service_role, NOT anon).}"

# DECODE the key rather than pattern-match it. The anon key is public by design;
# a secret key bypasses RLS entirely, and the two are indistinguishable by eye —
# both are ~208-character JWTs. A substring check for "anon" does NOT catch it,
# because the word appears only inside the base64 payload. This exact mix-up
# happened during setup: an anon key sat under the name SUPABASE_SERVICE_ROLE_KEY
# and would have reported storage configured while 403ing every upload.
node -e '
  const k = process.env.SUPABASE_SECRET_KEY || "";
  if (k.startsWith("sb_secret_")) process.exit(0);          // new-style secret
  if (k.startsWith("sb_publishable_")) {
    console.error("ERROR: that is a PUBLISHABLE key. Storage needs the secret key.");
    process.exit(1);
  }
  const parts = k.split(".");
  if (parts.length !== 3) { console.error("ERROR: not a recognisable Supabase key."); process.exit(1); }
  let role;
  try { role = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8")).role; }
  catch { console.error("ERROR: could not decode the key."); process.exit(1); }
  if (role !== "service_role") {
    console.error(`ERROR: that key has role="${role}", not service_role.`);
    process.exit(1);
  }
'


# Uses the REST API rather than the CLI. `vercel env add --scope` selects the
# TEAM, not the project — there is no per-project flag — so the CLI would have
# written to whichever project this repo happens to be linked to. For a value
# that decides which bucket an environment writes into, "happens to be linked"
# is not good enough. The API takes the project explicitly.
node -e '
  const fs = require("fs"), path = require("path");
  const tokenFile = path.join(process.env.APPDATA || process.env.HOME + "/.local/share",
                              "xdg.data", "com.vercel.cli", "auth.json");
  const token = JSON.parse(fs.readFileSync(tokenFile, "utf8")).token;
  const project = process.env.PROJECT, team = process.env.TEAM_ID;
  const vars = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY:      process.env.SUPABASE_SECRET_KEY,
    SUPABASE_STORAGE_BUCKET:  process.env.SONGS,
    SUPABASE_BANNER_BUCKET:   process.env.BANNERS,
  };
  const call = async (m, p, b) => {
    const r = await fetch("https://api.vercel.com" + p, { method: m,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  (async () => {
    const cur = await call("GET", `/v9/projects/${project}/env?teamId=${team}`);
    if (cur.status >= 400) { console.error("  cannot read project env:", JSON.stringify(cur.body).slice(0,160)); process.exit(1); }
    const byKey = new Map((cur.body.envs || []).map(e => [e.key + ":" + e.target.join(","), e.id]));
    let failed = 0;
    for (const [key, value] of Object.entries(vars)) {
      // sensitive => unreadable back out of the API, which is what a key that
      // bypasses RLS should be. `vercel env add` cannot set this at all.
      const type = key === "SUPABASE_SECRET_KEY" ? "sensitive" : "encrypted";
      const old = byKey.get(key + ":production");
      if (old) await call("DELETE", `/v9/projects/${project}/env/${old}?teamId=${team}`);
      const res = await call("POST", `/v10/projects/${project}/env?teamId=${team}`,
        { key, value, type, target: ["production"] });
      const ok = res.status >= 200 && res.status < 300;
      if (!ok) failed++;
      console.log(`  ${ok ? "set " : "FAIL"} ${key.padEnd(26)} ${type}` +
        (ok ? "" : "  -> " + JSON.stringify(res.body).slice(0, 140)));
    }
    process.exit(failed ? 1 : 0);
  })();
'

cat <<EOF

Done. Three things remain, none of them automatic:

  1. The buckets must EXIST in Supabase, with these settings:
       $SONGS      private,  audio/mpeg,                        10485760 bytes
       $BANNERS    PUBLIC,   image/jpeg,image/png,image/webp,    5242880 bytes
     The public/private flag is the one that cannot be wrong: songs are served
     only as signed attachments, banners must be world-readable for next/image.

  2. (done automatically) SUPABASE_SECRET_KEY is written as 'sensitive', so
     it cannot be read back out of the API.

  3. REDEPLOY. Vercel bakes env at build time, so nothing changes until you
     push a commit to the branch, or redeploy from the dashboard.

Then check: an event page should offer "Upload banner" instead of the amber
"not configured" notice, and /perform/<code> should enable the MP3 option.
EOF
