/**
 * Comportamento interattivo del documento esportato.
 *
 * UNICA SORGENTE, DUE MODI DI ESECUZIONE
 * --------------------------------------
 * Il documento può trovarsi in due contesti con regole diverse:
 *
 *  1. **Pagina dell'estensione** (`chrome-extension://…/viewer.html`), il caso
 *     normale. La CSP impone `script-src 'self'`: gli script inline e gli
 *     attributi `onclick` sono vietati. Qui la funzione viene importata come
 *     modulo e invocata direttamente da `viewer.js`.
 *
 *  2. **File HTML scaricato** o pagina `blob:`, usati come fallback. Non c'è
 *     alcun modulo da importare, quindi la stessa funzione viene serializzata
 *     con `toString()` dentro un `<script>` inline.
 *
 * Serializzare la funzione invece di duplicarne il codice garantisce che i due
 * percorsi non possano divergere nel tempo.
 *
 * Vincolo: il corpo della funzione deve essere autosufficiente — nessuna
 * variabile importata, nessuna chiusura sul modulo — perché nel caso 2 viene
 * eseguito fuori da questo contesto.
 * @module render/document-behaviour
 */

/**
 * Attiva il pulsante di stampa e verifica che i font matematici siano
 * realmente applicati.
 *
 * Nota tecnica sulla verifica: `document.fonts.check()` non è affidabile,
 * perché risponde true anche quando la famiglia richiesta non esiste ma il
 * browser sa ripiegare su un font generico. L'unico controllo attendibile è
 * misurare la larghezza di un glifo e confrontarla con quella del ripiego.
 */
export function applyDocumentBehaviour() {
  'use strict';

  const REQUIRED_FONTS = ['KaTeX_Main', 'KaTeX_Size4'];
  const PROBE_TEXT = '((((((';

  const printButton = document.getElementById('gex-print-button');
  if (printButton) {
    printButton.addEventListener('click', function () {
      window.print();
    });
  }

  function measure(fontStack) {
    const probe = document.createElement('span');
    probe.textContent = PROBE_TEXT;
    probe.style.cssText =
      'position:absolute;visibility:hidden;white-space:nowrap;' +
      'font-size:120px;font-family:' +
      fontStack;
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.parentNode.removeChild(probe);
    return width;
  }

  function isApplied(family) {
    // Se la misura con il font richiesto coincide con quella del ripiego,
    // significa che il font non è stato applicato.
    const fallback = measure('monospace');
    const candidate = measure('"' + family + '",monospace');
    return Math.abs(candidate - fallback) > 0.5;
  }

  function report(missing) {
    // Solo console: l'utente non può installare i font mancanti, e un riquadro
    // d'avviso in testa al documento resterebbe stampato in ogni copia.
    console.warn(
      '[Gemini Chat Exporter] Font matematici non applicati: ' +
        missing.join(', ') +
        '. Parentesi grandi, radici e graffe potrebbero apparire come rettangoli vuoti.'
    );
  }

  function check() {
    try {
      const missing = REQUIRED_FONTS.filter(function (family) {
        return !isApplied(family);
      });
      if (missing.length > 0) report(missing);
    } catch {
      // La diagnostica non deve mai impedire la stampa del documento.
    }
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(check).catch(check);
  } else {
    window.addEventListener('load', check);
  }
}

/**
 * Serializza il comportamento in un `<script>` inline.
 * Usato solo nei contesti senza moduli (file scaricato, blob).
 * @returns {string}
 */
export function renderInlineBehaviourScript() {
  return `<script>(${applyDocumentBehaviour.toString()})();</script>`;
}
