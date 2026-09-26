#!/usr/bin/env bash
# Runs a command with no network route except local unix sockets (PostgreSQL).
# Linux (CI): a fresh network namespace, only the loopback interface, then drop back to the caller.
# macOS (local): sandbox-exec profile that denies all outbound IP traffic.
set -euo pipefail
case "$(uname -s)" in
  Linux)
    exec sudo --preserve-env unshare --net -- bash -c '
      ip link set lo up
      exec sudo --preserve-env -u "'"$(id -un)"'" env PATH="'"$PATH"'" "$@"' _ "$@"
    ;;
  Darwin)
    exec sandbox-exec -p '(version 1)
(allow default)
(deny network-outbound (remote ip))
(allow network-outbound (remote unix-socket))' "$@"
    ;;
  *)
    echo "run-isolated: unsupported platform $(uname -s)" >&2
    exit 3
    ;;
esac
