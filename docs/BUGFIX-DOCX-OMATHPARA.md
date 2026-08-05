# Bugfix — La causa generale: `<m:oMath>` non può essere l'unico figlio di `<w:p>`

**Data:** 25 luglio 2026
**Versione interessata:** 2.1.x (export Word)
**Gravità:** alta (perdita silenziosa di contenuto)
**Stato:** risolto, con validatore automatico a presidio

---

## 1. Il problema, dopo tre tentativi

Per tre iterazioni consecutive Word ha continuato a "mangiare" parti del
documento: sezione 4, parti della 7, poi la 2, la 5, la 8. Ogni volta correggevo
il caso segnalato, e alla successiva esportazione ne emergevano altri.

Il difetto aveva sempre la stessa forma:

- il testo **è presente** nel `.docx` generato;
- LibreOffice e `python-docx` mostrano il documento **completo**;
- Word ne visualizza solo una parte, **senza alcun messaggio d'errore**.

Il fatto che i casi cambiassero a ogni giro era il segnale che stavo curando i
sintomi. Serviva la causa comune.

---

## 2. Come l'ho trovata

Ho smesso di ispezionare le formule segnalate e ho cercato **cosa avessero in
comune i paragrafi che sparivano**, analizzando la struttura del documento
invece del suo contenuto:

```
paragrafi totali                        : 96
paragrafi con SOLO matematica (no <w:r>): 35   ← tutti quelli che sparivano
paragrafi misti testo + matematica      :  5   ← nessun problema
```

La corrispondenza era esatta: **spariva ogni paragrafo in cui `<m:oMath>` era
l'unico figlio di `<w:p>`**.

```xml
<!-- Forma prodotta dall'esportatore: Word la scarta -->
<w:p>
  <w:pPr><w:pStyle w:val="Formula"/></w:pPr>
  <m:oMath>…</m:oMath>
</w:p>
```

---

## 3. Causa

Nello schema ECMA-376 la matematica ha **due forme distinte**, non
intercambiabili:

| Contesto                         | Forma corretta                                               |
| -------------------------------- | ------------------------------------------------------------ |
| **Inline**, accanto al testo     | `<w:p><w:r>…</w:r><m:oMath>…</m:oMath><w:r>…</w:r></w:p>`    |
| **In blocco**, paragrafo proprio | `<w:p><m:oMathPara><m:oMath>…</m:oMath></m:oMathPara></w:p>` |

`<m:oMathPara>` è il contenitore della matematica _a livello di paragrafo_: è la
forma che Word stesso produce quando si inserisce un'equazione in blocco.
Un `<m:oMath>` isolato dentro `<w:p>`, senza run accanto e senza `oMathPara`,
non corrisponde a nessuna delle due forme.

Word, di fronte a un paragrafo che non riconosce, non lo segnala e non lo rende
parzialmente: **lo elimina insieme a tutto ciò che contiene**. È lo stesso
comportamento — silenzioso e distruttivo — che avevo già incontrato con gli
elementi vuoti.

Nel documento dell'utente questo riguardava **35 paragrafi su 96**: tutte le
formule in blocco, cioè la quasi totalità del contenuto matematico.

### Il caso residuo

Dopo la prima correzione ne restava uno: un paragrafo che conteneva una formula
marcata come _inline_ da Gemini, ma che di fatto era l'unico contenuto della
riga. Anche quello va avvolto in `oMathPara`: la regola non dipende da come la
formula è classificata nel sorgente, ma da **cosa contiene il paragrafo finale**.

---

## 4. Soluzione

Due interventi complementari, in punti diversi della catena.

**Nel generatore OMML** — la forma in blocco è esplicita:

```js
export function latexToOmml(latex, { block = false } = {}) {
  const math = `<m:oMath>${renderNodes(parseLatex(latex))}</m:oMath>`;
  return block ? `<m:oMathPara>${math}</m:oMathPara>` : math;
}
```

**Nel costruttore di paragrafi** — la regola vale anche quando una formula
inline si ritrova da sola, caso che il chiamante non può prevedere:

