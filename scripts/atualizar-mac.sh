#!/bin/bash
# Atualização automática: baixa a versão nova do GitHub (se houver) e reinicia o servidor.
# Só atualiza se não houver alterações locais nos arquivos do projeto (o .env não conta, ele é ignorado pelo git).
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
export GIT_TERMINAL_PROMPT=0
ts() { date "+%Y-%m-%d %H:%M:%S"; }
git fetch -q origin main 2>/dev/null || { echo "$(ts) atualização: não consegui falar com o GitHub (sem internet ou sem login salvo)"; exit 0; }
LOCAL=$(git rev-parse HEAD); REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "$(ts) atualização: há alterações locais nos arquivos, pulei para não sobrescrever"; exit 0; fi
if git pull -q --ff-only origin main; then
  echo "$(ts) atualizado para $(git log -1 --format='%h %s')"
  launchctl kickstart -k "gui/$(id -u)/com.mesasmc.server" && echo "$(ts) servidor reiniciado"
else
  echo "$(ts) atualização: git pull falhou"
fi
