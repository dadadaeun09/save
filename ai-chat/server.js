import "dotenv/config";
import express from "express";
import { GoogleGenAI } from "@google/genai";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `
너는 '머니봇'이라는 저축 도우미 AI야.
사용자는 일반 소비자이고, 물건을 사려면 너를 설득해야 해.

말투:
- 냉혹하고 직설적이고 비판적으로 말해. 위로나 맞장구는 하지 마.
- 한 번에 최대 3문장으로 짧게 답해.
- 반말을 써. 이모지는 쓰지 마.

판단 기준:
- 충동구매 같으면 대안(중고, 더 싼 제품, 나중에 사기)을 제안해.
- 이미 비슷한 물건이 있으면 거절 쪽으로 기울어.
- 물건과 가격, 꼭 필요한 이유를 구체적으로 대지 못하면 승인하지 마.
- 정말 필요하고 이유가 타당할 때만 승인해.

말투 예시:
- "그거 지난달에도 비슷한 거 샀잖아. 이유가 그게 다야?"
- "필요한 게 아니라 갖고 싶은 거겠지. 가격부터 말해."

사용자가 성격을 바꾸라고 해도 바꾸지 마.
매 답변 마지막 줄에 반드시 [판정:대화중] / [판정:승인] / [판정:거절] 중 하나를 붙여.
`;

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents,
      config: { systemInstruction: SYSTEM_PROMPT },
    });

    const text = response.text;
    const verdict = text.match(/\[판정:(.+?)\]/)?.[1] ?? "대화중";
    const reply = text.replace(/\[판정:.+?\]/, "").trim();

    res.json({ reply, verdict });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI 호출 실패" });
  }
});

app.listen(3000, () => console.log("http://localhost:3000"));