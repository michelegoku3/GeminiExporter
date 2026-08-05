/**
 * Test di contratto sui selettori.
 *
 * Non verificano un comportamento, ma la *coerenza del registry*: sono la rete
 * di sicurezza che impedisce a una modifica affrettata di selectors.js di
 * rompere silenziosamente l'estensione.
 */

import { describe, it, expect } from 'vitest';
import { SELECTORS, SELECTOR_CONCEPTS } from '../../src/gemini/selectors.js';
import { queryFirst, queryAll } from '../../src/gemini/dom-query.js';
import { createLogger } from '../../src/shared/logger.js';
import { conversationTurn, USER_WITH_ATTACHMENTS } from '../fixtures/gemini-dom.js';

const logger = createLogger({ level: 'silent' });

describe('registry dei selettori', () => {
  it('definisce per ogni concetto almeno un candidato e una descrizione', () => {
    for (const concept of SELECTOR_CONCEPTS) {
      const entry = SELECTORS[concept];
      expect(entry.candidates.length, `${concept} senza candidati`).toBeGreaterThan(0);
      expect(entry.description.length, `${concept} senza descrizione`).toBeGreaterThan(0);
    }
  });

  it('contiene solo selettori CSS sintatticamente validi', () => {
    for (const concept of SELECTOR_CONCEPTS) {
      for (const candidate of SELECTORS[concept].candidates) {
        expect(() => document.querySelector(candidate), `${concept}: "${candidate}"`).not.toThrow();
      }
    }
  });

  it('non contiene candidati duplicati nello stesso concetto', () => {
    for (const concept of SELECTOR_CONCEPTS) {
      const { candidates } = SELECTORS[concept];
      expect(new Set(candidates).size, `${concept} ha duplicati`).toBe(candidates.length);
    }
  });

  it('risolve i concetti principali sulla fixture di riferimento', () => {
    document.body.innerHTML = conversationTurn({ userHtml: USER_WITH_ATTACHMENTS });
    const turn = document.querySelector('.conversation-container');

    const required = [
      'conversationTurn',
      'userQuery',
      'modelResponse',
      'responseContent',
      'actionsBar',
      'responseFooter',
    ];

    for (const concept of required) {
      const scope = concept === 'conversationTurn' ? document : turn;
      expect(queryFirst(scope, concept, { logger }), `${concept} non risolto`).not.toBeNull();
    }

    expect(queryAll(turn, 'uploadedFile', { logger })).toHaveLength(2);
  });

  it('solleva un errore su un concetto inesistente, evitando i refusi silenziosi', () => {
    expect(() => queryFirst(document, 'concettoInventato', { logger })).toThrow(/sconosciuto/);
  });
});
