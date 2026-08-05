/**
 * Test del renderer: verifica che il documento prodotto sia autosufficiente,
 * corretto e senza fughe di HTML non sanificato.
 */

import { describe, it, expect } from 'vitest';
import { createHtmlDocumentRenderer } from '../../src/render/html-document.renderer.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';

/** Loader finto: rende i test indipendenti dagli asset reali. */
const assetLoader = {
  loadStyles: async () => ({
    katex: '.katex{font:1em}',
    document: 'body{color:#000}',
    katexOverrides: '.katex-mathml{display:none}',
    print: '@media print{.print-toolbar{display:none}}',
  }),
};

/**
 * @param {string} html
 */
function safeHtmlFrom(html) {
  const container = document.createElement('div');
  container.innerHTML = html;
  return sanitizeElement(container);
}

/**
 * @param {number} turnCount
 */
function conversationWith(turnCount, options = {}) {
  const turns = Array.from({ length: turnCount }, (_, index) =>
    createTurn(
      createMessage({
        role: 'user',
        text: `Domanda ${index + 1}`,
        attachments: options.attachments ?? [],
      }),
      createMessage({
        role: 'model',
        text: `Risposta ${index + 1}`,
        html: safeHtmlFrom(`<p>Risposta <strong>${index + 1}</strong></p>`),
      })
    )
  );

  return createConversation({
    title: options.title ?? 'Gemini Chat',
    turns,
    source: { app: 'gemini', url: 'https://gemini.google.com/app' },
    exportedAt: new Date('2026-07-25T10:30:00Z'),
  });
}

const renderer = createHtmlDocumentRenderer({ assetLoader });

describe('createHtmlDocumentRenderer', () => {
  it('produce un documento HTML completo e autosufficiente', async () => {
    const html = await renderer.render(conversationWith(1));

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain('</html>');
    // Nessuna risorsa esterna da caricare al momento della stampa.
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it('incorpora tutti i fogli di stile necessari', async () => {
    const html = await renderer.render(conversationWith(1));

    expect(html).toContain('.katex{font:1em}');
    expect(html).toContain('body{color:#000}');
    expect(html).toContain('@media print');
  });

  it('include la toolbar di stampa e il contenuto del turno', async () => {
    const html = await renderer.render(conversationWith(1));

    expect(html).toContain('Salva come PDF');
    expect(html).toContain('window.print()');
    expect(html).toContain('Domanda 1');
    expect(html).toContain('<strong>1</strong>');
  });

  it('esegue l\u2019escaping del testo utente, impedendo l\u2019injection dal prompt', async () => {
    const conversation = createConversation({
      title: '<script>alert(1)</script>',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: '<img src=x onerror=alert(1)>' }),
          createMessage({ role: 'model', text: 'ok', html: safeHtmlFrom('<p>ok</p>') })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const html = await renderer.render(conversation);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('mostra i separatori solo quando i turni sono più di uno', async () => {
    const single = await renderer.render(conversationWith(1));
    const multiple = await renderer.render(conversationWith(3));

    expect(single).not.toContain('turn-separator');
    expect(multiple).toContain('turn-separator');
    expect(multiple).toContain('Domanda 3');
  });

  it('rispetta la preferenza che esclude il messaggio utente', async () => {
    const html = await renderer.render(conversationWith(1), { includeUserMessage: false });

    expect(html).not.toContain('Il tuo messaggio');
    expect(html).toContain('Risposta di Gemini');
  });

  it('rende gli allegati solo se la preferenza è attiva', async () => {
    const conversation = conversationWith(1, {
      attachments: [{ name: 'report', extension: 'PDF' }],
    });

    const withFiles = await renderer.render(conversation, { includeAttachments: true });
    const withoutFiles = await renderer.render(conversation, { includeAttachments: false });

    expect(withFiles).toContain('file-badge');
    expect(withFiles).toContain('user-files');
    // Prima il nome, poi il formato: il nome identifica il file.
    expect(withFiles).toContain('report <span class="file-badge">PDF</span>');
    expect(withoutFiles).not.toContain('file-badge');
    expect(withoutFiles).not.toContain('user-files');
  });

  it('formatta la data secondo il locale scelto', async () => {
    const italian = await renderer.render(conversationWith(1), { locale: 'it-IT' });
    const english = await renderer.render(conversationWith(1), { locale: 'en-GB' });

    expect(italian).toContain('lang="it"');
    expect(english).toContain('lang="en"');
    expect(italian).not.toBe(english);
  });
});
