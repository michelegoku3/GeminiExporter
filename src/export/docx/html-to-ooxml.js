/**
 * Conversione da HTML sanificato a WordprocessingML.
 *
 * Il documento Word non è una pagina web: non esistono elementi annidati
 * liberamente, ma una sequenza piatta di paragrafi e tabelle. La conversione
 * percorre quindi l'albero HTML e lo "appiattisce", trasportando la
 * formattazione inline (grassetto, corsivo, codice) negli attributi delle
 * singole porzioni di testo (i *run*).
 *
 * Le formule matematiche vengono rese come testo LaTeX in stile corsivo: Word
 * userebbe OMML, un formato completamente diverso, e la conversione fedele
 * richiederebbe un traduttore LaTeX→OMML che non giustifica la complessità.
 * Il sorgente LaTeX resta comunque leggibile e ricopiabile.
 * @module export/docx/html-to-ooxml
 */

import { escapeXml, TABLE_BORDERS_XML } from './ooxml.js';
import { isBlockLevel, isMathBlock, isMathInline, extractMathText } from './html-nodes.js';
import { buildDrawing } from './images.js';
import { latexToOmml, asMathParagraph } from './latex/omml.js';

/** Corrispondenza fra intestazioni HTML e stili Word. */
const HEADING_STYLES = Object.freeze({
  H1: 'Heading1',
  H2: 'Heading2',
  H3: 'Heading3',
  H4: 'Heading4',
  H5: 'Heading5',
  H6: 'Heading6',
});

/** numId definiti in numbering.xml. */
const NUMBERING = Object.freeze({ bullet: 1, ordered: 2 });

/** Profondità massima di annidamento delle liste supportata dagli stili. */
const MAX_LIST_LEVEL = 3;

/**
 * Frammento accumulato in un paragrafo: testo formattato oppure una formula
 * già serializzata in OMML.
 * @typedef {object} ParagraphPart
 * @property {string} [text] Testo, per i frammenti testuali.
 * @property {RunFormat} [format] Formattazione del testo.
 * @property {string} [omml] XML della formula, per i frammenti matematici.
 */

/**
 * Stato della conversione lungo la discesa nell'albero.
 * @typedef {object} ConversionContext
 * @property {RunFormat} format Formattazione ereditata.
 * @property {number} listLevel Profondità di annidamento delle liste, -1 fuori.
 * @property {number|null} numId Identificatore di numerazione, null fuori.
 * @property {string} [blockStyle] Stile di paragrafo da applicare.
 * @property {import('./images.js').ImageCollector|null} [images] Raccolta delle
 *   immagini del documento; assente quando il formato non le supporta.
 */

/**
 * Formattazione attiva su una porzione di testo.
 * @typedef {object} RunFormat
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [underline]
 * @property {boolean} [strike]
 * @property {boolean} [code]
 * @property {boolean} [superscript]
 * @property {boolean} [subscript]
 * @property {boolean} [link]
 */

/**
 * Converte un frammento HTML in una sequenza di blocchi WordprocessingML.
 *
 * @param {Element} root Elemento contenitore già sanificato.
 * @param {object} [options]
 * @param {import('./images.js').ImageCollector|null} [options.images] Raccolta
 *   delle immagini del documento. In sua assenza le immagini vengono ignorate:
 *   OOXML non ammette immagini incorporate nel markup, servono parti separate.
 * @returns {string} XML dei blocchi, da inserire in `<w:body>`.
 */
export function convertHtmlToOoxml(root, { images = null } = {}) {
  const blocks = [];
  convertChildren(root, blocks, { format: {}, listLevel: -1, numId: null, images });
  return blocks.join('\n');
}

/**
 * @param {Element} element
 * @param {string[]} blocks Accumulatore dei blocchi prodotti.
 * @param {ConversionContext} context
 */
