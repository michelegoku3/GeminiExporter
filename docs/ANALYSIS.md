# FASE 1 — Analisi della codebase (baseline `b7c9ee6`)

## 1. Inventario e responsabilità

| File                 | LOC/peso                | Responsabilità dichiarata                 | Responsabilità reali                                                                                                                                        |
| -------------------- | ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`      | 30 righe                | MV3, content script su gemini.google.com  | OK, ma nessun `background`, nessun `popup`, nessun `action`                                                                                                 |
| `content.js`         | ~180 righe              | Observer + injection + orchestrazione     | Selettori DOM, injection UI, icona SVG inline, orchestrazione export, toast, polling                                                                        |
| `html-cleaner.js`    | **23.5 KB, ~700 righe** | "Pulizia HTML + generazione HTML per PDF" | **5 responsabilità distinte**: selettori Gemini, estrazione messaggio utente, sanitizzazione DOM, caricamento CSS KaTeX, template HTML+CSS completo del PDF |
| `pdf-exporter.js`    | ~70 righe               | Apertura tab + fallback download          | OK, ma nome fuorviante (non genera PDF: apre HTML e delega a `window.print()`)                                                                              |
| `content.css`        | ~120 righe              | Stile bottone + toast                     | OK                                                                                                                                                          |
| `libs/katex.min.css` | 26 KB                   | CSS KaTeX inlinato nell'export            | OK                                                                                                                                                          |

**Grafo delle dipendenze (attuale):** tutto passa da variabili globali del content script.

```
content.js ──> GeminiCleaner (global)   [estrazione + pulizia + template PDF]
           └─> PdfExporter   (global)   [apertura tab]
