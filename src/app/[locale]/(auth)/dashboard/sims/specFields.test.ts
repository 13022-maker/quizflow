import { describe, expect, it } from 'vitest';

import { diffSpec, HDFIX3_DEFAULT_SPEC, type SpecDraft } from './specFields';

const base = (): SpecDraft => ({ ...HDFIX3_DEFAULT_SPEC, office: [...HDFIX3_DEFAULT_SPEC.office] });

describe('diffSpec', () => {
  it('全部沿用預設回傳 null', () => {
    expect(diffSpec(base())).toBeNull();
  });

  it('只回傳改過的欄位，數字欄位轉 number、office 依固定順序', () => {
    const d = base();
    d.vmRAM = '4';
    d.color = 'blue';
    d.font = '  ';
    d.office = ['ppt', 'word'];

    expect(diffSpec(d)).toEqual({ vmRAM: 4, color: 'blue', office: ['word', 'ppt'] });
  });
});
