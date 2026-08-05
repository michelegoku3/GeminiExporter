# FASE 2 — Proposta di architettura

## Principio guida

Una catena a tre stadi con un **modello dati al centro**:

```
DOM Gemini ──[adapter]──> Conversation (dati puri) ──[renderer]──> Documento HTML ──[exporter]──> PDF
   fragile                     stabile e testabile              indipendente da Gemini
```

- Il **parser non sa cosa sia un PDF**.
- Il **renderer non sa cosa sia Gemini** (riceve solo il modello dati).
- La **UI non contiene business logic** (chiama un solo use case).
- Il **modello dati** è l'unico contratto fra i livelli: è ciò che si testa.

Niente DI container, niente factory astratte, niente event bus. Dependency injection **solo via parametri di funzione/costruttore** dove serve davvero (adapter, logger, clock, loader risorse) — così i test non hanno bisogno di mock globali.

## Stack proposto

| Scelta                                                                | Motivazione                                                                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript**                                                        | Il valore reale è tipizzare il modello dati e il contratto degli adapter: rende impossibile passare un nodo DOM al renderer. Costo basso. |
| **Vite + `@crxjs`-free build custom** (o `vite-plugin-web-extension`) | Bundling di moduli ES in content script classico, import di `.css?inline`, build separate Chrome/Firefox.                                 |
| **Vitest + jsdom**                                                    | Test del parser su fixture HTML reali di Gemini.                                                                                          |
| **ESLint (flat config) + Prettier**                                   | Qualità e stile coerenti.                                                                                                                 |
| **Zero dipendenze runtime**                                           | Requisito preservato: KaTeX CSS resta un asset locale.                                                                                    |

## Struttura dei file

```
gemini-exporter/
├── manifest.chrome.json / manifest.firefox.json
├── package.json  vite.config.ts  tsconfig.json  eslint.config.js  .prettierrc
├── src/
│   ├── core/                        # business logic, ZERO API browser, ZERO DOM Gemini
│   │   ├── model/
│   │   │   ├── conversation.ts      # Conversation, Message, Attachment, ContentBlock
│   │   │   └── factories.ts         # costruttori/validatori del modello
│   │   ├── ports.ts                 # interfacce: ConversationSource, DocumentRenderer, DocumentSink, AssetLoader, Logger
│   │   └── usecases/
│   │       └── export-conversation.ts  # UN solo use case orchestratore, iniettato
│   │
│   ├── gemini/                      # TUTTA la conoscenza del DOM di Gemini vive qui
│   │   ├── selectors.ts             # registry: ogni concetto = LISTA ordinata di selettori (fallback)
│   │   ├── dom-query.ts             # queryFirst(el, candidates) + diagnostica su quale selettore ha matchato
│   │   ├── extractors/
│   │   │   ├── user-message.ts      # testo + allegati -> Message
│   │   │   └── model-response.ts    # clone risposta -> HTML sanificato -> Message
│   │   ├── sanitize/
│   │   │   ├── html-sanitizer.ts    # ALLOWLIST tag/attributi (risolve P0-1)
│   │   │   ├── noise-removal.ts     # footnote, source chip, screen reader, toolbar
│   │   │   ├── code-blocks.ts       # normalizza <pre> (sostituisce le 7 euristiche con 2 regole chiare)
│   │   │   ├── katex.ts             # fix MathML + fallback LaTeX
│   │   │   └── attributes.ts        # rimozione attributi Angular (allowlist-based)
│   │   └── gemini-source.ts         # implementa ConversationSource
│   │
│   ├── render/                      # generatore documento, NON sa nulla di Gemini
│   │   ├── html-document.renderer.ts
│   │   ├── templates/               # header, user-message, response, footer, print-toolbar
│   │   └── styles/                  # document.css, print.css, katex-overrides.css (import ?inline)
│   │
│   ├── export/
│   │   ├── print-tab.sink.ts        # blob -> nuova tab (+ fallback download .html)
│   │   └── filename.ts             # una sola funzione di sanitizzazione nome file
│   │
│   ├── extension/                   # unico livello che tocca chrome.*/browser.*
│   │   ├── content/
│   │   │   ├── main.ts              # composition root: costruisce e collega tutto
│   │   │   ├── response-watcher.ts  # MutationObserver con debounce + idle callback
│   │   │   ├── button-injector.ts   # injection e stati del bottone
│   │   │   └── toast.ts
│   │   ├── background/service-worker.ts   # opzionale: apertura tab, keep-alive minimale
│   │   ├── popup/                   # info + preferenze (titolo doc, lingua, include allegati)
│   │   └── platform/browser.ts      # wrapper chrome/browser (runtime.getURL, storage)
│   │
│   └── shared/
│       ├── config.ts                # tutte le costanti (timeout, limiti, classi CSS)
│       ├── logger.ts                # livelli, prefisso, silenzioso in produzione
│       ├── errors.ts                # ExportError tipizzata: SELECTOR_NOT_FOUND, EMPTY_RESPONSE, POPUP_BLOCKED...
│       └── result.ts                # Result<T,E> per i percorsi attesi (niente throw per il flusso normale)
│
├── tests/
│   ├── fixtures/                    # HTML reali di Gemini (code, tabelle, KaTeX, allegati, HTML "rotto")
│   └── unit/                        # parser, sanitizer, modello, renderer, filename
└── docs/  ANALYSIS.md  ARCHITECTURE.md  CONTRIBUTING.md
```

