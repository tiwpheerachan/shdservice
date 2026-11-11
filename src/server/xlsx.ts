import 'server-only';
import type { Writable } from 'node:stream';
import { Zip, ZipDeflate, strToU8 } from 'fflate';

export type XlsxCol = { key: string; header: string; width?: number; money?: boolean; num?: boolean };

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

// cellXfs index = the s="" of a cell: 1 header, 2 money, 3 count, 4 note, 5 date
const STYLES = `${HEAD}<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFB45309"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF9"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// characters XML 1.0 cannot carry (a pasted control character would make Excel "repair" the file); Excel reads
// _xHHHH_ as an escaped character, so a literal one is escaped (ECMA-376 ST_Xstring)
const esc = (v: unknown) =>
  String(v)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, '')
    .replace(/_x([0-9A-Fa-f]{4})_/g, '_x005F_x$1_')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const text = (ref: string, v: unknown, s = 0) =>
  `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(String(v).slice(0, 32767))}</t></is></c>`;
const number = (ref: string, n: number, s = 0) => `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${n}</v></c>`;

function cell(ref: string, c: XlsxCol, v: unknown) {
  if (c.money || c.num) {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? number(ref, n, c.money ? 2 : 3) : text(ref, v); // an odd stored value shows as it is
  }
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? number(ref, v) : text(ref, v);
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
  // Excel's serial day (1900 system), in Bangkok time like every date on screen
  if (v instanceof Date)
    return Number.isFinite(v.getTime()) ? number(ref, (v.getTime() + 7 * 3600_000) / 86_400_000 + 25569, 5) : '';
  return text(ref, v);
}

/**
 * One sheet as a streamed .xlsx into `out`: bold filled header, frozen and filtered; money / count columns
 * numeric with their format; `note` (if any) as a last orange row. Stops early when `out` is destroyed (the
 * client went away). Resolves once every byte is handed to `out` — not when the client has read it.
 */
export async function writeXlsx(
  out: Writable,
  o: { title: string; cols: XlsxCol[]; rows: Iterable<object>; note?: string },
) {
  const zip = new Zip((err, chunk, final) => {
    if (err) return void out.destroy(err);
    if (out.destroyed) return;
    out.write(chunk);
    if (final) out.end();
  });
  const part = (name: string, xml: string) => {
    const f = new ZipDeflate(name);
    zip.add(f);
    f.push(strToU8(xml), true);
  };
  if (!o.cols.length) throw new Error('writeXlsx: no columns');
  // Excel refuses \ / ? * : [ ], more than 31 characters, a leading or trailing ' and the name History
  const name = o.title
    .replace(/[\\/?*:[\]]/g, '-')
    .slice(0, 31)
    .replace(/^'+|'+$/g, '');
  const sheet = !name ? 'Sheet1' : name.toLowerCase() === 'history' ? 'History-' : name;
  const last = colName(o.cols.length - 1);
  part(
    '[Content_Types].xml',
    `${HEAD}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${TYPE}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${TYPE}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${TYPE}.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  part(
    '_rels/.rels',
    `${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${PKG}/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  part(
    'docProps/core.xml',
    `${HEAD}<cp:coreProperties xmlns:cp="${PKG}/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>OneService</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
  );
  part(
    'xl/workbook.xml',
    `${HEAD}<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${esc(sheet.replace(/'/g, "''"))}'!$A$1:$${last}$1</definedName></definedNames></workbook>`,
  );
  part(
    'xl/_rels/workbook.xml.rels',
    `${HEAD}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  );
  part('xl/styles.xml', STYLES);

  const ws = new ZipDeflate('xl/worksheets/sheet1.xml');
  zip.add(ws);
  const letters = o.cols.map((_, i) => colName(i));
  const widths = o.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`);
  let xml = `${HEAD}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.join('')}</cols><sheetData><row r="1">${o.cols.map((c, i) => text(`${letters[i]}1`, c.header, 1)).join('')}</row>`;
  let r = 1;
  for (const row of o.rows) {
    if (out.destroyed) return;
    r++;
    xml += `<row r="${r}">${o.cols.map((c, i) => cell(`${letters[i]}${r}`, c, (row as Record<string, unknown>)[c.key])).join('')}</row>`;
    if (xml.length > 1 << 16) {
      ws.push(strToU8(xml));
      xml = '';
    }
    // let the response drain and other requests run, or every row waits in memory until the loop ends
    if (r % 500 === 0) await new Promise(setImmediate);
  }
  if (o.note) xml += `<row r="${++r}">${text(`A${r}`, o.note, 4)}</row>`;
  ws.push(strToU8(`${xml}</sheetData><autoFilter ref="A1:${last}1"/></worksheet>`), true);
  zip.end();
}
