const express = require('express');
const crypto = require('crypto');
const pool = require('../config/database');
const taskSyncService = require('../services/task-sync.service');

const router = express.Router();

// Webhook authentication — only allow requests from OpenClaw bridge
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || null;
router.use((req, res, next) => {
    // If secret is configured, enforce it; otherwise allow localhost only
    if (WEBHOOK_SECRET) {
        const provided = req.headers['x-webhook-secret'] || '';
        // Use timing-safe comparison to prevent timing attacks
        const secretBuf = Buffer.from(WEBHOOK_SECRET, 'utf8');
        const providedBuf = Buffer.from(provided, 'utf8');
        if (secretBuf.length !== providedBuf.length || !crypto.timingSafeEqual(secretBuf, providedBuf)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
    } else {
        const ip = req.ip || req.connection.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
    }
    next();
});

// Consistent date display formatter — DD MMM YYYY (e.g. "04 Mar 2026")
const displayDate = (dateVal) => {
    if (!dateVal) return null;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = String(d.getDate()).padStart(2, '0');
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const displayDateTime = (dateVal) => {
    if (!dateVal) return null;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    const datePart = displayDate(dateVal);
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${datePart} ${hours}:${mins}`;
};

// Valid values for parsing
const VALID_PREFIXES = ['Membuat', 'Melakukan', 'Mengikuti', 'Mengisi', 'Memberikan', 'Mengumpulkan'];
const VALID_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const VALID_STATUSES = ['Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'];

// Conversation sessions for multi-step task creation
// Key: phone_number, Value: { step, data, lastActivity, type }
const conversationSessions = new Map();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Task creation steps (kegiatan is auto-generated from prefix + task)
const TASK_CREATION_STEPS = [
    { field: 'task', prompt: '📋 *Langkah 1/6* - Nama Task\n\nApa nama task-nya?', required: true },
    { field: 'prefix', prompt: '🏷️ *Langkah 2/6* - Jenis Aktivitas\n\nPilih jenis aktivitas:\n\n1️⃣ Membuat\n2️⃣ Melakukan\n3️⃣ Mengikuti\n4️⃣ Mengisi\n5️⃣ Memberikan\n6️⃣ Mengumpulkan\n\n_Ketik nomor atau nama aktivitas_', required: true },
    { field: 'rencana_kinerja', prompt: '🎯 *Langkah 3/6* - Rencana Kinerja\n\nApa target/rencana kinerja dari task ini?\n\n_Contoh: Laporan selesai 100% dengan data akurat_', required: false },
    { field: 'priority', prompt: '⚡ *Langkah 4/6* - Prioritas\n\nPilih prioritas:\n\n🔴 P0 - Critical/Urgent\n🟠 P1 - High/Penting\n🟡 P2 - Medium/Normal\n🟢 P3 - Low/Rendah\n\n_Ketik P0, P1, P2, atau P3_', required: true },
    { field: 'start_date', prompt: '📅 *Langkah 5/6* - Tanggal Mulai\n\nKapan task ini dimulai?\n\n_Format: YYYY-MM-DD atau "hari ini", "besok"_', required: true },
    { field: 'end_date', prompt: '🎯 *Langkah 6/6* - Deadline\n\nKapan deadline-nya?\n\n_Format: YYYY-MM-DD atau "minggu depan"_\n\n⏰ _Reminder otomatis H-1 dan hari H jam 08:00_', required: true }
];

// Task completion steps - required fields before marking complete
const TASK_COMPLETION_STEPS = [
    { field: 'capaian', prompt: '📊 *Langkah 1/3* - Capaian\n\nApa hasil/capaian dari task ini?\n\n_Contoh: Laporan selesai 100% tepat waktu_', required: true },
    { field: 'bukti_dukung', prompt: '🔗 *Langkah 2/3* - Bukti Dukung (URL)\n\nMasukkan link bukti pendukung:\n\n_Contoh: https://docs.google.com/..._', required: true },
    { field: 'notes', prompt: '📝 *Langkah 3/3* - Catatan (Opsional)\n\nAda catatan tambahan?\n\n_Ketik "skip" jika tidak ada_', required: false }
];

// Clean up expired sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [phone, session] of conversationSessions.entries()) {
        if (now - session.lastActivity > SESSION_TIMEOUT) {
            conversationSessions.delete(phone);
        }
    }
}, 60000); // Check every minute

/**
 * Get or create conversation session
 */
const getSession = (phoneNumber) => {
    return conversationSessions.get(phoneNumber);
};

/**
 * Start a new task creation session
 */
const startTaskCreationSession = (phoneNumber, initialData = {}, forceFromStart = false) => {
    const session = {
        type: 'create_task',
        step: 0,
        data: {
            task: initialData.task || '',
            prefix: initialData.prefix || '',
            rencana_kinerja: initialData.rencana_kinerja || '',
            priority: initialData.priority || '',
            start_date: initialData.start_date || '',
            end_date: initialData.end_date || '',
            status: 'Pending'
        },
        lastActivity: Date.now()
    };
    
    // If forceFromStart, always start at step 0
    if (forceFromStart) {
        session.step = 0;
    } else {
        // Find the first missing field (required or optional)
        for (let i = 0; i < TASK_CREATION_STEPS.length; i++) {
            const step = TASK_CREATION_STEPS[i];
            if (!session.data[step.field]) {
                session.step = i;
                break;
            }
            session.step = i + 1;
        }
    }
    
    conversationSessions.set(phoneNumber, session);
    return session;
};

/**
 * Process step response and move to next step
 */
const processTaskStepResponse = (phoneNumber, message) => {
    const session = getSession(phoneNumber);
    if (!session || session.type !== 'create_task') return null;
    
    session.lastActivity = Date.now();
    const currentStep = TASK_CREATION_STEPS[session.step];
    
    if (!currentStep) return null;
    
    const lowerMessage = message.toLowerCase().trim();
    
    // Handle skip for optional fields
    if (!currentStep.required && (lowerMessage === 'skip' || lowerMessage === 'lewati' || lowerMessage === '-')) {
        session.data[currentStep.field] = null;
    } else {
        // Process the response based on field type
        switch (currentStep.field) {
            case 'prefix':
                const prefixMap = { '1': 'Membuat', '2': 'Melakukan', '3': 'Mengikuti', '4': 'Mengisi', '5': 'Memberikan', '6': 'Mengumpulkan' };
                if (prefixMap[message.trim()]) {
                    session.data.prefix = prefixMap[message.trim()];
                } else {
                    const foundPrefix = VALID_PREFIXES.find(p => lowerMessage.includes(p.toLowerCase()));
                    session.data.prefix = foundPrefix || 'Membuat';
                }
                break;
                
            case 'priority':
                if (/p0|critical|urgent|darurat/i.test(lowerMessage)) {
                    session.data.priority = 'P0';
                } else if (/p1|high|penting/i.test(lowerMessage)) {
                    session.data.priority = 'P1';
                } else if (/p3|low|rendah/i.test(lowerMessage)) {
                    session.data.priority = 'P3';
                } else {
                    session.data.priority = 'P2';
                }
                break;
                
            case 'start_date':
            case 'end_date':
                session.data[currentStep.field] = parseDateInput(message);
                break;
                
            default:
                session.data[currentStep.field] = message.trim();
        }
    }
    
    // Move to next step
    session.step++;
    
    // Check if all steps are complete
    if (session.step >= TASK_CREATION_STEPS.length) {
        return { complete: true, data: session.data };
    }
    
    // Return next prompt
    const nextStep = TASK_CREATION_STEPS[session.step];
    let prompt = nextStep.prompt;
    if (!nextStep.required) {
        prompt += '\n\n_Ketik "skip" untuk lewati_';
    }
    
    return { complete: false, prompt };
};

/**
 * Parse date input from various formats
 */
const parseDateInput = (input) => {
    const lowerInput = input.toLowerCase().trim();
    const today = new Date();
    
    // Natural language dates
    if (/hari ini|today|sekarang/i.test(lowerInput)) {
        return today.toISOString().split('T')[0];
    }
    if (/besok|tomorrow/i.test(lowerInput)) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    }
    if (/lusa/i.test(lowerInput)) {
        const dayAfter = new Date(today);
        dayAfter.setDate(dayAfter.getDate() + 2);
        return dayAfter.toISOString().split('T')[0];
    }
    if (/minggu depan|next week/i.test(lowerInput)) {
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        return nextWeek.toISOString().split('T')[0];
    }
    if (/bulan depan|next month/i.test(lowerInput)) {
        const nextMonth = new Date(today);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        return nextMonth.toISOString().split('T')[0];
    }
    
    // Check for relative days like "3 hari lagi"
    const relativeDays = lowerInput.match(/(\d+)\s*hari\s*(lagi|kedepan)/i);
    if (relativeDays) {
        const days = parseInt(relativeDays[1]);
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + days);
        return futureDate.toISOString().split('T')[0];
    }
    
    // Check for DD/MM/YYYY format
    const dmyMatch = input.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }
    
    // Check for YYYY-MM-DD format
    const ymdMatch = input.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (ymdMatch) {
        return input.trim();
    }
    
    // Default to today if can't parse
    return today.toISOString().split('T')[0];
};

/**
 * Cancel current session
 */
const cancelSession = (phoneNumber) => {
    conversationSessions.delete(phoneNumber);
};

/**
 * Check if there's an active session
 */
const hasActiveSession = (phoneNumber) => {
    const session = getSession(phoneNumber);
    if (!session) return false;
    
    // Check if session is expired
    if (Date.now() - session.lastActivity > SESSION_TIMEOUT) {
        conversationSessions.delete(phoneNumber);
        return false;
    }
    
    return true;
};

/**
 * Start a task completion session
 */
const startTaskCompletionSession = (phoneNumber, taskId, taskData) => {
    const session = {
        type: 'complete_task',
        step: 0,
        taskId: taskId,
        taskData: taskData,
        data: {
            capaian: taskData.capaian || '',
            bukti_dukung: taskData.bukti_dukung || '',
            notes: taskData.notes || ''
        },
        lastActivity: Date.now()
    };
    
    // Find the first missing required field
    for (let i = 0; i < TASK_COMPLETION_STEPS.length; i++) {
        const step = TASK_COMPLETION_STEPS[i];
        if (!session.data[step.field]) {
            session.step = i;
            break;
        }
        session.step = i + 1;
    }
    
    conversationSessions.set(phoneNumber, session);
    return session;
};

/**
 * Process completion step response and move to next step
 */
const processCompletionStepResponse = (phoneNumber, message) => {
    const session = getSession(phoneNumber);
    if (!session || session.type !== 'complete_task') return null;
    
    session.lastActivity = Date.now();
    const currentStep = TASK_COMPLETION_STEPS[session.step];
    
    if (!currentStep) return null;
    
    const lowerMessage = message.toLowerCase().trim();
    
    // Handle skip for optional fields
    if (!currentStep.required && (lowerMessage === 'skip' || lowerMessage === 'lewati' || lowerMessage === '-')) {
        session.data[currentStep.field] = null;
    } else {
        session.data[currentStep.field] = message.trim();
    }
    
    // Move to next step
    session.step++;
    
    // Check if all steps are complete
    if (session.step >= TASK_COMPLETION_STEPS.length) {
        return { complete: true, data: session.data, taskId: session.taskId, taskData: session.taskData };
    }
    
    // Return next prompt
    const nextStep = TASK_COMPLETION_STEPS[session.step];
    let prompt = nextStep.prompt;
    if (!nextStep.required) {
        prompt += '\n\n_Ketik "skip" untuk lewati_';
    }
    
    return { complete: false, prompt };
};

// Natural language patterns for AI-like understanding
const INTENT_PATTERNS = {
    help: [
        /^(help|bantuan|bantu|tolong|cara|gimana|bagaimana|apa aja|perintah|command)/i,
        /cara (pakai|menggunakan|gunakan)/i,
        /apa (yang bisa|yg bisa|bisa) (kamu|lu|lo) (lakukan|kerjakan)/i
    ],
    summary: [
        /^(summary|ringkasan|statistik|stats|rekap|rekapan)/i,
        /(berapa|jumlah) (task|tugas|todo|catatan)/i,
        /status (semua|keseluruhan|overall)/i,
        /laporan (harian|mingguan|saya)/i
    ],
    list: [
        /^(list|daftar|tampilkan|tunjukkan|show|lihat semua)/i,
        /apa (saja|aja) (task|tugas|todo|catatan|reminder)/i,
        /(semua|all) (task|tugas|todo|catatan|reminder)/i,
        /task (apa|yang) (ada|tersedia|pending)/i
    ],
    multi_task: [
        /pisahkan?\s*(jadi|menjadi)?\s*\d+\s*task/i,
        /buat\s*\d+\s*task/i,
        /dengan\s*rincian/i,
        /jadwal\s*(sebagai\s*)?berikut/i,
        /beberapa\s*(task|kegiatan)/i
    ],
    delete: [
        /(hapus|delete|buang|remove|hilangkan|batalkan)/i
    ],
    update: [
        /(update|ubah|edit|ganti|perbarui|change|modify)/i,
        /jadikan? (#\d+)/i,
        /set (#\d+)/i
    ],
    detail: [
        /^detail/i,
        /lihat (#\d+)/i,
        /show (#\d+)/i,
        /info (task|tugas|todo|catatan|reminder) (#\d+)/i,
        /cek (#\d+)/i
    ],
    search: [
        /^(cari|search|find|temukan|lookup)/i,
        /mana (yang|yg)/i,
        /ada (ga|gak|tidak|nggak).*yang/i
    ],
    complete: [
        /(selesai|done|complete|finish|sudah|udah|kelar|beres)/i,
        /tandai.*selesai/i,
        /mark.*done/i
    ],
    create_task: [
        /^(task|tugas|kerjaan)/i,
        /(buat|tambah|add|create|new|bikin).*(task|tugas|kerjaan)/i,
        /(task|tugas|kerjaan).*(baru|new)/i,
        /^(membuat|melakukan|mengikuti|mengisi|memberikan|mengumpulkan)/i
    ],
    create_note: [
        /^(catatan|note|catat)/i,
        /(buat|tambah|add|create|new|bikin).*(catatan|note)/i,
        /catat(kan|in)?/i,
        /tulis(kan|in)?/i
    ],
    create_reminder: [
        /^(reminder|pengingat|ingatkan|alarm)/i,
        /(buat|tambah|set|pasang).*(reminder|pengingat|alarm)/i,
        /ingatkan (aku|saya|gue|gw)/i,
        /jangan lupa/i,
        /remind me/i
    ],
    create_todo: [
        /^(todo|to-do|to do)/i,
        /(buat|tambah|add).*(todo)/i,
        /harus (dikerjakan|dilakukan|selesai)/i
    ]
};

/**
 * AI-like Natural Language Parser
 * Understands context and variations in how users express commands
 */
const parseMessage = (message) => {
    const lowerMessage = message.toLowerCase().trim();
    const originalMessage = message.trim();
    
    // Detect intent using pattern matching with priority
    let intent = null;
    let data = {};
    let confidence = 0;

    // Check patterns in priority order (multi_task checked early for bullet lists)
    const intentOrder = ['help', 'summary', 'list', 'multi_task', 'delete', 'update', 'detail', 'search', 'complete', 
                         'create_task', 'create_note', 'create_reminder', 'create_todo'];
    
    for (const intentName of intentOrder) {
        const patterns = INTENT_PATTERNS[intentName];
        for (const pattern of patterns) {
            if (pattern.test(lowerMessage)) {
                intent = intentName;
                confidence = 1;
                break;
            }
        }
        if (intent) break;
    }
    
    // Also detect multi_task if message has bullet points or numbered list with multiple items
    if (!intent || intent === 'create_task') {
        const bulletItems = originalMessage.match(/^[\s]*[-•*]\s*.+/gm) || [];
        const numberedItems = originalMessage.match(/^[\s]*\d+[.)]\s*.+/gm) || [];
        if (bulletItems.length >= 2 || numberedItems.length >= 2) {
            intent = 'multi_task';
        }
    }

    // Smart fallback: try to understand context if no pattern matched
    if (!intent) {
        intent = smartContextDetection(lowerMessage, originalMessage);
    }

    // Parse data based on intent
    switch (intent) {
        case 'create_task':
            data = parseTaskMessage(originalMessage);
            break;
        case 'multi_task':
            data = parseMultiTaskMessage(originalMessage);
            break;
        case 'create_note':
            data = parseNoteMessage(originalMessage);
            break;
        case 'create_reminder':
            data = parseReminderMessage(originalMessage);
            break;
        case 'create_todo':
            data = parseTodoMessage(originalMessage);
            break;
        case 'list':
            data = parseListMessage(originalMessage);
            break;
        case 'delete':
            data = parseDeleteMessage(originalMessage);
            break;
        case 'update':
            data = parseUpdateMessage(originalMessage);
            break;
        case 'detail':
            data = parseDetailMessage(originalMessage);
            break;
        case 'search':
            data = parseSearchMessage(originalMessage);
            break;
        case 'complete':
            data = parseCompleteMessage(originalMessage);
            break;
    }

    return { intent, data, confidence };
};

/**
 * Smart context detection for messages that don't match explicit patterns
 */
const smartContextDetection = (lowerMessage, originalMessage) => {
    // Check if message contains an ID reference
    const hasId = /#\d+/.test(lowerMessage);
    
    // Check for time-related words (likely reminder)
    const timeWords = /(besok|lusa|jam|pagi|siang|sore|malam|minggu depan|bulan depan|nanti|hari ini)/i;
    const hasTimeRef = timeWords.test(lowerMessage);
    
    // Check for action verbs at start
    const startsWithAction = /^(buat|bikin|tambah|add|create|new)/i.test(lowerMessage);
    
    // Check for prefix words (likely task)
    const hasPrefix = VALID_PREFIXES.some(p => lowerMessage.includes(p.toLowerCase()));
    
    // Check for priority mentions
    const hasPriority = /p[0-3]|urgent|penting|prioritas/i.test(lowerMessage);
    
    // Decision tree
    if (hasId) {
        // Has ID - likely referring to existing item
        if (/selesai|done|complete|sudah|udah/i.test(lowerMessage)) return 'complete';
        if (/hapus|delete|buang/i.test(lowerMessage)) return 'delete';
        if (/update|ubah|ganti|edit/i.test(lowerMessage)) return 'update';
        return 'detail';
    }
    
    if (hasTimeRef && !hasPriority) {
        return 'create_reminder';
    }
    
    if (hasPrefix || hasPriority) {
        return 'create_task';
    }
    
    if (startsWithAction) {
        // Generic create - try to detect type
        if (/catatan|note|tulis/i.test(lowerMessage)) return 'create_note';
        if (/todo/i.test(lowerMessage)) return 'create_todo';
        if (/reminder|ingatkan/i.test(lowerMessage)) return 'create_reminder';
        return 'create_task'; // Default to task
    }
    
    // Check if it looks like a simple note/memo
    if (lowerMessage.length > 10 && !hasId && !startsWithAction) {
        // Could be a quick note
        return 'create_note';
    }
    
    return null; // Can't determine intent
};

const parseTaskMessage = (message) => {
    const data = {
        task: '',
        prefix: '',
        rencana_kinerja: '',
        priority: '',
        start_date: '',
        end_date: '',
        status: 'Pending',
        _detected: [] // Track what was detected for AI feedback
    };

    const lowerMessage = message.toLowerCase();
    const today = new Date();

    // Extract prefix - check for prefix words at start or in message
    for (const prefix of VALID_PREFIXES) {
        const prefixLower = prefix.toLowerCase();
        if (lowerMessage.includes(prefixLower)) {
            data.prefix = prefix;
            data._detected.push(`prefix: ${prefix}`);
            break;
        }
    }

    // Extract priority from various natural expressions
    if (/\bp0\b|urgent|darurat|sangat penting|critical/i.test(message)) {
        data.priority = 'P0';
        data._detected.push('priority: P0 (Urgent)');
    } else if (/\bp1\b|penting|important|high priority/i.test(message)) {
        data.priority = 'P1';
        data._detected.push('priority: P1 (High)');
    } else if (/\bp3\b|rendah|low|nanti|kapan-kapan|santai/i.test(message)) {
        data.priority = 'P3';
        data._detected.push('priority: P3 (Low)');
    } else if (/\bp2\b|medium|normal|biasa/i.test(message)) {
        data.priority = 'P2';
        data._detected.push('priority: P2 (Medium)');
    }

    // Extract dates - support multiple formats
    const datePatterns = [
        /(\d{4}-\d{2}-\d{2})/g,  // YYYY-MM-DD
        /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g,  // DD/MM/YYYY or DD-MM-YYYY
    ];
    
    let dates = [];
    for (const pattern of datePatterns) {
        const matches = message.match(pattern);
        if (matches) dates.push(...matches);
    }
    
    // Check for deadline keywords to know which date is end_date
    const hasDeadlineKeyword = /deadline|target|selesai|batas|due/i.test(lowerMessage);
    const hasStartKeyword = /mulai|start|dari/i.test(lowerMessage);
    
    // Natural date expressions
    if (/hari ini|today/i.test(lowerMessage)) {
        const todayStr = today.toISOString().split('T')[0];
        if (hasDeadlineKeyword) {
            data.end_date = todayStr;
            data._detected.push(`deadline: hari ini (${todayStr})`);
        } else {
            data.start_date = todayStr;
            data._detected.push(`mulai: hari ini (${todayStr})`);
        }
    }
    
    if (/besok|tomorrow/i.test(lowerMessage)) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];
        if (hasDeadlineKeyword && !data.end_date) {
            data.end_date = tomorrowStr;
            data._detected.push(`deadline: besok (${tomorrowStr})`);
        } else if (!data.start_date) {
            data.start_date = tomorrowStr;
            data._detected.push(`mulai: besok (${tomorrowStr})`);
        }
    }
    
    if (/lusa/i.test(lowerMessage)) {
        const dayAfter = new Date(today);
        dayAfter.setDate(dayAfter.getDate() + 2);
        const dayAfterStr = dayAfter.toISOString().split('T')[0];
        if (hasDeadlineKeyword && !data.end_date) {
            data.end_date = dayAfterStr;
            data._detected.push(`deadline: lusa (${dayAfterStr})`);
        } else if (!data.start_date) {
            data.start_date = dayAfterStr;
            data._detected.push(`mulai: lusa (${dayAfterStr})`);
        }
    }
    
    if (/minggu depan|next week/i.test(lowerMessage)) {
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];
        data.end_date = nextWeekStr;
        data._detected.push(`deadline: minggu depan (${nextWeekStr})`);
    }
    
    if (/bulan depan|next month/i.test(lowerMessage)) {
        const nextMonth = new Date(today);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const nextMonthStr = nextMonth.toISOString().split('T')[0];
        data.end_date = nextMonthStr;
        data._detected.push(`deadline: bulan depan (${nextMonthStr})`);
    }
    
    // Check for relative days like "3 hari lagi"
    const relativeDays = lowerMessage.match(/(\d+)\s*hari\s*(lagi|kedepan)/i);
    if (relativeDays) {
        const days = parseInt(relativeDays[1]);
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + days);
        const futureDateStr = futureDate.toISOString().split('T')[0];
        data.end_date = futureDateStr;
        data._detected.push(`deadline: ${days} hari lagi (${futureDateStr})`);
    }
    
    // Process explicit dates
    if (dates.length >= 1) {
        const formattedDate1 = formatDate(dates[0]);
        if (!data.start_date && !hasDeadlineKeyword) {
            data.start_date = formattedDate1;
            data._detected.push(`mulai: ${formattedDate1}`);
        } else if (!data.end_date) {
            data.end_date = formattedDate1;
            data._detected.push(`deadline: ${formattedDate1}`);
        }
        
        if (dates.length >= 2) {
            const formattedDate2 = formatDate(dates[1]);
            if (!data.end_date) {
                data.end_date = formattedDate2;
                data._detected.push(`deadline: ${formattedDate2}`);
            }
        }
    }
    
    // If only end_date detected, set start_date to today
    if (data.end_date && !data.start_date) {
        data.start_date = today.toISOString().split('T')[0];
        data._detected.push(`mulai: hari ini (auto)`);
    }

    // Extract task name - more flexible patterns
    let taskName = message;
    
    // Remove common prefixes
    taskName = taskName.replace(/^(task|tugas|kerjaan|buat|bikin|tambah|add|create|new)[:\s]*/i, '');
    
    // Remove priority markers
    taskName = taskName.replace(/\b(priority|prioritas|p[0-3]|urgent|penting|darurat|rendah|low|high|medium|normal|santai)\b/gi, '');
    
    // Remove date expressions
    taskName = taskName.replace(/\b(hari ini|besok|lusa|minggu depan|bulan depan|today|tomorrow|next week|next month)\b/gi, '');
    taskName = taskName.replace(/\d+\s*hari\s*(lagi|kedepan)/gi, '');
    taskName = taskName.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g, '');
    
    // Remove timing/deadline words
    taskName = taskName.replace(/\b(mulai|selesai|dari|sampai|hingga|deadline|target|batas|due|start)\b/gi, '');
    
    // Clean up extra spaces and punctuation
    taskName = taskName.replace(/\s+/g, ' ').replace(/^[\s,\-:]+|[\s,\-:]+$/g, '').trim();
    
    if (taskName && taskName.length > 2) {
        data.task = taskName;
        data._detected.push(`nama: ${taskName}`);
    }

    return data;
};

/**
 * Parse multi-task message with bullet points or numbered list
 * Example: 
 * "Mengikuti Pelatihan X dengan rincian:
 * - Non Klasikal Overview (zoom): 5 Februari 2026
 * - Pembelajaran Mandiri (MOOC): 5-6 Februari 2026"
 */
const parseMultiTaskMessage = (message) => {
    const data = {
        mainTitle: '',
        prefix: '',
        tasks: [],
        priority: 'P2'
    };
    
    const lines = message.split('\n').map(l => l.trim()).filter(l => l);
    
    // Extract prefix from message
    for (const prefix of VALID_PREFIXES) {
        if (message.toLowerCase().includes(prefix.toLowerCase())) {
            data.prefix = prefix;
            break;
        }
    }
    if (!data.prefix) data.prefix = 'Mengikuti'; // Default for training/meetings
    
    // Extract priority
    if (/\bp0\b|urgent|darurat|critical/i.test(message)) {
        data.priority = 'P0';
    } else if (/\bp1\b|penting|important/i.test(message)) {
        data.priority = 'P1';
    } else if (/\bp3\b|rendah|low|santai/i.test(message)) {
        data.priority = 'P3';
    }
    
    // Find the main title (first line or line before bullet points)
    let mainTitleLines = [];
    let bulletStartIndex = 0;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^[-•*]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
            bulletStartIndex = i;
            break;
        }
        mainTitleLines.push(line);
    }
    
    // Clean main title
    let mainTitle = mainTitleLines.join(' ')
        .replace(/^(tambahkan?\s*(ke\s*)?task|buat\s*task|task)[:\s]*/i, '')
        .replace(/dengan\s*rincian\s*(jadwal\s*)?(sebagai\s*)?berikut[:\s]*/i, '')
        .replace(/pisahkan?\s*(jadi|menjadi)?\s*\d+\s*task/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    data.mainTitle = mainTitle;
    
    // Parse each bullet item
    for (let i = bulletStartIndex; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if it's a bullet or numbered item
        const bulletMatch = line.match(/^[-•*]\s+(.+)/) || line.match(/^\d+[.)]\s+(.+)/);
        if (!bulletMatch) continue;
        
        let itemText = bulletMatch[1].trim();
        
        // Extract date from item
        const dateInfo = extractDateFromText(itemText);
        
        // Clean item text (remove date parts)
        let taskName = itemText
            .replace(/:\s*\d+[-–]\d+\s*(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*\d{4}/gi, '')
            .replace(/:\s*\d+\s*(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*\d{4}/gi, '')
            .replace(/\d+[-–]\d+\s*(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*\d{4}/gi, '')
            .replace(/\d+\s*(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s*\d{4}/gi, '')
            .replace(/\s*:\s*$/, '')
            .trim();
        
        if (taskName) {
            data.tasks.push({
                name: taskName,
                start_date: dateInfo.start_date,
                end_date: dateInfo.end_date
            });
        }
    }
    
    return data;
};

/**
 * Extract date from text like "5 Februari 2026" or "5-6 Februari 2026"
 */
const extractDateFromText = (text) => {
    const months = {
        'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
        'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
        'september': '09', 'oktober': '10', 'november': '11', 'desember': '12',
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
        'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };
    
    const result = { start_date: null, end_date: null };
    
    // Pattern for date range: "5-6 Februari 2026" or "9-11 Februari 2026"
    const rangePattern = /(\d{1,2})[-–](\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i;
    const rangeMatch = text.match(rangePattern);
    
    if (rangeMatch) {
        const startDay = rangeMatch[1].padStart(2, '0');
        const endDay = rangeMatch[2].padStart(2, '0');
        const month = months[rangeMatch[3].toLowerCase()];
        const year = rangeMatch[4];
        
        result.start_date = `${year}-${month}-${startDay}`;
        result.end_date = `${year}-${month}-${endDay}`;
        return result;
    }
    
    // Pattern for single date: "5 Februari 2026"
    const singlePattern = /(\d{1,2})\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\s+(\d{4})/i;
    const singleMatch = text.match(singlePattern);
    
    if (singleMatch) {
        const day = singleMatch[1].padStart(2, '0');
        const month = months[singleMatch[2].toLowerCase()];
        const year = singleMatch[3];
        
        result.start_date = `${year}-${month}-${day}`;
        result.end_date = `${year}-${month}-${day}`;
        return result;
    }
    
    // Fallback to today
    const today = new Date().toISOString().split('T')[0];
    result.start_date = today;
    result.end_date = today;
    
    return result;
};

const parseNoteMessage = (message) => {
    const data = {
        title: '',
        content: ''
    };

    // Clean up the message - remove trigger words
    let cleaned = message.replace(/^(catatan|note|catat|tulis|buat catatan|bikin catatan)[:\s]*/i, '').trim();
    cleaned = cleaned.replace(/^(buat|bikin|tambah|add|new)[:\s]*/i, '').trim();
    
    // Try different separator patterns
    const separators = ['|', ' - ', ' : ', '\n'];
    for (const sep of separators) {
        const idx = cleaned.indexOf(sep);
        if (idx > 0 && idx < cleaned.length - 1) {
            data.title = cleaned.substring(0, idx).trim();
            data.content = cleaned.substring(idx + sep.length).trim();
            return data;
        }
    }
    
    // No separator found - use first line or first sentence as title
    const firstSentence = cleaned.match(/^([^.!?\n]+[.!?]?)/);
    if (firstSentence && cleaned.length > firstSentence[1].length) {
        data.title = firstSentence[1].trim();
        data.content = cleaned.substring(firstSentence[1].length).trim();
    } else {
        // Just use the whole thing as title
        data.title = cleaned.substring(0, 100) || 'Catatan Baru';
        data.content = cleaned.length > 100 ? cleaned.substring(100) : '';
    }

    return data;
};

const parseReminderMessage = (message) => {
    const data = {
        title: '',
        reminder_datetime: null
    };

    const lowerMessage = message.toLowerCase();
    const now = new Date();
    
    // Day parsing
    if (/hari ini|today|sekarang/i.test(lowerMessage)) {
        // Keep today
    } else if (/besok|tomorrow/i.test(lowerMessage)) {
        now.setDate(now.getDate() + 1);
    } else if (/lusa/i.test(lowerMessage)) {
        now.setDate(now.getDate() + 2);
    } else if (/minggu depan|next week/i.test(lowerMessage)) {
        now.setDate(now.getDate() + 7);
    } else if (/bulan depan|next month/i.test(lowerMessage)) {
        now.setMonth(now.getMonth() + 1);
    }
    
    // Day of week parsing
    const dayNames = {
        'senin': 1, 'selasa': 2, 'rabu': 3, 'kamis': 4, 'jumat': 5, 'sabtu': 6, 'minggu': 0,
        'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6, 'sunday': 0
    };
    for (const [dayName, dayNum] of Object.entries(dayNames)) {
        if (lowerMessage.includes(dayName)) {
            const currentDay = now.getDay();
            let daysToAdd = dayNum - currentDay;
            if (daysToAdd <= 0) daysToAdd += 7; // Next week if today or past
            now.setDate(now.getDate() + daysToAdd);
            break;
        }
    }

    // Time parsing - multiple formats
    const timePatterns = [
        /jam\s*(\d{1,2})(?:[:\.](\d{2}))?\s*(pagi|siang|sore|malam)?/i,
        /pukul\s*(\d{1,2})(?:[:\.](\d{2}))?/i,
        /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
        /(\d{1,2})\s*(pagi|siang|sore|malam)/i
    ];
    
    for (const pattern of timePatterns) {
        const timeMatch = lowerMessage.match(pattern);
        if (timeMatch) {
            let hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2] || 0);
            const period = timeMatch[3]?.toLowerCase();
            
            // Adjust for AM/PM or Indonesian time words
            if (period === 'pm' || period === 'sore' || period === 'malam') {
                if (hours < 12) hours += 12;
            } else if (period === 'pagi' && hours === 12) {
                hours = 0;
            }
            
            now.setHours(hours, minutes, 0, 0);
            break;
        }
    }
    
    // If no time specified, default to 9 AM
    if (!timePatterns.some(p => p.test(lowerMessage))) {
        now.setHours(9, 0, 0, 0);
    }

    data.reminder_datetime = now.toISOString();

    // Extract title - remove all time-related words
    let title = message;
    title = title.replace(/^(reminder|ingatkan|pengingat|jangan lupa|remind me|buat reminder)[:\s]*/i, '');
    title = title.replace(/\b(besok|lusa|hari ini|today|tomorrow|minggu depan|bulan depan)\b/gi, '');
    title = title.replace(/\b(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, '');
    title = title.replace(/\b(jam|pukul)\s*\d+[:\.]?\d*\s*(pagi|siang|sore|malam)?/gi, '');
    title = title.replace(/\d{1,2}:\d{2}\s*(am|pm)?/gi, '');
    title = title.replace(/\b(pagi|siang|sore|malam)\b/gi, '');
    title = title.replace(/\s+/g, ' ').trim();
    
    data.title = title || 'Reminder';

    return data;
};

const parseTodoMessage = (message) => {
    const data = {
        title: '',
        priority: 'Medium'
    };

    const lowerMessage = message.toLowerCase();

    // Extract priority - natural language
    if (/urgent|darurat|segera|asap|penting banget|sangat penting|critical/i.test(lowerMessage)) {
        data.priority = 'High';
    } else if (/penting|important|high/i.test(lowerMessage)) {
        data.priority = 'High';
    } else if (/rendah|low|nanti|kapan.?kapan|santai/i.test(lowerMessage)) {
        data.priority = 'Low';
    }

    // Extract title
    let title = message;
    title = title.replace(/^(todo|to-do|to do|buat todo|tambah todo)[:\s]*/i, '');
    title = title.replace(/\b(urgent|penting|rendah|low|high|darurat|segera|asap|santai)\b/gi, '');
    title = title.replace(/\s+/g, ' ').trim();
    
    data.title = title || 'Todo';

    // Extract due date - natural language
    const today = new Date();
    if (/hari ini|today/i.test(lowerMessage)) {
        data.due_date = today.toISOString().split('T')[0];
    } else if (/besok|tomorrow/i.test(lowerMessage)) {
        today.setDate(today.getDate() + 1);
        data.due_date = today.toISOString().split('T')[0];
    } else if (/minggu depan|next week/i.test(lowerMessage)) {
        today.setDate(today.getDate() + 7);
        data.due_date = today.toISOString().split('T')[0];
    }
    
    // Also check for explicit dates
    const dateMatch = message.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    if (dateMatch) {
        data.due_date = formatDate(dateMatch[1]);
    }

    return data;
};

const parseCompleteMessage = (message) => {
    // Extract task/todo ID - with or without #
    const idMatch = message.match(/#?(\d+)/);
    if (idMatch) {
        return { id: parseInt(idMatch[1]) };
    }
    
    return { search: message.replace(/selesai|complete|done|task|todo/gi, '').trim() };
};

const parseListMessage = (message) => {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('task') || lowerMessage.includes('tugas')) {
        return { type: 'tasks' };
    } else if (lowerMessage.includes('note') || lowerMessage.includes('catatan')) {
        return { type: 'notes' };
    } else if (lowerMessage.includes('reminder')) {
        return { type: 'reminders' };
    } else if (lowerMessage.includes('todo')) {
        return { type: 'todos' };
    }
    
    return { type: 'all' };
};

const parseDeleteMessage = (message) => {
    const lowerMessage = message.toLowerCase();
    
    // Extract ID
    const idMatch = message.match(/#(\d+)/);
    const id = idMatch ? parseInt(idMatch[1]) : null;
    
    // Determine type
    let type = 'task';
    if (lowerMessage.includes('note') || lowerMessage.includes('catatan')) {
        type = 'note';
    } else if (lowerMessage.includes('reminder')) {
        type = 'reminder';
    } else if (lowerMessage.includes('todo')) {
        type = 'todo';
    }
    
    return { id, type };
};

const parseUpdateMessage = (message) => {
    const lowerMessage = message.toLowerCase();
    
    // Extract ID
    const idMatch = message.match(/#(\d+)/);
    const id = idMatch ? parseInt(idMatch[1]) : null;
    
    // Determine type
    let type = 'task';
    if (lowerMessage.includes('note') || lowerMessage.includes('catatan')) {
        type = 'note';
    } else if (lowerMessage.includes('reminder')) {
        type = 'reminder';
    } else if (lowerMessage.includes('todo')) {
        type = 'todo';
    }
    
    // Extract updates
    const updates = {};
    
    // Status update
    for (const status of VALID_STATUSES) {
        if (lowerMessage.includes(status.toLowerCase())) {
            updates.status = status;
            break;
        }
    }
    
    // Priority update
    for (const priority of VALID_PRIORITIES) {
        if (message.toUpperCase().includes(priority)) {
            updates.priority = priority;
            break;
        }
    }
    
    // Title/name update (after "jadi" or "menjadi" or "ke")
    const titleMatch = message.match(/(?:jadi|menjadi|ke)\s+["']?([^"'\n]+)["']?/i);
    if (titleMatch) {
        updates.title = titleMatch[1].trim();
        updates.task = titleMatch[1].trim();
    }
    
    return { id, type, updates };
};

const parseDetailMessage = (message) => {
    const lowerMessage = message.toLowerCase();
    
    // Extract ID
    const idMatch = message.match(/#(\d+)/);
    const id = idMatch ? parseInt(idMatch[1]) : null;
    
    // Determine type
    let type = 'task';
    if (lowerMessage.includes('note') || lowerMessage.includes('catatan')) {
        type = 'note';
    } else if (lowerMessage.includes('reminder')) {
        type = 'reminder';
    } else if (lowerMessage.includes('todo')) {
        type = 'todo';
    }
    
    return { id, type };
};

const parseSearchMessage = (message) => {
    const lowerMessage = message.toLowerCase();
    
    // Determine type
    let type = 'all';
    if (lowerMessage.includes('task') || lowerMessage.includes('tugas')) {
        type = 'task';
    } else if (lowerMessage.includes('note') || lowerMessage.includes('catatan')) {
        type = 'note';
    } else if (lowerMessage.includes('reminder')) {
        type = 'reminder';
    } else if (lowerMessage.includes('todo')) {
        type = 'todo';
    }
    
    // Extract search query
    const queryMatch = message.match(/(?:cari|search|find)\s+(?:task|note|catatan|reminder|todo)?\s*[:\s]*["']?([^"'\n]+)["']?/i);
    const query = queryMatch ? queryMatch[1].trim() : message.replace(/cari|search|find|task|note|catatan|reminder|todo/gi, '').trim();
    
    return { type, query };
};

const formatDate = (dateStr) => {
    if (dateStr.includes('/')) {
        const [day, month, year] = dateStr.split('/');
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateStr;
};

/**
 * OpenClaw Webhook Endpoint
 * Receives messages from WhatsApp via OpenClaw
 */
router.post('/openclaw', async (req, res) => {
    try {
        const { phone_number, message, sender_name } = req.body;

        if (!phone_number || !message) {
            return res.status(400).json({
                success: false,
                message: 'phone_number and message are required'
            });
        }

        // Normalize phone number - remove non-digits except + at start
        let normalizedPhone = phone_number.replace(/[^0-9+]/g, '');
        
        // Create variations for lookup (with and without +, with and without leading 0)
        const phoneVariations = [
            normalizedPhone,
            normalizedPhone.startsWith('+') ? normalizedPhone.substring(1) : '+' + normalizedPhone,
            normalizedPhone.replace(/^\+?62/, '0'),  // +6281xxx -> 081xxx
            normalizedPhone.replace(/^0/, '62'),     // 081xxx -> 6281xxx
            normalizedPhone.replace(/^0/, '+62'),    // 081xxx -> +6281xxx
        ];

        // Find user by phone number (try multiple formats)
        const [users] = await pool.query(
            'SELECT id, username, role, phone_number FROM users WHERE phone_number IN (?, ?, ?, ?, ?)',
            phoneVariations
        );

        if (users.length === 0) {
            return res.json({
                success: false,
                reply: `Hai! 👋 Sepertinya nomor kamu belum terdaftar di sistem Agenda Work.\n\nHubungi admin untuk mendaftarkan nomor ${phone_number} ya!`
            });
        }

        const user = users[0];
        // Use user's stored phone number for session tracking (consistent format)
        const sessionPhone = user.phone_number || normalizedPhone;
        const lowerMessage = message.toLowerCase().trim();
        
        // Check for cancel command
        if (lowerMessage === 'batal' || lowerMessage === 'cancel' || lowerMessage === 'keluar' || lowerMessage === 'exit') {
            if (hasActiveSession(sessionPhone)) {
                cancelSession(sessionPhone);
                return res.json({
                    success: true,
                    reply: 'Oke, proses dibatalkan! 👍\n\nAda yang bisa aku bantu lagi?'
                });
            }
        }
        
        // Check for active conversation session
        if (hasActiveSession(sessionPhone)) {
            const session = getSession(sessionPhone);
            
            if (session.type === 'create_task') {
                const result = processTaskStepResponse(sessionPhone, message);
                
                if (result.complete) {
                    // All fields collected, save the task
                    const data = result.data;
                    
                    // Auto-generate kegiatan from prefix + task
                    const kegiatan = `${data.prefix} ${data.task}`;
                    
                    const [insertResult] = await pool.query(
                        `INSERT INTO tasks (user_id, task, prefix, kegiatan, rencana_kinerja, priority, status, start_date, end_date)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [user.id, data.task, data.prefix, kegiatan, data.rencana_kinerja || null, 
                         data.priority, data.status, data.start_date || null, data.end_date || null]
                    );
                    
                    // Auto-sync new task to todo and reminder
                    await taskSyncService.syncNewTask(insertResult.insertId);
                    
                    // Clear the session
                    cancelSession(sessionPhone);
                    
                    const priorityEmoji = { 'P0': '🔴', 'P1': '🟠', 'P2': '🟡', 'P3': '🟢' };
                    let reply = `✅ *Task Berhasil Dibuat!*\n\n`;
                    reply += `📋 *${data.prefix} ${data.task}*\n`;
                    if (data.rencana_kinerja) reply += `🎯 Rencana: ${data.rencana_kinerja}\n`;
                    reply += `${priorityEmoji[data.priority] || '🟡'} Priority: ${data.priority}\n`;
                    reply += `📅 Mulai: ${data.start_date}\n`;
                    reply += `🎯 Deadline: ${data.end_date}\n`;
                    reply += `🆔 #${insertResult.insertId}\n\n`;
                    reply += `✅ _Auto-added to todo list_\n`;
                    reply += `⏰ _Reminder H-1 & hari H jam 08:00_`;
                    
                    return res.json({ success: true, reply });
                } else {
                    // Ask for next field
                    return res.json({ success: true, reply: result.prompt });
                }
            }
            
            if (session.type === 'complete_task') {
                const result = processCompletionStepResponse(sessionPhone, message);
                
                if (result.complete) {
                    // All completion fields collected, mark task as complete
                    const data = result.data;
                    const taskId = result.taskId;
                    
                    // Update task with completion data
                    await pool.query(
                        `UPDATE tasks SET status = 'Completed', capaian = ?, bukti_dukung = ?, notes = ? WHERE id = ?`,
                        [data.capaian, data.bukti_dukung, data.notes || null, taskId]
                    );
                    
                    // Also mark synced todos/reminders as completed
                    await taskSyncService.handleTaskCompleted(taskId);
                    
                    // Clear the session
                    cancelSession(sessionPhone);
                    
                    let reply = `🎉 *Task Selesai!*\n\n`;
                    reply += `✅ *${result.taskData.task}*\n\n`;
                    reply += `📊 *Capaian:* ${data.capaian}\n`;
                    reply += `🔗 *Bukti:* ${data.bukti_dukung}\n`;
                    if (data.notes) reply += `📝 *Catatan:* ${data.notes}\n`;
                    reply += `\n_Related todo & reminder sudah ditandai selesai_`;
                    
                    return res.json({ success: true, reply });
                } else {
                    // Ask for next field
                    return res.json({ success: true, reply: result.prompt });
                }
            }
        }
        
        // Check for "buat task lengkap" command - explicit full guided flow
        if (/^(buat task lengkap|task baru lengkap|new task full|buat task full)/i.test(lowerMessage)) {
            startTaskCreationSession(sessionPhone, {}, true); // forceFromStart = true
            const firstStep = TASK_CREATION_STEPS[0];
            return res.json({
                success: true,
                reply: `Oke, mari buat task baru dengan panduan lengkap! 📋\n\nAku akan tanya semua field satu per satu.\n_Ketik "batal" kapan saja untuk membatalkan._\n\n${firstStep.prompt}`
            });
        }
        
        // Parse the message
        const { intent, data } = parseMessage(message);

        if (!intent) {
            return res.json({
                success: true,
                reply: `Hai ${user.username}! 👋\n\nHmm, aku belum paham maksudnya nih. Coba bilang:\n\n📋 "Buat task lengkap" - Panduan lengkap\n📋 "Task Laporan" - Quick task\n📝 "Catat: Meeting"\n⏰ "Ingatkan besok jam 10"\n✅ "Todo: Kirim email"\n📊 "Ringkasan" atau "List task"\n\nAtau ketik "help" untuk panduan!`
            });
        }

        let reply = '';

        switch (intent) {
            case 'create_task':
                // Check if all required fields are present for immediate creation
                const hasAllRequired = data.task && data.prefix && 
                                       data.priority && data.start_date && data.end_date;
                
                if (hasAllRequired) {
                    // Auto-generate kegiatan from prefix + task
                    const kegiatan = `${data.prefix} ${data.task}`;
                    
                    // All required fields detected - create immediately!
                    const [result] = await pool.query(
                        `INSERT INTO tasks (user_id, task, prefix, kegiatan, priority, status, start_date, end_date)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [user.id, data.task, data.prefix, kegiatan, data.priority || 'P2', data.status, 
                         data.start_date, data.end_date]
                    );
                    
                    // Auto-sync new task to todo and reminder
                    await taskSyncService.syncNewTask(result.insertId);
                    
                    const priorityEmoji = { 'P0': '🔴', 'P1': '🟠', 'P2': '🟡', 'P3': '🟢' };
                    reply = `🤖 *AI Detection Complete!*\n\n`;
                    reply += `_Detected: ${data._detected ? data._detected.join(', ') : 'all fields'}_\n\n`;
                    reply += `✅ *Task Berhasil Dibuat!*\n\n`;
                    reply += `📋 *${kegiatan}*\n`;
                    reply += `${priorityEmoji[data.priority] || '🟡'} ${data.priority}\n`;
                    reply += `📅 Mulai: ${data.start_date}\n`;
                    reply += `🎯 Deadline: ${data.end_date}\n`;
                    reply += `🆔 #${result.insertId}\n\n`;
                    reply += `✅ _Auto-added to todo list_\n`;
                    reply += `⏰ _Reminder H-1 & hari H jam 08:00_`;
                } else if (!data.task || lowerMessage.includes('lengkap') || lowerMessage.includes('full')) {
                    // No task name or explicit full flow request
                    startTaskCreationSession(sessionPhone, data);
                    const session = getSession(sessionPhone);
                    const currentStep = TASK_CREATION_STEPS[session.step];
                    
                    let intro = `Oke, mari buat task baru! 📋\n\n`;
                    if (data._detected && data._detected.length > 0) {
                        intro += `🤖 *AI Detected:*\n`;
                        data._detected.forEach(d => intro += `✓ ${d}\n`);
                        intro += `\nLanjut melengkapi sisanya ya!\n`;
                    }
                    intro += `_Ketik "batal" untuk membatalkan._\n\n`;
                    
                    reply = intro + currentStep.prompt;
                    if (!currentStep.required) {
                        reply += '\n\n_Ketik "skip" untuk lewati_';
                    }
                } else {
                    // Some fields detected but not all - show what was detected and ask for remaining
                    startTaskCreationSession(sessionPhone, data);
                    const session = getSession(sessionPhone);
                    const currentStep = TASK_CREATION_STEPS[session.step];
                    
                    // Count remaining fields
                    let remaining = 0;
                    for (let i = session.step; i < TASK_CREATION_STEPS.length; i++) {
                        if (TASK_CREATION_STEPS[i].required || !session.data[TASK_CREATION_STEPS[i].field]) {
                            remaining++;
                        }
                    }
                    
                    reply = `🤖 *AI Detection*\n\n`;
                    if (data._detected && data._detected.length > 0) {
                        reply += `✓ _${data._detected.join('_\n✓ _')}_\n\n`;
                    }
                    reply += `📋 Perlu ${remaining} info lagi untuk task lengkap:\n`;
                    reply += `_Ketik "batal" untuk membatalkan._\n\n`;
                    reply += currentStep.prompt;
                    if (!currentStep.required) {
                        reply += '\n\n_Ketik "skip" untuk lewati_';
                    }
                }
                break;

            case 'multi_task':
                // Handle multiple tasks from one message
                if (!data.tasks || data.tasks.length === 0) {
                    reply = 'Hmm, aku tidak menemukan daftar task-nya. Pastikan formatnya seperti ini:\n\n```\nMengikuti Pelatihan X dengan rincian:\n- Item 1: 5 Februari 2026\n- Item 2: 6-7 Februari 2026\n```';
                } else {
                    const priorityEmoji = { 'P0': '🔴', 'P1': '🟠', 'P2': '🟡', 'P3': '🟢' };
                    const createdTasks = [];
                    
                    for (const item of data.tasks) {
                        // Create full task name with prefix: "Mengikuti Main Title - Subtask"
                        const fullTaskName = `${data.prefix} ${data.mainTitle} - ${item.name}`;
                        const kegiatan = fullTaskName; // kegiatan is the same as full task name
                        
                        try {
                            const [result] = await pool.query(
                                `INSERT INTO tasks (user_id, task, prefix, kegiatan, priority, status, start_date, end_date)
                                 VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)`,
                                [user.id, fullTaskName, data.prefix, kegiatan, data.priority, 
                                 item.start_date, item.end_date]
                            );
                            
                            // Auto-sync to todo and reminder
                            await taskSyncService.syncNewTask(result.insertId);
                            
                            createdTasks.push({
                                id: result.insertId,
                                name: fullTaskName,
                                subtask: item.name,
                                start: item.start_date,
                                end: item.end_date
                            });
                        } catch (err) {
                            console.error(`Error creating task "${fullTaskName}":`, err.message);
                        }
                    }
                    
                    if (createdTasks.length > 0) {
                        reply = `🎉 *${createdTasks.length} Task Berhasil Dibuat!*\n\n`;
                        reply += `📌 *${data.prefix} ${data.mainTitle}*\n`;
                        reply += `${priorityEmoji[data.priority]} Priority: ${data.priority}\n\n`;
                        
                        createdTasks.forEach((t, idx) => {
                            reply += `${idx + 1}. *${t.subtask}*\n`;
                            reply += `   📅 ${t.start}${t.start !== t.end ? ` - ${t.end}` : ''}\n`;
                            reply += `   🆔 #${t.id}\n\n`;
                        });
                        
                        reply += `✅ _Auto-added to todo list_\n`;
                        reply += `⏰ _Reminder H-1 & hari H jam 08:00 untuk setiap task_`;
                    } else {
                        reply = 'Waduh, gagal membuat task. Coba lagi ya!';
                    }
                }
                break;

            case 'create_note':
                if (!data.title) {
                    reply = 'Mau catat apa nih? Tulis aja langsung 📝';
                } else {
                    const [result] = await pool.query(
                        'INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)',
                        [user.id, data.title, data.content || null]
                    );
                    reply = `Noted! 📝 Catatan tersimpan.\n\n*${data.title}*`;
                    if (data.content) reply += `\n\n${data.content.substring(0, 100)}${data.content.length > 100 ? '...' : ''}`;
                    reply += `\n\n🆔 #${result.insertId}`;
                }
                break;

            case 'create_reminder':
                if (!data.title) {
                    reply = 'Ingatkan tentang apa nih? ⏰';
                } else {
                    const [result] = await pool.query(
                        'INSERT INTO reminders (user_id, title, reminder_datetime) VALUES (?, ?, ?)',
                        [user.id, data.title, data.reminder_datetime]
                    );
                    const reminderDate = new Date(data.reminder_datetime);
                    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                    reply = `Oke, aku akan ingatkan! ⏰\n\n*${data.title}*\n📅 ${reminderDate.toLocaleDateString('id-ID', options)}\n🆔 #${result.insertId}`;
                }
                break;

            case 'create_todo':
                if (!data.title) {
                    reply = 'Todo apa yang mau ditambah? ✅';
                } else {
                    const [result] = await pool.query(
                        'INSERT INTO todos (user_id, title, priority, due_date) VALUES (?, ?, ?, ?)',
                        [user.id, data.title, data.priority, data.due_date || null]
                    );
                    const priorityEmoji = { 'High': '🔴', 'Medium': '🟡', 'Low': '🟢' };
                    reply = `Ditambahkan ke todo list! ✅\n\n☑️ *${data.title}*\n${priorityEmoji[data.priority] || '🟡'} ${data.priority}`;
                    if (data.due_date) reply += `\n📅 Due: ${data.due_date}`;
                    reply += `\n🆔 #${result.insertId}`;
                }
                break;

            case 'list':
                const listReply = await generateListReply(user.id, data.type, user.username);
                reply = listReply;
                break;

            case 'delete':
                if (!data.id) {
                    reply = 'Yang mana yang mau dihapus? Sebutkan ID-nya ya, contoh: "hapus task #5" 🗑️';
                } else {
                    reply = await handleDelete(user.id, user.role, data.id, data.type);
                }
                break;

            case 'update':
                if (!data.id) {
                    reply = 'Yang mana yang mau diupdate? Sebutkan ID-nya ya, contoh: "update #5 status selesai" ✏️';
                } else if (!data.updates || Object.keys(data.updates).length === 0) {
                    reply = 'Mau diubah jadi apa nih? Contoh: "update #5 priority P1" ✏️';
                } else {
                    reply = await handleUpdate(user.id, user.role, data.id, data.type, data.updates);
                }
                break;

            case 'detail':
                if (!data.id) {
                    reply = 'Yang mana yang mau dilihat? Sebutkan ID-nya ya, contoh: "detail #5" 🔍';
                } else {
                    reply = await handleDetail(user.id, user.role, data.id, data.type);
                }
                break;

            case 'search':
                if (!data.query) {
                    reply = 'Mau cari apa nih? Contoh: "cari laporan" 🔍';
                } else {
                    reply = await handleSearch(user.id, user.role, data.query, data.type);
                }
                break;

            case 'complete':
                if (data.id) {
                    const completeResult = await handleComplete(user.id, user.role, data.id);
                    
                    if (completeResult.needsCompletion) {
                        // Start completion session to collect capaian and bukti_dukung
                        startTaskCompletionSession(sessionPhone, data.id, completeResult.task);
                        const firstStep = TASK_COMPLETION_STEPS[0];
                        reply = `📋 Sebelum menyelesaikan *${completeResult.task.task}*, aku perlu beberapa info:\n\n_Ketik "batal" untuk membatalkan._\n\n${firstStep.prompt}`;
                    } else {
                        reply = completeResult.reply;
                    }
                } else if (data.search) {
                    reply = await handleCompleteBySearch(user.id, data.search);
                } else {
                    reply = 'Yang mana yang sudah selesai? Sebutkan ID-nya ya, contoh: "selesai #5" ✅';
                }
                break;

            case 'help':
                reply = generateHelpMessage();
                break;

            case 'summary':
                reply = await generateSummary(user.id, user.username);
                break;

            default:
                reply = '🤖 Perintah tidak dikenali';
        }

        res.json({
            success: true,
            reply
        });

    } catch (error) {
        console.error('OpenClaw webhook error:', error);
        res.status(500).json({
            success: false,
            reply: 'Waduh, ada masalah nih di sistem. 😅 Coba lagi nanti ya!'
        });
    }
});

