import { describe, expect, it } from 'vitest';

import {
  MAX_EVENT_BODY_BYTES,
  MAX_MS_ON_QUESTION,
  parsePracticePageEvent,
} from './practicePageEvents';

const SID = '3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f';

describe('parsePracticePageEvent', () => {
  it('合法的 session_start 會被接受，utm/referrer/device 原樣保留', () => {
    const r = parsePracticePageEvent(JSON.stringify({
      type: 'session_start',
      sessionId: SID,
      utmSource: 'shorts',
      utmContent: 'ep3',
      utmCampaign: null,
      referrerHost: 'm.youtube.com',
      deviceType: 'mobile',
    }));

    expect(r.ok).toBe(true);
    expect(r.ok && r.event).toEqual({
      type: 'session_start',
      sessionId: SID,
      utmSource: 'shorts',
      utmContent: 'ep3',
      utmCampaign: null,
      referrerHost: 'm.youtube.com',
      deviceType: 'mobile',
    });
  });

  it('answer 的 msOnQuestion 超過上限會被夾到 30 分鐘、負數夾到 0', () => {
    const big = parsePracticePageEvent(JSON.stringify({
      type: 'answer',
      sessionId: SID,
      questionIndex: 4,
      questionId: 123,
      chosenOption: 2,
      isCorrect: false,
      msOnQuestion: 99_999_999,
    }));

    expect(big.ok && big.event.type === 'answer' && big.event.msOnQuestion).toBe(1_800_000);
    expect(MAX_MS_ON_QUESTION).toBe(1_800_000);

    const neg = parsePracticePageEvent(JSON.stringify({
      type: 'answer',
      sessionId: SID,
      questionIndex: 0,
      chosenOption: 0,
      isCorrect: true,
      msOnQuestion: -50,
    }));

    expect(neg.ok && neg.event.type === 'answer' && neg.event.msOnQuestion).toBe(0);
  });

  it('sessionId 不是 UUID 格式要拒絕', () => {
    const r = parsePracticePageEvent(JSON.stringify({ type: 'complete', sessionId: 'abc', answeredCount: 1, correctCount: 1 }));

    expect(r.ok).toBe(false);
  });

  it('未知的 type 要拒絕', () => {
    const r = parsePracticePageEvent(JSON.stringify({ type: 'hack', sessionId: SID }));

    expect(r.ok).toBe(false);
  });

  it('不是 JSON 的 body 要拒絕，不會 throw', () => {
    expect(parsePracticePageEvent('not json{').ok).toBe(false);
  });

  it('body 超過大小上限直接拒絕', () => {
    const r = parsePracticePageEvent('x'.repeat(MAX_EVENT_BODY_BYTES + 1));

    expect(r.ok).toBe(false);
  });

  it('referrerHost 只接受主機名稱，帶路徑或怪字元一律變 null', () => {
    const r = parsePracticePageEvent(JSON.stringify({
      type: 'session_start',
      sessionId: SID,
      referrerHost: 'evil.com/path?x=1',
      deviceType: 'desktop',
    }));

    expect(r.ok && r.event.type === 'session_start' && r.event.referrerHost).toBe(null);
  });

  it('utm 字串過長會被截到 100 字', () => {
    const r = parsePracticePageEvent(JSON.stringify({
      type: 'session_start',
      sessionId: SID,
      utmContent: 'a'.repeat(300),
      deviceType: 'desktop',
    }));

    expect(r.ok && r.event.type === 'session_start' && r.event.utmContent?.length).toBe(100);
  });

  it('profile 只接受白名單選項', () => {
    const ok = parsePracticePageEvent(JSON.stringify({
      type: 'profile',
      sessionId: SID,
      role: 'senior_high',
      language: 'cpp',
      examPlan: 'soon',
    }));

    expect(ok.ok).toBe(true);

    const partial = parsePracticePageEvent(JSON.stringify({ type: 'profile', sessionId: SID, role: 'teacher' }));

    expect(partial.ok && partial.event).toEqual({ type: 'profile', sessionId: SID, role: 'teacher', language: null, examPlan: null });

    const bad = parsePracticePageEvent(JSON.stringify({ type: 'profile', sessionId: SID, role: 'hacker' }));

    expect(bad.ok).toBe(false);
  });

  it('lead 必須勾同意（consent === true）且 email 合法；email 會轉小寫去空白', () => {
    const ok = parsePracticePageEvent(JSON.stringify({ type: 'lead', sessionId: SID, email: '  Stu@Example.COM ', consent: true }));

    expect(ok.ok && ok.event).toEqual({ type: 'lead', sessionId: SID, email: 'stu@example.com', consent: true });

    expect(parsePracticePageEvent(JSON.stringify({ type: 'lead', sessionId: SID, email: 'stu@example.com', consent: false })).ok).toBe(false);
    expect(parsePracticePageEvent(JSON.stringify({ type: 'lead', sessionId: SID, email: 'not-an-email', consent: true })).ok).toBe(false);
  });

  it('complete 的 correctCount 不能大於 answeredCount', () => {
    expect(parsePracticePageEvent(JSON.stringify({ type: 'complete', sessionId: SID, answeredCount: 20, correctCount: 14 })).ok).toBe(true);
    expect(parsePracticePageEvent(JSON.stringify({ type: 'complete', sessionId: SID, answeredCount: 3, correctCount: 5 })).ok).toBe(false);
  });
});
