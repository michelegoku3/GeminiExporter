# Installazione e sviluppo

## Requisiti

| Strumento                 | Versione | Note                                     |
| ------------------------- | -------- | ---------------------------------------- |
| **Node.js**               | ≥ 20     | Necessario solo per sviluppo e packaging |
| **npm**                   | ≥ 10     | Incluso in Node.js                       |
| **Chrome / Brave / Edge** | ≥ 110    | Manifest V3                              |
| **Firefox**               | ≥ 115    | In alternativa                           |

L'estensione **non ha dipendenze runtime**: quelle installate servono
esclusivamente a test, lint e packaging. Nulla di ciò che si installa finisce
nel pacchetto distribuito.

---

## Installazione rapida

```bash
git clone https://github.com/michelegoku3/GeminiExporter.git
cd GeminiExporter

npm ci              # installa le dipendenze dal lockfile
npm run build:fonts # genera i font KaTeX incorporati
npm run package:chrome
```

Poi in Chrome:

1. apri `chrome://extensions/`
2. attiva **Modalità sviluppatore**
3. **Carica estensione non pacchettizzata** → seleziona `dist/chrome/`

Per Firefox: `npm run package:firefox`, poi
`about:debugging#/runtime/this-firefox` → **Carica componente aggiuntivo
temporaneo** → seleziona `dist/firefox/manifest.json`.

---

## `npm ci` oppure `npm install`?

| Comando       | Quando usarlo                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **`npm ci`**  | Installazione pulita: rispetta esattamente `package-lock.json`. È il comando corretto per ricostruire l'ambiente e per la CI. |
| `npm install` | Solo quando si **aggiunge o aggiorna** una dipendenza: modifica il lockfile.                                                  |

`npm ci` cancella `node_modules` e reinstalla da zero: è più lento la prima
volta, ma garantisce che tutti lavorino sulle stesse versioni.

---

## Perché `npm run build:fonts`

Il comando genera `assets/styles/katex-fonts.css`: i venti font KaTeX
codificati in base64, che vengono incorporati nel documento esportato.

Il file **è versionato**, quindi dopo un `git clone` normalmente non serve
rigenerarlo. Va eseguito soltanto per aggiornare la versione di KaTeX:

```bash
node scripts/build-katex-fonts.js --download   # riscarica i .woff2
```

Senza questi font le formule matematiche perdono parentesi grandi e radici
(vedi [`BUGFIX-KATEX-FONTS.md`](BUGFIX-KATEX-FONTS.md)).

---

## Comandi disponibili

| Comando                   | Effetto                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `npm test`                | Esegue i test (322)                                           |
| `npm run test:watch`      | Test in modalità continua                                     |
| `npm run test:coverage`   | Test con report di copertura                                  |
| `npm run lint`            | Analisi statica con ESLint                                    |
| `npm run lint:fix`        | Correzione automatica dei problemi risolvibili                |
| `npm run format`          | Formattazione con Prettier                                    |
| `npm run format:check`    | Verifica la formattazione senza modificare                    |
| `npm run typecheck`       | Controllo dei tipi tramite JSDoc                              |
| **`npm run check`**       | **Tutti i controlli sopra: da eseguire prima di ogni commit** |
| `npm run audit:security`  | Verifica le vulnerabilità delle dipendenze                    |
| `npm run package:chrome`  | Prepara `dist/chrome/`                                        |
| `npm run package:firefox` | Prepara `dist/firefox/`                                       |
| `npm run package:all`     | Entrambi i pacchetti                                          |
| `npm run build:fonts`     | Rigenera i font KaTeX incorporati                             |

---

## Aggiornare le dipendenze

```bash
npm outdated                 # elenca gli aggiornamenti disponibili
npm update                   # aggiornamenti compatibili (patch e minor)
npm audit                    # verifica le vulnerabilità
npm audit fix                # correzioni non distruttive
```

Per gli aggiornamenti di versione maggiore, indicare il pacchetto
esplicitamente e rieseguire la verifica completa:

```bash
npm install --save-dev vitest@latest
npm run check
```

### Nota sulle vulnerabilità

Tutte le dipendenze sono `devDependencies`: un avviso di `npm audit` riguarda
gli strumenti di sviluppo, **non il codice distribuito agli utenti**. Vanno
comunque risolte — la CI fallisce a livello `moderate` — ma non costituiscono un
rischio per chi installa l'estensione.

---

## Dopo una modifica

```bash
npm run check              # lint + formattazione + tipi + test
npm run package:chrome     # rigenera il pacchetto
```

Poi in `chrome://extensions/` premi **Ricarica** sull'estensione **e** ricarica
la scheda di Gemini: il content script resta altrimenti quello precedente.

---

## Risoluzione dei problemi

| Sintomo                        | Causa probabile           | Rimedio                               |
| ------------------------------ | ------------------------- | ------------------------------------- |
| Formule senza parentesi grandi | `katex-fonts.css` assente | `npm run build:fonts`                 |
| Modifiche non visibili         | Content script in cache   | Ricarica l'estensione **e** la scheda |
| `Cannot find module` nei test  | Dipendenze non allineate  | `rm -rf node_modules && npm ci`       |
| Il pacchetto non si carica     | `dist/` non rigenerata    | `npm run package:chrome`              |
| Errori di tipo in editor       | JSDoc divergente          | `npm run typecheck`                   |
