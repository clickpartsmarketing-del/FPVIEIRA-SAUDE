# FRENTE 4 — PATCHES DE FRONTEND (propostas, nada aplicado)

> Nenhum componente existente foi editado. Tudo aqui é **diff proposto**.
> Ordem de aplicação e riscos no fim do arquivo.

Índice:
- [A. Fotos privadas (ALTO)](#a)
- [B. Dados pessoais no bundle (ALTO)](#b)
- [C. Erros de gravação ignorados — lista completa](#c)
- [D. Offline / PWA (MÉDIO)](#d)
- [E. Qualidade: testes, CI, lockfile (ALTO)](#e)
- [Ordem, risco e rollback](#f)

---

<a id="a"></a>
## A. FOTOS PRIVADAS

Depende do `seguranca/09-fotos-privadas.sql` — **ETAPA 1 do SQL primeiro,
este código depois, ETAPA 2 do SQL por último.**

### A.0 A decisão que sustenta o resto

`getPublicUrl()` não faz requisição: é montagem de string. Com o bucket
fechado ela continua devolvendo uma URL — que dá 400. Trocar por
`createSignedUrl()` resolve, **mas URL assinada expira**. Então:

- a **fonte da verdade** passa a ser o **caminho** do objeto
  (`os/1720000000_ab12cd.jpg`), gravado em `os_campo.foto_paths`;
- a URL de exibição é assinada **na hora de renderizar** e descartada;
- `foto_urls` **não é apagada nem reescrita** — fica congelada como
  histórico da fase pública e como rede de segurança do rollback.

Assinatura funciona em bucket público **também**. Por isso dá para
subir este código com o bucket ainda aberto e conferir no celular antes
de fechar. É o que torna a mudança reversível.

### A.1 ARQUIVO NOVO — `services/fotoService.ts`

```ts
import { supabase } from './supabaseClient';

const BUCKET = 'fotos-os';
const VALIDADE_S = 60 * 60;            // 1h — cobre a sessão de campo
const RENOVA_ANTES_MS = 5 * 60 * 1000; // renova 5 min antes de vencer

// cache em memória: evita reassinar a mesma foto a cada re-render da lista
const cache = new Map<string, { url: string; expEm: number }>();

/**
 * URL pública/assinada -> caminho do objeto.
 * Devolve null para link EXTERNO (Drive, WhatsApp, n8n): esse a gente
 * exibe como veio, não é nosso para assinar.
 * Espelha public.fpv_path_da_foto() do 09-fotos-privadas.sql — se mudar
 * um, mude o outro (há teste cobrindo isto).
 */
export const pathDaFoto = (u: string): string | null => {
  const s = (u || '').trim();
  if (!s) return null;
  const pub = `/storage/v1/object/public/${BUCKET}/`;
  const sig = `/storage/v1/object/sign/${BUCKET}/`;
  if (s.includes(pub)) return s.split(pub)[1].split('?')[0];
  if (s.includes(sig)) return s.split(sig)[1].split('?')[0];
  if (/^https?:/i.test(s)) return null;   // externa: preservar
  return s.split('?')[0];                 // já é caminho cru
};

/**
 * Recebe o que está gravado no banco (URLs antigas E/OU caminhos novos,
 * misturados) e devolve URLs exibíveis, NA MESMA ORDEM.
 * Foto que falhar ao assinar vira '' — quem chama decide o que mostrar.
 */
export async function urlsExibiveis(entradas: string[]): Promise<string[]> {
  const itens = (entradas || []).filter(Boolean);
  if (itens.length === 0) return [];

  const agora = Date.now();
  const saida: string[] = new Array(itens.length).fill('');
  const aAssinar: string[] = [];
  const ondeVai = new Map<string, number[]>();

  itens.forEach((it, i) => {
    const p = pathDaFoto(it);
    if (!p) { saida[i] = it; return; }              // externa: passa direto
    const hit = cache.get(p);
    if (hit && hit.expEm > agora + RENOVA_ANTES_MS) { saida[i] = hit.url; return; }
    if (!ondeVai.has(p)) { ondeVai.set(p, []); aAssinar.push(p); }
    ondeVai.get(p)!.push(i);
  });

  if (aAssinar.length === 0) return saida;

  // createSignedUrls (plural): 1 requisição para o lote inteiro.
  const { data, error } = await supabase.storage
    .from(BUCKET).createSignedUrls(aAssinar, VALIDADE_S);

  if (error) {
    console.error('Falha ao assinar fotos:', error.message);
    return saida; // posições sem assinatura ficam '' — a tela avisa
  }
  for (const r of data || []) {
    const p = (r as any).path as string;
    const url = (r as any).signedUrl as string | null;
    if (!p || !url) continue;
    cache.set(p, { url, expEm: agora + VALIDADE_S * 1000 });
    for (const i of ondeVai.get(p) || []) saida[i] = url;
  }
  return saida;
}

/** Uma foto só (NF do almoxarifado, etc.) */
export const urlExibivel = async (u: string): Promise<string> =>
  (await urlsExibiveis([u]))[0] || '';

/** Hook para as telas: assina ao montar e quando a lista mudar. */
export function useFotos(entradas: string[] | undefined) {
  const chave = (entradas || []).join('|');
  const [urls, setUrls] = React.useState<string[]>([]);
  React.useEffect(() => {
    let vivo = true;
    if (!entradas || entradas.length === 0) { setUrls([]); return; }
    urlsExibiveis(entradas).then(u => { if (vivo) setUrls(u); });
    return () => { vivo = false; };
  }, [chave]);
  return urls;
}
```

> `useFotos` precisa de `import React from 'react';` no topo do arquivo.

### A.2 PATCH — `services/osService.ts` (linhas 228-252)

O upload passa a devolver **o caminho**, não a URL pública.

```diff
-  async uploadFoto(file: File): Promise<string | null> {
+  // v73: devolve o CAMINHO do objeto (os/…​.jpg), não mais a URL pública.
+  // URL de exibição é assinada na hora pelo fotoService — bucket privado.
+  async uploadFoto(file: File): Promise<string | null> {
     try {
       const ext = file.name.split('.').pop() || 'jpg';
       const path = `os/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
       const { error } = await supabase.storage.from('fotos-os').upload(path, file);
       if (error) throw error;
-      const { data } = supabase.storage.from('fotos-os').getPublicUrl(path);
-      return data.publicUrl;
+      return path;
     } catch (e: any) {
       console.error('Erro no upload da foto:', e.message);
       return null;
     }
   },
```

`uploadFotos` não muda: continua devolvendo `{ urls, falhas }` — só que
agora `urls` carrega caminhos. **Renomear para `caminhos` fica para
depois**; renomear campo em 4 chamadores no meio da medição é risco à toa.

Também é preciso gravar em `foto_paths` além de `foto_urls`, para que O.S.
nova e O.S. antiga leiam pelo mesmo lugar. Em `osService.salvar`, logo no
início:

```diff
   async salvar(os: OSCampo): Promise<{ ok: boolean; erro?: string; os?: OSCampo }> {
     const payload = { ...os };
     delete (payload as any).id;
     delete (payload as any).criado_em;
+    // v73: espelha foto_urls em foto_paths (coluna nova). Se o banco
+    // ainda não tem a coluna, a cadeia de resiliência abaixo remove.
+    if (Array.isArray(payload.foto_urls) && !(payload as any).foto_paths) {
+      (payload as any).foto_paths = payload.foto_urls;
+    }
```

e mais um elo na cadeia de resiliência já existente (depois da linha 92):

```diff
+    // sem 'foto_paths' (09-fotos-privadas.sql pendente) → tira e re-insere
+    if (error && /foto_paths/i.test(error.message)) {
+      delete base.foto_paths;
+      ({ data, error } = await supabase.from('os_campo').insert([base]).select().single());
+    }
```

### A.3 PATCH — `components/ListaOS.tsx` linhas 535-540 (links das fotos)

```diff
+// no topo do arquivo:
+import { useFotos } from '../services/fotoService';
+
+// componente pequeno, fora do corpo do ListaOS:
+const LinksDeFoto: React.FC<{ fontes: string[] }> = ({ fontes }) => {
+  const urls = useFotos(fontes);
+  if (urls.length === 0) return <span className="text-[11px] text-stone-400">carregando fotos…</span>;
+  return <>{urls.map((u, i) => u
+    ? <a key={i} href={u} target="_blank" rel="noreferrer" className="text-fpv-700 font-bold underline">📷 foto {i + 1}</a>
+    : <span key={i} className="text-[11px] text-amber-700 font-bold">📷 foto {i + 1} indisponível</span>
+  )}</>;
+};
```

```diff
   {os.foto_urls?.length > 0 && (
     <div ...>
-      {os.foto_urls.map((u, i) => (
-        <a key={i} href={u} target="_blank" rel="noreferrer" className="text-fpv-700 font-bold underline">📷 foto {i + 1}</a>
-      ))}
+      <LinksDeFoto fontes={(os as any).foto_paths?.length ? (os as any).foto_paths : os.foto_urls} />
     </div>
   )}
```

> O padrão `foto_paths?.length ? foto_paths : foto_urls` é o que permite
> rodar com o SQL aplicado ou não. Mantenha até o backfill estar 100%.

### A.4 PATCH — `components/FechamentoSemanal.tsx` linhas 114-120

Esta é a folha de assinatura **impressa**: aqui as imagens são `<img>`,
não link. Cuidado extra — imprimir antes de assinar termina em folha com
retângulo vazio.

```diff
+import { useFotos } from '../services/fotoService';
+
+const GradeFotos: React.FC<{ fontes: string[] }> = ({ fontes }) => {
+  const urls = useFotos(fontes);
+  const prontas = urls.filter(Boolean);
+  if (prontas.length === 0) {
+    return <div className="text-xs font-bold text-amber-700 print-hidden">
+      Carregando as fotos… NÃO IMPRIMA ainda.</div>;
+  }
+  return <>{prontas.slice(0, 7).map((u, i) => (
+    <img key={i} src={u} alt={`foto ${i + 1}`}
+         className="w-full h-28 object-cover rounded-lg border border-stone-200" />
+  ))}</>;
+};
```

```diff
   {os.foto_urls?.length > 0 && (
     <div ...>
       <div className="text-[11px] font-bold uppercase text-stone-400 mb-2">Evidências fotográficas</div>
       <div ...>
-        {os.foto_urls.slice(0, 7).map((u, i) => (
-          <img key={i} src={u} alt={`foto ${i + 1}`} className="w-full h-28 object-cover rounded-lg border border-stone-200" />
-        ))}
+        <GradeFotos fontes={(os as any).foto_paths?.length ? (os as any).foto_paths : os.foto_urls} />
       </div>
     </div>
   )}
```

### A.5 `types.ts`

```diff
   foto_urls: string[];
+  foto_paths?: string[];   // v73: caminho no bucket; foto_urls vira histórico
```

---

<a id="b"></a>
## B. DADOS PESSOAIS NO BUNDLE PÚBLICO

### B.0 O que está exposto hoje, literalmente

`config.ts` vai inteiro para o JS servido em `fpvieira.vercel.app`.
Qualquer pessoa, sem login, com "ver código-fonte":

| dado | onde | por que importa |
|---|---|---|
| 4 WhatsApp de funcionários | `DESIGNADOS[].zap` (linhas 72-75) | **é o pior item.** Número pessoal de operário publicado na internet. LGPD (dado pessoal, sem base legal para publicação) + alvo pronto para golpe: "aqui é da FPV, me passa o código" |
| nome + e-mail + função de 11 pessoas | `ACESSOS` (50-62) | mapa da organização servido de graça: quem é gestão, quem é campo, quem faz medição |
| estrutura interna | `EQUIPES`, `CORRETIVA`, comentários | fiscais da prefeitura pelo nome, zonas, quem substituiu quem |
| a lista de contas | `LoginScreen` renderiza tudo | e a linha 116 ainda imprime o e-mail **na tela** |

### B.1 A verdade desconfortável sobre a tela de login

**Qualquer coisa mostrada antes do login é pública. Por definição.** Não
existe "lista de nomes visível só para quem é da empresa" numa tela que
existe justamente para quem ainda não provou ser da empresa. Carregar do
banco não esconde: só troca "está no bundle" por "está numa API aberta".

Então a pergunta certa não é *"como escondo a lista?"* e sim
*"o que dessa lista eu realmente preciso mostrar?"*.

E a resposta é: **o rótulo e o emoji. Só.** O resto — e-mail, telefone,
função, zona — é o que dá valor ao vazamento, e nada disso é necessário
para o operário tocar no próprio nome.

### B.2 Trade-off de UX — as três opções, com o custo real

O login de 2 toques foi decisão consciente do Renan depois de "muita
recusa" (LIÇÃO #2). O público é operário com pouca familiaridade digital.
**Qualquer proposta que devolva o teclado para essa pessoa é regressão**,
e regressão de adoção custa mais caro do que o risco que ela remove.

| opção | 2 toques? | o que remove | custo |
|---|---|---|---|
| **1. Só digitar e-mail** | ❌ | tudo | inaceitável: reintroduz a LIÇÃO #2. **Descartada** |
| **2. Lista só depois do login** | ❌ | tudo | contradição lógica: a lista serve para logar. **Descartada** |
| **3. Lista mínima, do banco** ✅ | ✅ | telefones, e-mails, funções, zonas | uma consulta anônima no boot; dispositivo novo+offline cai no digitar e-mail |

**Recomendação: opção 3.** Mantém os 2 toques intactos, tira do ar tudo
que tem valor para um atacante, e ainda resolve um incômodo operacional:
hoje adicionar um usuário exige editar `config.ts` + commit + deploy.
Passa a ser uma linha no banco.

Ganho colateral importante: como a lista de contas é semi-pública por
construção, **a defesa real é a FRENTE 1** — RLS por papel. Com RLS
correta, saber que existe `joao@fpv.app` não vale nada.

### B.3 SQL — colunas de tela + view pública mínima

> **Conferido contra o `01-papeis.sql` da FRENTE 1**, que já criou
> `app_usuario` com chave `email` e as colunas `nome, papel, executores,
> fiscais, pode_priorizar, pode_financeiro, ativo`. Falta só o que é de
> **apresentação** (emoji, ordem) e o telefone. Tudo aditivo.

Sugestão de nome do arquivo: `seguranca/11-diretorio-login.sql`.

```sql
-- 1) Colunas novas — aditivas, não mexem em nada que a FRENTE 1 fez
alter table app_usuario add column if not exists emoji            text;
alter table app_usuario add column if not exists ordem            int  not null default 100;
alter table app_usuario add column if not exists aparece_no_login boolean not null default true;
alter table app_usuario add column if not exists whatsapp         text;

comment on column app_usuario.whatsapp is
  'DDI+DDD, só dígitos. Saiu do config.ts (bundle público) na auditoria de 28/07. '
  'Protegido pela RLS app_usuario_select: cada um vê a sua linha, gestão vê todas.';

-- 2) Emoji e ordem dos usuários reais (espelha o ACESSOS do config.ts)
update app_usuario set emoji = '🚨', ordem = 10 where email = 'emergencia1@fpv.app';
update app_usuario set emoji = '🚨', ordem = 11 where email = 'emergencia2@fpv.app';
update app_usuario set emoji = '🔧', ordem = 20 where email = 'gilson@fpv.app';
update app_usuario set emoji = '🔧', ordem = 21 where email = 'carlosalberto@fpv.app';
update app_usuario set emoji = '📦', ordem = 30 where email = 'joao@fpv.app';
update app_usuario set emoji = '👷', ordem = 40 where email = 'nicolas@fpv.app';
update app_usuario set emoji = '📊', ordem = 41 where email = 'renan@fpv.app';
update app_usuario set emoji = '📊', ordem = 42 where email = 'lucas@fpv.app';
update app_usuario set emoji = '📊', ordem = 43 where email = 'rafael@fpv.app';
update app_usuario set emoji = '📐', ordem = 44 where email = 'edmar@fpv.app';
update app_usuario set emoji = '📋', ordem = 45 where email = 'brendah@fpv.app';

-- 3) TELEFONES — resgatados do config.ts ANTES de apagá-los de lá.
--    Estes 4 números só existem no arquivo versionado; se você aplicar
--    o patch B.4 sem rodar isto, eles se perdem do sistema vivo.
update app_usuario set whatsapp = '5522998952800' where email = 'gilson@fpv.app';
update app_usuario set whatsapp = '5522998294178' where email = 'carlosalberto@fpv.app';
update app_usuario set whatsapp = '5522992455522' where email = 'emergencia1@fpv.app'; -- Eq. Leandro
update app_usuario set whatsapp = '5522998888452' where email = 'emergencia2@fpv.app'; -- Eq. Renato

-- 4) A VIEW da tela de login. O MÍNIMO ABSOLUTO: rótulo, emoji, grupo.
--    Sem e-mail, sem telefone, sem papel, sem zona. O app deriva o
--    e-mail do slug (todos são <slug>@fpv.app).
create or replace view public.app_usuario_login
with (security_invoker = false) as
  select
    split_part(email, '@', 1)                             as slug,
    nome                                                  as rotulo,
    coalesce(emoji, '👤')                                 as emoji,
    case when papel = 'campo' then 'campo' else 'gestao' end as grupo,
    ordem
  from public.app_usuario
  where ativo and aparece_no_login;

-- security_invoker = false é DELIBERADO e é o ponto delicado deste
-- arquivo: a view roda com os direitos do dono, então NÃO passa pela
-- RLS de app_usuario — é o que permite o anon (pré-login) enxergar a
-- lista. Por isso a view só pode expor colunas que a gente aceita
-- publicar. NUNCA acrescente email, whatsapp, papel, fiscais ou
-- executores aqui: seria republicar exatamente o que este patch tirou
-- do bundle. Se precisar de mais dado, leia de app_usuario DEPOIS do
-- login, onde a RLS vale.
grant select on public.app_usuario_login to anon, authenticated;

-- 5) Conferência
select slug, rotulo, emoji, grupo, ordem from public.app_usuario_login order by ordem;
select count(*) filter (where whatsapp is not null) as com_zap from app_usuario;

