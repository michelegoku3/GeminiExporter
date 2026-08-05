/**
 * Primitive di costruzione degli elementi OMML.
 *
 * Raccoglie le poche operazioni di basso livello — creare un run, riempire uno
 * slot, unire run adiacenti — da cui dipende la validità del documento agli
 * occhi di Word. Sono separate dalla logica di conversione perché rispondono a
 * una domanda diversa: non «come si traduce questa formula», ma «come si scrive
 * un frammento OMML che Word accetti».
 *
 * Ogni regola qui codificata nasce da un difetto osservato in produzione; i
 * riferimenti puntano alla relativa analisi.
 * @module export/docx/latex/omml-primitives
 */

/**
 * Dichiarazione del font matematico, obbligatoria su ogni run.
 *
 * Cambria Math contiene le tabelle OpenType MATH da cui Word ricava le
 * metriche di radici, delimitatori e frazioni. Senza questa dichiarazione Word
 * non può calcolare l'altezza dell'equazione durante l'impaginazione iniziale:
 * mostra il segnaposto «EQUAZIONE» e rimanda il calcolo, riflowando il
 * documento e spingendo il testo fuori pagina.
 *
 * Definita una volta sola: è già accaduto che copie duplicate divergessero.
 * Vedi docs/BUGFIX-DOCX-EQUAZIONE-REFLOW.md.
 */
export const MATH_FONT_PR =
  '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/></w:rPr>';

/**
 * Costruisce un run matematico. Il testo deve essere già sottoposto a escaping.
 *
 * @param {string} escapedText
 * @param {string} [mathProperties] Proprietà `<m:rPr>` già serializzate.
 * @returns {string}
 */
export function mathRun(escapedText, mathProperties = '') {
  return `<m:r>${mathProperties}${MATH_FONT_PR}<m:t xml:space="preserve">${escapedText}</m:t></m:r>`;
}

/**
 * Contenuto minimo di un elemento OMML che non può restare vuoto.
 *
 * Si usa uno spazio normale e non uno spazio a larghezza nulla (U+200B):
 * quest'ultimo non appartiene ai font matematici e alcuni motori di stampa lo
 * rendono come glifo mancante.
 */
export const EMPTY_SLOT = mathRun(' ');

/**
 * Costruisce un elemento contenitore garantendone il contenuto.
 *
 * Word applica lo schema in modo rigoroso: un `<m:sub>`, `<m:sup>`, `<m:deg>`
 * o `<m:e>` vuoto rende non valido l'intero blocco matematico, e Word **scarta
 * silenziosamente il paragrafo** che lo ospita — LibreOffice invece lo tollera,
 * quindi il difetto non emerge dalle conversioni di controllo.
 *
 * Tutti gli slot passano da qui: ricordarsi di riempirli caso per caso si è
 * dimostrato fragile, avendo lasciato passare tre difetti distinti.
 * Vedi docs/BUGFIX-DOCX-CONTENUTO-MANCANTE.md.
 *
 * @param {string} tag Nome dell'elemento, es. `m:num`.
 * @param {string} content XML del contenuto, eventualmente vuoto.
 * @returns {string}
 */
export function slot(tag, content) {
  return `<${tag}>${fillSlot(content)}</${tag}>`;
}

/**
 * Sostituisce un contenuto vuoto con lo slot minimo.
 * @param {string} xml
 * @returns {string}
 */
export function fillSlot(xml) {
  return xml === '' ? EMPTY_SLOT : xml;
}

/**
 * Unisce i run di testo adiacenti privi di proprietà matematiche.
 *
 * Emettere un run per carattere induce Word a trattare le parentesi isolate
 * come delimitatori, ingrandendole fino all'altezza dell'espressione. Un
 * singolo run contenente `f(x, y)` viene invece reso come testo normale.
 *
 * @param {string} xml
 * @returns {string}
 */
export function mergeAdjacentRuns(xml) {
  // Corrisponde ai run prodotti da mathRun senza proprietà matematiche: la
  // dichiarazione del font è identica per tutti, quindi due run adiacenti di
  // questo tipo sono fondibili senza perdita di informazione.
  const plainRun = new RegExp(
    `<m:r>${escapeRegExp(MATH_FONT_PR)}<m:t xml:space="preserve">([^<]*)</m:t></m:r>`,
    'g'
  );

  return xml.replace(new RegExp(`(?:${plainRun.source}){2,}`, 'g'), (sequence) => {
    // I testi sono già stati sottoposti a escaping alla costruzione dei run:
    // vanno concatenati così come sono, senza rielaborarli.
    const escapedText = [...sequence.matchAll(plainRun)].map((match) => match[1]).join('');
    return mathRun(escapedText);
  });
}

/**
 * @param {string} text
 * @returns {string} Testo utilizzabile come letterale in un'espressione regolare.
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
