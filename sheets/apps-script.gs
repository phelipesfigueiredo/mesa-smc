/**
 * Mesa SMC → Google Sheets
 * Recebe as operações fechadas do servidor do Mesa SMC e grava na aba "Operações".
 * Cada operação tem um "id" único: se ela chegar de novo (ex.: atualização), a linha é atualizada, não duplicada.
 *
 * Como usar: Extensões → Apps Script → cole este código → troque o SEGREDO abaixo →
 * Implantar → Nova implantação → Tipo: App da Web → Executar como: Eu → Quem pode acessar: Qualquer pessoa → Implantar.
 * Copie a URL do app da Web para SHEETS_WEBHOOK_URL no .env e o mesmo segredo para SHEETS_SECRET.
 */
const SEGREDO = 'troque-por-uma-senha-sua';
const ABA = 'Operações';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!SEGREDO || body.secret !== SEGREDO) return out({ ok: false, error: 'segredo inválido' });
    const cols = body.columns, rows = body.rows || [];
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(ABA) || ss.insertSheet(ABA);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      if (sh.getLastRow() === 0) { sh.appendRow(cols); sh.setFrozenRows(1); sh.getRange(1, 1, 1, cols.length).setFontWeight('bold'); }
      const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => String(r[0])) : [];
      const novas = [];
      rows.forEach(r => {
        const i = ids.indexOf(String(r[0]));
        if (i >= 0) sh.getRange(i + 2, 1, 1, r.length).setValues([r]);
        else novas.push(r);
      });
      if (novas.length) sh.getRange(sh.getLastRow() + 1, 1, novas.length, cols.length).setValues(novas);
    } finally { lock.releaseLock(); }
    return out({ ok: true, recebidas: rows.length });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}
function doGet() { return out({ ok: true, info: 'Mesa SMC: use POST' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
