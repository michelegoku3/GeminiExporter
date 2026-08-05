/**
 * Test della trasposizione dei contenuti interattivi (grafici, simulazioni).
 *
 * I grafici di Gemini vivono in un iframe cross-origin e sandboxed: non sono
 * leggibili, quindi vengono fotografati. La catena è delicata perché il
 * segnaposto deve sopravvivere a tutte le fasi di pulizia — l'`<iframe>` è un
 * tag pericoloso e verrebbe rimosso con tutto ciò che lo circonda.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  markEmbeddedApps,
  clearLiveMarkers,
  APP_ID_ATTRIBUTE,
  APP_LABEL_ATTRIBUTE,
  LIVE_MARKER_ATTRIBUTE,
} from '../../src/gemini/sanitize/embedded-apps.js';
import { createAppCapture } from '../../src/gemini/app-capture.js';
import { findScroller } from '../../src/gemini/scroll-container.js';
import { createEmbedAppCapturesUseCase } from '../../src/core/usecases/embed-app-captures.js';
import { normalizeImages } from '../../src/gemini/sanitize/images.js';
import { sanitizeElement } from '../../src/gemini/sanitize/html-sanitizer.js';
import { removeEmptyContainers } from '../../src/gemini/sanitize/structure.js';
import { convertHtmlToOoxml } from '../../src/export/docx/html-to-ooxml.js';
import { createImageCollector } from '../../src/export/docx/images.js';
import { createDocxRenderer, buildPackageParts } from '../../src/export/docx/docx.renderer.js';
import {
  createConversation,
  createTurn,
  createMessage,
} from '../../src/core/model/conversation.js';
import { createLogger } from '../../src/shared/logger.js';

const logger = createLogger({ level: 'silent' });

/** Markup rappresentativo di un grafico interattivo, tratto dal DOM reale. */
const CHART_HTML = `
  <div class="markdown">
    <p>Ecco il grafico:</p>
    <mini-app>
      <div class="title">Esploratore di Parabole</div>
      <web-preview>
        <iframe sandbox="allow-scripts" src="https://example.invalid/app.html"></iframe>
      </web-preview>
    </mini-app>
    <p>Come vedi la curva si sposta.</p>
  </div>
`;

