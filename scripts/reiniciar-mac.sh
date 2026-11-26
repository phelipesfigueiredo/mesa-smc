#!/bin/bash
# Reinicia o Mesa SMC (use depois de git pull ou de mudar o .env).
launchctl kickstart -k "gui/$(id -u)/com.mesasmc.server" && echo "Mesa SMC reiniciado."
