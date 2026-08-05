/**
 * Parser LaTeX matematico.
 *
 * Produce un albero sintattico a partire dal sorgente di una formula. È
 * volutamente parziale: copre la sintassi che Gemini genera realmente
 * (frazioni, radici, indici, matrici, delimitatori, accenti, funzioni), e
 * degrada in testo semplice su ciò che non riconosce, senza mai sollevare
 * eccezioni. Una formula resa in modo imperfetto è preferibile a un documento
 * che non si apre.
 *
 * @module export/docx/latex/parser
 */

import { SYMBOLS, FUNCTION_NAMES, SPACING, ACCENTS, MATRIX_ENVIRONMENTS } from './symbols.js';

/**
 * Nodo dell'albero sintattico.
 *
 * I campi presenti dipendono da `type`; sono dichiarati tutti come opzionali
 * perché JSDoc non esprime le unioni discriminate in modo agevole. Il
 * generatore OMML seleziona i campi con uno `switch` su `type`.
 *
 * @typedef {object} Node
 * @property {string} type Discriminante: 'text', 'fraction', 'matrix', …
 * @property {string} [value] Testo o simbolo, per i nodi foglia.
 * @property {string} [name] Nome della funzione, per `type: 'function'`.
 * @property {Node[]} [children] Figli di un gruppo.
 * @property {Node|null} [base] Elemento a cui si applicano indici o limiti.
 * @property {Node|null} [subscript] Pedice.
 * @property {Node|null} [superscript] Apice.
 * @property {Node|null} [above] Annotazione superiore, per `type: 'limits'`.
 * @property {Node|null} [below] Annotazione inferiore, per `type: 'limits'`.
 * @property {Node|null} [numerator] Numeratore di una frazione.
 * @property {Node|null} [denominator] Denominatore di una frazione.
 * @property {Node|null} [top] Parte superiore di un coefficiente binomiale.
 * @property {Node|null} [bottom] Parte inferiore di un coefficiente binomiale.
 * @property {Node|null} [degree] Indice di una radice.
 * @property {Node|null} [radicand] Argomento di una radice.
 * @property {Node|null} [child] Argomento di accenti, barre e stili.
 * @property {string} [accent] Carattere combinante dell'accento.
 * @property {string} [position] 'top' o 'bot', per barre e graffe.
 * @property {string} [style] Stile di carattere applicato.
 * @property {string} [open] Delimitatore di apertura.
 * @property {string} [close] Delimitatore di chiusura.
 * @property {string} [environment] Nome dell'ambiente, per le matrici.
 * @property {Node[][][]} [rows] Righe e celle di una matrice.
 */

/**
 * Comandi il cui argomento è testo letterale, non matematica.
 * Gli spazi al loro interno vanno conservati.
 */
const TEXT_COMMANDS = new Set(['text', 'textbf', 'textit', 'operatorname', 'mathrm']);

/** Stili di carattere applicabili con \mathbf, \mathit, ecc. */
const FONT_COMMANDS = {
  mathbf: 'bold',
  boldsymbol: 'bold-italic',
  mathbb: 'double-struck',
  mathcal: 'script',
  mathscr: 'script',
  mathfrak: 'fraktur',
  mathsf: 'sans-serif',
  mathtt: 'monospace',
  mathit: 'italic',
  mathrm: 'roman',
  text: 'roman',
  textbf: 'bold',
  textit: 'italic',
  operatorname: 'roman',
};

/**
 * Analizza una formula LaTeX.
 * @param {string} source
 * @returns {Node[]} Sequenza di nodi.
 */
export function parseLatex(source) {
  const tokens = tokenize(source);
  const { nodes } = parseSequence(tokens, 0, null);
  return nodes;
}

/** Token che rappresenta uno spazio nel sorgente. */
export const SPACE_TOKEN = '\u0020';

/**
 * Suddivide il sorgente in unità lessicali.
 * @param {string} source
 * @returns {string[]}
 */
