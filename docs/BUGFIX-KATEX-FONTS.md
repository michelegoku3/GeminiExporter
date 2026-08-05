# Bugfix — Parentesi graffe, radici e delimitatori resi come rettangoli vuoti

**Data:** 25 luglio 2026
**Versione interessata:** 2.0.1 (dopo il fix di `BUGFIX-KATEX.md`)
**Gravità:** media (formule leggibili ma simboli strutturali mancanti)
**Stato:** risolto

---

## 1. Sintomo

Dopo la correzione del collasso della geometria, il posizionamento dei simboli
era diventato corretto, ma **un'intera categoria di simboli veniva sostituita da
rettangoli vuoti** (i cosiddetti _tofu_, il glifo di ripiego che il browser
mostra quando un carattere non esiste nel font).

Il difetto colpiva in modo selettivo:

| Elemento                     | In Gemini                 | Nel PDF                                    |
| ---------------------------- | ------------------------- | ------------------------------------------ |
| Graffa di `\begin{cases}`    | `{` grande su tre righe   | Barra verticale spezzata in rettangoli     |
| Parentesi tonde di matrice   | `(` `)` estensibili       | Due colonne di rettangoli vuoti            |
| Parentesi quadre `bmatrix`   | `[` `]` estensibili       | Rettangoli impilati                        |
| Radice quadrata `\sqrt`      | `√` con barra orizzontale | Riquadro rettangolare attorno al radicando |
| Radice annidata              | Radici concentriche       | Riquadri annidati, contenuto illeggibile   |
| `\overbrace` / `\underbrace` | Graffe orizzontali        | Sequenze di quadratini                     |
| Barre di norma `\|A\|`       | `‖` estensibili           | Rettangoli                                 |

Al tempo stesso **tutto il resto era corretto**: lettere, cifre, operatori,
frazioni, apici, pedici, sommatorie, integrali e lettere greche. Anche le
posizioni erano giuste — nello screenshot i rettangoli si trovano esattamente
dove dovrebbero esserci le parentesi.

Questa selettività è l'indizio decisivo: **non è un problema di layout, ma di
disponibilità dei caratteri.**

---

## 2. Come KaTeX disegna i simboli grandi

Un simbolo matematico "estensibile" non può essere un normale carattere
tipografico: deve adattarsi in altezza al contenuto che racchiude. KaTeX usa due
tecniche diverse, ed **entrambe** erano compromesse.

### Tecnica A — Font dedicati `KaTeX_Size1…Size4`

Per parentesi, graffe e barre KaTeX non ingrandisce il carattere normale:
attinge a quattro font che contengono le versioni progressivamente più alte
degli stessi simboli, oltre ai pezzi per comporne di arbitrariamente grandi.

```css
.katex .delimsizing.size1 {
  font-family: KaTeX_Size1;
}
.katex .delimsizing.size2 {
  font-family: KaTeX_Size2;
}
.katex .delimsizing.size3 {
  font-family: KaTeX_Size3;
}
.katex .delimsizing.size4 {
  font-family: KaTeX_Size4;
}
.katex .delimsizing.mult .delim-size1 > span {
  font-family: KaTeX_Size1;
}
.katex .delimsizing.mult .delim-size4 > span {
  font-family: KaTeX_Size4;
}
```

Questi font contengono **solo** i delimitatori: pesano 3,6–5,5 KB, i più piccoli
dell'intero set. Se mancano, il browser ripiega sul font generico, che non
possiede quei glifi → tofu. Le lettere normali invece appartengono a
`KaTeX_Main` e `KaTeX_Math`, e in mancanza di essi il ripiego su un serif di
sistema resta perfettamente leggibile: ecco perché il difetto sembrava colpire
"solo le parentesi".

### Tecnica B — Tracciati SVG

Per i simboli che devono allungarsi in modo continuo (barra della radice,
graffe orizzontali di `\overbrace`, frecce estensibili) KaTeX genera un `<svg>`
con un tracciato che viene deformato:

```html
<span class="hide-tail" style="height:1.08em;min-width:0.853em">
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="400em"
    height="1.08em"
    viewBox="0 0 400000 1080"
    preserveAspectRatio="xMinYMin slice"
  >
    <path d="M95 622c-2.7 0-7.17.41-10.1 8.4…"></path>
  </svg>
</span>
```

