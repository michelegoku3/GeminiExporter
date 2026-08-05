# Immagine assente in Word, presente nel pacchetto

## Sintomo

Nel PDF il grafico appariva correttamente. Nel `.docx` restava la sola
didascalia, senza nemmeno lo spazio dell'immagine. Il resto del documento —
testo e formule — era intatto.

## Cosa NON era

L'analisi del `.docx` reale prodotto dall'estensione ha escluso, con prove,
ogni ipotesi strutturale:

| Verifica                            | Esito                                   |
| ----------------------------------- | --------------------------------------- |
| Presenza di `word/media/image1.png` | ✅ presente, 365 538 byte               |
| Validità del PNG                    | ✅ 708×616 RGBA, IHDR e IEND corretti   |
| `<w:drawing>` nel documento         | ✅ 1, ben formato                       |
| Relazione verso l'immagine          | ✅ presente                             |
| `<Default Extension="png">`         | ✅ presente                             |
| Namespace `r`, `wp`, `a`, `pic`     | ✅ tutti dichiarati                     |
| CRC e lunghezze di ogni voce ZIP    | ✅ tutti corretti                       |
| Offset della central directory      | ✅ tutti puntano al local header giusto |
| Resa in LibreOffice                 | ✅ immagine visibile                    |

Il file era **valido**. Word lo scartava comunque.

## Causa

Due deviazioni dalle convenzioni che Word applica ai propri file. Nessuna delle
due viola la specifica — ed è precisamente questo il motivo per cui nessun
controllo di validità le rilevava.

### 1. Identificatore di relazione fuori convenzione

```xml
<Relationship Id="rIdImg1" Type=".../image" Target="media/image1.png"/>
<a:blip r:embed="rIdImg1"/>
```

ECMA-376 ammette qualunque stringa come `Id`. Word però emette sempre la forma
`rId<numero>` e, nel risolvere `r:embed`, ignora gli identificatori che non la
rispettano: scarta il disegno senza segnalare nulla. LibreOffice li risolve, e
per questo la conversione di controllo mostrava l'immagine.

Gli identificatori proseguono ora la numerazione delle relazioni fisse
(`rId1`…`rId4`), partendo da `rId5`.

### 2. Parti binarie in coda all'archivio

`word/media/image1.png` era l'**ultima** voce, dopo `docProps`. Word raggruppa
tutto ciò che sta sotto `word/` prima delle proprietà del documento; le
implementazioni tolleranti leggono l'archivio per nome, Word si appoggia
all'ordine.

## Perché nessun test l'aveva colto

Tutti i test verificavano che l'immagine **ci fosse**: parte presente, relazione
presente, `<w:drawing>` generato. Nessuno verificava che fosse dichiarata _nella
forma che Word accetta_.

È la stessa lacuna dei difetti precedenti, in una veste nuova: il pacchetto era
conforme alla specifica, ma la specifica è più permissiva dell'implementazione.

## Verifica

Tre test in `tests/unit/embedded-apps.test.js`:

- _numera le relazioni delle immagini nella forma `rId<numero>`_
- _non riusa gli identificatori delle relazioni fisse_
- _colloca le parti binarie prima di `docProps`_

Genuinità accertata reintroducendo entrambi i difetti:

| Difetto reintrodotto | Test che hanno reagito |
| -------------------- | ---------------------- |
| `rIdImg<n>`          | 2                      |
| Immagini in coda     | 1                      |

Verifica end-to-end con il **PNG reale estratto dal file dell'utente**
(708×616 RGBA, 365 KB): pacchetto rigenerato, `rId5` conforme, immagine prima di
`docProps`, byte identici all'originale, resa corretta.

Suite completa: **413 test**, `npm run check` verde.

## Nota di processo

Sesto difetto della funzionalità. Il precedente riguardava un tipo del DOM,
questo un formato di file, ma la forma è ancora quella: **nessun errore, un
risultato plausibile e sbagliato**.

La differenza rispetto ai cinque precedenti sta nel metodo. Qui non ho dedotto:
ho chiesto il file che non funzionava e l'ho smontato campo per campo — header
ZIP, CRC, offset, IHDR del PNG, namespace XML — finché non è rimasta che una
sola anomalia. Le prime ipotesi (decodifica base64 corrotta, ZIP malformato,
immagine troppo grande) erano tutte plausibili e tutte false; escluderle con
misure invece che con ragionamenti è ciò che ha portato alla causa vera.

Regola che ne discende, complementare a quella già annotata sulle API: quando un
artefatto è formalmente valido ma un'implementazione lo rifiuta, la causa sta
nello scarto fra **ciò che la specifica permette** e **ciò che
l'implementazione di riferimento produce**. Conviene confrontare il proprio
output con quello generato dallo strumento ufficiale, campo per campo.