-- ROLLBACK:
--   drop view if exists public.app_usuario_login;
--   alter table app_usuario drop column if exists emoji;
--   alter table app_usuario drop column if exists ordem;
--   alter table app_usuario drop column if exists aparece_no_login;
--   alter table app_usuario drop column if exists whatsapp;
```

> Se a FRENTE 1 ainda não tiver sido aplicada, a consulta falha e a tela
> cai no cache do `localStorage`; sem cache, no e-mail digitado. Ninguém
> fica trancado para fora — mas **não aplique o B.4 antes do B.3**, senão
> os telefones somem sem destino.

### B.4 PATCH — `config.ts`

```diff
-export const ACESSOS: Acesso[] = [ ...11 nomes com e-mail e função... ];
+// v73: a lista de login saiu do bundle. Vem de public.app_usuario_login
+// (só rótulo/emoji/grupo — sem e-mail, sem telefone, sem função).
+// Adicionar usuário agora é INSERT no banco, não deploy.
+export const DOMINIO_LOGIN = '@fpv.app';
+export interface AcessoPublico { slug: string; rotulo: string; emoji: string; grupo: 'campo' | 'gestao'; }

-export const DESIGNADOS: Designado[] = [
-  { rotulo: 'Gilson', executor: 'Gilson', zap: '5522998952800' },
-  { rotulo: 'Carlos Alberto', executor: 'Carlos Alberto', zap: '5522998294178' },
-  { rotulo: 'Eq. Leandro', executor: 'Leandro', zap: '5522992455522' },
-  { rotulo: 'Eq. Renato', executor: 'Renato', zap: '5522998888452' },
-];
+// v73: TELEFONE SAIU DO BUNDLE (LGPD). Os números moram em
+// app_usuario.whatsapp, com RLS que só libera para gestor, e são
+// carregados DEPOIS do login. O botão "📲 Avisar" já esconde sozinho
+// quando o zap vem vazio — então em sessão sem permissão ele some, que
+// é exatamente o comportamento desejado.
+export const DESIGNADOS: Designado[] = [
+  { rotulo: 'Gilson',         executor: 'Gilson',         zap: '' },
+  { rotulo: 'Carlos Alberto', executor: 'Carlos Alberto', zap: '' },
+  { rotulo: 'Eq. Leandro',    executor: 'Leandro',        zap: '' },
+  { rotulo: 'Eq. Renato',     executor: 'Renato',         zap: '' },
+];
```

⚠️ **Rode o passo 3 do B.3 antes deste patch.** Os 4 números só existem
neste arquivo; removê-los sem gravar no banco perde o dado.

> `GESTORES`/`ALMOX`/`EQUIPES`/`CORRETIVA` **ficam onde estão nesta fase.**
> São regra de UI, não segredo — e com a RLS da FRENTE 1 no lugar, mentir
> sobre o próprio papel no frontend não dá acesso a nada. Migrar papel
> para o banco é passo seguinte, não deste patch.

### B.5 ARQUIVO NOVO — `services/diretorioService.ts`

```ts
import { supabase } from './supabaseClient';
import { AcessoPublico, DOMINIO_LOGIN } from '../config';

