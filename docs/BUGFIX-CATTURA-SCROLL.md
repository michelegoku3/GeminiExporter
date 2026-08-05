# Cattura dei grafici sempre fallita: il contenitore sbagliato

## Sintomo

Ogni grafico interattivo produceva il segnaposto di ripiego:

> _Contenuto interattivo non catturato_

La cattura non falliva a volte: falliva **sempre**.

## Causa

`app-capture.js` scorreva la pagina con `window.scrollTo` per portare il
grafico nell'area visibile prima di fotografarlo. L'assunto era che fosse la
finestra a scorrere.

Il CSS di Gemini dice il contrario:

```css
[_nghost-ng-c1388204559] {
  overflow: hidden scroll; /* <infinite-scroller> */
}
```

La cronologia vive dentro un `<infinite-scroller>` che possiede **lui** la barra
di scorrimento. La finestra non scorre affatto: `window.scrollTo` non ha alcun
effetto sul contenuto, e `window.scrollY` resta a zero.

Conseguenza a catena:

1. lo scorrimento non avviene;
2. il grafico resta fuori dall'area visibile;
3. l'altezza dell'intersezione con il viewport risulta ≤ 0;
4. `captureSlice` restituisce `null` per ogni fascia;
5. `captureElement` non ha nulla da restituire → segnaposto.

Il difetto non era emerso nei test perché il finto ambiente simulava una
finestra scorrevole — cioè proprio l'assunto sbagliato.

## Correzione

Nuovo modulo `gemini/scroll-container.js`: risale gli antenati fino a trovare
l'elemento che scorre davvero, e lo espone come `Scroller`.

```js
const scroller = findScroller(element, win);
scroller.scrollTo(target - CAPTURE.topMarginPx);
```

Un elemento è considerato scorrevole se dichiara `overflow-y` fra `auto`,
`scroll` o `overlay` **e** se il contenuto eccede davvero l'altezza disponibile:
la sola dichiarazione CSS non basta, perché `overflow: auto` su un contenitore
che sta tutto dentro non produce scorrimento.

Se nessun antenato scorre, si ricade sulla finestra: il comportamento
precedente resta valido dove era corretto.

Corretta anche l'aritmetica delle coordinate. Lo scorrimento di un contenitore
è relativo a sé stesso, non al viewport:

```js
const offsetInView = element.getBoundingClientRect().top - view.top;
const target = scroller.position() + offsetInView + index * view.height;
```

E l'area utile è ora l'**intersezione** fra il rettangolo dell'elemento e la
parte visibile del contenitore: fotografare oltre avrebbe incluso ciò che sta
sotto la barra di composizione.

## Seconda causa: il limite di frequenza

`tabs.captureVisibleTab` è limitato da Chrome a
`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` (2) e **rigetta** le chiamate
eccedenti invece di accodarle. Con più grafici, o con uno solo catturato a
fasce, il limite viene superato con facilità.

Il service worker ora ritenta fino a tre volte con attesa crescente
(600 ms, 1200 ms). Senza ritentativo la seconda cattura falliva
sistematicamente, anche a scorrimento corretto.

## Diagnostica

Il segnaposto era identico per cause molto diverse: elemento fuori schermo,
permesso negato, limite di frequenza. Ora ogni ramo registra il proprio motivo,
compreso il caso «nessuna porzione visibile», con le misure che lo dimostrano.

## Verifica

Quattro test in `tests/unit/embedded-apps.test.js` riproducono la struttura
reale di Gemini (contenitore interno scorrevole, finestra ferma).

Genuinità accertata reintroducendo il difetto:

| Difetto reintrodotto              | Test che ha reagito                             |
| --------------------------------- | ----------------------------------------------- |
| Si assume che scorra la finestra  | _trova il contenitore interno…_ (+1)            |
| Rimosso il controllo di eccedenza | _ignora i contenitori che dichiarano overflow…_ |

Suite completa: **375 test**, `npm run check` verde.

## Lezione

Il difetto è nato da un assunto mai verificato — «la pagina scorre con la
finestra» — che i test hanno confermato invece di mettere in discussione, perché
il finto ambiente era stato costruito sullo stesso assunto.

Quando si simula una piattaforma, il doppio va modellato sul comportamento
**osservato**, non su quello immaginato: altrimenti i test dimostrano solo la
coerenza interna dell'errore.
