/**
 * Frammenti XML costanti di un documento Word (OOXML).
 *
 * Un `.docx` è un archivio ZIP con una struttura fissa di file di supporto:
 * questi non dipendono dal contenuto e vivono qui, separati dalla logica di
 * conversione.
 *
 * Riferimento: ECMA-376, WordprocessingML.
 * @module export/docx/ooxml
 */

/** Namespace principale di WordprocessingML. */
export const W_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Bordi delle tabelle, condivisi fra lo stile e le tabelle inline.
 *
 * Word applica gli stili di tabella in modo incoerente fra le versioni: i
 * bordi vanno ripetuti sulla singola tabella. Definirli qui evita che le due
 * copie divergano.
 */
export const TABLE_BORDERS_XML = `<w:tblBorders>
  <w:top w:val="single" w:sz="4" w:color="DADCE0"/>
  <w:left w:val="single" w:sz="4" w:color="DADCE0"/>
  <w:bottom w:val="single" w:sz="4" w:color="DADCE0"/>
  <w:right w:val="single" w:sz="4" w:color="DADCE0"/>
  <w:insideH w:val="single" w:sz="4" w:color="DADCE0"/>
  <w:insideV w:val="single" w:sz="4" w:color="DADCE0"/>
</w:tblBorders>`;

/** Elenco dei tipi di contenuto: senza questo file Word rifiuta l'archivio. */
export const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

/** Relazioni a livello di pacchetto: indicano dov'è il documento principale. */
export const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

/** Relazioni del documento: stili e numerazione delle liste. */
export const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>`;

/**
 * Tabella dei font usati dal documento.
 *
 * Dichiarare `Cambria Math` qui evita che Word debba dedurne le metriche a
 * documento già aperto, uno dei fattori del ricalcolo differito.
 */
export const FONT_TABLE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="${W_NAMESPACE}">
  <w:font w:name="Calibri">
    <w:family w:val="swiss"/>
    <w:pitch w:val="variable"/>
  </w:font>
  <w:font w:name="Cambria Math">
    <w:family w:val="roman"/>
    <w:pitch w:val="variable"/>
  </w:font>
  <w:font w:name="Consolas">
    <w:family w:val="modern"/>
    <w:pitch w:val="fixed"/>
  </w:font>
</w:fonts>`;

/**
 * Definizioni di numerazione per gli elenchi puntati e numerati.
 * numId 1 = puntato, numId 2 = numerato.
 */
export const NUMBERING_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W_NAMESPACE}">
  <w:abstractNum w:abstractNumId="0">
    ${[0, 1, 2, 3]
      .map(
        (level) => `<w:lvl w:ilvl="${level}">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="${level % 2 === 0 ? '•' : '◦'}"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>
    </w:lvl>`
      )
      .join('\n    ')}
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    ${[0, 1, 2, 3]
      .map(
        (level) => `<w:lvl w:ilvl="${level}">
      <w:start w:val="1"/>
      <w:numFmt w:val="${level % 2 === 0 ? 'decimal' : 'lowerLetter'}"/>
      <w:lvlText w:val="%${level + 1}."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="${720 * (level + 1)}" w:hanging="360"/></w:pPr>
    </w:lvl>`
      )
      .join('\n    ')}
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/**
 * Stili del documento.
 *
 * Le misure OOXML usano unità particolari: le dimensioni dei caratteri sono in
 * mezzi punti (`w:sz="22"` = 11 pt) e i margini in twip (1/1440 di pollice).
 */