/** @param {string} html */
function elementFrom(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

/** Sequenza deterministica di identificatori. */
function idGenerator() {
  let counter = 0;
  return () => `app-${(counter += 1)}`;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('marcatura dei contenuti interattivi', () => {
  it('sostituisce il contenitore con un segnaposto', () => {
    const live = elementFrom(CHART_HTML);
    const clone = /** @type {Element} */ (live.cloneNode(true));

    const marked = markEmbeddedApps(clone, live, idGenerator());

    expect(marked).toBe(1);
    expect(clone.querySelector('mini-app')).toBeNull();

    const placeholder = clone.querySelector(`[${APP_ID_ATTRIBUTE}]`);
    expect(placeholder).not.toBeNull();
    expect(placeholder.tagName).toBe('FIGURE');
  });

  it('marca l\u2019elemento originale per poterlo ritrovare', () => {
    const live = elementFrom(CHART_HTML);
    const clone = /** @type {Element} */ (live.cloneNode(true));

    markEmbeddedApps(clone, live, idGenerator());

    const id = clone.querySelector(`[${APP_ID_ATTRIBUTE}]`).getAttribute(APP_ID_ATTRIBUTE);
    expect(live.querySelector(`[${LIVE_MARKER_ATTRIBUTE}="${id}"]`)).not.toBeNull();
  });

  it('ricava la didascalia dal titolo del contenuto', () => {
    const live = elementFrom(CHART_HTML);
    const clone = /** @type {Element} */ (live.cloneNode(true));

    markEmbeddedApps(clone, live, idGenerator());

    const placeholder = clone.querySelector(`[${APP_ID_ATTRIBUTE}]`);
    expect(placeholder.getAttribute(APP_LABEL_ATTRIBUTE)).toBe('Esploratore di Parabole');
    expect(placeholder.querySelector('figcaption').textContent).toBe('Esploratore di Parabole');
  });

  it('usa un\u2019etichetta generica quando manca il titolo', () => {
    const live = elementFrom('<div><mini-app><iframe src="x"></iframe></mini-app></div>');
    const clone = /** @type {Element} */ (live.cloneNode(true));

    markEmbeddedApps(clone, live, idGenerator());

    expect(clone.querySelector(`[${APP_ID_ATTRIBUTE}]`).getAttribute(APP_LABEL_ATTRIBUTE)).toBe(
      'Contenuto interattivo'
    );
  });

  it('non marca due volte un contenitore annidato in un altro', () => {
    // <web-preview> è dentro <mini-app>: entrambi corrispondono al selettore,
    // ma la cattura deve riguardare solo il più esterno.
    const live = elementFrom(CHART_HTML);
    const clone = /** @type {Element} */ (live.cloneNode(true));

    const marked = markEmbeddedApps(clone, live, idGenerator());

    expect(marked).toBe(1);
    expect(clone.querySelectorAll(`[${APP_ID_ATTRIBUTE}]`)).toHaveLength(1);
  });

  it('rinuncia se clone e originale non corrispondono', () => {
    // Se Gemini modifica il DOM fra il clone e la marcatura, associare
    // l'elemento sbagliato produrrebbe l'immagine di un altro grafico.
    const live = elementFrom(CHART_HTML);
    const clone = /** @type {Element} */ (live.cloneNode(true));
    live.querySelector('mini-app').remove();

    expect(markEmbeddedApps(clone, live, idGenerator())).toBe(0);
  });

  it('rimuove i marcatori dal DOM vivo', () => {
    const live = elementFrom(CHART_HTML);
    const clone = /** @type {Element} */ (live.cloneNode(true));
    markEmbeddedApps(clone, live, idGenerator());

    clearLiveMarkers(live);

    expect(live.querySelectorAll(`[${LIVE_MARKER_ATTRIBUTE}]`)).toHaveLength(0);
  });

  it('non lascia iframe nel documento', () => {
    // È la ragione per cui la marcatura precede ogni altra fase: l'iframe è un
    // tag pericoloso e il sanitizer lo rimuoverebbe con tutto il contenuto.
    const live = elementFrom(CHART_HTML);
    const clone = /** @type {Element} */ (live.cloneNode(true));

    markEmbeddedApps(clone, live, idGenerator());

    expect(clone.querySelector('iframe')).toBeNull();
  });
});

describe('sopravvivenza del segnaposto alle fasi di pulizia', () => {
  /** Riproduce l'ordine reale delle fasi di `extractModelResponse`. */
  function runPipeline(html) {
    const live = elementFrom(html);
    const clone = /** @type {Element} */ (live.cloneNode(true));

    markEmbeddedApps(clone, live, idGenerator());
    normalizeImages(clone);
    removeEmptyContainers(clone);

    return sanitizeElement(clone).value;
  }

  it('conserva il segnaposto attraverso l\u2019intera catena', () => {
    const html = runPipeline(CHART_HTML);

    expect(html).toContain(APP_ID_ATTRIBUTE);
    expect(html).toContain('Esploratore di Parabole');
  });

  it('conserva l\u2019immagine vuota che la cattura dovrà riempire', () => {
    // normalizeImages rimuove le immagini senza sorgente: quella del
    // segnaposto è l'eccezione, perché la sorgente arriva più tardi.
    const html = runPipeline(CHART_HTML);
    const result = elementFrom(html);

    expect(result.querySelector(`[${APP_ID_ATTRIBUTE}] img`)).not.toBeNull();
  });

  it('non lascia passare l\u2019iframe attraverso il sanitizer', () => {
    expect(runPipeline(CHART_HTML)).not.toContain('<iframe');
  });
});

describe('cattura visiva', () => {
  /**
   * Ambiente minimo per la cattura: un elemento con geometria nota e un
   * finto screenshot. jsdom non implementa il canvas, quindi le operazioni di
   * disegno sono simulate.
   */
  function captureEnvironment({ captureVisibleTab } = {}) {
    const element = document.createElement('div');
    element.setAttribute(LIVE_MARKER_ATTRIBUTE, 'app-1');
    // Un DOMRect vero, non un oggetto semplice: le sue proprietà stanno sul
    // prototipo, e il codice che lo copia con lo spread le perde. Un doppio
    // "comodo" nascondeva il difetto descritto in docs/BUGFIX-CATTURA-DOMRECT.md.
    element.getBoundingClientRect = () => new window.DOMRect(50, 100, 600, 400);
    document.body.appendChild(element);

    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL: () => 'data:image/png;base64,Q0FUVFVSQQ==',
    };

    const doc = {
      querySelector: (selector) => document.querySelector(selector),
      createElement: () => canvas,
    };

    const win = {
      devicePixelRatio: 2,
      innerHeight: 800,
      scrollY: 0,
      scrollTo: vi.fn(),
      // Nessun antenato dichiara un overflow scorrevole: il catturatore
      // ricade sulla finestra, come su una pagina che scorre normalmente.
      getComputedStyle: () => ({ overflowY: 'visible' }),
      Image: class {
        set src(_value) {
          setTimeout(() => this.onload?.(), 0);
        }
      },
    };

    const capture = createAppCapture({
      captureVisibleTab:
        captureVisibleTab ?? vi.fn(async () => 'data:image/png;base64,U0NIRVJNTw=='),
      document: /** @type {any} */ (doc),
      window: /** @type {any} */ (win),
      logger,
      wait: async () => {},
    });

    return { capture, win, canvas, element };
  }

  it('produce un data URI dell\u2019area occupata dal contenuto', async () => {
    const { capture } = captureEnvironment();

    await expect(capture.capture('app-1')).resolves.toMatch(/^data:image\/png;base64,/);
  });

  it('converte le coordinate CSS in pixel fisici', async () => {
    // Ignorare devicePixelRatio produce ritagli sfalsati su ogni schermo ad
    // alta densità: il canvas deve misurare 600×400 CSS × 2.
    const { capture, canvas } = captureEnvironment();

    await capture.capture('app-1');

    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(800);
  });

  it('scorre la pagina per portare il contenuto nel viewport', async () => {
    const { capture, win } = captureEnvironment();

    await capture.capture('app-1');

    expect(win.scrollTo).toHaveBeenCalled();
  });

  it('restituisce null se il contenuto non è più nella pagina', async () => {
    const { capture } = captureEnvironment();

    await expect(capture.capture('app-inesistente')).resolves.toBeNull();
  });

  it('restituisce null se lo scatto fallisce, senza propagare l\u2019errore', async () => {
    // Un grafico non catturabile non deve impedire l'esportazione del testo.
    const { capture } = captureEnvironment({
      captureVisibleTab: vi.fn(async () => {
        throw new Error('permesso negato');
      }),
    });

    await expect(capture.capture('app-1')).resolves.toBeNull();
  });

  it('ripristina la posizione di scorrimento iniziale', async () => {
    // L'utente non ha chiesto di essere spostato in fondo alla conversazione.
    const { capture, win } = captureEnvironment();
    const root = elementFrom(`<figure ${APP_ID_ATTRIBUTE}="app-1"><img></figure>`);

    await capture.captureAll(root, APP_ID_ATTRIBUTE);

    expect(win.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
  });

  it('valorizza la sorgente dell\u2019immagine del segnaposto', async () => {
    const { capture } = captureEnvironment();
    const root = elementFrom(`<figure ${APP_ID_ATTRIBUTE}="app-1"><img></figure>`);

    const outcome = await capture.captureAll(root, APP_ID_ATTRIBUTE);

    expect(outcome).toEqual({ captured: 1, failed: 0 });
    expect(root.querySelector('img').getAttribute('src')).toMatch(/^data:image\/png/);
  });

  it('lascia la didascalia quando la cattura non riesce', async () => {
    const { capture } = captureEnvironment();
    const root = elementFrom(
      `<figure ${APP_ID_ATTRIBUTE}="assente"><img><figcaption>Grafico</figcaption></figure>`
    );

    const outcome = await capture.captureAll(root, APP_ID_ATTRIBUTE);

    expect(outcome).toEqual({ captured: 0, failed: 1 });
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('figcaption').textContent).toBe('Grafico');
    expect(root.querySelector('figure').getAttribute('data-capture-failed')).toBe('true');
  });
});

describe('caso d\u2019uso di incorporamento delle catture', () => {
  /** @param {string} html */
  function conversationWith(html) {
    return createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'D' }),
          createMessage({ role: 'model', text: 'R', html: sanitizeElement(elementFrom(html)) })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });
  }

  /** @param {{ captured: number, failed: number }} outcome */
  function useCaseWith(outcome, onCapture = () => {}) {
    return createEmbedAppCapturesUseCase({
      appCapture: {
        captureAll: vi.fn(async (root) => {
          onCapture(root);
          return outcome;
        }),
      },
      idAttribute: APP_ID_ATTRIBUTE,
      parseHtml: (html) => elementFrom(html),
      sanitize: sanitizeElement,
      logger,
    });
  }

  it('sostituisce i segnaposto con le immagini catturate', async () => {
    const embed = useCaseWith({ captured: 1, failed: 0 }, (root) => {
      root.querySelector('img').setAttribute('src', 'data:image/png;base64,QUJD');
    });

    const result = await embed(
      conversationWith(`<figure ${APP_ID_ATTRIBUTE}="app-1"><img></figure>`)
    );

    expect(result.captured).toBe(1);
    expect(result.conversation.turns[0].modelMessage.html.value).toContain('data:image/png');
  });

  it('non tocca i messaggi privi di contenuti interattivi', async () => {
    const captureAll = vi.fn();
    const embed = createEmbedAppCapturesUseCase({
      appCapture: { captureAll },
      idAttribute: APP_ID_ATTRIBUTE,
      parseHtml: (html) => elementFrom(html),
      sanitize: sanitizeElement,
      logger,
    });

    await embed(conversationWith('<p>Solo testo</p>'));

    expect(captureAll).not.toHaveBeenCalled();
  });

  it('ri-sanifica il contenuto modificato', async () => {
    // Nulla rientra nel modello senza passare dall'allowlist, nemmeno ciò che
    // abbiamo prodotto noi stessi.
    const embed = useCaseWith({ captured: 0, failed: 1 }, (root) => {
      root.innerHTML += '<script>alert(1)</script>';
    });

    const result = await embed(
      conversationWith(`<figure ${APP_ID_ATTRIBUTE}="app-1"><img></figure>`)
    );

    expect(result.conversation.turns[0].modelMessage.html.value).not.toContain('<script');
  });
});

