#!/bin/sh
# pre-push 時警告：若當前分支領先 origin/main 超過 15 個 commit，提醒提早合併
# 不會阻擋 push，只是提醒。

set -e

BRANCH=$(git rev-parse --abbrev-ref HEAD)

# main / master 本身不檢查
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ] || [ "$BRANCH" = "HEAD" ]; then
  exit 0
fi

# 若拿不到 origin/main 就跳過（例如離線）
if ! git rev-parse --verify origin/main >/dev/null 2>&1; then
  git fetch origin main >/dev/null 2>&1 || exit 0
fi

AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)

if [ "$AHEAD" -gt 15 ]; then
  printf '\n⚠️  分支 %s 已領先 origin/main %s 個 commit，超過建議上限（15）\n' "$BRANCH" "$AHEAD"
  printf '   建議先合併回 main，或 rebase 縮短分支壽命，以降低合併衝突風險。\n\n'
fi

exit 0
