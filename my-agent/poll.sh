#!/usr/bin/env bash
# Один опрос статуса сессии. Использование: bash poll.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; source IDS.env; set +a
BASE=https://api.anthropic.com/v1
curl -sS "$BASE/sessions/$SESSION_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" -o /tmp/sess-status.json
python3 - <<'PY'
import json
d = json.JSONDecoder(strict=False).decode(open('/tmp/sess-status.json').read())
evals = [(e.get('result'), e.get('explanation', '')[:300]) for e in d.get('outcome_evaluations', [])]
print('status:', d.get('status'))
for r, ex in evals:
    print('verdict:', r, '|', ex)
PY
