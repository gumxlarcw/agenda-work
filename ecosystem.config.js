module.exports = {
  apps: [
    {
      name: 'agenda-backend',
      script: 'src/server.js',
      cwd: '/var/www/html/agenda_work/backend',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      wait_ready: true,
      listen_timeout: 30000,
      kill_timeout: 10000, // M5: increased from 5000 to allow graceful shutdown
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production', // C6: explicitly set to production
        PORT: 5100
      },
      error_file: '/var/www/html/agenda_work/logs/backend-error.log',
      out_file: '/var/www/html/agenda_work/logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,  // H14: merge cluster logs
      max_size: '10M',   // H14: rotate logs at 10MB (requires pm2-logrotate: pm2 install pm2-logrotate)
    },
    {
      // C8: `vite preview` is NOT a production server. It lacks security hardening,
      // compression, and proper static asset caching. RECOMMENDATION: migrate to
      // nginx serving the dist/ folder directly. For now, --host 0.0.0.0 is added
      // so PM2 can bind correctly.
      name: 'agenda-frontend',
      script: 'npm',
      args: 'run preview -- --host 0.0.0.0',
      cwd: '/var/www/html/agenda_work/frontend',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      kill_timeout: 10000, // M5: match backend
      env: {
        NODE_ENV: 'production',
        PORT: 5101
      },
      error_file: '/var/www/html/agenda_work/logs/frontend-error.log',
      out_file: '/var/www/html/agenda_work/logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,  // H14: merge cluster logs
      max_size: '10M',   // H14: rotate logs at 10MB
    },
    {
      name: 'agenda-task-sync',
      script: 'task-sync-daemon.js',
      cwd: '/var/www/html/agenda_work/backend',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/www/html/agenda_work/logs/task-sync-error.log',
      out_file: '/var/www/html/agenda_work/logs/task-sync-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    }
  ]
};
