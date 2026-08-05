/**
 * Test del sanitizer: è la difesa contro l'esecuzione di codice arbitrario nel
 * documento esportato (problema P0-1). Questi test sono i più importanti del
 * progetto: se falliscono, esiste una vulnerabilità.
 */

import { describe, it, expect } from 'vitest';
import { sanitizeElement, unwrap } from '../../src/gemini/sanitize/html-sanitizer.js';
import { SafeHtml } from '../../src/core/model/safe-html.js';
import { MALICIOUS_RESPONSE } from '../fixtures/gemini-dom.js';

/**
 * @param {string} html
 * @returns {Element}
 */
function elementFrom(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return container;
}

describe('sanitizeElement', () => {
  it('restituisce un SafeHtml, unico tipo accettato dal renderer', () => {
    const result = sanitizeElement(elementFrom('<p>ciao</p>'));
    expect(result).toBeInstanceOf(SafeHtml);
  });

  it('neutralizza tutti i vettori di esecuzione di un contenuto ostile', () => {
    const output = sanitizeElement(elementFrom(MALICIOUS_RESPONSE)).value;

    expect(output).not.toContain('onerror');
    expect(output).not.toContain('onclick');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('javascript:');
    expect(output).not.toContain('<iframe');
    expect(output).not.toContain('window.__pwned');
  });

  it('preserva il testo legittimo presente accanto al contenuto ostile', () => {
    const output = sanitizeElement(elementFrom(MALICIOUS_RESPONSE)).value;

    expect(output).toContain('Testo innocuo');
    expect(output).toContain('paragrafo');
  });

  it('mantiene il markup di formattazione consentito', () => {
    const html =
      '<h2>Titolo</h2><p><strong>grassetto</strong> e <em>corsivo</em></p>' +
      '<ul><li>voce</li></ul><table><tr><td colspan="2">cella</td></tr></table>';
    const output = sanitizeElement(elementFrom(html)).value;

    expect(output).toContain('<h2>Titolo</h2>');
    expect(output).toContain('<strong>grassetto</strong>');
    expect(output).toContain('<em>corsivo</em>');
    expect(output).toContain('<li>voce</li>');
    expect(output).toContain('colspan="2"');
  });

  it('conserva i link http e vi aggiunge rel di sicurezza', () => {
    const output = sanitizeElement(elementFrom('<a href="https://esempio.it">link</a>')).value;

    expect(output).toContain('href="https://esempio.it"');
    expect(output).toContain('rel="noopener noreferrer"');
  });

  it('rimuove gli href con schema non sicuro mantenendo il testo del link', () => {
    const output = sanitizeElement(elementFrom('<a href="javascript:alert(1)">testo</a>')).value;

    expect(output).not.toContain('javascript');
    expect(output).toContain('testo');
  });

  it('spacchetta i tag sconosciuti senza perdere il contenuto', () => {
    const output = sanitizeElement(
      elementFrom('<custom-widget><p>contenuto importante</p></custom-widget>')
    ).value;

    expect(output).not.toContain('custom-widget');
    expect(output).toContain('<p>contenuto importante</p>');
  });

  it('accetta le data URL solo per le immagini', () => {
    const safe = sanitizeElement(
      elementFrom('<img src="data:image/png;base64,iVBORw0KGgo=" alt="ok">')
    ).value;
    const unsafe = sanitizeElement(
      elementFrom('<img src="data:text/html;base64,PHNjcmlwdD4=" alt="ko">')
    ).value;

    expect(safe).toContain('data:image/png');
    expect(unsafe).not.toContain('data:text/html');
  });

  it('scarta gli stili inline che contengono espressioni eseguibili', () => {
    const output = sanitizeElement(
      elementFrom('<div style="color:red">a</div><div style="background:url(javascript:x)">b</div>')
    ).value;

    expect(output).toContain('color:red');
    expect(output).not.toContain('javascript');
  });
});

describe('unwrap', () => {
  it('sostituisce l\u2019elemento con i suoi figli, non il genitore (regressione P0-3)', () => {
    const root = elementFrom(
      '<div id="parent"><wrapper><b>uno</b><i>due</i></wrapper><p>tre</p></div>'
    );
    const wrapper = root.querySelector('wrapper');

    unwrap(wrapper);

    const parent = root.querySelector('#parent');
    expect(parent).not.toBeNull();
    expect(parent.innerHTML).toBe('<b>uno</b><i>due</i><p>tre</p>');
  });
});