function convertChildren(element, blocks, context) {
  /** @type {Array<{ text: string, format: RunFormat }>} */
  let pendingRuns = [];

  /** Chiude i run accumulati in un paragrafo. */
  const flush = () => {
    if (pendingRuns.length === 0) return;
    const paragraph = buildParagraph(pendingRuns, context);
    if (paragraph) blocks.push(paragraph);
    pendingRuns = [];
  };

  for (const node of /** @type {Element[]} */ (Array.from(element.childNodes))) {
    if (node.nodeType === 3) {
      // Nodo di testo: gli spazi multipli non hanno significato in Word.
      const text = node.nodeValue.replace(/\s+/g, ' ');
      if (text.trim() !== '' || pendingRuns.length > 0) {
        pendingRuns.push({ text, format: context.format });
      }
      continue;
    }

    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toUpperCase();

    if (isBlockLevel(tag) || tag === 'IMG') {
      // Un'immagine occupa sempre un paragrafo proprio: in un documento Word
      // non esiste il concetto di immagine inline nel flusso del testo.
      flush();
      convertBlock(node, tag, blocks, context);
      continue;
    }

    // Elemento inline: accumula i run figli con la formattazione arricchita.
    collectInlineRuns(node, pendingRuns, mergeFormat(context.format, tag));
  }

  flush();
}

/**
 * @param {Element} node
 * @param {string} tag
 * @param {string[]} blocks
 * @param {ConversionContext} context
 */
function convertBlock(node, tag, blocks, context) {
  if (tag === 'PRE') {
    blocks.push(buildCodeBlock(node));
    return;
  }

  if (tag === 'TABLE') {
    blocks.push(buildTable(node));
    return;
  }

  if (tag === 'HR') {
    blocks.push(buildHorizontalRule());
    return;
  }

  if (tag === 'UL' || tag === 'OL') {
    const numId = tag === 'UL' ? NUMBERING.bullet : NUMBERING.ordered;
    const level = Math.min(context.listLevel + 1, MAX_LIST_LEVEL);
    convertChildren(node, blocks, { ...context, listLevel: level, numId });
    return;
  }

  if (tag === 'LI') {
    // Una voce può contenere testo diretto e sottoliste: entrambi vanno
    // gestiti dal percorso normale, che sa già distinguerli.
    convertChildren(node, blocks, context);
    return;
  }

  if (isMathBlock(node)) {
    blocks.push(buildFormulaParagraph(node));
    return;
  }

  if (tag === 'IMG') {
    const paragraph = buildImageParagraph(node, context);
    if (paragraph) blocks.push(paragraph);
    return;
  }

  const style = HEADING_STYLES[tag] ?? styleForBlock(tag, context);
  convertChildren(node, blocks, { ...context, blockStyle: style });
}

/**
 * Raccoglie ricorsivamente i run di un elemento inline.
 * @param {Element} element
 * @param {ParagraphPart[]} runs
 * @param {RunFormat} format
 */
function collectInlineRuns(element, runs, format) {
  if (isMathInline(element)) {
    // Le formule diventano OMML, il formato matematico nativo di Word:
    // restano modificabili con l'editor delle equazioni.
    runs.push({ omml: latexToOmml(extractMathText(element)) });
    return;
  }

  if (element.tagName === 'BR') {
    runs.push({ text: '\n', format });
    return;
  }

  for (const node of /** @type {Element[]} */ (Array.from(element.childNodes))) {
    if (node.nodeType === 3) {
      runs.push({ text: node.nodeValue.replace(/\s+/g, ' '), format });
      continue;
    }
    if (node.nodeType !== 1) continue;

    const tag = node.tagName.toUpperCase();
    if (isBlockLevel(tag)) {
      // Un blocco dentro un inline è markup irregolare: se ne recupera il testo.
      runs.push({ text: node.textContent.replace(/\s+/g, ' '), format });
      continue;
    }
    collectInlineRuns(node, runs, mergeFormat(format, tag));
  }
}

/**
 * @param {ParagraphPart[]} runs
 * @param {ConversionContext} context
 * @returns {string} XML del paragrafo, stringa vuota se privo di contenuto.
 */
