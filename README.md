# Agenda Work - Work Management System

A full-stack web application for managing work tasks, notes, reminders, and todos with WhatsApp integration via OpenClaw.

## Features

- 📋 **Task Management** - Track work tasks with priority, status, dates, and supporting documents
- 📝 **Notes** - Create and organize notes with colors and categories
- ⏰ **Reminders** - Set reminders with repeat options
- ✅ **Todos** - Simple todo list with priorities
- 👥 **User Management** - Admin/user roles with data isolation
- 💬 **WhatsApp Integration** - Create tasks via WhatsApp using OpenClaw

## Tech Stack

- **Frontend**: React 18 + Vite + TailwindCSS
- **Backend**: Node.js + Express.js
- **Database**: MySQL (MariaDB)
- **Auth**: JWT with refresh tokens (stored in MySQL)
- **Session**: MySQL-backed sessions

## Quick Start

### 1. Setup Database

```bash
# Login to MySQL
mysql -u root -p17Agustus

# Run schema
source /var/www/html/agenda_work/database/schema.sql
```

### 2. Install Dependencies

```bash
# Backend
cd /var/www/html/agenda_work/backend
npm install

# Frontend
cd /var/www/html/agenda_work/frontend
npm install
```

### 3. Seed Admin User

```bash
cd /var/www/html/agenda_work/backend
npm run seed
```

Default admin credentials:
- Email: `admin@bps.go.id`
- Password: `admin`

### 4. Build Frontend

```bash
cd /var/www/html/agenda_work/frontend
npm run build
```

### 5. Start with PM2

```bash
# Create logs directory
mkdir -p /var/www/html/agenda_work/logs

# Start apps
cd /var/www/html/agenda_work
pm2 start ecosystem.config.js

# Save PM2 config
pm2 save
```

### 6. Configure Cloudflare Tunnel

Add to your `/root/.cloudflared/config.yml`:

```yaml
ingress:
  # ... existing rules ...
  
  - hostname: agenda.bpsmalut.com
    service: http://localhost:5101
  
  - hostname: api-agenda.bpsmalut.com
    service: http://localhost:5100
  
  - service: http_status:404
```

Then restart cloudflared:
```bash
sudo systemctl restart cloudflared
```

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user
- `POST /api/auth/change-password` - Change password

### Tasks
- `GET /api/tasks` - List tasks
- `GET /api/tasks/:id` - Get task
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `GET /api/tasks/stats/summary` - Task statistics

### Notes, Reminders, Todos
Similar CRUD endpoints at `/api/notes`, `/api/reminders`, `/api/todos`

### Users (Admin only)
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user
- `POST /api/users/:id/reset-password` - Reset password

### Webhook
- `POST /api/webhook/openclaw` - WhatsApp webhook for OpenClaw

## WhatsApp Commands (via OpenClaw)

Send messages to your WhatsApp bot:

```
task: Membuat Laporan Kinerja priority P0
catatan: Judul catatan | Isi catatan
reminder: Meeting jam 10 besok
todo: Kirim email ke atasan
list tasks
```

## Environment Variables

Backend `.env`:
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=17Agustus
DB_PORT=3306
DB_NAME=agenda_work_db
PORT=5100
JWT_SECRET=your-secret
JWT_REFRESH_SECRET=your-refresh-secret
SESSION_SECRET=your-session-secret
CORS_ORIGIN=https://agenda.bpsmalut.com
```

## Ports

| Service | Port |
|---------|------|
| Backend API | 5100 |
| Frontend | 5101 |
| MySQL | 3306 |

## License

MIT © BPS Maluku Utara
