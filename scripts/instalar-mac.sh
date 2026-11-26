#!/bin/bash
# Mantém o Mesa SMC sempre ligado no Mac: inicia ao entrar na conta e reinicia sozinho se cair.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"
LABEL="com.mesasmc.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/mesa-smc.log"

if [ -z "$NODE" ]; then echo "Node não encontrado. Instale em nodejs.org e rode de novo."; exit 1; fi
if [ ! -f "$DIR/.env" ]; then echo "Aviso: não achei o arquivo .env em $DIR (as chaves da Bitget). O app abre, mas não conecta na Bitget."; fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
OK=0; for i in $(seq 1 15); do sleep 1; if curl -s -o /dev/null -w "%{http_code}" http://localhost:8787 | grep -q 200; then OK=1; break; fi; done
if [ "$OK" = 1 ]; then
  echo "Pronto! O Mesa SMC está rodando em http://localhost:8787 e vai ligar sozinho sempre que você entrar no Mac."
else
  echo "O serviço foi instalado, mas ainda não respondeu. Veja o log: tail -n 30 $LOG"
fi
echo "Log: $LOG"
