# Architettura

## Idea centrale

L'estensione è una catena a tre stadi con un **modello dati al centro**:

```
DOM di Gemini ──▶ Conversation ──▶ Documento HTML ──▶ PDF
   (fragile)      (stabile)         (autosufficiente)
    adapter        modello            renderer          sink
```

Le tre regole che tengono insieme il progetto:

1. **Il parser non sa cosa sia un PDF.** `src/gemini/` produce solo oggetti del
   modello dati.
2. **Il renderer non sa cosa sia Gemini.** `src/render/` riceve una
   `Conversation` e non tocca mai il DOM della pagina.
3. **La UI non contiene logica di business.** `src/extension/` osserva, inietta
   pulsanti e mostra messaggi; l'esportazione è un'unica chiamata al caso d'uso.

Il vantaggio pratico: quando Google cambia l'HTML si modifica **un solo file**
(`src/gemini/selectors.js`); quando si vuole cambiare l'aspetto del PDF si
modifica **solo** `assets/styles/` e `src/render/`.

## I livelli

### `src/core/` — dominio

Nessuna API del browser, nessun DOM di Gemini. Contiene:

- **`model/conversation.js`** — `Conversation`, `ConversationTurn`, `Message`,
  `Attachment`. Strutture immutabili e serializzabili.
- **`model/safe-html.js`** — il tipo `SafeHtml`.
- **`usecases/export-conversation.js`** — l'unico posto in cui è descritta la
  sequenza estrai → renderizza → consegna. Riceve tutte le collaborazioni per
  injection, quindi è verificabile senza browser.

### `src/gemini/` — adapter

L'unico livello che conosce la struttura HTML di Gemini.

- **`selectors.js`** — registry: ogni concetto è una **lista ordinata** di
  selettori CSS, dal più specifico al più generico.
- **`dom-query.js`** — `queryFirst`/`queryAll` percorrono la lista e registrano
  un warning quando devono usare un fallback (_selector drift_).
- **`extractors/`** — trasformano i nodi in oggetti del modello.
- **`sanitize/`** — la pipeline di pulizia, in quattro moduli con
  responsabilità distinte (rumore, blocchi di codice, matematica, struttura) più
  il sanitizer con allowlist.

> ⚠️ **Attenzione alle euristiche di pulizia.** Dentro le formule KaTeX (e negli
> `<svg>`) gli elementi privi di testo trasportano la geometria del layout:
> rimuoverli fa collassare le formule. `removeEmptyContainers` salta questi
> sottoalberi. Vedi [`BUGFIX-KATEX.md`](BUGFIX-KATEX.md).

### `src/render/` — presentazione

- **`html-document.renderer.js`** — assembla il documento completo.
- **`templates/`** — funzioni pure che producono frammenti di markup.
- **`asset-loader.js`** — carica e memorizza i CSS in modo asincrono.

Gli stili sono veri file `.css` in `assets/styles/`, non stringhe dentro il
JavaScript: si possono formattare, controllare con il linter e modificare senza
rischiare di rompere un template literal.

Il documento prodotto è **completamente autosufficiente**: stili e font KaTeX
sono incorporati (i font come data URI). Non effettua alcuna richiesta di rete
al momento della stampa, quindi funziona offline e resta identico se salvato su
disco. Vedi [`BUGFIX-KATEX-FONTS.md`](BUGFIX-KATEX-FONTS.md) per il motivo per
cui questa proprietà non è negoziabile.

### `src/export/` — consegna

`print-tab.sink.js` apre il documento in una nuova scheda; se il popup viene
bloccato, ricade sul download del file HTML.

### `src/extension/` — piattaforma

L'unico livello che usa `chrome.*` / `browser.*`, sempre tramite il wrapper
`platform/browser.js`. `content/main.js` è la **composition root**: il solo file
che conosce tutti i moduli e li collega.

### `src/shared/` — trasversale

`config.js` (ogni costante del progetto), `logger.js`, `errors.js`, `result.js`.

## Decisioni tecniche

## Aggiungere un formato di esportazione

I formati e gli ambiti sono **registry dichiarativi** in `src/shared/`. Il
dialogo si costruisce da quegli elenchi, quindi la UI non va mai modificata.

Per rendere disponibile un formato oggi annunciato come futuro:

