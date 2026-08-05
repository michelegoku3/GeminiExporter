# Audit di qualità della codebase

**Data:** 25 luglio 2026 · **Versione:** 2.2.0

Revisione completa secondo i criteri di progettazione applicati in produzione.
Ogni problema rilevato è stato corretto e presidiato da un test automatico:
un vincolo enunciato in un documento e non verificato viene violato entro poche
settimane.

---

## Esito complessivo

| Criterio                             | Prima                  | Dopo    |
| ------------------------------------ | ---------------------- | ------- |
| Vulnerabilità nelle dipendenze       | 10 (1 critica, 6 alte) | **0**   |
| Errori di tipo (JSDoc)               | 187                    | **0**   |
| Problemi di lint                     | 12 warning             | **0**   |
| Violazioni di dipendenza fra livelli | 1                      | **0**   |
| Blocchi di codice duplicati          | 3                      | **0**   |
| Moduli oltre 600 righe               | 2                      | **0**   |
| Test                                 | 317                    | **322** |

---

## 1. Sicurezza delle dipendenze

`npm audit` segnalava 10 vulnerabilità, di cui una critica in `vitest` e sei
alte in `eslint` e nella catena di `vite`.

**Analisi:** tutte in `devDependencies`. L'estensione non ha dipendenze
runtime, quindi nessuna di esse raggiungeva l'utente finale — restavano però
un rischio per la macchina di sviluppo e per la pipeline di build.

**Correzione:** aggiornamento a `vitest 4`, `eslint 10`, `jsdom 29`,
`prettier 3.9`, `typescript 7`. Rimosso `playwright`, introdotto per il debug e
mai usato dal codice.

```
found 0 vulnerabilities
```

Presidio: `npm audit --audit-level=moderate` nella CI.

---

## 2. Basso accoppiamento — direzione delle dipendenze

**Problema:** `src/render/asset-loader.js` importava da
`src/extension/platform/browser.js`. Un livello interno dipendeva da uno
esterno, rendendo il renderer inutilizzabile fuori da un'estensione e
impossibile da testare senza simulare le API del browser.

**Correzione:** `resolveUrl` è ora un parametro obbligatorio, fornito dalla
composition root. Il renderer dichiara ciò che gli serve senza sapere chi glielo
fornisce (inversione delle dipendenze).

**Presidio:** `tests/unit/architecture.test.js` percorre tutti gli import e
fallisce se un livello ne importa uno più esterno. Le regole:

```
extension → export → render → core → shared
extension → gemini → core → shared
```

Verificato anche che `core/` non usi API di piattaforma e che solo
`extension/` acceda a `chrome.*`.

---

## 3. DRY — duplicazioni eliminate

| Duplicazione                          | Soluzione                     |
| ------------------------------------- | ----------------------------- |
| `formatTimestamp` in due renderer     | `src/shared/format.js`        |
| Logica di download in due sink        | `src/export/download.js`      |
| Bordi tabella in stile e convertitore | `TABLE_BORDERS_XML` esportata |

Non è una questione estetica: la dichiarazione del font Cambria Math era
duplicata in tre punti e **una copia non aggiornata ha causato una regressione
reale**. Un test verifica ora che esista in un unico punto dell'intero sorgente.

---

## 4. Alta coesione — moduli con una sola responsabilità

Due moduli superavano le 600 righe assolvendo a più compiti:

| Modulo             | Prima | Dopo | Estratto                                    |
| ------------------ | ----- | ---- | ------------------------------------------- |
| `html-to-ooxml.js` | 500   | 412  | `html-nodes.js` — classificazione dei nodi  |
| `latex/omml.js`    | 648   | 551  | `latex/omml-primitives.js` — primitive OMML |

Il criterio non è la lunghezza ma la domanda a cui il modulo risponde:
`html-nodes.js` risponde a «che tipo di nodo è questo?», `omml-primitives.js` a
«come si scrive un frammento che Word accetti». Sono domande che cambiano per
ragioni diverse, quindi appartengono a moduli diversi.

**Presidio:** un test fallisce se un modulo supera le 600 righe o se non
dichiara `@module`.

---

## 5. Correttezza dei tipi

187 errori riportati da `tsc --checkJs`: JSDoc divergente dal codice reale.

**Causa principale:** il typedef `Node` del parser LaTeX dichiarava solo
`type`, mentre il codice accedeva a venti campi diversi. Documentandoli tutti,
gli errori sono scesi a 69. I restanti erano riferimenti a tipi inesistenti
(`import(...).logger` invece di un typedef esportato) e mancati _narrowing_ su
`Result`.

**Correzione:** typedef `Logger` esportato una volta sola, `Preferences`
derivato dai default, `ParagraphPart` e `ConversionContext` espliciti,
asserzioni di tipo dove il narrowing di JSDoc non arriva.

```
errori TypeScript: 0
```

Non è formalismo: `tsc` ha rilevato che `Object.freeze` produce `readonly` e
che due firme dichiaravano parametri diversi da quelli reali.

---

## 6. Complessità e leggibilità

`sanitizeAttributes` aveva complessità 16 con cinque rami annidati — proprio
nel punto in cui un errore costa di più, il filtro di sicurezza. È stata
scomposta in `sanitizeAttribute`, `isAttributeAllowed` e `hasUnsafeValue`:
ogni decisione è ora isolata e verificabile.

`extractMathText` è passata da una catena di `if` a una tabella di strategie
ordinate per affidabilità.

`bootstrap` (70 righe) ha delegato la costruzione dei formati a
`createPipelines`.

**Eccezione documentata:** parser e generatore OMML sono `switch` di dispatch,
un ramo per costrutto LaTeX. La complessità è alta per costruzione ma il codice
resta lineare; spezzarlo renderebbe più difficile seguire la corrispondenza fra
sintassi ed elemento prodotto. L'eccezione è dichiarata in `eslint.config.js`
con la motivazione, non silenziata caso per caso.

---

## 7. Separazione dei compiti — verificata

| Livello      | Responsabilità                        | Non conosce                  |
| ------------ | ------------------------------------- | ---------------------------- |
| `shared/`    | Config, logger, errori, formattazione | tutto il resto               |
| `core/`      | Modello dati e caso d'uso             | piattaforma, Gemini, formati |
| `gemini/`    | DOM di Gemini → modello               | formati di destinazione      |
| `render/`    | Modello → HTML                        | Gemini, browser              |
| `export/`    | Modello → Word, consegna              | Gemini                       |
| `extension/` | Content script, dialogo, popup        | —                            |

`src/gemini/selectors.js` resta l'unico file da modificare quando Google cambia
l'HTML.

---

## 8. Integrazione continua

`.github/workflows/ci.yml` esegue a ogni push: `npm ci`, lint, formattazione,
controllo dei tipi, test, audit di sicurezza e verifica del packaging.

---

## Cosa NON è stato cambiato

- **Nessun framework introdotto**: l'estensione resta a zero dipendenze runtime.
- **Nessuna astrazione aggiunta senza necessità**: niente container di
  dependency injection, niente interfacce con una sola implementazione.
- **Nessuna riscrittura dei moduli funzionanti**: gli interventi hanno
  riguardato solo i punti con un problema dimostrato.

Il criterio è stato: correggere ciò che è misurabilmente sbagliato, e presidiare
con un test ciò che è stato corretto.
