/* 月月 LINE 每日提醒(個人化版)
 * 讀 Firestore → 抗異常預測 → 依收件人推播各自視角的訊息
 * 環境變數:
 *   LINE_TOKEN               LINE channel access token
 *   FIREBASE_SERVICE_ACCOUNT Firebase 服務帳號金鑰(整份 JSON)
 *   COUPLE_UID               Firestore 文件 ID(登入帳號的 uid)
 *   LINE_UID_0               第一位(persons[0])的 LINE User ID
 *   LINE_UID_1               第二位(persons[1])的 LINE User ID(單人模式可不設)
 */
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

/* ---------- 台北時間的今天 ---------- */
function taipeiToday() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
const pad = (n) => (n < 10 ? "0" : "") + n;
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDays = (d, n) => new Date(d.getTime() + n * 86400 * 1000);
const diffDays = (a, b) => Math.round((b - a) / 86400000);
const fmtMD = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;

/* ---------- 跟 app 相同的統計邏輯 ---------- */
function getRanges(days, idx) {
  const keys = Object.keys(days)
    .filter((k) => days[k] && days[k].p && days[k].p[idx])
    .sort();
  const ranges = [];
  let cur = null;
  for (const k of keys) {
    if (cur && diffDays(parseYmd(cur.end), parseYmd(k)) === 1) {
      cur.end = k;
    } else {
      cur = { start: k, end: k };
      ranges.push(cur);
    }
  }
  return ranges;
}
function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function robustCycle(cycles) {
  if (!cycles.length) return { val: 28, range: 0 };
  let kept = cycles;
  if (cycles.length >= 3) {
    const med = median(cycles);
    kept = cycles.filter((c) => Math.abs(c - med) <= 7);
    if (!kept.length) kept = [med];
  }
  const recent = kept.slice(-6);
  let wsum = 0, vsum = 0;
  recent.forEach((v, i) => { wsum += i + 1; vsum += v * (i + 1); });
  const val = Math.round(vsum / wsum);
  let dev = 0;
  recent.forEach((v) => { dev += Math.abs(v - val); });
  const range = recent.length > 1 ? Math.max(1, Math.round(dev / recent.length)) : 2;
  return { val, range };
}
function getStats(days, idx, today) {
  const ranges = getRanges(days, idx);
  const cycles = [], lens = [];
  ranges.forEach((r, i) => {
    lens.push(diffDays(parseYmd(r.start), parseYmd(r.end)) + 1);
    if (i > 0) cycles.push(diffDays(parseYmd(ranges[i - 1].start), parseYmd(r.start)));
  });
  const rc = robustCycle(cycles);
  const avgLen = lens.length
    ? Math.round(lens.slice(-6).reduce((a, b) => a + b, 0) / Math.min(lens.length, 6))
    : 5;
  let next = null;
  if (ranges.length) {
    next = addDays(parseYmd(ranges[ranges.length - 1].start), rc.val);
    let guard = 0;
    while (diffDays(today, next) < -avgLen && guard < 24) {
      next = addDays(next, rc.val);
      guard++;
    }
  }
  return { avgCycle: rc.val, predRange: rc.range, avgLen, next };
}

