/**
 * Generazione di OMML (Office Math Markup Language) dall'albero LaTeX.
 *
 * OMML è il formato con cui Word rappresenta la matematica: le formule
 * risultano native, modificabili con l'editor delle equazioni e correttamente
 * impaginate, invece di comparire come sorgente LaTeX grezzo.
 *
 * Riferimento: ECMA-376 Part 1, §22.1 (Math Markup Language).
 * @module export/docx/latex/omml
 */

import { escapeXml } from '../ooxml.js';
import { parseLatex } from './parser.js';
import { EMPTY_SLOT, fillSlot, mathRun, mergeAdjacentRuns, slot } from './omml-primitives.js';
import { blackboardLetter, DELIMITERS } from './symbols.js';

/** Namespace OMML, dichiarato sull'elemento radice. */
export const M_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/**
 * Converte una formula LaTeX in un elemento OMML.
 *
 * @param {string} latex Sorgente della formula.
 * @param {object} [options]
 * @param {boolean} [options.block] true se la formula occupa un paragrafo
 *   proprio. In tal caso viene avvolta in `<m:oMathPara>`: è la forma canonica
 *   che Word produce per la matematica in blocco. Un `<w:p>` che contiene
 *   `<m:oMath>` come unico figlio è considerato malformato da Word, che scarta
 *   silenziosamente l'intero paragrafo — LibreOffice invece lo accetta, quindi
 *   il difetto non emerge dalle conversioni di controllo.
 *   Vedi docs/BUGFIX-DOCX-OMATHPARA.md.
 * @returns {string} XML dell'elemento `<m:oMath>` o `<m:oMathPara>`.
 */
export function latexToOmml(latex, { block = false } = {}) {
  const math = `<m:oMath>${renderNodes(parseLatex(latex))}</m:oMath>`;
  return block ? asMathParagraph(math) : math;
}

/**
 * Avvolge un `<m:oMath>` nella forma canonica per la matematica che occupa un
 * paragrafo intero.
 *
 * Definita qui e non nei chiamanti: costruire `<m:oMathPara>` a mano altrove
 * ha già prodotto un paragrafo privo di allineamento.
 *
 * @param {string} mathXml Elemento `<m:oMath>` già serializzato.
 * @returns {string}
 */
export function asMathParagraph(mathXml) {
  // L'allineamento va dichiarato: il valore predefinito di <m:oMathPara> è
  // "centerGroup", che sposta la formula verso destra.
  return `<m:oMathPara><m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>${mathXml}</m:oMathPara>`;
}

/**
 * Serializza una sequenza di nodi, fondendo i run adiacenti.
 * @param {import('./parser.js').Node[]} nodes
 * @returns {string}
 */
function renderNodes(nodes) {
  return mergeAdjacentRuns(renderNodeList(nodes));
}

/**
 * @param {import('./parser.js').Node[]} nodes
 * @returns {string}
 */
function renderNodeList(nodes) {
  const parts = [];

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];

    // Un operatore grande (∑, ∫, …) in OMML racchiude il proprio operando:
    // lasciarlo vuoto fa comparire un glifo segnaposto in alcuni lettori.
    // Si assorbe quindi ciò che segue, fino al primo separatore logico.
    if (node.type === 'script' && hasBigOperator(node.base)) {
      const { operand, next } = collectOperand(nodes, index + 1);
      parts.push(renderScript(node, operand));
      index = next - 1;
      continue;
    }

    if (node.type === 'symbol' && BIG_OPERATORS.has(node.value)) {
      const { operand, next } = collectOperand(nodes, index + 1);
      parts.push(
        `<m:nary><m:naryPr><m:chr m:val="${escapeXml(node.value)}"/><m:limLoc m:val="${limitLocation(node.value)}"/><m:subHide m:val="1"/><m:supHide m:val="1"/></m:naryPr>${slot('m:sub', EMPTY_SLOT)}${slot('m:sup', EMPTY_SLOT)}${slot('m:e', operand)}</m:nary>`
      );
      index = next - 1;
      continue;
    }

    parts.push(renderNode(node));
  }

  return parts.join('');
}

/** Simboli che chiudono l'operando di un operatore grande. */
const OPERAND_TERMINATORS = new Set([
  '=',
  '+',
  '−',
  '-',
  ',',
  ';',
  '⟹',
  '⟸',
  '⟺',
  '≈',
  '≤',
  '≥',
  '≠',
  '<',
  '>',
]);

