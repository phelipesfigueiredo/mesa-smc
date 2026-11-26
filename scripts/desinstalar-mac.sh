#!/bin/bash
# Desliga o Mesa SMC e remove a inicialização automática.
LABEL="com.mesasmc.server"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Mesa SMC desligado e removido da inicialização."
