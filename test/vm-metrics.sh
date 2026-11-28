#!/bin/sh
# Sample Docker stats, host memory and load while a load test runs.
# Usage: sh test/vm-metrics.sh /tmp/metrics.log 120
out="${1:-/tmp/metrics.log}"
secs="${2:-120}"
end=$(( $(date +%s) + secs ))
{
  echo "START $(date -Is)"
  while [ "$(date +%s)" -lt "$end" ]; do
    echo "TS $(date -Is)"
    docker stats --no-stream --format 'STAT name={{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}} mempct={{.MemPerc}}' 2>/dev/null
    free -m | awk '/Mem:/{print "MEM total="$2" used="$3" free="$4" buff="$6" avail="$7}'
    awk '{print "LOAD "$1" "$2" "$3}' /proc/loadavg
    printf 'LOCALHEALTH '; curl -s -o /dev/null -w '%{time_total}\n' http://127.0.0.1:3000/healthz
    sleep 2
  done
  echo "END $(date -Is)"
} >> "$out"
