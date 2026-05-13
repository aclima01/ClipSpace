# ALIMA Notes (ClipSpace)

Self-hosted local-network clipboard sharing. Share text snippets in real-time across devices on the same Wi-Fi/LAN, organized as named conversations.

---

## Requirements

- Node.js 18+
- npm 9+
- (Produção) PM2: `npm install -g pm2`

---

## Desenvolvimento

### 1. Instalar dependências

```powershell
# Raiz (concurrently)
npm install

# Servidor
cd server && npm install && cd ..

# Cliente
cd client && npm install && cd ..
```

### 2. Iniciar em modo dev

```powershell
npm run dev
```

| Serviço | Endereço |
|---------|----------|
| Cliente (Vite HMR) | http://localhost:5173 |
| Servidor (Express + WS) | http://localhost:3001 |

O servidor imprime o IP da rede local no startup:
```
ClipSpace server running on http://0.0.0.0:3001
Local network: http://192.168.x.x:3001
```

Outros dispositivos na mesma rede acessam via `http://<ip-do-host>:5173` em dev ou `:3001` em produção.

---

## Build e Deploy local (PM2)

### 1. Build

```powershell
# Cliente
cd client && npm run build && cd ..

# Servidor
cd server && npm run build && cd ..
```

O cliente compilado vai para `client/dist/` e é servido estaticamente pelo Express na porta 3001.

### 2. Iniciar com PM2

```powershell
pm2 start server/dist/index.js --name clipspace
```

### 3. Persistir entre reinicializações

```powershell
pm2 save
pm2 startup   # gera e exibe o comando para registrar no boot do Windows
```

Execute o comando gerado pelo `pm2 startup` como Administrador.

### 4. Comandos úteis do PM2

```powershell
pm2 status                  # ver estado dos processos
pm2 logs clipspace          # tail dos logs em tempo real
pm2 restart clipspace       # reiniciar após rebuild
pm2 stop clipspace          # parar o serviço
pm2 delete clipspace        # remover do PM2
```

### 5. Atualizar após mudanças

```powershell
# Só o cliente mudou:
cd client && npm run build && cd ..
pm2 restart clipspace

# Servidor ou ambos mudaram:
cd client && npm run build && cd ..
cd server && npm run build && cd ..
pm2 restart clipspace
```

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3001` | Porta do servidor Express |

Exemplo com porta customizada:
```powershell
pm2 start server/dist/index.js --name clipspace -- --env PORT=8080
# ou via ecosystem file (ver abaixo)
```

### Ecosystem file (opcional)

Crie `ecosystem.config.js` na raiz para configurações avançadas do PM2:

```js
module.exports = {
  apps: [{
    name: 'clipspace',
    script: 'server/dist/index.js',
    env: {
      PORT: 3001,
      NODE_ENV: 'production',
    },
  }],
};
```

```powershell
pm2 start ecosystem.config.js
```

---

## Estrutura do projeto

```
clipspace/
├── package.json          # raiz — scripts dev/build via concurrently
├── client/               # Vite + React + TypeScript + Tailwind CSS v4
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── ChatArea.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── ui/           # Button, Textarea, Input, Badge, etc.
│   │   ├── hooks/
│   │   │   └── useWebSocket.ts
│   │   └── types.ts
│   └── dist/             # build de produção (gerado)
└── server/               # Express + ws + better-sqlite3
    ├── index.ts          # entry point — HTTP + WebSocket
    ├── db.ts             # SQLite (better-sqlite3), auto-migra no startup
    ├── clipspace.db      # banco de dados (gerado)
    └── dist/             # build de produção (gerado)
```

---

## Banco de dados

SQLite via `better-sqlite3`. O arquivo `server/clipspace.db` é criado automaticamente no primeiro startup. Não há migrations manuais — o schema é aplicado via `CREATE TABLE IF NOT EXISTS` no boot.

Para fazer backup basta copiar o arquivo `.db`.

---

## Uso

1. Abra o app em múltiplos dispositivos na mesma rede
2. Crie uma conversa com o botão **+** na sidebar
3. Cole ou escreva no campo inferior e pressione **Ctrl+Enter** (ou clique em enviar)
4. Todos os dispositivos conectados recebem a mensagem instantaneamente via WebSocket
5. Clique no ícone de cópia em qualquer mensagem para copiar o conteúdo
6. Duplo-clique no título de uma conversa para renomear
7. Clique no nome do dispositivo (rodapé da sidebar) para renomear — persiste no `localStorage`
8. Use o botão **⊟** no header para recolher/expandir a sidebar