Il tracciato è disegnato in uno spazio di coordinate enorme (400 000 × 1080
unità) e `viewBox` è ciò che mappa quello spazio sui pochi pixel effettivi.
**Senza `viewBox` un SVG non ha sistema di coordinate**: il contenuto viene
disegnato in scala 1:1 e finisce interamente fuori dall'area visibile. Il
risultato è un riquadro vuoto delle dimensioni del contenitore — esattamente
ciò che si vede attorno ai radicandi.

---

## 3. Cause

### Causa A — I font non erano mai realmente locali

Il file `assets/styles/katex.min.css`, ereditato dalla versione 1.3 e presentato
come "asset locale, zero dipendenze", conteneva in realtà venti dichiarazioni di
questo tipo:

```css
@font-face {
  font-family: KaTeX_Size4;
  src:
    url(https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size4-Regular.woff2)
      format('woff2'),
    url(https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size4-Regular.woff)
      format('woff'),
    url(https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/KaTeX_Size4-Regular.ttf)
      format('truetype');
}
```

Il CSS era locale, **i font no**: erano venti richieste HTTP a `jsdelivr.net`.

Il documento esportato è una pagina `blob:`, e in quel contesto il caricamento
falliva in modo sistematico o intermittente per una combinazione di ragioni:

1. **Origine opaca.** Una pagina `blob:` creata da un content script ha
   un'origine particolare; le richieste cross-origin di font sono soggette a
   CORS e possono essere rifiutate.
2. **Tempistica.** L'utente apre il dialogo di stampa entro pochi istanti: senza
   `font-display`, il browser applica un blocco di ~3 s e poi **stampa con il
   font di ripiego**, anche se il font arriva subito dopo.
3. **Assenza di rete.** Un PDF esportato offline, o un file HTML salvato e
   riaperto in seguito, non avrebbe mai potuto caricare i glifi.

Questo contraddiceva anche una promessa dichiarata nel README
(«zero dipendenze, funziona con qualsiasi CSP»): il documento dipendeva da un
CDN esterno a ogni singola apertura.

Verifica:

```
$ grep -c '@font-face' assets/styles/katex.min.css
20
$ grep -o 'url(https[^)]*' assets/styles/katex.min.css | wc -l
60          # 20 font × 3 formati, tutti remoti
```

### Causa B — Il sanitizer cancellava `viewBox`

Introdotta da me nella riscrittura 2.0.0, in `html-sanitizer.js`:

```js
const TAG_ATTRIBUTES = Object.freeze({
  svg: new Set(['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'style']),
  //                                        ^^^^^^^ camelCase
});

function sanitizeAttributes(element, tag) {
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase(); // → "viewbox"
    const isAllowed = GLOBAL_ATTRIBUTES.has(name) || allowedForTag?.has(name);
    if (!isAllowed) element.removeAttribute(attribute.name); // ← sempre vero
  }
}
```

Il parser HTML **normalizza i nomi degli attributi in minuscolo**, e io li
minuscolizzavo ulteriormente prima del confronto. Ma nell'allowlist avevo
scritto `viewBox` in camelCase, copiandolo dalla documentazione SVG.

`'viewbox' !== 'viewBox'` ⇒ l'attributo non risultava **mai** consentito ⇒
veniva rimosso da ogni SVG. Stessa sorte per `preserveAspectRatio`.

Prova diretta:

```
attributi svg come parsati: xmlns , width , height , viewBox , preserveAspectRatio

DOPO SANITIZE:
<svg xmlns="…" width="400em" height="1.08em"><path d="M95 622…"></path></svg>
                                            ↑ viewBox e preserveAspectRatio spariti
```

C'è una sottigliezza in più: **l'HTML non distingue maiuscole e minuscole, l'SVG
sì**. Non bastava correggere la chiave in `viewbox`, perché scrivere l'attributo
tutto minuscolo su un elemento SVG equivale a non scriverlo affatto: il motore
di rendering lo ignora.

Mancavano inoltre nell'allowlist `stroke-linecap`, `stroke-linejoin` e `fill`
sull'elemento `<svg>`, presenti nel markup reale di Gemini.

---

## 4. Perché non era emerso prima