const generateListReply = async (userId, type, username = 'User') => {
    let reply = '';

    try {
        if (type === 'tasks' || type === 'all') {
            const [tasks] = await pool.query(
                'SELECT id, task, priority, status, start_date, end_date FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
                [userId]
            );
            reply += `📋 *Task ${username}:*\n`;
            if (tasks.length === 0) {
                reply += '_Belum ada task_\n';
            } else {
                const priorityEmoji = { 'P0': '🔴', 'P1': '🟠', 'P2': '🟡', 'P3': '🟢' };
                const statusEmoji = { 'Completed': '✅', 'In Progress': '🔄', 'Not Started': '⏳' };
                tasks.forEach(t => {
                    const deadline = displayDate(t.end_date);
                    reply += `${statusEmoji[t.status] || '⏳'} #${t.id} ${t.task} ${priorityEmoji[t.priority] || ''}${deadline ? ` 📅${deadline}` : ''}\n`;
                });
            }
            reply += '\n';
        }

        if (type === 'todos' || type === 'all') {
            const [todos] = await pool.query(
                'SELECT id, title, is_completed FROM todos WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
                [userId]
            );
            reply += `☑️ *Todo List:*\n`;
            if (todos.length === 0) {
                reply += '_Belum ada todo_\n';
            } else {
                todos.forEach(t => {
                    reply += `${t.is_completed ? '✅' : '⬜'} #${t.id} ${t.title}\n`;
                });
            }
            reply += '\n';
        }

        if (type === 'reminders' || type === 'all') {
            const [reminders] = await pool.query(
                'SELECT id, title, reminder_datetime FROM reminders WHERE user_id = ? AND is_completed = FALSE ORDER BY reminder_datetime ASC LIMIT 5',
                [userId]
            );
            reply += `⏰ *Reminder Aktif:*\n`;
            if (reminders.length === 0) {
                reply += '_Tidak ada reminder_\n';
            } else {
                reminders.forEach(r => {
                    reply += `⏰ #${r.id} ${r.title}\n    📅 ${displayDateTime(r.reminder_datetime)}\n`;
                });
            }
        }

        if (type === 'notes') {
            const [notes] = await pool.query(
                'SELECT id, title FROM notes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5',
                [userId]
            );
            reply += `📝 *Catatan:*\n`;
            if (notes.length === 0) {
                reply += '_Belum ada catatan_\n';
            } else {
                notes.forEach(n => {
                    reply += `📝 #${n.id} ${n.title}\n`;
                });
            }
        }

        return reply || '📭 Kamu belum punya data nih. Mau buat sesuatu?';
    } catch (error) {
        console.error('Generate list error:', error);
        return 'Waduh, gagal ambil data. Coba lagi ya!';
    }
};

