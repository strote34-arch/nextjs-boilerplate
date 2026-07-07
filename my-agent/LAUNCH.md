# Как запустить агента afisha-trailer-digest

Все команды выполняются из папки `my-agent/`.

| Шаг | Команда | Что делает |
|---|---|---|
| 0 | ключ уже в `.env` | `ANTHROPIC_API_KEY=...` (chmod 600, в .gitignore) |
| 1 | `bash launch.sh` | Создаёт 📦 environment → 🤖 agent → ▶️ session → отправляет 🎯 outcome. Возобновляемый: уже созданные объекты пропускает (читает `IDS.env`) |
| 2 | `bash poll.sh` | Статус запуска и вердикт грейдера |
| 3 | `bash fetch-outputs.sh` | Скачивает digest.html из выходных файлов сессии в `outputs/` |

Повторный запуск дайджеста вручную (новая сессия того же агента): удалите строки `SESSION_ID=` и `KICKOFF_SENT=` из `IDS.env` и снова `bash launch.sh`.

Console (веб-интерфейс, workspace вашего ключа):
https://platform.claude.com/workspaces/default/agents — если ключ живёт не в default-workspace, переключите его пикером вверху.

Деплой по расписанию (после того как первый прогон устроит): `bash deploy.sh` — каждый день 07:00 МСК.