```

Non esistono moduli ES, build, test, linting, formatter, tipi, package.json.

---

## 2. Problemi rilevati

### 🔴 P0 — Critici (rischio rottura/sicurezza)

| #    | Problema                                                 | Dettaglio                                                                                                                                                                                                                                                                                                                                                         | Impatto                                                 |
| ---- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| P0-1 | **XSS nel documento esportato**                          | `buildPdfHtml` interpola `geminiHtml.innerHTML` grezzo in una pagina `blob:` aperta come tab. La pulizia rimuove _alcuni_ attributi ma **non** `on*` handler, `<script>`, `javascript:` href, `<iframe>`, `srcdoc`, `<style>` iniettati. Il contenuto proviene dal modello (prompt-injection ⇒ HTML arbitrario renderizzato in un contesto blob dell'estensione). | Esecuzione di script arbitrario nel documento esportato |
| P0-2 | **XHR sincrono** (`_getKatexCss` con `open(..., false)`) | Blocca il main thread di gemini.google.com ad ogni export; deprecato, i browser stampano warning e potrebbero rimuoverlo                                                                                                                                                                                                                                          | Freeze UI, futura rimozione API                         |
| P0-3 | **Bug reale in `_unwrapResponseElements`**               | `el.parentNode.replaceWith(fragment) \|\| el.parentNode.replaceChild(fragment, el)` — sostituisce **il genitore**, non l'elemento. `replaceWith` ritorna `undefined` ⇒ viene eseguito **anche** il secondo ramo su un nodo già staccato. Comportamento non deterministico, perdita di contenuto fratello                                                          | Perdita di contenuto nell'export                        |
| P0-4 | **`_fixNestedLists` usa `outerHTML = innerHTML`**        | Re-parsing di HTML non sanitizzato ⇒ secondo vettore di injection + perdita di riferimenti nodo                                                                                                                                                                                                                                                                   | Corruzione DOM + XSS                                    |
| P0-5 | **Fragilità totale sui selettori Gemini**                | ~15 selettori hard-coded (`.markdown.markdown-main-panel`, `model-response`, `.response-footer.complete`, `[data-test-id="uploaded-file"]`). Un cambio HTML di Google ⇒ **failure silenzioso** (bottone non appare, nessun log, nessun messaggio)                                                                                                                 | L'estensione muore senza diagnostica                    |

### 🟠 P1 — Alti (manutenibilità/architettura)

| #    | Problema                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-1 | **God object `GeminiCleaner`**: parser + sanitizer + template engine + loader risorse. Viola SoC; il "parser Gemini genera il PDF", esattamente ciò che va evitato                                                                                           |
| P1-2 | **Nessun modello dati intermedio**: si passano nodi DOM vivi da estrazione a rendering ⇒ impossibile testare, impossibile aggiungere altri formati (MD, HTML, JSON)                                                                                          |
| P1-3 | **CSS del PDF (~350 righe) dentro un template literal JS**: nessun highlighting, nessun lint, merge conflict garantiti                                                                                                                                       |
| P1-4 | **`_cleanCodeBlocks`: 7 "Casi" euristici sovrapposti**, ~120 righe, logica duplicata con `_isCodeBlockUi` e con `REMOVE_SELECTORS`. Alcune regole sono pericolose: `[data-test-id*="button"]` rimuove _qualsiasi_ elemento con quel test-id, anche contenuto |
| P1-5 | **Nessun error handling strutturato**: unico `try/catch` con messaggio generico "Errore nell'esportazione"; nessuna distinzione tra "risposta non trovata", "popup bloccato", "DOM cambiato"                                                                 |
| P1-6 | **Nessun test, nessun tooling** (lint/format/CI/tipi)                                                                                                                                                                                                        |
| P1-7 | **Magic numbers/stringhe sparsi**: `3000`, `180000`, `5000`, `2500`, `400`, `60`, `200`, `30`, classi CSS ripetute in JS e CSS                                                                                                                               |
| P1-8 | **Nessuna astrazione browser API**: `chrome.*` usato direttamente ⇒ nessuna compatibilità Firefox (il README parla di Brave, ma il requisito è Chrome/Firefox)                                                                                               |

### 🟡 P2 — Medi (performance/UX)

| #    | Problema                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-1 | **MutationObserver senza debounce su `document.body` subtree** + `setInterval(3000)` permanente. Ogni mutazione (Gemini ne genera migliaia durante lo streaming) lancia una `querySelectorAll` full-document | CPU sprecata durante lo streaming |
| P2-2 | Doppio meccanismo di scan (observer + polling) senza motivo documentato: il polling è un cerotto sull'observer                                                                                               |                                   |
| P2-3 | `EXPORT_ATTR` scritto sul DOM di Gemini (Angular può ricreare il nodo) ⇒ marker perso, ma `injectButton` ha già una guardia ⇒ ridondanza                                                                     |                                   |
| P2-4 | `SELECTORS` duplicati fra `content.js` e `html-cleaner.js` (`.markdown.markdown-main-panel`, `user-query`, `.query-text-line` definiti due volte)                                                            | Divergenza garantita              |
| P2-5 | Blob URL revocato dopo 180 s: se l'utente stampa più tardi, la tab è già morta senza spiegazione                                                                                                             |                                   |
| P2-6 | Auto-print annunciato nel README ma **rimosso** dal codice ⇒ documentazione già divergente                                                                                                                   |                                   |
| P2-7 | Testo UI in italiano hard-coded, nessuna i18n (`_locales`)                                                                                                                                                   |                                   |
| P2-8 | Nessun modo di esportare **l'intera conversazione** (solo singola risposta) — limite funzionale, non bug                                                                                                     |                                   |

### 🔵 P3 — Bassi

- `HIDE_SELECTORS` è un array vuoto mai usato (dead code).
- `PdfExporter.suggestFilename` non aggiunge estensione; `_sanitizeFilename` duplica la stessa logica con regex leggermente diversa.
- `console.log` non condizionato in produzione.
- `manifest.json` versione 1.3.0 con `permissions: []` — buono, va preservato.
- README descrive comportamenti non presenti (auto-print) e struttura non aggiornata.

---

## 3. Priorità di intervento

1. **P0-1 sanitizzazione XSS** — allowlist tag/attributi sul clone prima del rendering.
2. **P0-3 / P0-4 bug di manipolazione DOM** — riscrittura corretta di unwrap e list-fix.
3. **P0-2 XHR sincrono** → `fetch` async (o CSS come modulo importato a build time).
4. **P0-5 fragilità selettori** → registry di selettori con **catena di fallback** + diagnostica esplicita.
5. **P1-1/P1-2 architettura** → introdurre il modello dati `Conversation/Message` e separare parser ↔ renderer.
6. **P1-3 CSS** → file `.css` separati importati a build time.
7. **P1-6 tooling e test** → TypeScript + Vite + ESLint + Prettier + Vitest (jsdom).
8. **P2-1/P2-2 performance** → observer con debounce + `requestIdleCallback`, rimozione polling (o polling di sicurezza a bassa frequenza, configurabile).
9. **P1-8 cross-browser** → wrapper `browser` API e build target Chrome/Firefox.

---

## 4. Funzionalità da preservare (contratto di non-regressione)

1. Bottone 📄 iniettato nella actions bar di ogni risposta **completata**.
2. Adattamento dark mode del bottone (CSS esistente).
3. Estrazione messaggio utente: testo + file allegati (nome + estensione).
4. Pulizia risposta: footnote, source chip, screen-reader, toolbar code block, attributi Angular.
5. Fix KaTeX (rimozione MathML, fallback LaTeX testuale per `<math>` orfano) + CSS KaTeX inlinato offline con fallback CDN.
6. Generazione pagina HTML autosufficiente con header, blocco messaggio utente, risposta, footer, timestamp `it-IT`.
7. Toolbar "Salva come PDF" (`window.print()`), nascosta in stampa; stili `@page A4`, break-inside, ecc.
8. Apertura in nuova tab; **fallback download `.html`** se il popup è bloccato.
9. Toast di successo/errore/info.
10. Zero permessi nel manifest, zero dipendenze runtime, nessun iframe (compatibilità CSP).