// Health check for webhook
router.get('/openclaw/health', (req, res) => {
    res.json({
        success: true,
        message: 'OpenClaw webhook is active',
        timestamp: new Date().toISOString()
    });
});

/**
 * Handle DELETE operation
 */
const handleDelete = async (userId, userRole, id, type) => {
    try {
        const table = type === 'note' ? 'notes' : type === 'reminder' ? 'reminders' : type === 'todo' ? 'todos' : 'tasks';
        const titleField = type === 'task' ? 'task' : 'title';
        const typeName = type === 'note' ? 'Catatan' : type === 'reminder' ? 'Reminder' : type === 'todo' ? 'Todo' : 'Task';
        
        // Check ownership (admin can delete any)
        let query = `SELECT id, ${titleField} as name FROM ${table} WHERE id = ?`;
        let params = [id];
        if (userRole !== 'admin') {
            query += ' AND user_id = ?';
            params.push(userId);
        }
        
        const [items] = await pool.query(query, params);
        if (items.length === 0) {
            return `Hmm, ${typeName} #${id} tidak ditemukan atau bukan milikmu 🤔`;
        }
        
        await pool.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
        return `Done! 🗑️\n\n*${items[0].name}* sudah dihapus.`;
    } catch (error) {
        console.error('Delete error:', error);
        return 'Gagal menghapus. Coba lagi ya!';
    }
};

