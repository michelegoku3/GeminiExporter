/**
 * Fixture che riproducono la struttura HTML di Gemini.
 *
 * Sono volutamente "sporche": contengono attributi Angular, elementi per screen
 * reader, toolbar dei blocchi di codice e citazioni, esattamente come il DOM
 * reale. Aggiornarle quando si osserva un cambiamento in produzione.
 */

/**
 * Avvolge il contenuto di una risposta in un turno completo di conversazione.
 * @param {object} params
 * @param {string} [params.responseHtml] Corpo della risposta.
 * @param {string} [params.userHtml] Corpo del messaggio utente.
 * @param {boolean} [params.complete] Se lo streaming è terminato.
 * @returns {string}
 */
export function conversationTurn({
  responseHtml = '<p>Risposta di prova.</p>',
  userHtml = '<div class="query-text-line">Ciao Gemini</div>',
  complete = true,
} = {}) {
  return `
<div class="conversation-container" _ngcontent-ng-c123>
  <user-query _ngcontent-ng-c123>
    <div class="query-content">
      <span class="screen-reader-user-query-label cdk-visually-hidden">Hai detto</span>
      <div class="query-text">${userHtml}</div>
    </div>
  </user-query>
  <model-response _ngcontent-ng-c456>
    <message-content class="model-response-text">
      <div class="markdown markdown-main-panel" dir="ltr">
        ${responseHtml}
      </div>
    </message-content>
    <message-actions>
      <div class="buttons-container-v2">
        <button aria-label="Buona risposta"></button>
        <button aria-label="Copia">Copia</button>
      </div>
    </message-actions>
    <div class="response-footer ${complete ? 'complete' : ''}">
      <sources-carousel-inline>Fonti</sources-carousel-inline>
    </div>
  </model-response>
</div>`;
}

/** Risposta con blocco di codice completo di toolbar e pulsante copia. */
export const RESPONSE_WITH_CODE = `
<p>Ecco il codice:</p>
<code-block>
  <div class="code-block">
    <div class="code-block-bar">
      <span class="code-block-decoration">Python</span>
      <button class="code-block-copy-button" aria-label="Copia codice">
        <svg viewBox="0 0 24 24"><path d="M1 1"/></svg>
      </button>
    </div>
    <pre class="code-container"><code class="language-python">def saluta():
    print("ciao")</code></pre>
  </div>
</code-block>`;

/** Risposta con formula KaTeX renderizzata (MathML + HTML visivo). */
export const RESPONSE_WITH_KATEX = `
<p>La formula è:</p>
<span class="katex" style="display:inline">
  <span class="katex-mathml">
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>
      <annotation encoding="application/x-tex">E = mc^2</annotation></semantics>
    </math>
  </span>
  <span class="katex-html" aria-hidden="true"><span class="base">E=mc²</span></span>
</span>`;

/** MathML orfano: capita quando Gemini cambia motore di rendering. */
export const RESPONSE_WITH_ORPHAN_MATHML = `
<p>Formula grezza:</p>
<math xmlns="http://www.w3.org/1998/Math/MathML">
  <semantics><mrow><mi>x</mi></mrow>
  <annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics>
</math>`;

/** Risposta con citazioni inline e footnote (rumore da rimuovere). */
export const RESPONSE_WITH_CITATIONS = `
<p>Il cielo è blu<sup><source-footnote>1</source-footnote></sup>.</p>
<div class="source-inline-chip-container"><source-inline-chip>wikipedia.org</source-inline-chip></div>
<p>Fine.</p>`;

/** Contenuto ostile: simula una prompt injection che fa emettere HTML pericoloso. */
export const MALICIOUS_RESPONSE = `
<p>Testo innocuo</p>
<img src="x" onerror="window.__pwned = true" alt="exploit">
<script>window.__pwned = true;<\/script>
<a href="javascript:alert(1)">clicca</a>
<iframe src="https://evil.example"></iframe>
<div style="background:url(javascript:alert(1))">stile</div>
<p onclick="steal()">paragrafo</p>`;

/** Messaggio utente con file allegati. */
export const USER_WITH_ATTACHMENTS = `
<div class="query-text-line">Analizza questi file</div>
<div data-test-id="uploaded-file">
  <span data-test-id="filename-label">bilancio</span>
  <span data-test-id="extension-label">PDF</span>
</div>
<div data-test-id="uploaded-file">
  <span data-test-id="filename-label">note</span>
  <span data-test-id="extension-label">TXT</span>
</div>`;

/** Variante con HTML cambiato: verifica la catena di fallback dei selettori. */
export function driftedTurn() {
  return `
<div class="conversation-container">
  <user-query><div class="query-text">Domanda dopo il redesign</div></user-query>
  <model-response>
    <message-content>
      <div class="markdown-v2-panel markdown">Risposta dopo il redesign</div>
    </message-content>
    <div class="response-footer complete"></div>
  </model-response>
</div>`;
}
