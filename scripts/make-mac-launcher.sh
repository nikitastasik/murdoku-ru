#!/bin/bash
# Создаёт ярлык «Murdoku RU.app» в ~/Applications: двойной клик — и игра
# открывается новой вкладкой в браузере по умолчанию. Достаточно запустить один раз:
#   bash scripts/make-mac-launcher.sh            # или своё имя: … "Мурдоку"
set -eu

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${1:-Murdoku RU}"
APP_DIR="$HOME/Applications/$APP_NAME.app"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# LSUIElement: ярлык только открывает браузер и завершается — иконка в Dock не нужна.
cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleIdentifier</key><string>local.murdoku.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$APP_DIR/Contents/MacOS/launch" <<LAUNCH
#!/bin/bash
exec "$PROJECT_DIR/scripts/start-game.sh"
LAUNCH
chmod +x "$APP_DIR/Contents/MacOS/launch" "$PROJECT_DIR/scripts/start-game.sh"

# Иконка приложения из assets/icon-only.png (если есть).
ICON_SRC="$PROJECT_DIR/assets/icon-only.png"
if [ -f "$ICON_SRC" ] && command -v iconutil >/dev/null 2>&1; then
  ICONSET="$(mktemp -d)/icon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z "$((size * 2))" "$((size * 2))" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP_DIR/Contents/Resources/icon.icns"
  rm -rf "$(dirname "$ICONSET")"
fi

touch "$APP_DIR" # обновить иконку в Finder
echo "Готово: $APP_DIR"
echo "Открыть папку:  open ~/Applications"
