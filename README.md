# MESA SMC

Painel de trade de criptomoedas baseado em Smart Money Concepts (SMC), por Phelipe Figueiredo.

- Gráfico em tempo real (Binance) com order blocks, FVGs, liquidez, BOS/CHoCH, EMAs e VWAP
- Veredito em linguagem simples: comprar, vender ou esperar, com entrada, stop e 3 alvos
- Nota de confluência de 0 a 10 e cálculo de tamanho da posição pelo seu capital e risco
- Volume, CVD, funding, open interest e long/short (Binance Futures)
- Card do USDT/BRL em tempo real
- Notícias que movem o mercado (CoinDesk, Cointelegraph, Decrypt, The Block, Livecoins, Portal do Bitcoin, InfoMoney)
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
