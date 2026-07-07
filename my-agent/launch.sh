#!/usr/bin/env bash
# Пошаговый, возобновляемый запуск агента afisha-trailer-digest.
# Каждый шаг читает IDS.env и пропускает уже созданные объекты — можно перезапускать безопасно.
set -euo pipefail
cd "$(dirname "$0")"

set -a; source .env; set +a
touch IDS.env; set -a; source IDS.env; set +a

BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

pyget() { python3 -c "import json,sys; d=json.JSONDecoder(strict=False).decode(open('$1').read()); print(d$2)"; }

# ── Шаг 0: модель ──────────────────────────────────────────
if [ -z "${MODEL_ID:-}" ]; then
  curl -sS --fail-with-body "$BASE/models" "${H[@]:0:4}" -o /tmp/models.json
  MODEL_ID=$(python3 - <<'PY'
import json
d = json.load(open('/tmp/models.json'))
ids = [m['id'] for m in d['data']]
opus = [i for i in ids if 'opus' in i]
fable = [i for i in ids if 'fable' in i or 'mythos' in i]
print((opus or fable or ids)[0])
PY
)
  echo "MODEL_ID=$MODEL_ID" >> IDS.env
fi
echo "→ модель: $MODEL_ID"

# ── Шаг 1: environment ─────────────────────────────────────
if [ -z "${ENV_ID:-}" ]; then
  curl -sS --fail-with-body "$BASE/environments" "${H[@]}" -d @environment.json -o /tmp/env.json
  ENV_ID=$(pyget /tmp/env.json "['id']")
  echo "ENV_ID=$ENV_ID" >> IDS.env
fi
echo "→ 📦 environment: $ENV_ID"

# ── Шаг 2: agent ───────────────────────────────────────────
if [ -z "${AGENT_ID:-}" ]; then
  python3 - "$MODEL_ID" <<'PY'
import json, sys
a = json.load(open('agent.json'))
a['model'] = {'id': sys.argv[1]}
json.dump(a, open('/tmp/agent-final.json', 'w'), ensure_ascii=False)
PY
  curl -sS --fail-with-body "$BASE/agents" "${H[@]}" -d @/tmp/agent-final.json -o /tmp/agent.json
  AGENT_ID=$(pyget /tmp/agent.json "['id']")
  AGENT_VERSION=$(pyget /tmp/agent.json "['version']")
  echo "AGENT_ID=$AGENT_ID" >> IDS.env
  echo "AGENT_VERSION=$AGENT_VERSION" >> IDS.env
fi
echo "→ 🤖 agent: $AGENT_ID (v${AGENT_VERSION:-1})"

# ── Шаг 3: session ─────────────────────────────────────────
if [ -z "${SESSION_ID:-}" ]; then
  curl -sS --fail-with-body "$BASE/sessions" "${H[@]}" -o /tmp/sess.json -d '{
    "agent": "'$AGENT_ID'",
    "environment_id": "'$ENV_ID'",
    "title": "first run — утренний дайджест"
  }'
  SESSION_ID=$(pyget /tmp/sess.json "['id']")
  echo "SESSION_ID=$SESSION_ID" >> IDS.env
fi
echo "→ ▶️ session: $SESSION_ID"

# ── Шаг 4: kickoff (🎯 outcome) ────────────────────────────
if [ -z "${KICKOFF_SENT:-}" ]; then
  python3 - <<'PY'
import json
task = open('first_prompt.txt').read()
rubric = open('outcome.md').read()
evt = {"events": [{"type": "user.define_outcome", "description": task,
                   "rubric": {"type": "text", "content": rubric}, "max_iterations": 3}]}
json.dump(evt, open('/tmp/kickoff.json', 'w'), ensure_ascii=False)
PY
  curl -sS --fail-with-body "$BASE/sessions/$SESSION_ID/events" "${H[@]}" -d @/tmp/kickoff.json -o /tmp/kick.json
  echo "KICKOFF_SENT=1" >> IDS.env
fi
echo "→ 🎯 outcome отправлен, агент работает"
echo "Готово. Статус: bash poll.sh"