```js
// Un <m:oMath> non può essere l'unico figlio di <w:p>: Word considera il
// paragrafo malformato e lo scarta. La forma canonica per la matematica che
// occupa un paragrafo intero è <m:oMathPara>.
const isOnlyMath = meaningful.length === 1 && meaningful[0].omml !== undefined;
if (isOnlyMath) {
  return `<w:p>${properties}<m:oMathPara>${meaningful[0].omml}</m:oMathPara></w:p>`;
}
```

Il secondo intervento è quello che rende la correzione **generale**: qualunque
percorso produca un paragrafo di sola matematica, la forma canonica è garantita.

Risultato sul documento reale:

```
oMath nudi : 35 → 0
oMathPara  :  0 → 35
misti      :  5 →  5   (invariati: sono corretti così)
```

---

## 5. La correzione di metodo: un validatore

Il problema di fondo non era tecnico ma di **strumenti di verifica**. Nessuno
degli strumenti a disposizione applica lo schema alla matematica:

| Strumento     | Verifica                                  |
| ------------- | ----------------------------------------- |
| LibreOffice   | Rende tutto, tollera le violazioni        |
| `python-docx` | Legge la struttura, non valida OMML       |
| Word          | L'unico rigoroso — ma non disponibile qui |

Continuare a correggere il caso segnalato dall'utente significava usare _lui_
come validatore. Ho quindi scritto `tests/helpers/ooxml-validator.js`, che
codifica i vincoli dello schema che hanno realmente causato perdita di
contenuto:

- **figli obbligatori** e loro **ordine** per 15 elementi OMML
  (`m:nary`, `m:f`, `m:rad`, `m:sSub`, `m:sSubSup`, `m:limLow`, `m:m`, …);
- **elementi che non possono restare vuoti** (`m:e`, `m:sub`, `m:sup`, `m:deg`,
  `m:num`, `m:den`, `m:lim`);
- la regola sui paragrafi: **nessun `<m:oMath>` come unico figlio di `<w:p>`**.

`tests/unit/ooxml-conformance.test.js` lo applica a:

1. **14 formule** rappresentative di ogni costrutto che Gemini genera —
   integrali multipli, matrici, `aligned`, `cases`, radici annidate, frecce di
   reazione, sommatorie multiple, norme;
2. le stesse formule **in forma di blocco**;
3. i tre casi di paragrafo (blocco, inline isolata, inline con testo);
4. il **`word/document.xml` completo** generato da un documento con tutte le
   formule.

### Prova di genuinità

Rimuovendo entrambe le correzioni:

```
### BUG REINTRODOTTO ###   Tests  3 failed | 16 passed
### DOPO IL RIPRISTINO ###  Tests  239 passed (239)
```

---

## 6. Lezione

**Se lo stesso difetto ricompare tre volte in forme diverse, il problema non è
il caso: è il metodo di verifica.** Le prime due correzioni erano tecnicamente
giuste ma parziali, perché in mancanza di un validatore l'unico modo di trovare
i casi era aspettare che l'utente li segnalasse.

Il costo di scrivere il validatore — un'ora — era inferiore a quello di tre
iterazioni fallite, e andava sostenuto al primo indizio: cioè quando ho scoperto
che LibreOffice mostrava un documento che Word rifiutava.

**Regola operativa:** quando l'ambiente di verifica è più permissivo di quello
di destinazione, la verifica non vale. O si ottiene l'ambiente reale, o si
codificano esplicitamente i vincoli che esso applica.

---

## 7. File modificati

| File                                   | Modifica                                               |
| -------------------------------------- | ------------------------------------------------------ |
| `src/export/docx/latex/omml.js`        | Opzione `block` che avvolge in `<m:oMathPara>`         |
| `src/export/docx/html-to-ooxml.js`     | Un paragrafo di sola matematica usa sempre `oMathPara` |
| `tests/helpers/ooxml-validator.js`     | **Nuovo** — validatore strutturale OOXML/OMML          |
| `tests/unit/ooxml-conformance.test.js` | **Nuovo** — 19 test di conformità                      |