1. In `src/shared/export-formats.js`, porta `available: true` sulla voce.
2. Implementa il renderer: riceve una `Conversation` e restituisce una stringa
   (formati testuali) oppure un `Uint8Array` (formati binari).
3. Registra la **pipeline** in `src/extension/content/main.js`:

```js
const pipelines = {
  pdf: {
    renderer: createHtmlDocumentRenderer({ assetLoader }),
    sink: createPrintTabSink({ logger }),
  },
  word: {
    renderer: createDocxRenderer(),
    sink: createFileDownloadSink({ logger }),
    fileType: { mimeType: DOCX_MIME, extension: DOCX_EXTENSION },
  },
};
```

Una pipeline associa a un formato il suo renderer e il suo canale di consegna:
il PDF si apre in una scheda per la stampa, Word si scarica come file. Il caso
d'uso sceglie la pipeline dal formato richiesto e non contiene alcun `if` per
formato specifico.

Il caso d'uso rifiuta i formati non disponibili **o privi di pipeline** con
`ErrorCode.UNSUPPORTED_FORMAT`, quindi nessun percorso può invocare un renderer
inesistente.

### Perché il .docx è generato senza librerie

Un `.docx` è un archivio ZIP contenente XML. Lo scrittore ZIP in
`src/export/docx/zip-writer.js` occupa poche decine di righe, contro le ~100 KB
di JSZip: il progetto mantiene la promessa "zero dipendenze runtime". I file
sono archiviati senza compressione (metodo _store_), scelta che Word accetta
senza problemi e che rende l'output deterministico e verificabile nei test.

### Matematica nel documento Word

Le formule sono convertite in **OMML** (Office Math Markup Language), il
formato matematico nativo di Word: risultano impaginate correttamente e
modificabili con l'editor delle equazioni, invece di comparire come sorgente
LaTeX grezzo.

La catena vive in `src/export/docx/latex/`:

| Modulo       | Ruolo                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| `symbols.js` | Tabelle LaTeX → Unicode (greche, operatori, frecce, accenti, delimitatori) |
| `parser.js`  | Sorgente LaTeX → albero sintattico                                         |
| `omml.js`    | Albero → XML OMML                                                          |

Il parser è **volutamente parziale**: copre la sintassi che Gemini genera
davvero e degrada in testo su ciò che non riconosce, senza mai sollevare
eccezioni. Una formula resa imperfettamente è preferibile a un documento che
non si apre.

Perché la conversione sia possibile, il normalizzatore KaTeX conserva il
sorgente nell'attributo `data-latex` prima di rimuovere il MathML.

Vincoli da ricordare se si tocca questo codice:

1. Il namespace `xmlns:m` va dichiarato su `<w:document>`: senza, Word
   considera il file corrotto appena incontra una formula.
2. Un elemento `<m:e>` vuoto viene reso con un quadratino segnaposto. La
   funzione `fillSlot` inserisce un carattere dove il contenuto può mancare
   (`\\Vert{}_F`, celle libere di `aligned`).
3. **`aligned` non è una matrice.** Le `&` sono punti di allineamento, non
   separatori di colonna: si usa `<m:eqArr>`. Renderlo con `<m:m>` introduce
   colonne fittizie e alcuni convertitori sostituiscono con un segnaposto il
   primo operatore di ogni cella. `cases` invece è una matrice vera, perché le
   sue colonne (valore e condizione) sono reali.
4. **Gli integrali portano gli estremi di lato** (`subSup`), sommatorie e
   produttorie sopra e sotto (`undOvr`). La regola è centralizzata in
   `limitLocation`: è convenzione tipografica, non preferenza estetica.
5. **Le formule non sono centrate.** La centratura OMML (`m:jc`) e quella del
   paragrafo (`w:jc`) non sono componibili in modo affidabile fra i lettori:
   sommandosi spostavano le formule oltre il centro. Le formule seguono
   l'allineamento del testo.
6. **Il corsivo è per le variabili, non per i simboli.** Operatori come ∇, ∂ e
   ∞ vanno in tondo: resi in corsivo appaiono inclinati e irriconoscibili.
   Se ne occupa `isVariableLike`.
