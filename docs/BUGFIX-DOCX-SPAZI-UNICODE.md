# Bugfix — `[Equazione]` permanente e formule spostate a destra

**Data:** 25 luglio 2026
**Versione interessata:** 2.1.x (export Word)
**Gravità:** alta (formule non renderizzate)
**Stato:** risolto

---

## 1. Due sintomi distinti

Dopo l'aggiunta di `settings.xml` e del font Cambria Math, il segnaposto
«EQUAZIONE» transitorio è scomparso, ma sono emersi due difetti nuovi:

1. **`[Equazione]` permanente** su alcune formule — la trasformata di Fourier e
   quella di Laplace non venivano mai renderizzate, restando bloccate sul
   segnaposto anche dopo il caricamento completo;
2. **formule spostate a destra**, invece che allineate al testo.

Sono cause indipendenti.

---

## 2. `[Equazione]` permanente: caratteri assenti dal font

Confrontando le formule che fallivano con quelle che funzionavano è emerso un
tratto comune: le prime contengono `\quad`.

```
\quad     ->  "\u2003\u2003"     (EM SPACE)
\qquad    ->  "\u2003\u2003\u2003\u2003"
\,        ->  "\u2009"           (THIN SPACE)
\:        ->  "\u2005"
\;        ->  "\u2004"
\enspace  ->  "\u2002"
```

Sei comandi di spaziatura producevano **spazi tipografici Unicode**. Sono i
codepoint corretti dal punto di vista semantico, ma **non esistono in Cambria
Math**, il font con cui Word compone le equazioni.

Un carattere assente dal font matematico impedisce a Word di comporre il run.
A differenza di un glifo mancante nel testo normale — che verrebbe sostituito
da un carattere di ripiego — nella matematica Word non applica il _font
fallback_: rinuncia a comporre l'equazione e lascia il segnaposto.

È la ragione per cui il difetto colpiva **solo alcune formule**: quelle senza
`\quad` venivano renderizzate normalmente.

### Correzione

Tutti i comandi di spaziatura usano ora spazi normali (U+0020), approssimando
la larghezza con la ripetizione:

```js
export const SPACING = {
  quad: '   ',
  qquad: '      ',
  ',': ' ',
  // …
};
```

La spaziatura è tipograficamente meno precisa, ma la formula viene mostrata —
un compromesso evidente.

---

## 3. Formule a destra: il default di `oMathPara`

L'allineamento non era dichiarato:

```xml
<m:oMathPara><m:oMath>…</m:oMath></m:oMathPara>
```

Il valore predefinito di `<m:oMathPara>` **non** è l'allineamento del paragrafo:
è `centerGroup`, che centra il gruppo di equazioni rispetto alla riga. Nei
paragrafi larghi questo sposta visibilmente la formula verso destra.

La direttiva `<m:defJc m:val="left"/>` presente in `settings.xml` stabilisce il
default del _documento_, ma non sostituisce la dichiarazione esplicita sul
singolo blocco.

### Correzione

```xml
<m:oMathPara>
  <m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>
  <m:oMath>…</m:oMath>
</m:oMathPara>
```

---

## 4. Un'incoerenza scoperta durante la verifica

Il conteggio finale non tornava: **35 `oMathPara` ma solo 34 con allineamento**.

Il paragrafo mancante era prodotto da `buildParagraph`, che costruiva
`<m:oMathPara>` a mano invece di usare la funzione del generatore OMML. La
stessa forma definita in due punti: uno è stato aggiornato, l'altro no.

È lo stesso schema che aveva già causato la regressione del font (tre copie
duplicate della dichiarazione di Cambria Math). La forma è ora definita
un'unica volta, in `asMathParagraph()`, ed entrambi i chiamanti la usano.

---

## 5. Verifica

```
spazi Unicode esotici : NESSUNO
oMathPara             : 35 | con jc left: 35
run / font            : 797 / 797
parser Word           : OK, 96 paragrafi
```

**315 test verdi**, di cui 12 nuovi:

- nessuno spazio Unicode esotico per ciascuno dei 7 comandi di spaziatura;
- nessuno spazio esotico su **2000 formule casuali**;
- allineamento dichiarato sulle formule in blocco, assente su quelle inline;
- **coerenza**: ogni `oMathPara` del documento dichiara l'allineamento.

Prova di genuinità, reintroducendo i difetti:

```
### SPAZI ESOTICI REINTRODOTTI ###   1 failed | 69 passed
### ALLINEAMENTO RIMOSSO ###         2 failed | 96 passed
### DOPO IL RIPRISTINO ###           315 passed
```

---

## 6. Lezione

**Il font non è un dettaglio di presentazione: è un vincolo di validità.**
Nella matematica di Word un carattere assente dal font non degrada la resa,
la impedisce. La scelta dei codepoint va fatta rispetto a ciò che Cambria Math
contiene, non rispetto a ciò che è semanticamente corretto in Unicode.

**Corollario già visto due volte:** ogni volta che la stessa struttura XML
viene costruita in più punti, prima o poi divergono. Le forme canoniche
(`mathRun`, `slot`, `asMathParagraph`) esistono per rendere impossibile
l'incoerenza, non per eleganza.

---

## 7. File modificati

| File                                   | Modifica                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| `src/export/docx/latex/symbols.js`     | `SPACING` usa solo spazi ASCII                               |
| `src/export/docx/latex/omml.js`        | `asMathParagraph()` con allineamento esplicito, esportata    |
| `src/export/docx/html-to-ooxml.js`     | Usa `asMathParagraph()` invece di costruire il markup a mano |
| `tests/unit/omml-robustness.test.js`   | 11 test su spazi e allineamento                              |
| `tests/unit/ooxml-conformance.test.js` | 1 test di coerenza sull'allineamento                         |
