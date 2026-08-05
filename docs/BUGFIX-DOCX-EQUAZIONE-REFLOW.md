# Bugfix — «EQUAZIONE» e contenuto spinto fuori pagina

**Data:** 25 luglio 2026
**Versione interessata:** 2.1.x (export Word)
**Gravità:** alta (contenuto illeggibile o tagliato)
**Stato:** risolto

---

## 1. L'osservazione decisiva

Per quattro iterazioni ho cercato la causa nel posto sbagliato, convinto che
Word _scartasse_ del contenuto. L'utente ha poi descritto **cosa accade
esattamente all'apertura del file**:

> All'apertura tutto il testo esce e il documento ha 10 pagine, ma tutte le
> formule hanno scritto EQUAZIONE. Poco dopo che la pagina carica, tutte le
> formule passano da quella scritta alla grossa formula, e questo per ogni
> pagina spinge sotto il testo ed è per questo che viene tagliato.

Questa descrizione ribalta la diagnosi. **Il contenuto non viene mai eliminato:
viene spostato.** Word impagina il documento assumendo che ogni formula occupi
l'altezza di una riga di testo — quanto basta per la parola «EQUAZIONE» — e solo
in un secondo momento calcola l'altezza reale delle equazioni. A quel punto
riflowa tutto, e ciò che era in fondo alla pagina finisce oltre il margine.

Il segnaposto «EQUAZIONE» è il sintomo diagnostico: Word lo mostra quando
riconosce la presenza di matematica ma **non dispone dei dati necessari a
impaginarla**.

---

## 2. Causa

Ispezionando il pacchetto generato:

```
PARTI DEL .docx
   [Content_Types].xml
   _rels/.rels
   word/document.xml
   word/_rels/document.xml.rels
   word/styles.xml
   word/numbering.xml
   docProps/core.xml
   docProps/app.xml

settings.xml presente : False        ← manca
m:mathPr              : False        ← manca
Cambria Math          : mai citato   ← manca
```

Tre elementi mancanti, tutti concorrenti allo stesso effetto.

### 2.1 `word/settings.xml` con `<m:mathPr>`

`<m:mathPr>` contiene i parametri di impaginazione della matematica: font di
riferimento, allineamento predefinito, punti di interruzione delle formule
lunghe, posizione degli estremi negli operatori. Senza questa parte Word non ha
un contesto matematico configurato e rimanda il layout delle equazioni a dopo
il caricamento.

### 2.2 Il font `Cambria Math` sui run

Cambria Math non è un font qualsiasi: contiene le **tabelle OpenType MATH**, i
dati metrici da cui Word ricava come dimensionare radici, delimitatori
estensibili, frazioni e apici. Ogni run matematico deve dichiararlo:

```xml
<m:r>
  <w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:cs="Cambria Math"/></w:rPr>
  <m:t>x</m:t>
</m:r>
```

I nostri run non lo dichiaravano. Word non poteva calcolare l'altezza
dell'equazione al momento del caricamento, e la rimandava.

### 2.3 `word/fontTable.xml`

Dichiara i font usati dal documento con la loro famiglia e il passo. La sua
assenza obbliga Word a dedurre le metriche a documento già aperto — un ulteriore
fattore di ricalcolo differito.

**In sintesi:** ognuna delle tre mancanze contribuisce a rimandare il calcolo
dell'altezza delle formule. Il riflusso conseguente è ciò che l'utente vedeva
come "contenuto mangiato".

---

## 3. Soluzione

### Le parti mancanti

`word/settings.xml`:

```xml
<m:mathPr>
  <m:mathFont m:val="Cambria Math"/>
  <m:brkBin m:val="before"/>
  <m:smallFrac m:val="0"/>
  <m:dispDef/>
  <m:defJc m:val="left"/>
  <m:intLim m:val="subSup"/>     <!-- integrali: estremi di lato -->
  <m:naryLim m:val="undOvr"/>    <!-- sommatorie: sopra e sotto -->
</m:mathPr>
```

Le ultime due direttive rendono globale la convenzione tipografica che avevamo
già applicato formula per formula: ora è dichiarata a livello di documento.

`word/fontTable.xml` dichiara Calibri, Cambria Math e Consolas. Entrambe le
parti sono registrate in `[Content_Types].xml` e nelle relazioni del documento.

### Il font su ogni run

`renderRun` emette la dichiarazione su tutti i run matematici, `EMPTY_SLOT`
compreso — quest'ultimo era l'unico a sfuggire, essendo costruito a mano:

```
run matematici: 797 | con Cambria Math: 797
```