7. **Nessun elemento OMML strutturale può restare vuoto.** `m:sub`, `m:sup`,
   `m:deg`, `m:e`, `m:num`, `m:den` devono contenere almeno un run **anche
   quando sono nascosti** da `subHide`/`supHide`/`degHide`: quegli attributi
   controllano la visibilità, non l'esistenza. Word scarta silenziosamente
   l'intero paragrafo che ospita un blocco non valido — LibreOffice invece lo
   tollera, quindi il difetto non emerge dalle conversioni di controllo. Usare
   sempre `fillSlot`/`EMPTY_SLOT`. Vedi
   [`BUGFIX-DOCX-CONTENUTO-MANCANTE.md`](BUGFIX-DOCX-CONTENUTO-MANCANTE.md).
8. **`<m:oMath>` non può essere l'unico figlio di `<w:p>`.** La matematica che
   occupa un paragrafo va avvolta in `<m:oMathPara>`; quella inline sta accanto
   ai `<w:r>`. Word scarta i paragrafi che non rispettano una delle due forme.
   Vedi [`BUGFIX-DOCX-OMATHPARA.md`](BUGFIX-DOCX-OMATHPARA.md).
9. **Ogni run matematico deve dichiarare `Cambria Math`**, e il pacchetto deve
   contenere `word/settings.xml` con `<m:mathPr>`. Sono i dati con cui Word
   calcola l'altezza delle equazioni: in loro assenza mostra il segnaposto
   «EQUAZIONE», impagina come se le formule fossero alte una riga e ricalcola a
   documento aperto, spingendo il testo fuori pagina. Vedi
   [`BUGFIX-DOCX-EQUAZIONE-REFLOW.md`](BUGFIX-DOCX-EQUAZIONE-REFLOW.md).
10. **Usare solo caratteri presenti in Cambria Math.** Gli spazi tipografici
    Unicode (U+2003, U+2009, …) non vi appartengono: Word non applica il font
    fallback alla matematica e lascia il segnaposto «[Equazione]». Vedi
    [`BUGFIX-DOCX-SPAZI-UNICODE.md`](BUGFIX-DOCX-SPAZI-UNICODE.md).
11. **`<m:oMathPara>` deve dichiarare `<m:jc>`**: il default è `centerGroup`,
    non l'allineamento del paragrafo.
12. **Il documento si apre in layout web** (`<w:view w:val="web"/>`): pagina
    continua, senza margini che il riflusso delle equazioni possa superare. La
    stampa resta in A4 grazie a `<w:sectPr>`.
13. Gli spazi sono token dedicati (`SPACE_TOKEN`): ignorati nella matematica,
    conservati dentro `\\text{}`, dove sono parte del contenuto.
14. **La tipografia CJK va disattivata esplicitamente**
    (`<w:characterSpacingControl w:val="doNotCompress"/>`) e `eastAsia` non deve
    puntare al font matematico. Altrimenti Word comprime le larghezze di
    avanzamento ai confini fra font, e i paragrafi che alternano testo e formule
    inline diventano illeggibili. Il default in assenza dell'impostazione dipende
    dalla lingua di installazione: da qui il carattere intermittente del difetto.
    Vedi [`BUGFIX-DOCX-CARATTERI-COMPRESSI.md`](BUGFIX-DOCX-CARATTERI-COMPRESSI.md).

### Contenuti interattivi (grafici)

I grafici di Gemini vivono in iframe cross-origin e sandboxed: il loro contenuto
non è leggibile in alcun modo. L'unica trasposizione possibile è una cattura
visiva dello schermo, che segue la stessa struttura in due fasi già usata per le
immagini — segnaposto durante l'estrazione sincrona, riempimento in una fase
asincrona successiva.

La marcatura è la **prima** operazione di `extractModelResponse`: `<iframe>` è un
tag pericoloso e il sanitizer lo rimuoverebbe con tutto il contenuto circostante.
Vedi [`GRAFICI-INTERATTIVI.md`](GRAFICI-INTERATTIVI.md).

15. **Le relazioni usano la forma `rId<numero>`** e le parti binarie precedono
    `docProps`. La specifica ammette altre forme, ma Word ignora i disegni con
    identificatori fuori convenzione — senza segnalare l'errore. Vedi
    [`BUGFIX-DOCX-IMMAGINE-RELID.md`](BUGFIX-DOCX-IMMAGINE-RELID.md).

### Generalità: invarianti, non casi

Le correzioni all'export Word sono nate da un singolo documento reale, ma le
soluzioni sono **strutturali**, non legate a quel contenuto:

