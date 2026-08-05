/**
 * Corrispondenze fra comandi LaTeX e caratteri Unicode.
 *
 * Word rappresenta la matematica con OMML, che non conosce i comandi LaTeX ma
 * usa i normali caratteri Unicode. La tabella copre i simboli effettivamente
 * prodotti da Gemini in ambito scientifico e ingegneristico; i comandi non
 * elencati vengono resi come testo, senza far fallire la conversione.
 * @module export/docx/latex/symbols
 */

/** Lettere greche minuscole e maiuscole. */
const GREEK = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ϵ',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'ϑ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'ϖ',
  rho: 'ρ',
  varrho: 'ϱ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'ϕ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

/** Operatori, relazioni e simboli. */
const OPERATORS = {
  // Operatori grandi
  sum: '∑',
  prod: '∏',
  coprod: '∐',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  iiiint: '⨌',
  oint: '∮',
  oiint: '∯',
  oiiint: '∰',
  bigcup: '⋃',
  bigcap: '⋂',
  bigoplus: '⨁',
  bigotimes: '⨂',
  bigvee: '⋁',
  bigwedge: '⋀',

  // Relazioni
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  equiv: '≡',
  approx: '≈',
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  propto: '∝',
  ll: '≪',
  gg: '≫',
  subset: '⊂',
  supset: '⊃',
  subseteq: '⊆',
  supseteq: '⊇',
  in: '∈',
  notin: '∉',
  ni: '∋',
  perp: '⊥',
  parallel: '∥',
  mid: '∣',

  // Operatori binari
  times: '×',
  div: '÷',
  pm: '±',
  mp: '∓',
  cdot: '⋅',
  ast: '∗',
  star: '⋆',
  circ: '∘',
  bullet: '∙',
  oplus: '⊕',
  ominus: '⊖',
  otimes: '⊗',
  oslash: '⊘',
  odot: '⊙',
  cup: '∪',
  cap: '∩',
  setminus: '∖',
  wedge: '∧',
  vee: '∨',

  // Frecce
  to: '→',
  rightarrow: '→',
  longrightarrow: '⟶',
  Rightarrow: '⇒',
  Longrightarrow: '⟹',
  implies: '⟹',
  leftarrow: '←',
  longleftarrow: '⟵',
  Leftarrow: '⇐',
  Longleftarrow: '⟸',
  impliedby: '⟸',
  leftrightarrow: '↔',
  Leftrightarrow: '⇔',
  longleftrightarrow: '⟷',
  Longleftrightarrow: '⟺',
  iff: '⟺',
  mapsto: '↦',
  rightleftharpoons: '⇌',
  uparrow: '↑',
  downarrow: '↓',
  nearrow: '↗',
  searrow: '↘',

  // Simboli vari
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  emptyset: '∅',
  varnothing: '∅',
  aleph: 'ℵ',
  hbar: 'ℏ',
  ell: 'ℓ',
  Re: 'ℜ',
  Im: 'ℑ',
  wp: '℘',
  prime: '′',
  degree: '°',
  angle: '∠',
  triangle: '△',
  square: '□',
  surd: '√',
  neg: '¬',
  lnot: '¬',
  therefore: '∴',
  because: '∵',
  ldots: '…',
  cdots: '⋯',
  vdots: '⋮',
  ddots: '⋱',
  dots: '…',
  dotsb: '⋯',
  langle: '⟨',
  rangle: '⟩',
  lceil: '⌈',
  rceil: '⌉',
  lfloor: '⌊',
  rfloor: '⌋',
  backslash: '\\',
  vert: '|',
  Vert: '‖',
  '|': '‖',
};

/** Insiemi numerici in grassetto lavagna. */
const BLACKBOARD = {
  R: 'ℝ',
  N: 'ℕ',
  Z: 'ℤ',
  Q: 'ℚ',
  C: 'ℂ',
  P: 'ℙ',
  E: '𝔼',
  H: 'ℍ',
};

/** Funzioni matematiche, rese in tondo come vuole la convenzione. */
export const FUNCTION_NAMES = new Set([
  'sin',
  'cos',
  'tan',
  'cot',
  'sec',
  'csc',
  'arcsin',
  'arccos',
  'arctan',
  'sinh',
  'cosh',
  'tanh',
  'coth',
  'exp',
  'log',
  'ln',
  'lg',
  'det',
  'dim',
  'ker',
  'deg',
  'gcd',
  'hom',
  'lim',
  'limsup',
  'liminf',
  'max',
  'min',
  'sup',
  'inf',
  'arg',
  'Pr',
  'mod',
]);

/**
 * Comandi che producono spaziatura orizzontale.
 *
 * Si usano **solo spazi normali** (U+0020) e non gli spazi tipografici Unicode
 * (U+2003 em space, U+2009 thin space, …): quei codepoint non sono presenti in
 * Cambria Math, il font con cui Word compone le equazioni. Un carattere assente
 * dal font impedisce a Word di comporre il run, e l'equazione resta bloccata
 * sul segnaposto «[Equazione]» invece di essere renderizzata.
 * Vedi docs/BUGFIX-DOCX-SPAZI-UNICODE.md.
 *
 * La larghezza si approssima ripetendo lo spazio: la resa è leggermente meno
 * precisa, ma la formula viene mostrata.
 */
export const SPACING = {
  quad: '   ',
  qquad: '      ',
  ',': ' ',
  ':': ' ',
  ';': ' ',
  '!': '',
  ' ': ' ',
  enspace: ' ',
  thinspace: ' ',
};

/** Tabella completa dei simboli. */
export const SYMBOLS = Object.freeze({ ...GREEK, ...OPERATORS });

/**
 * @param {string} letter
 * @returns {string|undefined}
 */
export function blackboardLetter(letter) {
  return BLACKBOARD[letter];
}

/** Accenti sopra un'espressione: comando → carattere combinante. */
export const ACCENTS = Object.freeze({
  hat: '\u0302',
  widehat: '\u0302',
  tilde: '\u0303',
  widetilde: '\u0303',
  bar: '\u0304',
  overline: '\u0304',
  vec: '\u20D7',
  dot: '\u0307',
  ddot: '\u0308',
  dddot: '\u20DB',
  acute: '\u0301',
  grave: '\u0300',
  check: '\u030C',
  breve: '\u0306',
});

/** Delimitatori: comando o carattere → simbolo da usare. */
export const DELIMITERS = Object.freeze({
  '(': '(',
  ')': ')',
  '[': '[',
  ']': ']',
  '\\{': '{',
  '\\}': '}',
  '{': '{',
  '}': '}',
  '|': '|',
  '\\|': '‖',
  '.': '',
  '\\langle': '⟨',
  '\\rangle': '⟩',
  '\\lceil': '⌈',
  '\\rceil': '⌉',
  '\\lfloor': '⌊',
  '\\rfloor': '⌋',
  '\\vert': '|',
  '\\Vert': '‖',
});

/** Ambienti matrice → delimitatori di apertura e chiusura. */
export const MATRIX_ENVIRONMENTS = Object.freeze({
  matrix: ['', ''],
  pmatrix: ['(', ')'],
  bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'],
  vmatrix: ['|', '|'],
  Vmatrix: ['‖', '‖'],
  smallmatrix: ['', ''],
  cases: ['{', ''],
  aligned: ['', ''],
  align: ['', ''],
  alignedat: ['', ''],
  gathered: ['', ''],
  array: ['', ''],
  split: ['', ''],
});
