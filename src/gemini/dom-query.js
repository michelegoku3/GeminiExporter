/**
 * Query DOM con catena di fallback e diagnostica del "selector drift".
 *
 * Ogni ricerca passa da qui: se il selettore preferito fallisce ma un fallback
 * funziona, viene emesso un warning. È il sistema di allerta precoce che ci dice
 * che Gemini sta cambiando HTML mentre l'estensione sta ancora funzionando.
 * @module gemini/dom-query
 */

import { SELECTORS } from './selectors.js';
import { logger as defaultLogger } from '../shared/logger.js';
import { ExportError } from '../shared/errors.js';

/**
 * Risolve un concetto in un singolo elemento.
 * @param {ParentNode} scope Radice della ricerca.
 * @param {string} concept Chiave di SELECTORS.
 * @param {object} [deps]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 * @returns {Element|null}
 */
export function queryFirst(scope, concept, { logger = defaultLogger } = {}) {
  const { candidates } = requireConcept(concept);

  for (let index = 0; index < candidates.length; index += 1) {
    const found = scope.querySelector(candidates[index]);
    if (found) {
      reportDrift(concept, candidates, index, logger);
      return found;
    }
  }
  return null;
}

/**
 * Come queryFirst, ma solleva un errore esplicito se nulla corrisponde.
 * @param {ParentNode} scope
 * @param {string} concept
 * @param {object} [deps]
 * @returns {Element}
 */
export function queryFirstOrThrow(scope, concept, deps = {}) {
  const found = queryFirst(scope, concept, deps);
  if (!found) throw ExportError.selectorNotFound(concept, requireConcept(concept).candidates);
  return found;
}

/**
 * Risolve un concetto in una lista di elementi, usando il primo candidato che
 * produce almeno un risultato.
 * @param {ParentNode} scope
 * @param {string} concept
 * @param {object} [deps]
 * @param {import('../shared/logger.js').Logger} [deps.logger]
 * @returns {Element[]}
 */
export function queryAll(scope, concept, { logger = defaultLogger } = {}) {
  const { candidates } = requireConcept(concept);

  for (let index = 0; index < candidates.length; index += 1) {
    const found = Array.from(scope.querySelectorAll(candidates[index]));
    if (found.length > 0) {
      reportDrift(concept, candidates, index, logger);
      return found;
    }
  }
  return [];
}

/**
 * Testo concatenato di tutti gli elementi che corrispondono a un concetto.
 * Usato per i messaggi utente su più righe.
 * @param {ParentNode} scope
 * @param {string} concept
 * @param {object} [deps]
 * @returns {string}
 */
export function queryTextContent(scope, concept, deps = {}) {
  const elements = queryAll(scope, concept, deps);
  return elements
    .map((element) => element.textContent?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {string} concept
 * @returns {import('./selectors.js').SelectorConcept}
 */
function requireConcept(concept) {
  const entry = SELECTORS[concept];
  if (!entry) throw new TypeError(`Concetto di selettore sconosciuto: "${concept}"`);
  return entry;
}

/**
 * Segnala l'uso di un candidato non primario.
 * @param {string} concept
 * @param {string[]} candidates
 * @param {number} index
 * @param {import('../shared/logger.js').Logger} logger
 */
function reportDrift(concept, candidates, index, logger) {
  if (index === 0) return;
  logger.warn(
    `Selector drift su "${concept}": il selettore primario non corrisponde più, ` +
      `uso il fallback #${index} ("${candidates[index]}"). ` +
      'Aggiorna src/gemini/selectors.js.'
  );
}