const CACHE_KEY = 'fpv_roster_v1';

/** Lista da tela de login. Ordem de tentativa: banco → cache → vazio. */
export async function carregarAcessos(): Promise<AcessoPublico[]> {
  try {
    const { data, error } = await supabase
      .from('app_usuario_login')
      .select('slug,rotulo,emoji,grupo')
      .order('ordem');
    if (!error && data && data.length) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
      return data as AcessoPublico[];
    }
    if (error) console.warn('Roster do banco falhou, usando cache:', error.message);
  } catch { /* offline */ }
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw) as AcessoPublico[];
  } catch {}
  return [];
}

export const emailDoSlug = (slug: string) => `${slug}${DOMINIO_LOGIN}`;

/**
 * Diretório COMPLETO (com whatsapp) — só DEPOIS de autenticado.
 * A RLS `app_usuario_select` (FRENTE 1) faz o corte sozinha: gestão
 * recebe todas as linhas, os demais recebem só a própria. Não há
 * filtro de papel aqui no frontend de propósito — quem decide quem vê
 * telefone é o banco, não a tela.
 */
export type UsuarioDir = {
  email: string; nome: string; executores: string[]; whatsapp: string | null;
};
export async function carregarDiretorio(): Promise<UsuarioDir[]> {
  const { data, error } = await supabase
    .from('app_usuario').select('email,nome,executores,whatsapp');
  if (error) { console.warn('Diretório indisponível:', error.message); return []; }
  return (data || []) as UsuarioDir[];
}
```

### B.6 `components/LoginScreen.tsx` — CÓDIGO NOVO COMPLETO

Mudanças em relação ao atual: lista vem do banco (com cache), **sem
e-mail em lugar nenhum** (nem no bundle, nem na tela, nem no DOM), **sem
as dicas de função/zona**, e um estado de carregamento que **nunca deixa
o usuário preso** — se em 2,5 s a lista não veio, cai sozinho no campo de
e-mail. Os 2 toques e a memória do último login continuam idênticos.

```tsx
import React, { useEffect, useState } from 'react';
import { User, Lock, ArrowRight, Loader2, HardHat, Eye, EyeOff } from 'lucide-react';
import { supabase, configOk } from '../services/supabaseClient';
import { AcessoPublico } from '../config';
import { carregarAcessos, emailDoSlug } from '../services/diretorioService';