/**
 * Handle UPDATE operation
 */
const handleUpdate = async (userId, userRole, id, type, updates) => {
    try {
        const table = type === 'note' ? 'notes' : type === 'reminder' ? 'reminders' : type === 'todo' ? 'todos' : 'tasks';
        const titleField = type === 'task' ? 'task' : 'title';
        const typeName = type === 'note' ? 'Catatan' : type === 'reminder' ? 'Reminder' : type === 'todo' ? 'Todo' : 'Task';
        
        // Check ownership
        let checkQuery = `SELECT id, ${titleField} as name FROM ${table} WHERE id = ?`;
        let checkParams = [id];
        if (userRole !== 'admin') {
            checkQuery += ' AND user_id = ?';
            checkParams.push(userId);
        }
        
        const [items] = await pool.query(checkQuery, checkParams);
        if (items.length === 0) {
            return `Hmm, ${typeName} #${id} tidak ditemukan atau bukan milikmu 🤔`;
        }
        
        // Build update query
        const updateFields = [];
        const updateValues = [];
        
        if (updates.status && type === 'task') {
            updateFields.push('status = ?');
            updateValues.push(updates.status);
        }
        if (updates.priority) {
            updateFields.push('priority = ?');
            updateValues.push(updates.priority);
        }
        if (updates.title) {
            updateFields.push(`${titleField} = ?`);
            updateValues.push(updates.title);
        }
        if (updates.task && type === 'task') {
            updateFields.push('task = ?');
            updateValues.push(updates.task);
        }
        
        if (updateFields.length === 0) {
            return 'Tidak ada yang bisa diupdate. Coba sebutkan field-nya ya! ✏️';
        }
        
        updateValues.push(id);
        await pool.query(`UPDATE ${table} SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
        
        const changesText = Object.entries(updates).map(([k, v]) => `  ${k} → ${v}`).join('\n');
        return `Done! ✏️ ${typeName} sudah diupdate.\n\n*${items[0].name}*\n${changesText}`;
    } catch (error) {
        console.error('Update error:', error);
        return 'Gagal mengupdate. Coba lagi ya!';
    }
};

/**
 * Handle DETAIL/SHOW operation
 */
const handleDetail = async (userId, userRole, id, type) => {
    try {
        const table = type === 'note' ? 'notes' : type === 'reminder' ? 'reminders' : type === 'todo' ? 'todos' : 'tasks';
        const typeName = type === 'note' ? 'Catatan' : type === 'reminder' ? 'Reminder' : type === 'todo' ? 'Todo' : 'Task';
        
        let query = `SELECT * FROM ${table} WHERE id = ?`;
        let params = [id];
        if (userRole !== 'admin') {
            query += ' AND user_id = ?';
            params.push(userId);
        }
        
        const [items] = await pool.query(query, params);
        if (items.length === 0) {
            return `Hmm, ${typeName} #${id} tidak ditemukan atau bukan milikmu 🤔`;
        }
        
        const item = items[0];
        let reply = '';

        if (type === 'task') {
            const priorityEmoji = { 'P0': '🔴', 'P1': '🟠', 'P2': '🟡', 'P3': '🟢' };
            const statusEmoji = { 'Completed': '✅', 'In Progress': '🔄', 'Not Started': '⏳' };
            reply = `📋 *Task #${id}*\n\n`;
            reply += `*${item.task}*\n\n`;
            reply += `${priorityEmoji[item.priority] || '🟡'} Priority: ${item.priority || 'P2'}\n`;
            reply += `${statusEmoji[item.status] || '⏳'} Status: ${item.status || 'Not Started'}\n`;
            if (item.prefix) reply += `🏷️ Prefix: ${item.prefix}\n`;
            if (item.kegiatan) reply += `📁 Kegiatan: ${item.kegiatan}\n`;
            if (item.start_date) reply += `📅 Mulai: ${displayDate(item.start_date)}\n`;
            if (item.end_date) reply += `🎯 Target: ${displayDate(item.end_date)}\n`;
            if (item.rencana_kinerja) reply += `📋 Rencana: ${item.rencana_kinerja}\n`;
            if (item.capaian) reply += `📊 Capaian: ${item.capaian}\n`;
            if (item.notes) reply += `📝 Notes: ${item.notes}\n`;
        } else if (type === 'note') {
            reply = `📝 *Catatan #${id}*\n\n`;
            reply += `*${item.title}*\n\n`;
            reply += `${item.content || '_(kosong)_'}\n\n`;
            reply += `📅 Update: ${displayDateTime(item.updated_at)}`;
        } else if (type === 'reminder') {
            reply = `⏰ *Reminder #${id}*\n\n`;
            reply += `*${item.title}*\n\n`;
            reply += `📅 ${displayDateTime(item.reminder_datetime)}\n`;
            reply += `${item.is_completed ? '✅ Sudah selesai' : '⏳ Masih aktif'}`;
        } else if (type === 'todo') {
            const priorityEmoji = { 'High': '🔴', 'Medium': '🟡', 'Low': '🟢' };
            reply = `☑️ *Todo #${id}*\n\n`;
            reply += `${item.is_completed ? '✅' : '⬜'} *${item.title}*\n\n`;
            reply += `${priorityEmoji[item.priority] || '🟡'} ${item.priority || 'Medium'}\n`;
            if (item.due_date) reply += `📅 Due: ${displayDate(item.due_date)}`;
        }
        
        return reply;
    } catch (error) {
        console.error('Detail error:', error);
        return 'Gagal mengambil detail. Coba lagi ya!';
    }
};

