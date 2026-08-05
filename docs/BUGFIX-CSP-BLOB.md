# Bugfix — La CSP di Google bloccava i font: le pagine `blob:` ereditano la policy

**Data:** 25 luglio 2026
**Versione interessata:** 2.0.3 e tutte le precedenti
**Gravità:** alta (formule degradate in ogni esportazione)
**Stato:** risolto, causa dimostrata

---

## 1. La prova

I log della console forniti dall'utente contengono la diagnosi completa:

```
20×  Loading the font '<URL>' violates the following Content Security Policy
     directive: "font-src <URL> <URL>". The action has been blocked.

 1×  Executing inline script violates the following Content Security Policy
     directive 'script-src 'report-sample' 'nonce-iyXzRa4sTNGnJdJWLCXD1w'
     'unsafe-inline' 'unsafe-eval' 'strict-dynamic' https: http:'.
```

**Venti font bloccati** — esattamente il numero dei font KaTeX incorporati. E
lo script bloccato è l'auto-diagnosi che avevo aggiunto proprio per segnalare
questo problema: ecco perché l'avviso giallo non era comparso.

Il `nonce-iyXzRa4sTNGnJdJWLCXD1w` è la firma inequivocabile: è la CSP di
**gemini.google.com**, non una policy del nostro documento.

---

## 2. Causa

Il documento veniva consegnato così:

```js
const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
const blobUrl = URL.createObjectURL(blob);
window.open(blobUrl, '_blank');
```

Sembra un documento indipendente. Non lo è.

> **Una pagina `blob:` eredita l'origine e la Content Security Policy del
> documento che ha creato il blob.**

Il blob nasceva nel content script iniettato in gemini.google.com, quindi il
documento esportato ereditava la policy di Google, che impone fra l'altro:

```
font-src https://fonts.gstatic.com https://www.gstatic.com
```

Nessun `data:` nell'elenco. Di conseguenza **tutti e venti i font incorporati
come data URI venivano rifiutati dal browser**, per quanto perfettamente validi.

E i sintomi seguono con precisione:

| Elemento                       | Font necessario | Esito senza font                                                  |
| ------------------------------ | --------------- | ----------------------------------------------------------------- |
| `(` `[` `{` grandi             | `KaTeX_Size1-4` | Ripiego su font di testo → parentesi di altezza normale, centrata |
| `∑` `∫` grandi                 | `KaTeX_Size2`   | Appena più grandi del testo                                       |
| `≠` (U+E020, Private Use Area) | `KaTeX_Main`    | Nessun font di sistema lo possiede → rettangolo vuoto             |
| Graffa di `cases` (U+23A7/8/9) | `KaTeX_Size4`   | Pezzi mancanti → graffa spezzata                                  |

Tutto quanto segnalato negli ultimi due giri di feedback discende da questa
unica causa.

---

## 3. Perché non l'avevo trovato prima

Nel giro precedente avevo scritto: _«Presenza di una CSP nella pagina: ✅
nessuna»_. La verifica era **corretta ma applicata all'oggetto sbagliato**:
avevo cercato un `<meta http-equiv="Content-Security-Policy">` dentro l'HTML
salvato da Gemini. Le CSP reali però arrivano come **header HTTP**, e soprattutto
il punto non era la CSP _della pagina di Gemini_ ma quella **ereditata dal
documento blob**, che nel mio ambiente di test non esisteva perché usavo
`page.setContent()` — che non crea alcun blob e non eredita nulla.

Ho testato per tre giri consecutivi un artefatto che non poteva riprodurre il
difetto. Il PDF generato qui era davvero corretto; semplicemente non era il PDF
che otteneva l'utente.

Il dato che avrebbe dovuto orientarmi era già nelle mie mani: _«il documento è
corretto qui, rotto lì»_. Con codice identico e input identici, la differenza
può stare solo nel **contesto di esecuzione** — ed è la prima cosa da
interrogare, non l'ultima.

---

## 4. Soluzione

Il documento non deve più nascere in un contesto che appartiene a Google. Ora
viene servito da una **pagina dell'estensione**, che ha una CSP propria.

```
PRIMA                                    DOPO
content script                           content script
  └─ Blob(html)                            └─ storage.local.set(html)
      └─ blob:https://gemini.google.com        └─ chrome-extension://…/viewer.html?doc=…
          └─ eredita la CSP di Google              └─ CSP del manifest
              └─ font data: BLOCCATI                    └─ font data: consentiti
```

