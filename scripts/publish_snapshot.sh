#!/usr/bin/env bash
# Publish voice/main to GitHub (als7294/FoxBox-Voice) as a history-free snapshot commit, authored with this repo's
# configured identity. Local history, which may carry personal author emails, never leaves this Mac.
# Refuses to publish when the tree holds:
#   - a string from the private deny-list ~/.config/foxbox/publish-deny.txt (never committed), in file contents (binary
#     files too: media metadata) or names;
#   - any minted beta invite code (~/.config/foxbox-voice/*-codes.txt, read here, never printed), with or without dashes.
# Needs the `voice` remote, added only once the user has approved creating the repo:
#   git remote add voice https://github.com/als7294/FoxBox-Voice.git
# --dry-run checks everything and builds the snapshot commit, but pushes nothing. It reports counts only: never a
# deny-listed string or a code.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
DRY=0; [ "${1:-}" = "--dry-run" ] && { DRY=1; shift; }
SRC="${1:-voice/main}"
REMOTE="${FVWKS_VOICE_REMOTE:-voice}"
DENY="${FVWKS_PUBLISH_DENY:-$HOME/.config/foxbox/publish-deny.txt}"
CODES_DIR="${FVWKS_VOICE_CODES_DIR:-$HOME/.config/foxbox-voice}"
tree=$(git rev-parse "$SRC^{tree}")

refuse() { echo "refusing to publish: $1 in $SRC"; exit 1; }
[ -f "$DENY" ] || refuse "the deny-list $DENY is missing (it guards every publish)"
denied=0
while IFS= read -r pat; do
  [ -z "$pat" ] && continue
  denied=$((denied + 1))
  if git grep -a -q -i -F "$pat" "$SRC" -- .; then refuse "a deny-listed string is present"; fi
  if git ls-tree -r --name-only "$SRC" | grep -q -i -F "$pat"; then refuse "a deny-listed string is in a file name"; fi
done < "$DENY"
[ "$denied" -gt 0 ] || refuse "the deny-list $DENY is empty"
codes=0
for f in "$CODES_DIR"/*-codes.txt; do
  [ -f "$f" ] || continue
  while read -r _id code _; do
    [ -z "${code:-}" ] && continue
    codes=$((codes + 1))
    if git grep -a -q -i -F -e "$code" -e "${code//-/}" "$SRC" -- .; then refuse "a minted invite code is present"; fi
  done < "$f"
done
[ "$codes" -gt 0 ] || refuse "no minted codes found in $CODES_DIR to scan for"
# Ship-blockers that must never be in the public tree.
if git ls-tree -r --name-only "$SRC" | grep -q -E '(^|/)(credit\.local\.json|beta-signing\.key|\.env)$'; then refuse "a private file is tracked"; fi

parent=$(git rev-parse -q --verify refs/heads/publish-voice || true)
if [ -n "$parent" ] && [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then echo "publish already matches $SRC"; exit 0; fi
msg="FoxBox Voice snapshot ($(git rev-parse --short "$SRC"), $(date -u +%Y-%m-%d))"
commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "$msg")
files=$(git ls-tree -r --name-only "$SRC" | wc -l | tr -d ' ')
bytes=$(git ls-tree -r -l "$SRC" | awk '{s += $4} END {print s}')
echo "tree $SRC ($(git rev-parse --short "$SRC")): $files files, $((bytes / 1048576)) MB"
echo "deny-list: $denied strings checked in contents (binary too) and names: 0 hits"
echo "minted codes: $codes checked, with and without dashes: 0 hits"
echo "private files (credit.local.json, beta-signing.key, .env): none tracked"
if [ "$DRY" = 1 ]; then echo "dry run: checks passed; would publish $commit to $REMOTE main (nothing pushed)"; exit 0; fi
git remote get-url "$REMOTE" >/dev/null 2>&1 || refuse "there is no '$REMOTE' remote (see the header: add it once the repo is approved)"
git update-ref refs/heads/publish-voice "$commit"
git push "$REMOTE" publish-voice:main
echo "published $commit"
