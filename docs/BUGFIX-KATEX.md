# Bugfix — Formule matematiche collassate nel PDF esportato

**Data:** 25 luglio 2026
**Versione interessata:** 2.0.0
**Gravità:** alta (contenuto illeggibile, nessuna perdita di dati)
**Stato:** risolto

---

## 1. Sintomo

Tutto il resto dell'esportazione funzionava correttamente (testo, tabelle,
codice, liste), ma **le formule matematiche risultavano completamente
scomposte** nel PDF.

| In Gemini                                | Nel PDF esportato                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `E = mc²` con l'esponente in apice       | `E=mc` con il `2` staccato e fluttuante sopra la riga                            |
| `lim (x→0) sin(x)/x = 1`                 | `lim` con `x→0` spostato in alto a destra, numeratore e denominatore sovrapposti |
| Formula quadratica con frazione e radice | `−b±√b²−4ac` in un riquadro, `2a` collassato sopra il testo del paragrafo        |
| Integrale `∫ e^(−x²) dx = √π`            | Simboli accavallati su un'unica riga, estremi `−∞` e `∞` fuori posto             |
| Matrice `A` con parentesi estensibili    | Elementi ammassati al centro, parentesi ridotte a due barre verticali            |

Le formule non erano _mancanti_: tutti i simboli erano presenti, ma **privi di
posizionamento**, sovrapposti gli uni agli altri.

---

## 2. Come funziona KaTeX (necessario per capire il bug)

KaTeX **non** usa font matematici né MathML per la resa visiva. Costruisce ogni
formula come una struttura di `<span>` posizionati con precisione millimetrica,
combinando tabelle CSS e stili inline calcolati.

Esempio reale, estratto dal DOM di Gemini per `E = mc²`:

```html
<span class="katex">
  <span class="katex-mathml">…MathML per screen reader…</span>
  <span class="katex-html" aria-hidden="true">
    <span class="base">
      <span class="strut" style="height: 0.8141em;"></span> ← VUOTO
      <span class="mord mathnormal">m</span>
      <span class="mord">
        <span class="mord mathnormal">c</span>
        <span class="msupsub">
          <span class="vlist-t">
            <span class="vlist-r">
              <span class="vlist" style="height: 0.8141em;">
                <span style="top: -3.063em; margin-right: 0.05em;">
                  <span class="pstrut" style="height: 2.7em;"></span> ← VUOTO
                  <span class="sizing reset-size6 size3 mtight">
                    <span class="mord mtight">2</span>
                  </span>
                </span>
              </span>
            </span>
          </span>
        </span>
      </span>
    </span>
  </span>
</span>
```

Gli elementi decisivi sono proprio quelli **senza testo**:

| Elemento         | Funzione                                                | Ha testo?         |
| ---------------- | ------------------------------------------------------- | ----------------- |
| `.strut`         | Fissa l'altezza della riga base                         | ❌ no             |
| `.pstrut`        | Puntello che stabilisce l'origine verticale in una pila | ❌ no             |
| `.mspace`        | Spaziatura tipografica fra simboli (es. attorno a `=`)  | ❌ no             |
| `.vlist-s`       | Cella di allineamento nelle pile verticali              | ❌ solo `&#8203;` |
| `.frac-line`     | Disegna la linea di frazione (è un bordo CSS)           | ❌ no             |
| `.nulldelimiter` | Spazio riservato dove non c'è una parentesi             | ❌ no             |

Inoltre, la posizione di ogni simbolo è codificata in **attributi `style`
inline** (`height`, `top`, `margin-right`), e le pile verticali usano un layout
tabellare: `.vlist-t { display: inline-table }`, `.vlist-r { display: table-row }`,
`.vlist { display: table-cell }`.

**Conclusione:** in una formula KaTeX, "elemento senza testo" **non** significa
"elemento inutile". Significa quasi sempre il contrario.

---

## 3. Cause

Il difetto nasceva da **due cause indipendenti**, entrambe sufficienti da sole a
rompere la resa. Entrambe derivavano da una stessa assunzione sbagliata: trattare
il markup KaTeX come normale HTML di contenuto.

### Causa A — La pulizia eliminava gli span di geometria

Introdotta nella riscrittura 2.0.0, in `src/gemini/sanitize/structure.js`:

```js
export function removeEmptyContainers(root) {
  const containers = Array.from(root.querySelectorAll('div, span, section, p'));

  for (const element of containers.reverse()) {
    const hasText = (element.textContent ?? '').trim().length > 0;
    const hasMedia = element.querySelector('img, svg, table, pre, hr, br');
    if (!hasText && !hasMedia) element.remove(); // ← distrugge la formula
  }
}
```

La funzione serviva a rimuovere i `<div>` rimasti vuoti dopo l'eliminazione dei
chip delle citazioni: uno scopo legittimo. Ma il criterio "nessun testo e nessun
media ⇒ elemento superfluo" colpisce in pieno `strut`, `pstrut`, `mspace`,
`frac-line` e `nulldelimiter`.

