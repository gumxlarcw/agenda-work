const bcrypt = require('bcryptjs');
const pool = require('../config/database');
require('dotenv').config();

const seedAdmin = async () => {
    try {
        console.log('🌱 Starting admin seed...');

        // Check if admin already exists
        const [existingAdmin] = await pool.query(
            'SELECT id FROM users WHERE email = ?',
            ['admin@bps.go.id']
        );

        if (existingAdmin.length > 0) {
            console.log('⚠️  Admin user already exists. Skipping seed.');
            process.exit(0);
        }

        // Hash password
        const salt = await bcrypt.genSalt(12);
        const passwordHash = await bcrypt.hash('admin', salt);

        // Insert admin user
        const [result] = await pool.query(
            `INSERT INTO users (username, email, phone_number, password_hash, role, must_change_password)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['Admin', 'admin@bps.go.id', null, passwordHash, 'admin', true]
        );

        console.log('✅ Admin user created successfully!');
        console.log('📧 Email: admin@bps.go.id');
        console.log('🔑 Password: admin');
        console.log('⚠️  Please change the password after first login!');
        console.log(`🆔 User ID: ${result.insertId}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Seed failed:', error.message);
        process.exit(1);
    }
};

seedAdmin();
