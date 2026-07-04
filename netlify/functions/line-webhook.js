/* 月月 LINE webhook(Netlify Function)— 相容版,不依賴 fetch
 * 有人傳訊息給月月時,回覆對方的 User ID
 * 需要 Netlify 環境變數 LINE_TOKEN
 */
const https = require("https");

function lineReply(replyToken, text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: "text", text: text }],
    });
    const req = https.request(
      {
        hostname: "api.line.me",
        path: "/v2/bot/message/reply",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: "Bearer " + process.env.LINE_TOKEN,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          console.log("LINE reply status:", res.statusCode, body);
          resolve();
        });
      }
    );
    req.on("error", (e) => {
      console.error("LINE reply error:", e);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 200, body: "ok" };
    }
    const body = JSON.parse(event.body || "{}");
    const events = body.events || [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === "message" && ev.replyToken && ev.source && ev.source.userId) {
        await lineReply(
          ev.replyToken,
          "🌙 你好!你的 LINE User ID 是:\n\n" +
            ev.source.userId +
            "\n\n請把這串 ID 交給月月的管理員完成設定 🌿"
        );
      }
    }
  } catch (e) {
    console.error("handler error:", e);
  }
  return { statusCode: 200, body: "ok" };
};
