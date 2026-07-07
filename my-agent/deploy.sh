#!/usr/bin/env bash
# Создаёт 🗓️ scheduled deployment: каждый день 07:00 Europe/Moscow.
# Запускать после того, как первый прогон принят. Возобновляемый (читает IDS.env).
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; source IDS.env; set +a
BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

if [ -z "${DEPLOYMENT_ID:-}" ]; then
  python3 - "$AGENT_ID" "$ENV_ID" <<'PY'
import json, sys
task = open('first_prompt.txt').read()
rubric = open('outcome.md').read()
body = {
  "name": "Утренний дайджест роликов афи.рф",
  "agent": sys.argv[1],
  "environment_id": sys.argv[2],
  "initial_events": [{"type": "user.define_outcome", "description": task,
                      "rubric": {"type": "text", "content": rubric}, "max_iterations": 3}],
  "schedule": {"type": "cron", "expression": "0 7 * * *", "timezone": "Europe/Moscow"}
}
json.dump(body, open('/tmp/deploy.json', 'w'), ensure_ascii=False)
PY
  curl -sS --fail-with-body "$BASE/deployments?beta=true" "${H[@]}" -d @/tmp/deploy.json -o /tmp/deploy-resp.json
  DEPLOYMENT_ID=$(python3 -c "import json; print(json.JSONDecoder(strict=False).decode(open('/tmp/deploy-resp.json').read())['id'])")
  echo "DEPLOYMENT_ID=$DEPLOYMENT_ID" >> IDS.env
fi
echo "→ 🗓️ deployment: $DEPLOYMENT_ID"
python3 - <<'PY'
import json
d = json.JSONDecoder(strict=False).decode(open('/tmp/deploy-resp.json').read())
print('ближайшие запуски:', d.get('schedule', {}).get('upcoming_runs_at', 'см. Console'))
PY
echo "Ручной тестовый запуск: curl -X POST -d '{}' \"$BASE/deployments/$DEPLOYMENT_ID/run?beta=true\" + заголовки"