Il fix precedente aveva aggiunto test rigorosi sulla **conservazione dei nodi**
(strut, pstrut, vlist, conteggio degli elementi) e quei test erano tutti verdi:
gli SVG _c'erano_, i delimitatori _c'erano_. Nessuna asserzione verificava che
gli **attributi** degli SVG sopravvivessero, né che i font fossero raggiungibili.

È un limite intrinseco dei test su DOM: `jsdom` non carica font e non disegna
nulla. Un test può confermare che il markup sia corretto, non che il risultato
sia _visibile_. La difesa possibile è verificare le precondizioni della resa —
presenza del `viewBox`, presenza delle `@font-face`, assenza di URL remoti — ed
è ciò che è stato aggiunto.

---

## 5. Soluzione

### Correzione A — Font incorporati come data URI

Nuovo script `scripts/build-katex-fonts.js` (`npm run build:fonts`) che scarica
i venti file `.woff2` in `assets/fonts/` e genera
`assets/styles/katex-fonts.css` con i font in base64:

```css
@font-face {
  font-family: KaTeX_Size4;
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(data:font/woff2;base64,d09GMgABAAAAAAUcAA4AAAAACuwAAATH…) format('woff2');
}
```

Tre scelte da motivare:

- **`woff2` soltanto** (non woff/ttf): supportato da ogni browser che regga
  Manifest V3, riduce il peso di circa il 60%. 20 font = 254 KB → 341 KB in
  base64, incorporati una sola volta per documento.
- **`font-display: block`**: indica al browser di attendere il font invece di
  stampare con il ripiego. Poiché i font sono già nel documento, l'attesa è
  nulla; senza questa direttiva la stampa immediata rischiava di partire con i
  glifi ancora non applicati.
- **File generato e versionato**, non prodotto a runtime: l'estensione non ha
  passaggi di build obbligatori, e il costo (una tantum) è pagato dallo
  sviluppatore, non dall'utente.

Le venti `@font-face` remote sono state rimosse da `katex.min.css`, che ora
contiene solo regole di layout, con un commento che avverte di non
reintrodurle. Il documento esportato non contiene più alcun riferimento
esterno.

### Correzione B — Grafia corretta degli attributi SVG

Chiavi dell'allowlist normalizzate in minuscolo (coerenti con il confronto), e
ripristino della grafia canonica in uscita:

```js
/**
 * Attributi SVG la cui grafia camelCase è significativa.
 * L'HTML normalizza i nomi in minuscolo, ma l'SVG è case-sensitive.
 */
const SVG_CAMEL_CASE_ATTRIBUTES = Object.freeze({
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  patternunits: 'patternUnits',
  gradientunits: 'gradientUnits',
  // …
});

function restoreSvgAttributeCase(element, originalName, lowercaseName) {
  const canonical = SVG_CAMEL_CASE_ATTRIBUTES[lowercaseName];
  if (!canonical || originalName === canonical) return;

  const value = element.getAttribute(originalName);
  element.removeAttribute(originalName);
  // setAttribute minuscolizzerebbe di nuovo: serve setAttributeNS.
  element.setAttributeNS(null, canonical, value);
}
```

Si è usato `setAttributeNS(null, …)` perché `setAttribute` su un elemento in un
documento HTML rinormalizza il nome in minuscolo, vanificando la correzione.

La mappa include anche attributi camelCase che oggi non compaiono nel markup di
Gemini (`gradientUnits`, `markerWidth`, …): costano nulla e mettono al riparo da
future evoluzioni del renderer. Aggiunti all'allowlist anche `stroke-linecap`,
`stroke-linejoin`, `fill`, `stroke` e `focusable`.

Il filtro di sicurezza resta invariato: `onload`, `onclick` e gli altri gestori
di eventi continuano a essere rimossi dagli SVG (verificato da un test dedicato).

---

## 6. Verifica

### Test aggiunti — `tests/unit/katex-fonts.test.js` (12 test)

**Sui font:**

- tutte e quattro le famiglie `KaTeX_Size1…4` sono dichiarate;
- le venti varianti sono presenti;
- i font sono `data:` URI, senza `http://` né `https://`;
- `font-display: block` è impostato;
- `katex.min.css` non reintroduce dichiarazioni di font remote.

**Sugli SVG:**

