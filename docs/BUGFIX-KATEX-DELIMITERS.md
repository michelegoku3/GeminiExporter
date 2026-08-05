# Analisi — Delimitatori non ingranditi e glifo "≠" mancante

**Data:** 25 luglio 2026
**Versione:** 2.0.3
**Gravità:** media (formule leggibili, resa tipografica degradata)
**Stato:** causa identificata, diagnostica implementata — **richiede una verifica dell'utente**

---

## 1. Sintomi segnalati

Dopo la correzione degli SVG in data URI, radici e graffe orizzontali sono
corrette. Restano due difetti:

1. **Delimitatori non proporzionati.** Parentesi tonde, quadre e graffe attorno
   a frazioni, matrici e sistemi restano dell'altezza di un carattere normale,
   posizionate a metà altezza, invece di racchiudere l'intera espressione. Lo
   stesso vale per integrali e sommatorie, appena più grandi del testo.
2. **Glifo `≠` reso come rettangolo vuoto** nella funzione a tratti del
   capitolo 9, dove compare anche una graffa mal formata.

---

## 2. Cosa dicono i due sintomi, letti insieme

I due difetti sembrano indipendenti, ma condividono una spiegazione.

**I delimitatori grandi.** KaTeX non ingrandisce il carattere `(`: lo sostituisce
con la variante presa da un font dedicato.

```html
<span class="mopen delimcenter" style="top:0em">
  <span class="delimsizing size3">(</span>
</span>
```

```css
.katex .delimsizing.size3 {
  font-family: KaTeX_Size3;
}
```

È lo stesso identico carattere `(`: cambia **solo** la famiglia di font. Se
`KaTeX_Size3` non è applicabile, il browser ripiega su un font di testo, che
contiene sì una parentesi — ma di altezza normale. Risultato: parentesi piccola,
centrata verticalmente dallo stile `delimcenter`. **Esattamente il sintomo
descritto.** Vale identicamente per `\sum` e `\int`, che usano
`.op-symbol.large-op { font-family: KaTeX_Size2 }`.

**Il glifo `≠`.** Ho estratto i codepoint reali dalla funzione a tratti:

```
"⎩" U+23A9   "⎨" U+23A8   "⎧" U+23A7     ← pezzi della graffa grande
"−" U+2212   "​" U+200B    " " U+00A0
""  U+E020                                ← il "non uguale"
```

`U+E020` appartiene alla **Private Use Area** di Unicode: è un codepoint senza
significato standard, che esiste **unicamente dentro `KaTeX_Main`**. Nessun font
di sistema può fornirlo. Se `KaTeX_Main` non si applica, quel carattere è
necessariamente un rettangolo vuoto. Analogamente `U+23A7/8/9` sono i pezzi
componibili della graffa grande, presenti nei font `Size*`.

**Conclusione:** entrambi i sintomi indicano che, nel browser dell'utente,
**i font KaTeX non vengono applicati** — nonostante siano incorporati nel
documento come data URI.

---

## 3. Verifiche eseguite

Ho controllato ogni anello della catena. **Nel mio ambiente è tutto corretto**,
e questo è il dato più importante del presente documento.

| Verifica                                             | Esito                                        |
| ---------------------------------------------------- | -------------------------------------------- |
| Magic bytes dei 20 `.woff2` sorgente                 | ✅ tutti `wOF2`                              |
| Base64 nel documento: decodifica e magic bytes       | ✅ `Size1-4` validi, dimensioni esatte       |
| Bilanciamento di commenti e parentesi graffe nei CSS | ✅ nessuna regola malformata                 |
| `@font-face` presenti nel documento generato         | ✅ 20                                        |
| Presenza di una CSP nella pagina                     | ✅ nessuna                                   |
| Pattern `web_accessible_resources`                   | ✅ `src/**` e `assets/styles/*.css` corretti |
| `katex-fonts.css` incluso nel pacchetto              | ✅ 349 KB in `dist/chrome/assets/styles/`    |
| Font caricati in Chromium (`document.fonts`)         | ✅ `Size1-4` tutti `loaded`                  |
| Font effettivo del delimitatore (`getComputedStyle`) | ✅ `KaTeX_Size3`, altezza 43 px              |
| Rendering a schermo                                  | ✅ parentesi a piena altezza, `≠` corretto   |
| **PDF generato con Chromium**                        | ✅ **corretto**                              |
| Font incorporati nel PDF (`pdffonts`)                | ✅ `KaTeX_Size1/2/3/4` tutti presenti        |