/**
 * Handle SEARCH operation
 */
const handleSearch = async (userId, userRole, query, type) => {
    try {
        const searchTerm = `%${query}%`;
        let reply = `🔍 *Hasil Pencarian:* "${query}"\n\n`;
        let found = false;
        
        // Search in tasks
        if (type === 'all' || type === 'task') {
            let taskQuery = 'SELECT id, task, status, priority, end_date FROM tasks WHERE (task LIKE ? OR kegiatan LIKE ? OR notes LIKE ?)';
            let taskParams = [searchTerm, searchTerm, searchTerm];
            if (userRole !== 'admin') {
                taskQuery += ' AND user_id = ?';
                taskParams.push(userId);
            }
            taskQuery += ' LIMIT 5';

            const [tasks] = await pool.query(taskQuery, taskParams);
            if (tasks.length > 0) {
                found = true;
                const priorityEmoji = { 'P0': '🔴', 'P1': '🟠', 'P2': '🟡', 'P3': '🟢' };
                const statusEmoji = { 'Completed': '✅', 'In Progress': '🔄', 'Not Started': '⏳' };
                reply += `📋 *Tasks:*\n`;
                tasks.forEach(t => {
                    const deadline = displayDate(t.end_date);
                    reply += `${statusEmoji[t.status] || '⏳'} #${t.id} ${t.task} ${priorityEmoji[t.priority] || ''}${deadline ? ` 📅${deadline}` : ''}\n`;
                });
                reply += '\n';
            }
        }
        
        // Search in notes
        if (type === 'all' || type === 'note') {
            let noteQuery = 'SELECT id, title FROM notes WHERE (title LIKE ? OR content LIKE ?)';
            let noteParams = [searchTerm, searchTerm];
            if (userRole !== 'admin') {
                noteQuery += ' AND user_id = ?';
                noteParams.push(userId);
            }
            noteQuery += ' LIMIT 5';
            
            const [notes] = await pool.query(noteQuery, noteParams);
            if (notes.length > 0) {
                found = true;
                reply += `📝 *Catatan:*\n`;
                notes.forEach(n => {
                    reply += `📝 #${n.id} ${n.title}\n`;
                });
                reply += '\n';
            }
        }
        
        // Search in reminders
        if (type === 'all' || type === 'reminder') {
            let reminderQuery = 'SELECT id, title, reminder_datetime FROM reminders WHERE title LIKE ?';
            let reminderParams = [searchTerm];
            if (userRole !== 'admin') {
                reminderQuery += ' AND user_id = ?';
                reminderParams.push(userId);
            }
            reminderQuery += ' LIMIT 5';
            
            const [reminders] = await pool.query(reminderQuery, reminderParams);
            if (reminders.length > 0) {
                found = true;
                reply += `⏰ *Reminders:*\n`;
                reminders.forEach(r => {
                    reply += `⏰ #${r.id} ${r.title}\n`;
                });
                reply += '\n';
            }
        }
        
        // Search in todos
        if (type === 'all' || type === 'todo') {
            let todoQuery = 'SELECT id, title, is_completed FROM todos WHERE title LIKE ?';
            let todoParams = [searchTerm];
            if (userRole !== 'admin') {
                todoQuery += ' AND user_id = ?';
                todoParams.push(userId);
            }
            todoQuery += ' LIMIT 5';
            
            const [todos] = await pool.query(todoQuery, todoParams);
            if (todos.length > 0) {
                found = true;
                reply += `☑️ *Todos:*\n`;
                todos.forEach(t => {
                    reply += `${t.is_completed ? '✅' : '⬜'} #${t.id} ${t.title}\n`;
                });
            }
        }
        
        if (!found) {
            reply += `_Hmm, tidak ada yang cocok dengan "${query}"_`;
        }
        
        return reply;
    } catch (error) {
        console.error('Search error:', error);
        return 'Gagal mencari. Coba lagi ya!';
    }
};

