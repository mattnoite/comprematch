# CompreMatch

Plataforma inteligente de descoberta e correspondência de ofertas locais com **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, **Leaflet**, **Supabase** e **Anthropic Claude**.

## Pré-requisitos na sua máquina

- [Node.js 20+](https://nodejs.org/) (recomendado Node.js 22/24 LTS)
- [Git](https://git-scm.com/)

## Como rodar localmente

### 1. Baixar o projeto (ou atualizar caso já tenha clonado)

```bash
git clone https://github.com/mattnoite/comprematch.git
cd comprematch
```

*(Se você já clonou antes, rode apenas `git pull origin main` dentro da pasta.)*

### 2. Instalar dependências e iniciar o servidor

```bash
npm install
npm run dev
```

Ao rodar `npm run dev`, o script automático `predev` verifica se o arquivo `.env.local` existe e, caso não exista, cria automaticamente a partir de `.env.local.example`.

Depois, confira as chaves em `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
ANTHROPIC_API_KEY=...
```

> Caso ainda não tenha acessado o painel no navegador, abra a URL local exibida pelo Next.js no terminal (`http://localhost:3000`).

## Testando Autenticação, Permissões e Ingestão de Encartes

1. Acesse `/login` e crie sua conta na aba **Cadastrar**.
2. No **Supabase Dashboard → Table Editor → `perfis`** (ou via SQL Editor), promova o primeiro usuário para `admin`:
   ```sql
   UPDATE public.perfis
   SET role = 'admin'
   WHERE email = 'seu@email.com';
   ```
3. Faça login em `/login` com esse e-mail:
   - `/admin/upload`: envio de encarte (JPG, PNG, PDF), extração automática com Claude Haiku (`/api/extract`), revisão em tabela e salvamento em lote no Supabase.
   - `/admin/usuarios`: gestão de permissões (`consumidor`, `colaborador`, `admin`) na tabela `perfis`.

## Scripts disponíveis

- `npm run dev` — garante `.env.local` e inicia o servidor de desenvolvimento
- `npm run setup` — cria `.env.local` a partir de `.env.local.example` se ainda não existir
- `npm run lint` — executa o ESLint
- `npm run build` — gera o build de produção
