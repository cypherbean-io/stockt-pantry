#!/usr/bin/env bash
# PreToolUse (matcher: Bash) — deterministic backstop against destructive and
# exfiltration-shaped commands.
#
# This is defense in depth and it IS defeatable (variables, encodings, indirection).
# The controls that actually hold are permissions.deny and the OS sandbox.
#
# FAILS CLOSED: if neither jq nor python3 is on PATH, this blocks rather than
# silently allowing every command.
set -uo pipefail

INPUT=$(cat)

extract() {   # $1 = dotted path, e.g. tool_input.command
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$INPUT" | jq -r ".$1 // empty"
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$INPUT" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
for k in sys.argv[1].split("."):
    d = d.get(k) if isinstance(d, dict) else None
print(d if isinstance(d, str) else "")' "$1"
  else
    return 1
  fi
}

if ! CMD=$(extract tool_input.command); then
  echo "Blocked: this repository's guard-bash hook needs 'jq' or 'python3' on PATH to inspect the command and found neither. Install one, or remove the hook from .claude/settings.json." >&2
  exit 2
fi
[ -z "$CMD" ] && exit 0

block() { echo "Blocked by repo policy: $1" >&2; exit 2; }

grep -Eq '(curl|wget|fetch)[^|;&]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|k|)sh' <<<"$CMD" \
  && block "downloading and piping to a shell"

grep -Eq 'rm[[:space:]]+(-[a-zA-Z]*[rR][a-zA-Z]*[[:space:]]+)+(/|~|\$HOME|\.\.)' <<<"$CMD" \
  && block "recursive delete outside the working tree"

grep -Eq '(\.ssh/|\.aws/credentials|\.gnupg|\.netrc|\.npmrc|id_rsa|id_ed25519)' <<<"$CMD" \
  && block "touching a credential store"

grep -Eq '(^|[;&|[:space:]])(env|printenv|set)([[:space:]]|$).*(\||>|curl|nc |base64)' <<<"$CMD" \
  && block "dumping the environment into another command"

grep -Eq 'git[[:space:]]+push[^;&|]*(--force([^-]|$)|-f([[:space:]]|$))' <<<"$CMD" \
  && block "force push"

grep -Eq 'git[[:space:]]+(reset[[:space:]]+--hard[[:space:]]+origin|filter-branch|push[^;&|]*--mirror)' <<<"$CMD" \
  && block "destructive git history operation"

grep -Eq '(npm|pnpm|yarn)[[:space:]]+publish|cargo[[:space:]]+publish|twine[[:space:]]+upload' <<<"$CMD" \
  && block "publishing a package"

grep -Eq '(^|[;&|[:space:]])(nc|ncat|netcat|socat)([[:space:]]|$)' <<<"$CMD" \
  && block "raw socket tool"

grep -Eq 'chmod[[:space:]]+(-[a-zA-Z]+[[:space:]]+)?(777|a\+rwx|o\+w)' <<<"$CMD" \
  && block "world-writable chmod"

exit 0
