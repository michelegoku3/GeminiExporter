# Immagine del grafico vuota: lo spread di un DOMRect

## Sintomo

Il grafico compariva nel documento come **immagine rotta**: il segnaposto
c'era, la didascalia pure, ma l'immagine non si vedeva.

Diverso dai difetti precedenti: la cattura **riusciva**, nessun avviso nella
console, nessun errore. Il documento conteneva un `<img>` con una sorgente
valida — solo che l'immagine era vuota.

## Causa

```js
crop({ …, box: { ...box, top }, … });
```

`box` proviene da `getBoundingClientRect()`, che non restituisce un oggetto
semplice ma un **`DOMRect`**. Le sue proprietà — `width`, `height`, `left`,
`top` — sono **getter definiti sul prototipo**, non proprietà proprie
dell'istanza.

Lo spread copia soltanto le proprietà enumerabili proprie. Su un `DOMRect` non
ce n'è nessuna:

```
rect.width       = 600
Object.keys(rect) = []
{ ...rect, top: 120 } = { top: 120 }      ← width e left perduti
```

Il seguito è meccanico:

```js
canvas.width = Math.round(undefined * 2); // NaN
canvas.toDataURL('image/png'); // PNG vuoto, nessun errore
```

Nessun anello della catena segnala l'anomalia. `NaN` assegnato a `canvas.width`
viene silenziosamente convertito in 0, e un canvas di larghezza zero produce un
data URI perfettamente valido che codifica un'immagine vuota.

## Correzione

Le proprietà si leggono una a una:

```js
box: { top, left: box.left, width: box.width },
```

## Difesa strutturale

Correggere la singola riga non basta: la stessa svista può ripresentarsi ovunque
si manipoli un rettangolo. `crop` ora rifiuta le misure inutilizzabili:

```js
if (!isUsableSize(width) || !isUsableSize(targetHeight)) {
  throw new Error(`Dimensioni di ritaglio non valide: … box.width=${box.width} …`);
}
```

Il messaggio riporta i valori ricevuti. Un'eccezione qui viene intercettata da
`capture()`, che la registra e ricade sul segnaposto: l'utente vede un riquadro
con la didascalia — sgradevole ma comprensibile — invece di un'immagine rotta,
e la console dice esattamente quale misura mancava.

## Perché i test non l'avevano colto

Il doppio di test costruiva il rettangolo come oggetto semplice:

```js
element.getBoundingClientRect = () => ({ top: 100, left: 50, width: 600, … });
```

Su un oggetto semplice lo spread funziona: le proprietà sono proprie ed
enumerabili. Il doppio non riproduceva la caratteristica del tipo reale da cui
dipendeva il difetto.

Ora restituisce un `DOMRect` vero:

```js
element.getBoundingClientRect = () => new window.DOMRect(50, 100, 600, 400);
```

Con questa sola modifica, reintrodurre lo spread fa fallire **3 test**.

## Verifica

`tests/unit/canvas-ops.test.js` — 8 test, fra cui il ritaglio a partire da un
`DOMRect` autentico e il rifiuto delle misure non valide.

Genuinità accertata reintroducendo entrambi i difetti:

| Difetto reintrodotto             | Test che hanno reagito            |
| -------------------------------- | --------------------------------- |
| `{ ...box, top }`                | 3 test in `embedded-apps.test.js` |
| Rimossa la validazione in `crop` | 3 test in `canvas-ops.test.js`    |

Suite completa: **410 test**, `npm run check` verde.

## Nota di processo

Quinto difetto della funzionalità, e il primo che non riguarda un'API di
piattaforma ma un tipo del DOM. Il tratto in comune con gli altri quattro resta
però identico: **nessun errore, una risposta plausibile e falsa**.

Qui la lezione è più specifica e vale la pena isolarla: un doppio di test deve
riprodurre le **caratteristiche del tipo** da cui dipende il codice, non solo la
forma dei dati. Un oggetto letterale con gli stessi campi di un `DOMRect` non è
un `DOMRect`: si comporta diversamente proprio nell'operazione — la copia — in
cui il difetto si annidava.

Quando il codice riceve un oggetto costruito dalla piattaforma, il test deve
costruirlo con lo stesso costruttore.
