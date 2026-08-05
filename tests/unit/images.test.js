/**
 * Immagini generate da Gemini: dall'estrazione al documento.
 *
 * Le immagini presentano un problema che il testo non ha: la loro sorgente è
 * un URL `blob:` valido **solo nella sessione di Gemini**. Nel documento
 * esportato — un'altra scheda, o un file aperto giorni dopo — non punta più a
 * nulla. Devono quindi essere scaricate e incorporate.
 *
 * I test coprono i tre passaggi: preservazione durante l'estrazione,
 * incorporamento dei dati, inserimento nei due formati.
 */

import { describe, it, expect, vi } from 'vitest';
import { normalizeImages, SOURCE_ATTRIBUTE } from '../../src/gemini/sanitize/images.js';
import { createImageResolver } from '../../src/gemini/image-resolver.js';
import { createEmbedImagesUseCase } from '../../src/core/usecases/embed-images.js';
import { createImageCollector, buildDrawing } from '../../src/export/docx/images.js';
import { convertHtmlToOoxml } from '../../src/export/docx/html-to-ooxml.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { createLogger } from '../../src/shared/logger.js';

const logger = createLogger({ level: 'silent' });

/** PNG 4×4 rosso, valido e minimale. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAQMAAACTPww9AAAABlBMVEX/AAD///9BHTQRAAAADElEQVR4' +
  'AWMYNAAAAGQAAeaMKgYAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

/** @param {string} html */
function elementFrom(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('normalizzazione delle immagini nel DOM', () => {
  it('conserva la sorgente in un attributo dedicato', () => {
    // La `src` viene svuotata perché un blob: non è raggiungibile fuori dalla
    // sessione; l'URL serve però alla fase di download.
    const root = elementFrom('<img src="blob:https://gemini.google.com/abc" alt="cane">');
    normalizeImages(root);

    const image = root.querySelector('img');
    expect(image).not.toBeNull();
    expect(image.getAttribute(SOURCE_ATTRIBUTE)).toBe('blob:https://gemini.google.com/abc');
    expect(image.hasAttribute('src')).toBe(false);
  });

  it('lascia intatti i data URI, già autosufficienti', () => {
    const root = elementFrom(`<img src="${PNG_DATA_URL}">`);
    normalizeImages(root);

    expect(root.querySelector('img').getAttribute('src')).toBe(PNG_DATA_URL);
  });

  it('estrae le immagini dai pulsanti che le racchiudono', () => {
    // Gemini rende l'immagine cliccabile avvolgendola in un <button>, che il
    // sanitizer elimina con tutto il contenuto: senza questo passaggio
    // l'immagine sparirebbe.
    const root = elementFrom(
      '<button class="open-image"><img src="blob:x" alt="cane"><span>Ingrandisci</span></button>'
    );
    normalizeImages(root);

    expect(root.querySelector('img')).not.toBeNull();
    expect(root.querySelector('button')).toBeNull();
    // L'etichetta del controllo non appartiene al contenuto.
    expect(root.textContent).not.toContain('Ingrandisci');
  });

  it('sopravvive all\u2019intera sanitizzazione', () => {
    const root = elementFrom('<button><img src="blob:x" alt="cane generato"></button>');
    normalizeImages(root);

    const html = sanitizeElement(root).value;
    expect(html).toContain('<img');
    expect(html).toContain(SOURCE_ATTRIBUTE);
  });

  it('rimuove le immagini decorative dell\u2019interfaccia', () => {
    const root = elementFrom(
      '<img class="mavatar-image" src="a.jpg">' +
        '<img class="user-icon" src="b.jpg">' +
        '<img aria-hidden="true" src="c.png">' +
        '<img src="blob:vera" alt="contenuto">'
    );
    normalizeImages(root);

    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelector('img').getAttribute(SOURCE_ATTRIBUTE)).toBe('blob:vera');
  });

  it('rimuove le dimensioni dettate dal layout della pagina', () => {
    // Riflettono la resa nel browser, non quella del documento.
    const root = elementFrom('<img src="blob:x" width="1024" height="768" style="width:50%">');
    normalizeImages(root);

    const image = root.querySelector('img');
    expect(image.hasAttribute('width')).toBe(false);
    expect(image.hasAttribute('style')).toBe(false);
  });
});

