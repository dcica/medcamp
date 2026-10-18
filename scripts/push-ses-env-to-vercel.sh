#!/usr/bin/env bash
#
# Push SES/email + canonical-URL env vars to the linked Vercel project
# (medcamp-test): EMAIL_PROVIDER, AWS_REGION, EMAIL_FROM, the two AWS keys,
# and NEXTAUTH_URL / NEXT_PUBLIC_APP_URL (= https://test.dcica.org).
#
# SECRETS ARE NOT STORED IN THIS FILE. Export them in your shell first, then run.
# Use a SCOPED, SES-send-only IAM key here (not your admin/profile creds):
#
#   export AWS_ACCESS_KEY_ID=AKIA....
#   export AWS_SECRET_ACCESS_KEY=....
#   bash scripts/push-ses-env-to-vercel.sh [environment]
#
# environment defaults to "production" (the medcamp-test project's live URL).
# Pass "preview" or "development" to target those instead. Re-runnable: each
# var is removed then re-added, so running twice won't error on duplicates.
#
# Run in Git Bash / WSL (uses printf '%s' to avoid a trailing newline that would
# corrupt the secret). Vercel CLI is invoked via npx, so no global install needed.

set -euo pipefail

# The script lives in <repo>/scripts/. Always operate from the repo root so the
# Vercel link (.vercel/) and relative paths resolve no matter where it's run.
cd "$(dirname "$0")/.."

ENVIRONMENT="${1:-production}"
VERCEL="npx --yes vercel@latest"

# ── Non-secret values (override by exporting before running if needed) ──
EMAIL_PROVIDER="${EMAIL_PROVIDER:-ses}"
AWS_REGION="${AWS_REGION:-us-east-1}"
EMAIL_FROM="${EMAIL_FROM:-dcica <no-reply@dcica.org>}"
# The PLATFORM host: where staff sign in and where /o/<slug> resolves a tenant
# without a domain of its own. NEXTAUTH_URL is derived from it, because the
# session cookie is host-only and tenant domains share no parent — a session
# can live on exactly one host. Setting these two is the cutover: staff
# sign-in moves to this host and bookmarks on tenant domains redirect in one
# hop. Register https://$PLATFORM_HOST/api/auth/callback/google on the OAuth
# client BEFORE running this, or every login 400s.
PLATFORM_HOST="${PLATFORM_HOST:-medcamp-test.vercel.app}"
# Fallback origin only (localhost / an unknown host): every absolute URL a
# tenant's pages emit comes from its OrgDomain row, not from this value.
APP_URL="${APP_URL:-https://test.dcica.org}"

# ── Required secrets ──
: "${AWS_ACCESS_KEY_ID:?Export AWS_ACCESS_KEY_ID before running (scoped SES key).}"
: "${AWS_SECRET_ACCESS_KEY:?Export AWS_SECRET_ACCESS_KEY before running.}"

if [ ! -f .vercel/project.json ]; then
  echo "Repo is not Vercel-linked. Run: $VERCEL link" >&2
  exit 1
fi
PROJECT="$(node -e 'process.stdout.write(require("./.vercel/project.json").projectName)')"
echo "Target project: $PROJECT   environment: $ENVIRONMENT"

put() {
  local name="$1" value="$2"
  # Remove any existing value first so re-runs don't fail on duplicates.
  $VERCEL env rm "$name" "$ENVIRONMENT" --yes >/dev/null 2>&1 || true
  # printf '%s' => no trailing newline (critical for the secret to match).
  printf '%s' "$value" | $VERCEL env add "$name" "$ENVIRONMENT" >/dev/null
  echo "  set $name"
}

put EMAIL_PROVIDER       "$EMAIL_PROVIDER"
put AWS_REGION           "$AWS_REGION"
put EMAIL_FROM           "$EMAIL_FROM"
put AWS_ACCESS_KEY_ID    "$AWS_ACCESS_KEY_ID"
put AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
put PLATFORM_HOST        "$PLATFORM_HOST"
put NEXTAUTH_URL         "https://$PLATFORM_HOST"
put NEXT_PUBLIC_APP_URL  "$APP_URL"

echo
echo "Done. Reminders:"
echo "  - Do NOT set AWS_PROFILE on Vercel (there is no ~/.aws there)."
echo "  - Staff now sign in on https://$PLATFORM_HOST; tenant-domain bookmarks redirect there."
echo "  - Google OAuth must have this redirect URI registered, or login 400s:"
echo "      ${APP_URL}/api/auth/callback/google"
echo "  - Redeploy for the new env to take effect:"
echo "      $VERCEL deploy --prod   # (or trigger a redeploy from the dashboard)"
