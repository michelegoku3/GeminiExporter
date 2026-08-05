# Modalità di selezione senza via d'uscita

## Sintomo

Attivata la modalità di selezione, il pulsante 📄 smetteva di rispondere.
L'utente poteva soltanto selezionare e deselezionare messaggi, senza mai
raggiungere l'esportazione: un vicolo cieco.

## Causa

Il gestore dei clic era registrato sul documento in fase di cattura e annullava
ogni evento originato dentro un turno:

```js
const turn = turnFrom(event.target);
if (!turn) return;

event.preventDefault();
event.stopPropagation();
toggle(turn);
```

Il presupposto — «tutto ciò che sta dentro un turno è contenuto da
selezionare» — trascurava un fatto della nostra stessa architettura: **il
pulsante di esportazione è iniettato dentro il turno**, nella barra azioni di
Gemini. Rientrava quindi nella condizione, e il clic che avrebbe dovuto
concludere la selezione veniva interpretato come un clic di selezione.

Il comando che chiude la modalità era, letteralmente, l'unico che la modalità
impediva di usare.

## Correzione

I controlli dell'estensione sono esclusi dall'intercettazione:

```js
if (isOwnControl(event.target)) return;
```

`isOwnControl` risale con `closest()` fino a un contenitore dell'estensione —
pulsante, dialogo o toast — riconosciuto tramite le classi già dichiarate in
`UI_CLASS`. Il controllo è sul contenitore e non sull'elemento preciso perché il
bersaglio reale di un clic è spesso l'icona SVG interna, non il `<button>`.

L'eccezione è deliberatamente ristretta ai nostri elementi: tutto il resto del
turno resta selezionabile come prima.

## Verifica

Tre test in `tests/unit/turn-selection.test.js`, con il pulsante presente nel
DOM di prova come accade in produzione:

- _lascia cliccabile il pulsante di esportazione_
- _lascia cliccabile anche l'icona dentro il pulsante_
- _continua a selezionare il resto del turno_

Genuinità accertata rimuovendo la guardia: i primi due falliscono.

Suite completa: **446 test**, `npm run check` verde.

## Nota di processo

Il difetto era prevedibile leggendo il codice: `button-injector.js` inserisce il
pulsante dentro la barra azioni, che sta dentro il turno. L'informazione era già
nel progetto, e non l'ho collegata mentre scrivevo il gestore dei clic.

La lezione non riguarda le API del browser — come nei difetti precedenti — ma la
**coesistenza fra i propri componenti**: un intercettore globale di eventi deve
sempre dichiarare un'eccezione per l'interfaccia di chi lo ha installato,
altrimenti disabilita anche i propri comandi.

Chiedersi «quali elementi della _mia_ estensione ricadono in questa condizione»
è la verifica che mancava, e vale per ogni gestore registrato in fase di cattura
sul documento.