describe('recupero dei dati', () => {
  /** @param {object} [options] */
  function resolverWith({ ok = true, size = 1024, fails = false } = {}) {
    return createImageResolver({
      logger,
      fetchFn: async () => {
        if (fails) throw new Error('rete non disponibile');
        return { ok, blob: async () => ({ size }) };
      },
      readAsDataUrl: async () => PNG_DATA_URL,
    });
  }

  it('converte una sorgente remota in data URI', async () => {
    const root = elementFrom(`<img ${SOURCE_ATTRIBUTE}="blob:x">`);
    const outcome = await resolverWith().embedAll(root);

    expect(outcome).toEqual({ resolved: 1, failed: 0 });
    expect(root.querySelector('img').getAttribute('src')).toBe(PNG_DATA_URL);
    // L'attributo di servizio non deve restare nel documento.
    expect(root.querySelector('img').hasAttribute(SOURCE_ATTRIBUTE)).toBe(false);
  });

  it('rimuove le immagini non recuperabili', async () => {
    // Un <img> con sorgente non valida produrrebbe un riquadro rotto.
    const root = elementFrom(`<img ${SOURCE_ATTRIBUTE}="blob:x">`);
    const outcome = await resolverWith({ fails: true }).embedAll(root);

    expect(outcome).toEqual({ resolved: 0, failed: 1 });
    expect(root.querySelector('img')).toBeNull();
  });

  it('rifiuta le immagini oltre il limite di dimensione', async () => {
    const root = elementFrom(`<img ${SOURCE_ATTRIBUTE}="blob:x">`);
    const outcome = await resolverWith({ size: 20 * 1024 * 1024 }).embedAll(root);

    expect(outcome.failed).toBe(1);
  });

  it('scarica una sola volta le immagini ripetute', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, blob: async () => ({ size: 100 }) }));
    const resolver = createImageResolver({
      logger,
      fetchFn,
      readAsDataUrl: async () => PNG_DATA_URL,
    });

    const root = elementFrom(
      `<img ${SOURCE_ATTRIBUTE}="blob:a"><img ${SOURCE_ATTRIBUTE}="blob:a">`
    );
    await resolver.embedAll(root);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('non scarica i data URI già incorporati', async () => {
    const fetchFn = vi.fn();
    const resolver = createImageResolver({ logger, fetchFn, readAsDataUrl: async () => '' });

    expect(await resolver.resolve(PNG_DATA_URL)).toBe(PNG_DATA_URL);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('caso d\u2019uso di incorporamento', () => {
  /** @param {string} html */
  function conversationWith(html) {
    return createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'Domanda' }),
          createMessage({
            role: 'model',
            text: 'Risposta',
            html: sanitizeElement(elementFrom(html)),
          })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });
  }

  /** @param {object} [imageResolver] */
  function useCaseWith(imageResolver) {
    return createEmbedImagesUseCase({
      imageResolver,
      parseHtml: (html) => elementFrom(html),
      sanitize: sanitizeElement,
      logger,
    });
  }

  it('sostituisce le sorgenti nel modello dati', async () => {
    const embed = useCaseWith({
      embedAll: async (root) => {
        root.querySelectorAll('img').forEach((image) => image.setAttribute('src', PNG_DATA_URL));
        return { resolved: 1, failed: 0 };
      },
    });

    const outcome = await embed(conversationWith(`<img ${SOURCE_ATTRIBUTE}="blob:x">`));

    expect(outcome.resolved).toBe(1);
    expect(outcome.conversation.turns[0].modelMessage.html.value).toContain('data:image/png');
  });

  it('lascia invariati i turni privi di immagini', async () => {
    const embedAll = vi.fn();
    const conversation = conversationWith('<p>Solo testo</p>');

    const outcome = await useCaseWith({ embedAll })(conversation);

    expect(embedAll).not.toHaveBeenCalled();
    expect(outcome.conversation.turns[0]).toBe(conversation.turns[0]);
  });

  it('ri-sanifica il contenuto dopo la modifica', async () => {
    // Nulla può rientrare nel modello senza passare dall'allowlist.
    const embed = useCaseWith({
      embedAll: async (root) => {
        root.innerHTML += '<script>alert(1)</' + 'script><img src="' + PNG_DATA_URL + '">';
        return { resolved: 1, failed: 0 };
      },
    });

    const outcome = await embed(conversationWith(`<img ${SOURCE_ATTRIBUTE}="blob:x">`));

    expect(outcome.conversation.turns[0].modelMessage.html.value).not.toContain('<script');
  });
});

