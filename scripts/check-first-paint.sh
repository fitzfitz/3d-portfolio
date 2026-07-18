#!/bin/bash
# First-paint regression check: no render-blocking @import chains, inline dark fallback present.
set -e
fail=0
if grep -q "@import" dist/assets/*.css; then
  echo "FAIL: built CSS contains render-blocking @import"; fail=1
else
  echo "OK: no @import in built CSS"
fi
if grep -q "background:#020108" dist/index.html; then
  echo "OK: inline dark background fallback present in index.html"
else
  echo "FAIL: no inline background fallback in index.html"; fail=1
fi
exit $fail
