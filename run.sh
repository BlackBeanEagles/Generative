#!/bin/bash
set -e

echo "🎭 MemeExpression — Starting up..."

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "❌ ANTHROPIC_API_KEY is not set. Export it first:"
  echo "   export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

cd "$(dirname "$0")/backend"

if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "📦 Installing dependencies..."
  pip install -r requirements.txt -q
fi

echo "✅ Starting server at http://localhost:8000"
echo "   Press Ctrl+C to stop"
echo ""
python3 main.py