describe('resa nei formati di destinazione', () => {
  it('inserisce l\u2019immagine catturata nel documento Word', () => {
    const images = createImageCollector();
    const pixel =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

    const xml = convertHtmlToOoxml(
      elementFrom(
        `<figure ${APP_ID_ATTRIBUTE}="app-1"><img src="${pixel}"><figcaption>Grafico</figcaption></figure>`
      ),
      { images }
    );

    expect(xml).toContain('<w:drawing>');
    expect(images.isEmpty()).toBe(false);
  });

  it('distingue la didascalia dal corpo del testo', () => {
    const xml = convertHtmlToOoxml(
      elementFrom(`<figure ${APP_ID_ATTRIBUTE}="app-1"><figcaption>Grafico</figcaption></figure>`)
    );

    expect(xml).toContain('<w:pStyle w:val="Caption"/>');
  });
});

describe('individuazione del contenitore che scorre', () => {
  /**
   * Riproduce la struttura reale di Gemini: la cronologia vive in un
   * contenitore con `overflow: hidden scroll`, e la finestra NON scorre.
   * È la causa per cui la cattura falliva restituendo il segnaposto.
   */
  function geminiLikeDom({ overflowY = 'scroll', scrollHeight = 5000 } = {}) {
    const scroller = document.createElement('infinite-scroller');
    const target = document.createElement('div');
    scroller.appendChild(target);
    document.body.appendChild(scroller);

    Object.defineProperty(scroller, 'scrollHeight', { value: scrollHeight });
    Object.defineProperty(scroller, 'clientHeight', { value: 600 });
    scroller.scrollTop = 0;
    scroller.getBoundingClientRect = () => ({ top: 60, height: 600 });

    const win = /** @type {any} */ ({
      getComputedStyle: (node) => (node === scroller ? { overflowY } : { overflowY: 'visible' }),
      scrollY: 0,
      innerHeight: 900,
      scrollTo: vi.fn(),
    });

    return { scroller, target, win };
  }

  it('trova il contenitore interno invece della finestra', () => {
    const { scroller, target, win } = geminiLikeDom();

    const found = findScroller(target, win);
    found.scrollTo(450);

    // Se avesse scelto la finestra, `scrollTop` sarebbe rimasto a zero: è
    // esattamente il difetto per cui il grafico non entrava mai nel viewport.
    expect(scroller.scrollTop).toBe(450);
    expect(win.scrollTo).not.toHaveBeenCalled();
  });

  it('espone l\u2019area visibile del contenitore, non quella della finestra', () => {
    const { target, win } = geminiLikeDom();

    expect(findScroller(target, win).viewport()).toEqual({ top: 60, height: 600 });
  });

  it('ricade sulla finestra quando nessun antenato scorre', () => {
    const { target, win } = geminiLikeDom({ overflowY: 'visible' });

    const found = findScroller(target, win);
    found.scrollTo(120);

    expect(win.scrollTo).toHaveBeenCalledWith({ top: 120, behavior: 'instant' });
    expect(found.viewport()).toEqual({ top: 0, height: 900 });
  });

  it('ignora i contenitori che dichiarano overflow ma non eccedono', () => {
    // `overflow: auto` su un contenitore che sta tutto dentro non produce
    // scorrimento: sceglierlo bloccherebbe la cattura su un elemento immobile.
    const { target, win } = geminiLikeDom({ overflowY: 'auto', scrollHeight: 600 });

    findScroller(target, win).scrollTo(300);

    expect(win.scrollTo).toHaveBeenCalledWith({ top: 300, behavior: 'instant' });
  });
});