export function tokenize(source) {
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === '\\') {
      // Comando: barra seguita da lettere, oppure da un singolo carattere.
      const match = /^\\([a-zA-Z]+\*?|.)/s.exec(source.slice(index));
      if (match) {
        tokens.push(match[0]);
        index += match[0].length;
        continue;
      }
      index += 1;
      continue;
    }

    if ('{}^_&'.includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      // Lo spazio diventa un token dedicato: in matematica viene ignorato,
      // ma dentro \\text{} è parte del contenuto e va conservato.
      // Ricostruirlo a posteriori con un'euristica non è affidabile.
      const previous = tokens[tokens.length - 1];
      if (previous !== undefined && previous !== SPACE_TOKEN) tokens.push(SPACE_TOKEN);
      index += 1;
      continue;
    }

    tokens.push(char);
    index += 1;
  }

  return tokens;
}

/**
 * Analizza una sequenza di token fino al terminatore indicato.
 * @param {string[]} tokens
 * @param {number} start
 * @param {string|null} terminator Token che chiude la sequenza.
 * @returns {{ nodes: Node[], next: number }}
 */
function parseSequence(tokens, start, terminator) {
  const nodes = [];
  let index = start;

  while (index < tokens.length) {
    const token = tokens[index];

    // Fuori da \text{} gli spazi non hanno significato.
    if (token === SPACE_TOKEN) {
      index += 1;
      continue;
    }

    if (terminator !== null && token === terminator) {
      return { nodes, next: index + 1 };
    }

    // `\right` chiude un gruppo delimitato: lo gestisce il chiamante.
    if (token === '\\right' || token === '\\end') {
      return { nodes, next: index };
    }

    if (token === '^' || token === '_') {
      index = attachScript(tokens, index, nodes);
      continue;
    }

    const result = parseAtom(tokens, index);
    if (result.node) nodes.push(result.node);
    index = result.next;
  }

  return { nodes, next: index };
}

/**
 * Applica un apice o un pedice all'ultimo nodo prodotto.
 * @param {string[]} tokens
 * @param {number} index
 * @param {Node[]} nodes
 * @returns {number} Indice successivo.
 */
function attachScript(tokens, index, nodes) {
  const kind = tokens[index] === '^' ? 'superscript' : 'subscript';
  const { node: script, next } = parseAtom(tokens, index + 1);

  const base = nodes.pop() ?? { type: 'empty' };

  // Un apice su un pedice esistente (o viceversa) produce un nodo combinato,
  // che OMML rappresenta con <m:sSubSup>.
  if (base.type === 'script' && !base[kind]) {
    nodes.push({ ...base, [kind]: script });
  } else {
    nodes.push({ type: 'script', base, [kind]: script });
  }

  return next;
}

/**
 * Analizza una singola unità sintattica.
 * @param {string[]} tokens
 * @param {number} index
 * @returns {{ node: Node|null, next: number }}
 */
function parseAtom(tokens, index) {
  let cursor = index;
  while (tokens[cursor] === SPACE_TOKEN) cursor += 1;

  const token = tokens[cursor];
  if (token === undefined) return { node: null, next: cursor + 1 };
  index = cursor;

  if (token === '{') {
    const { nodes, next } = parseSequence(tokens, index + 1, '}');
    return { node: { type: 'group', children: nodes }, next };
  }

  if (token.startsWith('\\')) return parseCommand(tokens, index);

  return { node: { type: 'text', value: token }, next: index + 1 };
}

/**
 * Analizza un comando LaTeX.
 * @param {string[]} tokens
 * @param {number} index
 * @returns {{ node: Node|null, next: number }}
 */