| Difetto                   | Soluzione puntuale (fragile)     | Soluzione adottata                                                                 |
| ------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| Slot OMML vuoti           | Aggiungere `fillSlot` dove serve | Ogni slot passa dalla funzione `slot()`: è impossibile costruirne uno non protetto |
| Comandi LaTeX sconosciuti | Aggiungerli alla tabella         | Il parser degrada in testo e non solleva mai eccezioni                             |
| Selettori di Gemini       | Correggere quando si rompe       | Liste ordinate di fallback con diagnostica del drift                               |
| `<m:oMath>` nudo          | Correggere i punti noti          | Regola applicata in `buildParagraph`, valida per ogni percorso                     |

Il presidio è `tests/unit/omml-robustness.test.js`, che verifica le invarianti
— nessuna eccezione, nessuno slot vuoto, XML bilanciato, font su ogni run — su
formule di domini non rappresentati nelle fixture, su costrutti degeneri
(`\\frac{}{}`, `\\sqrt{}`) e su **5000 formule generate casualmente** con seme
fisso. Il fuzzing ha rivelato 858 casi difettosi su 4000 che nessuna fixture
avrebbe intercettato.

### Nota sulla verifica

**Nessuno strumento disponibile in sviluppo valida OMML come fa Word.**
LibreOffice rende documenti che Word rifiuta; `python-docx` legge la struttura
senza applicare lo schema matematico. Affidarsi a loro ha prodotto tre
iterazioni di correzioni parziali.

Il presidio è `tests/helpers/ooxml-validator.js`, che codifica esplicitamente i
vincoli dello schema — figli obbligatori e loro ordine, elementi che non possono
restare vuoti, forma canonica dei paragrafi matematici — e viene applicato
dai test all'intero `word/document.xml`.

I PDF prodotti con LibreOffice restano utili per l'ispezione visiva, ma **non
sono un criterio di correttezza**. Lo stesso vale per gli ambiti in `export-scopes.js`: la voce
"Scegli i turni…" è un segnaposto visibile ma inerte, che diventerà attiva
aggiungendo la selezione multipla e il relativo ramo in `extract()`.

### Perché il documento è servito da una pagina dell'estensione

Una pagina `blob:` **eredita la Content Security Policy** del documento che l'ha
creata. Poiché il blob nasceva nel content script iniettato in
gemini.google.com, il documento ereditava la CSP di Google, che vieta
`font-src data:` e blocca quindi tutti i font KaTeX incorporati.

Il documento viene perciò aperto da `chrome-extension://…/viewer.html`, che ha
una CSP propria dichiarata nel manifest. Conseguenza da ricordare: quella CSP
impone `script-src 'self'`, quindi **il documento non può contenere script
inline né attributi `on*`**. Vedi [`BUGFIX-CSP-BLOB.md`](BUGFIX-CSP-BLOB.md).

### Perché `window.print()` e non una libreria PDF

jsPDF e pdfmake richiederebbero di riprodurre a mano il layout, e perderebbero
KaTeX, i font e la selezionabilità del testo. La stampa nativa del browser
produce un PDF fedele, con testo selezionabile e interruzioni di pagina
controllabili via CSS, a costo zero in termini di dipendenze e permessi.

### Perché moduli ES senza bundler

Il progetto ha ~25 file di piccole dimensioni e nessuna dipendenza runtime. Un
bundler aggiungerebbe un passaggio di build, i source map e una configurazione da
mantenere, senza benefici misurabili. I moduli sono caricati dal browser tramite
un `import()` dinamico in `content/loader.js`: è il pattern standard, perché i
content script dichiarati nel manifest sono eseguiti come script classici.

**Conseguenza da conoscere:** i moduli devono essere elencati in
`web_accessible_resources` e gli import devono includere l'estensione `.js`.

### Perché JavaScript con JSDoc invece di TypeScript

Le annotazioni JSDoc con `checkJs` danno il controllo dei tipi in fase di
sviluppo (`npm run typecheck`) e nell'editor, senza introdurre un passaggio di
compilazione. Il codice che gira nel browser è lo stesso che si legge nel
repository — una qualità preziosa quando si fa debug di un'estensione.

### Perché `SafeHtml`

Nella versione 1.3 il renderer interpolava `innerHTML` grezzo proveniente dal
modello: una prompt injection poteva far eseguire codice arbitrario nel
documento esportato. Ora `Message.html` accetta **solo** istanze di `SafeHtml`,
e `SafeHtml` può essere costruito unicamente dal sanitizer, che possiede il
token privato. Dimenticare di sanificare non è più possibile: è un errore
immediato, non una vulnerabilità silenziosa.

