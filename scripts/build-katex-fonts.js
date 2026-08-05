#!/usr/bin/env node
/**
 * Genera `assets/styles/katex-fonts.css` incorporando i font KaTeX come data URI.
 *
 * Perché è necessario
 * -------------------
 * Il documento esportato vive in una pagina `blob:` che non può accedere alle
 * risorse `chrome-extension://`, e deve funzionare anche offline e dopo essere
 * stato salvato su disco. Un `url()` relativo o remoto non verrebbe risolto: i
 * font non caricherebbero e i glifi delle parentesi grandi e delle radici
 * diventerebbero rettangoli vuoti (vedi docs/BUGFIX-KATEX-FONTS.md).
 *
 * Incorporandoli in base64 il documento resta autosufficiente.
 *
 * Uso: node scripts/build-katex-fonts.js
 *      node scripts/build-katex-fonts.js --download   (riscarica i .woff2)
 */

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const FONTS_DIR = 'assets/fonts';
const OUTPUT_FILE = 'assets/styles/katex-fonts.css';
const KATEX_VERSION = '0.16.9';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/fonts`;

/**
 * I 20 file necessari alla resa completa.
 * I quattro `Size*` contengono i delimitatori estensibili (parentesi graffe,
 * tonde e quadre grandi) e i segni di radice: sono i più piccoli e i più
 * facili da dimenticare, ma senza di essi le formule complesse si rompono.
 */
const FONT_FILES = [
  'KaTeX_AMS-Regular',
  'KaTeX_Caligraphic-Bold',
  'KaTeX_Caligraphic-Regular',
  'KaTeX_Fraktur-Bold',
  'KaTeX_Fraktur-Regular',
  'KaTeX_Main-Bold',
  'KaTeX_Main-BoldItalic',
  'KaTeX_Main-Italic',
  'KaTeX_Main-Regular',
  'KaTeX_Math-BoldItalic',
  'KaTeX_Math-Italic',
  'KaTeX_SansSerif-Bold',
  'KaTeX_SansSerif-Italic',
  'KaTeX_SansSerif-Regular',
  'KaTeX_Script-Regular',
  'KaTeX_Size1-Regular',
  'KaTeX_Size2-Regular',
  'KaTeX_Size3-Regular',
  'KaTeX_Size4-Regular',
  'KaTeX_Typewriter-Regular',
].map((name) => `${name}.woff2`);

/**
 * Deriva la dichiarazione `@font-face` dal nome del file.
 * @param {string} filename Es. "KaTeX_Main-BoldItalic.woff2"
 * @returns {{ family: string, weight: string, style: string }}
 */
function describeFont(filename) {
  const [family, variant] = filename.replace('.woff2', '').split('-');
  return {
    family,
    weight: variant.includes('Bold') ? '700' : '400',
    style: variant.includes('Italic') ? 'italic' : 'normal',
  };
}

/** Scarica i font mancanti dal CDN. */
async function downloadFonts() {
  await mkdir(FONTS_DIR, { recursive: true });

  await Promise.all(
    FONT_FILES.map(async (filename) => {
      const response = await fetch(`${CDN_BASE}/${filename}`);
      if (!response.ok) throw new Error(`Download fallito: ${filename} (${response.status})`);

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(join(FONTS_DIR, filename), buffer);
      console.log(`  scaricato ${filename} (${buffer.length} byte)`);
    })
  );
}

async function main() {
  if (process.argv.includes('--download')) {
    console.log('Scarico i font da jsDelivr…');
    await downloadFonts();
  }

  const available = new Set(await readdir(FONTS_DIR));
  const missing = FONT_FILES.filter((file) => !available.has(file));
  if (missing.length > 0) {
    console.error(`Font mancanti: ${missing.join(', ')}`);
    console.error('Esegui: node scripts/build-katex-fonts.js --download');
    process.exit(1);
  }

  const declarations = [];
  let totalBytes = 0;

  for (const filename of FONT_FILES) {
    const buffer = await readFile(join(FONTS_DIR, filename));
    totalBytes += buffer.length;

    const { family, weight, style } = describeFont(filename);
    declarations.push(
      `@font-face{font-family:${family};font-style:${style};font-weight:${weight};` +
        `font-display:block;` +
        `src:url(data:font/woff2;base64,${buffer.toString('base64')}) format("woff2")}`
    );
  }

  const header = `/* Font KaTeX incorporati come data URI — FILE GENERATO, non modificare a mano.
   Rigenera con: npm run build:fonts
   Sorgente: katex@${KATEX_VERSION} · ${FONT_FILES.length} font · ${Math.round(totalBytes / 1024)} KB originali

   I font sono incorporati perché il documento esportato è una pagina blob:
   autosufficiente, che deve funzionare offline e una volta salvata su disco.
   La proprietà font-display:block evita che la stampa parta con i glifi
   ancora assenti. */\n\n`;

  await writeFile(OUTPUT_FILE, header + declarations.join('\n') + '\n');

  const outputSize = (await readFile(OUTPUT_FILE)).length;
  console.log(`\n${OUTPUT_FILE} generato`);
  console.log(`  ${FONT_FILES.length} font · ${Math.round(outputSize / 1024)} KB (base64)`);
}

main().catch((error) => {
  console.error('Generazione fallita:', error);
  process.exit(1);
});