/**
 * Raccoglie l'espressione che segue un operatore grande.
 * Si ferma al primo operatore di relazione o separatore: `∑ x_i = y` deve
 * produrre l'operatore sulla sola `x_i`, non sull'intera uguaglianza.
 * @param {import('./parser.js').Node[]} nodes
 * @param {number} start
 * @returns {{ operand: string, next: number }}
 */
function collectOperand(nodes, start) {
  const collected = [];
  let index = start;

  while (index < nodes.length) {
    const node = nodes[index];
    const value = node.type === 'text' || node.type === 'symbol' ? node.value : null;

    if (value !== null && OPERAND_TERMINATORS.has(value)) break;

    collected.push(node);
    index += 1;
  }

  // Gli operatori consecutivi (∑∑∑ f) si annidano: renderNodes richiama se
  // stesso sul resto, così ciascuno riceve il proprio operando.
  return { operand: renderNodes(collected), next: index };
}

/**
 * @param {import('./parser.js').Node|null} node
 * @returns {string}
 */
function renderNode(node) {
  if (!node) return '';

  switch (node.type) {
    case 'text':
      return renderRun(node.value);

    case 'symbol':
      // Gli operatori e i simboli non alfabetici vanno in tondo: il corsivo
      // matematico è riservato alle variabili. Reso in corsivo, ∇ appare
      // come un triangolo inclinato.
      return renderRun(node.value, { roman: !isVariableLike(node.value) });

    case 'function':
      // I nomi di funzione si scrivono in tondo, non in corsivo.
      return renderRun(node.name, { roman: true });

    case 'group':
      return renderNodes(node.children);

    case 'newline':
      return '';

    case 'empty':
      return '';

    case 'fraction':
      return `<m:f><m:fPr><m:type m:val="bar"/></m:fPr>${slot('m:num', renderNode(node.numerator))}${slot('m:den', renderNode(node.denominator))}</m:f>`;

    case 'binomial':
      // Il coefficiente binomiale è una frazione senza linea, fra parentesi.
      return `<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f><m:fPr><m:type m:val="noBar"/></m:fPr>${slot('m:num', renderNode(node.top))}${slot('m:den', renderNode(node.bottom))}</m:f></m:e></m:d>`;

    case 'root':
      return renderRoot(node);

    case 'script':
      return renderScript(node, '');

    case 'limits':
      return renderLimits(node);

    case 'accent':
      return `<m:acc><m:accPr><m:chr m:val="${escapeXml(node.accent)}"/></m:accPr>${slot('m:e', renderNode(node.child))}</m:acc>`;

    case 'bar':
      return `<m:bar><m:barPr><m:pos m:val="${node.position}"/></m:barPr>${slot('m:e', renderNode(node.child))}</m:bar>`;

    case 'brace':
      return `<m:groupChr><m:groupChrPr><m:chr m:val="${node.position === 'top' ? '⏞' : '⏟'}"/><m:pos m:val="${node.position}"/><m:vertJc m:val="${node.position === 'top' ? 'bot' : 'top'}"/></m:groupChrPr>${slot('m:e', renderNode(node.child))}</m:groupChr>`;

    case 'styled':
      return renderStyled(node);

    case 'delimited':
      return renderDelimited(node);

    case 'matrix':
      return renderMatrix(node);

    default:
      return '';
  }
}

/**
 * Un run matematico. Le lettere sono corsive per convenzione: `roman`
 * disattiva il corsivo dove non è appropriato (funzioni, testo).
 * @param {string} text
 * @param {{ roman?: boolean, bold?: boolean, style?: string }} [options]
 * @returns {string}
 */
function renderRun(text, { roman = false, bold = false, style } = {}) {
  if (text === '') return '';

  // Proprietà matematiche del run (corsivo, tondo, grassetto, alfabeto).
  const mathProperties = [];
  if (style) mathProperties.push(`<m:scr m:val="${style}"/>`);
  if (bold && roman) mathProperties.push('<m:sty m:val="b"/>');
  else if (bold) mathProperties.push('<m:sty m:val="bi"/>');
  else if (roman) mathProperties.push('<m:sty m:val="p"/>');

  const mathRunPr = mathProperties.length > 0 ? `<m:rPr>${mathProperties.join('')}</m:rPr>` : '';

  return mathRun(escapeXml(text), mathRunPr);
}

