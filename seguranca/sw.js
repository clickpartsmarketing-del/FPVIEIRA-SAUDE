// =============================================================
// FPV Campo — Service Worker  (substituto proposto de public/sw.js)
//
// O QUE MUDA EM RELAÇÃO AO ATUAL:
//   o sw.js de hoje é passthrough puro ("não cacheia NADA de propósito").
//   Isso resolveu a LIÇÃO #1 (cache de bundle no celular = tela antiga),
//   mas ao preço de: sem sinal na escola, o app não abre. Nem a casca.
//
// COMO ESTE AQUI HONRA A LIÇÃO #1 E MESMO ASSIM ABRE OFFLINE:
//   1) index.html é sempre NETWORK-FIRST. Com sinal, o celular SEMPRE
//      pega o HTML fresco -> a VERSAO do cabeçalho continua sendo
//      diagnóstico confiável. O cache do HTML só entra quando a rede
//      falhou de verdade.
//   2) os assets do Vite (/assets/index-<hash>.js) têm HASH no nome:
//      build novo = nome novo. Cachear esses é seguro por construção —
//      nunca existe "versão velha do mesmo arquivo".
//   3) NADA do Supabase é cacheado. Dado de O.S., estoque e sessão
//      sempre vem da rede. App offline aqui = casca que abre e explica
//      que está sem rede, NÃO um app que finge ter dados velhos.
//      (Fila offline de gravação é outro projeto — não está aqui.)
//
// BUMPAR `VERSAO` ABAIXO A CADA RELEASE, junto com o VERSAO do App.tsx.
// =============================================================

const VERSAO = 'v72';
const CACHE = `fpv-shell-${VERSAO}`;

// Casca mínima: o que precisa existir para a tela abrir sem rede.
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

// Origens que NUNCA podem passar pelo cache: dado vivo e sessão.
const NUNCA_CACHEAR = [
  '/rest/v1',       // PostgREST — O.S., estoque, financeiro
  '/auth/v1',       // login, refresh de token
  '/realtime/v1',   // websocket
  '/functions/v1',  // edge function (transcrever)
  '/storage/v1',    // fotos: URL assinada expira, cachear vira 400 preso
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll é tudo-ou-nada: um 404 derruba a instalação inteira e o
      // usuário fica sem SW nenhum. Por item, o que der certo fica.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(
        ks.filter((k) => k.startsWith('fpv-shell-') && k !== CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// permite ao app forçar a troca de SW sem esperar fechar todas as abas
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // 1) só GET. POST/PATCH/DELETE nunca encostam no cache.
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // 2) só http(s) (ignora chrome-extension:, blob:, data:)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 3) dado vivo e sessão: passa reto, sem SW no meio
  if (NUNCA_CACHEAR.some((p) => url.pathname.startsWith(p))) return;

  // 4) NAVEGAÇÃO (abrir o app): rede primeiro — LIÇÃO #1.
  //    Só cai no cache quando a rede realmente falhou.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copia)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then(
          (r) => r || new Response(
            '<!doctype html><meta charset="utf-8">' +
            '<div style="font:16px system-ui;padding:2rem;text-align:center">' +
            '<b>FPV Campo</b><br><br>Sem internet e sem cópia salva no aparelho.<br>' +
            'Abra o app uma vez com sinal para ele funcionar offline.</div>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
        ))
    );
    return;
  }

  // 5) assets com HASH do Vite: cache-first é seguro (nome muda por build)
  const temHash = /\/assets\/.+\-[A-Za-z0-9_]{8,}\.(js|css|woff2?|png|jpg|svg)$/.test(url.pathname);
  const mesmaOrigem = url.origin === self.location.origin;

  if (mesmaOrigem && (temHash || SHELL.includes(url.pathname))) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // 6) TAILWIND VIA CDN (cdn.tailwindcss.com) — ver nota no fim do arquivo.
  //    Enquanto o <script src> apontar para o CDN, cacheia aqui senão o
  //    app offline abre SEM NENHUM CSS (parede de texto cru, pior que
  //    tela em branco para quem está no telhado de uma escola).
  //    stale-while-revalidate: serve o salvo na hora, atualiza por trás.
  if (url.hostname === 'cdn.tailwindcss.com') {
    e.respondWith(
      caches.match(req).then((hit) => {
        const rede = fetch(req).then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
          }
          return res;
        }).catch(() => hit);
        return hit || rede;
      })
    );
    return;
  }

  // 7) resto: rede normal, sem SW.
});

// =============================================================
// POR QUE O TAILWIND VIA CDN QUEBRA O OFFLINE — e como sair disso
// sem virar um projeto novo
//
// O index.html carrega <script src="https://cdn.tailwindcss.com">. Esse
// script NÃO é uma folha de estilo pronta: é o compilador do Tailwind
// rodando NO NAVEGADOR (JIT). Ele varre o DOM, vê as classes e injeta o
// CSS em tempo de execução. Consequências:
//   - offline sem esse arquivo => ZERO CSS. O app abre como texto cru.
//   - o app de um contrato público depende de um CDN de terceiro no
//     caminho crítico: CDN fora do ar = app "quebrado" no campo; CDN
//     comprometido = JavaScript arbitrário rodando dentro de um app
//     logado no banco da medição. Isso é risco de cadeia de suprimento,
//     não só de performance.
//   - custo por abertura: baixar e recompilar o CSS toda vez, no 4G da
//     escola.
//
// NÍVEL 1 — 15 minutos, sem mexer no build (RECOMENDADO AGORA):
//   auto-hospedar o mesmo arquivo. Uma vez:
//     curl -L https://cdn.tailwindcss.com/3.4.17 -o public/tailwind-3.4.17.js
//   e no index.html trocar:
//     - <script src="https://cdn.tailwindcss.com"></script>
//     + <script src="/tailwind-3.4.17.js"></script>
//   O bloco `tailwind.config = {...}` que já existe continua igual.
//   Ganhos: mesma aparência (é o MESMO compilador), sem terceiro no
//   caminho, e o arquivo passa a ser same-origin — o item 5 deste SW já
//   cacheia. Aí acrescente '/tailwind-3.4.17.js' ao array SHELL acima e
//   o bloco do item 6 pode ser apagado.
//   Rollback: reverter uma linha do index.html.
//
// NÍVEL 2 — Tailwind de verdade no build (DEIXAR PARA DEPOIS DA MEDIÇÃO):
//   npm i -D tailwindcss postcss autoprefixer + tailwind.config.js +
//   index.css importado no index.tsx. CSS menor e mais rápido, MAS:
//   o JIT do CDN enxerga classe montada em tempo de execução
//   (`className={`bg-${cor}-500`}`) e o build NÃO — classe montada por
//   concatenação some do CSS final e a tela muda de cara. Existe esse
//   padrão no repo. Trocar isso no meio de uma medição é assumir risco
//   visual sem necessidade. Faça depois, com uma varredura de classes
//   dinâmicas e um `safelist`.
// =============================================================