L'ordine è quello imposto dallo schema: `<m:rPr>` (proprietà matematiche) prima
di `<w:rPr>` (proprietà di run).

### Protezione dal riflusso residuo

Allo stile `Formula` sono stati aggiunti `<w:keepLines/>` e `<w:widowControl/>`:
una formula non viene spezzata fra due pagine anche se il ricalcolo dovesse
comunque avvenire. È una difesa in profondità, non la correzione principale.

---

## 4. Una regressione trovata e corretta

L'aggiunta del font ha rotto la fusione dei run adiacenti, che riconosceva il
vecchio formato senza `<w:rPr>`. La suite l'ha intercettata subito (`f(x, y)`
tornava a 6 run separati, con le parentesi ingrandite da Word).

Correggendo è emerso un secondo difetto più sottile: la funzione di fusione
ricostruiva il run passando dal `renderRun`, che **rieseguiva l'escaping su
testo già escapato** — `&lt;` sarebbe diventato `&amp;lt;`. Anche questo è stato
colto da un test esistente sull'escaping dei caratteri riservati.

Entrambi corretti: i testi già trattati vengono ora concatenati senza
rielaborazione.

---

## 5. Verifica

```
parti           : 10  (erano 8)
settings.xml    : presente
fontTable.xml   : presente
m:mathPr        : presente
run matematici  : 797 | con Cambria Math: 797
oMathPara       : 35
keepLines       : presente
parser Word     : OK, 96 paragrafi
```

**244 test verdi**, di cui 5 nuovi che presidiano queste condizioni: presenza di
`settings.xml` con `mathPr`, presenza della tabella font, dichiarazione dei tipi
di contenuto, font su **ogni** run matematico, `keepLines` sullo stile Formula.

---

## 5-bis. Difesa aggiuntiva: apertura in layout web

Le correzioni sopra rimuovono la causa del ricalcolo, ma dipendono da come Word
gestisce il proprio motore di impaginazione, che non possiamo osservare
direttamente. L'utente ha segnalato un dato utile: **passando a "layout web" il
documento si sistema**, per poi tornare disallineato al ripristino delle pagine
separate.

Il documento si apre quindi in layout web:

```xml
<w:settings>
  <w:view w:val="web"/>
  …
</w:settings>
```

In questa modalità il contenuto scorre come una pagina unica e continua: non
esistendo margini di pagina, un eventuale riflusso non può spingere il testo
fuori dall'area visibile.

**Non influisce sulla stampa.** Il formato è dichiarato in `<w:sectPr>` e resta
A4 con i margini definiti; è la visualizzazione iniziale a cambiare. Verificato
convertendo il documento in PDF: 5 pagine, formato 595×842 pt (A4).

L'utente può comunque passare a "layout di stampa" dal menu Visualizza.

## 6. Lezione

**La descrizione del comportamento vale più di dieci ispezioni del file.** Per
quattro giri ho cercato contenuto mancante in un documento che lo conteneva
tutto. La frase «prima c'è scritto EQUAZIONE, poi diventa la formula e spinge
giù il testo» ha identificato la causa in pochi minuti, perché descriveva un
_processo_ — il ricalcolo differito — non uno _stato_.

**Corollario:** quando un difetto non si riproduce nell'ambiente di sviluppo,
la domanda più produttiva da fare all'utente non è «cosa vedi» ma «**cosa
succede, nell'ordine**». Un file statico non mostra che l'impaginazione avviene
in due fasi; la descrizione dell'utente sì.

---

## 7. File modificati

| File                       | Modifica                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/export/docx/ooxml.js` | `SETTINGS_XML` con `<m:mathPr>`, `FONT_TABLE_XML`, tipi di contenuto e relazioni, `keepLines` sullo stile Formula, `eastAsia` nei default |

> **Aggiornamento.** L'attributo `eastAsia="Cambria Math"` nei default di
> carattere, introdotto qui, si è poi rivelato la causa di un difetto distinto:
> attivava la tipografia CJK su tutto il documento, comprimendo i caratteri nei
> paragrafi che alternano testo e formule inline. È stato riportato a `Calibri`.
> Vedi `BUGFIX-DOCX-CARATTERI-COMPRESSI.md`. Le metriche delle equazioni non ne
> dipendevano: sono garantite da `MATH_FONT_PR` sui run e da `<m:mathFont>`.
> | `src/export/docx/docx.renderer.js` | Inclusione di `settings.xml` e `fontTable.xml` nel pacchetto |
> | `src/export/docx/latex/omml.js` | Cambria Math su ogni run; fusione dei run adattata e resa sicura rispetto all'escaping |
> | `tests/unit/ooxml-conformance.test.js` | 5 test sulle parti e sul font |
