/**
 * Vincoli architetturali verificati automaticamente.
 *
 * Le regole di dipendenza fra livelli sono facili da enunciare in un documento
 * e altrettanto facili da violare per distrazione: basta un `import` aggiunto
 * mentre si corregge altro. Questi test le rendono eseguibili, così una
 * violazione fallisce subito invece di essere scoperta mesi dopo.
 *
 * La regola generale è che le dipendenze puntino **verso l'interno**:
 *
 *   extension → export → render → core → shared
 *   extension → gemini → core → shared
 *
 * `core/` non conosce nessuno; `shared/` non conosce nessuno.
 */

import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';

/** Livelli architetturali, dal più esterno al più interno. */
const LAYERS = ['extension', 'export', 'render', 'gemini', 'core', 'shared'];

/**
 * Livelli che ciascun livello NON può importare.
 * Assenza di una voce significa "nessun vincolo".
 */
const FORBIDDEN_DEPENDENCIES = {
  // Il dominio non conosce piattaforma, sorgente dati né formati di output.
  core: ['gemini', 'render', 'extension'],
  // I renderer non sanno da dove provengono i dati né su quale browser girano.
  render: ['gemini', 'extension'],
  // L'adattatore Gemini non conosce i formati di destinazione.
  gemini: ['render', 'export', 'extension'],
  // Le utility trasversali non dipendono da nulla.
  shared: ['core', 'gemini', 'render', 'export', 'extension'],
};

/**
 * @param {string} filePath
 * @returns {string} Livello di appartenenza.
 */
function layerOf(filePath) {
  const found = LAYERS.find((layer) => filePath.includes(`/${layer}/`));
  return found ?? 'root';
}

/**
 * Elenca ricorsivamente i moduli JavaScript di una cartella.
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listModules(path);
      return entry.name.endsWith('.js') ? [path] : [];
    })
  );

  return nested.flat();
}

/**
 * Estrae gli import relativi di un modulo, risolti in percorsi di progetto.
 * @param {string} filePath
 * @returns {Promise<string[]>}
 */
async function importedPaths(filePath) {
  const source = await readFile(filePath, 'utf-8');
  const matches = [...source.matchAll(/from\s+'(\.[^']+)'/g)];

  return matches.map((match) => normalize(join(dirname(filePath), match[1])));
}

describe('dipendenze fra livelli', () => {
  it('nessun livello importa da un livello più esterno', async () => {
    const modules = await listModules('src');
    const violations = [];

    for (const modulePath of modules) {
      const layer = layerOf(modulePath);
      const forbidden = FORBIDDEN_DEPENDENCIES[layer] ?? [];

      for (const target of await importedPaths(modulePath)) {
        const targetLayer = layerOf(target);
        if (forbidden.includes(targetLayer)) {
          violations.push(`${modulePath} (${layer}) importa da ${targetLayer}: ${target}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('il dominio non usa API di piattaforma', async () => {
    // core/ deve poter girare in Node, in un service worker o in un test
    // senza alcun adattamento.
    const modules = await listModules('src/core');
    const violations = [];

    for (const modulePath of modules) {
      const source = await readFile(modulePath, 'utf-8');
      const forbidden = /\b(document|window|chrome|browser|localStorage|fetch)\s*\./.exec(source);
      if (forbidden) violations.push(`${modulePath}: usa ${forbidden[1]}`);
    }

    expect(violations).toEqual([]);
  });

  it('solo il livello extension accede alle API del browser', async () => {
    const modules = await listModules('src');
    const violations = [];

    for (const modulePath of modules) {
      if (modulePath.includes('/extension/')) continue;

      const source = await readFile(modulePath, 'utf-8');
      // `globalThis.chrome` compare solo nel wrapper di piattaforma.
      if (/\bchrome\.runtime\b|\bbrowser\.runtime\b/.test(source)) {
        violations.push(modulePath);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('dimensione e coesione dei moduli', () => {
  it('nessun modulo supera le 600 righe', async () => {
    // Soglia d'allarme, non dogma: un file più lungo di così di solito
    // sta assolvendo a più di una responsabilità.
    const modules = await listModules('src');
    const oversized = [];

    for (const modulePath of modules) {
      const lines = (await readFile(modulePath, 'utf-8')).split('\n').length;
      if (lines > 600) oversized.push(`${modulePath}: ${lines} righe`);
    }

    expect(oversized).toEqual([]);
  });

  it('ogni modulo dichiara il proprio scopo', async () => {
    // Un modulo senza @module è un modulo di cui nessuno ha definito il
    // confine: è da lì che nascono le responsabilità miste.
    const modules = await listModules('src');
    const undocumented = [];

    for (const modulePath of modules) {
      const source = await readFile(modulePath, 'utf-8');
      const isEntryPoint = modulePath.endsWith('loader.js');
      if (!isEntryPoint && !source.includes('@module')) undocumented.push(modulePath);
    }

    expect(undocumented).toEqual([]);
  });
});

/**
 * Rimuove commenti di blocco e di riga.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('API riservate ai contesti privilegiati', () => {
  /**
   * I content script hanno accesso a un sottoinsieme ristretto delle API
   * dell'estensione: `chrome.storage`, `chrome.runtime` e poco altro. Tutte le
   * altre sono `undefined`, e il codice che le invoca non fallisce con un
   * errore — ottiene semplicemente un risultato falso, che è molto peggio.
   *
   * È accaduto con `chrome.permissions`: la verifica restituiva sempre "non
   * concesso" e l'utente riceveva l'invito a concedere un permesso che aveva
   * già dato. Vedi docs/BUGFIX-PERMESSO-CONTENT-SCRIPT.md.
   */
  const PRIVILEGED_APIS = ['permissions', 'tabs', 'windows', 'downloads', 'scripting'];

  /** File caricati nel contesto del content script. */
  const CONTENT_SCRIPT_DIR = 'src/extension/content';

  it.each(PRIVILEGED_APIS)('il content script non usa chrome.%s', async (apiName) => {
    const files = await listModules(CONTENT_SCRIPT_DIR);

    for (const file of files) {
      // I commenti citano legittimamente le API per spiegare perché NON si
      // usano: verificare il sorgente grezzo darebbe un falso positivo.
      const source = stripComments(await readFile(file, 'utf-8'));
      const usage = new RegExp(`(chrome|browser)\\.${apiName}\\b`);
      expect(usage.test(source), `${file} usa un'API non disponibile nei content script`).toBe(
        false
      );
    }
  });
});
