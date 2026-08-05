/**
 * Validatore strutturale OOXML/OMML.
 *
 * Perché esiste: i difetti di questo esportatore si sono ripetuti tre volte
 * con la stessa dinamica — un documento che LibreOffice mostra correttamente
 * ma che Word rifiuta in parte, scartando **silenziosamente** i paragrafi
 * malformati. Nessuno strumento a disposizione (LibreOffice, `python-docx`)
 * applica i vincoli dello schema alla matematica.
 *
 * Questo modulo li applica esplicitamente. Non sostituisce l'XSD ufficiale,
 * ma codifica i vincoli che hanno realmente causato perdita di contenuto,
 * così che una regressione fallisca nei test invece di arrivare all'utente.
 *
 * Riferimento: ECMA-376 Part 1, §17.3 (paragrafi) e §22.1 (OMML).
 * @module tests/helpers/ooxml-validator
 */

/**
 * Figli obbligatori, nell'ordine imposto dallo schema.
 * @type {Record<string, string[]>}
 */
const REQUIRED_CHILDREN = Object.freeze({
  'm:nary': ['m:naryPr', 'm:sub', 'm:sup', 'm:e'],
  'm:f': ['m:fPr', 'm:num', 'm:den'],
  'm:rad': ['m:radPr', 'm:deg', 'm:e'],
  'm:sSub': ['m:e', 'm:sub'],
  'm:sSup': ['m:e', 'm:sup'],
  'm:sSubSup': ['m:e', 'm:sub', 'm:sup'],
  'm:limLow': ['m:e', 'm:lim'],
  'm:limUpp': ['m:e', 'm:lim'],
  'm:acc': ['m:e'],
  'm:bar': ['m:e'],
  'm:groupChr': ['m:e'],
  'm:d': ['m:e'],
  'm:eqArr': ['m:e'],
  'm:m': ['m:mr'],
  'm:mr': ['m:e'],
});

/** Elementi che devono contenere almeno un run o un altro elemento. */
const MUST_NOT_BE_EMPTY = new Set(['m:e', 'm:sub', 'm:sup', 'm:deg', 'm:num', 'm:den', 'm:lim']);

/**
 * Verifica un frammento OMML.
 *
 * @param {string} xml Frammento contenente uno o più `<m:oMath>`.
 * @returns {string[]} Elenco delle violazioni; vuoto se conforme.
 */
export function validateOmml(xml) {
  const errors = [];
  const document = parseFragment(xml, errors);
  if (!document) return errors;

  walk(document.documentElement, errors);
  return errors;
}

/**
 * Verifica il documento principale di un `.docx`.
 *
 * Oltre ai vincoli OMML controlla la regola che ha causato la perdita di
 * intere sezioni: un `<m:oMath>` non può essere l'unico figlio di `<w:p>`.
 *
 * @param {string} documentXml Contenuto di `word/document.xml`.
 * @returns {string[]} Elenco delle violazioni.
 */
export function validateDocumentXml(documentXml) {
  const errors = [];
  const document = parseFragment(documentXml, errors);
  if (!document) return errors;

  walk(document.documentElement, errors);
  checkParagraphs(document, errors);
  return errors;
}

/**
 * @param {Document} document
 * @param {string[]} errors
 */
function checkParagraphs(document, errors) {
  const paragraphs = document.getElementsByTagName('w:p');

  for (const paragraph of Array.from(paragraphs)) {
    const children = Array.from(paragraph.children).map((child) => child.tagName);
    const hasBareMath = children.includes('m:oMath');
    if (!hasBareMath) continue;

    // Un oMath è accettabile solo in flusso inline, cioè accanto a dei run.
    // Da solo va avvolto in m:oMathPara, forma canonica per la matematica
    // che occupa un paragrafo intero.
    const hasRuns = children.includes('w:r') || children.includes('w:hyperlink');
    if (!hasRuns) {
      errors.push('w:p: <m:oMath> è l\u2019unico contenuto, serve <m:oMathPara>');
    }
  }
}

/**
 * @param {Element} element
 * @param {string[]} errors
 */
function walk(element, errors) {
  for (const child of Array.from(element.children)) {
    const tag = child.tagName;
    const required = REQUIRED_CHILDREN[tag];

    if (required) {
      const childTags = Array.from(child.children).map((node) => node.tagName);

      for (const name of required) {
        if (!childTags.includes(name)) errors.push(`${tag}: manca <${name}>`);
      }

      const positions = childTags
        .filter((name) => required.includes(name))
        .map((name) => required.indexOf(name));

      if (positions.some((value, index) => index > 0 && value < positions[index - 1])) {
        errors.push(`${tag}: figli in ordine errato [${childTags.join(', ')}]`);
      }
    }

    if (
      MUST_NOT_BE_EMPTY.has(tag) &&
      child.children.length === 0 &&
      (child.textContent ?? '') === ''
    ) {
      errors.push(`${tag}: elemento vuoto`);
    }

    walk(child, errors);
  }
}

/**
 * @param {string} xml
 * @param {string[]} errors
 * @returns {Document|null}
 */
function parseFragment(xml, errors) {
  const namespaces =
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';

  // Un frammento va racchiuso in una radice che dichiari i namespace.
  const source = xml.trimStart().startsWith('<?xml')
    ? xml
    : `<gex-root ${namespaces}>${xml}</gex-root>`;

  const document = new DOMParser().parseFromString(source, 'text/xml');

  if (document.querySelector('parsererror')) {
    errors.push('XML non valido');
    return null;
  }
  return document;
}