/**
 * @param {import('./parser.js').Node} node
 * @returns {string}
 */
function renderRoot(node) {
  if (node.degree) {
    return `<m:rad><m:radPr><m:degHide m:val="0"/></m:radPr>${slot('m:deg', renderNode(node.degree))}${slot('m:e', renderNode(node.radicand))}</m:rad>`;
  }
  // Radice quadrata: il grado non si mostra.
  return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr>${slot('m:deg', EMPTY_SLOT)}${slot('m:e', renderNode(node.radicand))}</m:rad>`;
}

/**
 * Apici e pedici. Gli operatori grandi (∑, ∫, …) usano elementi dedicati che
 * posizionano gli estremi sopra e sotto invece che di fianco.
 * @param {import('./parser.js').Node} node
 * @param {string} [operand] Contenuto da porre dopo un operatore grande.
 * @returns {string}
 */
function renderScript(node, operand = '') {
  // `\\underbrace{x}_{testo}` e `\\overbrace{x}^{testo}`: l'annotazione va
  // centrata sotto (o sopra) la graffa, non affiancata come un pedice.
  if (node.base?.type === 'brace') {
    const braced = renderNode(node.base);
    const annotation = node.base.position === 'bot' ? node.subscript : node.superscript;
    const other = node.base.position === 'bot' ? node.superscript : node.subscript;

    if (annotation) {
      const element =
        node.base.position === 'bot'
          ? `<m:limLow>${slot('m:e', braced)}${slot('m:lim', renderNode(annotation))}</m:limLow>`
          : `<m:limUpp>${slot('m:e', braced)}${slot('m:lim', renderNode(annotation))}</m:limUpp>`;

      // Un eventuale secondo indice resta un normale apice o pedice.
      if (!other) return element;
      return node.base.position === 'bot'
        ? `<m:sSup>${slot('m:e', element)}${slot('m:sup', renderNode(other))}</m:sSup>`
        : `<m:sSub>${slot('m:e', element)}${slot('m:sub', renderNode(other))}</m:sSub>`;
    }
  }

  const base = renderNode(node.base);
  const isBigOperator = hasBigOperator(node.base);

  if (node.superscript && node.subscript) {
    if (isBigOperator) {
      return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(bigOperatorChar(node.base))}"/><m:limLoc m:val="${limitLocation(bigOperatorChar(node.base))}"/><m:subHide m:val="0"/><m:supHide m:val="0"/></m:naryPr>${slot('m:sub', renderNode(node.subscript))}${slot('m:sup', renderNode(node.superscript))}${slot('m:e', operand)}</m:nary>`;
    }
    return `<m:sSubSup>${slot('m:e', fillSlot(base))}${slot('m:sub', renderNode(node.subscript))}${slot('m:sup', renderNode(node.superscript))}</m:sSubSup>`;
  }

  if (node.superscript) {
    if (isBigOperator) {
      return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(bigOperatorChar(node.base))}"/><m:limLoc m:val="${limitLocation(bigOperatorChar(node.base))}"/><m:subHide m:val="1"/><m:supHide m:val="0"/></m:naryPr>${slot('m:sub', EMPTY_SLOT)}${slot('m:sup', renderNode(node.superscript))}${slot('m:e', operand)}</m:nary>`;
    }
    return `<m:sSup>${slot('m:e', fillSlot(base))}${slot('m:sup', renderNode(node.superscript))}</m:sSup>`;
  }

  if (node.subscript) {
    if (isBigOperator) {
      return `<m:nary><m:naryPr><m:chr m:val="${escapeXml(bigOperatorChar(node.base))}"/><m:limLoc m:val="${limitLocation(bigOperatorChar(node.base))}"/><m:subHide m:val="0"/><m:supHide m:val="1"/></m:naryPr>${slot('m:sub', renderNode(node.subscript))}${slot('m:sup', EMPTY_SLOT)}${slot('m:e', operand)}</m:nary>`;
    }
    // I limiti delle funzioni (lim, max, …) vanno sotto il nome.
    if (
      node.base?.type === 'function' &&
      ['lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf'].includes(node.base.name)
    ) {
      return `<m:limLow>${slot('m:e', fillSlot(base))}${slot('m:lim', renderNode(node.subscript))}</m:limLow>`;
    }
    return `<m:sSub>${slot('m:e', fillSlot(base))}${slot('m:sub', renderNode(node.subscript))}</m:sSub>`;
  }

  return base;
}