function parseCommand(tokens, index) {
  const command = tokens[index].slice(1);
  const next = index + 1;

  if (command === 'begin') return parseEnvironment(tokens, next);
  if (command === 'left') return parseDelimited(tokens, next);

  switch (command) {
    case 'frac':
    case 'dfrac':
    case 'tfrac':
    case 'cfrac': {
      const numerator = parseAtom(tokens, next);
      const denominator = parseAtom(tokens, numerator.next);
      return {
        node: { type: 'fraction', numerator: numerator.node, denominator: denominator.node },
        next: denominator.next,
      };
    }

    case 'binom':
    case 'dbinom': {
      const top = parseAtom(tokens, next);
      const bottom = parseAtom(tokens, top.next);
      return {
        node: { type: 'binomial', top: top.node, bottom: bottom.node },
        next: bottom.next,
      };
    }

    case 'sqrt': {
      // La radice può avere un indice opzionale: \sqrt[3]{x}.
      let degree = null;
      let cursor = next;
      if (tokens[cursor] === '[') {
        const closing = tokens.indexOf(']', cursor);
        if (closing !== -1) {
          degree = {
            type: 'group',
            children: parseSequence(tokens.slice(cursor + 1, closing), 0, null).nodes,
          };
          cursor = closing + 1;
        }
      }
      const radicand = parseAtom(tokens, cursor);
      return { node: { type: 'root', degree, radicand: radicand.node }, next: radicand.next };
    }

    case 'overline':
    case 'underline': {
      const argument = parseAtom(tokens, next);
      return {
        node: {
          type: 'bar',
          position: command === 'overline' ? 'top' : 'bot',
          child: argument.node,
        },
        next: argument.next,
      };
    }

    case 'overbrace':
    case 'underbrace': {
      const argument = parseAtom(tokens, next);
      return {
        node: {
          type: 'brace',
          position: command === 'overbrace' ? 'top' : 'bot',
          child: argument.node,
        },
        next: argument.next,
      };
    }

    case 'overset':
    case 'underset': {
      const annotation = parseAtom(tokens, next);
      const base = parseAtom(tokens, annotation.next);
      // La notazione va sopra o sotto il simbolo, non di fianco: è il caso
      // delle frecce di reazione chimica con le costanti cinetiche.
      const slot = command === 'overset' ? 'above' : 'below';
      const inner = base.node;

      if (inner?.type === 'limits' && !inner[slot]) {
        return { node: { ...inner, [slot]: annotation.node }, next: base.next };
      }

      return {
        node: { type: 'limits', base: inner, [slot]: annotation.node },
        next: base.next,
      };
    }

    default:
      return parseSimpleCommand(command, tokens, next);
  }
}

/**
 * Comandi che non hanno una struttura propria: simboli, accenti, stili.
 * @param {string} command
 * @param {string[]} tokens
 * @param {number} next
 * @returns {{ node: Node|null, next: number }}
 */
