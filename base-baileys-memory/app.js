// Iker Guillamon: uso librerias ya creadas, GIThub --->Importar las funciones necesarias de Baileys
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
// Iker Guillamon --> usaremos QR para vincular dispositivo con whatsapp , intentarems no usar el oficial para evitar baneos.
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

async function startBot() {
    // Iker Guillamon -- me ha fallado alguna vez cuando se utiliza mucho... cuando ocurre eto, hay que borrar carpeta de cache
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

        // Iker Guillamon--- reeconexion.
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

            const command = userMessage.trim().toLowerCase();
            console.log(`📩 Mensaje de ${senderJid}: "${userMessage}"`);

            // --- Iker Guillamon --- bucle inicial y principal
            if (command === 'error') {
                await sock.sendMessage(senderJid, { 
                    text: 'Bienvenido al chat de SmartLog. Te ayudaré con el *análisis de errores*.\n\nA continuación, escribe *SOLO* el número de error.\nPor ejemplo, si tienes AutoStore con el fallo *1_LIFT_ERROR*, escribe solo el número *1*. Si quieres errores de Smartlift, escribe *lift*.' 
                });
            }
            // 
            else if (/^\d+$/.test(command) || command === 'lift') {
                const errorCode = command;
                const pdfPath = path.join(__dirname, 'images', `${errorCode}.pdf`);
                console.log(`📂 Buscando archivo en: ${pdfPath}`);

                if (fs.existsSync(pdfPath)) {
                    try {
                        await sock.sendMessage(senderJid, {
                            text: `Aquí está el documento para el error ${errorCode}:`
                        });
                        
                        
                        await sock.sendMessage(senderJid, {
                            document: fs.readFileSync(pdfPath),
                            fileName: `Error_${errorCode}.pdf`,
                            mimetype: 'application/pdf'
                        });
                        
                        await sock.sendMessage(senderJid, { 
                            text: `Aquí tienes el manual de ${errorCode}. Si necesitas cualquier otra cosa, vuelve a iniciar el proceso de *ChatbotSmartlog* o contacta con el gestor de incidencias.` 
                        });
                        console.log(`✅ PDF enviado para código: ${errorCode}`);
                    } catch (sendError) {
                        console.error('❌ Error al enviar el PDF:', sendError);
                        await sock.sendMessage(senderJid, { 
                            text: 'Lo siento, hubo un problema al enviar el documento. El archivo puede estar corrupto.' 
                        });
                    }
                } else {
                    console.log(`❌ Archivo NO encontrado para código: ${errorCode}`);
                    await sock.sendMessage(senderJid, { 
                        text: 'Código de error no reconocido. El documento no existe. Por favor, verifica el código e inténtalo de nuevo.' 
                    });
                }
            }
            // 
            else if (command === 'manual') {
                const manualText = `Bienvenido al chat de SmartLan. Te ayudaré con los manuales. Tienes 3 opciones:\n\n` +
                                 `1. Si quieres *sustitución de elementos* (ej: AS-35031), escribe solo el código.\n` +
                                 `2. Si quieres *manual de mantenimiento*, escribe: *mantenimiento*.\n` +
                                 `3. Si quieres ver *la tensión de las correas*, escribe: *tension*.\n\n` +
                                 `Escribe el código o la opción deseada:`;
                await sock.sendMessage(senderJid, { text: manualText });
            }
            // 
            else if (['as-35031', 'mantenimiento', 'tension'].includes(command)) {
                const pdfPath = path.join(__dirname, 'manual', `${command}.pdf`);
                console.log(`📂 Buscando manual en: ${pdfPath}`);

                if (fs.existsSync(pdfPath)) {
                    try {
                        await sock.sendMessage(senderJid, {
                            text: `Aquí está el manual para ${command}:`
                        });
                        
                        await sock.sendMessage(senderJid, {
                            document: fs.readFileSync(pdfPath),
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
                            text: 'Lo siento, hubo un problema al enviar el manual.' 
                        });
                    }
                } else {
                    await sock.sendMessage(senderJid, { 
                        text: 'Manual no disponible para esta opción.' 
                    });
                }
            }
            // 
            else if (userMessage !== '') {
                await sock.sendMessage(senderJid, { 
                    text: 'Comando no reconocido. Usa "error" para análisis de errores o "manual" para ver manuales.' 
                });
            }
        } catch (error) {
            console.error('💥 Error procesando mensaje:', error);
        }
    });
}

// Iniciar el bot
console.log('🚀 Iniciando bot con Baileys...');
startBot().catch(err => console.error('💥 Error fatal al iniciar:', err));