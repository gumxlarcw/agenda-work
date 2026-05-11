const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
require('dotenv').config();

const pool = require('./config/database');

// C7: Validate SESSION_SECRET at startup
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: SESSION_SECRET must be set and at least 32 characters in production.');
        process.exit(1);
    } else {
        const generated = crypto.randomBytes(32).toString('hex');
        console.warn('WARNING: SESSION_SECRET is missing or too short. Generated a random one for dev mode.');
        process.env.SESSION_SECRET = generated;
    }
}

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const taskRoutes = require('./routes/task.routes');
const noteRoutes = require('./routes/note.routes');
const noteFolderRoutes = require('./routes/note-folder.routes');
const noteTagRoutes = require('./routes/note-tag.routes');
const noteTemplateRoutes = require('./routes/note-template.routes');
const noteAttachmentRoutes = require('./routes/note-attachment.routes');
const reminderRoutes = require('./routes/reminder.routes');
const todoRoutes = require('./routes/todo.routes');
const webhookRoutes = require('./routes/webhook.routes');
const whatsappRoutes = require('./routes/whatsapp.routes');
const statsRoutes = require('./routes/stats.routes');
const eventRoutes = require('./routes/event.routes');
const notificationRoutes = require('./routes/notification.routes');
const notificationSettingsRoutes = require('./routes/notificationSettings.routes');
const automationRoutes = require('./routes/automation.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const notulenRoutes = require('./routes/notulen.routes');

const app = express();
const PORT = process.env.PORT || 5100;

// Session store configuration
const sessionStore = new MySQLStore({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000,
    createDatabaseTable: true,
    schema: {
        tableName: 'sessions',
        columnNames: {
            session_id: 'session_id',
            expires: 'expires',
            data: 'data'
        }
    }
});

// Trust proxy (Cloudflare tunnel)
app.set('trust proxy', 1);

// Middleware
// M3: Hardened helmet configuration
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
        },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

const CORS_ORIGINS = [
    'https://agenda.bpsmalut.com',
    ...(process.env.NODE_ENV !== 'production'
        ? ['http://localhost:5101', 'http://localhost:5173']
        : []),
];

app.use(cors({
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file serving for uploads — B2: set Content-Type sniffing off + inline only for images

// Ensure YouTube tmp directory exists
const YT_TMP_DIR = path.join(__dirname, '../tmp/youtube');
try {
    fs.mkdirSync(YT_TMP_DIR, { recursive: true });
} catch (err) {
    console.warn(`[startup] Could not create YT_TMP_DIR: ${err.message}`);
}
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
    setHeaders: (res, filePath) => {
        // Prevent MIME type sniffing
        res.set('X-Content-Type-Options', 'nosniff');
        // Only allow inline display for known image types
        const ext = path.extname(filePath).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
            res.set('Content-Disposition', 'attachment');
        }
    }
}));

app.use(session({
    key: 'agenda_work_session',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 86400000, // 24 hours
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
}));

// Rate limiters
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { success: false, message: 'Too many auth attempts, try again later' } });
const automationLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { success: false, message: 'Too many automation requests, try again later' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: { success: false, message: 'Too many requests, try again later' } });

// Check binary availability for health check
function checkBinary(bin, args = ['--version']) {
    return new Promise((resolve) => {
        execFile(bin, args, { timeout: 3000 }, (err) => resolve(!err));
    });
}

// Health check — also pings the database
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        const [ytdlp, ffmpeg] = await Promise.all([
            checkBinary('/home/linuxbrew/.linuxbrew/bin/yt-dlp'),
            checkBinary('/usr/bin/ffmpeg', ['-version']),
        ]);
        res.json({ status: 'ok', db: 'ok', ytdlp, ffmpeg, timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'degraded', db: 'error', error: err.message, timestamp: new Date().toISOString() });
    }
});

// Apply rate limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/automation', automationLimiter);
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tasks', taskRoutes);
// Note sub-routes BEFORE main /api/notes to avoid /:id catch
app.use('/api/notes/folders', noteFolderRoutes);
app.use('/api/notes/tags', noteTagRoutes);
app.use('/api/notes/templates', noteTemplateRoutes);
app.use('/api/notes', noteAttachmentRoutes);
app.use('/api/notes', noteRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/todos', todoRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/kegiatan', eventRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/notification-settings', notificationSettingsRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notulen', notulenRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Agenda Work API running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    if (process.send) process.send('ready');
});

// WebSocket for Notulen AI live transcription
const { setupNotulenWebSocket } = require('./routes/notulen.routes');
const notulenWss = setupNotulenWebSocket();
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/ws/notulen') {
        notulenWss.handleUpgrade(request, socket, head, (ws) => {
            notulenWss.emit('connection', ws, request);
        });
    } else {
        socket.destroy();
    }
});

function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    server.close(() => {
        console.log('HTTP server closed');
        pool.end().then(() => {
            console.log('DB pool closed');
            process.exit(0);
        }).catch(() => process.exit(1));
    });
    setTimeout(() => { console.error('Forced shutdown'); process.exit(1); }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); process.exit(1); });
process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason); process.exit(1); });

module.exports = app;