- `viewBox` sopravvive **con la grafia camelCase**;
- `preserveAspectRatio` idem;
- tracciato e dimensioni preservati;
- attributi di tratto preservati;
- i gestori di eventi restano rimossi (nessuna regressione di sicurezza).

**Sul documento finale:**

- contiene i font incorporati;
- non contiene alcun riferimento remoto né `@import`.

### Prova di genuinità dei test

Entrambi i difetti sono stati reintrodotti artificialmente:

```
### BUG viewBox REINTRODOTTO ('viewbox' → 'viewBox') ###
Tests  2 failed | 10 passed

### BUG FONT REINTRODOTTO (font non inclusi nel documento) ###
Tests  1 failed | 11 passed

### DOPO IL RIPRISTINO ###
Tests  87 passed (87)
```

### Verifica sull'export reale

Anteprima rigenerata usando le formule più critiche estratte dal DOM reale
(funzione a tratti con graffa, radici annidate, overbrace/underbrace, matrice,
parentesi `size4`):

```
viewBox   1  | viewbox (minuscolo, deve essere 0): 0
delimsizing 14 | hide-tail 3 | svg path 1
font Size1-4 incorporati: 12 riferimenti
data URI font: 20 | riferimenti remoti: 0
```

---

## 7. Effetti collaterali positivi

1. **Il documento è ora davvero autosufficiente.** Funziona offline, e un file
   HTML salvato oggi si aprirà identico fra cinque anni, anche se jsDelivr non
   esistesse più.
2. **Nessuna richiesta di rete in fase di stampa** ⇒ nessuna attesa, nessun
   rischio che il dialogo si apra prima del caricamento dei glifi.
3. **Nessuna fuga di dati verso terzi**: prima, ogni esportazione segnalava a un
   CDN esterno che l'utente stava esportando una conversazione.
4. **Coerenza con quanto dichiarato** nel README riguardo a "zero dipendenze".

Costo: +341 KB per documento esportato. Un prezzo trascurabile per un PDF, a
fronte di correttezza e permanenza.

---

## 8. Lezioni apprese

1. **"Asset locale" va verificato, non presunto.** Un file CSS presente nel
   pacchetto può comunque puntare a risorse remote. `grep 'url(http'` sugli
   asset è un controllo che vale trenta secondi.

2. **La normalizzazione dei nomi è una fonte di bug silenziosi.** HTML
   minuscolizza, SVG è case-sensitive, e l'allowlist stava nel mezzo. Quando si
   confrontano identificatori normalizzati, la tabella di confronto **deve**
   essere scritta nella stessa forma normalizzata — e ora un commento nel codice
   lo dice esplicitamente.

3. **Un sintomo selettivo indica una causa selettiva.** Il fatto che mancassero
   _solo_ parentesi e radici, con lettere e numeri intatti, indicava un problema
   di risorse per categoria di glifo, non di layout. Seguire quell'indizio ha
   portato ai font `Size*` in pochi minuti.

4. **I test su DOM non provano la resa visiva.** `jsdom` non disegna. Verificare
   le _precondizioni_ della resa (attributi geometrici presenti, font
   dichiarati, nessun URL remoto) è il massimo ottenibile in modo automatico:
   il resto richiede l'occhio su un export reale.

---

## 9. File modificati

| File                                    | Modifica                                                       |
| --------------------------------------- | -------------------------------------------------------------- |
| `scripts/build-katex-fonts.js`          | **Nuovo** — genera il CSS con i font in base64                 |
| `assets/fonts/*.woff2`                  | **Nuovi** — 20 font KaTeX (254 KB)                             |
| `assets/styles/katex-fonts.css`         | **Nuovo, generato** — @font-face con data URI                  |
| `assets/styles/katex.min.css`           | Rimosse le 20 @font-face remote                                |
| `src/gemini/sanitize/html-sanitizer.js` | Chiavi minuscole + ripristino grafia SVG + attributi di tratto |
| `src/shared/config.js`                  | Aggiunto `ASSET_PATH.katexFontsCss`                            |
| `src/render/asset-loader.js`            | Carica il nuovo foglio dei font                                |
| `src/render/html-document.renderer.js`  | Incorpora i font nel documento                                 |
| `package.json`                          | Script `build:fonts`                                           |
| `tests/unit/katex-fonts.test.js`        | **Nuovo** — 12 test di regressione                             |
