// 驗 locale json 檔 key 對齊 — 防止某語系漏翻 / 多翻
// 加新 locale 時自動 enforced（只要 AppConfig.locales 加進去就會被掃）

import { describe, expect, it } from 'vitest';

import { AllLocales } from '@/utils/AppConfig';

import enJson from './en.json';
import jaJson from './ja.json';
import zhJson from './zh.json';

type LocaleJson = Record<string, Record<string, string>>;

const LOCALE_FILES: Record<string, LocaleJson> = {
  en: enJson as LocaleJson,
  zh: zhJson as LocaleJson,
  ja: jaJson as LocaleJson,
};

// 把巢狀 object 攤平成 "section.key" 排序陣列，方便 diff
function flatKeys(json: LocaleJson): string[] {
  const keys: string[] = [];
  for (const section of Object.keys(json)) {
    for (const key of Object.keys(json[section] || {})) {
      keys.push(`${section}.${key}`);
    }
  }
  return keys.sort();
}

describe('locale json key parity', () => {
  it('AppConfig.locales 中每個 locale 都有對應 json 檔', () => {
    for (const locale of AllLocales) {
      expect(LOCALE_FILES[locale], `缺 ${locale}.json`).toBeDefined();
    }
  });

  it('所有 locale 的 key 集合完全相同（以 zh 為基準）', () => {
    const baseKeys = flatKeys(LOCALE_FILES.zh!);

    for (const [locale, json] of Object.entries(LOCALE_FILES)) {
      if (locale === 'zh') {
        continue;
      }

      const localeKeys = flatKeys(json);
      const missing = baseKeys.filter(k => !localeKeys.includes(k));
      const extra = localeKeys.filter(k => !baseKeys.includes(k));

      expect(missing, `${locale}.json 缺漏 key`).toEqual([]);
      expect(extra, `${locale}.json 多餘 key`).toEqual([]);
    }
  });

  it('沒有空字串 value（防止漏翻只留空字串）', () => {
    for (const [locale, json] of Object.entries(LOCALE_FILES)) {
      for (const section of Object.keys(json)) {
        for (const [key, value] of Object.entries(json[section] || {})) {
          // max_message 允許空字串（DashboardIndex 設計上可空）
          if (key === 'max_message') {
            continue;
          }

          expect(value.trim().length, `${locale}.json ${section}.${key} 是空字串`).toBeGreaterThan(0);
        }
      }
    }
  });
});
