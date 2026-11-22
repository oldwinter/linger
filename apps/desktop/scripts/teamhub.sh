#!/bin/sh
# Runs the bundled teamhub CLI with the Node built into Linger.
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app="$dir/../../../../MacOS/Linger"
[ -x "$app" ] || app="$dir/../../../../Linger.exe"
[ -x "$app" ] || app="$dir/../../../../linger"
[ -x "$app" ] || app="${LINGER_NODE:-node}"
script="$dir/teamhub.js"
case "$app" in
  *.exe)
    # WSL passes Linux paths as literal Windows arguments and only carries
    # explicitly listed Linux environment variables to Windows executables.
    if command -v wslpath >/dev/null 2>&1; then
      script=$(wslpath -w "$script") || exit 1
      WSLENV="${WSLENV:+$WSLENV:}ELECTRON_RUN_AS_NODE:WSL_DISTRO_NAME"
      export WSLENV
    fi
    ;;
esac
ELECTRON_RUN_AS_NODE=1 exec "$app" --use-env-proxy "$script" "$@"
