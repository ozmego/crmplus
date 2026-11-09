/* eslint-disable @typescript-eslint/no-require-imports -- düz CommonJS yükleme kancası, Next derlemesine girmez */
// İşçi süreci Next.js dışında çalışır. "server-only" paketi Next dışında içe aktarıldığında hata fırlatır;
// işçi zaten yalnız sunucuda çalıştığı için bu süreçte paketi boş bir modülle değiştiriyoruz.
// Next.js içindeki koruma etkilenmez.
const Module = require("node:module");
const path = require("node:path");

const empty = path.join(__dirname, "empty-module.cjs");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return empty;
  return original.call(this, request, ...rest);
};