## Contratti chiave (bozza)

```ts
// core/model/conversation.ts
export interface Attachment {
  name: string;
  extension: string;
}
export interface Message {
  role: 'user' | 'model';
  text: string; // sempre presente (fallback testuale)
  html?: SafeHtml; // presente solo per contenuto ricco già sanificato
  attachments: Attachment[];
}
export interface Conversation {
  title: string;
  exportedAt: Date;
  messages: Message[]; // 2 oggi (turno singolo), N domani: nessuna rottura
  source: { app: 'gemini'; url: string };
}

// core/ports.ts
export interface ConversationSource {
  extract(scope: unknown): Result<Conversation, ExportError>;
}
export interface DocumentRenderer {
  render(c: Conversation, o: RenderOptions): string;
}
export interface DocumentSink {
  deliver(doc: string, filename: string): Promise<DeliveryOutcome>;
}
```

`SafeHtml` è un branded type: **solo** il sanitizer può produrlo ⇒ il compilatore impedisce di far arrivare HTML grezzo al renderer (mitigazione strutturale di P0-1).

## Resilienza ai cambi HTML di Gemini (P0-5)

1. **Selettori come liste ordinate** con fallback semantici:
   `response: ['message-content .markdown.markdown-main-panel', 'message-content .markdown', 'model-response [class*="markdown"]', 'model-response']`.
2. `queryFirst` logga **quale** livello ha matchato; se scatta un fallback ⇒ `logger.warn('selector drift', concept, index)`.
3. Se nessun candidato matcha ⇒ `ExportError.selectorNotFound(concept)` con messaggio utente comprensibile: _"Gemini ha cambiato la sua interfaccia: aggiorna l'estensione"_, non un generico "errore".
4. Un test `selectors.contract.test.ts` sulle fixture verifica che ogni concetto risolva almeno un candidato.

## Performance (P2-1/2)

- Observer con **debounce ~250 ms** + `requestIdleCallback`, osservando il container della chat quando disponibile (non `document.body`).
- Scan **incrementale**: si visitano solo i `.conversation-container` non ancora marcati, tramite `WeakSet` (nessun attributo scritto nel DOM di Google).
- Polling di sicurezza rimosso; sostituito da un re-attach dell'observer sui cambi di route (SPA) — comportamento equivalente, costo molto inferiore.

## Cosa NON farò (anti-over-engineering)

- Nessun DI container, nessun repository/CQRS, nessuna state machine.
- Nessun framework nel popup (HTML + TS vanilla).
- Nessuna libreria PDF (jsPDF/pdfmake): il `window.print()` preserva KaTeX e i font ed è a zero dipendenze — è la scelta giusta e va mantenuta.
- Nessun cambio nel comportamento utente osservabile.

## Roadmap di esecuzione (Fase 3+)

1. Scaffold tooling (package, TS, Vite, ESLint, Prettier, Vitest) + manifest Chrome/Firefox.
2. `shared/` + `core/model` + `core/ports` + use case.
3. `gemini/` (selettori, sanitizer, extractor) + fixture e test — **il pezzo con più valore**.
4. `render/` con CSS estratto in file separati (parità 1:1 con l'output attuale).
5. `export/` + `extension/` (watcher, injector, toast, popup, service worker).
6. Test, README, docs architettura, checklist di non-regressione manuale.

---

**Serve la tua conferma prima di procedere con la riscrittura completa (Fase 3).**
Le uniche decisioni aperte sono in fondo al mio messaggio.
