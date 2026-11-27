import type { DemoQuestion } from '@/libs/demoQuiz';

/**
 * /demo 公開範例頁的示範測驗（靜態資料，不寫 DB）
 * 模擬老師輸入「國中自然 光合作用」、選 108 課綱素養後，AI 出好並經老師審過的一份卷子
 */
export const DEMO_QUIZ = {
  title: '國二自然｜光合作用 隨堂小考',
  prompt: '國中自然 光合作用，6 題，108 課綱素養導向',
  subject: '自然',
  grade: '國中二年級',
  questions: [
    {
      id: 'q1',
      type: 'single_choice',
      body: '植物細胞中，進行光合作用的主要構造是下列何者？',
      options: [
        { id: 'a', text: '細胞核' },
        { id: 'b', text: '粒線體' },
        { id: 'c', text: '葉綠體' },
        { id: 'd', text: '液胞' },
      ],
      correctAnswers: ['c'],
      explanation: '葉綠體含有葉綠素，能吸收光能進行光合作用。粒線體負責呼吸作用；細胞核控制遺傳；液胞主要儲存水分與物質。',
      tags: ['記憶', '自然 Ec'],
    },
    {
      id: 'q2',
      type: 'true_false',
      body: '光合作用過程中釋放的氧氣，來自於水分子的分解。',
      options: [
        { id: 'tf-true', text: '正確' },
        { id: 'tf-false', text: '錯誤' },
      ],
      correctAnswers: ['tf-true'],
      explanation: '光反應時水被分解，產生氧氣釋放到空氣中；二氧化碳中的碳與氧則用來合成葡萄糖。',
      tags: ['理解'],
    },
    {
      id: 'q3',
      type: 'multiple_choice',
      body: '下列哪些是植物進行光合作用所需的「原料」？（多選）',
      options: [
        { id: 'a', text: '二氧化碳' },
        { id: 'b', text: '水' },
        { id: 'c', text: '葡萄糖' },
        { id: 'd', text: '氧氣' },
      ],
      correctAnswers: ['a', 'b'],
      explanation: '原料是二氧化碳和水；葡萄糖與氧氣是光合作用的產物。光能與葉綠素是必要條件，但不屬於原料。',
      tags: ['理解'],
    },
    {
      id: 'q4',
      type: 'single_choice',
      body: '小安把一盆植物放在密閉透明玻璃罩內，照光數小時後，罩內哪一種氣體的比例最可能「增加」？',
      options: [
        { id: 'a', text: '二氧化碳' },
        { id: 'b', text: '氧氣' },
        { id: 'c', text: '氮氣' },
        { id: 'd', text: '各種氣體的比例都不會改變' },
      ],
      correctAnswers: ['b'],
      explanation: '照光時光合作用速率大於呼吸作用，植物吸收二氧化碳、釋放氧氣，所以罩內氧氣比例上升、二氧化碳下降；氮氣不參與光合作用。',
      tags: ['應用', '素養題'],
    },
    {
      id: 'q5',
      type: 'single_choice',
      body: '小美做實驗：甲葉片照光、乙葉片用鋁箔紙完全包住，其他條件相同。6 小時後以碘液檢測澱粉，下列結果何者最合理？',
      options: [
        { id: 'a', text: '甲、乙都變藍黑色' },
        { id: 'b', text: '甲變藍黑色，乙不變色' },
        { id: 'c', text: '甲不變色，乙變藍黑色' },
        { id: 'd', text: '甲、乙都不變色' },
      ],
      correctAnswers: ['b'],
      explanation: '甲葉片照光能行光合作用產生澱粉，遇碘液呈藍黑色；乙葉片沒有光，無法產生澱粉（實驗前已先將葉片置於暗處消耗澱粉），所以不變色。這個設計的操縱變因是「光」。',
      tags: ['分析', '素養題', '探究實作'],
    },
    {
      id: 'q6',
      type: 'single_choice',
      body: '承上題，這個實驗主要想探討的問題是下列何者？',
      options: [
        { id: 'a', text: '光合作用是否需要二氧化碳？' },
        { id: 'b', text: '光合作用是否需要光？' },
        { id: 'c', text: '光合作用是否需要水？' },
        { id: 'd', text: '葉片是否會進行呼吸作用？' },
      ],
      correctAnswers: ['b'],
      explanation: '甲、乙唯一的差別是有沒有照光（操縱變因），因此探討的是「光合作用是否需要光」。二氧化碳、水在兩組都一樣，屬於控制變因。',
      tags: ['評鑑', '探究實作'],
    },
  ] satisfies DemoQuestion[],
};
