// Na Vercel o envio de ordens fica desligado de propósito: as chaves da Bitget e o acompanhamento
// dos TPs parciais só rodam no servidor local (npm start), no seu computador.
module.exports = (req, res) => {
  res.status(403).json({ error: 'Operar na Bitget só funciona no app local (npm start, http://localhost:8787). Na versão online o app só analisa.' });
};
