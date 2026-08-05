/**
 * Test dell'esportazione in Word (.docx).
 *
 * Un .docx è un archivio ZIP di file XML: se una sola parte è malformata, Word
 * rifiuta l'intero documento con un messaggio generico. I test presidiano
 * quindi sia la validità del contenitore sia la correttezza della conversione.
 */

import { describe, it, expect } from 'vitest';
import { createZip, crc32 } from '../../src/export/docx/zip-writer.js';
import { convertHtmlToOoxml } from '../../src/export/docx/html-to-ooxml.js';
import { createDocxRenderer, DOCX_EXTENSION } from '../../src/export/docx/docx.renderer.js';
import { escapeXml } from '../../src/export/docx/ooxml.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';

const decoder = new TextDecoder();

/**
 * @param {string} html
 * @returns {Element}
 */
function elementFrom(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

/** @param {string} html */
function convert(html) {
  return convertHtmlToOoxml(elementFrom(html));
}

/**
 * Conversazione minima con il contenuto indicato.
 * @param {string} html
 */
function conversationWith(html, attachments = []) {
  return createConversation({
    title: 'Documento di prova',
    turns: [
      createTurn(
        createMessage({ role: 'user', text: 'Domanda', attachments }),
        createMessage({ role: 'model', text: 'Risposta', html: sanitizeElement(elementFrom(html)) })
      ),
    ],
    source: { app: 'gemini', url: '' },
    exportedAt: new Date('2026-07-25T10:00:00Z'),
  });
}

describe('scrittore ZIP', () => {
  it('produce un archivio con le firme previste dalla specifica', () => {
    const zip = createZip([{ path: 'a.txt', content: 'contenuto' }]);
    const view = new DataView(zip.buffer);

    // Local file header in testa, End of central directory in coda.
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
  });

  it('calcola un CRC32 conforme', () => {
    // Valore di riferimento noto per la stringa "123456789".
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('conserva i contenuti UTF-8 senza alterarli', () => {
    const zip = createZip([{ path: 'testo.xml', content: '<r>àèìòù €</r>' }]);
    const archive = decoder.decode(zip);

    expect(archive).toContain('<r>àèìòù €</r>');
    expect(archive).toContain('testo.xml');
  });

  it('registra tutte le voci nella central directory', () => {
    const zip = createZip([
      { path: 'uno.txt', content: 'a' },
      { path: 'due/tre.txt', content: 'b' },
    ]);
    const view = new DataView(zip.buffer);

    // Nel record End of central directory (22 byte) il numero di voci compare
    // due volte: per il disco corrente e in totale.
    expect(view.getUint16(zip.length - 14, true)).toBe(2);
    expect(view.getUint16(zip.length - 12, true)).toBe(2);
  });
});

describe('conversione HTML → WordprocessingML', () => {
  it('mappa le intestazioni sugli stili corrispondenti', () => {
    const xml = convert('<h1>Uno</h1><h2>Due</h2><h3>Tre</h3>');

    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading3"/>');
  });

  it('trasporta la formattazione inline nei run', () => {
    const xml = convert(
      '<p><strong>grassetto</strong><em>corsivo</em><code>codice</code><s>barrato</s></p>'
    );

    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:rStyle w:val="InlineCode"/>');
    expect(xml).toContain('<w:strike/>');
  });

  it('numera le liste distinguendo puntate e numerate', () => {
    const bullet = convert('<ul><li>voce</li></ul>');
    const ordered = convert('<ol><li>voce</li></ol>');

    expect(bullet).toContain('<w:numId w:val="1"/>');
    expect(ordered).toContain('<w:numId w:val="2"/>');
  });

  it('assegna il livello corretto alle liste annidate', () => {
    const xml = convert('<ul><li>primo<ul><li>annidato</li></ul></li></ul>');

    expect(xml).toContain('<w:ilvl w:val="0"/>');
    expect(xml).toContain('<w:ilvl w:val="1"/>');
  });

  it('genera tabelle con la griglia di colonne richiesta da Word', () => {
    const xml = convert(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>'
    );

    // Senza <w:tblGrid> Word considera il documento malformato.
    expect(xml).toContain('<w:tblGrid>');
    expect((xml.match(/<w:gridCol /g) ?? []).length).toBe(2);
    expect((xml.match(/<w:tr>/g) ?? []).length).toBe(2);
  });

  it('spezza i blocchi di codice in un paragrafo per riga', () => {
    const xml = convert('<pre><code>riga uno\nriga due</code></pre>');

    expect((xml.match(/<w:pStyle w:val="CodeBlock"\/>/g) ?? []).length).toBe(2);
    expect(xml).toContain('riga uno');
    expect(xml).toContain('riga due');
  });

  it('applica lo stile citazione ai blockquote', () => {
    expect(convert('<blockquote><p>citata</p></blockquote>')).toContain(
      '<w:pStyle w:val="Quote"/>'
    );
  });

  it('preserva gli spazi ai bordi del testo', () => {
    // Senza xml:space Word eliminerebbe gli spazi, incollando le parole.
    expect(convert('<p>a <strong>b</strong> c</p>')).toContain('xml:space="preserve"');
  });

  it('esegue l\u2019escaping dei caratteri riservati', () => {
    const xml = convert('<p>5 &lt; 10 &amp;&amp; "quotato"</p>');

    expect(xml).toContain('&lt;');
    expect(xml).toContain('&amp;');
    expect(xml).not.toMatch(/<w:t[^>]*>[^<]*"quotato"/);
  });

  it('rimuove i caratteri di controllo che invaliderebbero l\u2019XML', () => {
    expect(escapeXml('testo\u0000con\u0008controlli')).toBe('testoconcontrolli');
  });

  it('non produce paragrafi vuoti dal solo spazio bianco', () => {
    expect(convert('<p>   </p><div>\n</div>').trim()).toBe('');
  });
});

describe('formule matematiche', () => {
  it('converte il sorgente LaTeX in matematica nativa di Word', () => {
    // Il LaTeX conservato dal normalizzatore diventa OMML, non testo grezzo.
    const xml = convert('<span class="katex" data-latex="E = mc^2">E=mc²</span>');

    expect(xml).toContain('<m:oMath>');
    expect(xml).toContain('<m:sSup>');
    expect(xml).not.toContain('mc^2');
  });

  it('riconosce il fallback testuale prodotto dal sanitizer', () => {
    const xml = convert('<span class="gex-latex-fallback">\\frac{a}{b}</span>');

    expect(xml).toContain('<m:f>');
    expect(xml).not.toContain('\\frac');
  });

  it('centra le formule in blocco con lo stile dedicato', () => {
    const xml = convert('<div class="katex-display" data-latex="x^2">x²</div>');

    expect(xml).toContain('<w:pStyle w:val="Formula"/>');
  });
});

describe('pacchetto .docx', () => {
  const renderer = createDocxRenderer();

  it('dichiara l\u2019estensione corretta', () => {
    expect(DOCX_EXTENSION).toBe('.docx');
  });

  it('contiene tutte le parti obbligatorie del formato OOXML', async () => {
    const archive = decoder.decode(await renderer.render(conversationWith('<p>Testo</p>')));

    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/numbering.xml',
      'docProps/core.xml',
    ]) {
      expect(archive, `parte mancante: ${part}`).toContain(part);
    }
  });

  it('restituisce byte, non una stringa', async () => {
    const result = await renderer.render(conversationWith('<p>Testo</p>'));
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('include titolo, messaggio utente e risposta', async () => {
    const archive = decoder.decode(await renderer.render(conversationWith('<p>La risposta</p>')));

    expect(archive).toContain('Documento di prova');
    expect(archive).toContain('Domanda');
    expect(archive).toContain('La risposta');
  });

  it('elenca gli allegati quando la preferenza è attiva', async () => {
    const conversation = conversationWith('<p>x</p>', [{ name: 'bilancio', extension: 'PDF' }]);

    const withFiles = decoder.decode(
      await renderer.render(conversation, { includeAttachments: true })
    );
    const withoutFiles = decoder.decode(
      await renderer.render(conversation, { includeAttachments: false })
    );

    expect(withFiles).toContain('bilancio');
    expect(withoutFiles).not.toContain('bilancio');
  });

  it('omette il messaggio utente su richiesta', async () => {
    const archive = decoder.decode(
      await renderer.render(conversationWith('<p>x</p>'), { includeUserMessage: false })
    );

    expect(archive).not.toContain('Il tuo messaggio');
  });

  it('separa i turni quando la conversazione ne contiene più d\u2019uno', async () => {
    const turn = () =>
      createTurn(
        createMessage({ role: 'user', text: 'D' }),
        createMessage({ role: 'model', text: 'R', html: sanitizeElement(elementFrom('<p>R</p>')) })
      );

    const conversation = createConversation({
      title: 'Multi',
      turns: [turn(), turn()],
      source: { app: 'gemini', url: '' },
    });

    expect(decoder.decode(await renderer.render(conversation))).toContain('Turno 2');
  });
});

describe('contenitori delle formule in blocco', () => {
  it('riconosce sia .katex-display sia div.math-block', () => {
    // Gemini usa entrambi: ignorare il secondo faceva sparire intere sezioni.
    for (const className of ['katex-display', 'math-block']) {
      const xml = convert(
        `<div class="${className}"><span class="katex" data-latex="a = b">a=b</span></div>`
      );
      expect(xml, className).toContain('<m:oMath');
      expect(xml, className).toContain('<w:pStyle w:val="Formula"/>');
    }
  });

  it('allinea le formule a sinistra, non al centro', () => {
    const xml = convert('<div class="math-block" data-latex="x = 1"></div>');

    // L'allineamento va dichiarato: il default di <m:oMathPara> è
    // "centerGroup", che sposta la formula verso destra.
    expect(xml).toContain('<m:jc m:val="left"/>');
    expect(xml).not.toContain('m:val="center"');
    expect(xml).not.toContain('<w:jc w:val="center"/>');
  });

  it('non colora né inclina le formule', () => {
    // Le equazioni sono native: devono seguire il testo del documento.
    const styles = require('node:fs').readFileSync('src/export/docx/ooxml.js', 'utf-8');
    const formulaStyle = /w:styleId="Formula"[\s\S]*?<\/w:style>/.exec(styles)[0];

    expect(formulaStyle).not.toContain('w:color');
    expect(formulaStyle).not.toContain('<w:i/>');
  });
});
