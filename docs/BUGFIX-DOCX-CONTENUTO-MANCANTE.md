# Bugfix — Word scarta intere sezioni: elementi OMML vuoti

**Data:** 25 luglio 2026
**Versione interessata:** 2.1.x (export Word)
**Gravità:** alta (perdita silenziosa di contenuto)
**Stato:** risolto

---

## 1. Sintomo

Aprendo il `.docx` in Word, alcune sezioni risultavano **assenti**:

| Sezione               | In Gemini                                  | In Word                          |
| --------------------- | ------------------------------------------ | -------------------------------- |
| 4 — Elettromagnetismo | Equazioni di Maxwell, Teoria dei Circuiti  | Titolo presente, **corpo vuoto** |
| 7 — Chimica           | Arrhenius, Michaelis-Menten, Van der Waals | Parte del contenuto **troncato** |

Non erano formule mal renderizzate: erano **paragrafi interi mancanti**, con al
loro posto uno spazio bianco. Il resto del documento era corretto.

---

## 2. Il depistaggio: il contenuto c'era

La prima verifica ha escluso l'ipotesi più ovvia — che la generazione perdesse
il contenuto. Ho confrontato l'HTML sanificato con l'XML prodotto:

```
TESTO                      HTML  DOCX
Legge di Gauss              SI    SI
Faraday                     SI    SI
Ampère                      SI    SI
Teoria dei Circuiti         SI    SI
Arrhenius                   SI    SI
Van der Waals               SI    SI
```

**Tutto presente.** Il `.docx` conteneva ogni parola. Anche la conversione in
PDF con LibreOffice mostrava l'intero documento, comprese le sezioni che
l'utente non vedeva.

Questo restringeva il campo a una sola possibilità: il file è completo, ma
**Word rifiuta di visualizzarne una parte**.

---

## 3. Causa

Ho cercato nel documento le violazioni dello schema OMML che un lettore
tollerante può ignorare e uno rigoroso no:

```
--- elementi OMML vuoti ---
  m:deg          7
  m:sup          6
```

Tredici elementi strutturali **auto-chiusi e privi di contenuto**.

Il codice li generava così:

```js
// Operatore grande con il solo pedice (∮_{∂S}, ∬_S, ∑_i …)
`<m:nary>
   <m:naryPr>
     <m:chr m:val="∮"/>
     <m:subHide m:val="0"/>
     <m:supHide m:val="1"/>   ← l'estremo superiore è nascosto…
   </m:naryPr>
   <m:sub>…</m:sub>
   <m:sup/>                   ← …quindi l'elemento è stato lasciato vuoto
   <m:e>…</m:e>
 </m:nary>`
// Radice quadrata senza indice
`<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>…</m:e></m:rad>`;
```

Il ragionamento sembrava sensato: `supHide="1"` nasconde l'estremo superiore,
quindi perché riempirlo? **Ma nello schema ECMA-376 `m:sup` e `m:deg` non sono
opzionali.** Gli attributi `supHide` e `degHide` controllano la _visibilità_,
non l'_esistenza_: l'elemento deve comunque essere presente e contenere almeno
un run.

Il comportamento di Word di fronte a un blocco non valido è la parte insidiosa:
non segnala un errore né mostra un segnaposto. **Scarta silenziosamente
l'intero paragrafo** che ospita la formula — e con esso il testo che lo
accompagna.

Ecco perché sparivano intere sezioni: le formule di Maxwell, degli integrali di
superficie e di Arrhenius contengono tutte operatori con il solo pedice, o
radici quadrate.

Corrispondenza esatta fra i 6 `<m:sup/>` e le zone segnalate:

```
operatore=∮  contesto="Teorema del Rotore (Stokes)"
operatore=∬  contesto="Teorema del Rotore (Stokes)"
operatore=∭  contesto="Teorema della Divergenza (Gauss)"
operatore=∬  contesto="Teorema della Divergenza (Gauss)"
operatore=∑  contesto="Teorema di Bayes"
operatore=∬  contesto="Integrale di Linea Chiuso Orientato"
```

---

## 4. Perché non l'avevo intercettato

Due ragioni, entrambe di metodo.

**La verifica usava il lettore sbagliato.** Controllo i documenti convertendoli
in PDF con LibreOffice, che di fronte a un `<m:sup/>` vuoto lo ignora e
prosegue. Il difetto era invisibile in ogni mia verifica: il PDF mostrava tutto.
Anche `python-docx`, che pure usa il parser di Office, si limita a leggere la
struttura del documento e non applica la validazione dello schema matematico.

