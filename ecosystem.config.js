module.exports = {
  apps: [
    {
      name: 'telegram-agent',
      script: 'dist/index.js',
      cwd: __dirname,
      // Belt-and-braces against the in-process memoryMonitor warning:
      // pm2 will actually restart the process if it grows past this.
      max_memory_restart: '350M',
      restart_delay: 3000,
      max_restarts: 20,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
