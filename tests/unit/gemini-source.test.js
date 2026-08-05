/**
 * Test dell'adapter Gemini: conversione DOM → modello dati.
 * Copre l'estrazione, la pulizia e la resilienza ai cambi di HTML.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGeminiSource } from '../../src/gemini/gemini-source.js';
import { createLogger } from '../../src/shared/logger.js';
import { ErrorCode } from '../../src/shared/errors.js';
import {
  conversationTurn,
  driftedTurn,
  RESPONSE_WITH_CODE,
  RESPONSE_WITH_KATEX,
  RESPONSE_WITH_ORPHAN_MATHML,
  RESPONSE_WITH_CITATIONS,
  USER_WITH_ATTACHMENTS,
} from '../fixtures/gemini-dom.js';

const silentLogger = createLogger({ level: 'silent' });
const FIXED_DATE = new Date('2026-07-25T12:00:00Z');

/**
 * @param {string} html
 * @returns {ReturnType<typeof createGeminiSource>}
 */
function sourceFor(html) {
  document.body.innerHTML = html;
  return createGeminiSource({ logger: silentLogger, document, now: () => FIXED_DATE });
}

/**
 * @param {string} html
 * @returns {import('../../src/core/model/conversation.js').ConversationTurn}
 */
function extractSingleTurn(html) {
  const source = sourceFor(html);
  const turnElement = document.querySelector('.conversation-container');
  const result = source.extractTurn(turnElement, { title: 'Test' });

  expect(result.ok).toBe(true);
  return result.value.turns[0];
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('estrazione del messaggio utente', () => {
  it('legge il testo della domanda', () => {
    const turn = extractSingleTurn(conversationTurn());
    expect(turn.userMessage.text).toBe('Ciao Gemini');
  });

  it('legge nome ed estensione dei file allegati', () => {
    const turn = extractSingleTurn(conversationTurn({ userHtml: USER_WITH_ATTACHMENTS }));

    expect(turn.userMessage.attachments).toEqual([
      { name: 'bilancio', extension: 'PDF' },
      { name: 'note', extension: 'TXT' },
    ]);
  });

  it('non fallisce quando il messaggio utente è assente', () => {
    const turn = extractSingleTurn(conversationTurn({ userHtml: '' }));
    expect(turn.userMessage.attachments).toEqual([]);
  });
});

describe('estrazione della risposta del modello', () => {
  it('produce contenuto sanificato non vuoto', () => {
    const turn = extractSingleTurn(conversationTurn());

    expect(turn.modelMessage.html.isEmpty()).toBe(false);
    expect(turn.modelMessage.html.value).toContain('Risposta di prova');
  });

  it('rimuove le etichette per screen reader e le citazioni', () => {
    const turn = extractSingleTurn(conversationTurn({ responseHtml: RESPONSE_WITH_CITATIONS }));
    const html = turn.modelMessage.html.value;

    expect(html).not.toContain('source-footnote');
    expect(html).not.toContain('source-inline-chip');
    expect(html).toContain('Il cielo è blu');
    expect(html).toContain('Fine.');
  });

  it('rimuove gli attributi Angular dal markup', () => {
    const turn = extractSingleTurn(conversationTurn());
    expect(turn.modelMessage.html.value).not.toContain('_ngcontent');
  });
});

describe('blocchi di codice', () => {
  it('conserva il codice ma elimina toolbar e pulsante copia', () => {
    const turn = extractSingleTurn(conversationTurn({ responseHtml: RESPONSE_WITH_CODE }));
    const html = turn.modelMessage.html.value;

    expect(html).toContain('def saluta():');
    expect(html).toContain('print("ciao")');
    expect(html).not.toContain('Copia codice');
    expect(html).not.toContain('code-block-copy-button');
    expect(html).not.toContain('<button');
  });

  it('mantiene il tag pre necessario alla formattazione', () => {
    const turn = extractSingleTurn(conversationTurn({ responseHtml: RESPONSE_WITH_CODE }));
    expect(turn.modelMessage.html.value).toContain('<pre');
  });
});

describe('formule matematiche', () => {
  it('rimuove il MathML duplicato delle formule già renderizzate', () => {
    const turn = extractSingleTurn(conversationTurn({ responseHtml: RESPONSE_WITH_KATEX }));
    const html = turn.modelMessage.html.value;

    expect(html).not.toContain('katex-mathml');
    expect(html).toContain('katex-html');
    expect(html).toContain('E=mc²');
  });

  it('converte il MathML orfano nel sorgente LaTeX leggibile', () => {
    const turn = extractSingleTurn(conversationTurn({ responseHtml: RESPONSE_WITH_ORPHAN_MATHML }));
    const html = turn.modelMessage.html.value;

    expect(html).toContain('gex-latex-fallback');
    expect(html).toContain('\\frac{a}{b}');
  });
});

describe('resilienza ai cambiamenti di HTML', () => {
  it('estrae comunque il contenuto usando i selettori di fallback', () => {
    const turn = extractSingleTurn(driftedTurn());

    expect(turn.userMessage.text).toBe('Domanda dopo il redesign');
    expect(turn.modelMessage.html.value).toContain('Risposta dopo il redesign');
  });

  it('avvisa nei log quando ricorre a un selettore di fallback', () => {
    const warn = vi.fn();
    document.body.innerHTML = driftedTurn();

    const source = createGeminiSource({
      logger: { ...silentLogger, warn },
      document,
      now: () => FIXED_DATE,
    });
    source.extractTurn(document.querySelector('.conversation-container'), { title: 'T' });

    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('Selector drift');
  });

  it('restituisce un errore esplicito quando il contenuto non è individuabile', () => {
    document.body.innerHTML =
      '<div class="conversation-container"><model-response></model-response></div>';
    const source = createGeminiSource({ logger: silentLogger, document, now: () => FIXED_DATE });

    const result = source.extractTurn(document.querySelector('.conversation-container'), {
      title: 'T',
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCode.SELECTOR_NOT_FOUND);
    expect(result.error.userMessage).toContain('interfaccia');
  });
});

describe('esportazione dell\u2019intera conversazione', () => {
  it('raccoglie tutti i turni completati', () => {
    const source = sourceFor(
      conversationTurn({ userHtml: '<div class="query-text-line">Primo</div>' }) +
        conversationTurn({ userHtml: '<div class="query-text-line">Secondo</div>' })
    );

    const result = source.extractConversation({ title: 'Chat' });

    expect(result.ok).toBe(true);
    expect(result.value.turns).toHaveLength(2);
    expect(result.value.turns[1].userMessage.text).toBe('Secondo');
  });

  it('ignora i turni ancora in streaming', () => {
    const source = sourceFor(
      conversationTurn({ complete: true }) + conversationTurn({ complete: false })
    );

    const result = source.extractConversation({ title: 'Chat' });

    expect(result.value.turns).toHaveLength(1);
  });

  it('segnala l\u2019assenza di conversazione con un errore dedicato', () => {
    const source = sourceFor('<div>Pagina vuota</div>');
    const result = source.extractConversation({ title: 'Chat' });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(ErrorCode.NO_CONVERSATION);
  });
});

describe('file generati da Gemini', () => {
  /** Struttura reale del chip di download, tratta dal DOM di Gemini. */
  const GENERATED_FILE = `
    <div class="conversation-container">
      <user-query><span class="query-text-line">genera un file html</span></user-query>
      <model-response>
        <message-content>
          <div class="markdown">
            <p>Il tuo file HTML è pronto:</p>
            <generated-file>
              <div class="chip-lr clickable">
                <img class="file-icon-lr" alt="Icona HTML">
                <div data-test-id="file-name" class="file-name-lr"
                     title="dashboard_analitico.html"> dashboard_analitico </div>
                <div class="file-type-lr"> HTML </div>
                <button data-test-id="open-button"><span>Apri</span></button>
              </div>
            </generated-file>
          </div>
        </message-content>
      </model-response>
      <div class="response-footer complete"></div>
    </div>`;

  /** @returns {import('../../src/core/model/conversation.js').Message} */
  function extractModel(html) {
    document.body.innerHTML = html;
    const source = createGeminiSource({ logger: silentLogger, document });
    const result = source.extractTurn(document.querySelector('.conversation-container'), {
      title: 'T',
    });
    return result.value.turns[0].modelMessage;
  }

  it('riconosce i file offerti in download', () => {
    // Sono contenuto vero della risposta, ma scaricabili solo dall'interfaccia:
    // nel documento ne resta almeno la menzione.
    const message = extractModel(GENERATED_FILE);

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].name).toBe('dashboard_analitico.html');
  });

  it('preferisce il nome completo al testo visibile', () => {
    // Il testo mostrato è troncato e privo di estensione: il nome intero sta
    // nell'attributo `title`.
    const message = extractModel(GENERATED_FILE);

    expect(message.attachments[0].name).toContain('.html');
  });

  it('non ripete l\u2019estensione già presente nel nome', () => {
    // Altrimenti si leggerebbe «dashboard_analitico.html [HTML]».
    const message = extractModel(GENERATED_FILE);

    expect(message.attachments[0].extension).toBe('');
  });

  it('non inventa allegati quando la risposta non ne contiene', () => {
    const message = extractModel(`
      <div class="conversation-container">
        <user-query><span class="query-text-line">ciao</span></user-query>
        <model-response><message-content><div class="markdown">Ciao!</div></message-content></model-response>
        <div class="response-footer complete"></div>
      </div>`);

    expect(message.attachments).toEqual([]);
  });
});
