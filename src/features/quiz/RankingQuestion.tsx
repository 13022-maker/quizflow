'use client';

/**
 * RankingQuestion
 * 學生端拖拉排序題渲染元件，內部用 survey-react-ui 渲染單一 ranking widget。
 *
 * 受控元件：父層傳入 value（option id 陣列）與 onChange，
 * 元件負責同步 SurveyJS 內部狀態並回報變更。
 *
 * 為了避免 survey-react-ui (~200KB) 影響其他測驗的 bundle，
 * 此檔案會在 QuizTaker 內以 next/dynamic + ssr:false 的方式載入。
 */

import 'survey-core/survey-core.css';

import { useEffect, useMemo } from 'react';
import { Model } from 'survey-core';
import { Survey } from 'survey-react-ui';

type Option = { id: string; text: string };

type Props = {
  questionId: number; // 用於組 SurveyJS question name
  options: Option[]; // 已打亂的顯示順序
  value: string[] | undefined; // 學生目前的答案（option id 陣列）
  onChange: (value: string[]) => void;
};

export function RankingQuestion({ questionId, options, value, onChange }: Props) {
  // 用 useMemo 鎖定 model 實例：避免每次 render 都重建造成 SurveyJS 內部狀態錯亂
  // 只有 questionId 或 options 變動時才重建（同一題的連續 render 會重用實例）
  const survey = useMemo(() => {
    const name = `q${questionId}`;
    const model = new Model({
      questions: [
        {
          type: 'ranking',
          name,
          // QuizFlow 在外層已顯示題目本文，這裡只渲染拖拉排序 widget
          title: ' ',
          choices: options.map(o => ({ value: o.id, text: o.text })),
        },
      ],
      showQuestionNumbers: 'off',
      showCompletedPage: false,
      showNavigationButtons: 'none',
    });
    return model;
  }, [questionId, options]);

  // 同步父層 value 進 SurveyJS（受控元件）
  useEffect(() => {
    const name = `q${questionId}`;
    if (value && value.length > 0) {
      survey.setValue(name, value);
    }
  }, [survey, questionId, value]);

  // 監聽 SurveyJS 變更，回報父層
  useEffect(() => {
    const name = `q${questionId}`;
    const handler = (_sender: unknown, opts: { name: string; value: unknown }) => {
      if (opts.name === name && Array.isArray(opts.value)) {
        onChange(opts.value as string[]);
      }
    };
    survey.onValueChanged.add(handler);
    return () => {
      survey.onValueChanged.remove(handler);
    };
  }, [survey, questionId, onChange]);

  return <Survey model={survey} />;
}
