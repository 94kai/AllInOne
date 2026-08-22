module.exports = {
  apps: [{
    name: 'allinone',
    script: './server.mjs',
    cwd: __dirname,
    interpreter: 'node',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    restart_delay: 2000,
    time: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