/**
 * Handle COMPLETE task/todo
 * Returns { needsCompletion: true, task: taskData } if task needs capaian/bukti_dukung
 */
const handleComplete = async (userId, userRole, id) => {
    try {
        // Validate ownership: always require integer IDs
        const parsedId = parseInt(id);
        const parsedUserId = parseInt(userId);
        if (!parsedId || parsedId <= 0 || !parsedUserId || parsedUserId <= 0) {
            return { needsCompletion: false, reply: 'ID tidak valid.' };
        }
        // Try tasks first
        let query = 'SELECT id, task, capaian, bukti_dukung, notes FROM tasks WHERE id = ?';
        let params = [parsedId];
        if (userRole !== 'admin') {
            query += ' AND user_id = ?';
            params.push(parsedUserId);
        }

        const [tasks] = await pool.query(query, params);
        if (tasks.length > 0) {
            const task = tasks[0];

            // Check if capaian and bukti_dukung are filled
            if (!task.capaian || !task.bukti_dukung) {
                // Return flag to start completion session
                return {
                    needsCompletion: true,
                    task: task
                };
            }

            // All fields are filled, complete immediately
            await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['Completed', parsedId]);

            // Also mark synced todos/reminders as completed
            await taskSyncService.handleTaskCompleted(parsedId);

            return {
                needsCompletion: false,
                reply: `Mantap! 🎉 Task sudah selesai.\n\n✅ *${task.task}*\n\n📊 Capaian: ${task.capaian}\n🔗 Bukti: ${task.bukti_dukung}\n\n_Related todo & reminder juga sudah ditandai selesai_`
            };
        }

        // Try todos
        query = 'SELECT id, title FROM todos WHERE id = ?';
        params = [parsedId];
        if (userRole !== 'admin') {
            query += ' AND user_id = ?';
            params.push(parsedUserId);
        }
        
        const [todos] = await pool.query(query, params);
        if (todos.length > 0) {
            await pool.query('UPDATE todos SET is_completed = TRUE WHERE id = ?', [id]);
            return { needsCompletion: false, reply: `Mantap! 🎉 Todo sudah selesai.\n\n✅ *${todos[0].title}*` };
        }
        
        return { needsCompletion: false, reply: `Hmm, item #${id} tidak ditemukan 🤔` };
    } catch (error) {
        console.error('Complete error:', error);
        return { needsCompletion: false, reply: 'Gagal menandai selesai. Coba lagi ya!' };
    }
};

