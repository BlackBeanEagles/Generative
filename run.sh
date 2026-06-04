#!/bin/bash
set -e

echo "🎭 MemeExpression — Starting up..."

# Load .env if it exists
if [ -f "$(dirname "$0")/.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/.env" | xargs)
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ ANTHROPIC_API_KEY is not set."
  echo "   Create a .env file from .env.example and fill in your keys."
  exit 1
fi

if [ -z "$IMGFLIP_USERNAME" ] || [ -z "$IMGFLIP_PASSWORD" ]; then
  echo "⚠️  IMGFLIP_USERNAME / IMGFLIP_PASSWORD not set."
  echo "   Real meme images won't have custom caption text overlaid."
  echo "   Get a free account at https://imgflip.com/signup"
  echo ""
fi

cd "$(dirname "$0")/backend"

if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "📦 Installing dependencies..."
  pip install -r requirements.txt -q
fi

echo "✅ Starting at http://localhost:8000"
echo "   Press Space in browser for instant analysis"
echo "   Press Ctrl+C to stop"
echo ""
python3 main.py