// =============================================================
// LOGIN EM 2 TOQUES (pedido Renan 07/07) — PRESERVADO.
// v73 (auditoria): a lista de nomes saiu do bundle e veio do banco,
// e ficou com o MÍNIMO: rótulo + emoji. Sem e-mail (é derivado do
// slug na hora do submit), sem telefone, sem função/zona.
// Nada mudou para quem usa: toca no nome, digita a senha, entra.
// =============================================================

const ULTIMO_KEY = 'fpv_ultimo_login';   // guarda SLUG, não e-mail

const LoginScreen: React.FC = () => {
  const [acessos, setAcessos] = useState<AcessoPublico[]>([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [quem, setQuem] = useState<AcessoPublico | null>(null);
  const [manual, setManual] = useState(false);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  // lista + memória do último login
  useEffect(() => {
    let vivo = true;
    // rede ruim na escola não pode deixar a tela em "carregando" eterno
    const desistir = setTimeout(() => { if (vivo) setCarregandoLista(false); }, 2500);
    carregarAcessos().then(lista => {
      if (!vivo) return;
      clearTimeout(desistir);
      setAcessos(lista);
      setCarregandoLista(false);
      try {
        const slug = localStorage.getItem(ULTIMO_KEY);
        const achado = slug ? lista.find(a => a.slug === slug) : null;
        if (achado) setQuem(achado);           // volta direto para a senha
      } catch { /* sem storage, sem lembrança */ }
    });
    return () => { vivo = false; clearTimeout(desistir); };
  }, []);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    setCarregando(true);
    // trim + minúsculas: teclado de celular adora Maiúscula inicial e
    // espaço no fim — era a "recusa" mais comum (LIÇÃO #2)
    const mail = (quem ? emailDoSlug(quem.slug) : email).trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: mail, password: senha.trim() });
    if (error) {
      setErro(error.message === 'Invalid login credentials'
        ? 'Senha incorreta. Toque no 👁 para conferir o que digitou.'
        : 'Erro de conexão: ' + error.message);
      setCarregando(false);
      return;
    }
    try { if (quem) localStorage.setItem(ULTIMO_KEY, quem.slug); } catch {}
  };

  const escolher = (a: AcessoPublico) => { setQuem(a); setManual(false); setErro(''); setSenha(''); };

  const campo  = acessos.filter(a => a.grupo === 'campo');
  const gestao = acessos.filter(a => a.grupo === 'gestao');
  // lista vazia (1º acesso do aparelho sem sinal, ou SQL da FRENTE 1
  // ainda não aplicado): não trava ninguém — vai direto para o e-mail
  const semLista = !carregandoLista && acessos.length === 0;
  const mostrarManual = manual || semLista;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-fpv-500 text-fpv-50 flex items-center justify-center font-bold">FPV</div>
          <div>
            <h1 className="font-bold text-lg text-stone-900 leading-tight">FPV Campo</h1>
            <p className="text-xs text-stone-500">F.P. Vieira Engenharia · FP.094</p>
          </div>
        </div>

        {!configOk && (
          <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-medium">
            ⚠️ Este deploy está SEM as variáveis <b>VITE_SUPABASE_URL</b> / <b>VITE_SUPABASE_ANON_KEY</b>.
            Configure na Vercel (Settings → Environment Variables) e faça <b>Redeploy</b>.
          </div>
        )}

        {/* ===== PASSO 1: quem é você (sem digitar e-mail) ===== */}
        {!quem && !mostrarManual && (
          <div className="space-y-2">
            <p className="font-bold text-stone-700 text-center pb-1">Toque no seu nome para entrar 👇</p>

            {carregandoLista && (
              <div className="space-y-2" aria-hidden>
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-full h-[56px] bg-stone-100 rounded-2xl animate-pulse" />
                ))}
              </div>
            )}

            {campo.map(a => (
              <button key={a.slug} onClick={() => escolher(a)}
                className="w-full min-h-[56px] bg-stone-50 hover:bg-fpv-50 border-2 border-stone-200 hover:border-fpv-300 rounded-2xl px-4 flex items-center gap-3 text-left">
                <span className="text-2xl">{a.emoji}</span>
                <span className="flex-1 font-bold text-stone-900">{a.rotulo}</span>
                <ArrowRight size={16} className="text-stone-300" />
              </button>
            ))}

            {gestao.length > 0 && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {gestao.map(a => (
                  <button key={a.slug} onClick={() => escolher(a)}
                    className="min-h-[48px] bg-white hover:bg-stone-50 border border-stone-200 rounded-xl px-3 flex items-center gap-2 text-left">
                    <span>{a.emoji}</span>
                    <span className="text-sm font-bold text-stone-700 truncate">{a.rotulo}</span>
                  </button>
                ))}
              </div>
            )}

            <button onClick={() => { setManual(true); setErro(''); }}
              className="w-full text-[11px] text-stone-400 underline pt-2">
              Entrar com outro e-mail
            </button>
          </div>
        )}

        {/* ===== PASSO 2: só a senha ===== */}
        {quem && !manual && (
          <form onSubmit={entrar} className="space-y-4">
            <div className="bg-fpv-50 border border-fpv-100 rounded-2xl px-4 py-3 flex items-center gap-3">
              <span className="text-2xl">{quem.emoji}</span>
              {/* v73: o e-mail NÃO é mais impresso na tela. O nome basta
                  para a pessoa confirmar que escolheu a si mesma. */}
              <div className="flex-1 font-bold text-fpv-900 leading-tight">{quem.rotulo}</div>
              <button type="button" onClick={() => { setQuem(null); setSenha(''); setErro(''); }}
                className="text-[11px] font-bold text-fpv-700 underline shrink-0">trocar</button>
            </div>
            {/* e-mail invisível: deixa o gerenciador de senhas achar a senha certa */}
            <input type="email" name="username" autoComplete="username"
                   value={emailDoSlug(quem.slug)} readOnly className="hidden" tabIndex={-1} />
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
              <input
                type={verSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)} required autoFocus
                placeholder="digite a senha"
                autoComplete="current-password" name="password" autoCapitalize="none"
                className="w-full pl-10 pr-12 py-4 bg-stone-50 border-2 border-stone-200 rounded-xl outline-none focus:border-fpv-500 text-base font-medium"
              />
              <button type="button" onClick={() => setVerSenha(v => !v)} tabIndex={-1}
                title={verSenha ? 'Esconder a senha' : 'Ver a senha'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-fpv-600">
                {verSenha ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>

            {erro && <div className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</div>}

            <button type="submit" disabled={carregando}
              className="w-full bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60 text-base">
              {carregando ? <Loader2 size={18} className="animate-spin" /> : <><HardHat size={18} /> Entrar <ArrowRight size={16} /></>}
            </button>
            <p className="text-[11px] text-stone-400 text-center">Depois de entrar, você continua conectado — não precisa logar toda vez.</p>
          </form>
        )}

        {/* ===== fallback: e-mail digitado ===== */}
        {mostrarManual && !quem && (
          <form onSubmit={entrar} className="space-y-4">
            {semLista && (
              <p className="text-[11px] text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                Sem internet para carregar a lista de nomes. Digite seu e-mail desta vez —
                na próxima, com sinal, o seu nome volta a aparecer.
              </p>
            )}
            <div className="relative">
              <User className="absolute left-3 top-3.5 text-stone-400" size={18} />
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                placeholder="seu e-mail de acesso"
                autoComplete="username" name="username" inputMode="email" autoCapitalize="none"
                className="w-full pl-10 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-fpv-500 focus:ring-2 focus:ring-fpv-100 text-sm font-medium"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3.5 text-stone-400" size={18} />
              <input
                type={verSenha ? 'text' : 'password'} value={senha} onChange={e => setSenha(e.target.value)} required
                placeholder="senha"
                autoComplete="current-password" name="password" autoCapitalize="none"
                className="w-full pl-10 pr-12 py-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-fpv-500 focus:ring-2 focus:ring-fpv-100 text-sm font-medium"
              />
              <button type="button" onClick={() => setVerSenha(v => !v)} tabIndex={-1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-stone-400 hover:text-fpv-600">
                {verSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {erro && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{erro}</div>}

            <button type="submit" disabled={carregando}
              className="w-full bg-fpv-500 hover:bg-fpv-600 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
              {carregando ? <Loader2 size={18} className="animate-spin" /> : <><HardHat size={18} /> Entrar <ArrowRight size={16} /></>}
            </button>
            {!semLista && (
              <button type="button" onClick={() => { setManual(false); setErro(''); }}
                className="w-full text-[11px] text-stone-400 underline">
                ← Voltar para a lista de nomes
              </button>
            )}
          </form>
        )}

        <p className="text-[11px] text-stone-400 mt-6 text-center">
          Acesso criado pela engenharia. Problemas? Fale com o Renan/Nicolas.
        </p>
        <a href="/treinamento/" className="block text-center text-xs font-bold text-fpv-700 mt-2 underline">
          📚 Treinamento — aprenda a usar o app
        </a>
      </div>
    </div>
  );
};

export default LoginScreen;
```

### B.7 Onde o WhatsApp é consumido

`DESIGNADOS[].zap` alimenta o botão "📲 Avisar" (Gestão/Lista). Com `zap`
vazio o botão já se esconde sozinho — comportamento existente. Para
reativá-lo, quem monta os designados passa a mesclar com o diretório
carregado após o login:

```ts
const [dir, setDir] = useState<UsuarioDir[]>([]);
useEffect(() => { carregarDiretorio().then(setDir); }, []);

// app_usuario.executores é text[] (um login de equipe cobre vários
// executores: emergencia1 = ['Wellington','Leandro'])
const designados = DESIGNADOS.map(d => ({
  ...d,
  zap: dir.find(u => (u.executores || []).includes(d.executor))?.whatsapp || '',
}));
```

Não-gestor simplesmente **não recebe as linhas dos colegas** (RLS da
FRENTE 1) → `zap` vazio → o botão "📲 Avisar" some sozinho, sem nenhum
`if` novo na tela. É o resultado correto: quem não coordena não precisa
do celular do colega.

---

<a id="c"></a>
## C. GRAVAÇÕES QUE IGNORAM O ERRO — varredura completa

Critério: chamada `supabase` cujo `error` não é destruturado, ou é
destruturado e nunca lido. **19 ocorrências.** Ordenado por dano real.

### 🔴 CRÍTICO — perda silenciosa de evidência ou de dinheiro

| # | arquivo:linha | o que acontece quando falha |
|---|---|---|
| C1 | `components/ListaOS.tsx:152-153` | `oficializar()`: se o UPDATE da oficial (152) falhar e o da fictícia (153) passar, a fictícia é **cancelada sem a oficial ter herdado foto/memória**. Evidência de medição some e ninguém é avisado. |
| C2 | `components/ListaOS.tsx:284-285` | `vincularNumero()` na fusão: idêntico ao C1. |
| C3 | `components/ListaOS.tsx:130-132` | `rechavearMaterial()`: erro descartado ⇒ `data` vem `null` ⇒ retorna `0` ⇒ **o alerta de migração não aparece** e o operador conclui que não havia material. É exatamente a origem das **168 saídas órfãs** da auditoria de 24/07 — o bug voltou disfarçado. |
| C4 | `components/AlmoxOS.tsx:510` | `if (!error) await ...update({status:'SEPARADO'})`: as saídas foram gravadas, o pedido **continua PENDENTE**. João gera de novo ⇒ **material baixado em dobro** no estoque. |
| C5 | `components/AlmoxOS.tsx:556` | `excluirSaida()`: DELETE descartado. Falhou = "sumiu da tela" pelo `carregar()`… até o próximo refresh. **Saldo de estoque errado.** |
| C6 | `components/ListaOS.tsx:296` | `await osService.salvar({...os, numero: n})` descarta `{ok, erro}`. Se o número colidir, o app **rechaveia material para um nº que não foi gravado.** |

**Patch C1/C2 — a forma certa (e o gancho da FRENTE 3):**

```diff
-    await supabase.from('os_campo').update(upd).eq('id', o.id);
-    await supabase.from('os_campo').update({ excluida: true, status: 'Cancelada', par_sugerido: String(o.numero) }).eq('id', f.id);
+    // ORDEM IMPORTA: a herança PRIMEIRO. Se ela falhar, a fictícia NÃO
+    // pode ser cancelada — senão a evidência morre com ela.
+    const r1 = await supabase.from('os_campo').update(upd).eq('id', o.id);
+    if (r1.error) {
+      alert(`❌ NÃO consegui passar foto/memória para a ${o.numero}: ${r1.error.message}\n\nNada foi alterado — a ${refDaOS(f)} continua como está. Tente de novo.`);
+      return;
+    }
+    const r2 = await supabase.from('os_campo')
+      .update({ excluida: true, status: 'Cancelada', par_sugerido: String(o.numero) }).eq('id', f.id);
+    if (r2.error) {
+      alert(`⚠️ A ${o.numero} JÁ recebeu foto e memória, mas a ${refDaOS(f)} não foi cancelada: ${r2.error.message}\n\nAs DUAS aparecem na lista. Avise a gestão para cancelar a ${refDaOS(f)} na mão — não repita a operação.`);
+      aoMudar();
+      return;
+    }
```

> Isto é mitigação, não transação. O conserto definitivo é a função
> `fpv_oficializar_os(...)` da **FRENTE 3** (as duas escritas num
> `BEGIN…COMMIT` do lado do banco). Este patch é o que dá para fazer hoje
> sem esperar a FRENTE 3, e já elimina o caso destrutivo.

**Patch C3:**

```diff
-    const { data } = await supabase.from('saida_material')
-      .update({ os_ref: para }).eq('os_ref', de).select('id');
-    await supabase.from('solicitacao_material').update({ os_ref: para }).eq('os_ref', de);
-    return (data || []).length;
+    const { data, error } = await supabase.from('saida_material')
+      .update({ os_ref: para }).eq('os_ref', de).select('id');
+    if (error) {
+      alert(`⚠️ O material lançado na ${de} NÃO migrou para a ${para}: ${error.message}\n\nO custo pode ficar fora da medição — avise a gestão.`);
+      return -1;   // -1 = falhou (diferente de 0 = não havia material)
+    }
+    const rs = await supabase.from('solicitacao_material').update({ os_ref: para }).eq('os_ref', de);
+    if (rs.error) console.error('Pedido de balcão não migrou:', rs.error.message);
+    return (data || []).length;
```

…e nos 3 pontos de chamada, tratar `-1` (`if (migrou > 0)` já não dispara
o alerta enganoso; acrescente `else if (migrou < 0) { /* já alertado */ }`).

**Patch C4:**

```diff
-    if (!error) await supabase.from('solicitacao_material').update({ status: 'SEPARADO' }).eq('id', q.id);
+    if (!error) {
+      const rp = await supabase.from('solicitacao_material').update({ status: 'SEPARADO' }).eq('id', q.id);
+      if (rp.error) {
+        setMsg(`⚠️ As ${itens.length} saída(s) FORAM gravadas, mas o pedido #${q.id} continua PENDENTE (${rp.error.message}).\n` +
+               `NÃO gere de novo — o material sairia em dobro. Marque como SEPARADO na mão.`);
+        gerandoRef.current = false; setSalvando(false); carregar(); return;
+      }
+    }
```

**Patch C5:**

```diff
-    await supabase.from('saida_material').delete().eq('id', s.id); carregar();
+    const { error } = await supabase.from('saida_material').delete().eq('id', s.id);
+    if (error) { setMsg('❌ NÃO consegui excluir esta saída: ' + error.message + ' — o saldo NÃO mudou.'); return; }
+    setMsg('🗑 Saída excluída — saldo recalculado.');
+    carregar();
```

**Patch C6:**

```diff
-    await osService.salvar({ ...os, numero: n });
+    const r = await osService.salvar({ ...os, numero: n });
+    if (!r.ok) { alert(`❌ Não consegui gravar o nº ${n}: ${r.erro}\n\nNada foi alterado.`); return; }
```

### 🟠 ALTO — o usuário acha que fez, e não fez

| # | arquivo:linha | efeito |
|---|---|---|
| C7 | `components/PainelEquipe.tsx:111` | `confirmarRecebido()`: equipe toca "RECEBI", falha, item **volta como pendente sem explicação**. Adoção morre por aí. |
| C8 | `components/PainelEquipe.tsx:115` | `confirmarRetirada()`: idem. |
| C9 | `components/AlmoxOS.tsx:593` | `confirmarRecebidoManual()`: idem, do lado do João. |
| C10 | `components/AlmoxOS.tsx:466` | `marcarSeparado()`: pedido não muda de status, sem aviso. |
| C11 | `components/AlmoxOS.tsx:387-390` | `entregarFerr()`: ferramenta "entregue" que **continua como ESTOQUE** — controle de ferramenta perde o rastro. |
| C12 | `components/AlmoxOS.tsx:394` | `receberFerr()`: ferramenta devolvida segue "EM CAMPO". |

Padrão de patch (vale para C7–C12 — mesma forma nos 6):

```diff
   const confirmarRecebido = async (q: Solicitacao) => {
-    await supabase.from('solicitacao_material').update({ status: 'RECEBIDO' }).eq('id', q.id);
+    const { error } = await supabase.from('solicitacao_material').update({ status: 'RECEBIDO' }).eq('id', q.id);
+    if (error) { setMsgMat('❌ Não deu para confirmar agora (sinal?). Toque de novo. ' + error.message); return; }
+    setMsgMat('✅ Recebimento confirmado.');
     carregarMaterial();
   };
```

### 🟡 MÉDIO — lista vazia que parece "não tem nada"

| # | arquivo:linha | efeito |
|---|---|---|
| C13 | `components/PainelEquipe.tsx:56` | erro ⇒ `data` null ⇒ "nenhum pedido" — indistinguível de realmente não ter pedido. Mesma classe da LIÇÃO #7. |
| C14 | `components/PainelEquipe.tsx:61` | erro ⇒ o botão **RECEBI nunca aparece** e o João fica esperando confirmação que não vem. |
| C15 | `components/ListaOS.tsx:268` | `alvoRows`: erro descartado; existe guard `if (!alvo)`, então falha com mensagem genérica em vez da causa. |

Patch (C13/C14), no espírito do que `osService.listar` já faz:

```diff
-    const { data } = await supabase.from('solicitacao_material').select('*')
-      .like('solicitante', `${cfg.apelido}%`).order('criado_em', { ascending: false }).limit(6);
-    if (data) setMeusPedidos(data as Solicitacao[]);
+    const { data, error } = await supabase.from('solicitacao_material').select('*')
+      .like('solicitante', `${cfg.apelido}%`).order('criado_em', { ascending: false }).limit(6);
+    if (error) { setMsgMat('⚠️ Não consegui carregar seus pedidos — pode haver item faltando na tela. Toque em ↻.'); }
+    else setMeusPedidos((data || []) as Solicitacao[]);
```

### 🔵 BAIXO — aceitável, mas registre no console

| # | arquivo:linha | nota |
|---|---|---|
| C16 | `components/AlmoxOS.tsx:332` | leitura de apelido; falha só perde autocompletar |
| C17 | `components/AlmoxOS.tsx:334` | contador de uso do apelido |
| C18 | `components/AlmoxOS.tsx:336` | insert de apelido novo |
| C19 | `services/osService.ts:224` | `baixaKit`: conta as falhas ✔ mas **descarta a mensagem**. Acrescente `if (error) console.error('baixaKit:', error.message);` — sem isso não há como diagnosticar kit que não baixou. |

✅ **Já corretos, não mexer:** `services/osService.ts` (`listar`, `salvar`,
`excluir`, `numeroExiste`, `proximaF`), `components/Financeiro.tsx:50,68`,
`components/AlmoxOS.tsx:55-118` (`paginarTudo` + `carregar`),
`components/App.tsx:125`, `components/PainelEquipe.tsx:100`.

**Trava para não voltar** (`.eslintrc` quando o lint entrar):
`@typescript-eslint/no-floating-promises` + revisão manual de todo
`await supabase` que não destrutura `error`.

---

<a id="d"></a>
## D. OFFLINE / PWA

Arquivo pronto em **`seguranca/sw.js`** — comparar com `public/sw.js`.
A explicação completa (por que o Tailwind via CDN quebra offline, e as
duas saídas) está **dentro do próprio arquivo**, no bloco final.

Resumo da estratégia, para não regredir a **LIÇÃO #1**:

| recurso | estratégia | por quê |
|---|---|---|
| `index.html` / navegação | **rede primeiro** | com sinal, HTML sempre fresco ⇒ a `VERSAO` do cabeçalho continua sendo diagnóstico confiável |
| `/assets/index-<hash>.js` | cache primeiro | o hash muda a cada build: nunca existe "versão velha do mesmo arquivo" |
| ícones / manifest | cache primeiro | estáveis |
| `/rest/v1`, `/auth/v1`, `/realtime`, `/storage/v1` | **nunca cacheado** | dado de O.S., sessão e URL assinada que expira |
| `cdn.tailwindcss.com` | cache + revalida | sem ele o app offline abre **sem CSS nenhum** |

O que este SW **não** faz: fila de gravação offline. O app abre e explica
que está sem rede — ele não finge ter dados. Fila offline (IndexedDB +
Background Sync) tem regra de conflito própria e não entra no meio de uma
medição.

Também é preciso bumpar a `VERSAO` do `sw.js` junto com a do `App.tsx` a
cada release — está anotado no topo do arquivo.

---

<a id="e"></a>
## E. QUALIDADE

### E.1 Lockfile — commitar (2 minutos, resolve o ALTO 5 pela metade)

Confirmado: `package-lock.json` existe local (65 KB) e aparece como
**untracked** no `git status`. Sem ele, cada build da Vercel resolve
versões diferentes de React/Supabase — o app em produção pode mudar de
comportamento **sem ninguém ter alterado uma linha**.

```powershell
cd C:\Users\nicol\FPV-Campo
git add package-lock.json
git commit -m "chore: versiona package-lock.json (build reproduzivel)"
git push
```

> `.gitignore` **não** ignora o lockfile — ele só nunca foi adicionado.
> Nada a mudar lá.

### E.2 Testes — `seguranca/testes-exemplo/`

Arquivos prontos em `seguranca/testes-exemplo/`. **Já executados contra o
código real deste repo: 27 testes, 4 arquivos, todos passando** (vitest 4,
jsdom) — rodados numa cópia isolada, sem instalar nada no repo.

| arquivo | protege contra |
|---|---|
| `refDaOS.test.ts` | a precedência nº oficial → `fict_ref` → `F-nn` → `S/Nº`, e `numero: 0` não cair no fallback. Se inverter, **toda saída de material passa a ser chaveada pela ref errada** — foi assim que nasceram as 168 saídas órfãs |
| `buscaNorm.test.ts` | acento, maiúscula e letra dobrada (`fanny`↔`Fany`, `jose`↔`JOSÉ`, `marcal`↔`MARÇAL`) **e** que dígito NUNCA é colapsado — colapsar dígito faz a busca por O.S. `1188` casar com `188` |
| `osService.listar.test.ts` | paginação: dedupe por `id` (caso da O.S. 913), parada na página incompleta, e **erro no meio devolve `{dados parciais, erro}`** em vez de lista silenciosamente curta (LIÇÃO #7) |
| `login2toques.test.tsx` | **o login em 2 toques** (LIÇÃO #2): tocar no nome leva direto à senha, o operário nunca digita e-mail, senha é aparada, erro sai em português. Escrito sem citar `config.ts` — é ele que vai provar que o **patch B não regrediu a UX** |
| `apos-patch-A1/pathDaFoto.test.ts` | o resolver da seção A (URL pública, assinada, caminho cru, link externo, bucket alheio). **Só copiar para `tests/` depois** de criar o `fotoService.ts` — antes disso o import não resolve e o CI fica vermelho à toa |

**Estes testes reprovam quando o código regride** — verificado por mutação:
inverter a precedência do `refDaOS` derruba 3 testes; deixar o colapso de
letra dobrada pegar dígito (`[a-z]` → `[a-z0-9]`) derruba outros 2.
Teste que não reprova é decoração.

Instalação:

```powershell
cd C:\Users\nicol\FPV-Campo
npm i -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
Copy-Item seguranca\testes-exemplo\vitest.config.ts .
Copy-Item seguranca\testes-exemplo\vitest.setup.ts .
New-Item -ItemType Directory -Force tests
Copy-Item seguranca\testes-exemplo\*.test.ts  tests\
Copy-Item seguranca\testes-exemplo\*.test.tsx tests\
```

`package.json`:

```diff
   "scripts": {
     "dev": "vite",
     "build": "vite build",
-    "preview": "vite preview"
+    "preview": "vite preview",
+    "typecheck": "tsc --noEmit",
+    "test": "vitest run",
+    "test:watch": "vitest"
   },
```

> Nada disso toca o bundle de produção: são só `devDependencies`.

### E.3 CI — `seguranca/ci.yml` → `.github/workflows/ci.yml`

```powershell
New-Item -ItemType Directory -Force .github\workflows
Copy-Item seguranca\ci.yml .github\workflows\ci.yml
git add .github\workflows\ci.yml
git commit -m "ci: typecheck + build + testes no push e no PR"
```

Roda `typecheck`, `test` e `build`. **Não** roda lint ainda — ESLint num
`Gestao.tsx` de 1216 linhas devolve centenas de avisos e todo mundo passa
a ignorar o CI vermelho. Lint entra depois, já com `--max-warnings` fixado
no número atual e baixando a régua aos poucos.

---

<a id="f"></a>
## ORDEM, RISCO E ROLLBACK

| # | passo | risco | rollback |
|---|---|---|---|
| 1 | E.1 commitar o lockfile | nenhum | `git revert` |
| 2 | E.2/E.3 testes + CI | nenhum (não toca produção) | apagar os arquivos |
| 3 | C — erros ignorados (🔴 primeiro) | baixo: só **acrescenta** checagem e mensagem | reverter por arquivo |
| 4 | A.1–A.5 fotos, **com bucket ainda público** | baixo: URL assinada funciona em bucket público | reverter o commit |
| 5 | conferir foto no celular (O.S. antiga + Fechamento) | — | — |
| 6 | SQL 09 **ETAPA 2** (fecha o bucket) | **médio — o único passo que quebra em produção** | `update storage.buckets set public=true` (1 linha) |
| 7a | B.3 SQL (colunas + telefones + view) — exige a FRENTE 1 aplicada | baixo: aditivo | drops do fim do B.3 |
| 7b | B.4–B.7 código (login + telefones fora do bundle) | médio: mexe no login | reverter o commit; `config.ts` volta com a lista |
| 8 | D — trocar `public/sw.js` | baixo-médio: SW é grudento | publicar SW passthrough com `VERSAO` nova ⇒ ativa e limpa os caches antigos |
| 9 | Tailwind auto-hospedado (Nível 1) | baixo | reverter 1 linha do `index.html` |

**Nunca faça 6 antes de 4+5.** É a única sequência em que a evidência
fotográfica da medição em curso não corre risco.

**Nunca faça 7b antes de 7a.** Os 4 telefones só existem no `config.ts`;
apagá-los do arquivo sem antes gravá-los em `app_usuario.whatsapp` perde
o dado do sistema vivo.

Ainda sobre os telefones: removê-los do arquivo **não os apaga do
histórico do git**. Enquanto o repositório for privado, isso é aceitável
e fica registrado como dívida. Se ele for (ou vier a ser) público, aí é
reescrita de histórico + troca dos números — item à parte, fora do
escopo desta frente.

**O que esta frente NÃO resolve, e é bom estar dito:** a lista de contas
continua sendo derivável (o padrão `<nome>@fpv.app` é adivinhável a
partir do rótulo). Isso é inerente a ter uma tela de login com nomes, e
a tela de login com nomes é o que faz o app ser usado. A defesa real
contra "sei que existe `joao@fpv.app`" é a **FRENTE 1 + FRENTE 2** (RLS
por papel): com elas no lugar, conhecer o e-mail de alguém não dá acesso
a nada. Sem elas, esconder a lista seria teatro.