describe('permesso di cattura mancante', () => {
  /**
   * `captureVisibleTab` esige il permesso `<all_urls>`: un permesso host
   * circoscritto a gemini.google.com non basta, e l'API risponde
   * «Either the '<all_urls>' or 'activeTab' permission is required».
   * Senza permesso la cattura non va nemmeno tentata.
   */
  function captureWithoutPermission() {
    const captureVisibleTab = vi.fn();
    const scrollTo = vi.fn();

    // L'elemento DEVE essere trovabile: se il finto documento restituisse null
    // la cattura si fermerebbe comunque, e il test passerebbe anche senza la
    // verifica del permesso — dimostrando nulla.
    const live = document.createElement('div');
    live.setAttribute(LIVE_MARKER_ATTRIBUTE, 'app-1');
    live.getBoundingClientRect = () => ({ top: 10, left: 0, width: 400, height: 300 });
    document.body.appendChild(live);

    const capture = createAppCapture({
      captureVisibleTab,
      document: /** @type {any} */ ({
        querySelector: (selector) => document.querySelector(selector),
        createElement: () => ({
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toDataURL: () => 'data:image/png;base64,WA==',
        }),
      }),
      window: /** @type {any} */ ({
        devicePixelRatio: 1,
        innerHeight: 800,
        scrollY: 0,
        scrollTo,
        getComputedStyle: () => ({ overflowY: 'visible' }),
        Image: class {
          set src(_value) {
            setTimeout(() => this.onload?.(), 0);
          }
        },
      }),
      logger,
      wait: async () => {},
      canCapture: async () => false,
    });

    return { capture, captureVisibleTab, scrollTo };
  }

  it('non tenta la cattura e non scorre la pagina', async () => {
    // Scorrere la cronologia è l'operazione visibile e fastidiosa: farlo per
    // un'operazione destinata a fallire è il peggiore dei risultati.
    const { capture, captureVisibleTab, scrollTo } = captureWithoutPermission();
    const root = elementFrom(`<figure ${APP_ID_ATTRIBUTE}="app-1"><img></figure>`);

    await capture.captureAll(root, APP_ID_ATTRIBUTE);

    expect(captureVisibleTab).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('riduce i segnaposto alla sola didascalia', async () => {
    const { capture } = captureWithoutPermission();
    const root = elementFrom(
      `<figure ${APP_ID_ATTRIBUTE}="app-1"><img><figcaption>Grafico</figcaption></figure>`
    );

    const outcome = await capture.captureAll(root, APP_ID_ATTRIBUTE);

    expect(outcome).toEqual({ captured: 0, failed: 1 });
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('figcaption').textContent).toBe('Grafico');
  });

  it('non interroga il permesso quando non ci sono grafici', async () => {
    // La stragrande maggioranza delle esportazioni non contiene grafici: non
    // devono pagare il costo di una verifica inutile.
    const canCapture = vi.fn(async () => false);
    const capture = createAppCapture({
      captureVisibleTab: vi.fn(),
      document: /** @type {any} */ ({ querySelector: () => null, createElement: () => ({}) }),
      window: /** @type {any} */ ({ getComputedStyle: () => ({ overflowY: 'visible' }) }),
      logger,
      canCapture,
    });

    await capture.captureAll(elementFrom('<p>Solo testo</p>'), APP_ID_ATTRIBUTE);

    expect(canCapture).not.toHaveBeenCalled();
  });
});

describe('conformità del pacchetto Word', () => {
  const PIXEL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  /** @param {string} html */
  async function renderPackage(html) {
    const element = elementFrom(html);
    const conversation = createConversation({
      title: 'Test',
      turns: [
        createTurn(
          createMessage({ role: 'user', text: 'D' }),
          createMessage({ role: 'model', text: 'R', html: sanitizeElement(element) })
        ),
      ],
      source: { app: 'gemini', url: '' },
    });

    const bytes = await createDocxRenderer({ document }).render(conversation, {});
    return new TextDecoder('latin1').decode(bytes);
  }

  it('numera le relazioni delle immagini nella forma rId<numero>', async () => {
    // La specifica ammette qualunque stringa, ma Word emette e si aspetta
    // `rId<numero>`: un identificatore fuori convenzione viene risolto da
    // LibreOffice e ignorato da Word, che scarta il disegno in silenzio.
    const archive = await renderPackage(
      `<figure ${APP_ID_ATTRIBUTE}="app-1"><img src="${PIXEL}"></figure>`
    );

    expect(archive).toMatch(/Id="rId5"[^>]*relationships\/image/);
    expect(archive).toContain('r:embed="rId5"');
    expect(archive).not.toContain('rIdImg');
  });

  it('non riusa gli identificatori delle relazioni fisse', async () => {
    // rId1…rId4 appartengono a stili, numerazione, impostazioni e font: un
    // duplicato farebbe puntare il disegno alla parte sbagliata.
    const archive = await renderPackage(
      `<figure ${APP_ID_ATTRIBUTE}="a"><img src="${PIXEL}"></figure>` +
        `<figure ${APP_ID_ATTRIBUTE}="b"><img src="${PIXEL}"></figure>`
    );

    expect(archive).toMatch(/Id="rId5"[^>]*relationships\/image/);
    expect(archive).toMatch(/Id="rId6"[^>]*relationships\/image/);
    for (const reserved of ['rId1', 'rId2', 'rId3', 'rId4']) {
      expect(archive).not.toMatch(new RegExp(`Id="${reserved}"[^>]*relationships/image`));
    }
  });

  it('colloca le parti binarie prima di docProps', () => {
    // È l'ordine che Word stesso produce: tutto ciò che sta sotto `word/`
    // raggruppato, poi le proprietà del documento.
    const images = createImageCollector();
    images.add(PIXEL);

    const paths = buildPackageParts({
      documentXml: '<w:document/>',
      conversation: { title: 'T', exportedAt: new Date() },
      images,
    }).map((part) => part.path);

    expect(paths[0]).toBe('[Content_Types].xml');
    expect(paths.indexOf('word/media/image1.png')).toBeLessThan(paths.indexOf('docProps/core.xml'));
  });
});