export const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W_NAMESPACE}">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <!-- eastAsia resta su Calibri.

             Puntarlo a "Cambria Math" sembrava innocuo — l'idea era offrire a
             Word un riferimento per le metriche OpenType MATH — ma eastAsia non
             è un font di riserva: dichiara il font con cui misurare i caratteri
             attribuiti alla scrittura dell'Asia orientale. Applicato ai default
             valeva per ogni run del documento e attivava la tipografia CJK,
             che comprime le larghezze di avanzamento ai confini fra scritture
             diverse. Vedi docs/BUGFIX-DOCX-CARATTERI-COMPRESSI.md. -->
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/>
        <w:sz w:val="22"/>
        <w:szCs w:val="22"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>
    </w:pPrDefault>
  </w:docDefaults>

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>

  ${[1, 2, 3, 4, 5, 6]
    .map((level) => {
      const sizes = { 1: 36, 2: 30, 3: 26, 4: 24, 5: 22, 6: 22 };
      return `<w:style w:type="paragraph" w:styleId="Heading${level}">
    <w:name w:val="heading ${level}"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:keepNext/>
      <w:outlineLvl w:val="${level - 1}"/>
      <w:spacing w:before="${level <= 2 ? 360 : 280}" w:after="120"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="1A1A1A"/>
      <w:sz w:val="${sizes[level]}"/>
    </w:rPr>
  </w:style>`;
    })
    .join('\n  ')}

  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="1A73E8"/><w:sz w:val="40"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/><w:spacing w:after="360"/></w:pPr>
    <w:rPr><w:color w:val="5F6368"/><w:sz w:val="18"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="caption"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:jc w:val="center"/><w:spacing w:before="40" w:after="240"/></w:pPr>
    <w:rPr><w:i/><w:color w:val="5F6368"/><w:sz w:val="18"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Label">
    <w:name w:val="Label"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:caps/><w:color w:val="5F6368"/><w:sz w:val="18"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="UserMessage">
    <w:name w:val="User Message"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="1A73E8"/></w:pBdr>
      <w:shd w:val="clear" w:fill="E8F0FE"/>
      <w:spacing w:after="240"/>
      <w:ind w:left="200" w:right="200"/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="CodeBlock">
    <w:name w:val="Code Block"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:shd w:val="clear" w:fill="F1F3F4"/>
      <w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/>
      <w:ind w:left="200" w:right="200"/>
      <w:pBdr>
        <w:top w:val="single" w:sz="4" w:space="4" w:color="DADCE0"/>
        <w:bottom w:val="single" w:sz="4" w:space="4" w:color="DADCE0"/>
        <w:left w:val="single" w:sz="4" w:space="4" w:color="DADCE0"/>
        <w:right w:val="single" w:sz="4" w:space="4" w:color="DADCE0"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="1A73E8"/></w:pBdr>
      <w:ind w:left="240"/>
    </w:pPr>
    <w:rPr><w:i/><w:color w:val="3C4043"/></w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Formula">
    <w:name w:val="Formula"/>
    <w:basedOn w:val="Normal"/>
    <!-- keepNext + keepLines: una formula non va separata dal testo che la
         introduce né spezzata fra due pagine. Quando Word ricalcola l'altezza
         reale delle equazioni, senza questi vincoli il riflusso spinge il
         contenuto oltre il margine inferiore. -->
    <!-- Nessun allineamento: le formule seguono il testo, a sinistra. La
         centratura è stata rimossa perché sommandosi a quella di OMML
         spostava le formule oltre il centro.
         Nessun colore né corsivo: le equazioni native seguono il testo. -->
    <w:pPr>
      <w:keepLines/>
      <w:spacing w:before="120" w:after="120"/>
      <w:widowControl/>
    </w:pPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Footer">
    <w:name w:val="Footer Note"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="center"/>
      <w:spacing w:before="480"/>
      <w:pBdr><w:top w:val="single" w:sz="4" w:space="8" w:color="DADCE0"/></w:pBdr>
    </w:pPr>
    <w:rPr><w:color w:val="9AA0A6"/><w:sz w:val="16"/></w:rPr>
  </w:style>

  <w:style w:type="character" w:styleId="InlineCode">
    <w:name w:val="Inline Code"/>
    <w:rPr>
      <w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>
      <w:shd w:val="clear" w:fill="F1F3F4"/>
      <w:color w:val="C5221F"/>
      <w:sz w:val="19"/>
    </w:rPr>
  </w:style>

  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="1A73E8"/><w:u w:val="single"/></w:rPr>
  </w:style>

  <w:style w:type="table" w:styleId="DataTable">
    <w:name w:val="Data Table"/>
    <w:tblPr>${TABLE_BORDERS_XML}</w:tblPr>
  </w:style>
