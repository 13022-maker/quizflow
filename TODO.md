# TODO - 待處理項目

## ESLint warnings（35 個，非 blocking）
- `react-dom/no-missing-button-type`：約 25 處 button 缺少 `type="button"` 屬性（不影響功能）
- `tailwindcss/no-custom-classname`：`flex-2`、`perspective-[800px]` 等自訂 class（有效但 lint 不認識）
- `react-refresh/only-export-components`：QuestionForm.tsx 和 QuizTableColumns.tsx 同時匯出常數與元件
- `tailwindcss/classnames-order`：1 處 class 順序問題
- `react/no-array-index-key`：1 處使用 array index 作 key

## 需要手動測試
- [ ] 快閃卡翻牌動畫在手機瀏覽器的表現
- [ ] 定價頁面修改後 Vercel 正式站顯示是否正確
- [ ] 是非題修復後，舊資料的是非題是否能正常作答

## 未來需要人工處理
- [ ] ECPay 金流需要綠界商店帳號與 API 金鑰
- [ ] Stripe 測試金鑰需替換為正式金鑰
- [ ] 5 月起 isProOrAbove 自動切換為正式分級（已排程在程式碼中）
