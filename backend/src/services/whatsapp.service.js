const axios = require('axios');

const OPENCLAW_API_URL = process.env.OPENCLAW_API_URL || 'http://localhost:4000';
const OPENCLAW_WA_NUMBER = process.env.OPENCLAW_WA_NUMBER || '6285159170808';

const whatsappService = {
  /**
   * Get WhatsApp connection status
   */
  async getStatus(accountId = 'default') {
    try {
      const response = await axios.get(`${OPENCLAW_API_URL}/status`, {
        params: { account: accountId },
        timeout: 10000
      });
      return {
        success: true,
        data: response.data,
        linkedNumber: OPENCLAW_WA_NUMBER
      };
    } catch (error) {
      console.error('WhatsApp status error:', error.message);
      return {
        success: false,
        error: error.message,
        linkedNumber: OPENCLAW_WA_NUMBER
      };
    }
  },

  /**
   * Get available WhatsApp accounts
   */
  async getAccounts() {
    try {
      const response = await axios.get(`${OPENCLAW_API_URL}/accounts`, {
        timeout: 10000
      });
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('WhatsApp accounts error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * Send a WhatsApp message
   * @param {string} number - Phone number (will be normalized to 62xxx format)
   * @param {string} message - Message content
   * @param {string} account - WhatsApp account ID (default: 'default')
   */
  async sendMessage(number, message, account = 'default', retries = 2) {
    // Normalize phone number
    let normalizedNumber = number.replace(/\D/g, '');
    if (normalizedNumber.startsWith('0')) {
      normalizedNumber = '62' + normalizedNumber.slice(1);
    } else if (!normalizedNumber.startsWith('62')) {
      normalizedNumber = '62' + normalizedNumber;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await axios.post(`${OPENCLAW_API_URL}/send`, {
          number: normalizedNumber,
          message: message,
          account: account
        }, {
          timeout: 30000
        });

        return {
          success: true,
          message: 'Message sent successfully',
          data: response.data
        };
      } catch (error) {
        // #27: surface OpenClaw's rejection body. A 400 without the reason is
        // un-diagnosable — the response body tells us WHY (bad number format,
        // missing account, message too long, etc).
        const status = error.response?.status;
        const bodySnippet = JSON.stringify(error.response?.data || {}).slice(0, 300);
        console.error(`WhatsApp send error (attempt ${attempt + 1}/${retries + 1}): ${error.message}${status ? ` [status=${status} body=${bodySnippet}]` : ''}`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          return {
            success: false,
            error: error.message,
            status,
            body: error.response?.data,
          };
        }
      }
    }
  },

  /**
   * Send a test message to verify connectivity
   * @param {string} number - Phone number to send test message to
   */
  async sendTestMessage(number) {
    const testMessage = `✅ *Agenda Work - Test Message*\n\nKoneksi WhatsApp berhasil!\nWaktu: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' })}\n\nPesan ini dikirim dari sistem Agenda Work.`;
    return this.sendMessage(number, testMessage);
  },

  /**
   * Send notification to a user
   * @param {string} phoneNumber - User's phone number
   * @param {string} type - Notification type (task, reminder, todo, note)
   * @param {object} data - Notification data
   */
  async sendNotification(phoneNumber, type, data) {
    if (!phoneNumber) {
      return { success: false, error: 'No phone number provided' };
    }

    let message = '';
    const timestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' });

    switch (type) {
      case 'task':
        message = `📋 *Notifikasi Task Baru*\n\n*${data.prefix || ''} ${data.task_name}*\n\n📝 Deskripsi: ${data.deskripsi || '-'}\n📅 Target: ${data.tanggal_target || '-'}\n⏰ Waktu: ${timestamp}`;
        break;
      case 'reminder':
        message = `⏰ *Pengingat*\n\n${data.message}\n\n📅 Jadwal: ${data.reminder_time || '-'}\n⏰ Waktu: ${timestamp}`;
        break;
      case 'todo':
        message = `✅ *Todo Baru*\n\n${data.title}\n\n⏰ Waktu: ${timestamp}`;
        break;
      case 'note':
        message = `📝 *Catatan Baru*\n\n*${data.title}*\n\n${data.content?.substring(0, 200) || '-'}...\n\n⏰ Waktu: ${timestamp}`;
        break;
      case 'task_deadline':
        message = `⚠️ *Pengingat Deadline Task*\n\n*${data.prefix || ''} ${data.task_name}*\n\n📅 Deadline: ${data.tanggal_target}\n📝 Status: ${data.status || 'pending'}\n\n⏰ Waktu: ${timestamp}`;
        break;
      default:
        message = `📢 *Notifikasi Agenda Work*\n\n${JSON.stringify(data)}\n\n⏰ Waktu: ${timestamp}`;
    }

    return this.sendMessage(phoneNumber, message);
  },

  /**
   * Format phone number for display
   */
  formatPhoneNumber(number) {
    if (!number) return '-';
    let cleaned = number.replace(/\D/g, '');
    if (cleaned.startsWith('62')) {
      cleaned = '0' + cleaned.slice(2);
    }
    // Format as 0xxx-xxxx-xxxx
    return cleaned.replace(/(\d{4})(\d{4})(\d+)/, '$1-$2-$3');
  }
};

module.exports = whatsappService;
