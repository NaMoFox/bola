const { createBot, createProvider, createFlow, addKeyword } = require('@bot-whatsapp/bot');
const QRPortalWeb = require('@bot-whatsapp/portal');
const BaileysProvider = require('@bot-whatsapp/provider/baileys');
const MySQLAdapter = require('@bot-whatsapp/database/mysql');
const mysql = require('mysql2/promise');
const EVENTS = require("@bot-whatsapp/bot").EVENTS;

/**
 * Declaramos las conexiones de MySQL
 */
const MYSQL_DB_HOST = 'sfo1.clusters.zeabur.com';
const MYSQL_DB_USER = 'root';
const MYSQL_DB_PASSWORD = 'sD93zEeU5CVaJp0t24b7L6RcdfFPK1v8';
const MYSQL_DB_NAME = 'zeabur';
const MYSQL_DB_PORT = '30100';

const pool = mysql.createPool({
    host: MYSQL_DB_HOST,
    user: MYSQL_DB_USER,
    database: MYSQL_DB_NAME,
    password: MYSQL_DB_PASSWORD,
    port: MYSQL_DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const getFlowsFromDatabase = async () => {
    const connection = await pool.getConnection();

    try {
        const [rows] = await connection.query(`
            SELECT f.keyword, f.answer, f.media_url 
            FROM flows f
            JOIN chatbots c ON f.chatbots_id = c.id
            WHERE c.estado = 'activo'
        `);
        return rows;
    } finally {
        connection.release(); 
    }
};

const getWelcomesMessage = async () => {
    const connection = await pool.getConnection();

    try {
        const [welcomesRow] = await connection.query('SELECT welcomereply FROM welcomes');
        return welcomesRow[0].welcomereply;
    } finally {
        connection.release();
    }
};

const getDefaultReply = async () => {
    const connection = await pool.getConnection();

    try {
        const [defaultReplyRow] = await connection.query('SELECT defaultreply FROM welcomes');
        return defaultReplyRow[0].defaultreply;
    } finally {
        connection.release();
    }
};

const hasReceivedWelcomes = async (phoneNumber) => {
    const connection = await pool.getConnection();

    try {
        const [rows] = await connection.query('SELECT received_welcome FROM closesessions WHERE phone_number = ?', [phoneNumber]);
        return rows.length > 0 && rows[0].received_welcome;
    } finally {
        connection.release();
    }
};

const setWelcomesSent = async (phoneNumber) => {
    const connection = await pool.getConnection();

    try {
        await connection.query('INSERT INTO closesessions (phone_number, received_welcome) VALUES (?, ?) ON DUPLICATE KEY UPDATE received_welcome = ?', [phoneNumber, true, true]);
    } finally {
        connection.release();
    }
};

const handleMessage = async (message, adapterProvider) => {
    console.log("Mensaje entrante recibido:", message); 
    const { from: sender, body } = message;
    const phoneNumber = sender.split("@")[0];

    if (!(await hasReceivedWelcomes(phoneNumber))) {
        const welcomesMessage = await getWelcomesMessage();
        await adapterProvider.sendMessage(phoneNumber, welcomesMessage, { options: {} });
        await setWelcomesSent(phoneNumber);
    } else {
        const flows = await getFlowsFromDatabase();  // Obtener los flujos desde la base de datos
        const defaultReply = await getDefaultReply();  // Obtener el mensaje por defecto desde la base de datos

        let matched = false;
        // Verificar el mensaje contra las palabras clave en la base de datos
        for (const flow of flows) {
            if (body.toLowerCase().includes(flow.keyword.toLowerCase())) {
                const messageOptions = {};
                if (flow.media_url) {
                    messageOptions.media = flow.media_url;
                }
                try {
                    await adapterProvider.sendMessage(phoneNumber, flow.answer, { options: messageOptions });
                } catch (error) {
                    console.error(`Error al enviar el mensaje con media: ${flow.media_url}`, error);
                    // Si hay un error con el media, enviar solo el texto
                    await adapterProvider.sendMessage(phoneNumber, flow.answer, { options: {} });
                }
                matched = true;
                break;
            }
        }
        // Si no hubo coincidencia, enviar el mensaje por defecto
        if (!matched) {
            await adapterProvider.sendMessage(phoneNumber, defaultReply, { options: {} });
        }
    }
};

const main = async () => {
    const adapterDB = new MySQLAdapter({
        host: MYSQL_DB_HOST,
        user: MYSQL_DB_USER,
        database: MYSQL_DB_NAME,
        password: MYSQL_DB_PASSWORD,
        port: MYSQL_DB_PORT,
    });

    const adapterFlow = createFlow([]);  // No agregar flujos estáticos, se manejarán dinámicamente
    const adapterProvider = createProvider(BaileysProvider);

    const bot = createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    });

    // Listen for messages and handle welcomes message
    adapterProvider.on('message', async (message) => {
        await handleMessage(message, adapterProvider);
    });

    QRPortalWeb();
};

main();
