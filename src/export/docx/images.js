/**
 * Immagini nel pacchetto Word.
 *
 * OOXML non ammette immagini incorporate nel markup: ogni immagine è una parte
 * binaria dell'archivio (`word/media/…`), collegata al documento da una
 * relazione e referenziata nel testo tramite l'identificatore di quella
 * relazione. Questo modulo raccoglie le immagini incontrate durante la
 * conversione e produce i tre elementi corrispondenti.
 *
 * Le dimensioni sono espresse in EMU (English Metric Units), l'unità di misura
 * dei disegni OOXML: 914 400 EMU per pollice.
 * @module export/docx/images
 */

import { IMAGE } from '../../shared/config.js';

/**
 * Relazioni fisse già dichiarate in `DOCUMENT_RELS_XML` (rId1…rId4).
 *
 * Gli identificatori delle immagini proseguono la numerazione da rId5 in poi.
 * La specifica ammette qualunque stringa come identificatore, ma Word emette e
 * si aspetta la forma `rId<numero>`: un identificatore fuori convenzione, come
 * `rIdImg1`, viene risolto da LibreOffice ma ignorato da Word, che scarta il
 * disegno senza segnalare nulla. Vedi docs/BUGFIX-DOCX-IMMAGINE-RELID.md.
 */
const FIXED_RELATIONSHIPS = 4;

/** EMU per pollice, come da specifica ECMA-376. */
const EMU_PER_INCH = 914400;

/** Risoluzione assunta per convertire i pixel in unità fisiche. */
const PIXELS_PER_INCH = 96;

/** Larghezza utile di una pagina A4 con margini di 2 cm, in EMU. */
const CONTENT_WIDTH_EMU = 6120000;

/** Proporzione usata quando le dimensioni reali non sono note. */
const DEFAULT_ASPECT_RATIO = 3 / 4;

/** Tipi di immagine supportati, con la relativa estensione. */
const SUPPORTED_TYPES = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'png',
});

/**
 * @typedef {object} RegisteredImage
 * @property {string} id Identificatore della relazione.
 * @property {number} widthEmu
 * @property {number} heightEmu
 *
 * @typedef {object} ImageCollector
 * @property {(dataUrl: string) => RegisteredImage|null} add
 * @property {() => boolean} isEmpty
 * @property {() => Array<{ path: string, content: Uint8Array }>} parts
 * @property {() => string} relationships
 * @property {() => string[]} extensions
 */

/**
 * Raccoglie le immagini di un documento e ne produce le parti OOXML.
 *
 * Lo stato è incapsulato in una closure: ogni documento ha la propria raccolta,
 * evitando che identificatori di relazione si sovrappongano fra esportazioni.
 *
 * @returns {ImageCollector}
 */
export function createImageCollector() {
  /** @type {Array<{ id: string, path: string, bytes: Uint8Array, extension: string }>} */
  const images = [];

  return {
    /**
     * Registra un'immagine e restituisce i dati per referenziarla.
     *
     * @param {string} dataUrl Immagine come data URI.
     * @returns {{ id: string, widthEmu: number, heightEmu: number }|null}
     *   null se il formato non è supportato o i dati non sono leggibili.
     */
    add(dataUrl) {
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) return null;

      const index = images.length + 1;
      const id = `rId${FIXED_RELATIONSHIPS + index}`;

      images.push({
        id,
        path: `word/media/image${index}.${decoded.extension}`,
        bytes: decoded.bytes,
        extension: decoded.extension,
      });

      return { id, ...computeSize(decoded.bytes) };
    },

    /** @returns {boolean} */
    isEmpty() {
      return images.length === 0;
    },

    /**
     * Parti binarie da aggiungere all'archivio.
     * @returns {Array<{ path: string, content: Uint8Array }>}
     */
    parts() {
      return images.map(({ path, bytes }) => ({ path, content: bytes }));
    },

    /**
     * Relazioni da aggiungere a `word/_rels/document.xml.rels`.
     * @returns {string}
     */
    relationships() {
      return images
        .map(
          ({ id, path }) =>
            `<Relationship Id="${id}" ` +
            `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ` +
            `Target="${path.replace('word/', '')}"/>`
        )
        .join('');
    },

    /**
     * Estensioni da dichiarare in `[Content_Types].xml`.
     * @returns {string[]}
     */
    extensions() {
      return [...new Set(images.map(({ extension }) => extension))];
    },
  };
}

/**
 * Costruisce l'elemento di disegno che inserisce l'immagine nel testo.
 *
 * @param {object} params
 * @param {string} params.id Identificatore della relazione.
 * @param {number} params.widthEmu
 * @param {number} params.heightEmu
 * @param {string} [params.description] Testo alternativo.
 * @param {number} params.index Progressivo, richiesto da Word come nome univoco.
 * @returns {string}
 */
