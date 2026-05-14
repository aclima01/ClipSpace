# ClipSpace — CLAUDE.md

## Visão geral

App de clipboard compartilhado para rede local. Monorepo com `/client` (Vite/React) e `/server` (Express/WebSocket/SQLite). Dispositivos na mesma LAN compartilham snippets de texto em tempo real, organizados em conversas — com markdown preview, busca global e home dashboard.

---

## Estrutura do monorepo

```
clipspace/
├── package.json                   # só contém concurrently para o script dev
├── ecosystem.config.example.js    # template PM2 (o .js real é gitignored)
├── certs/                         # TLS certs gerados por mkcert (gitignored)
├── client/                        # Vite 8 + React 19 + TypeScript 6 + Tailwind CSS v4
└── server/                        # Node.js + Express 4 + ws 8 + better-sqlite3 12
```

Cada workspace tem seu próprio `package.json` e `node_modules`. Não há workspace linking — instale dependências separadamente em `client/` e `server/`.

---

## Comandos essenciais

```powershell
# Dev (ambos juntos)
npm run dev

# Build
cd client && npm run build         # saída: client/dist/
cd server && npm run build         # saída: server/dist/

# Typecheck sem emitir
cd client && npx tsc --noEmit
cd server && npx tsc --noEmit

# Produção
pm2 start ecosystem.config.js      # usa TLS_CERT/TLS_KEY se definidos
pm2 restart clipspace              # após rebuild
```

---

## Stack e decisões de design

### Servidor (`server/`)
- **Entry:** `index.ts` — Express HTTP/HTTPS + `ws` WebSocketServer no mesmo `http.Server` ou `https.Server`
- **TLS:** se `TLS_CERT` e `TLS_KEY` estiverem definidos, sobe `https.createServer`; caso contrário, `http.createServer`. Zero mudança de código — só env vars
- **Porta:** `3001`, escuta em `0.0.0.0` para acesso via LAN
- **Banco:** `better-sqlite3` (síncrono), arquivo `server/clipspace.db`. Schema via `CREATE TABLE IF NOT EXISTS` no startup — sem migrations
- **Dev:** `tsx watch index.ts` (sem compilar)
- **Prod:** `tsc` → `node dist/index.js`. O `__dirname` muda de `server/` para `server/dist/`, por isso o path do client dist usa `path.basename(__dirname) === "dist"` para subir um nível extra
- **Static:** em produção o Express serve `client/dist/` e faz fallback para `index.html`
- **IDs:** `crypto.randomUUID()` no servidor (Node.js — sem restrição de contexto seguro)
- **Backup:** `backup.ts` — usa `db.backup(dest)` do `better-sqlite3` para snapshot online. Rodado pelo PM2 como processo separado com `cron_restart`

### Cliente (`client/`)
- **Tailwind CSS v4:** usa `@tailwindcss/vite` plugin — sem `tailwind.config.ts`. Variáveis de tema em `src/index.css` com `@theme {}`. Dark mode via `@media (prefers-color-scheme: dark)`
- **Alias:** `@/` → `src/`. Configurado no `vite.config.ts` (resolve.alias) e `tsconfig.app.json` (paths + `"ignoreDeprecations": "6.0"` — necessário no TS 6)
- **Componentes UI:** escritos manualmente em `src/components/ui/` — não usa CLI do shadcn. Seguem a API do shadcn (CVA, Radix UI primitives, `cn()`)
- **WebSocket:** hook `useWebSocket` em `src/hooks/useWebSocket.ts`. Usa refs para todos os callbacks para evitar closures stale (problema crítico de reconexão em iOS). Reconecta automaticamente após 2s
- **Markdown:** `react-markdown` + `remark-gfm`. Estilos em `.md-preview` no `index.css` — precisam restaurar explicitamente `list-style-type: disc/decimal` porque o preflight do Tailwind zera todos os `ul/ol`
- **Proxy dev:** Vite proxeia `/api` e `/ws` para `localhost:3001`

### localStorage — chaves usadas pelo cliente

| Chave | Conteúdo |
|-------|----------|
| `clipspace:deviceName` | Nome deste dispositivo (gerado como `node-XXXX` se não existe) |
| `clipspace:workspaceName` | Nome do workspace exibido no topo da sidebar (default: `"My ClipSpace"`) |
| `clipspace:inputPanelHeight` | Altura em px do painel de input (salva ao soltar o drag handle) |

Todas são locais por browser — o servidor não é fonte de verdade para nenhuma delas.

### Contexto seguro (HTTPS) vs HTTP puro na LAN

Duas APIs do browser exigem HTTPS (ou localhost):
- `crypto.randomUUID()` — substituído por `randomUUID()` em `src/lib/utils.ts` que usa `crypto.getRandomValues()` (sem restrição)
- `navigator.clipboard.writeText()` — `copyToClipboard()` em `MessageBubble` e `HomeView` tenta a API moderna e cai para `document.execCommand('copy')` via `<textarea>` temporário

O service worker (`public/sw.js`) também só ativa em contexto seguro — em HTTP puro é silenciosamente ignorado.

### iOS PWA — safe areas e viewport