describe('immagini nel documento Word', () => {
  it('decodifica un data URI in una parte del pacchetto', () => {
    const collector = createImageCollector();
    const registered = collector.add(PNG_DATA_URL);

    expect(registered).not.toBeNull();
    // Gli identificatori proseguono la numerazione delle relazioni fisse
    // (rId1…rId4): Word ignora le forme fuori convenzione come `rIdImg1`.
    // Vedi docs/BUGFIX-DOCX-IMMAGINE-RELID.md.
    expect(registered.id).toBe('rId5');
    expect(collector.parts()).toHaveLength(1);
    expect(collector.parts()[0].path).toBe('word/media/image1.png');
  });

  it('produce byte di immagine validi', () => {
    const collector = createImageCollector();
    collector.add(PNG_DATA_URL);

    const bytes = collector.parts()[0].content;
    // Firma PNG: 0x89 'P' 'N' 'G'.
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('legge le proporzioni dall\u2019intestazione del file', () => {
    const collector = createImageCollector();
    const { widthEmu, heightEmu } = collector.add(PNG_DATA_URL);

    // L'immagine di prova è quadrata.
    expect(widthEmu).toBe(heightEmu);
    expect(widthEmu).toBeGreaterThan(0);
  });

  it('limita la larghezza a quella utile della pagina', () => {
    const collector = createImageCollector();
    const { widthEmu } = collector.add(PNG_DATA_URL);

    // Larghezza di una pagina A4 con margini di 2 cm, in EMU.
    expect(widthEmu).toBeLessThanOrEqual(6120000);
  });

  it('scarta i formati non supportati', () => {
    const collector = createImageCollector();

    expect(collector.add('data:image/tiff;base64,AAAA')).toBeNull();
    expect(collector.add('data:text/html;base64,AAAA')).toBeNull();
    expect(collector.add('blob:https://gemini.google.com/x')).toBeNull();
    expect(collector.isEmpty()).toBe(true);
  });

  it('dichiara relazioni ed estensioni per il pacchetto', () => {
    const collector = createImageCollector();
    collector.add(PNG_DATA_URL);

    expect(collector.relationships()).toContain('rId5');
    expect(collector.relationships()).toContain('media/image1.png');
    expect(collector.extensions()).toEqual(['png']);
  });

  it('genera un disegno conforme allo schema', () => {
    const drawing = buildDrawing({
      id: 'rId5',
      widthEmu: 100,
      heightEmu: 80,
      description: 'cane',
      index: 1,
    });

    expect(drawing).toContain('<w:drawing>');
    expect(drawing).toContain('<wp:inline');
    expect(drawing).toContain('r:embed="rId5"');
    expect(drawing).toContain('cx="100"');
  });

  it('inserisce l\u2019immagine nel flusso del documento', () => {
    const collector = createImageCollector();
    const xml = convertHtmlToOoxml(
      elementFrom(`<p>Testo</p><img src="${PNG_DATA_URL}" alt="cane">`),
      { images: collector }
    );

    expect(xml).toContain('<w:drawing>');
    expect(collector.isEmpty()).toBe(false);
  });

  it('ignora le immagini se il pacchetto non le raccoglie', () => {
    // Senza collector non è possibile creare le parti: meglio omettere
    // l'immagine che produrre un riferimento rotto.
    const xml = convertHtmlToOoxml(elementFrom(`<img src="${PNG_DATA_URL}">`));

    expect(xml).not.toContain('<w:drawing>');
  });
});
