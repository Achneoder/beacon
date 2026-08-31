#!/bin/sh
# Rewrite the one file that carries the API address, then hand off to nginx.
#
# SvelteKit compiles `$env/dynamic/public` to `_app/env.js`, a one-line module the
# shell imports at runtime rather than a value inlined across the bundle. That is what
# lets one generic image be pointed at any installation's address — the same property
# the desktop client insists on, for the same reason: nobody rebuilds their own copy
# of the client on-premise.
set -eu

if [ -n "${PUBLIC_API_URL:-}" ]; then
  # The value lands inside a double-quoted JS string literal, so backslashes and
  # quotes have to survive the trip; a newline is refused outright rather than
  # producing a file that parses as something else.
  # `wc -l` counts embedded newlines — a `case` pattern cannot, because command
  # substitution strips the very character being looked for.
  if [ "$(printf '%s' "${PUBLIC_API_URL}" | wc -l)" -ne 0 ]; then
    echo "PUBLIC_API_URL must not contain a newline" >&2
    exit 1
  fi
  escaped=$(printf '%s' "${PUBLIC_API_URL}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  printf 'export const env={PUBLIC_API_URL:"%s"}\n' "${escaped}" > /usr/share/nginx/html/_app/env.js
  echo "beacon-web: serving with PUBLIC_API_URL=${PUBLIC_API_URL}"
else
  echo "beacon-web: PUBLIC_API_URL unset — keeping the value baked at build time"
fi

exec /docker-entrypoint.sh "$@"
