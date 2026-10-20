#!/bin/sh
# presistent — entrada do container: modo HTTP (default) ou browser real (SIM_BROWSER=1)
set -e

INTERVAL="${SIM_INTERVAL_SECONDS:-180}"
TOL=$(( INTERVAL / 4 ))
MIN_WAIT=$(( INTERVAL - TOL ))

while true; do
  if [ "${SIM_BROWSER:-0}" = "1" ]; then
    node sim/browser.mjs || true
  else
    node sim/run.mjs --json > /dev/null 2>&1 || true
  fi
  WAIT=$(( MIN_WAIT + (RANDOM % (2 * TOL)) ))
  [ "$WAIT" -lt 10 ] && WAIT=10
  sleep "$WAIT"
done