/**
 * Notazione posta sopra e/o sotto un simbolo.
 * OMML offre `m:limUpp` e `m:limLow`, che si annidano per avere entrambi.
 * @param {import('./parser.js').Node} node
 * @returns {string}
 */
function renderLimits(node) {
  let xml = fillSlot(renderNode(node.base));

  if (node.below) {
    xml = `<m:limLow>${slot('m:e', xml)}${slot('m:lim', renderNode(node.below))}</m:limLow>`;
  }
  if (node.above) {
    xml = `<m:limUpp>${slot('m:e', xml)}${slot('m:lim', renderNode(node.above))}</m:limUpp>`;
  }
  return xml;
}

/**
 * Un simbolo si comporta come una variabile se è una lettera: le lettere
 * greche minuscole usate come variabili (α, θ, ρ) restano corsive, mentre
 * operatori e simboli strutturali (∇, ∂, ∞, ⋅, ×) vanno in tondo.
 * @param {string} value
 * @returns {boolean}
 */
function isVariableLike(value) {
  return /^[\p{Script=Greek}\p{Script=Latin}]$/u.test(value);
}

/**
 * Integrali: per convenzione tipografica gli estremi si scrivono **di lato**,
 * non sopra e sotto il simbolo. Sommatorie, produttorie e operatori
 * insiemistici seguono invece la convenzione opposta.
 */
const SIDE_LIMIT_OPERATORS = new Set([
  '\u222B',
  '\u222C',
  '\u222D',
  '\u2A0C',
  '\u222E',
  '\u222F',
  '\u2230',
]);

/**
 * Posizione degli estremi di un operatore n-ario.
 * @param {string} symbol
 * @returns {'subSup'|'undOvr'}
 */
function limitLocation(symbol) {
  return SIDE_LIMIT_OPERATORS.has(symbol) ? 'subSup' : 'undOvr';
}

/** Operatori che accettano estremi sopra e sotto. */
const BIG_OPERATORS = new Set([
  '∑',
  '∏',
  '∐',
  '∫',
  '∬',
  '∭',
  '⨌',
  '∮',
  '∯',
  '∰',
  '⋃',
  '⋂',
  '⨁',
  '⨂',
  '⋁',
  '⋀',
]);

/**
 * @param {import('./parser.js').Node|null} node
 * @returns {boolean}
 */
function hasBigOperator(node) {
  return node?.type === 'symbol' && BIG_OPERATORS.has(node.value);
}

/**
 * @param {import('./parser.js').Node} node
 * @returns {string}
 */
function bigOperatorChar(node) {
  return node.value;
}

/**
 * @param {import('./parser.js').Node} node
 * @returns {string}
 */
function renderStyled(node) {
  const scriptMap = {
    'double-struck': 'double-struck',
    script: 'script',
    fraktur: 'fraktur',
    'sans-serif': 'sans-serif',
    monospace: 'monospace',
  };

  // Il grassetto lavagna si ottiene con caratteri Unicode dedicati quando
  // disponibili: Word li rende meglio dell'attributo di stile.
  if (node.style === 'double-struck') {
    const letters = collectText(node.child);
    const mapped = [...letters].map((letter) => blackboardLetter(letter) ?? letter).join('');
    if (mapped !== letters) return renderRun(mapped);
  }

  if (node.style === 'roman') {
    return renderRun(collectText(node.child), { roman: true });
  }

  if (node.style === 'bold') {
    return renderStyledRuns(node.child, { bold: true, roman: true });
  }

  if (node.style === 'bold-italic') {
    return renderStyledRuns(node.child, { bold: true });
  }

  if (node.style === 'italic') {
    return renderNode(node.child);
  }

  const script = scriptMap[node.style];
  return script ? renderStyledRuns(node.child, { style: script }) : renderNode(node.child);
}

/**
 * Applica uno stile a un sottoalbero, preservandone la struttura quando non è
 * riducibile a semplice testo.
 * @param {import('./parser.js').Node|null} child
 * @param {object} options
 * @returns {string}
 */
