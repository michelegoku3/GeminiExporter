# Trasposizione dei grafici interattivi

## Il problema

Gemini genera contenuti interattivi — grafici esplorabili, simulazioni,
anteprime web — che nel documento esportato sparivano senza lasciare traccia.

## Perché non si può fare di meglio di una fotografia

Il DOM reale rivela la struttura:

```html
<mini-app>
  <web-preview style="height: 656px">
    <iframe sandbox="allow-scripts allow-same-origin ..." src="…/shim.html">
      ← origin diverso</iframe
    ></web-preview
  ></mini-app
>
```

Il contenuto vive in un `<iframe>` **cross-origin e sandboxed**. Questo esclude
per costruzione ogni approccio più fedele:

| Approccio                     | Perché non è praticabile                        |
| ----------------------------- | ----------------------------------------------- |
| Leggere il DOM interno        | Vietato dalla same-origin policy                |
| Estrarre il `<canvas>`        | `getImageData` è vietato su canvas cross-origin |
| Recuperare i dati del grafico | Non sono esposti: vivono nello stato dell'app   |
| Rifare il rendering           | Significherebbe reimplementare l'applicazione   |

Verificato sul DOM reale: il testo contenuto in `<mini-app>` è la stringa vuota.
Persino il titolo «Esploratore di Parabole», visibile a schermo, è **dentro**
l'iframe e non è leggibile. Per questo la didascalia predefinita è generica.

Resta quindi una sola trasposizione possibile: **una cattura visiva**, che è
esattamente ciò che l'utente aveva chiesto («penso sia infattibile averlo
interattivo nel file, quindi mi basta semplicemente la sua trasposizione»).

## Architettura

La funzionalità ricalca deliberatamente quella delle immagini, perché il
problema ha la stessa forma: un contenuto che l'estrazione sincrona non può
risolvere e che va incorporato in una fase successiva.

```
estrazione (sincrona)          →  segnaposto <figure data-embedded-app="app-1">
cattura (asincrona)            →  <img src="data:image/png;…">
incorporamento nei formati     →  PDF: <img> · Word: parte OOXML
```

| Modulo                                   | Responsabilità                                           |
| ---------------------------------------- | -------------------------------------------------------- |
| `gemini/sanitize/embedded-apps.js`       | Sostituisce il contenitore con un segnaposto             |
| `gemini/app-capture.js`                  | Scorre, fotografa, ritaglia                              |
| `gemini/canvas-ops.js`                   | Ritaglio, impilamento, ridimensionamento (funzioni pure) |
| `core/usecases/embed-app-captures.js`    | Ricostruisce il modello con le catture                   |
| `extension/background/service-worker.js` | Esegue `tabs.captureVisibleTab`                          |

I livelli restano quelli di sempre: il core non sa che esistono gli iframe,
riceve un collaboratore che sostituisce segnaposto con immagini.

### Perché la marcatura avviene per prima

`markEmbeddedApps` è la **prima** fase di `extractModelResponse`, prima ancora
della rimozione del rumore. Non è un dettaglio: `<iframe>` è in `DANGEROUS_TAGS`
e il sanitizer lo elimina **con tutto ciò che lo circonda**. Marcare più tardi
significherebbe non trovare più nulla da marcare.

È anche l'unico momento in cui clone e originale sono ancora strutturalmente
allineati, condizione necessaria per metterli in corrispondenza.

### Perché un attributo e non un riferimento all'elemento

Il segnaposto vive nel clone sanificato, che attraversa una serializzazione in
stringa prima di arrivare ai renderer. Un riferimento diretto al nodo non
sopravviverebbe. L'identificatore (`app-1`, `app-2`, …) collega il segnaposto
all'attributo `data-gex-app-id` applicato al DOM vivo, di cui la cattura deve
misurare la posizione.

Se il numero di contenitori nel clone e nell'originale non coincide, la
marcatura viene **abbandonata**: associare l'elemento sbagliato produrrebbe
l'immagine di un altro grafico, un errore silenzioso e peggiore dell'assenza.

### Quale contenitore scorre

Gemini **non** scorre la finestra: la cronologia vive in un
`<infinite-scroller>` dichiarato `overflow: hidden scroll`. `window.scrollTo`
non ha alcun effetto sul contenuto, e assumere il contrario faceva fallire ogni
cattura. `gemini/scroll-container.js` risale gli antenati fino al contenitore
che possiede davvero la barra di scorrimento.
Vedi [`BUGFIX-CATTURA-SCROLL.md`](BUGFIX-CATTURA-SCROLL.md).

### Perché le catture sono sequenziali

Ogni cattura scorre la pagina per portare il contenuto nel viewport. Due
scorrimenti simultanei si annullerebbero a vicenda. È il motivo per cui
l'esportazione con grafici è percettibilmente più lenta e la pagina "salta".
La posizione di scorrimento iniziale viene ripristinata al termine.

### Il rettangolo è un DOMRect, non un oggetto

`getBoundingClientRect()` restituisce un `DOMRect`, le cui proprietà stanno sul
prototipo: copiarlo con lo spread produce un oggetto vuoto e la cattura diventa
un'immagine vuota, senza alcun errore. Le misure vanno lette una a una, e `crop`
rifiuta quelle non valide. Vedi
[`BUGFIX-CATTURA-DOMRECT.md`](BUGFIX-CATTURA-DOMRECT.md).

