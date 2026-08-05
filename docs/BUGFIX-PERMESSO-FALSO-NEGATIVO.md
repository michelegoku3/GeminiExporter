# Permesso concesso, ma l'estensione dice di no

## Sintomo

```
[Gemini Chat Exporter] Cattura dei grafici non autorizzata:
concedi il permesso dal popup dell'estensione.
```

Il messaggio compariva **anche dopo** aver concesso il permesso, e resisteva
alla disinstallazione e reinstallazione dell'estensione.

## Causa

La verifica confrontava il letterale `<all_urls>`:

```js
await permissions.contains({ origins: ['<all_urls>'] }); // → false
```

Chrome **non conserva quella stringa**. Al momento della concessione la
normalizza in pattern equivalenti — la forma universale `*` per schema, host e
percorso, oppure la coppia dedicata a http e https. Il Chrome Web Store applica
la stessa riscrittura al manifest pubblicato.

Il permesso c'era davvero. Era il confronto a non riconoscerlo.

Il difetto è particolarmente insidioso perché il rimedio suggerito dal messaggio
— concedere il permesso — è proprio l'azione che l'utente aveva già compiuto, e
ripeterla non cambia nulla.

## Correzione

Si ispeziona l'elenco dei permessi realmente concessi, accettando ogni forma con
cui il browser può rappresentare un permesso universale:

```js
const granted = await permissions.getAll();
return (granted?.origins ?? []).some((origin) => UNIVERSAL_PATTERNS.has(origin));
```

`UNIVERSAL_PATTERNS` raccoglie tutte le varianti osservate. `getAll()` riporta lo
stato effettivo, senza dipendere da come il pattern è stato scritto in origine.

Due correzioni derivate, per lo stesso motivo:

- **La richiesta non si fida del proprio valore di ritorno.** `request()` lo
  riporta in modo inaffidabile in alcune versioni: si rilegge lo stato reale.
- **La revoca rimuove tutte le forme equivalenti.** Rimuoverne una sola
  lascerebbe attiva quella effettivamente registrata.

## Verifica

`tests/unit/capture-permission.test.js` — 14 test, fra cui il riconoscimento del
permesso in **ognuna** delle forme osservate.

Genuinità accertata reintroducendo il difetto (`contains()` sul letterale):
**7 test falliscono**, compreso quello esplicitamente intitolato _non usa
contains(), che darebbe un falso negativo_.

Suite completa: **392 test**, `npm run check` verde.

## Nota di processo

Terzo difetto consecutivo di questa funzionalità originato da un assunto sulla
piattaforma non verificato, dopo il contenitore che scorre
(`BUGFIX-CATTURA-SCROLL.md`) e il permesso richiesto
(`BUGFIX-PERMESSO-CATTURA.md`).

Il tratto comune: le API delle estensioni **trasformano** i valori che ricevono
— normalizzano pattern, espandono abbreviazioni, riscrivono manifest — e il
valore restituito da una lettura non coincide con quello passato in scrittura.

Regola che ne discende: non confrontare mai un valore restituito da un'API di
piattaforma con la costante che si è usata per impostarlo. Interrogare lo stato
effettivo e accettare tutte le forme equivalenti.

Un difetto di questo tipo non è osservabile con test a doppio, perché il doppio
restituisce ciò che lo sviluppatore si aspetta. Qui i test lo colgono solo
perché il doppio è stato costruito **dopo** aver appreso la forma reale del
dato, e la riproduce.