function renderStyledRuns(child, options) {
  const text = collectText(child);
  // Se il contenuto è testo puro si applica lo stile direttamente; altrimenti
  // si preserva la struttura, rinunciando allo stile sui sottoelementi.
  return text !== '' ? renderRun(text, options) : renderNode(child);
}

/**
 * Estrae il testo di un sottoalbero, se composto solo da testo e simboli.
 * @param {import('./parser.js').Node|null} node
 * @returns {string}
 */
function collectText(node) {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'symbol') return node.value;
  if (node.type === 'function') return node.name;
  if (node.type === 'group') {
    const parts = node.children.map((child) => collectText(child));
    return parts.some((part) => part === '') && node.children.length > parts.filter(Boolean).length
      ? ''
      : parts.join('');
  }
  return '';
}

/**
 * @param {import('./parser.js').Node} node
 * @returns {string}
 */
function renderDelimited(node) {
  const open = DELIMITERS[node.open] ?? (node.open === '.' ? '' : node.open);
  const close = DELIMITERS[node.close] ?? (node.close === '.' ? '' : node.close);

  const properties = [];
  if (open !== '(') properties.push(`<m:begChr m:val="${escapeXml(open)}"/>`);
  if (close !== ')') properties.push(`<m:endChr m:val="${escapeXml(close)}"/>`);

  const propertyXml = properties.length > 0 ? `<m:dPr>${properties.join('')}</m:dPr>` : '';

  return `<m:d>${propertyXml}${slot('m:e', renderNodes(node.children))}</m:d>`;
}

/**
 * Ambienti in cui `&` indica un punto di allineamento, non un separatore di
 * colonna. `cases` resta escluso: lì le colonne sono reali (valore e condizione).
 */
const ALIGNMENT_ENVIRONMENTS = new Set(['aligned', 'align', 'alignedat', 'gathered', 'split']);

/**
 * Rende un ambiente di allineamento come sequenza di righe.
 *
 * OMML separa le righe di un blocco matematico con `<m:eqArr>`, che le
 * impagina una sotto l'altra allineandole: è la traduzione corretta di
 * `aligned`, e non introduce le colonne fittizie di una matrice.
 * @param {import('./parser.js').Node} node
 * @returns {string}
 */
function renderAlignedRows(node) {
  const rows = node.rows
    .map((row) => `${slot('m:e', fillSlot(row.map((cell) => renderNodes(cell)).join('')))}`)
    .join('');

  return `<m:eqArr><m:eqArrPr><m:maxDist m:val="0"/></m:eqArrPr>${rows}</m:eqArr>`;
}

/**
 * @param {import('./parser.js').Node} node
 * @returns {string}
 */
function renderMatrix(node) {
  // Gli ambienti di allineamento non sono matrici: le `&` segnano punti di
  // allineamento, non colonne. Rappresentarli con <m:m> è semanticamente
  // errato e alcuni convertitori inseriscono un segnaposto al posto del primo
  // operatore di ogni cella. Le righe vengono quindi concatenate.
  if (ALIGNMENT_ENVIRONMENTS.has(node.environment)) {
    return renderAlignedRows(node);
  }

  const columnCount = Math.max(...node.rows.map((row) => row.length), 1);

  const columnProperties = `<m:mcs><m:mc><m:mcPr><m:count m:val="${columnCount}"/><m:mcJc m:val="${node.environment === 'cases' ? 'left' : 'center'}"/></m:mcPr></m:mc></m:mcs>`;

  const rows = node.rows
    .map((row) => {
      const cells = [];
      for (let index = 0; index < columnCount; index += 1) {
        // Le celle vuote sono normali negli ambienti allineati (`&&` separa
        // colonne di cui alcune restano libere) e nelle matrici irregolari.
        // Un <m:e> privo di contenuto viene però reso con un segnaposto.
        cells.push(`${slot('m:e', fillSlot(renderNodes(row[index] ?? [])))}`);
      }
      return `<m:mr>${cells.join('')}</m:mr>`;
    })
    .join('');

  const matrix = `<m:m><m:mPr>${columnProperties}</m:mPr>${rows}</m:m>`;

  if (node.open === '' && node.close === '') return matrix;

  const properties = [
    `<m:begChr m:val="${escapeXml(node.open)}"/>`,
    `<m:endChr m:val="${escapeXml(node.close)}"/>`,
  ].join('');

  return `<m:d><m:dPr>${properties}</m:dPr>${slot('m:e', matrix)}</m:d>`;
}