Peggiora il tutto l'iterazione `.reverse()` (dal più interno al più esterno):
rimosso lo `strut` interno, il `.base` che lo conteneva diventa a sua volta
"vuoto" e viene eliminato al passo successivo. **L'eliminazione si propaga a
cascata** lungo tutta la struttura della formula.

Misurazione sulla formula `E = mc²` presa dal DOM reale:

```
                        strut  pstrut  mspace  style=  lunghezza
ORIGINALE                   2       1       2       8        900
dopo removeNoise            2       1       2       8        900
dopo normalizeMath          2       1       2       8        881   (rimosso il MathML: corretto)
dopo removeEmptyContainers  0       0       0       3        604   ← ✗ geometria distrutta
```

Il 33% del markup della formula veniva eliminato, insieme a 5 degli 8 attributi
`style` che ne definivano il posizionamento.

### Causa B — Le override CSS combattevano il motore di layout di KaTeX

Ereditata dalla versione 1.3 e trasferita invariata in
`assets/styles/katex-overrides.css`:

```css
.katex .mord,
.katex .mop,
.katex .mrel,
.katex .mbin,
.katex .mpunct,
.katex .minner,
.katex .munderover,
.katex .mfrac,
.katex .mspace {
  display: inline-block !important; /* ← sovrascrive il layout di KaTeX */
}

.katex .base {
  position: relative !important;
}

.katex .cases > span,
.katex .array > span {
  display: table-row !important; /* ← selettori inesistenti in KaTeX */
}
```

Tre problemi distinti:

1. **`display: inline-block !important` su `.mfrac`.** Il foglio ufficiale
   `katex.min.css` **non dichiara mai** `display` su `mord` o `mfrac`: il
   posizionamento passa dalla catena `.vlist-t` (inline-table) → `.vlist-r`
   (table-row) → `.vlist` (table-cell). Forzare `inline-block` con `!important`
   spezza il contesto di formattazione tabellare, e numeratore e denominatore
   perdono l'allineamento verticale — esattamente ciò che si vede nello
   screenshot.

   Verifica sul CSS ufficiale:

   ```
   $ grep -c 'mord{display:inline-block\|mfrac{display' assets/styles/katex.min.css
   0
   ```

2. **`position: relative` su `.base`.** Crea un nuovo contesto di posizionamento
   che altera il riferimento degli offset `top` negativi usati dalle pile.

3. **`.cases > span` e `.array > span`.** Classi che KaTeX non genera: regole
   inefficaci, aggiunte "a sentimento" per tamponare i sintomi della causa 1
   invece di rimuoverla.

Le override erano nate nella v1.3 proprio _per correggere_ formule mal
renderizzate, ma curavano l'effetto anziché la causa, aggiungendo un secondo
livello di rottura sopra il primo.

---

## 4. Perché i test non l'hanno intercettato

La fixture `RESPONSE_WITH_KATEX` usata nei test era **scritta a mano** e
semplificata:

```js
<span class="katex-html" aria-hidden="true">
  <span class="base">E=mc²</span>
</span>
```

Conteneva il testo `E=mc²` direttamente dentro `.base`, quindi:

- `.base` **aveva** testo → `removeEmptyContainers` non lo rimuoveva;
- non c'erano `strut`, `pstrut`, `vlist` né stili inline da perdere.

I test verificavano correttamente ciò che testavano (`katex-mathml` rimosso,
`katex-html` presente), ma la fixture non rappresentava la struttura reale.
**Una fixture semplificata dà una falsa sensazione di sicurezza**: il test era
verde su un caso che non esiste in produzione.

---

## 5. Soluzione

### Correzione A — Proteggere i sottoalberi di layout

`src/gemini/sanitize/structure.js`:

```js
/**
 * Sottoalberi in cui un elemento privo di testo NON è un elemento superfluo.
 * KaTeX costruisce le formule con span vuoti che trasportano la geometria.
 */
const STRUCTURAL_SUBTREES = '.katex, .katex-display, math, svg';

export function removeEmptyContainers(root) {
  const containers = Array.from(root.querySelectorAll('div, span, section, p'));

  for (const element of containers.reverse()) {
    if (isLayoutCritical(element)) continue; // ← protezione

    const hasText = (element.textContent ?? '').trim().length > 0;
    const hasMedia = element.querySelector('img, svg, table, pre, hr, br');
    if (!hasText && !hasMedia) element.remove();
  }
}

function isLayoutCritical(element) {
  return element.closest(STRUCTURAL_SUBTREES) !== null;
}
```

Si è scelto `closest()` su una lista di sottoalberi, invece di un elenco di
classi da salvare (`strut`, `pstrut`, …), perché è **robusto rispetto al
futuro**: se KaTeX introdurrà una nuova classe di geometria, sarà protetta
automaticamente. Lo stesso vale per `<svg>` (delimitatori estensibili) e
`<math>`. La pulizia continua a funzionare normalmente ovunque al di fuori delle
formule.

