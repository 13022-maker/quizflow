/**
 * 產生 public/practice/circuit-diagram-fill.html —— 「電腦、電子及電機機械識圖」免費題庫練習
 * （public/practice/circuit-diagram.html，單選題）的填充題版本，套用靜態填空練習頁殼
 * （src/lib/exportFillBlankPracticePage.ts）。
 *
 * 題目改寫原則：
 * - 題號沿用官方題號（q1~q49），答案取自原單選題的官方正解，只把題幹改寫成填空句
 * - 練習頁的比對是「去頭尾空白、不分大小寫、整串相等」，所以空格答案盡量短且唯一，
 *   需要特定寫法的（英文縮寫、含符號的指令）在題幹括號註明格式
 * - q3（選項本身是四張右側視圖）無法改成填空，略過，共 48 題
 *
 * 用法：npx tsx scripts/build-circuit-diagram-fill.ts
 * 改題目只改這支，再重跑產生 HTML；不要直接手改產出的 HTML。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FillBlankPracticeQuestion } from '../src/lib/exportFillBlankPracticePage';
import { buildFillBlankPracticePageHtml, selectFillBlankQuestions } from '../src/lib/exportFillBlankPracticePage';

const GROUP = '工作項目01：電腦、電子及電機機械識圖';

type Item = { id: string; body: string; answer: string; explanation: string; image?: string };

const ITEMS: Item[] = [
  { id: 'q1', image: 'images/q1.png', body: '下圖所示之 D 型正反器，Clock 採 ___ 觸發動作。（兩個字）', answer: '正緣', explanation: 'CK 輸入端只畫三角形、沒有反相小圓圈，依慣例代表正緣觸發；若三角形前多一個小圓圈，才是負緣觸發。' },
  { id: 'q2', image: 'images/q2.png', body: '下圖所示符號用來表示 ___。（中文名稱）', answer: '解多工器', explanation: '圖中 1 個輸入 A 搭配選擇線 S1S0、展開成 Y0~Y3 多個輸出，是「一對多」的解多工器（Demultiplexer）；多工器則相反，是多個輸入選一個輸出。' },
  { id: 'q4', image: 'images/q4.png', body: '下圖所示邏輯符號功能相當於 ___ 閘。（填英文）', answer: 'XOR', explanation: '用 OR / NOR 等基本邏輯閘組合出 XOR（互斥或）是教科書常見的等效電路。' },
  { id: 'q5', image: 'images/q5.png', body: '下圖 IC 符號第一支接腳位置在 ___ 腳。（填英文字母）', answer: 'B', explanation: 'DIP 封裝 IC 頂視圖上，缺口（或圓點）那一側、缺口下方的接腳即為第 1 腳，再以逆時針方向依序編號；圖中缺口在左側，對應下方的 B 腳。' },
  { id: 'q6', image: 'images/q6.png', body: '下圖所示符號用來表示 ___ 電源。（兩個字）', answer: '直流', explanation: '一長一短兩條平行線是電池／直流電源的標準符號，長線為正極、短線為負極。' },
  { id: 'q7', image: 'images/q7.png', body: '下圖所示符號用來表示 ___。（三個字）', answer: '電流源', explanation: '圓圈內畫箭頭是電流源的標準符號，箭頭方向表示電流流向；電壓源則是圓圈內畫加減號或波浪線。' },
  { id: 'q8', image: 'images/q8.png', body: '如圖輸出等於 ___ 閘。（填英文）', answer: 'NOR', explanation: 'CMOS 邏輯閘裡，上拉網路（PMOS）串聯、下拉網路（NMOS）並聯是 NOR 閘的典型實作（NAND 相反：PMOS 並聯、NMOS 串聯）。' },
  { id: 'q9', image: 'images/q9.png', body: '如下圖所示符號中，有一三角形表示 CK 為 ___ 觸發。（兩個字）', answer: '邊緣', explanation: 'CK 輸入端畫成三角形（不論有沒有小圓圈）就代表邊緣觸發（edge-triggered）；沒有三角形的是準位觸發。' },
  { id: 'q10', image: 'images/q10.png', body: '如下圖所示，在 IC 資料手冊上其表示 CK 為 ___ 觸發。（兩個字）', answer: '負緣', explanation: '三角形前多一個小圓圈（反相符號），代表在訊號由高轉低的瞬間觸發，也就是負緣觸發；沒有小圓圈則是正緣觸發。' },
  { id: 'q11', body: '前視圖可表示物件前部的形狀、高度與寬度，但不能表示物件的 ___。', answer: '亮度', explanation: '工程圖呈現的是幾何形狀與尺寸，亮度屬於材質／光影表現，不是視圖要傳達的資訊。' },
  { id: 'q12', body: '繪製電路圖時，習慣上將輸入訊號置於 ___ 方。（一個字）', answer: '左', explanation: '電路圖慣例是訊號由左至右流動，輸入畫在左邊、輸出畫在右邊。' },
  { id: 'q13', body: '我國國家標準（CNS）以 ___ 制單位表達繪製元件的外型尺寸。（一個字）', answer: '公', explanation: 'CNS 採用公制（SI 制）作為工程製圖的標註單位。' },
  { id: 'q14', body: '將鉛筆之筆芯兩側削薄成楔形者，是專門用來繪製 ___ 線。（一個字）', answer: '直', explanation: '楔形筆芯兩側平整、線寬穩定，方便沿直尺畫出粗細一致的直線；曲線類多用圓錐形筆芯。' },
  { id: 'q15', body: 'BMP、GIF、JPG、TIF 中，官方標示電腦繪圖儲存後不失真的格式是 ___。', answer: 'BMP', explanation: 'BMP 是無壓縮點陣格式，不會失真；JPG 是破壞性壓縮，GIF 只支援 256 色。TIF 雖也可無失真，但官方正解為 BMP。' },
  { id: 'q16', body: 'EMM386、HIMEM、QEMM、MEM 中，不具備主動管理系統記憶體資源能力的是 ___。', answer: 'MEM', explanation: 'MEM 是 DOS 下用來「查看」記憶體使用狀況的指令，本身不管理記憶體；其餘三個都是實際的記憶體管理程式。' },
  { id: 'q17', body: '示波器面板的「CAL」（Calibration）端子輸出 1KHz 的 ___ 波。（一個字）', answer: '方', explanation: 'CAL 校正端子輸出已知頻率、已知幅度的方波（常見為 1KHz），用來校正探棒補償。' },
  { id: 'q18', body: 'CD Title 是指 ___ 之光碟片。（三個字）', answer: '有資料', explanation: 'CD Title 泛指已燒錄好內容（遊戲、音樂、軟體等）的光碟片，相對於空白片。' },
  { id: 'q19', body: 'Windows 7 刪除的檔案，暫存放在 ___。', answer: '資源回收筒', explanation: '一般刪除（非 Shift+Delete）的檔案會先移到資源回收筒，清空後才真正刪除。' },
  { id: 'q20', body: 'vi、ed、edit、emacs 中，不是 Linux 文書編輯器的是 ___。', answer: 'edit', explanation: 'edit 是 DOS／Windows 的文字編輯器指令；vi、ed、emacs 才是 Linux／Unix 常見的編輯器。' },
  { id: 'q21', body: 'Windows Server 2012 R2 Essentials 支援 ___ 個虛擬機器授權。（填阿拉伯數字）', answer: '1', explanation: '依微軟當時的授權規則，Essentials 版只授權在 1 台虛擬機器上執行。' },
  { id: 'q22', body: 'Windows Server 2012 R2 Datacenter 支援的虛擬機器授權數為 ___。（三個字）', answer: '無限制', explanation: 'Datacenter 版同一台實體主機上可執行無限數量的虛擬機器，這是它與 Standard 版最大的差異。' },
  { id: 'q23', body: 'Windows 7 中的整合管理工具為 ___。（填英文縮寫）', answer: 'MMC', explanation: 'MMC（Microsoft Management Console）是 Windows 整合各種管理嵌入式管理單元的主控台框架。' },
  { id: 'q24', body: 'Windows 7 網路通訊協定預設為 ___。', answer: 'TCP/IP', explanation: '現行 Windows 版本（含 Windows 7）預設安裝並啟用的通訊協定就是 TCP/IP。' },
  { id: 'q25', body: 'Windows 7 Client 要重新向 DHCP Server 取得一組新 IP，要執行 ipconfig ___ 指令。（含斜線）', answer: '/renew', explanation: 'ipconfig /renew 向 DHCP 伺服器重新要一組 IP；/release 是釋放目前的 IP，/all 只顯示詳細資訊。' },
  { id: 'q26', body: 'Windows 7 製作系統修護光碟：控制台 → 系統及安全性 → 備份與還原 → 建立系統 ___。（兩個字）', answer: '光碟', explanation: '「建立系統修復光碟」就在控制台的備份與還原裡；「建立系統映像」是另一個功能，別搞混。' },
  { id: 'q27', body: '在 Windows 7 安裝過程中，欲開啟命令提示字元視窗，應按 ___。（格式如 Ctrl+F1，不含空格）', answer: 'Shift+F10', explanation: '在 Windows 安裝畫面按 Shift+F10 可以叫出命令提示字元視窗。' },
  { id: 'q28', body: 'Linux 安裝時，硬碟容量、記憶體容量、硬碟介面都需考慮，___ 容量則可不列入考慮。（填英文）', answer: 'CACHE', explanation: 'CPU 快取（CACHE）容量是處理器內建規格，不是安裝作業系統前要另外評估的項目。' },
  { id: 'q29', body: 'Windows 7 預設的電源計畫有平衡、省電、高效能；選項中的 ___ 不是預設電源計畫。（兩個字）', answer: '環保', explanation: 'Windows 7 預設提供「平衡」「省電」「高效能」三種電源計畫，「環保」不在其中。' },
  { id: 'q30', body: 'Windows 7 電源選項內，屬於系統建議的電源計畫是 ___。（兩個字）', answer: '平衡', explanation: '「平衡」是系統建議（預設）的計畫，在效能與省電之間取得折衷。' },
  { id: 'q31', body: 'Windows 7 中無法刪除自己建立的電源計畫，可能是因為該電源計畫正在 ___ 中。（兩個字）', answer: '使用', explanation: '正在套用中的電源計畫無法直接刪除，必須先切換成其他計畫才能刪除。' },
  { id: 'q32', body: '副檔名 *.mp3 是 ___ 壓縮檔。（兩個字）', answer: '聲音', explanation: 'MP3（MPEG-1 Audio Layer 3）是聲音（音訊）壓縮格式。' },
  { id: 'q33', body: 'Windows 7 中無法變更電源設定，可能是 AD 管理員使用 ___ 停用或移除該項設定。（四個字）', answer: '群組原則', explanation: '企業網域環境下，管理員可透過群組原則（Group Policy）鎖定或移除電源設定選項。' },
  { id: 'q34', body: 'BitLocker 可針對整個 ___ 加密。（兩個字）', answer: '磁碟', explanation: 'BitLocker 以磁碟（磁區）為單位整體加密，不是針對單一檔案，也不是螢幕鎖定或開機密碼。' },
  { id: 'q35', body: 'BitLocker 可針對特定磁碟分割區、外接式硬碟，以及 USB ___ 磁碟加密。（兩個字）', answer: '快閃', explanation: 'BitLocker To Go 就是設計來對 USB 隨身碟等外接儲存裝置加密，所以原題「無法提供 USB 快閃磁碟加密」是錯誤敘述。' },
  { id: 'q36', body: '「電機電子工程師學會」的英文簡稱是 ___。', answer: 'IEEE', explanation: 'IEEE = Institute of Electrical and Electronics Engineers。' },
  { id: 'q37', body: '「中華民國國家標準」的英文簡稱是 ___。', answer: 'CNS', explanation: 'CNS = Chinese National Standards。' },
  { id: 'q38', body: '一般電器設備之接地線的顏色是 ___ 色。（一個字）', answer: '綠', explanation: '國際慣例與國內配線規則多以綠色（或黃綠雙色）代表接地線。' },
  { id: 'q39', body: '個人電腦主機板插槽介面 PCI 的針腳數為 ___ pins。', answer: '124', explanation: '標準 32 位元 PCI 插槽的針腳數為 124 pins。' },
  { id: 'q40', body: '個人電腦主機板插槽介面 IDE 的針腳數為 ___ pins。', answer: '40', explanation: '傳統並列式 IDE（PATA）排線接頭規格為 40 針（2.5 吋規格另有 44 針版本）。' },
  { id: 'q41', body: 'ATA33、ATA66、ATA100、ATA133 中，資料傳輸速度最快的是 ___。', answer: 'ATA133', explanation: 'ATA 後面的數字代表理論最大傳輸速度（MB/s），數字越大越快。' },
  { id: 'q42', body: 'DVD-5、DVD-9、DVD-10、DVD-18 中，儲存容量最大的是 ___。', answer: 'DVD-18', explanation: 'DVD-5 單面單層約 4.7GB、DVD-9 單面雙層約 8.5GB、DVD-10 雙面單層約 9.4GB、DVD-18 雙面雙層約 17GB。' },
  { id: 'q43', body: '「WinRAR」工具軟體的主要功能是 ___ 檔案或解壓縮檔案。（兩個字）', answer: '壓縮', explanation: 'WinRAR 是壓縮／解壓縮工具，支援 RAR、ZIP 等格式。' },
  { id: 'q44', body: '「CuteFTP」工具軟體的主要功能是檔案 ___ 或下載。（兩個字）', answer: '上傳', explanation: 'CuteFTP 是 FTP 用戶端軟體，用來跟伺服器之間上傳／下載檔案。' },
  { id: 'q45', body: '「WinZip」工具軟體的主要功能是壓縮檔案或 ___ 檔案。（三個字）', answer: '解壓縮', explanation: 'WinZip 是老牌的壓縮／解壓縮工具，主打 ZIP 格式。' },
  { id: 'q46', body: '「Windows Media Player」工具軟體的主要功能是 ___ 或影片播放。（兩個字）', answer: '聲音', explanation: 'Windows Media Player 是微軟內建的多媒體（音樂／影片）播放軟體。' },
  { id: 'q47', body: '「Nero StartSmart」工具軟體的主要功能是燒錄 ___ 或 DVD。（填英文）', answer: 'CD', explanation: 'Nero 系列是知名光碟燒錄軟體，StartSmart 是它的功能啟動主控台。' },
  { id: 'q48', body: '依據 EIA 568-A 標準，接在 RJ-45 接頭第 3 支接腳上的雙絞線顏色為 ___。（兩個字）', answer: '白綠', explanation: '本題答案沿用題本標示的「白綠」。注意：依現行 TIA-568 線序，568-A 第 3 腳為白橙、568-B 第 3 腳才是白綠，建議對照官方題本確認。' },
  { id: 'q49', image: 'images/q49.jpeg', body: '下圖為 USB ___ 接頭。（格式如 Mini-B）', answer: 'Type-C', explanation: 'USB Type-C 接頭外型呈橢圓對稱狀，沒有正反面之分；Mini-B／Micro-B 則是梯形、有方向性。' },
];

const questions: FillBlankPracticeQuestion[] = ITEMS.map((item) => {
  const { practiceQuestions, skipped } = selectFillBlankQuestions({
    groupLabel: GROUP,
    questions: [{ type: 'short_answer', body: item.body, correctAnswers: [item.answer], explanation: item.explanation }],
  });
  if (skipped || practiceQuestions.length !== 1) {
    throw new Error(`${item.id} 轉換失敗：題幹必須剛好有一個 ___ 空格`);
  }
  const q = practiceQuestions[0]!;
  return item.image ? { ...q, image: item.image, imageAlt: `官方題號 ${item.id.slice(1)} 附圖` } : q;
});

const html = buildFillBlankPracticePageHtml({
  title: '電腦、電子及電機機械識圖 填充題練習',
  kick: '12000 電腦硬體裝修 丙級',
  enSubtitle: `題目與答案取自勞動部技能檢定學科題庫工作項目 01，改寫為填充題（共 ${questions.length} 題）；詳解為非官方補充。`,
  questions,
});

const out = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'public', 'practice', 'circuit-diagram-fill.html');
writeFileSync(out, html);
console.log(`已產生 ${out}（${questions.length} 題）`);
