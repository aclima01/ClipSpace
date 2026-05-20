# ClipSpace

Self-hosted note-taking app for local networks. Organized as notebooks → pages → messages, with real-time sync across devices on the same LAN, markdown preview, global search, home dashboard and offline mode.

---

## Features

- **Notebooks & Pages** — two-level hierarchy; sidebar with two-column layout (notebooks column + pages column)
- **Real-time sync** — WebSocket broadcast; messages appear instantly on all connected devices
- **Markdown preview** — toggle between raw and rendered view per message; supports GFM tables, task lists, code blocks
- **Global search** — `Ctrl+K` searches across all notebooks, pages and message content
- **Home dashboard** — three sections selectable from the sidebar:
  - **Briefing** — AI-generated narrative (streaming) + pages with activity since last visit
  - **To-dos** — open `- [ ]` items across all pages, grouped by page, with staleness indicator
  - **Atividade Recente** — feed of the latest messages from any page
- **Statusline** — compact stats in every header: notes today · open to-dos · pages · notebooks
- **Offline mode** — app shell cached by service worker; notebooks and messages cached in IndexedDB; messages created offline are queued and synced automatically when the server is reachable again
- **Connection indicator** — `● online` / `● offline` / `● sincronizando` in every header and sidebar footer
- **AI integration** — AI panel per page + morning briefing generation via Anthropic API
- **Task tracking** — `#TK-N` tokens are clickable links that jump to the originating message
- **PWA** — installable on iOS, Android and desktop; runs as a standalone app

---

## Requirements

- Node.js 18+
- npm 9+
- PM2 (produção): `npm install -g pm2`
- mkcert (HTTPS opcional): via winget, scoop ou choco

---

## Desenvolvimento

### 1. Instalar dependências

```powershell
npm install                        # raiz (concurrently)
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 2. Rodar em dev

```powershell
npm run dev
```

| Serviço | Endereço |
|---------|----------|
| Cliente (Vite HMR) | http://localhost:5173 |
| Servidor (Express + WS) | http://localhost:3001 |

O servidor imprime o IP da rede local no startup. Outros dispositivos acessam via `http://<ip>:5173` em dev ou `http://<ip>:3001` em produção.

---

## Build e Deploy (PM2)

### Script rápido

```powershell
.\deploy.ps1   # build client + server + pm2 restart
```

### Manual

```powershell
cd client && npm run build && cd ..
cd server && npm run build && cd ..
pm2 restart clipspace
```

### Ecosystem file

Copie o template e ajuste os paths para sua máquina:

```powershell
cp ecosystem.config.example.js ecosystem.config.js
# edite ecosystem.config.js com seus paths
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # registrar no boot — rode o comando gerado como Administrador
```

### Comandos PM2

```powershell
pm2 status
pm2 logs clipspace
pm2 restart clipspace
pm2 reload ecosystem.config.js
```

---

## HTTPS na LAN (recomendado)

HTTPS habilita PWA completo, `navigator.clipboard` nativo e service worker em todos os dispositivos.

### 1. Gerar certificado local

```powershell
mkcert -install   # instala CA raiz no Windows/Chrome — rode uma vez
mkcert <seu-ip-local> localhost 127.0.0.1
# ex: mkcert 192.168.1.42 localhost 127.0.0.1
```

### 2. Configurar no ecosystem.config.js

```js
env: {
  TLS_CERT: "E:\\caminho\\para\\certs\\localhost+2.pem",
  TLS_KEY:  "E:\\caminho\\para\\certs\\localhost+2-key.pem",
}
```

Sem as variáveis `TLS_CERT`/`TLS_KEY`, o servidor sobe em HTTP puro.

### 3. Instalar a CA raiz nos dispositivos mobile

O arquivo da CA fica em `C:\Users\<user>\AppData\Local\mkcert\rootCA.pem`.

```powershell
python -m http.server 8080 --directory "C:\Users\<user>\AppData\Local\mkcert"
# acesse http://<ip>:8080/rootCA.pem em cada dispositivo
```

| Dispositivo | Passos |
|---|---|
| **iPhone/iPad** | Abrir `.pem` → Instalar perfil → Ajustes → Geral → Sobre → Confiar em certificados raiz |
| **Android** | Abrir `.pem` → Instalar certificado → CA |
| **Notebook** | Importar no gerenciador de certificados do OS |

---

## PWA — Instalar como app

| Dispositivo | Como instalar |
|---|---|
| **iPhone/iPad** | Safari → Compartilhar → Adicionar à Tela de Início |
| **Android (Chrome)** | Botão "Instalar app" na barra de endereço |
| **Desktop Chrome/Edge** | Ícone de instalação na barra de endereço |

---

## Modo offline

O app suporta uso offline para single-user:

1. **Acesse uma vez conectado** — notebooks, pages e messages são cacheados no IndexedDB do browser
2. **Vá offline** — o app continua funcionando com os dados da última sessão
3. **Crie anotações** — mensagens ficam com indicador `pending` e são salvas em fila local
4. **Reconecte** — ao detectar o servidor via `GET /api/health`, as mensagens são enviadas automaticamente e os dados são atualizados