</w:styles>`;

/**
 * Impostazioni del documento, comprese le proprietà matematiche.
 *
 * `<m:mathPr>` dice a Word come impaginare la matematica: quale font usare,
 * come allineare le equazioni, dove spezzare le formule lunghe. In sua assenza
 * Word non dispone dei parametri di layout, mostra il segnaposto «EQUAZIONE» e
 * calcola l'altezza reale delle formule solo in un secondo momento. Il
 * ricalcolo differito riflowa il documento **dopo** l'impaginazione iniziale,
 * spingendo il testo oltre i margini di pagina: è la causa del contenuto che
 * appare "tagliato".
 *
 * `Cambria Math` è il font matematico di riferimento di Office: contiene le
 * tabelle OpenType MATH che Word usa per dimensionare radici, delimitatori e
 * frazioni.
 */
export const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${W_NAMESPACE}"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <!-- Layout web: il documento si apre come una pagina unica e continua,
       senza interruzioni di pagina.

       Motivo: Word calcola l'altezza reale delle equazioni solo dopo aver
       impaginato, e il riflusso conseguente spinge il contenuto oltre il
       margine inferiore. In layout web non esistono margini di pagina, quindi
       il problema non può presentarsi. È anche la modalità in cui l'utente
       deve passare manualmente per rimettere a posto il documento.

       La stampa e l'esportazione in PDF non sono influenzate: usano sempre il
       layout di stampa, con il formato A4 dichiarato in <w:sectPr>. -->
  <w:view w:val="web"/>
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="708"/>
  <!-- Disattiva la compressione della spaziatura di derivazione tipografica
       CJK. Word la applica ai confini fra scritture diverse, e un paragrafo che
       alterna testo e formule inline è tutto un susseguirsi di quei confini:
       le larghezze di avanzamento collassano e i glifi si sovrappongono.

       Il valore predefinito, quando l'impostazione è assente, dipende dalla
       lingua di installazione di Word: è questa la ragione per cui il difetto
       si presentava in modo intermittente. Dichiararlo lo rende deterministico.
       Vedi docs/BUGFIX-DOCX-CARATTERI-COMPRESSI.md. -->
  <w:characterSpacingControl w:val="doNotCompress"/>
  <w:compat>
    <w:compatSetting w:name="compatibilityMode"
      w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
  </w:compat>
  <m:mathPr>
    <m:mathFont m:val="Cambria Math"/>
    <m:brkBin m:val="before"/>
    <m:brkBinSub m:val="--"/>
    <m:smallFrac m:val="0"/>
    <m:dispDef/>
    <m:lMargin m:val="0"/>
    <m:rMargin m:val="0"/>
    <m:defJc m:val="left"/>
    <m:wrapIndent m:val="1440"/>
    <m:intLim m:val="subSup"/>
    <m:naryLim m:val="undOvr"/>
  </m:mathPr>
</w:settings>`;

/**
 * Proprietà descrittive del documento.
 * @param {{ title: string, createdAt: Date, generator: string }} params
 * @returns {string}
 */
export function buildCoreProperties({ title, createdAt, generator }) {
  const timestamp = createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties
  xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>${escapeXml(generator)}</dc:creator>
  <cp:lastModifiedBy>${escapeXml(generator)}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

/**
 * @param {{ generator: string }} params
 * @returns {string}
 */
export function buildAppProperties({ generator }) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties
  xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>${escapeXml(generator)}</Application>
</Properties>`;
}

/**
 * Escaping dei caratteri riservati in XML.
 *
 * Rimuove anche i caratteri di controllo non ammessi dalla specifica: la loro
 * presenza rende l'intero documento illeggibile per Word, e possono comparire
 * nel testo copiato dal modello.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
