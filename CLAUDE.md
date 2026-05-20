# ClipSpace — CLAUDE.md

## Visão geral

App de anotações para rede local. Monorepo com `/client` (Vite/React) e `/server` (Express/WebSocket/SQLite). Organizado em notebooks → pages → mensagens. Suporta markdown preview, busca global, home dashboard e modo offline com sincronização automática ao reconectar.

---

## Estrutura do monorepo

```
clipspace/
├── package.json                   # só contém concurrently para o script dev
├── deploy.ps1                     # build client + server + pm2 restart
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

# Build + deploy (PM2)
.\deploy.ps1

# Build manual
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
- **Tailwind CSS v4:** usa `@tailwindcss/vite` plugin — sem `tailwind.config.ts`. Variáveis de tema em `src/index.css` com `@theme {}`.
- **Alias:** `@/` → `src/`. Configurado no `vite.config.ts` (resolve.alias) e `tsconfig.app.json` (paths + `"ignoreDeprecations": "6.0"` — necessário no TS 6)
- **Componentes UI:** escritos manualmente em `src/components/ui/` — não usa CLI do shadcn. Seguem a API do shadcn (CVA, Radix UI primitives, `cn()`)
- **WebSocket:** hook `useWebSocket` em `src/hooks/useWebSocket.ts`. Usa refs para todos os callbacks para evitar closures stale (problema crítico de reconexão em iOS). Reconecta automaticamente após 2s
- **Server status:** hook `useServerStatus` em `src/hooks/useServerStatus.ts`. Faz polling em `GET /api/health` a cada 10s. Detecta transição offline→online e dispara `onReconnect` callback
- **Offline cache:** `src/lib/offlineCache.ts` — IndexedDB com dois stores: `cache` (respostas de API) e `queue` (mensagens pendentes para sync)
- **Markdown:** `react-markdown` + `remark-gfm`. Estilos em `.md-preview` no `index.css` — precisam restaurar explicitamente `list-style-type: disc/decimal` porque o preflight do Tailwind zera todos os `ul/ol`
- **Proxy dev:** Vite proxeia `/api` e `/ws` para `localhost:3001`

### Sidebar — layout de duas colunas

A sidebar tem largura total de 240px dividida em:
- **Coluna 1 (80px):** notebooks — ícone + nome truncado, botão Home, rodapé com status de conexão e device name
- **Coluna 2 (160px):** pages do notebook selecionado, ou seções estáticas da Home quando `homeModeActive === true`

**Estado `homeModeActive`:** booleano interno da sidebar que indica se a coluna 1 está com "Home" selecionado. É independente de `activePageId === null` (que é verdadeiro tanto na Home quanto ao navegar num notebook sem selecionar page). Sem esse estado, clicar num notebook mostrava as seções estáticas da Home na coluna 2.

**Seções estáticas da Home** (coluna 2 quando Home ativo):
- `briefing` — Briefing Matinal (AI + páginas recentes)
- `todos` — To-dos abertos
- `feed` — Atividade Recente

### Home dashboard

Três seções selecionáveis via sidebar:
- **Briefing:** narrativa AI gerada via `POST /api/ai/briefing` (streaming SSE) + páginas com atividade desde a última visita
- **To-dos:** checklist items abertos (`- [ ]`) extraídos de todas as mensagens, agrupados por page, com indicador de staleness (verde < 2d, âmbar < 7d, vermelho ≥ 7d)
- **Atividade Recente:** feed das últimas mensagens de qualquer page, com preview e ações

O header de todas as telas exibe uma **statusline** compacta (font-mono 11px): `X notes hoje · Y to-dos · Z pages · W notebooks` — atualizada pelo HomeView via callback `onStatsUpdated` propagado para App.tsx e repassado ao ChatArea.

### Modo offline

O app opera em modo offline-first para uso single-user:

- **App shell:** `public/sw.js` cacheia HTML e bundles JS/CSS via Cache API → app abre sem rede
- **API cache:** ao carregar notebooks e messages com sucesso, salva no IndexedDB (`offlineCache.ts`). No startup offline, carrega do cache
- **Fila de operações:** mensagens enviadas com WS desconectado ficam como `status: "pending"` no UI e são salvas na store `queue` do IndexedDB (em vez de `"failed"`)
- **Sync ao reconectar:** `useServerStatus` detecta que `/api/health` voltou a responder → chama `handleReconnect` em App.tsx → faz flush da fila via REST → refetch notebooks → incrementa `chatRefresh` → ChatArea recarrega messages do servidor
- **Indicador de status:** badge visível em todos os headers e no rodapé do sidebar:
  - `● online` (verde)
  - `● offline` (vermelho)
  - `● sincronizando` (âmbar pulsante) durante o flush

### localStorage — chaves usadas pelo cliente

| Chave | Conteúdo |
|-------|----------|
| `clipspace:deviceName` | Nome deste dispositivo (gerado como `node-XXXX` se não existe) |
| `clipspace:inputPanelHeight` | Altura em px do painel de input (salva ao soltar o drag handle) |
| `clipspace:lastVisit` | ISO timestamp da última vez que o HomeView foi aberto — usado para filtrar "atividade desde sua última visita" |

Todas são locais por browser — o servidor não é fonte de verdade para nenhuma delas.

### Fontes

- **UI geral:** `ui-monospace` (tom terminal/corporativo) — aplicado no `body` via `index.css`
- **Sidebar navigation:** classe `.sidebar-nav` com `font-family: "Anthropic Sans", system-ui, …`, `font-weight: 430` (variable font), `font-size: 14px`, `line-height: 20px`, `color: #ffffff`