### Correzione B — Riscrittura delle override CSS

`assets/styles/katex-overrides.css` è stato riscritto secondo il principio:
**`katex.min.css` è già corretto e completo; le nostre regole devono solo
integrarlo, mai contraddirlo.**

Rimosse tutte le dichiarazioni `display` su `mord`/`mfrac`/`base`/`mspace` e i
selettori inesistenti. Il file ora contiene soltanto:

1. **MathML nascosto** con la tecnica `clip` (non `display: none`, che in alcuni
   motori di stampa impedirebbe il calcolo delle metriche).
2. **Margini e scorrimento** dei blocchi `.katex-display`, con `overflow-x: auto`
   perché le matrici larghe non rompano il layout della pagina.
3. **Isolamento dagli stili del documento**: `document.css` applica
   `line-height: 1.75` e `word-break: break-word` al markdown, valori che
   falsano i calcoli di KaTeX e possono spezzare i simboli. Le formule tornano a
   `line-height: 1.2` e `word-break: normal`.
4. Lo stile del fallback `.gex-latex-fallback` (spostato qui da `document.css`,
   dov'era duplicato).

Un commento in testa al file avverte esplicitamente il futuro manutentore di non
ridichiarare `display` sugli elementi interni di KaTeX.

---

## 6. Verifica

### Test di regressione con DOM reale

Aggiunta la fixture `tests/fixtures/katex-real.js`, con tre formule **catturate
dal DOM vero di Gemini** (non scritte a mano):

- `KATEX_INLINE_FRACTION` — limite con frazione (2,4 KB di markup);
- `KATEX_DISPLAY_INTEGRAL` — integrale improprio con radice (4,4 KB);
- `KATEX_DISPLAY_MATRIX` — matrice con delimitatori estensibili (12,9 KB).

Aggiunto `tests/unit/katex-preservation.test.js` (15 test), che per ogni formula
esegue l'intera pipeline di pulizia e verifica:

- il numero di `strut`, `pstrut`, `mspace` e `vlist` è **identico** prima e dopo;
- il numero di attributi `style` inline è identico;
- il conteggio totale dei nodi dentro `.katex` non cambia;
- `katex-html` è presente e `katex-mathml` è rimosso;
- `removeEmptyContainers` continua a rimuovere i contenitori vuoti _fuori_ dalle
  formule (nessuna regressione sullo scopo originario).

### Prova che i test siano genuini

Reintrodotto artificialmente il bug (rimossa la riga `if (isLayoutCritical…)`):

```
### CON IL BUG REINTRODOTTO ###
Tests  10 failed | 5 passed (15)

### DOPO IL RIPRISTINO ###
Tests  15 passed (15)
```

I test falliscono davvero in presenza del difetto: non sono asserzioni vuote.

### Suite completa

```
Test Files  8 passed (8)
     Tests  75 passed (75)
```

### Verifica sull'export reale

Anteprima rigenerata con le formule autentiche (`docs/preview-export.html`):

```
strut 7 | pstrut 38 | vlist 156 | mspace 11 | delimsizing 8
```

Tutta la geometria è presente nel documento finale; frazioni, integrali,
apici e matrici sono resi correttamente.

---

## 7. Lezioni apprese

1. **Le fixture semplificate nascondono i bug.** Un test su HTML scritto a mano
   verifica la propria immaginazione, non la realtà. Per il markup generato da
   terze parti servono campioni catturati dalla produzione. È la ragione per cui
   `tests/fixtures/katex-real.js` conserva markup verboso e "brutto".

2. **"Vuoto" non significa "inutile".** In qualsiasi struttura generata da un
   motore di layout (KaTeX, grafici SVG, editor WYSIWYG) gli elementi senza
   testo trasportano informazione. Le euristiche di pulizia vanno sempre
   circoscritte a un perimetro esplicito.

3. **Non combattere la libreria che stai usando.** Le override della v1.3 erano
   nate per curare un sintomo e ne avevano generato un altro. Prima di scrivere
   `!important` su una classe di terze parti, conviene leggere il CSS originale:
   `grep 'mord{display' katex.min.css` avrebbe risparmiato l'intero problema.

4. **Un test che non fallisce mai non protegge nulla.** Verificare la genuinità
   di un test di regressione reintroducendo il bug è un passaggio che costa
   trenta secondi e dà una certezza reale.

---

## 8. File modificati

| File                                    | Modifica                                                        |
| --------------------------------------- | --------------------------------------------------------------- |
| `src/gemini/sanitize/structure.js`      | Protezione dei sottoalberi di layout in `removeEmptyContainers` |
| `assets/styles/katex-overrides.css`     | Riscritto: rimosse le override in conflitto con KaTeX           |
| `assets/styles/document.css`            | Rimossa la definizione duplicata di `.gex-latex-fallback`       |
| `tests/fixtures/katex-real.js`          | **Nuovo** — formule catturate dal DOM reale                     |
| `tests/unit/katex-preservation.test.js` | **Nuovo** — 15 test di regressione                              |
