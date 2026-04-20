#!/bin/sh
# 確保新增的 migration 檔名為 YYYYMMDD_*.sql（避免 0001、0002 這種序號互撞）
# 已存在的 0000_... 舊檔豁免；只檢查本次被加入的新檔。

set -e

STAGED=$(git diff --cached --name-only --diff-filter=A | grep -E '^migrations/.*\.sql$' || true)

if [ -z "$STAGED" ]; then
  exit 0
fi

BAD=""
for f in $STAGED; do
  base=$(basename "$f")
  # 允許兩種：0000_xxx.sql（舊序號，只允許既有檔）或 YYYYMMDD[_HHMM]_xxx.sql（新規）
  case "$base" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*.sql) ;;                     # 8 碼日期
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_[0-9][0-9][0-9][0-9]_*.sql) ;; # 8 碼日期 + 4 碼時間
    *)
      BAD="$BAD\n  - $f"
      ;;
  esac
done

if [ -n "$BAD" ]; then
  printf '✖ migration 檔名不符規範（需為 YYYYMMDD_name.sql 或 YYYYMMDD_HHMM_name.sql）：%b\n' "$BAD"
  printf '請改名後再 commit，例如：migrations/%s_add_column.sql\n' "$(date +%Y%m%d)"
  exit 1
fi

exit 0
