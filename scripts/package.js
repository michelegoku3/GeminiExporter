#!/usr/bin/env node
/**
 * Prepara la cartella distribuibile per un browser specifico.
 *
 * Uso: node scripts/package.js chrome|firefox
 *
 * Non esiste un bundler: l'estensione è composta da moduli ES caricati
 * direttamente dal browser. Questo script si limita a copiare i file necessari
 * e a selezionare il manifest corretto.
 */

import { cp, mkdir, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

const TARGETS = { chrome: 'manifest.json', firefox: 'manifest.firefox.json' };

/** Cartelle e file inclusi nel pacchetto. */
const INCLUDED = ['src', 'assets', 'icons'];

async function main() {
  const target = process.argv[2];
  const manifest = TARGETS[target];

  if (!manifest) {
    console.error(`Target non valido. Usa uno fra: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  const outputDir = join('dist', target);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const entry of INCLUDED) {
    await cp(entry, join(outputDir, entry), { recursive: true });
  }
  // Il manifest assume sempre il nome canonico nella cartella di destinazione.
  await copyFile(manifest, join(outputDir, 'manifest.json'));

  console.log(`Pacchetto pronto in ${outputDir}`);
  console.log(`Caricalo come estensione non pacchettizzata da quella cartella.`);
}

main().catch((error) => {
  console.error('Packaging fallito:', error);
  process.exit(1);
});
