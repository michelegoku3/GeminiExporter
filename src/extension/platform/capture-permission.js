/**
 * Permesso necessario alla cattura dei grafici interattivi.
 *
 * PERCHÉ È UN CASO A SÉ
 * ---------------------
 * `tabs.captureVisibleTab` non accetta un permesso host circoscritto: la
 * documentazione è esplicita — _«the extension must have either the
 * `<all_urls>` permission or the `activeTab` permission»_ — e l'API rifiuta
 * `https://gemini.google.com/*` benché sia il dominio effettivamente
 * fotografato.
 *
 * Dichiarare `<all_urls>` come permesso obbligatorio farebbe comparire
 * all'installazione l'avviso «leggere i tuoi dati su **tutti** i siti», che è
 * sproporzionato per un'estensione che opera solo su Gemini. È invece
 * dichiarato come **opzionale**: non compare all'installazione e viene
 * richiesto soltanto a chi vuole i grafici nei documenti.
 *
 * DOVE PUÒ GIRARE QUESTO CODICE
 * -----------------------------
 * `chrome.permissions` **non è esposta ai content script**: è una delle API
 * riservate alle pagine dell'estensione e al service worker. Un content script
 * che la invoca trova `undefined` e conclude — erroneamente — che il permesso
 * manchi, qualunque sia lo stato reale.
 *
 * Le funzioni di questo modulo vanno quindi invocate dal popup o dal service
 * worker. Il content script usa `requestCapturePermissionState`, che inoltra la
 * domanda al service worker. Vedi docs/BUGFIX-PERMESSO-CONTENT-SCRIPT.md.
 *
 * La richiesta di concessione esige inoltre un gesto dell'utente, quindi può
 * partire solo dal popup.
 * @module extension/platform/capture-permission
 */

/**
 * Origine da richiedere. `<all_urls>` è la forma accettata da
 * `permissions.request` e dichiarata in `optional_host_permissions`.
 */
const REQUESTED_ORIGIN = '<all_urls>';

/**
 * Forme con cui Chrome può riportare un permesso su tutte le origini.
 *
 * `permissions.getAll()` **non** restituisce la stringa `<all_urls>`: la
 * espande nei pattern equivalenti — quello universale, oppure la coppia
 * dedicata a http e https. Il Chrome Web Store, a sua volta, riscrive
 * `<all_urls>` nella forma universale nel manifest pubblicato.
 *
 * (I pattern non sono riportati alla lettera in questo commento: contengono la
 * sequenza che chiuderebbe il blocco. Sono elencati in `UNIVERSAL_PATTERNS`.)
 *
 * Verificare la presenza del letterale `<all_urls>` produce quindi un falso
 * negativo: il permesso è concesso, ma il confronto fallisce. È il difetto
 * descritto in docs/BUGFIX-PERMESSO-FALSO-NEGATIVO.md.
 */
const UNIVERSAL_PATTERNS = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*']);

/** @returns {any} L'API dell'estensione, o undefined fuori da quel contesto. */
function permissionsApi() {
  const api = globalThis.browser ?? globalThis.chrome;
  return api?.permissions;
}

/**
 * Verifica se il permesso di cattura è già stato concesso.
 *
 * Non lo richiede: interrogare è sempre lecito, chiedere no. Il content script
 * usa questa funzione per sapere in anticipo se la cattura è possibile, ed
 * evitare così di scorrere la pagina per un'operazione destinata a fallire.
 *
 * La verifica passa da `getAll()` e non da `contains()`: quest'ultimo confronta
 * il pattern richiesto con quelli concessi in una forma che dipende da come il
 * browser li ha normalizzati, e restituisce `false` anche quando il permesso
 * c'è. Ispezionare l'elenco effettivo è l'unico controllo affidabile.
 *
 * @returns {Promise<boolean>}
 */