export function buildDrawing({ id, widthEmu, heightEmu, description = '', index }) {
  const name = `Immagine ${index}`;
  const safeDescription = description.replace(/[<>&"]/g, '');

  return `<w:r><w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
    <wp:docPr id="${index}" name="${name}" descr="${safeDescription}"/>
    <wp:cNvGraphicFramePr>
      <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
    </wp:cNvGraphicFramePr>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="${index}" name="${name}" descr="${safeDescription}"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${id}"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm>
              <a:off x="0" y="0"/>
              <a:ext cx="${widthEmu}" cy="${heightEmu}"/>
            </a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></w:r>`;
}

/**
 * Decodifica una stringa base64 in byte.
 *
 * Non usa direttamente `atob` perché alcune implementazioni — fra cui quella
 * di jsdom, impiegata nei test — rifiutano stringhe altrimenti valide. La
 * decodifica manuale dipende solo dall'alfabeto standard ed è quindi
 * prevedibile in ogni ambiente.
 *
 * @param {string} base64
 * @returns {Uint8Array}
 */
function decodeBase64(base64) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  // Spazi e a capo possono comparire nei data URI: base64 non li ammette.
  const clean = base64.replace(/\s+/g, '').replace(/=+$/, '');

  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let position = 0;

  for (const character of clean) {
    const value = alphabet.indexOf(character);
    if (value === -1) throw new Error(`carattere non valido: ${character}`);

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes[position] = (buffer >> bits) & 0xff;
      position += 1;
    }
  }

  return bytes.subarray(0, position);
}

/**
 * Decodifica un data URI in byte.
 *
 * @param {string} dataUrl
 * @returns {{ bytes: Uint8Array, extension: string }|null}
 */
function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/is.exec(dataUrl ?? '');
  if (!match) return null;

  const [, mimeType, isBase64, payload] = match;
  const extension = SUPPORTED_TYPES[mimeType.toLowerCase()];
  if (!extension) return null;

  try {
    if (isBase64) return { bytes: decodeBase64(payload), extension };

    // Data URI non codificato: i caratteri sono percent-encoded.
    const text = decodeURIComponent(payload);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) {
      bytes[index] = text.charCodeAt(index);
    }
    return { bytes, extension };
  } catch {
    // Un'immagine illeggibile viene omessa: l'export deve comunque riuscire.
    return null;
  }
}

/**
 * Determina la dimensione con cui inserire l'immagine.
 *
 * Le proporzioni si leggono dall'intestazione del file quando riconoscibile;
 * in mancanza si adotta un rapporto predefinito, preferibile a un'immagine
 * deformata.
 *
 * @param {Uint8Array} bytes
 * @returns {{ widthEmu: number, heightEmu: number }}
 */
function computeSize(bytes) {
  const dimensions = readDimensions(bytes);

  const maxWidthEmu = Math.min(
    CONTENT_WIDTH_EMU,
    Math.round((IMAGE.maxWidthPx / PIXELS_PER_INCH) * EMU_PER_INCH)
  );

  if (!dimensions) {
    return {
      widthEmu: maxWidthEmu,
      heightEmu: Math.round(maxWidthEmu * DEFAULT_ASPECT_RATIO),
    };
  }

  const naturalWidthEmu = Math.round((dimensions.width / PIXELS_PER_INCH) * EMU_PER_INCH);
  const widthEmu = Math.min(naturalWidthEmu, maxWidthEmu);

  return {
    widthEmu,
    heightEmu: Math.round(widthEmu * (dimensions.height / dimensions.width)),
  };
}

/**
 * Legge le dimensioni dall'intestazione di PNG e JPEG.
 *
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number }|null}
 */
function readDimensions(bytes) {
  return readPngDimensions(bytes) ?? readJpegDimensions(bytes);
}

/**
 * PNG: le dimensioni stanno nel chunk IHDR, a offset fisso.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number }|null}
 */
function readPngDimensions(bytes) {
  const isPng = bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50;
  if (!isPng) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * JPEG: le dimensioni stanno nel primo marcatore SOF, da cercare nel flusso.
 * @param {Uint8Array} bytes
 * @returns {{ width: number, height: number }|null}
 */
function readJpegDimensions(bytes) {
  const isJpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isJpeg) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset < bytes.length - 9) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    // I marcatori SOF0–SOF15 contengono le dimensioni; SOF4, SOF8 e SOF12 no.
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

    if (isStartOfFrame) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }

    offset += 2 + view.getUint16(offset + 2);
  }

  return null;
}