/**
 * Handle COMPLETE by search term
 */
const handleCompleteBySearch = async (userId, searchTerm) => {
    try {
        const [tasks] = await pool.query(
            'SELECT id, task FROM tasks WHERE user_id = ? AND task LIKE ? AND status != ? LIMIT 1',
            [userId, `%${searchTerm}%`, 'Completed']
        );
        
        if (tasks.length > 0) {
            await pool.query('UPDATE tasks SET status = ? WHERE id = ?', ['Completed', tasks[0].id]);
            return `Mantap! 🎉 Task sudah selesai.\n\n✅ *${tasks[0].task}*`;
        }
        
        const [todos] = await pool.query(
            'SELECT id, title FROM todos WHERE user_id = ? AND title LIKE ? AND is_completed = FALSE LIMIT 1',
            [userId, `%${searchTerm}%`]
        );
        
        if (todos.length > 0) {
            await pool.query('UPDATE todos SET is_completed = TRUE WHERE id = ?', [todos[0].id]);
            return `Mantap! 🎉 Todo sudah selesai.\n\n✅ *${todos[0].title}*`;
        }
        
        return `Hmm, tidak ada item "${searchTerm}" yang belum selesai 🤔`;
    } catch (error) {
        console.error('Complete by search error:', error);
        return 'Gagal menandai selesai. Coba lagi ya!';
    }
};

