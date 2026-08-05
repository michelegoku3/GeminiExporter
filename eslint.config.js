import globals from 'globals';

/** Configurazione ESLint (flat config) per l'estensione. */
export default [
  {
    ignores: ['node_modules/**', 'dist/**', '.legacy/**', 'assets/styles/katex.min.css'],
  },
  {
    files: ['src/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // Correttezza
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-globals': 'error',
      'no-return-await': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Sicurezza: il progetto ha già avuto una vulnerabilità XSS da innerHTML.
      // L'unico uso legittimo è nel button-injector con icone statiche.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-script-url': 'error',

      // Manutenibilità: soglie volutamente permissive, servono da campanello
      // d'allarme, non da vincolo burocratico.
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 60, skipComments: true, skipBlankLines: true }],
      'max-params': ['warn', 4],
    },
  },
  {
    // Parser e generatore sono costruiti su `switch` di dispatch: un ramo per
    // costrutto LaTeX. La complessità ciclomatica è alta per costruzione, ma
    // il codice resta lineare e leggibile; spezzare i rami in funzioni
    // separate renderebbe più difficile seguire la corrispondenza fra sintassi
    // di partenza ed elemento prodotto.
    files: ['src/export/docx/latex/**/*.js', 'src/export/docx/html-to-ooxml.js'],
    rules: {
      complexity: 'off',
      'max-lines-per-function': ['warn', { max: 100, skipComments: true, skipBlankLines: true }],
    },
  },
  {
    // I test contengono payload di attacco come dato e suite lunghe: entrambe
    // le regole produrrebbero solo rumore.
    files: ['tests/**/*.js'],
    rules: {
      'no-script-url': 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    // I template producono stringhe HTML lunghe: il limite non si applica.
    files: ['src/render/**/*.js'],
    rules: { 'max-lines-per-function': 'off' },
  },
];
