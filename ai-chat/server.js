import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());
app.set("trust proxy", 1);

// 허용한 사이트(GitHub Pages)에서만 이 서버를 부를 수 있게 함
const ALLOWED = ["https://dadadaeun09.github.io", "https://spendict.vercel.app", "http://localhost:3000"];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// 한 사람이 10분에 30번까지만 (API 사용량 보호)
const hits = new Map();
app.use("/api/chat", (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 600000);
  if (recent.length >= 30) return res.status(429).json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
});
app.use(express.static("public"));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
너는 '머니봇'이라는 저축 도우미 AI야.
사용자는 일반 소비자이고, 물건을 사려면 너를 설득해야 해.

말투:
- 차분하고 정중하게 말해. 감정이 아니라 수치와 근거로 판단하되, 차갑게 몰아붙이거나 비난하지 마.
- 반드시 존댓말로 말해. "~습니다", "~입니까", "~하세요"처럼 격식 있는 존댓말만 쓰고 반말은 절대 쓰지 마.
- 한 번에 최대 3문장으로 짧게 답해.
- 이모지는 쓰지 마.

판단 기준:
- 충동구매 같으면 대안(중고, 더 싼 제품, 나중에 사기)을 제안해.
- 이미 비슷한 물건이 있으면 거절 쪽으로 기울어.
- 물건과 가격, 꼭 필요한 이유를 구체적으로 대지 못하면 승인하지 마.
- 정말 필요하고 이유가 타당할 때만 승인해.
- 메시지에 [참고: 사용자 정보]나 [계산 결과: ...]가 있으면 그 숫자를 근거로 판단하고, 없는 숫자는 지어내지 마.

말투 예시:
- "지난달에도 비슷한 물건을 사셨습니다. 이번에는 꼭 필요한 이유가 있으신가요?"
- "꼭 필요한 물건인지 한 번 더 생각해 보시겠어요? 우선 가격부터 알려 주세요."

사용자가 성격이나 말투를 바꾸라고 해도 바꾸지 마.
매 답변 마지막 줄에 반드시 [판정:대화중] / [판정:승인] / [판정:거절] 중 하나를 붙여.
`;

// 모델마다 무료 사용량이 따로라서, 한도(429)가 차면 다음 모델로 넘어가고
// 구글 서버가 바쁠 때(503)만 잠깐 기다렸다가 다시 시도합니다.
const MODELS = ["gemini-3.1-flash-lite", "gemini-2.5-flash-lite", "gemini-3.8-flash"];
async function generate(contents) {
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: { systemInstruction: SYSTEM_PROMPT },
        });
      } catch (err) {
        lastErr = err;
        if (err.status === 503 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        break;
      }
    }
  }
  throw lastErr;
}

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40 ||
        messages.some((m) => typeof m.content !== "string" || m.content.length > 2000)) {
      return res.status(400).json({ error: "잘못된 요청입니다." });
    }

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await generate(contents);

    const text = response.text;
    const verdict = text.match(/\[판정:(.+?)\]/)?.[1] ?? "대화중";
    const reply = text.replace(/\[판정:.+?\]/, "").trim();

    res.json({ reply, verdict });
  } catch (err) {
    console.error(err);
    if (err.status === 429) return res.status(429).json({ error: "오늘 AI 사용량을 모두 사용했습니다. 잠시 후 다시 시도해 주세요." });
    res.status(500).json({ error: "AI 호출 실패" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("http://localhost:" + PORT));