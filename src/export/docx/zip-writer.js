/**
 * Scrittore ZIP minimale.
 *
 * Un file `.docx` è un archivio ZIP che contiene XML. Servono quindi poche
 * decine di righe per produrlo, contro le ~100 KB di una libreria come JSZip:
 * il progetto mantiene la promessa "zero dipendenze runtime".
 *
 * I file sono archiviati con il metodo *store* (nessuna compressione). Word
 * apre senza problemi gli archivi non compressi, e in cambio si evita ogni
 * dipendenza da `CompressionStream` — non disponibile su tutti i browser
 * supportati — e si ottiene un output deterministico, facile da verificare
 * nei test.
 * @module export/docx/zip-writer
 */

/** Firme dei record ZIP, dalla specifica APPNOTE di PKWARE. */
const SIGNATURE = Object.freeze({
  localFile: 0x04034b50,
  centralDirectory: 0x02014b50,
  endOfCentralDirectory: 0x06054b50,
});

/** 0 = store (nessuna compressione). */
const METHOD_STORE = 0;

/** Versione minima richiesta per estrarre: 2.0. */
const VERSION = 20;

/** Bit 11 del flag generale: i nomi dei file sono codificati in UTF-8. */
const FLAG_UTF8 = 0x0800;

/** Tabella CRC32, calcolata una sola volta al primo utilizzo. */
let crcTable = null;

/** @returns {Uint32Array} */
function getCrcTable() {
  if (crcTable) return crcTable;

  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number} CRC32 dei dati, come intero senza segno.
 */
export function crc32(bytes) {
  const table = getCrcTable();
  let crc = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Accumulatore di byte con scritture little-endian.
 * I record ZIP usano esclusivamente questo ordinamento.
 */
class ByteBuffer {
  constructor() {
    /** @type {number[]} */
    this.bytes = [];
  }

  /** @param {number} value */
  writeUint16(value) {
    this.bytes.push(value & 0xff, (value >>> 8) & 0xff);
  }

  /** @param {number} value */
  writeUint32(value) {
    this.bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff
    );
  }

  /** @param {Uint8Array} chunk */
  writeBytes(chunk) {
    for (let index = 0; index < chunk.length; index += 1) this.bytes.push(chunk[index]);
  }

  /** @returns {number} Numero di byte scritti finora. */
  get length() {
    return this.bytes.length;
  }

  /** @returns {Uint8Array} */
  toUint8Array() {
    return new Uint8Array(this.bytes);
  }
}

/**
 * Converte data e ora nel formato MS-DOS usato dallo ZIP.
 * @param {Date} date
 * @returns {{ time: number, date: number }}
 */
function toDosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  // L'anno è espresso come scostamento dal 1980.
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { time, date: dosDate };
}

/**
 * Crea un archivio ZIP.
 *
 * @param {Array<{ path: string, content: string|Uint8Array }>} entries
 * @param {object} [options]
 * @param {Date} [options.modifiedAt] Data applicata a tutte le voci.
 * @returns {Uint8Array} Contenuto dell'archivio.
 */
export function createZip(entries, { modifiedAt = new Date() } = {}) {
  const encoder = new TextEncoder();
  const { time, date } = toDosDateTime(modifiedAt);

  const localRecords = new ByteBuffer();
  const centralRecords = new ByteBuffer();
  let entryCount = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const data = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const checksum = crc32(data);
    const localHeaderOffset = localRecords.length;

    // --- Local file header ---
    localRecords.writeUint32(SIGNATURE.localFile);
    localRecords.writeUint16(VERSION);
    localRecords.writeUint16(FLAG_UTF8);
    localRecords.writeUint16(METHOD_STORE);
    localRecords.writeUint16(time);
    localRecords.writeUint16(date);
    localRecords.writeUint32(checksum);
    localRecords.writeUint32(data.length); // dimensione compressa
    localRecords.writeUint32(data.length); // dimensione originale
    localRecords.writeUint16(nameBytes.length);
    localRecords.writeUint16(0); // nessun campo extra
    localRecords.writeBytes(nameBytes);
    localRecords.writeBytes(data);

    // --- Central directory record ---
    centralRecords.writeUint32(SIGNATURE.centralDirectory);
    centralRecords.writeUint16(VERSION); // versione di creazione
    centralRecords.writeUint16(VERSION); // versione richiesta
    centralRecords.writeUint16(FLAG_UTF8);
    centralRecords.writeUint16(METHOD_STORE);
    centralRecords.writeUint16(time);
    centralRecords.writeUint16(date);
    centralRecords.writeUint32(checksum);
    centralRecords.writeUint32(data.length);
    centralRecords.writeUint32(data.length);
    centralRecords.writeUint16(nameBytes.length);
    centralRecords.writeUint16(0); // extra
    centralRecords.writeUint16(0); // commento
    centralRecords.writeUint16(0); // numero del disco
    centralRecords.writeUint16(0); // attributi interni
    centralRecords.writeUint32(0); // attributi esterni
    centralRecords.writeUint32(localHeaderOffset);
    centralRecords.writeBytes(nameBytes);

    entryCount += 1;
  }

  // --- End of central directory ---
  const trailer = new ByteBuffer();
  trailer.writeUint32(SIGNATURE.endOfCentralDirectory);
  trailer.writeUint16(0); // numero del disco
  trailer.writeUint16(0); // disco della central directory
  trailer.writeUint16(entryCount);
  trailer.writeUint16(entryCount);
  trailer.writeUint32(centralRecords.length);
  trailer.writeUint32(localRecords.length);
  trailer.writeUint16(0); // lunghezza del commento

  const archive = new Uint8Array(localRecords.length + centralRecords.length + trailer.length);
  archive.set(localRecords.toUint8Array(), 0);
  archive.set(centralRecords.toUint8Array(), localRecords.length);
  archive.set(trailer.toUint8Array(), localRecords.length + centralRecords.length);

  return archive;
}
