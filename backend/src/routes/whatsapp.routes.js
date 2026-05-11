const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsapp.service');
const { verifyToken, isAdmin } = require('../middleware/auth.middleware');
const pool = require('../config/database');

// All routes require admin
router.use(verifyToken, isAdmin);

// GET /api/whatsapp/status - Get WhatsApp connection status
router.get('/status', async (req, res) => {
  try {
    const status = await whatsappService.getStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('WhatsApp status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get WhatsApp status',
      error: error.message
    });
  }
});

// GET /api/whatsapp/accounts - Get available WhatsApp accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await whatsappService.getAccounts();
    res.json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('WhatsApp accounts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get WhatsApp accounts',
      error: error.message
    });
  }
});

// POST /api/whatsapp/test - Send test message
router.post('/test', async (req, res) => {
  try {
    const { phone_number } = req.body;
    
    if (!phone_number) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    const result = await whatsappService.sendTestMessage(phone_number);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Test message sent successfully',
        data: result
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send test message',
        error: result.error
      });
    }
  } catch (error) {
    console.error('WhatsApp test error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send test message',
      error: error.message
    });
  }
});

// POST /api/whatsapp/send - Send custom message
router.post('/send', async (req, res) => {
  try {
    const { phone_number, message } = req.body;
    
    if (!phone_number || !message) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and message are required'
      });
    }

    const result = await whatsappService.sendMessage(phone_number, message);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Message sent successfully',
        data: result
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to send message',
        error: result.error
      });
    }
  } catch (error) {
    console.error('WhatsApp send error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
});

// POST /api/whatsapp/broadcast - Send message to multiple users
router.post('/broadcast', async (req, res) => {
  try {
    const { user_ids, message } = req.body;
    
    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'User IDs array is required'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Get phone numbers for selected users
    const [users] = await pool.query(
      'SELECT id, username, phone_number FROM users WHERE id IN (?) AND phone_number IS NOT NULL',
      [user_ids]
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No users with phone numbers found'
      });
    }

    const results = {
      success: [],
      failed: []
    };

    for (const user of users) {
      const result = await whatsappService.sendMessage(user.phone_number, message);
      if (result.success) {
        results.success.push({ id: user.id, username: user.username });
      } else {
        results.failed.push({ id: user.id, username: user.username, error: result.error });
      }
    }

    res.json({
      success: true,
      message: `Broadcast completed: ${results.success.length} sent, ${results.failed.length} failed`,
      data: results
    });
  } catch (error) {
    console.error('WhatsApp broadcast error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to broadcast message',
      error: error.message
    });
  }
});

// GET /api/whatsapp/users-with-phone - Get users with phone numbers
router.get('/users-with-phone', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, email, phone_number FROM users WHERE phone_number IS NOT NULL AND phone_number != "" ORDER BY username'
    );
    
    res.json({
      success: true,
      data: users.map(u => ({
        ...u,
        phone_display: whatsappService.formatPhoneNumber(u.phone_number)
      }))
    });
  } catch (error) {
    console.error('Get users with phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get users',
      error: error.message
    });
  }
});

module.exports = router;
