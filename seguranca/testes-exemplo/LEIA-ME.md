# Base de testes — FPV Campo

Estado: **já rodou contra o código real deste repo.**
`4 arquivos · 27 testes · todos passando` (vitest 4 + jsdom + Testing Library),
executados numa cópia isolada em pasta temporária — **nada foi instalado no
repo de produção**.

## Instalar (5 minutos)

```powershell
cd C:\Users\nicol\FPV-Campo

npm i -D vitest @vitest/coverage-v8 jsdom `
        @testing-library/react @testing-library/jest-dom @testing-library/user-event `
        @vitejs/plugin-react

Copy-Item seguranca\testes-exemplo\vitest.config.ts .
Copy-Item seguranca\testes-exemplo\vitest.setup.ts  .
New-Item -ItemType Directory -Force tests
Copy-Item seguranca\testes-exemplo\*.test.ts  tests\
Copy-Item seguranca\testes-exemplo\*.test.tsx tests\
```

Em `package.json`, acrescentar aos `scripts`:

```json
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:watch": "vitest"
```

Rodar: `npm test`

> Tudo é `devDependency`. **O bundle de produção não muda em um byte.**
> A pasta `apos-patch-A1/` fica de fora de propósito — ver abaixo.

## O que cada teste segura

| arquivo | o bug real que ele impede de voltar |
|---|---|
| `refDaOS.test.ts` | ref da O.S. trocada ⇒ `saida_material.os_ref` errado ⇒ custo fora da medição (as 168 saídas órfãs de 24/07) |
| `buscaNorm.test.ts` | colapso de letra dobrada escapando para dígito ⇒ busca por O.S. `1188` casa com `188` |
| `osService.listar.test.ts` | LIÇÃO #7 + caso da O.S. 913: página parcial silenciosa e linha engolida entre páginas |
| `login2toques.test.tsx` | LIÇÃO #2: alguém devolver o teclado para o operário |
| `apos-patch-A1/pathDaFoto.test.ts` | evidência fotográfica sumindo da folha de assinatura após o bucket fechar |

## Por que não tem teste de `Gestao.tsx` / `AlmoxOS.tsx`

São 1216 e 1058 linhas com estado, prompts e Supabase entrelaçados. Testar
isso hoje exigiria refatorar antes — e refatorar componente de 1200 linhas
no meio de uma medição é exatamente o que a regra de ouro proíbe.

A ordem certa é a inversa: **extrair as funções puras primeiro** (`parsePedido`,
`saldoDe`, `temContagem`, o parser de data do `editarSaida`), cada extração
já nascendo com teste. O componente encolhe como consequência, sem nenhum
"big bang". Comece por `parsePedido` — ela decide quantidade e unidade do
material e hoje não tem nenhuma rede de proteção.

## Regra para teste novo

Um teste só entra aqui se **reprovar quando o bug volta**. Antes de commitar,
quebre o código de propósito e confirme que ficou vermelho. Os dois casos
abaixo foram verificados assim:

- inverter a precedência do `refDaOS` → 3 testes reprovam
- trocar `([a-z])\1+` por `([a-z0-9])\1+` no `buscaNorm` → 2 testes reprovam

Teste que passa sempre é decoração: dá sensação de segurança e não segura nada.
