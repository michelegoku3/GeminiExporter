# Bugfix — Radici e graffe ancora mancanti: gli SVG viaggiano come data URI

**Data:** 25 luglio 2026
**Versione interessata:** 2.0.2 (dopo `BUGFIX-KATEX.md` e `BUGFIX-KATEX-FONTS.md`)
**Gravità:** alta (simboli assenti dal PDF)
**Stato:** risolto

---

## 1. Sintomo

Dopo il fix precedente sui font, l'utente ha segnalato **zero differenze**
rispetto alla versione vecchia: radici e graffe continuavano a comparire come
riquadri vuoti.

Questo è un dato diagnostico prezioso. "Nessun miglioramento" non significa
"fix insufficiente": significa che il fix **non stava agendo sul percorso
realmente responsabile**. Se i font fossero stati l'unica causa, si sarebbe
vista almeno una variazione parziale.

---

## 2. L'indizio che avevo sottovalutato

Nella verifica del fix precedente avevo stampato questi conteggi sull'anteprima:

```
delimsizing 14 | hide-tail 3 | svg path 1
viewBox 1 | viewbox (minuscolo): 0
```

Avevo letto solo l'ultima riga (`viewBox` preservato, nessun minuscolo) e
considerato la verifica superata. Ma i numeri della prima riga erano
incoerenti: **3 contenitori `hide-tail` e un solo `<path>`**. Ogni `hide-tail`
racchiude un simbolo estensibile; se ce ne sono tre, i tracciati dovrebbero
essere tre.

Il conteggio dichiarava il problema, e io avevo guardato altrove.

---

## 3. Causa reale

Ho misurato la pipeline stadio per stadio sul DOM autentico:

```
                         svg  path  viewBox  hide-tail
ORIGINALE                  2     2        2          2
removeNoise                2     2        2          2
normalizeCodeBlocks        2     2        2          2
normalizeMath              2     2        2          2
removeEmptyContainers      2     2        2          2
sanitize (FINALE)          0     0        0          2   ← ✗
```

Il sanitizer azzerava gli SVG. Ma il test isolato che avevo scritto per
`viewBox` passava. La contraddizione si spiega guardando il markup vero:

```html
<span class="hide-tail mtight" style="min-width:0.853em;height:1.08em">
  <img
    class="katex-svg"
    style="display:block;position:absolute;width:100%;height:inherit"
    src='data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"
            width="400em" height="1.08em"
            viewBox="0 0 400000 1080"
            preserveAspectRatio="xMinYMin slice">
            <path d="M95,702c-2.7,0,-7.17,-2.7,…"/></svg>'
  />
</span>
```

**Gemini non usa `<svg>` inline: usa `<img>` con un data URI.**

