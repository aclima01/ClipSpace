# ClipSpace — CLAUDE.md

## Visão geral

App de clipboard compartilhado para rede local. Monorepo com `/client` (Vite/React) e `/server` (Express/WebSocket/SQLite). Dispositivos na mesma LAN compartilham snippets de texto em tempo real, organizados em conversas.

---

## Estrutura do monorepo

```
clipspace/
├── package.json          # só contém concurrently para o script dev
├── client/               # Vite 8 + React 19 + TypeScript 6 + Tailwind CSS v4
└── server/               # Node.js + Express 4 + ws 8 + better-sqlite3 12
```

Cada workspace tem seu próprio `package.json` e `node_modules`. Não há workspace linking — instale dependências separadamente em `client/` e `server/`.

---

## Comandos essenciais

```powershell
# Dev (ambos juntos)
npm run dev                        # na raiz

# Build
cd client && npm run build         # saída: client/dist/
cd server && npm run build         # saída: server/dist/

# Typecheck sem emitir
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit

# Produção
pm2 start server/dist/index.js --name clipspace
pm2 restart clipspace              # após rebuild
```

---

## Stack e decisões de design

### Servidor (`server/`)
- **Entry:** `index.ts` — Express HTTP + `ws` WebSocketServer anexado ao mesmo `http.Server`
- **Porta:** `3001`, escuta em `0.0.0.0` para acesso via LAN
- **Banco:** `better-sqlite3` (síncrono), arquivo `server/clipspace.db`. Schema aplicado via `CREATE TABLE IF NOT EXISTS` no startup — sem migrations
- **Dev:** `tsx watch index.ts` (sem compilar)
- **Prod:** `tsc` → `node dist/index.js`. O `__dirname` muda de `server/` para `server/dist/`, por isso o path do client dist usa `path.basename(__dirname) === "dist"` para subir um nível extra
- **Static:** em produção, o Express serve `client/dist/` como static e faz fallback para `index.html`
- **IDs:** `crypto.randomUUID()` para conversas e mensagens

### Cliente (`client/`)
- **Tailwind CSS v4:** usa `@tailwindcss/vite` plugin — sem `tailwind.config.ts`. Variáveis de tema definidas em `src/index.css` com `@theme {}`. Dark mode via `@media (prefers-color-scheme: dark)`
- **Alias:** `@/` → `src/`. Configurado no `vite.config.ts` (resolve.alias) e `tsconfig.app.json` (paths + `"ignoreDeprecations": "6.0"` necessário no TS 6)
- **Componentes UI:** escritos manualmente em `src/components/ui/` — não usa CLI do shadcn. Seguem a API do shadcn (CVA, Radix UI primitives, `cn()`)
- **WebSocket:** hook `useWebSocket` em `src/hooks/useWebSocket.ts`. Reconecta automaticamente após 2s em caso de queda
- **Identidade do dispositivo:** gerada no cliente via `localStorage` (`clipspace:deviceName`). O servidor **não** é fonte de verdade para nomes de dispositivos. O endpoint `GET /api/device` existe mas não é usado pelo cliente
- **Proxy dev:** Vite proxeia `/api` e `/ws` para `localhost:3001`

### Protocolo WebSocket
Mensagens JSON entre cliente e servidor:

| Direção | Tipo | Payload |
|---------|------|---------|
| cliente → servidor | `subscribe` | `{ conversationId: string }` |
| cliente → servidor | `message` | `{ content: string, deviceName: string }` |
| servidor → cliente | `message` | `{ payload: Message }` |
| servidor → cliente | `connected_count` | `{ count: number }` |

O servidor faz broadcast de `connected_count` para **todos** os clientes conectados quando alguém entra ou sai.

---

## Convenções de código

- **TypeScript estrito** em ambos os lados. Sem `any` explícito
- **Sem comentários** exceto onde o motivo não é óbvio (ex: o hack do `path.basename(__dirname)`)
- **Português** nas strings de UI; inglês no código (variáveis, funções, tipos)
- **Font:** `ui-monospace` em toda a UI — tom terminal/corporativo
- **Cores:** paleta totalmente acromática (sem hue). Variáveis CSS em `index.css`, referenciadas como `var(--color-*)` nas classes Tailwind
- Próprio vs. alheio nas mensagens: `isOwn = msg.device_name === deviceName` (comparação client-side)

---

## Pontos de atenção

- `better-sqlite3` requer binário nativo. No Node.js 18/20 os prebuilds funcionam. No Node.js 24 é necessário a versão `^12.x` do pacote
- O `tsconfig.app.json` do cliente precisa de `"ignoreDeprecations": "6.0"` para silenciar o aviso de `baseUrl` deprecated no TypeScript 6
- Em produção o servidor serve o static do cliente — **não** inicie o Vite dev server junto com PM2
- O banco `clipspace.db` fica em `server/clipspace.db`. Para backup, basta copiar o arquivo (WAL mode ativado)
- Sidebar colapsa automaticamente em telas < 640px ao selecionar uma conversa

---

## REST API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/conversations` | Lista todas as conversas |
| POST | `/api/conversations` | Cria conversa `{ title }` |
| PATCH | `/api/conversations/:id` | Renomeia `{ title }` |
| GET | `/api/conversations/:id/messages` | Últimas 100 mensagens |
| POST | `/api/conversations/:id/messages` | Persiste mensagem `{ content, deviceName }` |
| GET | `/api/device` | Retorna hostname do servidor (legado, não usado) |