### Contexto seguro (HTTPS) vs HTTP puro na LAN

Duas APIs do browser exigem HTTPS (ou localhost):
- `crypto.randomUUID()` — substituído por `randomUUID()` em `src/lib/utils.ts` que usa `crypto.getRandomValues()` (sem restrição)
- `navigator.clipboard.writeText()` — `copyToClipboard()` tenta a API moderna e cai para `document.execCommand('copy')` via `<textarea>` temporário

O service worker (`public/sw.js`) também só ativa em contexto seguro — em HTTP puro é silenciosamente ignorado.

### iOS PWA — safe areas e viewport

- `viewport-fit=cover` no `<meta viewport>` é obrigatório para usar `env(safe-area-inset-*)`
- Header do `ChatArea` e `Sidebar`: `padding-top: max(0.75rem, env(safe-area-inset-top))` — absorve a status bar
- Input do `ChatArea` e rodapé da `Sidebar`: `padding-bottom: max(..., env(safe-area-inset-bottom))` — absorve a home indicator
- Altura da app: `100dvh` (dynamic viewport height) com fallback `100vh` — `dvh` encolhe quando o teclado iOS abre

---

## Protocolo WebSocket

Todas as mensagens são JSON. Cada cliente subscreve apenas **uma page** por vez, mas recebe eventos globais em qualquer page.

### Cliente → Servidor

| Tipo | Payload | Descrição |
|------|---------|-----------|
| `subscribe` | `{ pageId }` | Inscrever na page (substitui a anterior) |
| `message` | `{ content, deviceName, clientId }` | Enviar mensagem (`clientId` é UUID gerado no cliente para reconciliação de optimistic update) |

### Servidor → Cliente (eventos de page — só subscribers)

| Tipo | Payload | Descrição |
|------|---------|-----------|
| `message` | `{ payload: Message & { clientId } }` | Nova mensagem na page subscrita |
| `messages_cleared` | `{ pageId }` | Todas as mensagens foram limpas |
| `message_deleted` | `{ messageId, pageId }` | Mensagem excluída |
| `message_edited` | `{ messageId, pageId, content }` | Conteúdo editado |
| `message_pinned` | `{ messageId, pageId, pinned }` | Status de pin alterado |

### Servidor → Cliente (eventos globais — todos os clientes conectados)

| Tipo | Payload | Descrição |
|------|---------|-----------|
| `connected_count` | `{ count }` | Total de conexões WS ativas (recebido mas não exibido — substituído pelo health polling) |
| `notebook_created` | `{ payload: Notebook }` | Novo notebook criado |
| `notebook_renamed` | `{ notebookId, title }` | Notebook renomeado |
| `notebook_deleted` | `{ notebookId }` | Notebook excluído |
| `page_created` | `{ payload: Page }` | Nova page criada |
| `page_renamed` | `{ pageId, notebookId, title }` | Page renomeada |
| `page_deleted` | `{ pageId, notebookId }` | Page excluída |
| `page_touched` | `{ pageId, notebookId, updatedAt }` | Nova mensagem em qualquer page (reordena sidebar e atualiza home) |

### Optimistic updates

O cliente gera um `clientId` (UUID) antes de enviar. A mensagem aparece localmente com `status: "pending"`. Quando o servidor faz broadcast de volta incluindo o `clientId`, o cliente localiza a mensagem pending e substitui pela versão confirmada. Timeout de 5s → marca como `"failed"`. Quando offline, a mensagem permanece `"pending"` e é enfileirada no IndexedDB para sync posterior.