function parseSimpleCommand(command, tokens, next) {
  if (command in ACCENTS) {
    const argument = parseAtom(tokens, next);
    return {
      node: { type: 'accent', accent: ACCENTS[command], child: argument.node },
      next: argument.next,
    };
  }

  if (command in FONT_COMMANDS) {
    // Dentro \text{} e simili gli spazi fanno parte del contenuto: si legge
    // il gruppo alla lettera invece di analizzarlo come matematica.
    if (TEXT_COMMANDS.has(command)) {
      const { text, next: afterText } = readRawGroup(tokens, next);
      return {
        node: {
          type: 'styled',
          style: FONT_COMMANDS[command],
          child: { type: 'text', value: text },
        },
        next: afterText,
      };
    }

    const argument = parseAtom(tokens, next);
    return {
      node: { type: 'styled', style: FONT_COMMANDS[command], child: argument.node },
      next: argument.next,
    };
  }

  if (command in SPACING) {
    return { node: { type: 'text', value: SPACING[command] }, next };
  }

  if (FUNCTION_NAMES.has(command)) {
    return { node: { type: 'function', name: command }, next };
  }

  if (command in SYMBOLS) {
    return { node: { type: 'symbol', value: SYMBOLS[command] }, next };
  }

  // Dimensionatori espliciti (\\Big[ … \\Big]): in OMML la dimensione è
  // automatica, ma il delimitatore che segue va comunque emesso.
  if (/^(big|Big|bigg|Bigg)[lrm]?$/.test(command)) {
    const delimiter = tokens[next];
    if (delimiter !== undefined && /^[([\]){}|.]$|^\\[{}|]$/.test(delimiter)) {
      return {
        node: { type: 'text', value: delimiter === '.' ? '' : delimiter.replace('\\', '') },
        next: next + 1,
      };
    }
    return { node: null, next };
  }

  // Comandi ignorabili senza perdita di significato.
  if (
    ['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'notag'].includes(command)
  ) {
    return { node: null, next };
  }

  if (command === '\\') return { node: { type: 'newline' }, next };

  // Comando sconosciuto: si mostra il nome, così l'informazione non va persa.
  return { node: { type: 'text', value: command }, next };
}

/**
 * Legge un gruppo `{...}` come testo letterale.
 *
 * Il tokenizer scarta gli spazi perché in matematica non sono significativi,
 * ma dentro `\\text{}` lo sono: vengono reinseriti fra token adiacenti che
 * sono parole, così `\\text{se } x` produce "se " e non "sex".
 * @param {string[]} tokens
 * @param {number} index
 * @returns {{ text: string, next: number }}
 */
function readRawGroup(tokens, index) {
  if (tokens[index] !== '{') {
    const single = tokens[index] ?? '';
    return { text: single.startsWith('\\') ? single.slice(1) : single, next: index + 1 };
  }

  const parts = [];
  let depth = 1;
  let cursor = index + 1;

  while (cursor < tokens.length && depth > 0) {
    const token = tokens[cursor];
    if (token === '{') depth += 1;
    if (token === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
    parts.push(token.startsWith('\\') ? (SPACING[token.slice(1)] ?? token.slice(1)) : token);
    cursor += 1;
  }

  return { text: parts.join(''), next: cursor + 1 };
}

/**
 * Analizza un gruppo racchiuso fra \left … \right.
 * @param {string[]} tokens
 * @param {number} index
 * @returns {{ node: Node, next: number }}
 */
function parseDelimited(tokens, index) {
  const open = tokens[index] ?? '.';
  const { nodes, next } = parseSequence(tokens, index + 1, null);

  // `next` punta a \right; il delimitatore di chiusura lo segue.
  let cursor = next;
  let close = '.';
  if (tokens[cursor] === '\\right') {
    close = tokens[cursor + 1] ?? '.';
    cursor += 2;
  }

  return {
    node: { type: 'delimited', open, close, children: nodes },
    next: cursor,
  };
}

/**
 * Analizza un ambiente \begin{…} … \end{…}.
 * @param {string[]} tokens
 * @param {number} index
 * @returns {{ node: Node, next: number }}
 */
function parseEnvironment(tokens, index) {
  const { name, next: afterName } = readEnvironmentName(tokens, index);
  const rows = [[[]]];
  let cursor = afterName;

  // `array` accetta una specifica di colonne che non influenza la struttura.
  if (name === 'array' && tokens[cursor] === '{') {
    cursor = skipGroup(tokens, cursor);
  }

  while (cursor < tokens.length) {
    const token = tokens[cursor];

    if (token === SPACE_TOKEN) {
      cursor += 1;
      continue;
    }

    if (token === '\\end') {
      cursor = skipEnvironmentName(tokens, cursor + 1);
      break;
    }

    if (token === '&') {
      rows[rows.length - 1].push([]);
      cursor += 1;
      continue;
    }

    if (token === '\\\\' || token === '\\cr') {
      rows.push([[]]);
      cursor += 1;
      continue;
    }

    if (token === '^' || token === '_') {
      const currentRow = rows[rows.length - 1];
      attachScript(tokens, cursor, currentRow[currentRow.length - 1]);
      const { next } = parseAtom(tokens, cursor + 1);
      cursor = next;
      continue;
    }

    const { node, next } = parseAtom(tokens, cursor);
    if (node) {
      const currentRow = rows[rows.length - 1];
      currentRow[currentRow.length - 1].push(node);
    }
    cursor = next;
  }

  const [open, close] = MATRIX_ENVIRONMENTS[name] ?? ['', ''];
  // Le righe interamente vuote derivano da un `\\` finale.
  const cleaned = rows.filter((row) => row.some((cell) => cell.length > 0));

  return {
    node: { type: 'matrix', environment: name, open, close, rows: cleaned },
    next: cursor,
  };
}

/**
 * @param {string[]} tokens
 * @param {number} index
 * @returns {{ name: string, next: number }}
 */
function readEnvironmentName(tokens, index) {
  if (tokens[index] !== '{') return { name: '', next: index };

  let name = '';
  let cursor = index + 1;
  while (cursor < tokens.length && tokens[cursor] !== '}') {
    if (tokens[cursor] !== SPACE_TOKEN) name += tokens[cursor];
    cursor += 1;
  }
  return { name: name.replace(/\*$/, ''), next: cursor + 1 };
}

/**
 * @param {string[]} tokens
 * @param {number} index
 * @returns {number}
 */
function skipEnvironmentName(tokens, index) {
  return readEnvironmentName(tokens, index).next;
}

/**
 * @param {string[]} tokens
 * @param {number} index Posizione della graffa aperta.
 * @returns {number} Posizione successiva alla graffa chiusa.
 */
function skipGroup(tokens, index) {
  let depth = 0;
  let cursor = index;

  while (cursor < tokens.length) {
    if (tokens[cursor] === '{') depth += 1;
    if (tokens[cursor] === '}') {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return cursor;
}
