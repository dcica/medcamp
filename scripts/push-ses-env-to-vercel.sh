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
# Canonical host for the test site. Pinning NEXTAUTH_URL stops NextAuth from
# falling back to the raw VERCEL_URL (medcamp-sigma.vercel.app) and bouncing
# logins off the custom domain. For a preview env, export APP_URL to override.
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
put NEXTAUTH_URL         "$APP_URL"
put NEXT_PUBLIC_APP_URL  "$APP_URL"

echo
echo "Done. Reminders:"
echo "  - Do NOT set AWS_PROFILE on Vercel (there is no ~/.aws there)."
echo "  - Google OAuth must have this redirect URI registered, or login 400s:"
echo "      ${APP_URL}/api/auth/callback/google"
echo "  - Redeploy for the new env to take effect:"
echo "      $VERCEL deploy --prod   # (or trigger a redeploy from the dashboard)"