**Manifest** — CSP esplicita per le pagine dell'estensione:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'; font-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
}
```

**Trasporto tramite storage, non tramite URL.** Con i font incorporati il
documento supera i 600 KB: non può viaggiare in una query string. Il content
script deposita l'HTML in `storage.local` con una chiave monouso, il viewer lo
legge e lo cancella subito.

**Niente più codice inline.** La nuova CSP impone `script-src 'self'`, quindi
sono stati eliminati:

- l'attributo `onclick="window.print()"` del pulsante di stampa, sostituito da
  un `addEventListener`;
- il `<script>` inline di verifica dei font.

Il comportamento vive ora in `src/render/document-behaviour.js`, con **un'unica
definizione** usata in due modi:

- la **pagina dell'estensione** importa il modulo e invoca la funzione;
- il **file scaricato** e il fallback `blob:` la ricevono serializzata con
  `toString()` dentro uno `<script>`, perché lì non esistono moduli da importare.

Serializzare invece di duplicare garantisce che i due percorsi non divergano.

**Rendering differito.** Il documento dipende ora dal canale di consegna, quindi
lo use case non passa più una stringa al sink, ma una funzione:

```js
const renderDocument = (overrides = {}) =>
  renderer.render(conversation, { ...preferences, ...overrides });

const { method } = await sink.deliver(renderDocument, filename);
```

Il sink sceglie: `{ inlineBehaviour: false }` per la pagina dell'estensione,
`true` per il file scaricato.

**Degrado controllato.** Se lo storage non è disponibile (quota, API assenti) si
ricade sul vecchio percorso `blob:`, e se anche la scheda è bloccata sul
download del file. Un file aperto da disco non eredita alcuna policy esterna,
quindi i font tornano a funzionare.

---

## 5. Verifica

### Riproduzione del difetto e conferma del fix

Ho reso lo stesso documento in Chromium sotto le due policy, usando la CSP
esatta riportata dall'utente:

| Contesto                                   | Font caricati            | Altezza delimitatore | Violazioni CSP |
| ------------------------------------------ | ------------------------ | -------------------- | -------------- |
| **Con la CSP di Gemini** (vecchio `blob:`) | **0 / 20**               | **20 px**            | **21**         |
| **Senza** (pagina dell'estensione)         | 9 / 20 richiesti a video | **43 px**            | **0**          |

Il difetto è riprodotto e la correzione è dimostrata: la stessa identica pagina
passa da 20 a 43 px di altezza del delimitatore al solo cambiare del contesto.
Le 21 violazioni corrispondono ai 20 font più lo script inline — gli stessi
numeri dei log dell'utente.

### Test

`tests/unit/csp-compliance.test.js` — 10 test:

- la consegna apre `chrome-extension://…/viewer.html` e **mai** un `blob:`;
- il documento per la pagina dell'estensione è reso con `inlineBehaviour: false`;
- il file scaricato lo riceve con `true`;
- il documento passa dallo storage, non dall'URL (verificata la lunghezza);
- nessun documento orfano nello storage se il popup è bloccato;
- fallback sul blob se lo storage fallisce;
- il manifest dichiara `font-src … data:` e `script-src 'self'` (entrambi i browser);
- `viewer.html` non contiene script inline;
- il comportamento è un modulo condiviso, non duplicato.

Suite completa: **120 test, tutti verdi.**

---

## 6. Lezione

**Il contesto di esecuzione è parte dell'input.** Per tre iterazioni ho
verificato il _contenuto_ del documento — markup, attributi, font, base64 —
mentre il difetto stava in _dove_ il documento veniva eseguito. Il contenuto era
corretto in ogni singolo byte, e infatti tutte le mie verifiche passavano.

Quando un artefatto identico si comporta diversamente in due ambienti, la
domanda giusta non è «cosa c'è di sbagliato nell'artefatto» ma «cosa cambia fra
i due ambienti». Avevo questa informazione dal primo momento — _«funziona da te,
non da me»_ — e ho impiegato tre giri a usarla.

Il corollario pratico: **i log dell'utente valgono più di qualunque mia
simulazione.** Le due righe di violazione CSP contenevano la risposta completa,
compreso il numero esatto (20) che la confermava.

---

## 7. File modificati

| File                                       | Modifica                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `src/extension/viewer/viewer.html`         | **Nuovo** — pagina ospite del documento                                        |
| `src/extension/viewer/viewer.js`           | **Nuovo** — legge dallo storage, scrive il documento, applica il comportamento |
| `src/render/document-behaviour.js`         | **Nuovo** — comportamento condiviso fra modulo e script serializzato           |
| `src/export/print-tab.sink.js`             | Consegna via pagina dell'estensione, fallback blob e download                  |
| `src/core/usecases/export-conversation.js` | Rendering differito: il sink sceglie le opzioni                                |
| `src/render/html-document.renderer.js`     | Script inline opzionale                                                        |
| `src/render/templates/sections.js`         | Rimosso `onclick`, pulsante con `id`                                           |
| `src/shared/config.js`                     | Preferenza `inlineBehaviour`                                                   |
| `manifest.json`, `manifest.firefox.json`   | CSP delle pagine dell'estensione, viewer accessibile                           |
| `tests/unit/csp-compliance.test.js`        | **Nuovo** — 10 test                                                            |
