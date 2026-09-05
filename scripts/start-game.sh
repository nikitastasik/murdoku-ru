#!/bin/bash
# Поднимает локальный сервер с игрой и открывает её в браузере по умолчанию.
# Этот скрипт вызывает ярлык «Murdoku RU.app» (см. scripts/make-mac-launcher.sh),
# но его можно запустить и напрямую:  bash scripts/start-game.sh
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MURDOKU_PORT:-4173}"
URL="http://localhost:$PORT"
LOG="/tmp/murdoku-ru.log"

# Из Finder приложение стартует с урезанным PATH — node/npm из Homebrew туда не входят.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

fail() {
  osascript -e "display alert \"Murdoku RU\" message \"$1\"" >/dev/null 2>&1
  exit 1
}
is_up() { curl -sf -o /dev/null --max-time 1 "$URL"; }

# 1. Сервер уже работает — просто открываем новую вкладку.
if is_up; then
  open "$URL"
  exit 0
fi

cd "$PROJECT_DIR" || fail "Папка проекта не найдена: $PROJECT_DIR"
command -v npm >/dev/null 2>&1 || fail "Не найден Node.js. Установите его (brew install node) и попробуйте снова."

# 2. Зависимости и сборка — только если их нет или исходники новее сборки.
[ -d node_modules ] || npm install >>"$LOG" 2>&1 || fail "npm install не удался. Подробности: $LOG"
if [ ! -f dist/index.html ] || [ -n "$(find src levels index.html -newer dist/index.html -print -quit 2>/dev/null)" ]; then
  npm run build >>"$LOG" 2>&1 || fail "Сборка не удалась. Подробности: $LOG"
fi

# 3. Статический сервер в фоне (только localhost), ждём до 20 секунд ответа.
nohup npx vite preview --port "$PORT" --strictPort >>"$LOG" 2>&1 </dev/null &
for _ in $(seq 1 40); do
  is_up && break
  sleep 0.5
done

is_up || fail "Сервер не запустился. Подробности: $LOG"
open "$URL"