- `viewport-fit=cover` no `<meta viewport>` é obrigatório para usar `env(safe-area-inset-*)`
- Header do `ChatArea` e `Sidebar`: `padding-top: max(0.75rem, env(safe-area-inset-top))` — absorve a status bar
- Input do `ChatArea` e rodapé da `Sidebar`: `padding-bottom: max(..., env(safe-area-inset-bottom))` — absorve a home indicator
- Altura da app: `100dvh` (dynamic viewport height) com fallback `100vh` — `dvh` encolhe quando o teclado iOS abre

---

## Protocolo WebSocket

Todas as mensagens são JSON. Cada cliente subscreve apenas **uma conversa** por vez, mas recebe eventos globais em qualquer conversa.

### Cliente → Servidor

| Tipo | Payload | Descrição |
|------|---------|-----------|
| `subscribe` | `{ conversationId }` | Inscrever na conversa (substitui a anterior) |
| `message` | `{ content, deviceName, clientId }` | Enviar mensagem (`clientId` é UUID gerado no cliente para reconciliação de optimistic update) |

### Servidor → Cliente (eventos de conversa — só subscribers)

| Tipo | Payload | Descrição |
|------|---------|-----------|
| `message` | `{ payload: Message & { clientId } }` | Nova mensagem na conversa subscrita |
| `messages_cleared` | `{ conversationId }` | Todas as mensagens foram limpas |

### Servidor → Cliente (eventos globais — todos os clientes conectados)

| Tipo | Payload | Descrição |
|------|---------|-----------|
| `connected_count` | `{ count }` | Total de conexões WS ativas |
| `conversation_created` | `{ payload: Conversation }` | Nova conversa criada |
| `conversation_renamed` | `{ conversationId, title }` | Conversa renomeada |
| `conversation_deleted` | `{ conversationId }` | Conversa excluída |
| `conversation_touched` | `{ conversationId, updatedAt }` | Nova mensagem em qualquer conversa (para reordenar sidebar e atualizar home feed) |
| `message_deleted` | `{ messageId, conversationId }` | Mensagem excluída |

### Optimistic updates

O cliente gera um `clientId` (UUID) antes de enviar. A mensagem aparece localmente com `status: "pending"`. Quando o servidor faz broadcast de volta incluindo o `clientId`, o cliente localiza a mensagem pending e substitui pela versão confirmada. Timeout de 5s → marca como `"failed"`.

---

## Convenções de código

- **TypeScript estrito** em ambos os lados. Sem `any` explícito. `noUnusedLocals` e `noUnusedParameters` ativados no cliente
- **Sem comentários** exceto onde o motivo não é óbvio
- **Português** nas strings de UI; inglês no código (variáveis, funções, tipos)
- **Font:** `ui-monospace` em toda a UI — tom terminal/corporativo
- **Cores:** paleta totalmente acromática (zero hue). Variáveis em `index.css` → `var(--color-*)`. O único desvio é o highlight de busca (âmbar) e o indicador de mensagem não lida (verde)
- **Scroll:** usar sempre o componente `ScrollArea` (Radix) — nunca `overflow-y-auto` direto para manter consistência visual da scrollbar

---

## Pontos de atenção

- `better-sqlite3` requer binário nativo. No Node.js 24 é necessário a versão `^12.x` do pacote (prebuilds disponíveis)
- `tsconfig.app.json` do cliente: `"ignoreDeprecations": "6.0"` para silenciar aviso de `baseUrl` no TypeScript 6
- Em produção o servidor serve o static do cliente — **não** inicie o Vite dev junto com PM2
- O banco `clipspace.db` fica em `server/clipspace.db` (WAL mode). Em produção também aparece em `server/dist/clipspace.db` se o processo for iniciado a partir de `dist/` — o path é relativo ao `__dirname` resolvido
- Sidebar colapsa automaticamente em telas < 640px ao selecionar uma conversa
- O `useWebSocket` usa um ref `connectRef` para o reconect timeout — evita que o `onclose` capture a versão stale de `connect`. Sem isso, reconexão após iOS em background não re-subscreve à conversa ativa
- O preflight do Tailwind zera `list-style` em `ul`/`ol` globalmente — o CSS de `.md-preview` precisa restaurar `list-style-type: disc/decimal` explicitamente
- `whitespace-pre-wrap` no container do bubble deve ser aplicado **só** no modo `code` — em modo `preview` causa espaçamento duplo junto com as margens do `react-markdown`

---

## REST API completa

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/home` | Stats + feed de atividade recente (últimas 40 msgs) + `connectedNodes` |
| GET | `/api/conversations` | Lista todas as conversas ordenadas por `updated_at DESC` |
| POST | `/api/conversations` | Cria conversa `{ title }` — broadcast `conversation_created` |
| PATCH | `/api/conversations/:id` | Renomeia `{ title }` — broadcast `conversation_renamed` |
| DELETE | `/api/conversations/:id` | Exclui conversa e mensagens — broadcast `conversation_deleted` |
| GET | `/api/conversations/:id/messages` | Últimas 100 mensagens |
| POST | `/api/conversations/:id/messages` | Persiste mensagem REST (raro — WS é o caminho normal) |
| DELETE | `/api/conversations/:id/messages` | Limpa todas as mensagens — broadcast `messages_cleared` |
| DELETE | `/api/messages/:id` | Exclui mensagem individual — broadcast `message_deleted` |
| GET | `/api/search?q=` | Busca em títulos de conversas e conteúdo de mensagens (SQLite LIKE) |
| GET | `/api/device` | Retorna hostname do servidor (legado, não usado pelo cliente) |