export async function hasCapturePermission() {
  const permissions = permissionsApi();
  if (!permissions?.getAll) return false;

  try {
    const granted = await permissions.getAll();
    return (granted?.origins ?? []).some((origin) => UNIVERSAL_PATTERNS.has(origin));
  } catch {
    // Un'API assente o un errore di piattaforma equivalgono a "non concesso":
    // l'esportazione prosegue senza i grafici.
    return false;
  }
}

/**
 * Richiede il permesso di cattura.
 *
 * **Va invocata solo in risposta a un gesto dell'utente** (il clic su un
 * controllo del popup): il browser rifiuta le richieste che non ne derivano.
 *
 * L'esito non si desume dal valore restituito da `request()`, che alcune
 * versioni riportano in modo inaffidabile: si rilegge lo stato effettivo.
 *
 * @returns {Promise<boolean>} true se il permesso risulta concesso.
 */
export async function requestCapturePermission() {
  const permissions = permissionsApi();
  if (!permissions?.request) return false;

  try {
    await permissions.request({ origins: [REQUESTED_ORIGIN] });
  } catch {
    return false;
  }

  return hasCapturePermission();
}

/**
 * Revoca il permesso di cattura.
 *
 * Un permesso concesso deve poter essere ritirato dalla stessa interfaccia da
 * cui è stato dato: chiedere all'utente di cercarlo nelle impostazioni del
 * browser sarebbe una via d'uscita solo formale.
 *
 * Si tenta la rimozione di tutte le forme equivalenti, perché quella
 * effettivamente registrata dipende dalla normalizzazione del browser.
 *
 * @returns {Promise<boolean>} true se al termine il permesso non risulta più concesso.
 */
export async function revokeCapturePermission() {
  const permissions = permissionsApi();
  if (!permissions?.remove) return false;

  try {
    await permissions.remove({ origins: [...UNIVERSAL_PATTERNS] });
  } catch {
    // Una revoca parziale è comunque possibile: si verifica l'esito reale.
  }

  return !(await hasCapturePermission());
}

/**
 * Verifica il permesso da un contesto che non può accedere a
 * `chrome.permissions`, cioè da un content script.
 *
 * La domanda viene inoltrata al service worker, che dispone dell'API e
 * risponde con l'esito. È un giro in più, ma è l'unico modo: l'alternativa —
 * interrogare direttamente l'API — restituisce sempre "non concesso".
 *
 * @param {(message: object) => Promise<unknown>} sendMessage Canale verso il
 *   service worker, iniettato per non dipendere dalla piattaforma nei test.
 * @returns {Promise<boolean>}
 */
export async function requestCapturePermissionState(sendMessage) {
  try {
    const response = /** @type {{ granted?: boolean }} */ (
      await sendMessage({ type: 'gex:can-capture' })
    );
    return response?.granted === true;
  } catch {
    return false;
  }
}

/**
 * Chiede il permesso di cattura da un contesto privo di `chrome.permissions`.
 *
 * La richiesta viene inoltrata al service worker. `permissions.request` esige
 * un gesto dell'utente: il gesto si propaga attraverso il messaggio, quindi la
 * chiamata è lecita **solo** se questa funzione parte da un gestore di click.
 * Invocarla altrove fa fallire la richiesta, non concede il permesso di
 * nascosto.
 *
 * @param {(message: object) => Promise<unknown>} sendMessage
 * @returns {Promise<boolean>} true se al termine il permesso risulta concesso.
 */
export async function requestCapturePermissionVia(sendMessage) {
  try {
    const response = /** @type {{ granted?: boolean }} */ (
      await sendMessage({ type: 'gex:request-capture' })
    );
    return response?.granted === true;
  } catch {
    return false;
  }
}

/**
 * Revoca il permesso di cattura da un contesto privo di `chrome.permissions`.
 *
 * @param {(message: object) => Promise<unknown>} sendMessage
 * @returns {Promise<boolean>} true se il permesso non risulta più concesso.
 */
export async function revokeCapturePermissionVia(sendMessage) {
  try {
    const response = /** @type {{ revoked?: boolean }} */ (
      await sendMessage({ type: 'gex:revoke-capture' })
    );
    return response?.revoked === true;
  } catch {
    return false;
  }
}
