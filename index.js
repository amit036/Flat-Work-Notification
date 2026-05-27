const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');

// Load environment variables manually if dotenv is installed, fallback to process.env
try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (e) {
    console.warn('dotenv package not found. Reading environment variables from process.env directly.');
}

const GROUP_NAME = process.env.WHATSAPP_GROUP_NAME || 'Your WhatsApp Group Name';
const GROUP_ID = process.env.WHATSAPP_GROUP_ID || '';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 12 * * *';
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';
const MESSAGE_TEXT = process.env.MESSAGE_TEXT || 'Hello! This is a scheduled daily automated message.';
const IS_TEST_MODE = process.argv.includes('--test') || process.argv.includes('-t');

console.log('===================================================');
console.log('       FLAT WEEKLY WORK ROTATION SCHEDULER         ');
console.log('===================================================');
console.log(`Target Group Name : ${GROUP_NAME}`);
console.log(`Target Group ID   : ${GROUP_ID || '(Not configured, will auto-detect)'}`);
console.log(`Schedule (Cron)   : ${CRON_SCHEDULE} (${TIMEZONE})`);
console.log(`Message Mode      : Dynamic (Flat Weekly Work Rotation schedule)`);
console.log(`Execution Mode    : ${IS_TEST_MODE ? 'TEST (Send immediately and exit)' : 'DAEMON (Scheduled run)'}`);
console.log('---------------------------------------------------');

// Create a simple HTTP server for Render health checks
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Flat Work Notification is running.');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`[SYSTEM] Health check server listening on port ${PORT}`);
});