O indicador no header muda de `● offline` para `● sincronizando` e depois `● online` conforme o processo.

---

## Backup automático

O `ecosystem.config.js` inclui um processo `clipspace-backup` com cron:

```js
{
  name: "clipspace-backup",
  cron_restart: "0 */6 * * *",  // a cada 6 horas
  autorestart: false,
  env: {
    BACKUP_DIR: "C:\\Users\\<user>\\OneDrive\\Backups\\ClipSpace",
    BACKUP_KEEP: "30",
  }
}
```

- Usa `db.backup()` do `better-sqlite3` — snapshot online consistente (banco em uso)
- Arquivos nomeados `clipspace-YYYY-MM-DDTHH-MM-SS.db`
- Rotação automática remove os mais antigos quando excede `BACKUP_KEEP`

**Restaurar:** copie qualquer `.db` do backup para `server/clipspace.db` e reinicie.

**Disparar manualmente:**

```powershell
pm2 restart clipspace-backup
pm2 logs clipspace-backup --lines 5 --nostream
```

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3001` | Porta do servidor Express |
| `TLS_CERT` | — | Path para o certificado `.pem` (ativa HTTPS) |
| `TLS_KEY` | — | Path para a chave privada `.pem` |
| `BACKUP_DIR` | `../backups` | Destino dos arquivos de backup |
| `BACKUP_KEEP` | `30` | Número máximo de backups retidos |
| `ANTHROPIC_API_KEY` | — | Chave API para geração de briefing AI |

---

## Estrutura do projeto

```
clipspace/
├── package.json                   # raiz — scripts dev via concurrently
├── deploy.ps1                     # build + pm2 restart
├── ecosystem.config.example.js    # template PM2
├── certs/                         # certificados TLS (gitignored)
├── client/
│   ├── public/
│   │   ├── icon.svg
│   │   ├── manifest.webmanifest
│   │   └── sw.js                  # service worker — cache do app shell
│   └── src/
│       ├── App.tsx                # root — estado global, roteamento home/chat
│       ├── components/
│       │   ├── HomeView.tsx       # dashboard: briefing, to-dos, feed
│       │   ├── Sidebar.tsx        # duas colunas: notebooks + pages
│       │   ├── ChatArea.tsx       # área de mensagens + input redimensionável
│       │   ├── MessageBubble.tsx  # bubble com markdown preview e ações
│       │   ├── SearchOverlay.tsx  # overlay de busca global (Ctrl+K)
│       │   ├── AiPanel.tsx        # painel AI lateral por page
│       │   └── ui/                # Button, Textarea, Input, ScrollArea, etc.
│       ├── hooks/
│       │   ├── useWebSocket.ts    # conexão WS com reconexão automática
│       │   └── useServerStatus.ts # polling /api/health, detecção offline→online
│       ├── lib/
│       │   ├── utils.ts           # cn(), randomUUID()
│       │   └── offlineCache.ts    # IndexedDB: api cache + fila de operações
│       └── types.ts
└── server/
    ├── index.ts                   # Express + WebSocket + todas as rotas REST
    ├── db.ts                      # SQLite queries (better-sqlite3)
    ├── backup.ts                  # script de backup (PM2 cron)
    ├── clipspace.db               # banco SQLite (gitignored)
    └── dist/                      # build de produção (gitignored)
```

---

## Atalhos

| Ação | Como |
|------|------|
| Nova page | Botão `+` na coluna de pages da sidebar |
| Novo notebook | Botão `+` no topo da coluna de notebooks |
| Ir para home | Clique em "Home" na sidebar |
| Renomear notebook | Duplo clique no notebook na sidebar |
| Renomear page | Duplo clique na page na sidebar, ou clique no título no header |
| Enviar mensagem | `Ctrl+Enter` ou botão enviar |
| Busca global | `Ctrl+K` ou ícone de busca no header |
| Copiar mensagem | Ícone de cópia no meta row da mensagem |
| Toggle markdown preview | Ícone `Code2/Eye` no meta row |
| Redimensionar input | Arrastar a alça no topo do painel de input |
| Renomear dispositivo | Clique no nome no rodapé da sidebar |
| Recolher sidebar | Botão `PanelLeft` no header |

---

## Banco de dados

SQLite via `better-sqlite3` (WAL mode). O arquivo é criado automaticamente no primeiro startup. Schema via `CREATE TABLE IF NOT EXISTS` — sem migrations manuais.

```sql
CREATE TABLE notebooks (id, title, created_at, updated_at);
CREATE TABLE pages (id, notebook_id, title, created_at, updated_at);
CREATE TABLE messages (id, page_id, content, device_name, created_at, pinned);
```

---

## Segurança e git

Os seguintes arquivos estão no `.gitignore` — **nunca commitar**:

- `certs/` — chave privada TLS
- `server/clipspace.db` — dados dos usuários
- `ecosystem.config.js` — paths absolutos da máquina
- `.claude/` — configurações locais do Claude Code
- `node_modules/`, `client/dist/`, `server/dist/`
