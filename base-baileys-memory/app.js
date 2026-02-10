// Iker Guillamon: uso librerias ya creadas, GIThub --->Importar las funciones necesarias de Baileys
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
// Iker Guillamon --> usaremos QR para vincular dispositivo con whatsapp , intentarems no usar el oficial para evitar baneos.
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Grupo destino para alertas de ayuda (Grupo gestores)
const helpGroupJid = '120363402719094298@g.us';

// --- Markel & Ibai --- Guarda sugerencias pendientes por usuario para confirmar con "si"
const pendingSuggestions = new Map();
const yesReplies = new Set(['si', 'sí', 'yes', 'y', 'ok', 'vale']);
const noReplies = new Set(['no', 'n']);

// --- Markel & Ibai --- Guarda solicitudes de ayuda pendientes
const pendingHelp = new Map();

// --- Markel --- Tiempo de expiración para solicitudes pendientes (5 minutos)
const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

async function startBot() {
    // Iker Guillamon -- me ha fallado alguna vez cuando se utiliza mucho... cuando ocurre esto, hay que borrar carpeta de cache
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    //Iker Guillamon --> funcionando bien, sin usar la oficial.
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    // Iker Guillamon --- evitar que se borre el acceso, funciona bien la libreria.
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        
        if (qr) {
            console.log('Escanea este código QR con WhatsApp para conectar:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ ¡Conectado a WhatsApp! El bot está listo.');
        }

        // Iker Guillamon--- reconexión.
        if (connection === 'close') {
            let shouldReconnect = false;
            if (lastDisconnect) {
                shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('Último error de desconexión:', lastDisconnect.error?.message || lastDisconnect.error);
            }
            
            console.log('Conexión cerrada. Intentando reconectar...');
            if (shouldReconnect) {
                setTimeout(startBot, 3000);
            } else {
                console.log('No se reconectará. Posiblemente se cerró sesión manualmente.');
            }
        }
        
        if (lastDisconnect?.error?.output?.statusCode === 515) {
            console.log('⚠️  Error 515 detectado. WhatsApp rechazó la conexión.');
            console.log('Solución: Borra la carpeta "auth_info_baileys" y reinicia el bot.');
        }
    });
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const msg = messages[0];
            
            
            if (!msg.message || msg.key.fromMe) return;

            const senderJid = msg.key.remoteJid; // Identificador del chat
            
            // --- Markel & Ibai --- Ignorar mensajes en grupos
            if (senderJid.endsWith('@g.us')) {
                console.log(`📩 Mensaje recibido en grupo ${senderJid}, ignorando.`);
                return;
            }
            
            let userMessage = '';
            
            if (msg.message.conversation) {
                // Mensaje de texto simple
                userMessage = msg.message.conversation;
            } else if (msg.message.extendedTextMessage) {
                // Mensaje de texto extendido
                userMessage = msg.message.extendedTextMessage.text || '';
            } else if (msg.message.imageMessage) {
                // Mensaje con imagen (puedes ignorar o procesar el pie de foto)
                userMessage = msg.message.imageMessage.caption || '';
            } else if (msg.message.videoMessage) {
                // Mensaje con video
                userMessage = msg.message.videoMessage.caption || '';
            } else if (msg.message.documentMessage) {
                // Mensaje con documento
                userMessage = msg.message.documentMessage.caption || '';
            } else {
                // Otro tipo de mensaje que no manejamos
                console.log(`📩 Mensaje no manejado de ${senderJid} (tipo: ${Object.keys(msg.message)[0]})`);
                return;
            }

            let command = userMessage.trim().toLowerCase();
            console.log(`📩 Mensaje de ${senderJid}: "${userMessage}"`);

            const now = Date.now();

            // --- Markel & Ibai --- Manejar solicitudes de ayuda pendientes (estado de la conversación)
            const pendingPhone = pendingHelp.get(senderJid);
            if (pendingPhone && now - pendingPhone.createdAt > PENDING_TIMEOUT_MS) {
                pendingHelp.delete(senderJid);
                await sock.sendMessage(senderJid, {
                    text: 'La solicitud de ayuda ha expirado. Escribe "ayuda" para empezar de nuevo.'
                });
                return;
            }
            if (pendingPhone && command !== 'ayuda') {
                if (command === 'no' || command === 'salir' || command === 'cancelar') {
                    pendingHelp.delete(senderJid);
                    await sock.sendMessage(senderJid, {
                        text: 'Solicitud de ayuda cancelada.'
                    });
                    return;
                }
                // Si estamos en el paso de pedir el teléfono, validamos el formato antes de avanzar
                if (pendingPhone.step === 'phone') {
                    const rawPhone = userMessage.trim();
                    const normalizedPhone = rawPhone.replace(/[^0-9+]/g, '');
                    const phoneRegex = /^\+[0-9]{11}$/;

                    if (!phoneRegex.test(normalizedPhone)) {
                        await sock.sendMessage(senderJid, {
                            text: 'Formato invalido. Envia el numero de telefono con prefijo internacional. Ej: +34 123456789\n\nPara cancelar, escriba "no", "salir" o "cancelar".'
                        });
                        return;
                    }

                    pendingHelp.set(senderJid, {
                        step: 'installation',
                        phone: normalizedPhone,
                        createdAt: pendingPhone.createdAt
                    });
                    await sock.sendMessage(senderJid, {
                        text: 'Gracias. Ahora escribe el nombre de la instalacion.\n\nPara cancelar, escriba "no", "salir" o "cancelar".'
                    });
                    return;
                }
                // Si estamos en el paso de pedir la instalación, guardamos la información y enviamos la solicitud al grupo
                if (pendingPhone.step === 'installation') {
                    const installation = userMessage.trim();

                    await sock.sendMessage(helpGroupJid, {
                        text: `Solicitud de ayuda.\n\nTelefono: ${pendingPhone.phone}.\n\nInstalacion: ${installation}.`
                    });

                    pendingHelp.delete(senderJid);

                    await sock.sendMessage(senderJid, {
                        text: 'He enviado tu solicitud al equipo. En breve te contactaran.'
                    });
                    return;
                }
            }

            // --- Markel & Ibai --- Manejar sugerencias pendientes
            const pendingSuggestion = pendingSuggestions.get(senderJid);
            if (pendingSuggestion && now - pendingSuggestion.createdAt > PENDING_TIMEOUT_MS) {
                pendingSuggestions.delete(senderJid);
                await sock.sendMessage(senderJid, {
                    text: 'La sugerencia ha expirado. Escribe el comando de nuevo cuando quieras.'
                });
                return;
            }
            if (pendingSuggestion && yesReplies.has(command)) {
                command = pendingSuggestion.command;
                pendingSuggestions.delete(senderJid);
                console.log(`✅ Confirmada sugerencia "${command}" para ${senderJid}`);
            } else if (pendingSuggestion && noReplies.has(command)) {
                pendingSuggestions.delete(senderJid);
                await sock.sendMessage(senderJid, {
                    text: 'De acuerdo, escribe el comando de nuevo.'
                });
                return;
            }

            const manualPdfPath = path.join(__dirname, 'manual', `${command}.pdf`);
            const errorPdfPath = path.join(__dirname, 'error', `${command}.pdf`);

            // --- Markel & Ibai --- 3 opciones principales: ayuda, error y manual
            if (command === 'ayuda') {
                pendingHelp.set(senderJid, { step: 'phone', createdAt: now });
                await sock.sendMessage(senderJid, {
                    text: 'Para ayudarte, escribe tu telefono (con prefijo internacional Eg: +34 111222333).\n\nPara cancelar, escriba "no", "salir" o "cancelar".'
                });
            }
            else if (command === 'error') {
                await sock.sendMessage(senderJid, { 
                    text: 'Bienvenido al chat de SmartLog. Te ayudaré con el *análisis de errores*.\n\nA continuación, escribe *SOLO* el número de error.\nPor ejemplo, si tienes AutoStore con el fallo *1_LIFT_ERROR*, escribe solo el número "1". Si quieres errores de Smartlift, escribe "lift".' 
                });
            }
            else if (command === 'manual') {
                const manualText = `Bienvenido al chat de SmartLan. Te ayudaré con los manuales. Tienes 3 opciones:\n\n` +
                                 `1. Si quieres *sustitución de elementos* (ej: AS-35031), escribe solo el código.\n` +
                                 `2. Si quieres *manual de mantenimiento*, escribe: "mantenimiento" o "mantenimientor5pro".\n` +
                                 `3. Si quieres ver *la tensión de las correas*, escribe: "tension".\n\n` +
                                 `Escribe el código o la opción deseada:`;
                await sock.sendMessage(senderJid, { text: manualText });
            }

            // --- Markel & Ibai --- buscar si existe error en carpeta de errores
            else if (fs.existsSync(errorPdfPath)) {
                console.log(`📂 Buscando archivo en: ${errorPdfPath}`);  
                try {
                    await sock.sendMessage(senderJid, {
                        text: `Aquí está el documento para el error ${command}:`
                    });
                    await sock.sendMessage(senderJid, {
                        document: fs.readFileSync(errorPdfPath),
                        fileName: `Error_${command}.pdf`,
                        mimetype: 'application/pdf'
                    });
                    await sock.sendMessage(senderJid, { 
                        text: `Aquí tienes el manual de ${command}. Si necesitas cualquier otra cosa, vuelve a iniciar el proceso de *ChatbotSmartlog* o contacta con el gestor de incidencias.` 
                    });
                    console.log(`✅ PDF enviado para: ${command}`);
                } catch (sendError) {
                    console.error('❌ Error al enviar el PDF:', sendError);
                    await sock.sendMessage(senderJid, { 
                        text: 'Lo siento, hubo un problema al enviar el documento. El archivo puede estar corrupto.' 
                    });
                }
            }

            // --- Markel & Ibai --- buscar si existe manual en carpeta de manuales
            else if (fs.existsSync(manualPdfPath)) {
                console.log(`📂 Buscando archivo en: ${manualPdfPath}`);
                try {
                    await sock.sendMessage(senderJid, {
                        text: `Aquí está el manual para ${command}:`
                    });

                    await sock.sendMessage(senderJid, {
                        document: fs.readFileSync(manualPdfPath),
                        fileName: `Manual_${command}.pdf`,
                        mimetype: 'application/pdf'
                    });

                    await sock.sendMessage(senderJid, {
                        text: `Aquí tienes el manual de ${command}. Si necesitas cualquier otra cosa, vuelve a iniciar el proceso del *ChatBotSmartlog* o contacta con el gestor de incidencias.`
                    });
                    console.log(`✅ Manual enviado para: ${command}`);
                } catch (sendError) {
                    console.error('❌ Error al enviar el manual:', sendError);
                    await sock.sendMessage(senderJid, {
                        text: 'Lo siento, hubo un problema al enviar el manual. El archivo puede estar corrupto.'
                    });
                }

            // --- Markel & Ibai --- sugerir comando similar si no se encuentra el manual
            } else {
                const closest = getClosestCommand(command);
                if (closest) {
                    pendingSuggestions.set(senderJid, { command: closest, createdAt: now });
                    await sock.sendMessage(senderJid, {
                        text: `Comando no reconocido. ¿Quisiste decir "${closest}"? Contesta si o no.`
                    });
                } else {
                    await sock.sendMessage(senderJid, { 
                        text: 'Comando no reconocido, use:\n\n"error" para análisis de errores.\n\n"manual" para ver manuales.\n\n"ayuda" para solicitar ayuda de un gestor.' 
                    });
                }
            }
        } catch (error) {
            console.error('💥 Error procesando mensaje:', error);
        }
    });
}

// Iniciar el bot
console.log('🚀 Iniciando bot con Baileys...');
startBot().catch(err => console.error('💥 Error fatal al iniciar:', err));

// --- Markel Biain --- funciones para sugerir comandos similares en caso de error de tipeo
const knownCommands = [
    'error',
    'manual',
    'lift',
    'mantenimiento',
    'tension',
    'mantenimientor5pro',
    'ayuda'
];

const getEditDistance = (a, b) => {
    const aLen = a.length;
    const bLen = b.length;
    const dp = Array.from({ length: aLen + 1 }, () => Array(bLen + 1).fill(0));

    for (let i = 0; i <= aLen; i++) dp[i][0] = i;
    for (let j = 0; j <= bLen; j++) dp[0][j] = j;

    for (let i = 1; i <= aLen; i++) {
        for (let j = 1; j <= bLen; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + cost
            );
        }
    }

    return dp[aLen][bLen];
};

const getClosestCommand = (input) => {
    let best = null;
    let bestDistance = Infinity;

    for (const cmd of knownCommands) {
        const distance = getEditDistance(input, cmd);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = cmd;
        }
    }

    if (best && bestDistance <= 1) {
        return best;
    }

    return null;
};