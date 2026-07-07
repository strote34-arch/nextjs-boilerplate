#!/usr/bin/env bash
# Скачивает выходные файлы последней сессии в ./outputs/
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; source IDS.env; set +a
BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01")
mkdir -p outputs
curl -sS "$BASE/files?scope_id=$SESSION_ID" "${H[@]}" -o /tmp/files.json
python3 - <<'PY' > /tmp/file-list.txt
import json
d = json.JSONDecoder(strict=False).decode(open('/tmp/files.json').read())
for f in d.get('data', []):
    print(f['id'], f.get('filename', 'unnamed'))
PY
while read -r fid fname; do
  echo "↓ $fname"
  curl -sS "$BASE/files/$fid/content" "${H[@]}" -o "outputs/$fname"
done < /tmp/file-list.txt
echo "Готово: $(ls outputs/)"
