// Service worker MÍNIMO — existe só para o Android/Chrome oferecer
// "Instalar aplicativo". NÃO cacheia NADA de propósito: o bundle vem
// sempre fresco da rede, preservando o diagnóstico por VERSAO
// (lição #1 do ERROS-E-LICOES: cache de bundle no celular).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* passthrough: rede sempre */ });
