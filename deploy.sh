#!/usr/bin/env bash
# 一鍵部署：git commit + push 到 GitHub（GitHub Pages 自動更新）
# 用法：./deploy.sh "更新說明"   ← 省略則自動用時間戳
#
# ⚠️ index.html（中控中心入口）已刻意排除，請勿加入 git add 範圍
#    如需更新中控中心，請單獨執行：git add index.html && git commit -m "..."

set -e
MSG="${1:-chore: auto-deploy $(date '+%Y-%m-%d %H:%M')}"

echo "▶ 狀態確認..."
git status --short

echo ""
echo "▶ 暫存儀表板頁面（排除 index.html 中控中心）"
git add operation.html finance.html marketing.html products.html \
        seo.html repair.html custom.html data.js 2>/dev/null || true

if git diff --cached --quiet; then
  echo "⚠️  沒有需要提交的變更，略過 commit。"
else
  echo "▶ Commit: $MSG"
  git commit -m "$MSG"
fi

echo "▶ Push 到 GitHub main..."
git push origin HEAD:main

echo ""
echo "✅ 部署完成！GitHub Pages 約 1 分鐘後更新。"
echo "   中控中心（index.html）：未異動"
