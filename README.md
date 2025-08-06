# Documentação do Sistema de Atendimento Guincho via WhatsApp

## 📦 Requisitos do Sistema

### 1. Dependências Necessárias

Antes de executar o sistema, instale as seguintes dependências:

```bash
npm init -y
npm install express socket.io whatsapp-web.js qrcode uuid ngrok sharp dotenv cors
npm install whatsapp-web.js qrcode express socket.io ngrok sharp multer uuid body-parser
```

### 2. Dependências Opcionais (Recomendadas para Produção)

```bash
npm install pm2 -g  # Gerenciador de processos para produção
```

### 3. Requisitos do Ambiente

- Node.js (versão 14 ou superior)  
- NPM ou Yarn  
- Google Chrome instalado (necessário para Puppeteer)  
- Espaço em disco para armazenar mídias recebidas  
- Conexão com a internet  

---

## ⚙️ Configuração Inicial

### 1. Arquivo `.env`

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
PORT=3000
CHROME_PATH=/caminho/para/chrome  # Opcional - só se necessário
NGROK_AUTH_TOKEN=seu_token_ngrok  # Opcional - para URLs estáveis
```

### 2. Estrutura de Diretórios

O sistema criará automaticamente os seguintes diretórios:

- `uploads/` – Para armazenar mídias recebidas  
- `whatsapp-sessions/` – Para armazenar sessões do WhatsApp  

---

## ▶️ Executando o Sistema

### 1. Modo Desenvolvimento

```bash
node server.js
```

### 2. Modo Produção (com PM2)

```bash
pm2 start server.js --name "guincho-wtz"
```

---

## ✨ Funcionalidades Principais

### 1. Autenticação

- Geração de QR Code para vincular conta WhatsApp  
- Autenticação persistente (não precisa escanear QR toda vez)  
- Reconexão automática em caso de falhas  

### 2. Interface de Atendimento

- Lista de conversas ordenadas por atividade  
- Visualização de mensagens com histórico  
- Envio de mensagens de texto  
- Envio e recebimento de mídias (imagens, documentos)  
- Marcação de mensagens como lidas  
- Respostas rápidas pré-configuradas  

### 3. Recursos Avançados

- Geração automática de URL pública via Ngrok  
- Otimização de imagens recebidas (redimensionamento e compressão)  
- Organização de mídias por conversa  
- Status de conexão em tempo real  

---

## 💻 Configuração do WhatsApp Web

O sistema utiliza a biblioteca `whatsapp-web.js`, que requer:

- Google Chrome instalado (ou Chromium)  
- Permissão para executar em modo *headless*  

Se necessário, defina o caminho para o Chrome no `.env`:

```env
# Windows
CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"

# Linux
CHROME_PATH="/usr/bin/google-chrome"

# macOS
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

---

## 🛠️ Solução de Problemas Comuns

### 1. Problemas de Autenticação

- Verifique se o WhatsApp está atualizado no celular  
- Limpe a pasta `whatsapp-sessions/` se persistirem erros  
- Certifique-se de que o celular está conectado à internet  

### 2. Problemas com Mídias

- Verifique permissões de escrita na pasta `uploads/`  
- Garanta espaço suficiente em disco  
- Verifique o limite de 15MB para arquivos grandes  

### 3. Problemas de Conexão

- Verifique se o firewall está liberando as portas  
- Em redes corporativas, pode ser necessário configurar um proxy  

---

## 🎨 Personalização

### 1. Respostas Rápidas

Edite o array `quickReplies` no arquivo `index.html` para adicionar ou modificar respostas.

### 2. Estilo Visual

O CSS está incorporado no HTML e pode ser modificado diretamente dentro da tag `<style>`.

### 3. Configurações do Cliente WhatsApp

Ajuste parâmetros do cliente no `server.js`, como opções do `puppeteer` e `authStrategy`.

---

## 🔐 Segurança

- **Ngrok**: Utilize autenticação para proteger URLs públicas  
- **Sessões**: Armazenadas localmente com criptografia  
- **Acesso**: A interface **não possui autenticação** nativa. Recomendado:  
  - Usar firewall  
  - Acesso via VPN  
  - Autenticação básica se exposto publicamente  

---

## 📊 Monitoramento

Para ambientes de produção:

- Use o PM2 para gerenciar o processo  
- Configure e monitore logs (eventos já registrados no console)  
- Acompanhe o uso de disco, especialmente o diretório `uploads/`  

---

## 🔄 Atualização

Para atualizar as dependências principais:

```bash
npm update whatsapp-web.js socket.io express qrcode uuid ngrok sharp
```
