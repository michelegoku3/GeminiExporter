/**
 * Stili del dialogo di esportazione.
 *
 * Vivono in una stringa e non in un file `.css` perché il dialogo usa lo Shadow
 * DOM: il foglio va iniettato nello shadow root, dove un `<link>` verso una
 * risorsa dell'estensione sarebbe più lento e soggetto a un lampeggio iniziale.
 *
 * I colori seguono il tema di Gemini e si adattano alla modalità scura.
 * @module extension/content/export-dialog.styles
 */

export const DIALOG_STYLES = `
:host {
  all: initial;
}

* {
  box-sizing: border-box;
  font-family: 'Google Sans', 'Segoe UI', Roboto, -apple-system, sans-serif;
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(32, 33, 36, 0.6);
  animation: fade-in 0.15s ease;
}

.dialog {
  width: 100%;
  max-width: 420px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: #fff;
  color: #202124;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.28);
  animation: rise 0.18s cubic-bezier(0.2, 0, 0, 1);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 4px;
}

.header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 500;
}

.icon-button {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.icon-button:hover {
  background: rgba(60, 64, 67, 0.08);
}

.body {
  padding: 8px 20px 4px;
}

.group {
  margin: 0 0 4px;
  padding: 0;
  border: none;
}

.group legend {
  padding: 12px 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: #5f6368;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.option:hover:not(.is-disabled) {
  background: rgba(26, 115, 232, 0.06);
}

.option.is-disabled {
  cursor: default;
  opacity: 0.5;
}

.option input {
  margin: 2px 0 0;
  accent-color: #1a73e8;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #5f6368;
}

.field input {
  font: inherit;
  font-size: 14px;
  padding: 9px 12px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  background: #fff;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
}

.field input:focus {
  outline: none;
  border-color: #1a73e8;
  box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.18);
}

.option-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.option-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
}

.option-description {
  font-size: 12px;
  color: #5f6368;
  line-height: 1.4;
}

.badge {
  padding: 1px 6px;
  border-radius: 4px;
  background: #e8eaed;
  color: #5f6368;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 20px;
}

.button {
  padding: 9px 22px;
  border: none;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}

.button.primary {
  background: #1a73e8;
  color: #fff;
}

.button.primary:hover {
  background: #1b66c9;
  box-shadow: 0 1px 3px rgba(26, 115, 232, 0.5);
}

.button.secondary {
  background: transparent;
  color: #1a73e8;
}

.button.secondary:hover {
  background: rgba(26, 115, 232, 0.08);
}

.button:focus-visible,
.icon-button:focus-visible,
.option input:focus-visible {
  outline: 2px solid #1a73e8;
  outline-offset: 2px;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes rise {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: none; }
}

@media (prefers-color-scheme: dark) {
  .dialog {
    background: #2d2f31;
    color: #e8eaed;
  }

  .group legend,
  .field-label,
  .option-description {
    color: #9aa0a6;
  }

  .field input {
    background: #202124;
    border-color: #5f6368;
    color: #e8eaed;
  }

  .icon-button:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .option:hover:not(.is-disabled) {
    background: rgba(138, 180, 248, 0.12);
  }

  .badge {
    background: #3c4043;
    color: #9aa0a6;
  }

  .button.primary {
    background: #8ab4f8;
    color: #202124;
  }

  .button.primary:hover {
    background: #a8c7fa;
  }

  .button.secondary {
    color: #8ab4f8;
  }

  .button.secondary:hover {
    background: rgba(138, 180, 248, 0.12);
  }
}

/* Rispetta la preferenza di sistema per il movimento ridotto. */
@media (prefers-reduced-motion: reduce) {
  .overlay,
  .dialog {
    animation: none;
  }
}
`;
