import type { SimMode } from '@/libs/sim/types';
import { AppConfig } from '@/utils/AppConfig';

/** 學生連結路徑：預設語系（zh）不帶前綴（localePrefix: as-needed），其餘帶 /{locale} */
export function simStudentPath(locale: string, accessCode: string): string {
  const prefix = locale && locale !== AppConfig.defaultLocale ? `/${locale}` : '';
  return `${prefix}/sim/${accessCode}`;
}

export const SIM_MODE_BADGE: Record<SimMode, { label: string; cls: string }> = {
  practice: { label: '練習', cls: 'bg-blue-50 text-blue-700' },
  exam: { label: '測驗', cls: 'bg-violet-50 text-violet-700' },
};