function buildParagraph(runs, context) {
  const meaningful = runs.filter((run) => run.omml !== undefined || run.text !== '');
  if (meaningful.length === 0) return '';
  // Un paragrafo di soli spazi non porta contenuto, ma uno con una formula sì.
  if (meaningful.every((run) => run.omml === undefined && run.text.trim() === '')) return '';

  const properties = buildParagraphProperties(context);

  // Un <m:oMath> non può essere l'unico figlio di <w:p>: Word considera il
  // paragrafo malformato e lo scarta. La forma canonica per la matematica che
  // occupa un paragrafo intero è <m:oMathPara>. Accade quando una formula
  // "inline" è di fatto l'unico contenuto della riga.
  const isOnlyMath = meaningful.length === 1 && meaningful[0].omml !== undefined;
  if (isOnlyMath) {
    return `<w:p>${properties}${asMathParagraph(meaningful[0].omml)}</w:p>`;
  }

  const body = meaningful
    .map((run) => (run.omml !== undefined ? run.omml : buildRun(run.text, run.format)))
    .join('');

  return `<w:p>${properties}${body}</w:p>`;
}

/**
 * @param {ConversionContext} context
 * @returns {string}
 */
function buildParagraphProperties(context) {
  const parts = [];

  if (context.blockStyle) parts.push(`<w:pStyle w:val="${context.blockStyle}"/>`);

  if (context.numId !== null && context.listLevel >= 0) {
    parts.push(
      `<w:numPr><w:ilvl w:val="${context.listLevel}"/><w:numId w:val="${context.numId}"/></w:numPr>`
    );
  }

  return parts.length > 0 ? `<w:pPr>${parts.join('')}</w:pPr>` : '';
}

/**
 * Costruisce un run, gestendo le interruzioni di riga interne.
 * @param {string} text
 * @param {RunFormat} format
 * @returns {string}
 */
function buildRun(text, format) {
  const properties = buildRunProperties(format);

  // `xml:space="preserve"` impedisce a Word di eliminare gli spazi ai bordi.
  const content = text
    .split('\n')
    .map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`)
    .join('<w:br/>');

  return `<w:r>${properties}${content}</w:r>`;
}

/**
 * @param {RunFormat} format
 * @returns {string}
 */
function buildRunProperties(format) {
  const parts = [];

  if (format.code) parts.push('<w:rStyle w:val="InlineCode"/>');
  if (format.link) parts.push('<w:rStyle w:val="Hyperlink"/>');
  if (format.bold) parts.push('<w:b/>');
  if (format.italic) parts.push('<w:i/>');
  if (format.underline) parts.push('<w:u w:val="single"/>');
  if (format.strike) parts.push('<w:strike/>');
  if (format.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
  if (format.subscript) parts.push('<w:vertAlign w:val="subscript"/>');

  return parts.length > 0 ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

/**
 * Un blocco di codice diventa una sequenza di paragrafi monospaziati, uno per
 * riga: Word non ha un equivalente del `<pre>` e le righe vanno separate.
 * @param {Element} node
 * @returns {string}
 */
function buildCodeBlock(node) {
  const lines = (node.textContent ?? '').replace(/\n+$/, '').split('\n');

  return lines
    .map((line) => {
      const run = `<w:r><w:t xml:space="preserve">${escapeXml(line || ' ')}</w:t></w:r>`;
      return `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr>${run}</w:p>`;
    })
    .join('');
}

/**
 * @param {Element} table
 * @returns {string}
 */
function buildTable(table) {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  const body = rows.map((row) => buildTableRow(row)).join('');

  // <w:tblGrid> è obbligatorio: senza di esso Word considera il documento
  // malformato. Le colonne si ricavano dalla riga più larga, tenendo conto
  // delle celle unite.
  const columnCount = Math.max(
    ...rows.map((row) =>
      Array.from(row.children)
        .filter((cell) => ['TD', 'TH'].includes(cell.tagName))
        .reduce((total, cell) => total + Number(cell.getAttribute('colspan') ?? 1), 0)
    )
  );
  // Larghezza totale di una pagina A4 con margini di 2 cm, in twip.
  const columnWidth = Math.floor(9638 / Math.max(columnCount, 1));
  const grid = `<w:tblGrid>${`<w:gridCol w:w="${columnWidth}"/>`.repeat(Math.max(columnCount, 1))}</w:tblGrid>`;

  return `<w:tbl>
  <w:tblPr>
    <w:tblStyle w:val="DataTable"/>
    <w:tblW w:w="5000" w:type="pct"/>
    ${TABLE_BORDERS_XML}
  </w:tblPr>
  ${grid}
  ${body}
</w:tbl>`;
}

/**
 * @param {Element} row
 * @returns {string}
 */
function buildTableRow(row) {
  const cells = Array.from(row.children).filter((cell) => ['TD', 'TH'].includes(cell.tagName));

  const content = cells
    .map((cell) => {
      const isHeader = cell.tagName === 'TH';
      const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
      const runProperties = isHeader ? '<w:rPr><w:b/></w:rPr>' : '';
      const shading = isHeader ? '<w:shd w:val="clear" w:fill="F1F3F4"/>' : '';
      const span = Number(cell.getAttribute('colspan') ?? 1);
      const gridSpan = span > 1 ? `<w:gridSpan w:val="${span}"/>` : '';

      return `<w:tc>
      <w:tcPr>${gridSpan}${shading}<w:vAlign w:val="top"/></w:tcPr>
      <w:p><w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>
    </w:tc>`;
    })
    .join('');

  return `<w:tr>${content}</w:tr>`;
}

/**
 * Inserisce un'immagine come paragrafo autonomo.
 *
 * @param {Element} node
 * @param {ConversionContext} context
 * @returns {string} Paragrafo, stringa vuota se l'immagine non è utilizzabile.
 */
function buildImageParagraph(node, context) {
  if (!context.images) return '';

  const source = node.getAttribute('src');
  // Solo i data URI sono utilizzabili: un URL remoto non sarebbe raggiungibile
  // dal documento. Le immagini sono incorporate a monte, in fase di estrazione.
  if (!source?.startsWith('data:')) return '';

  const registered = context.images.add(source);
  if (!registered) return '';

  imageCounter += 1;

  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="160" w:after="160"/></w:pPr>${buildDrawing(
    {
      ...registered,
      description: node.getAttribute('alt') ?? '',
      index: imageCounter,
    }
  )}</w:p>`;
}