// Initialize WhatsApp client with local authentication persistence
const client = new Client({
    authTimeoutMs: 0, // Disable auth timeout to accommodate slow VM CPU during first-time sync
    authStrategy: new LocalAuth({
        clientId: 'flat-messager',
        dataPath: path.join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Generate QR Code in terminal for first-time authentication
client.on('qr', (qr) => {
    console.log('\n[AUTH] QR Code received. Please scan with WhatsApp Linked Devices:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('[AUTH] Authentication successful!');
});

client.on('auth_failure', (msg) => {
    console.error('[ERROR] Authentication failed:', msg);
});

client.on('loading_screen', (percent, message) => {
    console.log(`[LOADING] ${percent}% - ${message}`);
});

client.on('ready', async () => {
    console.log('[SYSTEM] WhatsApp Client is ready and connected!');

    let targetGroupId = GROUP_ID;

    // Resolve group ID if not configured
    if (!targetGroupId) {
        console.log(`[SEARCH] Searching for group name: "${GROUP_NAME}"...`);
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);

        // Match case-insensitively
        const targetGroup = groups.find(group =>
            group.name.toLowerCase() === GROUP_NAME.toLowerCase()
        );

        if (targetGroup) {
            targetGroupId = targetGroup.id._serialized;
            console.log('\n===================================================');
            console.log(`[FOUND] Successfully matched WhatsApp Group!`);
            console.log(`Name: ${targetGroup.name}`);
            console.log(`ID  : ${targetGroupId}`);
            console.log('===================================================');
            console.log(`\n👉 ACTION REQUIRED: Add the Group ID to your .env file:`);
            console.log(`WHATSAPP_GROUP_ID="${targetGroupId}"\n`);
        } else {
            console.error(`\n[ERROR] Group named "${GROUP_NAME}" was not found.`);
            console.log('\nHere is a list of your available groups and their IDs:');
            console.log('---------------------------------------------------');
            groups.forEach(g => {
                console.log(`Group Name: ${g.name}`);
                console.log(`Group ID  : ${g.id._serialized}`);
                console.log('---------------------------------------------------');
            });

            if (IS_TEST_MODE) {
                console.log('[SYSTEM] Exiting test run due to missing target group.');
                process.exit(1);
            }
            console.log('[SYSTEM] Waiting for correct configuration. Keeping client alive...');
            return;
        }
    }

    // Generate daily dynamic message based on rotation schedule from schedule.json
    const getDailyMessage = () => {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = days[dayOfWeek];
        const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

        let config = {
            referenceDate: '2026-05-25',
            groceryRotation: ['Amit', 'Prashant', 'Abhishek'],
            dailyRotation: {}
        };

        // Load schedule.json dynamically so changes are picked up on-the-fly without restarting the script
        const schedulePath = path.join(__dirname, 'schedule.json');
        try {
            if (fs.existsSync(schedulePath)) {
                const rawData = fs.readFileSync(schedulePath, 'utf8');
                config = JSON.parse(rawData);
            } else {
                console.warn('[SCHEDULER] schedule.json not found, using hardcoded fallback.');
            }
        } catch (error) {
            console.error('[ERROR] Failed to load/parse schedule.json:', error);
        }

        // 1. Calculate Groceries Rotation (Weekly basis, rotating every Monday)
        const refDateStr = config.referenceDate || '2026-05-25';
        const referenceDate = new Date(refDateStr + 'T00:00:00');
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfRef = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
        const diffTime = startOfToday - startOfRef;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        const elapsedWeeks = Math.floor(diffDays / 7);
        const rotationList = config.groceryRotation || ['Amit', 'Prashant', 'Abhishek'];
        const listLength = rotationList.length || 1;
        let rotationIndex = elapsedWeeks % listLength;
        if (rotationIndex < 0) rotationIndex += listLength;
        const groceryPerson = rotationList[rotationIndex] || 'None';

        // 2. Determine daily tasks based on Flat Weekly Work Rotation chart
        const dayKey = dayName.toLowerCase();
        let garbage = 'Not assigned';
        let cook = 'Not assigned';
        let dishes = 'Not assigned';

        if (config.dailyRotation && config.dailyRotation[dayKey]) {
            const todayTasks = config.dailyRotation[dayKey];
            garbage = todayTasks.garbage || 'None';
            cook = todayTasks.cook || 'None';
            dishes = todayTasks.dishes || 'None';
        }

        return `📅 *[TESTING] FLAT WEEKLY WORK ROTATION* 📅\n` +
            `-----------------------------------\n` +
            `*Date:* ${dateStr} (${dayName})\n\n` +
            `🗑️ *Garbage Throw:* ${garbage}\n` +
            `👨‍🍳 *Dinner Cook (Team):* ${cook}\n` +
            `🧼 *Clean Dishes:* ${dishes}\n` +
            `🛒 *Groceries & Veggies (This Week):* ${groceryPerson}\n\n` +
            `⚡ _Teamwork makes the home work easy!_`;
    };

    // Define function to send the message
    const sendMessage = async () => {
        const timestamp = new Date().toLocaleString();
        const messageText = getDailyMessage();
        console.log(`[${timestamp}] Attempting to send rotation message to group: ${targetGroupId}`);
        try {
            const chat = await client.getChatById(targetGroupId);
            await chat.sendMessage(messageText);
            console.log(`[${timestamp}] SUCCESS: Message sent successfully!`);
        } catch (error) {
            console.error(`[${timestamp}] ERROR: Failed to send message:`, error);
        }
    };

    // Execute immediately and exit if in test mode
    if (IS_TEST_MODE) {
        console.log('[TEST] Executing immediate message send...');
        await sendMessage();
        console.log('[TEST] Message sent. Waiting 5 seconds to ensure delivery, then exiting...');
        setTimeout(async () => {
            await client.destroy();
            console.log('[SYSTEM] WhatsApp Client disconnected. Goodbye.');
            process.exit(0);
        }, 5000);
        return;
    }

    // Set up cron job scheduler
    if (cron.validate(CRON_SCHEDULE)) {
        console.log(`[SYSTEM] Scheduling message cron job with pattern: "${CRON_SCHEDULE}"`);
        cron.schedule(CRON_SCHEDULE, async () => {
            console.log('[SCHEDULER] Triggering scheduled job...');
            await sendMessage();
        }, {
            scheduled: true,
            timezone: TIMEZONE
        });
        console.log('[SYSTEM] Scheduler is active. Keep this process running.');
    } else {
        console.error(`[ERROR] Invalid cron schedule pattern: "${CRON_SCHEDULE}"`);
        console.log('[SYSTEM] Cron job not scheduled. Exiting...');
        await client.destroy();
        process.exit(1);
    }
});

// Handle graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`\n[SYSTEM] Received ${signal}. Cleaning up...`);
    try {
        await client.destroy();
        console.log('[SYSTEM] WhatsApp Client closed.');
    } catch (e) {
        console.error('[ERROR] Error while destroying client:', e);
    }
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Start the WhatsApp Web Client
client.initialize();