**Avevo già incontrato il problema, senza generalizzarlo.** In un intervento
precedente avevo introdotto `fillSlot` proprio per evitare gli `<m:e>` vuoti,
che producevano quadratini segnaposto. Ho applicato la correzione al solo caso
osservato, senza chiedermi _quali altri elementi OMML non possono restare
vuoti_. La stessa causa si è ripresentata su `m:sup` e `m:deg`, con conseguenze
peggiori.

---

## 5. Soluzione

Tutti gli elementi strutturali obbligatori ricevono il contenuto minimo, anche
quando nascosti:

```js
// Word applica lo schema OMML in modo rigoroso: <m:sub>, <m:sup> e <m:deg>
// devono contenere almeno un run, anche quando sono nascosti da subHide/supHide
// o degHide. Un elemento auto-chiuso vuoto rende il blocco matematico non
// valido e Word lo scarta silenziosamente, insieme al paragrafo che lo ospita.
`<m:sub>${EMPTY_SLOT}</m:sub><m:sup>${EMPTY_SLOT}</m:sup><m:e>${operand}</m:e>``<m:radPr><m:degHide m:val="1"/></m:radPr><m:deg>${EMPTY_SLOT}</m:deg>`;
```

`EMPTY_SLOT` è un run con un singolo spazio: valido per lo schema, invisibile
nel documento perché l'attributo `supHide`/`degHide` ne sopprime comunque la
resa.

### Verifica di conformità estesa

Non essendomi fidato del solo caso osservato, ho controllato l'intero documento
contro i vincoli dello schema:

```
--- controlli di conformità OMML ---
  m:nary con ordine errato: 0
  m:f senza num/den       : 0
  m:rad senza deg/e       : 0
  m:sSub     incompleto   : 0
  m:sSup     incompleto   : 0
  m:sSubSup  incompleto   : 0
  XML ben formato         : SI
  elementi OMML vuoti     : NESSUNO
```

---

## 6. Test di regressione

`tests/unit/latex-omml.test.js` — sezione «conformità allo schema OMML»:

- **nessun elemento strutturale vuoto** (`m:sub`, `m:sup`, `m:deg`, `m:e`,
  `m:num`, `m:den`, `m:lim`) su dieci formule rappresentative, fra cui tutti i
  costrutti che avevano causato il difetto;
- gli elementi **nascosti restano presenti** e popolati;
- l'**ordine dei figli** di `m:nary` rispetta lo schema;
- frazioni e radici sono complete.

Il controllo è espresso su una **classe di elementi**, non sul singolo caso
osservato: è la generalizzazione che mancava la volta precedente.

### Prova di genuinità

Reintroducendo l'`<m:sup/>` vuoto:

```
### BUG REINTRODOTTO ###   Tests  2 failed | 47 passed
### DOPO IL RIPRISTINO ###  Tests  220 passed (220)
```

Suite completa: **220 test verdi.**

---

## 7. Lezione

**Un lettore tollerante non è uno strumento di validazione.** LibreOffice
mostrava un documento perfetto mentre Word ne scartava intere sezioni. Per i
formati con uno schema formale, la verifica deve essere fatta _contro lo
schema_, non contro un'applicazione che lo interpreta con indulgenza.

**Corollario applicato:** ho aggiunto controlli automatici sui vincoli
strutturali di OMML, che ora girano a ogni esecuzione dei test senza dipendere
da alcun visualizzatore.

**E la lezione più costosa:** quando si scopre che un elemento vuoto causa un
difetto, la domanda successiva non è «ho corretto questo caso?» ma «**quali
altri elementi soffrono dello stesso vincolo?**». La prima volta ho corretto
`m:e` e mi sono fermato lì; `m:sup` e `m:deg` avevano lo stesso problema e sono
tornati a mordere due iterazioni dopo, in forma più grave.

---

## 8. File modificati

| File                            | Modifica                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `src/export/docx/latex/omml.js` | `EMPTY_SLOT` applicato a `m:sub`, `m:sup` e `m:deg` nei quattro punti che li lasciavano vuoti |
| `tests/unit/latex-omml.test.js` | Nuova sezione: 4 test di conformità allo schema OMML                                          |
