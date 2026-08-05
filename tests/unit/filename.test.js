/**
 * Test della generazione dei nomi file: funzione piccola ma con molti casi
 * limite che in passato hanno prodotto download falliti su Windows.
 */

import { describe, it, expect } from 'vitest';
import { buildFilename } from '../../src/export/filename.js';
import { FILENAME } from '../../src/shared/config.js';

describe('buildFilename', () => {
  it('usa il testo fornito come nome', () => {
    expect(buildFilename('Riassunto della riunione')).toBe('Riassunto della riunione');
  });

  it('rimuove i caratteri vietati dai filesystem', () => {
    expect(buildFilename('a/b\\c:d*e?f"g<h>i|j')).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('normalizza gli spazi e le andate a capo', () => {
    expect(buildFilename('molte    righe\ne\tspazi')).toBe('molte righe e spazi');
  });

  it('tronca i testi lunghi al limite configurato', () => {
    const result = buildFilename('x'.repeat(300));
    expect(result.length).toBeLessThanOrEqual(FILENAME.maxLength);
  });

  it('ricade sul nome predefinito quando il testo è assente o inutilizzabile', () => {
    expect(buildFilename('')).toBe(FILENAME.fallback);
    expect(buildFilename(null)).toBe(FILENAME.fallback);
    expect(buildFilename('///')).toBe(FILENAME.fallback);
  });

  it('non lascia punti finali, non ammessi su Windows', () => {
    expect(buildFilename('nome finale...')).not.toMatch(/\.$/);
  });

  it('aggiunge l\u2019estensione solo quando richiesto', () => {
    expect(buildFilename('report', { withExtension: true })).toBe(`report${FILENAME.extension}`);
    expect(buildFilename('report')).toBe('report');
  });
});
