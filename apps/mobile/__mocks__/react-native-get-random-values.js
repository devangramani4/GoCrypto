/* Stand-in for the native CSPRNG: Node's WebCrypto. */
const { webcrypto } = require('node:crypto');
if (typeof globalThis.crypto !== 'object' || typeof globalThis.crypto.getRandomValues !== 'function') {
  globalThis.crypto = webcrypto;
}
module.exports = {};