/* ---------- 貼心話(自己視角 / 照顧對方視角) ---------- */
const TIPS_BEFORE = [
  "記得檢查包包裡的衛生棉/棉條庫存,出門前補貨最安心",
  "生理褲先洗好晾乾備用,這幾天睡覺可以更放心",
  "這幾天少一點冰飲和咖啡因,身體會舒服一些",
  "可以先準備暖暖包或熱水袋,肚子悶悶的時候派得上用場",
  "早點睡、多喝溫水,經前的疲倦感會輕一點",
  "深色的褲子和床單先準備好,心裡會踏實很多",
  "經前容易水腫,今天少吃一點重鹹的吧",
  "把行程排鬆一點,給快到的那幾天留點餘裕",
  "容易情緒起伏的日子快到了,對自己寬容一點",
  "包包裡塞一片備用的,辦公室抽屜也放一片,雙保險",
];
const TIPS_DURING = [
  "多喝溫熱的水或黑糖薑茶,肚子會舒服一點",
  "衛生棉記得 3~4 小時換一次,悶熱天更要勤換",
  "鐵質補起來:菠菜、紅肉、豬肝湯都是好選擇",
  "腰痠的話用熱敷袋敷 15 分鐘,或輕輕伸展一下",
  "今天就對自己好一點,想休息就休息,不用硬撐",
  "想吃點甜的就吃吧,黑巧克力是不錯的選擇",
  "溫水澡或泡腳可以讓循環變好,睡前試試",
  "側躺屈膝的姿勢對經痛比較友善,睡覺可以試試",
  "疲倦是正常的,今天的待辦清單砍一半也沒關係",
  "輕鬆的散步反而能緩解悶痛,別整天不動唷",
];
const TIPS_BEFORE_PARTNER = [
  "可以先幫她把暖暖包找出來,還有確認衛生棉庫存夠不夠",
  "這幾天她可能比較累,晚餐吃溫熱一點的吧",
  "幫她把生理褲洗好晾乾,她會很感動的",
  "接下來幾天多點耐心和擁抱,少約太累的行程",
  "偷偷準備一點她愛吃的,經前心情不穩時超有用",
  "先把熱水袋找出來放床邊,她需要時就不用翻箱倒櫃",
  "這幾天她說什麼都先順著,道理改天再講 😄",
  "幫她把冰箱的冰飲移到後面,溫熱的飲品放前面",
  "她可能會比平常敏感一點,多一點溫柔的語氣",
  "約會行程排輕鬆點,在家窩著看片也很好",
];
const TIPS_DURING_PARTNER = [
  "泡杯黑糖薑茶或溫熱飲給她,勝過千言萬語",
  "她腰痠的話,幫她熱敷或輕輕按一按吧",
  "今天讓她多休息,家事就交給妳了 💪",
  "晚餐可以補鐵:菠菜、紅肉或豬肝湯都不錯",
  "多一點擁抱和體貼,少一點「妳還好嗎」的追問",
  "她想吃什麼就買什麼,今天不討論熱量",
  "主動把垃圾倒了、碗洗了,她會記得妳的好",
  "幫她把熱水袋的水換熱,小動作最暖心",
  "她如果煩躁,不是針對妳,深呼吸陪著就好",
  "睡前幫她把電熱毯或暖暖包用好,一夜好眠",
];
function dailyTip(list, today) {
  const seed = today.getUTCFullYear() * 372 + (today.getUTCMonth() + 1) * 31 + today.getUTCDate();
  return list[seed % list.length];
}

/* 每個人的今日狀態:'during' | 'predicted' | 天數(1~3) | null */
function personStatus(days, i, today) {
  const rec = days[ymd(today)];
  if (rec && rec.p && rec.p[i]) return { kind: "during" };
  const st = getStats(days, i, today);
  if (!st.next) return null;
  const dd = diffDays(today, st.next);
  if (dd > 0 && dd <= 3) return { kind: "before", dd, next: st.next, range: st.predRange };
  if (dd <= 0 && dd >= -st.avgLen) return { kind: "predicted" };
  return null;
}

async function pushLine(to, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_TOKEN}`,
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE push 失敗 ${res.status}: ${body}`);
  }
}

/* ---------- 主流程 ---------- */
async function main() {
  const snap = await db.collection("couples").doc(process.env.COUPLE_UID).get();
  if (!snap.exists) {
    console.log("找不到資料文件,結束");
    return;
  }
  const data = snap.data();
  const persons = data.persons || [];
  const days = data.days || {};
  const today = taipeiToday();
  const count = data.solo ? 1 : 2;

  const lineUids = [process.env.LINE_UID_0, process.env.LINE_UID_1];
  const statuses = [];
  for (let i = 0; i < count; i++) statuses.push(personStatus(days, i, today));

  for (let r = 0; r < count; r++) {
    if (!lineUids[r]) continue;
    const lines = [];
    let tip = "";

    /* 自己的狀態(優先) */
    const self = statuses[r];
    const selfName = persons[r] ? persons[r].name : `第${r + 1}位`;
    if (self) {
      if (self.kind === "during") {
        lines.push(`${selfName},今天經期進行中 🩷`);
        tip = dailyTip(TIPS_DURING, today);
      } else if (self.kind === "predicted") {
        lines.push(`${selfName},妳的經期預計已開始,記得到月月記錄唷`);
        tip = dailyTip(TIPS_DURING, today);
      } else {
        lines.push(`${selfName},妳的經期預計 ${self.dd} 天後(${fmtMD(self.next)} ±${self.range}天)`);
        tip = dailyTip(TIPS_BEFORE, today);
      }
    }

    /* 對方的狀態(照顧視角) */
    const p = 1 - r;
    if (count === 2 && statuses[p]) {
      const other = statuses[p];
      const otherName = persons[p] ? persons[p].name : `第${p + 1}位`;
      if (other.kind === "during" || other.kind === "predicted") {
        lines.push(`${otherName} 的經期進行中`);
        if (!tip) tip = dailyTip(TIPS_DURING_PARTNER, today);
      } else {
        lines.push(`${otherName} 的經期預計 ${other.dd} 天後(${fmtMD(other.next)})`);
        if (!tip) tip = dailyTip(TIPS_BEFORE_PARTNER, today);
      }
    }

    if (!lines.length) {
      console.log(`${selfName}:今天沒有需要提醒的事`);
      continue;
    }
    const text = "🌙 月月晨報\n\n" + lines.join("\n") + (tip ? "\n\n🌿 " + tip : "");
    await pushLine(lineUids[r], text);
    console.log(`已發送給 ${selfName}:\n${text}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