Ho poi eseguito l'**esperimento di falsificazione**: ho rimosso le sole
`@font-face` dei font `Size*` dal documento e rigenerato l'immagine.

Il risultato riproduce **esattamente** lo screenshot dell'utente: parentesi
piccole e centrate attorno alla somma di derivate parziali, tutto il resto
invariato.

**L'ipotesi è quindi confermata nel meccanismo** (font non applicati → questo
identico sintomo) **ma non riproducibile nel mio ambiente**, dove i font si
applicano regolarmente.

---

## 4. Perché il fix precedente può non essere arrivato all'utente

Poiché il documento generato qui è corretto, la differenza sta in _quale codice
ha prodotto il PDF dell'utente_. Le cause plausibili, in ordine di probabilità:

1. **L'estensione ricaricata non è quella aggiornata.** In Chrome, dopo una
   modifica agli asset, occorre premere _Ricarica_ nella pagina delle estensioni
   **e** ricaricare la scheda di Gemini: il content script resta altrimenti
   quello vecchio in memoria.
2. **Il pacchetto caricato non contiene `katex-fonts.css`.** La cartella `dist/`
   è in `.gitignore` e va rigenerata con `npm run package:chrome` dopo ogni
   `git pull`. Caricare la cartella del repository _senza_ aver eseguito
   `npm run build:fonts` produce un'estensione priva del foglio dei font.
3. **Il `fetch` dell'asset fallisce a runtime** (percorso non accessibile,
   estensione non ricaricata correttamente).

Il punto 3 rivela un difetto **reale e mio** nel codice, indipendente dalla
causa specifica: era gestito in modo silenzioso.

---

## 5. Il difetto reale corretto: fallimento silenzioso degli asset

`asset-loader.js` trattava ogni errore di caricamento come una condizione
ordinaria:

```js
async function loadText(path, fallback = '') {
  try {
    // …
  } catch (error) {
    logger.warn(`Asset non caricato (${path}), uso il fallback:`, error);
    return fallback; // ← per quattro CSS su cinque il fallback è ''
  }
}
```

Conseguenze:

- se `katex-fonts.css` non si carica, il fallback è un `@import` remoto che in
  una pagina `blob:` **non viene mai risolto**;
- per gli altri fogli il fallback è la **stringa vuota**: il documento si genera
  ugualmente, senza stili, senza errori;
- il livello di log era `warn`, e il livello predefinito delle preferenze è
  proprio `warn`: il messaggio finiva in una console che nessuno guarda.

L'utente riceveva un PDF difettoso **senza alcun segnale**, e non aveva modo di
distinguere un problema di installazione da un difetto dell'estensione. È
esattamente lo scenario che l'architettura dichiara di voler evitare
(«errori espliciti, mai fallimenti silenziosi»).

### Correzione 1 — Rilevamento e segnalazione

```js
async function loadText(path, { fallback = '', required = true } = {}) {
  try {
    const response = await fetchFn(resolveUrl(path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const content = await response.text();
    // Un asset vuoto è indistinguibile da un fallimento silenzioso.
    if (content.trim() === '') throw new Error('contenuto vuoto');

    return { content, ok: true, path };
  } catch (error) {
    logger[required ? 'error' : 'warn'](`Asset non caricato (${path}):`, error);
    return { content: fallback, ok: false, path };
  }
}
```

