/**
 * Operazioni su canvas per la cattura visiva.
 *
 * Sono funzioni pure di manipolazione di immagini: ritagliare, impilare,
 * ridimensionare. Vivono fuori dal catturatore perché non hanno nulla a che
 * vedere con il DOM di Gemini né con le API dell'estensione — sono aritmetica
 * di rettangoli — e separarle mantiene il catturatore leggibile.
 *
 * Il documento su cui creare i canvas è un parametro: nei test è un finto
 * oggetto, perché jsdom non implementa il contesto di disegno.
 * @module gemini/canvas-ops
 */

/**
 * Ritaglia da uno screenshot l'area occupata da un elemento.
 *
 * Le coordinate del DOM sono in pixel CSS, lo screenshot è in pixel fisici: la
 * conversione passa da `devicePixelRatio`. Ignorarla produce ritagli sfalsati
 * su ogni schermo ad alta densità.
 *
 * @param {object} params
 * @param {Document} params.document
 * @param {CanvasImageSource} params.screenshot
 * @param {{ top: number, left: number, width: number }} params.box Rettangolo
 *   dell'elemento, in coordinate del viewport.
 * @param {number} params.height Altezza effettivamente visibile.
 * @param {number} params.ratio Pixel fisici per pixel CSS.
 * @returns {HTMLCanvasElement}
 */
export function crop({ document: doc, screenshot, box, height, ratio }) {
  const width = Math.round(box.width * ratio);
  const targetHeight = Math.round(height * ratio);

  // Un canvas di dimensione nulla o non numerica produce un PNG vuoto senza
  // sollevare alcun errore: il difetto si manifesterebbe solo a documento
  // aperto, come un'immagine rotta. Meglio fallire qui, dove la causa è
  // ancora visibile. Vedi docs/BUGFIX-CATTURA-DOMRECT.md.
  if (!isUsableSize(width) || !isUsableSize(targetHeight)) {
    throw new Error(
      `Dimensioni di ritaglio non valide: ${width}×${targetHeight} ` +
        `(box.width=${box.width}, box.left=${box.left}, height=${height}, ratio=${ratio}).`
    );
  }

  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = targetHeight;

  canvas
    .getContext('2d')
    .drawImage(
      screenshot,
      Math.round(box.left * ratio),
      Math.round(Math.max(0, box.top) * ratio),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height
    );

  return canvas;
}

/**
 * @param {number} value
 * @returns {boolean} true se il valore è una misura in pixel utilizzabile.
 */
function isUsableSize(value) {
  return Number.isFinite(value) && value > 0;
}

/**
 * Impila verticalmente più catture.
 *
 * Serve ai contenuti più alti del viewport, fotografati in più passaggi.
 *
 * @param {Document} doc
 * @param {HTMLCanvasElement[]} shots
 * @returns {HTMLCanvasElement}
 */
export function stack(doc, shots) {
  if (shots.length === 1) return shots[0];

  const canvas = doc.createElement('canvas');
  canvas.width = Math.max(...shots.map((shot) => shot.width));
  canvas.height = shots.reduce((total, shot) => total + shot.height, 0);

  const context = canvas.getContext('2d');
  let offset = 0;
  for (const shot of shots) {
    context.drawImage(shot, 0, offset);
    offset += shot.height;
  }

  return canvas;
}

/**
 * Riduce la larghezza di un canvas mantenendo le proporzioni.
 *
 * Una cattura a piena risoluzione su schermo ad alta densità supera facilmente
 * i 2500 px: incorporarla tale e quale gonfierebbe il documento senza aggiungere
 * dettaglio utile alla lettura.
 *
 * @param {Document} doc
 * @param {HTMLCanvasElement} canvas
 * @param {number} maxWidth
 * @returns {HTMLCanvasElement}
 */
export function limitWidth(doc, canvas, maxWidth) {
  if (canvas.width <= maxWidth) return canvas;

  const scale = maxWidth / canvas.width;
  const resized = doc.createElement('canvas');
  resized.width = maxWidth;
  resized.height = Math.round(canvas.height * scale);

  resized.getContext('2d').drawImage(canvas, 0, 0, resized.width, resized.height);
  return resized;
}
