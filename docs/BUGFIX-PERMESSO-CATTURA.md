# «Either the '<all_urls>' or 'activeTab' permission is required»

## Sintomo

```
[Gemini Chat Exporter] Cattura del contenuto interattivo app-1 non riuscita:
Error: Either the '<all_urls>' or 'activeTab' permission is required.
```

Ogni cattura falliva, nonostante il manifest dichiarasse un permesso host sul
dominio effettivamente fotografato.

## L'assunto sbagliato

Nel documentare la funzionalità avevo scritto che `host_permissions` limitato a
`https://gemini.google.com/*` fosse sufficiente, motivandolo con il fatto che
l'estensione fotografa solo Gemini. Era un'inferenza ragionevole, e **falsa**.

La documentazione di `tabs.captureVisibleTab` è letterale:

> _In order to call this method, the extension must have either the `<all_urls>`
> permission or the `activeTab` permission._

Chrome verifica la **presenza del letterale `<all_urls>`**, non la copertura
effettiva dell'origine catturata. Un permesso host circoscritto — pur bastando
a `scripting.executeScript` sullo stesso dominio — viene rifiutato.

L'errore non è stato emerso prima perché l'unica verifica possibile richiedeva
un browser reale: i test simulavano `captureVisibleTab` e quindi non
attraversavano mai il controllo dei permessi.

## Perché non si dichiara `<all_urls>` come obbligatorio

Funzionerebbe, ma il browser mostrerebbe all'installazione:

> _Leggere e modificare i tuoi dati su **tutti i siti web**_

Sproporzionato per un'estensione che opera su un solo dominio, e in contrasto
con il principio del privilegio minimo.

`activeTab` non è un'alternativa praticabile: concede l'accesso solo dopo un
clic sull'**icona dell'estensione**, mentre il flusso normale parte dal pulsante
dentro la conversazione.

## Correzione: permesso opzionale

```json
"permissions": ["storage", "tabs"],
"host_permissions": ["https://gemini.google.com/*"],
"optional_host_permissions": ["<all_urls>"]
```

Un permesso opzionale **non compare all'installazione**. Viene richiesto solo a
chi vuole i grafici, tramite la casella «Includi i grafici interattivi» nel
popup. Chi non la spunta non concede nulla e non vede alcun avviso.

`permissions.request()` esige un gesto dell'utente: il popup è quindi l'unico
punto da cui la richiesta può partire. Il content script può soltanto
verificare con `permissions.contains()`.

### Lo stato riflette il permesso, non una preferenza

La casella legge il permesso reale a ogni apertura del popup, invece di salvare
un valore nelle preferenze. Le due informazioni potrebbero divergere — l'utente
può revocare il permesso dalle impostazioni del browser — e in quel caso una
casella spuntata sarebbe una promessa non mantenibile.

Per lo stesso motivo la casella segue l'**esito** della richiesta: se l'utente
rifiuta, torna deselezionata.

### Verifica preventiva

`captureAll` interroga il permesso **una volta per documento**, prima di
scorrere la cronologia:

```js
if (!(await canCapture())) {
  for (const placeholder of placeholders) markFailed(placeholder);
  return { captured: 0, failed: placeholders.length };
}
```

Senza questo controllo l'estensione scorreva l'intera conversazione — l'unica
parte visibile e fastidiosa dell'operazione — per poi fallire su ogni grafico.

La verifica avviene **dopo** aver contato i segnaposto: le esportazioni prive di
grafici, che sono la maggioranza, non pagano alcun costo.

## Verifica

Tre test in `tests/unit/embedded-apps.test.js`:

- _non tenta la cattura e non scorre la pagina_
- _riduce i segnaposto alla sola didascalia_
- _non interroga il permesso quando non ci sono grafici_

Genuinità accertata reintroducendo il difetto (`if (false)` al posto del
controllo): i primi due falliscono, come atteso.

Il primo tentativo di scriverli aveva prodotto un **falso positivo**: il finto
`document` restituiva `null`, quindi la cattura si fermava comunque prima di
arrivare al punto in esame, e i test passavano anche con il difetto
reintrodotto. Corretto rendendo l'elemento effettivamente trovabile.

Suite completa: **378 test**, `npm run check` verde.

## Lezione

È il secondo difetto di questa funzionalità nato da un assunto sulla
piattaforma affermato senza prova — dopo quello sul contenitore che scorre
(`BUGFIX-CATTURA-SCROLL.md`). In entrambi i casi il codice era coerente con
l'assunto, e i test lo confermavano perché costruiti sulla stessa premessa.

Un doppio di test non può convalidare un'ipotesi sulla piattaforma: la riproduce
soltanto. Le affermazioni sul comportamento delle API vanno verificate sulla
documentazione o su un browser reale — e, quando ciò non è possibile,
dichiarate come ipotesi anziché come fatti.
