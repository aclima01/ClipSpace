# My ClipSpace

Self-hosted local-network clipboard sharing. Share text snippets in real-time across devices on the same Wi-Fi/LAN, organized as named conversations — with markdown preview, global search and a home dashboard.

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

### 1. Build

```powershell
cd client && npm run build && cd ..
cd server && npm run build && cd ..
```

O cliente compilado vai para `client/dist/` e é servido estaticamente pelo Express.

### 2. Ecosystem file

Copie o template e ajuste os paths para sua máquina:

```powershell
cp ecosystem.config.example.js ecosystem.config.js
# edite ecosystem.config.js com seus paths
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # registrar no boot — rode o comando gerado como Administrador
```

### 3. Comandos PM2

```powershell
pm2 status
pm2 logs clipspace
pm2 logs clipspace-backup
pm2 restart clipspace       # após rebuild do servidor
pm2 reload ecosystem.config.js  # recarregar configuração
```

### 4. Atualizar após mudanças

```powershell
# Só cliente:
cd client && npm run build && cd .. && pm2 restart clipspace

# Cliente + servidor:
cd client && npm run build && cd ..
cd server && npm run build && cd ..
pm2 restart clipspace
```

---

## HTTPS na LAN (recomendado)

HTTPS habilita PWA completo, `navigator.clipboard` nativo e service worker em todos os dispositivos.

### 1. Gerar certificado local

```powershell
mkcert -install   # instala CA raiz no Windows/Chrome — rode uma vez
mkcert <seu-ip-local> localhost 127.0.0.1
# ex: mkcert 192.168.1.42 localhost 127.0.0.1
# gera: certs/192.168.1.42+2.pem e certs/192.168.1.42+2-key.pem
```

### 2. Configurar no ecosystem.config.js

```js
env: {
  TLS_CERT: "E:\\caminho\\para\\certs\\localhost+2.pem",
  TLS_KEY:  "E:\\caminho\\para\\certs\\localhost+2-key.pem",
}
```

Sem as variáveis `TLS_CERT`/`TLS_KEY`, o servidor sobe em HTTP puro (retrocompatível).

### 3. Instalar a CA raiz nos dispositivos mobile

O arquivo da CA fica em `C:\Users\<user>\AppData\Local\mkcert\rootCA.pem`.
Sirva temporariamente para download nos outros dispositivos:

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

Com HTTPS ativo, o app pode ser instalado como Progressive Web App:

| Dispositivo | Como instalar |
|---|---|
| **iPhone/iPad** | Safari → Compartilhar → Adicionar à Tela de Início |
| **Android (Chrome)** | Botão "Instalar app" na barra de endereço |
| **Desktop Chrome/Edge** | Ícone de instalação na barra de endereço |

> **Sem HTTPS:** o manifest funciona, mas service worker e `navigator.clipboard` nativo ficam desativados. O app usa fallbacks automáticos para copiar texto via `execCommand`.

---

## Backup automático

O `ecosystem.config.js` inclui um processo `clipspace-backup` com cron:

```js
{
  name: "clipspace-backup",
  cron_restart: "0 */6 * * *",  // a cada 6 horas
  autorestart: false,
  env: {
    BACKUP_DIR: "C:\\Users\\<user>\\OneDrive\\Backups\\ACLNotes",
    BACKUP_KEEP: "30",  // quantos arquivos manter
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

---

## Estrutura do projeto

```
clipspace/
├── package.json                   # raiz — scripts dev/build via concurrently
├── ecosystem.config.example.js    # template PM2 (copiar para ecosystem.config.js)
├── certs/                         # certificados TLS (gitignored)
├── client/                        # Vite 8 + React 19 + TS 6 + Tailwind CSS v4
│   ├── public/
│   │   ├── icon.svg               # ícone PWA
│   │   ├── manifest.webmanifest   # PWA manifest
│   │   └── sw.js                  # service worker
│   └── src/
│       ├── App.tsx                # root — estado global, roteamento home/chat
│       ├── components/
│       │   ├── HomeView.tsx       # dashboard: stats + activity feed
│       │   ├── Sidebar.tsx        # lista de conversas + device name
│       │   ├── ChatArea.tsx       # área de mensagens + input redimensionável
│       │   ├── MessageBubble.tsx  # bubble com markdown preview e ações
│       │   ├── SearchOverlay.tsx  # overlay de busca global (Ctrl+K)
│       │   └── ui/                # Button, Textarea, Input, ScrollArea, etc.
│       ├── hooks/
│       │   └── useWebSocket.ts    # conexão WS com reconexão automática
│       └── types.ts
└── server/
    ├── index.ts                   # Express HTTP/HTTPS + WebSocket
    ├── db.ts                      # SQLite queries
    ├── backup.ts                  # script de backup (rodado pelo PM2 cron)
    ├── clipspace.db               # banco SQLite (gitignored)
    └── dist/                      # build de produção (gitignored)
```

---

## Uso e atalhos

| Ação | Como |
|------|------|
| Nova conversa | Botão `+` na sidebar |
| Ir para home | Clique no nome do workspace (topo da sidebar) |
| Renomear workspace | Duplo clique no nome do workspace |
| Renomear conversa (desktop) | Duplo clique no título na sidebar |
| Renomear conversa (mobile/desktop) | Clique no título no header do chat |
| Enviar mensagem | `Ctrl+Enter` ou botão enviar |
| Busca global | `Ctrl+K` ou ícone de busca no header |
| Copiar mensagem | Ícone de cópia no meta row da mensagem |
| Preview markdown | Toggle `Code2/Eye` no meta row |
| Copiar como HTML | Ícone `ClipboardList` no meta row |
| Excluir mensagem | Ícone `Trash2` → confirmar |
| Redimensionar input | Arrastar a alça no topo do painel de input |
| Renomear dispositivo | Clique no nome no rodapé da sidebar |
| Recolher sidebar | Botão `PanelLeft` no header do chat |

---

## Banco de dados

SQLite via `better-sqlite3` (WAL mode). O arquivo é criado automaticamente no primeiro startup. Schema via `CREATE TABLE IF NOT EXISTS` — sem migrations manuais.

```sql
CREATE TABLE conversations (id, title, created_at, updated_at);
CREATE TABLE messages (id, conversation_id, content, device_name, created_at);
```

Backup manual: copie `server/clipspace.db`.

---

## Segurança e git

Os seguintes arquivos estão no `.gitignore` — **nunca commitar**:

- `certs/` — chave privada TLS
- `server/clipspace.db` — dados dos usuários
- `ecosystem.config.js` — paths absolutos da máquina
- `.claude/` — configurações locais do Claude Code
- `node_modules/`, `client/dist/`, `server/dist/`