### `devicePixelRatio`

Le coordinate del DOM sono in pixel CSS, lo screenshot è in pixel fisici. Su uno
schermo con `devicePixelRatio = 2` un elemento di 600 px CSS occupa 1200 px
nell'immagine. Ignorare la conversione produce ritagli sfalsati su **tutti** gli
schermi ad alta densità — che oggi sono la maggioranza.

## Permessi

```json
"permissions": ["storage", "tabs"],
"host_permissions": ["https://gemini.google.com/*"],
"optional_host_permissions": ["<all_urls>"]
```

`tabs.captureVisibleTab` esige il **letterale** `<all_urls>` o `activeTab`: un
permesso host circoscritto a `gemini.google.com` viene rifiutato, benché sia il
dominio effettivamente fotografato. Chrome verifica la presenza del letterale,
non la copertura reale dell'origine.

Per non imporre a tutti l'avviso «leggere i tuoi dati su tutti i siti»,
`<all_urls>` è dichiarato **opzionale**: non compare all'installazione ed è
richiesto solo a chi spunta «Includi i grafici interattivi» nel dialogo di
esportazione.

`permissions.request` esige un gesto dell'utente e non è invocabile da un
content script. La richiesta parte quindi dal gestore del click sulla casella,
attraversa il service worker come messaggio — il gesto si propaga — e l'esito
torna indietro. La casella segue l'esito reale: se il permesso viene negato
torna deselezionata.

La verifica avviene nel **service worker** e viaggia come messaggio:
`chrome.permissions` non è accessibile ai content script, dove risulterebbe
sempre negata. Vedi
[`BUGFIX-PERMESSO-CONTENT-SCRIPT.md`](BUGFIX-PERMESSO-CONTENT-SCRIPT.md).

Al suo interno passa da `permissions.getAll()`, non da `contains()`: Chrome
normalizza `<all_urls>` in pattern equivalenti, e confrontare il letterale
produce un falso negativo. Vedi
[`BUGFIX-PERMESSO-FALSO-NEGATIVO.md`](BUGFIX-PERMESSO-FALSO-NEGATIVO.md).

`activeTab` non era praticabile: concede l'accesso solo dopo un clic sull'icona
dell'estensione, mentre il flusso normale parte dal pulsante nella
conversazione. Vedi [`BUGFIX-PERMESSO-CATTURA.md`](BUGFIX-PERMESSO-CATTURA.md).

## Comportamento in caso di fallimento

Se la cattura non riesce (contenuto rimosso dalla pagina, permesso negato,
timeout) resta un riquadro tratteggiato con la didascalia:

> _Contenuto interattivo non catturato: Esploratore di Parabole_

È la scelta richiesta dall'utente: chi legge sa che in quel punto c'era
qualcosa, invece di trovare un salto inspiegabile nel discorso.

Il service worker ritenta fino a tre volte: Chrome limita `captureVisibleTab` a
due chiamate al secondo e rigetta le eccedenti.

Un contenuto più alto di `CAPTURE.maxSlices` schermate (4) viene catturato
parzialmente, con un avviso nel log: oltre quella soglia la cattura costa più
dell'informazione che aggiunge.

## Estendibilità

`SELECTORS.embeddedApp` elenca i contenitori riconosciuti:

```js
candidates: ['mini-app', 'web-preview', '[data-test-id="preview-block"]'];
```

Nulla nel meccanismo è specifico dei grafici: qualunque contenuto Gemini renda
in un iframe viene trasposto allo stesso modo. Per coprirne uno nuovo basta
aggiungere un selettore a questa lista — è l'unico punto da toccare, coerente
con la regola già stabilita per `selectors.js`.

## Verifica

`tests/unit/embedded-apps.test.js` — 24 test su cinque aree: marcatura,
sopravvivenza alle fasi di pulizia, cattura, caso d'uso, resa nei formati.

Tre sono stati validati **reintroducendo il difetto**, per accertarne la
genuinità:

| Difetto reintrodotto                        | Test che ha reagito                          |
| ------------------------------------------- | -------------------------------------------- |
| `normalizeImages` cancella le `<img>` vuote | _conserva l'immagine vuota…_                 |
| Rimossa la guardia sui contenitori annidati | _non marca due volte…_ (+1)                  |
| `devicePixelRatio` ignorato                 | _converte le coordinate CSS in pixel fisici_ |

Verifica end-to-end sul DOM reale (`grafico interattivo.html`):

```
turni: 1 | mini-app nel DOM: 1
estrazione ok: true
segnaposto nel modello: true
iframe rimasti: 0
marcatori sul DOM vivo: 1
```

e sul documento prodotto:

```
word/media/image1.png
drawing: 1 | Caption: 1
wp:extent cx="3048000" cy="1905000"   (320×200 px, proporzioni corrette)
```

Suite completa: **371 test**, `npm run check` verde.

## Difetto evitato in fase di sviluppo

`normalizeImages` rimuove le `<img>` prive di sorgente — comportamento corretto,
perché un'immagine senza dati produce un riquadro rotto. Ma il segnaposto è
esattamente un'`<img>` senza sorgente, in attesa che la cattura la valorizzi:
sarebbe stato cancellato prima ancora che la fase di cattura potesse vederlo.

Il difetto è stato individuato leggendo il codice della fase confinante prima di
integrarla, non a valle di una segnalazione. L'eccezione è ora esplicita e
protetta da un test.