/**
 * Generate help message
 */
const generateHelpMessage = () => {
    return `Hai! 👋 Aku asisten Agenda Work-mu dengan *AI Detection*!

🤖 *AI Smart Task:*
Cukup tulis dalam satu pesan:
"Task Membuat Laporan penting deadline minggu depan"
_AI akan mendeteksi: nama, prefix, priority, deadline!_

📋 *Buat Task:*
"Buat task lengkap" - 📌 Panduan step-by-step
"Task Mengikuti Rapat P1 besok"
"Task Mengumpulkan Data deadline 3 hari lagi"

� *Multi-Task (Baru!):*
Buat beberapa task sekaligus:
\`\`\`
Mengikuti Pelatihan X dengan rincian:
- Sesi 1: 5 Februari 2026
- Sesi 2: 6-7 Februari 2026
pisahkan jadi 2 task
\`\`\`

�📝 *Buat Catatan:*
"Catat: Meeting Notes"
"Note: IDE project baru"

⏰ *Buat Reminder:*
"Ingatkan meeting besok jam 10"
"Remind saya Senin pagi"

✅ *Buat Todo:*
"Todo: Kirim email"
"Tambah todo urgent"

🔍 *Lihat & Cari:*
"List task" atau "Ringkasan"
"Detail #5", "Cari laporan"

✏️ *Update & Hapus:*
"Selesai #5" - _perlu isi capaian & bukti_
"Update #5 priority P0"
"Hapus task #3"

💡 *Keywords AI:*
• Prefix: Membuat, Melakukan, Mengikuti, Mengisi, Memberikan, Mengumpulkan
• Priority: P0/urgent, P1/penting, P2/normal, P3/rendah
• Tanggal: hari ini, besok, lusa, minggu depan, 3 hari lagi, DD/MM/YYYY

Ketik "batal" untuk batalkan proses 😊`;
};

/**
 * Generate summary statistics
 */
const generateSummary = async (userId, username = 'User') => {
    try {
        const [taskStats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status NOT IN ('Completed', 'In Progress') THEN 1 ELSE 0 END) as pending
            FROM tasks WHERE user_id = ?
        `, [userId]);
        
        const [todoStats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_completed = TRUE THEN 1 ELSE 0 END) as completed
            FROM todos WHERE user_id = ?
        `, [userId]);
        
        const [reminderStats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_completed = FALSE AND reminder_datetime > NOW() THEN 1 ELSE 0 END) as upcoming
            FROM reminders WHERE user_id = ?
        `, [userId]);
        
        const [noteStats] = await pool.query('SELECT COUNT(*) as total FROM notes WHERE user_id = ?', [userId]);
        
        const ts = taskStats[0];
        const td = todoStats[0];
        const rs = reminderStats[0];
        const ns = noteStats[0];
        
        const taskProgress = ts.total > 0 ? Math.round((ts.completed / ts.total) * 100) : 0;
        const todoProgress = td.total > 0 ? Math.round((td.completed / td.total) * 100) : 0;
        
        let greeting = '';
        if (taskProgress >= 80) greeting = 'Kerja bagus! 🌟';
        else if (taskProgress >= 50) greeting = 'Keep going! 💪';
        else greeting = 'Yuk semangat! 🚀';
        
        return `📊 *Ringkasan ${username}*

${greeting}

📋 *Tasks* (${taskProgress}% selesai)
   ✅ ${ts.completed} selesai
   🔄 ${ts.in_progress} ongoing
   ⏳ ${ts.pending} pending

☑️ *Todos* (${todoProgress}% selesai)
   ✅ ${td.completed} done
   ⬜ ${td.total - td.completed} belum

⏰ *Reminders*
   📅 ${rs.upcoming || 0} upcoming

📝 *Catatan:* ${ns.total} total`;
    } catch (error) {
        console.error('Summary error:', error);
        return 'Gagal mengambil ringkasan. Coba lagi ya!';
    }
};

module.exports = router;
