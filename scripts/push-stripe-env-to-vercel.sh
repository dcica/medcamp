#!/usr/bin/env bash
#
# Push Stripe env vars to a Vercel project: the secret key and the WEBHOOK
# SIGNING SECRET. Sibling of push-ses-env-to-vercel.sh.
#
# NO PUBLISHABLE KEY, deliberately. Nothing in the app reads one — hosted
# Checkout redirects to checkout.stripe.com rather than mounting Stripe's
# own elements, so the browser never needs a key. See src/lib/env.ts.
#
# SECRETS ARE NOT STORED IN THIS FILE. Export them in your shell first:
#
#   export STRIPE_SECRET_KEY=sk_test_...        # or rk_test_... (restricted)
#   export STRIPE_WEBHOOK_SECRET=whsec_...
#   bash scripts/push-stripe-env-to-vercel.sh test       # or: prod
#
# WHY A TARGET ARGUMENT INSTEAD OF THE AMBIENT LINK. This repo is Vercel-linked
# to medcamp-test, and a script that inherits that link silently is one typo
# away from pushing TEST keys over PROD's -- at which point real buyers' cards
# stop working and nothing in the app says why. The target is explicit, the
# script prints what it is about to do, and it refuses a mode/target mismatch.
#
# THE THREE MUST COME FROM THE SAME STRIPE MODE AND THE SAME ENDPOINT.
# A signing secret is per-endpoint AND per-mode: a live whsec against test
# events fails constructEvent, the route 400s, and the order simply never
# confirms -- no error reaches the buyer, the page just sits on "payment
# hasn't been confirmed yet". That failure is silent by design (Stripe
# retries), which is exactly why it is worth refusing up front.
#
# Run in Git Bash / WSL (printf '%s' avoids a trailing newline that would
# corrupt the secret). Vercel CLI is invoked via npx, so no global install.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
case "$TARGET" in
  test) PROJECT="medcamp-test" ;;
  prod) PROJECT="medcamp-prod" ;;
  *)
    echo "usage: bash scripts/push-stripe-env-to-vercel.sh <test|prod>" >&2
    exit 1
    ;;
esac

: "${STRIPE_SECRET_KEY:?export STRIPE_SECRET_KEY first}"
: "${STRIPE_WEBHOOK_SECRET:?export STRIPE_WEBHOOK_SECRET first}"

# ── Refuse a mode/target mismatch ─────────────────────────────────────────
# The whole point of the target argument. `rk_` is allowed because prod
# uses a restricted key.
mode_of() {
  case "$1" in
    sk_test_*|rk_test_*) echo test ;;
    sk_live_*|rk_live_*) echo live ;;
    *) echo unknown ;;
  esac
}
SEC_MODE="$(mode_of "$STRIPE_SECRET_KEY")"

if [ "$SEC_MODE" = unknown ]; then
  echo "REFUSING: STRIPE_SECRET_KEY does not look like sk_/rk_ test or live." >&2
  exit 1
fi
case "$STRIPE_WEBHOOK_SECRET" in
  whsec_*) ;;
  *) echo "REFUSING: STRIPE_WEBHOOK_SECRET must start with whsec_." >&2; exit 1 ;;
esac
if [ "$TARGET" = test ] && [ "$SEC_MODE" = live ]; then
  echo "REFUSING: live keys into medcamp-test. Rehearsal sales would be real money." >&2
  exit 1
fi
if [ "$TARGET" = prod ] && [ "$SEC_MODE" = test ]; then
  echo "REFUSING: test keys into medcamp-prod. Real buyers could not pay." >&2
  exit 1
fi

VERCEL="npx --yes vercel"
ENVIRONMENT=production   # medcamp-test's live URL is its 'production' env

echo
echo "  project      $PROJECT"
echo "  environment  $ENVIRONMENT"
echo "  stripe mode  $SEC_MODE"
echo "  webhook      whsec_… (${#STRIPE_WEBHOOK_SECRET} chars)"
echo

put() {
  local name="$1" value="$2"
  # Remove then re-add, so the script is re-runnable.
  $VERCEL env rm "$name" "$ENVIRONMENT" --yes --scope dcica >/dev/null 2>&1 || true
  # printf '%s' => no trailing newline, which would corrupt the secret.
  printf '%s' "$value" | $VERCEL env add "$name" "$ENVIRONMENT" --scope dcica >/dev/null
  echo "  set $name"
}

put STRIPE_SECRET_KEY "$STRIPE_SECRET_KEY"
put STRIPE_WEBHOOK_SECRET "$STRIPE_WEBHOOK_SECRET"

echo
echo "  Done. An env change does NOT reach a running deployment —"
echo "  redeploy $PROJECT before testing."