---

## Convenções de código

- **TypeScript estrito** em ambos os lados. Sem `any` explícito. `noUnusedLocals` e `noUnusedParameters` ativados no cliente
- **Sem comentários** exceto onde o motivo não é óbvio
- **Português** nas strings de UI; inglês no código (variáveis, funções, tipos)
- **Cores:** paleta totalmente acromática. Variáveis em `index.css` → `var(--color-*)`. Desvios: highlight de busca (âmbar), indicador não lido (primário), staleness de to-dos (verde/âmbar/vermelho), status de conexão (verde/vermelho/âmbar)
- **Scroll:** usar sempre o componente `ScrollArea` (Radix) — nunca `overflow-y-auto` direto

---

## Pontos de atenção

- `better-sqlite3` requer binário nativo. No Node.js 24 é necessário a versão `^12.x` do pacote (prebuilds disponíveis)
- `tsconfig.app.json` do cliente: `"ignoreDeprecations": "6.0"` para silenciar aviso de `baseUrl` no TypeScript 6
- Em produção o servidor serve o static do cliente — **não** inicie o Vite dev junto com PM2
- O banco `clipspace.db` fica em `server/clipspace.db` (WAL mode). Em produção também aparece em `server/dist/clipspace.db` se o processo for iniciado a partir de `dist/` — o path é relativo ao `__dirname` resolvido
- Sidebar colapsa automaticamente em telas < 640px ao selecionar uma page
- O `useWebSocket` usa um ref `connectRef` para o reconnect timeout — evita que o `onclose` capture a versão stale de `connect`. Sem isso, reconexão após iOS em background não re-subscreve à page ativa
- O preflight do Tailwind zera `list-style` em `ul`/`ol` globalmente — o CSS de `.md-preview` precisa restaurar `list-style-type: disc/decimal` explicitamente
- `whitespace-pre-wrap` no container do bubble deve ser aplicado **só** no modo `code` — em modo `preview` causa espaçamento duplo junto com as margens do `react-markdown`
- O `useServerStatus` começa com `serverOnline = true` para evitar flash de "offline" no primeiro render. O primeiro poll corrige o estado em até 1s
- O flush da fila offline usa REST (`POST /api/pages/:id/messages`) porque o WS pode ainda não estar subscrito quando o health check dispara. Após o flush, `chatRefresh` incrementa → ChatArea recarrega messages do servidor para substituir os `"pending"` locais

---

## REST API completa

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Healthcheck — retorna `{ ok: true }` |
| GET | `/api/home` | Stats + feed de atividade recente (últimas 40 msgs) |
| GET | `/api/briefing?since=` | To-dos abertos + páginas com atividade desde `since` |
| GET | `/api/briefing/ai` | Último briefing AI gerado (cache) |
| POST | `/api/ai/briefing` | Gera novo briefing AI via streaming SSE |
| GET | `/api/notebooks` | Lista todos os notebooks com pages, ordenados por `updated_at DESC` |
| POST | `/api/notebooks` | Cria notebook `{ title }` — broadcast `notebook_created` |
| PATCH | `/api/notebooks/:id` | Renomeia `{ title }` — broadcast `notebook_renamed` |
| DELETE | `/api/notebooks/:id` | Exclui notebook e suas pages — broadcast `notebook_deleted` |
| POST | `/api/notebooks/:id/pages` | Cria page `{ title }` — broadcast `page_created` |
| PATCH | `/api/pages/:id` | Renomeia `{ title }` — broadcast `page_renamed` |
| DELETE | `/api/pages/:id` | Exclui page e mensagens — broadcast `page_deleted` |
| GET | `/api/pages/:id/messages` | Últimas 100 mensagens da page |
| POST | `/api/pages/:id/messages` | Persiste mensagem REST — usado pelo flush offline |
| DELETE | `/api/pages/:id/messages` | Limpa todas as mensagens — broadcast `messages_cleared` |
| PATCH | `/api/messages/:id` | Edita conteúdo — broadcast `message_edited` |
| PATCH | `/api/messages/:id/pin` | Altera pin `{ pinned }` — broadcast `message_pinned` |
| DELETE | `/api/messages/:id` | Exclui mensagem — broadcast `message_deleted` |
| GET | `/api/search?q=` | Busca em títulos de notebooks/pages e conteúdo de mensagens |
| GET | `/api/tasks/:taskId` | Resolve `#TK-N` → `{ pageId, messageId }` |
| GET | `/api/device` | Retorna hostname do servidor (legado) |