/**
 * Progressivo delle immagini: Word richiede identificatori univoci per ogni
 * disegno all'interno del documento.
 */
let imageCounter = 0;

/** Azzera il progressivo. Da invocare all'inizio di ogni documento. */
export function resetImageCounter() {
  imageCounter = 0;
}

/** @returns {string} Paragrafo vuoto con bordo inferiore: separatore visivo. */
function buildHorizontalRule() {
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="DADCE0"/></w:pBdr></w:pPr></w:p>`;
}

/**
 * @param {Element} node
 * @returns {string}
 */
function buildFormulaParagraph(node) {
  const latex = extractMathText(node);
  if (latex === '') return '';

  return `<w:p><w:pPr><w:pStyle w:val="Formula"/></w:pPr>${latexToOmml(latex, { block: true })}</w:p>`;
}

/**
 * @param {string} tag
 * @param {ConversionContext} context
 * @returns {string|undefined}
 */
function styleForBlock(tag, context) {
  if (tag === 'BLOCKQUOTE') return 'Quote';
  // La didascalia va distinta dal corpo del testo: senza uno stile proprio
  // sembrerebbe una frase della risposta anziché l'etichetta di una figura.
  if (tag === 'FIGCAPTION') return 'Caption';
  // I contenitori generici non introducono uno stile proprio.
  return context.blockStyle;
}

/**
 * Arricchisce la formattazione in base al tag inline incontrato.
 * @param {RunFormat} format
 * @param {string} tag
 * @returns {RunFormat}
 */
function mergeFormat(format, tag) {
  switch (tag) {
    case 'STRONG':
    case 'B':
      return { ...format, bold: true };
    case 'EM':
    case 'I':
    case 'CITE':
    case 'VAR':
      return { ...format, italic: true };
    case 'U':
    case 'INS':
      return { ...format, underline: true };
    case 'S':
    case 'DEL':
      return { ...format, strike: true };
    case 'CODE':
    case 'KBD':
    case 'SAMP':
      return { ...format, code: true };
    case 'SUP':
      return { ...format, superscript: true };
    case 'SUB':
      return { ...format, subscript: true };
    case 'A':
      return { ...format, link: true };
    case 'MARK':
      return { ...format, bold: true };
    default:
      return format;
  }
}