Tutto il lavoro fatto nel fix precedente sull'allowlist degli attributi SVG era
corretto in sé, ma agiva su elementi `<svg>` che nel markup di Gemini
**non esistono**. I frammenti su cui avevo testato provenivano da altre parti
della pagina (icone dell'interfaccia), non dalle formule.

Il codice responsabile era in `isSafeUrl`:

```js
// Le immagini possono usare data URL, ma solo di tipo immagine.
if (tag === 'img' && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) {
  return true;
}
```

La regola accettava i data URI **solo in forma base64**. Il formato usato da
KaTeX è invece `;utf8,` con il markup in chiaro. Nessuna corrispondenza ⇒ `src`
rimossa ⇒ `<img>` senza sorgente ⇒ riquadro vuoto delle dimensioni del
contenitore.

Frequenze nel file reale:

```
img class="katex-svg"      : 33
data:image/svg+xml;utf8    : 37
data:image/svg+xml;base64  :  1
```

Trentasette occorrenze scartate, una accettata.

### Il vincolo che rende il problema non banale

Non bastava aggiungere `utf8` alla regex. **Un SVG non è un'immagine inerte
come un PNG**: è un documento che può contenere `<script>`, `onload=` o
`<a href="javascript:">`. Poiché il contenuto proviene da un modello
linguistico esposto a prompt injection, autorizzare in blocco
`data:image/svg+xml` avrebbe riaperto esattamente la falla XSS (P0-1) che il
sanitizer esiste per chiudere.

Le due esigenze sono in tensione diretta:

- **rifiutare** il data URI ⇒ radici e graffe spariscono;
- **accettarlo** senza controlli ⇒ codice arbitrario nel documento esportato.

---

## 4. Soluzione

Nessuna delle due strade: si **decodifica il payload, lo si sanifica e lo si
ricodifica**. Nuovo modulo `src/gemini/sanitize/svg-data-uri.js`.

```
data:image/svg+xml;utf8,<svg …>
   │
   ├─ decodifica (percent-encoding o base64)
   ├─ parsing con DOMParser in modalità image/svg+xml
   ├─ allowlist di tag (solo primitive di disegno)
   ├─ allowlist di attributi (niente on*, niente href)
   ├─ ripristino della grafia camelCase (viewBox, preserveAspectRatio)
   └─ riserializzazione → data:image/svg+xml,<svg ripulito>
```

Punti di progetto rilevanti:

**Riconoscimento tollerante del prefisso.** La prima versione della regex
richiedeva `;charset=…` e falliva su `;utf8`. Ora accetta qualunque sequenza di
parametri e verifica separatamente la presenza di `base64`:

```js
const SVG_DATA_URI = /^data:image\/svg\+xml([^,]*),([\s\S]*)$/i;
// …
const isBase64 = /(^|;)\s*base64\s*$/i.test(parameters);
```

`;utf8` non è standard, ma è ciò che KaTeX emette ed è supportato ovunque:
il parser deve accettare la realtà, non la specifica.

**Allowlist chiusa.** Solo primitive di disegno (`path`, `line`, `rect`,
`circle`, `polyline`, `polygon`, gradienti, `clipPath`…). Fra gli attributi
sono esclusi in modo esplicito tutti gli `on*` e **ogni forma di `href`**,
inclusa `xlink:href`, che permetterebbe `javascript:`.

**Scarto in caso di dubbio.** Un payload che non si parsifica (`parsererror`) o
che non contiene alcun elemento disegnabile viene rifiutato: meglio un simbolo
mancante che un contenuto non verificabile.

**Ricodifica in percent-encoding.** Uniforme, compatta, e priva di caratteri
che possano chiudere anzitempo l'attributo HTML.

**Separazione netta nel sanitizer principale:**

```js
// Gli SVG NON passano da isSafeUrl: possono contenere script e vanno
// ripuliti, non semplicemente autorizzati.
if (tag === 'img' && name === 'src' && isSvgDataUri(attribute.value)) {
  const cleaned = sanitizeSvgDataUri(attribute.value, element.ownerDocument);
  if (cleaned) element.setAttribute('src', cleaned);
  else element.removeAttribute('src');
  continue;
}
```

`isSafeUrl` conserva ora solo il caso raster (`isRasterDataUri`), che è
davvero inerte.

---

## 5. Verifica

### Pipeline completa sul DOM reale

```
                      PRIMA   DOPO
katex-svg               29     29
src data:image/svg      29     29
delimsizing             35     35
hide-tail                7      7
```

Nessuna perdita in nessuno stadio.

### Sicurezza

Payload ostile in ingresso:

```html
<svg viewBox="0 0 10 10" onload="window.__pwned=1">
  <script>
    window.__pwned = 1;
  </script>
  <path d="M1 1" onclick="steal()" />
  <a href="javascript:alert(1)"><path d="M2 2" /></a>
</svg>
```

Payload in uscita:

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1" /></svg>
```

`onload`, `onclick`, `<script>`, `href="javascript:"` rimossi; tracciato
conservato.

### Test

`tests/unit/svg-data-uri.test.js` — 14 test: riconoscimento delle varianti di
prefisso, conservazione di tracciato/`viewBox`/proporzioni, rimozione di
script, gestori ed `href`, scarto dei payload vuoti o malformati, supporto
base64, integrazione con il sanitizer, non-regressione su raster e su
`data:text/html`.

Suite completa: **101 test, tutti verdi.**

Prova di genuinità (rimuovendo la gestione dedicata):

```
### BUG REINTRODOTTO ###   Tests  1 failed | 13 passed
### DOPO IL RIPRISTINO ###  Tests  101 passed (101)
```

### Export reale

Anteprima costruita sulla conversazione **autentica** dell'utente:

```
katex-svg (radici/graffe orizzontali) : 29
src data:image/svg ripulite           : 29
delimsizing (parentesi grandi)        : 41
font KaTeX_Size1-4 incorporati        : 12
riferimenti remoti                    :  0
script eseguibili nel body            :  0
```

---

## 6. Errore di metodo da cui imparare

I due fix precedenti erano corretti e necessari — la geometria collassata e i
font remoti erano problemi reali — ma **non erano la causa di ciò che l'utente
vedeva**. Sono stati verificati su fixture che io stesso avevo selezionato,
scegliendo (senza accorgermene) frammenti provenienti da porzioni di pagina non
rappresentative.

Tre correttivi di metodo, già applicati:

1. **Validare il fix sull'artefatto finale, non sul modulo.** La verifica ora
   parte dal `.markdown` reale con più formule e conta i simboli nel documento
   esportato.

2. **Leggere tutti i numeri della diagnostica.** `hide-tail 3` con `path 1` era
   la risposta, stampata e ignorata. Un conteggio incoerente va spiegato, non
   scavalcato.

3. **"Nessun cambiamento" è un'informazione, non un fallimento generico.**
   Indica che l'intervento non tocca il percorso attivo, e va usato per
   spostare l'indagine invece di rafforzare la stessa ipotesi.

Le tre cause erano reali e indipendenti; la loro somma spiega il difetto
completo. Ma l'ordine di priorità andava stabilito misurando prima, sul dato
vero, e questo non l'ho fatto.

---

## 7. File modificati

| File                                    | Modifica                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/gemini/sanitize/svg-data-uri.js`   | **Nuovo** — decodifica, sanifica e ricodifica gli SVG in data URI                     |
| `src/gemini/sanitize/html-sanitizer.js` | Gestione dedicata di `img[src^="data:image/svg+xml"]`; `isSafeUrl` limitato ai raster |
| `tests/unit/svg-data-uri.test.js`       | **Nuovo** — 14 test di regressione e sicurezza                                        |
