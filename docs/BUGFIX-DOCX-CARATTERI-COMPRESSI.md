# Caratteri compressi e sovrapposti nel documento Word

## Sintomo

In alcuni paragrafi il testo appare schiacciato, con i glifi stampati uno sopra
l'altro e il contenuto illeggibile:

```
Denominatore: (per og)i x ≠0 1
Numeratore: x²i nu.eratore-è.sempreApos(tiv3)per o(i1)(4) R  −12 < 0
```

Il difetto si manifestava **in modo intermittente**: lo stesso file, aperto più
volte sulla stessa macchina, a volte si impaginava correttamente e a volte no.
Su installazioni diverse di Word il comportamento differiva. LibreOffice non
riproduceva mai il problema.

## Perché non era una regressione delle immagini

Il difetto è emerso subito dopo l'introduzione dell'esportazione delle immagini,
il che rendeva naturale sospettare quella modifica. La verifica l'ha esclusa.

Il `.docx` è stato rigenerato dallo stesso DOM con il codice corrente e con il
codice precedente all'aggiunta delle immagini, confrontando l'XML paragrafo per
paragrafo:

```
paragrafi: 463 vs 463
unica differenza: il timestamp di esportazione
```

Il confronto con il file prodotto dall'estensione installata sulla macchina
dell'utente ha dato lo stesso esito: `word/document.xml`, `settings.xml`,
`styles.xml`, `[Content_Types].xml` e le relazioni erano identici, timestamp a
parte. Quel documento non conteneva alcun `<w:drawing>`: zero immagini.

Il difetto era quindi **preesistente**. Era rimasto nascosto perché colpiva gli
stessi paragrafi già interessati dal difetto «EQUAZIONE»
(vedi `BUGFIX-DOCX-EQUAZIONE-REFLOW.md`), molto più vistoso: risolto quello, è
diventato visibile questo.

## Diagnosi

### Il tratto comune dei paragrafi colpiti

Tutti i paragrafi difettosi hanno la stessa forma: **alternano testo normale e
formule inline**, quasi sempre all'interno di un elenco.

```xml
<w:p>                                    <!-- elemento di elenco -->
  <w:r><w:b/>Denominatore:</w:r>         <!-- testo, Calibri -->
  <m:oMath>(x-1)²>0</m:oMath>            <!-- matematica, Cambria Math -->
  <w:r> per ogni </w:r>                  <!-- testo, Calibri -->
  <m:oMath>x≠1</m:oMath>                 <!-- matematica, Cambria Math -->
  <w:r>.</w:r>
</w:p>
```

I paragrafi di sola formula e quelli di solo testo erano sempre corretti. Il
fattore discriminante è il **passaggio ripetuto fra due font diversi** nella
stessa riga.

### L'intermittenza come indizio decisivo

Un'impaginazione sbagliata in modo deterministico deriva da XML sbagliato. Una
sbagliata _a volte_ deriva da un valore **non dichiarato**, il cui default
dipende dall'ambiente. Questa osservazione ha ristretto la ricerca alle
impostazioni assenti da `word/settings.xml`, non a quelle presenti.

### Le due cause

**1. `w:eastAsia="Cambria Math"` nei default di carattere**

```xml
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"
          w:eastAsia="Cambria Math"/>
```

Era stato introdotto per il difetto «EQUAZIONE», con l'intenzione di offrire a
Word un riferimento per le metriche OpenType MATH.

L'assunto era sbagliato. `eastAsia` non è un font di riserva: dichiara con quale
font misurare i caratteri **classificati come appartenenti alla scrittura
dell'Asia orientale**. Collocato in `<w:docDefaults>` valeva per ogni run del
documento e attivava il motore tipografico CJK, che applica regole di spaziatura
proprie — fra cui la compressione delle larghezze di avanzamento ai confini fra
scritture diverse.

Un paragrafo che alterna Calibri e Cambria Math è tutto un susseguirsi di quei
confini.

**2. `<w:characterSpacingControl>` assente**

Questa impostazione governa proprio la compressione della spaziatura CJK. Quando
è assente, Word applica un valore predefinito **che dipende dalla lingua di
installazione**: le build con supporto per l'Asia orientale comprimono, le altre
no. È la spiegazione dell'intermittenza.

Le due cause sono complementari: la prima attiva il meccanismo, la seconda lo
lascia libero di comprimere.

## Correzione

`src/export/docx/ooxml.js`, in `STYLES_XML`:

```xml
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/>
```

`src/export/docx/ooxml.js`, in `SETTINGS_XML`:

```xml
<w:characterSpacingControl w:val="doNotCompress"/>
```

Dichiarare esplicitamente l'impostazione elimina la dipendenza dalla
configurazione della singola installazione: il risultato diventa deterministico
su qualunque Word.

Nessuna delle due modifiche tocca le metriche delle equazioni. Il riferimento a
Cambria Math necessario a Word per il calcolo delle altezze è quello dichiarato
sui singoli run matematici (`MATH_FONT_PR`) e in `<m:mathPr><m:mathFont>`, che
restano invariati: il difetto «EQUAZIONE» non può riemergere.

## Verifica

`tests/unit/ooxml-conformance.test.js`:

- _disattiva la compressione della spaziatura CJK_ — richiede la presenza di
  `<w:characterSpacingControl w:val="doNotCompress"/>`
- _non attribuisce il font matematico alla scrittura dell'Asia orientale_ —
  richiede l'assenza di `w:eastAsia="Cambria Math"`

Entrambi sono stati verificati reintroducendo il difetto: falliscono con il
codice difettoso, passano con quello corretto. Suite completa: 347 test.

## Lezione

Il commento che accompagnava `eastAsia="Cambria Math"` affermava che «Word lo usa
come riferimento per le metriche OpenType MATH». Era una supposizione, scritta
con il tono di un fatto accertato, e ha reso l'attributo invisibile alle
revisioni successive per diverse iterazioni.

Un commento che giustifica una riga di codice deve distinguere ciò che è stato
osservato da ciò che è stato ipotizzato. Quando un'impostazione viene aggiunta
per tentativi durante la ricerca di un difetto, va rimossa se la verifica non ne
dimostra la necessità: le correzioni sopravvissute per inerzia diventano le
cause dei difetti seguenti.
