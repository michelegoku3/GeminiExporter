# `chrome.permissions` non esiste nei content script

## Sintomo

```
[Gemini Chat Exporter] Cattura dei grafici non autorizzata.
Apri il popup dell'estensione e attiva «Includi i grafici interattivi».
```

Identico al difetto precedente, e con lo stesso effetto beffardo: il messaggio
chiedeva di concedere un permesso già concesso. Persisteva dopo la
disinstallazione, la reinstallazione e la correzione di
`BUGFIX-PERMESSO-FALSO-NEGATIVO.md`.

## Causa

La verifica veniva invocata dal **content script**:

```js
// src/extension/content/main.js — contesto: content script
canCapture: hasCapturePermission,
```

I content script hanno accesso a un sottoinsieme molto ristretto delle API
dell'estensione — sostanzialmente `runtime`, `storage`, `i18n` e `dom`.
`chrome.permissions` **non è fra queste**.

Il codice non falliva con un errore: `permissionsApi()` trovava `undefined`,
imboccava il ramo difensivo e restituiva `false`. Una risposta plausibile,
sempre sbagliata.

La correzione precedente — passare da `getAll()` invece che da `contains()` —
era corretta in sé, ma inefficace: entrambe le funzioni appartengono a un
oggetto che in quel contesto non esiste.

## Correzione

La verifica si sposta nel service worker, che dispone dell'API, e il content
script la interroga per messaggio:

```
content script  --{ type: 'gex:can-capture' }-->  service worker
                <--------{ granted: true }-------
```

`requestCapturePermissionState()` incapsula lo scambio. Il canale di
messaggistica è iniettato, quindi verificabile senza browser.

## Prevenzione

Un test architetturale impedisce il ripetersi dell'intera classe di errore:

```js
const PRIVILEGED_APIS = ['permissions', 'tabs', 'windows', 'downloads', 'scripting'];

it.each(PRIVILEGED_APIS)('il content script non usa chrome.%s', …);
```

Analizza i sorgenti di `src/extension/content/`, escludendo i commenti — che
citano legittimamente quelle API per spiegare perché **non** si usano.

Questa protezione vale più della singola correzione: il difetto non era
osservabile in esecuzione, perché un'API assente restituisce un valore anziché
sollevare un errore.

## Verifica

`tests/unit/capture-permission.test.js` — 19 test, di cui 5 sulla verifica
dal content script, compreso quello che documenta il fallimento della chiamata
diretta.

Genuinità accertata reintroducendo il difetto in entrambi i punti:

| Difetto reintrodotto                                 | Test che ha reagito                            |
| ---------------------------------------------------- | ---------------------------------------------- |
| `requestCapturePermissionState` chiama l'API diretta | _non interroga direttamente l'API…_            |
| `main.js` usa `chrome.permissions`                   | _il content script non usa chrome.permissions_ |

Suite completa: **402 test**, `npm run check` verde.

## Nota di processo

Quarto difetto consecutivo di questa funzionalità dovuto a un assunto sulla
piattaforma non verificato. I precedenti riguardavano _cosa_ fanno le API; qui
il problema era **dove** possono girare.

Il tratto che accomuna tutti e quattro: un'API assente o un valore normalizzato
non producono un errore, producono una **risposta plausibile e falsa**. Nulla
segnala l'anomalia, e il codice prosegue su una premessa sbagliata.

Le due correzioni precedenti erano ciascuna corretta e ciascuna insufficiente,
perché ho continuato a diagnosticare per deduzione invece di verificare il
vincolo fondamentale — in quale contesto gira il codice — prima di scrivere.

Da qui la scelta di aggiungere un test architetturale anziché la sola
correzione puntuale: è l'unico modo per rendere l'errore impossibile invece
che improbabile.
