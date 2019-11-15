require('dotenv').config();

module.exports = {
  apps: [{
    name: process.env.APP_NAME,
    script: './packages/cli/bin/n8n',
    cwd: process.env.APP_PATH,
    error_file: './logs/pm2.n8n.log',
    out_file: './logs/pm2.n8n.log',
    wait_ready: true,
    listen_timeout: 30000,
    env: {
      NODE_ENV: process.env.NODE_ENV,
    },
  }],
};
