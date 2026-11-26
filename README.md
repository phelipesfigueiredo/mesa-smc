# MESA SMC

Painel de trade de criptomoedas baseado em Smart Money Concepts (SMC), por Phelipe Figueiredo.

- Gráfico em tempo real (Binance) com order blocks, FVGs, liquidez, BOS/CHoCH, EMAs e VWAP
- Veredito em linguagem simples: comprar, vender ou esperar, com entrada, stop e 3 alvos
- Nota de confluência de 0 a 10 e cálculo de tamanho da posição pelo seu capital e risco
- Volume, CVD, funding, open interest e long/short (Binance Futures)
- Card do USDT/BRL em tempo real
- Notícias que movem o mercado (CoinDesk, Cointelegraph, Decrypt, The Block, Livecoins, Portal do Bitcoin)
- Envio de ordens limitadas com stop e take profit para a Bitget (demo ou real), manual ou automático
- Modo claro e noturno, modo Simples e Avançado

## Como rodar

Requer Node.js 18 ou mais recente.

```bash
cp .env.example .env   # preencha suas chaves da Bitget (opcional)
npm start
```

Abra http://localhost:8787.

Sem o servidor, dá para abrir o `index.html` direto no navegador, mas aí o app só analisa: as notícias por RSS e a Bitget não funcionam.

## Bitget

1. Na Bitget, ative o Demo Trading e crie uma API Key com permissão apenas de **Futures → Trade** (sem saque).
2. Preencha `BITGET_DEMO_KEY`, `BITGET_DEMO_SECRET` e `BITGET_DEMO_PASSPHRASE` no `.env`.
3. No app, clique em **Testar conexão**.

A conta real fica bloqueada até `ALLOW_LIVE=true` no `.env`. As chaves ficam só no seu computador e o `.env` nunca é enviado ao GitHub.

## Aviso

Os sinais são gerados por regras automáticas. A nota de confluência não é probabilidade e nada aqui é recomendação financeira. Teste na conta demo antes de usar dinheiro real.

## Versão online (Vercel)

O repositório publica na Vercel o painel (`index.html`) e as notícias (`api/news.js`).
Na versão online o envio de ordens para a Bitget fica **desligado** de propósito: as chaves
e o acompanhamento dos TPs parciais só rodam no servidor local (`npm start`).

### Senha da versão online

O `middleware.js` pede usuário e senha antes de abrir o site na Vercel.
Configure em **Vercel → projeto mesa-smc → Settings → Environment Variables**:

- `APP_PASSWORD`: a senha (obrigatória; sem ela o site fica bloqueado)
- `APP_USER`: o usuário (opcional, padrão `mesa`)

Depois de salvar, faça um novo deploy (Deployments → ⋯ → Redeploy) para valer.

## Deixar sempre ligado no Mac

```bash
npm run instalar     # liga agora e sempre que você entrar no Mac; reinicia sozinho se cair
npm run reiniciar    # depois de git pull ou de mudar o .env
npm run log          # ver o que o servidor está fazendo
npm run atualizar    # força a atualização agora (ela também roda sozinha a cada 30 s)
npm run desinstalar  # desliga e remove
```

## Diário, travas e planilha

- O servidor lê as operações fechadas na Bitget (demo e real) a cada 2 minutos e monta o diário (`journal.json`, só no seu Mac).
- Travas (no `.env`): `TRAVA_PERDA_DIA=2`, `TRAVA_PERDA_SEMANA=5`, `TRAVA_RISCO_ABERTO=3`, `TRAVA_STOPS_SEGUIDOS=3`, `TRAVA_PAUSA_MIN=120`.
  Com uma trava ativa, o servidor recusa novas ordens (manual e automático). Fechar posições continua liberado.
- Google Sheets: crie uma planilha, abra Extensões → Apps Script, cole `sheets/apps-script.gs`, troque o segredo,
  implante como App da Web (executar como você, acesso: qualquer pessoa) e coloque a URL e o segredo em
  `SHEETS_WEBHOOK_URL` e `SHEETS_SECRET` no `.env`.