Il bundle espone ora `integrity: { ok, missing }`, e il renderer inserisce un
avviso visibile nel documento quando qualcosa manca.

### Correzione 2 — Auto-diagnosi dei font nel documento

Gli asset possono essere presenti e il CSS valido, e i font comunque non
applicarsi. Serviva una verifica sul risultato, non sulle precondizioni.
Il documento esportato include ora uno script che la esegue.

Il primo tentativo usava `document.fonts.check()`, e **non funzionava**:

```
DOCUMENTO SANO     {"avviso": false}
FONT MANCANTI      {"avviso": false}   ← non rilevato
```

`check()` restituisce true anche quando la famiglia non esiste ma il browser può
ripiegare su un font generico: risponde «so come impaginare questa richiesta»,
non «ho questo font». L'unico controllo attendibile è **misurare**:

```js
function isApplied(family) {
  // 'monospace' è il ripiego di controllo: se la misura con il font
  // richiesto è identica, significa che si è usato il ripiego.
  var fallback = measure('monospace');
  var candidate = measure('"' + family + '",monospace');
  return Math.abs(candidate - fallback) > 0.5;
}
```

Verificato in Chromium reale:

```
DOCUMENTO SANO     {"avviso": false, "dettaglio": ""}
FONT MANCANTI      {"avviso": true,  "dettaglio": "Font non disponibili: KaTeX_Main, KaTeX_Size4"}
```

L'avviso resta visibile anche in stampa: un PDF potenzialmente difettoso deve
dichiararlo.

---

## 6. Cosa serve ora dall'utente

Il PDF prodotto in questo ambiente è corretto, quindi la verifica decisiva può
farla solo chi riproduce il problema.

1. **Rigenerare e ricaricare** l'estensione:

   ```bash
   git pull
   npm install
   npm run build:fonts      # genera assets/styles/katex-fonts.css (349 KB)
   npm run package:chrome   # produce dist/chrome/
   ```

   Poi `chrome://extensions` → **Ricarica**, e ricaricare la scheda di Gemini.

2. **Esportare di nuovo.** Se in cima al documento compare l'avviso giallo
   _«Formule matematiche non renderizzate correttamente»_, la diagnosi è
   confermata: i font non arrivano. Il messaggio indica quali.

3. **Se l'avviso NON compare ma le parentesi restano piccole**, l'ipotesi è
   errata e serve un'informazione che qui non ho: il browser e la sua versione,
   più il contenuto della console della scheda del documento esportato.

---

## 7. Onestà sullo stato

Non ho risolto il difetto: **non sono riuscito a riprodurlo**. Ho verificato
tutta la catena e ho generato un PDF corretto, con i font `Size1-4` incorporati.

Ho però stabilito con certezza il **meccanismo** — rimuovendo i font ottengo il
sintomo esatto dello screenshot — e ho corretto un difetto reale che rendeva il
problema impossibile da diagnosticare: il fallimento silenzioso del caricamento.
Se la causa è quella che ipotizzo, adesso il documento lo dice invece di
lasciarlo scoprire dal PDF.

È una differenza importante rispetto ai tre fix precedenti, dove la causa era
dimostrata sui dati reali. Qui la conferma può arrivare solo dal prossimo export.

---

## 8. File modificati

| File                                   | Modifica                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/render/asset-loader.js`           | Rilevamento dei fallimenti, asset vuoti trattati come errori, `integrity` nel bundle |
| `src/render/templates/sections.js`     | Avviso di integrità + auto-diagnosi dei font basata su misurazione                   |
| `src/render/html-document.renderer.js` | Inserimento dell'avviso e dello script di verifica                                   |
| `assets/styles/document.css`           | Stile dell'avviso                                                                    |
| `assets/styles/print.css`              | L'avviso resta visibile in stampa                                                    |
| `tests/unit/asset-integrity.test.js`   | **Nuovo** — 8 test sulla diagnostica                                                 |
