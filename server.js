require('dotenv').config();
const express = require('express');
const socketIo = require('socket.io');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ngrok = require('ngrok');
const sharp = require('sharp');
const bodyParser = require('body-parser');
const multer = require('multer');
const { exec } = require('child_process');

// Configuração do Servidor
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Configurações
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configuração do Multer para upload de arquivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const ext = file.originalname.split('.').pop();
        cb(null, `${uuidv4()}.${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

// Variáveis globais
let whatsappClient = null;
let isAuthenticated = false;
const activeChats = new Map();
let ngrokUrl = null;
let botConfig = {
    status: 'active',
    greeting: "Olá! Bem-vindo ao atendimento de guincho. Como posso ajudar?",
    farewell: "Obrigado por entrar em contato. Tenha um bom dia!",
    autoReplies: [
        {
            trigger: "preço",
            content: "O valor do serviço de guincho varia conforme a distância. Para um orçamento preciso, por favor informe seu endereço."
        },
        {
            trigger: "horário",
            content: "Atendemos 24 horas por dia, 7 dias por semana, incluindo feriados."
        },
        {
            trigger: "emergência",
            content: "Para situações de emergência, por favor informe sua localização exata e o modelo do veículo para priorizarmos seu atendimento."
        }
    ]
};

// Inicializar cliente WhatsApp
const initWhatsAppClient = () => {
    // Destruir instância anterior se existir
    if (whatsappClient) {
        whatsappClient.destroy().catch(console.error);
    }

    whatsappClient = new Client({
        authStrategy: new LocalAuth({
            clientId: "guincho-wtz",
            dataPath: path.join(__dirname, 'whatsapp-sessions')
        }),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--disable-extensions',
                '--disable-gpu'
            ],
            executablePath: process.env.CHROME_PATH || 
                (process.platform === 'win32' 
                    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
                    : process.platform === 'linux'
                        ? '/usr/bin/google-chrome'
                        : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        },
        takeoverOnConflict: true,
        restartOnAuthFail: true
    });

    // Configurar eventos
    setupWhatsAppEvents();

    // Inicializar cliente
    whatsappClient.initialize().catch(err => {
        console.error('Erro na inicialização:', err);
        setTimeout(initWhatsAppClient, 10000); // Tentar novamente após 10 segundos
    });
};

// Configurar eventos do WhatsApp
const setupWhatsAppEvents = () => {
    // Evento QR Code
    whatsappClient.on('qr', async (qr) => {
        console.log('QR RECEBIDO');
        try {
            const qrImage = await qrcode.toDataURL(qr);
            io.emit('qr-update', qrImage);
        } catch (err) {
            console.error('Erro ao gerar QR code:', err);
            io.emit('qr-fallback', qr);
        }
    });

    // Autenticado
    whatsappClient.on('authenticated', () => {
        console.log('AUTENTICADO');
        isAuthenticated = true;
        io.emit('whatsapp-status', 'connected');
    });

    // Pronto para uso
    whatsappClient.on('ready', async () => {
        console.log('CLIENTE PRONTO');
        isAuthenticated = true;
        io.emit('whatsapp-status', 'ready');
        
        try {
            // Carregar conversas iniciais
            const chats = await whatsappClient.getChats();
            console.log(`Chats carregados: ${chats.length}`);
            
            // Limpar e atualizar lista de chats ativos
            activeChats.clear();
            chats.slice(0, 30).forEach(chat => {
                activeChats.set(chat.id._serialized, {
                    id: chat.id._serialized,
                    name: chat.name || chat.id.user,
                    lastMessage: chat.lastMessage?.body || 'Nenhuma mensagem',
                    unread: chat.unreadCount,
                    timestamp: chat.timestamp
                });
            });
            
            io.emit('chat-list-update', Array.from(activeChats.entries()));
        } catch (err) {
            console.error('Erro ao carregar chats:', err);
        }
    });

    // Receber mensagens
    whatsappClient.on('message', async msg => {
        try {
            const chat = await msg.getChat();
            const chatId = chat.id._serialized;
            
            let messageContent = msg.body;
            let isMedia = false;
            let filePath = '';
            
            // Tratar mídia
            if (msg.hasMedia) {
                isMedia = true;
                try {
                    const media = await msg.downloadMedia();
                    const fileExt = media.mimetype.split('/')[1] || 'bin';
                    const fileName = `${uuidv4()}.${fileExt}`;
                    filePath = path.join(UPLOAD_DIR, fileName);
                    
                    // Otimizar imagem se for do tipo imagem
                    if (media.mimetype.includes('image')) {
                        const optimizedBuffer = await sharp(Buffer.from(media.data, 'base64'))
                            .resize(800)
                            .jpeg({ quality: 80 })
                            .toBuffer();
                        fs.writeFileSync(filePath, optimizedBuffer);
                    } else {
                        fs.writeFileSync(filePath, media.data, 'base64');
                    }
                    
                    messageContent = `/uploads/${fileName}`;
                } catch (err) {
                    console.error('Erro ao baixar mídia:', err);
                    messageContent = '[Mídia não disponível]';
                }
            }
            
            // Atualizar chat
            const chatData = activeChats.get(chatId) || {
                id: chatId,
                name: chat.name || chat.id.user,
                lastMessage: '',
                unread: 0,
                timestamp: msg.timestamp
            };
            
            chatData.lastMessage = isMedia ? '[Mídia]' : msg.body;
            chatData.unread = msg.fromMe ? 0 : (chatData.unread + 1);
            chatData.timestamp = msg.timestamp;
            
            activeChats.set(chatId, chatData);
            
            // Emitir atualizações específicas para melhor performance
            io.emit('chat-updated', {
                chatId,
                lastMessage: chatData.lastMessage,
                unread: chatData.unread,
                timestamp: chatData.timestamp
            });
            
            io.emit('specific-message', {
                chatId,
                sender: msg.fromMe ? 'Você' : (chat.name || chat.id.user),
                message: messageContent,
                timestamp: new Date(msg.timestamp * 1000).toISOString(),
                isMedia,
                fromMe: msg.fromMe,
                filePath
            });
            
            // Marcar como lido se não for minha mensagem
            if (!msg.fromMe) {
                await chat.sendSeen();
                
                // Verificar respostas automáticas
                if (botConfig.status === 'active') {
                    const autoReply = botConfig.autoReplies.find(reply => 
                        msg.body.toLowerCase().includes(reply.trigger.toLowerCase())
                    );
                    
                    if (autoReply) {
                        setTimeout(async () => {
                            await whatsappClient.sendMessage(chatId, autoReply.content);
                            io.emit('auto-reply', {
                                chatId,
                                message: autoReply.content
                            });
                        }, 1500); // Pequeno atraso para parecer mais natural
                    }
                }
                
                // Enviar saudação automática se for a primeira mensagem
                if (chatData.unread === 1 && botConfig.status === 'active') {
                    setTimeout(async () => {
                        await whatsappClient.sendMessage(chatId, botConfig.greeting);
                        io.emit('auto-reply', {
                            chatId,
                            message: botConfig.greeting
                        });
                    }, 1000);
                }
            }
        } catch (err) {
            console.error('Erro ao processar mensagem:', err);
        }
    });

    // Desconexão
    whatsappClient.on('disconnected', (reason) => {
        console.log('DESCONECTADO:', reason);
        isAuthenticated = false;
        io.emit('whatsapp-status', 'disconnected');
        setTimeout(initWhatsAppClient, 5000);
    });

    // Falha na autenticação
    whatsappClient.on('auth_failure', (msg) => {
        console.error('FALHA NA AUTENTICAÇÃO:', msg);
        isAuthenticated = false;
        io.emit('whatsapp-status', 'auth_failure');
        setTimeout(initWhatsAppClient, 10000);
    });
};

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));

// Rotas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/ngrok-url', (req, res) => {
    res.json({ url: ngrokUrl });
});

// Rota para upload de arquivos
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }
    
    res.json({
        url: `/uploads/${req.file.filename}`,
        name: req.file.originalname
    });
});

// Socket.io
io.on('connection', (socket) => {
    console.log('Cliente conectado:', socket.id);

    // Enviar status atual
    if (isAuthenticated) {
        socket.emit('whatsapp-status', whatsappClient.info ? 'ready' : 'connected');
    }

    // Enviar chats atuais
    if (activeChats.size > 0) {
        socket.emit('chat-list-update', Array.from(activeChats.entries()));
    }

    // Enviar URL do Ngrok se disponível
    if (ngrokUrl) {
        socket.emit('ngrok-url', ngrokUrl);
    }

    // Enviar configurações do bot
    socket.emit('bot-config', botConfig);

    // Iniciar cliente se não estiver rodando
    if (!whatsappClient) {
        initWhatsAppClient();
    }

    // Evento: Carregar histórico do chat
    socket.on('load-chat-history', async ({ chatId, limit = 50 }) => {
        if (!whatsappClient || !isAuthenticated || !chatId) return;

        try {
            console.log(`Carregando histórico para: ${chatId}`);
            const chat = await whatsappClient.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit });
            
            console.log(`Mensagens carregadas: ${messages.length}`);
            
            // Enviar mensagens em ordem cronológica
            messages.reverse().forEach(async msg => {
                let messageContent = msg.body;
                let isMedia = false;
                let filePath = '';
                
                if (msg.hasMedia) {
                    isMedia = true;
                    try {
                        const media = await msg.downloadMedia();
                        const fileExt = media.mimetype.split('/')[1] || 'bin';
                        const fileName = `${uuidv4()}.${fileExt}`;
                        filePath = path.join(UPLOAD_DIR, fileName);
                        
                        fs.writeFileSync(filePath, media.data, 'base64');
                        messageContent = `/uploads/${fileName}`;
                    } catch (err) {
                        console.error('Erro ao baixar mídia:', err);
                        messageContent = '[Mídia não disponível]';
                    }
                }
                
                socket.emit('historic-message', {
                    chatId,
                    sender: msg.fromMe ? 'Você' : (msg._data.notifyName || chat.id.user),
                    message: messageContent,
                    timestamp: new Date(msg.timestamp * 1000).toISOString(),
                    isMedia,
                    fromMe: msg.fromMe,
                    filePath
                });
            });
        } catch (err) {
            console.error('Erro ao carregar histórico:', err);
            socket.emit('load-error', {
                chatId,
                error: 'Falha ao carregar histórico'
            });
        }
    });

    // Evento: Enviar mensagem
    socket.on('send-message', async ({ chatId, message }) => {
        if (!whatsappClient || !isAuthenticated || !chatId || !message) return;

        try {
            // Enviar mensagem
            const sentMsg = await whatsappClient.sendMessage(chatId, message);
            
            // Atualizar chat
            if (activeChats.has(chatId)) {
                const chatData = activeChats.get(chatId);
                chatData.lastMessage = message;
                chatData.timestamp = sentMsg.timestamp;
                io.emit('chat-updated', {
                    chatId,
                    lastMessage: message,
                    unread: 0,
                    timestamp: sentMsg.timestamp
                });
            }
            
            // Emitir confirmação
            socket.emit('message-sent', {
                chatId,
                messageId: sentMsg.id.id,
                timestamp: new Date(sentMsg.timestamp * 1000).toISOString()
            });
            
            // Emitir status da mensagem
            socket.emit('message-status', {
                chatId,
                status: 'sent',
                messageId: sentMsg.id.id,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.error('Erro ao enviar mensagem:', err);
            socket.emit('error', 'Falha no envio: ' + err.message);
        }
    });

    // Evento: Marcar como lido
    socket.on('mark-read', async (chatId) => {
        if (!whatsappClient || !isAuthenticated || !chatId) return;

        try {
            const chat = await whatsappClient.getChatById(chatId);
            await chat.sendSeen();
            
            if (activeChats.has(chatId)) {
                activeChats.get(chatId).unread = 0;
                io.emit('chat-updated', {
                    chatId,
                    unread: 0
                });
            }
        } catch (err) {
            console.error('Erro ao marcar como lido:', err);
        }
    });

    // Evento: Enviar arquivo
    socket.on('send-file', async ({ chatId, file }) => {
        if (!whatsappClient || !isAuthenticated || !chatId || !file) return;

        try {
            // Criar mídia
            const media = new MessageMedia(file.mimetype, file.data, file.name);
            
            // Enviar arquivo
            const sentMsg = await whatsappClient.sendMessage(chatId, media, {
                caption: file.name
            });
            
            // Gerar URL do arquivo
            const fileName = `${uuidv4()}.${file.name.split('.').pop()}`;
            const filePath = path.join(UPLOAD_DIR, fileName);
            fs.writeFileSync(filePath, Buffer.from(file.data, 'base64'));
            const fileUrl = `/uploads/${fileName}`;
            
            // Atualizar chat
            if (activeChats.has(chatId)) {
                const chatData = activeChats.get(chatId);
                chatData.lastMessage = '[Arquivo]';
                chatData.timestamp = sentMsg.timestamp;
                io.emit('chat-updated', {
                    chatId,
                    lastMessage: '[Arquivo]',
                    timestamp: sentMsg.timestamp
                });
            }
            
            // Emitir confirmação
            socket.emit('file-uploaded', {
                chatId,
                fileName: file.name,
                fileUrl,
                timestamp: new Date(sentMsg.timestamp * 1000).toISOString()
            });
        } catch (err) {
            console.error('Erro ao enviar arquivo:', err);
            socket.emit('error', 'Falha no envio do arquivo: ' + err.message);
        }
    });

    // Evento: Solicitar URL do Ngrok
    socket.on('request-ngrok-url', () => {
        if (ngrokUrl) {
            socket.emit('ngrok-url', ngrokUrl);
        }
    });

    // Evento: Atualizar configurações do bot
    socket.on('update-bot-config', (config) => {
        botConfig = config;
        fs.writeFileSync(path.join(__dirname, 'bot-config.json'), JSON.stringify(config, null, 2));
        io.emit('bot-config-updated', config);
    });

    // Evento: Transcrever áudio
    socket.on('transcribe-audio', async ({ audioData }, callback) => {
        try {
            // Em produção, integrar com uma API de transcrição real como Whisper, Google Speech, etc.
            // Esta é uma simulação que retorna uma transcrição aleatória após um atraso
            
            const mockTranscriptions = [
                "Preciso de um guincho para meu carro quebrado na avenida principal.",
                "Meu carro quebrou na rua das flores, preciso de socorro.",
                "Qual o valor do guincho para um carro médio?",
                "Estou com o carro avariado na marginal, preciso de ajuda.",
                "O guincho está a caminho? Já faz meia hora que solicitei."
            ];
            
            setTimeout(() => {
                const randomText = mockTranscriptions[Math.floor(Math.random() * mockTranscriptions.length)];
                callback({ success: true, text: randomText });
            }, 2000);
        } catch (err) {
            console.error('Erro na transcrição:', err);
            callback({ success: false, error: 'Falha na transcrição' });
        }
    });

    // Desconexão do socket
    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
    });
});

// Carregar configurações do bot
function loadBotConfig() {
    try {
        if (fs.existsSync(path.join(__dirname, 'bot-config.json'))) {
            const data = fs.readFileSync(path.join(__dirname, 'bot-config.json'), 'utf8');
            botConfig = JSON.parse(data);
        }
    } catch (err) {
        console.error('Erro ao carregar configurações do bot:', err);
    }
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    loadBotConfig();
    initWhatsAppClient();
    
    try {
        // Iniciar Ngrok (apenas em desenvolvimento)
        if (process.env.NODE_ENV !== 'production') {
            ngrokUrl = await ngrok.connect({
                proto: 'http',
                addr: PORT,
                authtoken: process.env.NGROK_AUTH_TOKEN // Opcional, mas recomendado
            });
            console.log(`Ngrok URL: ${ngrokUrl}`);
            
            // Enviar URL para todos os clientes conectados
            io.emit('ngrok-url', ngrokUrl);
        }
    } catch (err) {
        console.error('Erro ao conectar Ngrok:', err);
    }
});

// Tratamento de erros
process.on('unhandledRejection', (err) => {
    console.error('Erro não tratado:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Exceção não capturada:', err);
    if (whatsappClient) {
        whatsappClient.destroy().catch(console.error);
    }
    setTimeout(initWhatsAppClient, 5000);
});
