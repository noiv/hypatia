#!/bin/bash
# Monitor Chrome process metrics

# Find Chrome process (Chrome/Chromium launched by Playwright)
CHROME_PID=$(pgrep -f "Chrome.*--remote-debugging-pipe" | head -1)

if [ -z "$CHROME_PID" ]; then
  echo "Chrome/Chromium process not found"
  exit 1
fi

echo "Monitoring Chrome PID: $CHROME_PID"
echo ""

# CPU and Memory from ps
echo "=== CPU & Memory (ps) ==="
ps -p $CHROME_PID -o pid,pcpu,pmem,rss,vsz,comm
echo ""

# Detailed memory breakdown
echo "=== Detailed Memory (ps aux) ==="
ps aux | grep $CHROME_PID | head -1
echo ""

# Open files and network connections
echo "=== Open Files Count ==="
lsof -p $CHROME_PID 2>/dev/null | wc -l
echo ""

# GPU memory (macOS specific - requires system_profiler)
echo "=== GPU Info ==="
system_profiler SPDisplaysDataType | grep -A 5 "Chipset Model"
echo ""

# Memory regions (macOS vmmap - detailed)
echo "=== Memory Regions Summary (vmmap) ==="
vmmap -summary $CHROME_PID 2>/dev/null | head -20
