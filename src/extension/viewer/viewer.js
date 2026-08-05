/**
 * Pagina di visualizzazione del documento esportato.
 *
 * PERCHÉ ESISTE (causa del difetto documentato in docs/BUGFIX-CSP-BLOB.md)
 * -----------------------------------------------------------------------
 * In precedenza il documento veniva aperto come `blob:` creato dal content
 * script. Una pagina `blob:` **eredita la Content Security Policy del documento
 * che l'ha generata**, cioè quella di gemini.google.com, che impone:
 *
 *   font-src https://fonts.gstatic.com …   (nessun `data:`)
 *   script-src … 'nonce-…' 'strict-dynamic'
 *
 * Conseguenze osservate nella console dell'utente:
 *   - «Loading the font '<URL>' violates … font-src» ripetuto 20 volte
 *     ⇒ tutti i font KaTeX incorporati come data URI venivano bloccati,
 *       e con essi i delimitatori grandi e i simboli della Private Use Area;
 *   - «Executing inline script violates … script-src»
 *     ⇒ persino l'auto-diagnosi che doveva segnalare il problema era bloccata.
 *
 * Una pagina servita da `chrome-extension://` ha invece la propria CSP,
 * dichiarata nel manifest, e non eredita nulla dalla pagina ospite. È l'unico
 * modo per garantire che il documento si comporti sempre allo stesso modo,
 * indipendentemente dalle policy che Google potrà adottare in futuro.
 *
 * Il documento viaggia tramite `chrome.storage.local` invece che nell'URL,
 * perché supera abbondantemente il limite pratico di lunghezza di una query
 * string (≈600 KB con i font incorporati).
 * @module extension/viewer/viewer
 */

import { applyDocumentBehaviour } from '../../render/document-behaviour.js';

const api = globalThis.browser ?? globalThis.chrome;

/** Prefisso delle chiavi temporanee usate per il passaggio del documento. */
const DOCUMENT_KEY_PREFIX = 'gex.document.';

/**
 * Sostituisce l'intero documento corrente con l'HTML esportato.
 *
 * `document.write` è deliberato: è l'unico modo per rimpiazzare un documento
 * completo — inclusi `<head>`, `<style>` e `@font-face` — mantenendo l'origine
 * `chrome-extension://` e quindi la CSP permissiva della pagina.
 * @param {string} html
 */
function replaceDocument(html) {
  document.open();
  document.write(html);
  document.close();

  // Il documento non contiene script inline (li vieta la CSP delle pagine
  // dell'estensione): il comportamento va applicato da qui, dopo la scrittura.
  applyDocumentBehaviour();
}

/** @param {string} message */
function showError(message) {
  const status = document.getElementById('status');
  if (status) status.textContent = message;
}

async function main() {
  const key = new URLSearchParams(location.search).get('doc');

  if (!key) {
    showError('Documento non specificato.');
    return;
  }

  const storageKey = DOCUMENT_KEY_PREFIX + key;

  try {
    const stored = await api.storage.local.get(storageKey);
    const html = stored?.[storageKey];

    if (!html) {
      showError('Documento non trovato o già chiuso. Ripeti l\u2019esportazione.');
      return;
    }

    // Il documento è consegnato: liberiamo subito lo spazio, che è prezioso
    // (ogni export pesa alcune centinaia di KB).
    await api.storage.local.remove(storageKey);

    replaceDocument(html);
  } catch (error) {
    showError(`Impossibile aprire il documento: ${error.message}`);
  }
}

main();