### Perché una allowlist e non una denylist

Le denylist invecchiano male: ogni nuovo attributo o tag rappresenta un buco.
L'allowlist di `html-sanitizer.js` accetta solo ciò che serve al contenuto
(formattazione, tabelle, KaTeX) e rimuove tutto il resto, compresi eventuali
tag futuri che oggi non conosciamo.

### Perché il registry dei selettori con fallback

Gemini è un'applicazione Angular che cambia frequentemente. Un selettore singolo
significa rottura totale e silenziosa. Con la lista ordinata, un cambiamento
parziale degrada le prestazioni ma non interrompe il servizio, e il warning nei
log ci avvisa **prima** che gli utenti aprano una segnalazione.

### Perché debounce invece del polling

La versione precedente combinava un `MutationObserver` senza debounce su tutto
`document.body` con un `setInterval` ogni 3 secondi. Durante lo streaming di una
risposta questo significava migliaia di scansioni complete del documento. Ora le
mutazioni vengono raggruppate (250 ms) ed elaborate in idle time; i cambi di
rotta della SPA sono intercettati esplicitamente.

## Flusso di un'esportazione

```
click sul pulsante
   └─▶ button-injector      stato "caricamento", impedisce i doppi click
        └─▶ main.js         runExport({ scope })
             └─▶ export-conversation (caso d'uso)
                  ├─▶ preferences.load()
                  ├─▶ geminiSource.extractTurn/extractConversation
                  │     ├─ queryFirst con fallback
                  │     ├─ clona il nodo (il DOM di Gemini non si tocca mai)
                  │     ├─ rimuove rumore → codice → matematica → struttura
                  │     └─ sanitizeElement → SafeHtml
                  ├─▶ renderer.render(conversation, preferences)
                  │     └─ assetLoader.loadStyles (in cache)
                  └─▶ sink.deliver(html, filename)
                        └─ nuova scheda, oppure download se bloccata
   └─▶ toast con l'esito
```

## Gestione degli errori

Gli errori **attesi** viaggiano come valori (`Result`), non come eccezioni:
il chiamante è costretto a gestirli. Ogni `ExportError` ha un `code` stabile e
uno `userMessage` in italiano già pronto per la UI — nessun "errore generico".

| Codice               | Quando                         | Cosa vede l'utente                          |
| -------------------- | ------------------------------ | ------------------------------------------- |
| `SELECTOR_NOT_FOUND` | Gemini ha cambiato HTML        | Invito ad aggiornare l'estensione           |
| `EMPTY_RESPONSE`     | Risposta vuota dopo la pulizia | Non c'è nulla da esportare                  |
| `NO_CONVERSATION`    | Nessun turno nella pagina      | Nessuna conversazione trovata               |
| `POPUP_BLOCKED`      | Scheda bloccata                | Messaggio informativo + download automatico |
| `ASSET_LOAD_FAILED`  | CSS non caricato               | Avviso; l'export prosegue con stili ridotti |
| `UNEXPECTED`         | Bug                            | Messaggio generico + dettagli nei log       |

I fallback fanno sì che un guasto parziale non diventi mai un guasto totale:
un turno malformato viene saltato, un CSS mancante viene sostituito dal CDN, un
popup bloccato diventa un download.

## Test

| File                           | Cosa protegge                                       |
| ------------------------------ | --------------------------------------------------- |
| `html-sanitizer.test.js`       | La sicurezza: nessun codice eseguibile nell'export  |
| `gemini-source.test.js`        | L'estrazione, la pulizia e i fallback dei selettori |
| `selectors.contract.test.js`   | La coerenza del registry dei selettori              |
| `renderer.test.js`             | Documento autosufficiente, escaping, preferenze     |
| `export-conversation.test.js`  | Orchestrazione e gestione degli errori              |
| `pipeline.integration.test.js` | La catena completa, con gli asset reali             |
| `filename.test.js`             | I casi limite dei nomi file                         |

Le fixture in `tests/fixtures/gemini-dom.js` riproducono il DOM reale, attributi
Angular compresi. Non ci sono test scritti solo per aumentare la copertura: i
file di collegamento (loader, composition root, popup) si verificano a mano.
