#!/data/data/com.termux/files/usr/bin/bash
# One-time setup for running the bot in Termux.
set -euo pipefail

echo "📦 Updating Termux packages…"
pkg update -y && pkg upgrade -y

echo "📦 Installing Node.js and git…"
pkg install -y nodejs git

echo "📦 Installing project dependencies…"
npm install

echo "🔨 Building TypeScript…"
npm run build

echo "📦 Installing pm2 globally (process manager with auto-restart)…"
npm install -g pm2

if [ ! -f .env ]; then
  echo "📝 Creating .env from .env.example — edit it with your tokens before starting the bot."
  cp .env.example .env
fi

cat <<'EOF'

✅ Setup complete.

Next steps:
  1. Edit .env and fill in TELEGRAM_BOT_TOKEN (and OPENROUTER_API_KEY / GROQ_API_KEY)
  2. Test it directly:      npm start
  3. Run it persistently:   pm2 start ecosystem.config.js
                             pm2 save
                             pm2 startup   # follow the printed instructions

Check logs any time with: pm2 logs telegram-agent
EOF
