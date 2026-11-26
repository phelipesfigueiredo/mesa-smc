# Mesa SMC — instruções para o Claude

## Comandos de Terminal para o usuário
- O usuário usa Mac. Sempre que ele precisar rodar algo no Terminal, mande **um único comando completo**, pronto para copiar e colar,
  começando com `cd ~/Documents/mesa-smc && ...` e com os passos encadeados por `&&`.
- Comandos mais usados:
  - Atualizar e reiniciar tudo: `cd ~/Documents/mesa-smc && git pull && npm run instalar`
  - Ver log: `cd ~/Documents/mesa-smc && npm run log`
  - Reiniciar: `cd ~/Documents/mesa-smc && npm run reiniciar`

## Projeto
- `index.html`: o app (painel, motor SMC, alertas, card da Bitget). `server.js`: servidor local (Bitget, notícias, acompanhamento de TPs).
- `lib/news.js`: notícias por RSS (usado pelo servidor local e pela função da Vercel `api/news.js`).
- Versão online na Vercel (time MRS), protegida por senha (`middleware.js`, variável `APP_PASSWORD`). Na Vercel o envio de ordens fica desligado.
- O Mac do usuário se atualiza sozinho a cada 30 s a partir da branch `main` (scripts em `scripts/`).
- Responder em português. Nunca colocar chaves da Bitget no código ou no chat; elas ficam só no `.env` local.
