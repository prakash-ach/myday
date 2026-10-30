#!/usr/bin/env bash
# Run before uploading to GitHub: stops if anything sensitive is in the files.
cd "$(dirname "$0")"
hits=$(grep -rInE --exclude-dir=node_modules --exclude-dir=.git --exclude=check-secrets.sh --exclude=SECURITY.md \
  'sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,}|GOCSPX-[A-Za-z0-9_-]+|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[bp]-[A-Za-z0-9-]+|(password|passwd|secret|token)[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"'<$ ]{8,}|\b([0-9]{1,3}\.){3}[0-9]{1,3}\b' . \
  | grep -vE '\b(127\.0\.0\.1|0\.0\.0\.0|255\.255\.255\.255|1\.1\.1\.1|8\.8\.8\.8)\b|version|v[0-9]+\.[0-9]+\.[0-9]+' )
files=$(find . -path ./node_modules -prune -o \( -name '.env*' -o -name '*.pem' -o -name '*.key' -o -name '*secrets*' \) -print | grep -v check-secrets)
if [ -n "$hits$files" ]; then echo "STOP — possible secrets found:"; echo "$hits"; echo "$files"; exit 1; fi
echo "OK — no secrets, keys or IP addresses found."
