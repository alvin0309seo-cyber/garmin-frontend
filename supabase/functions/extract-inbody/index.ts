import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai@0.24.1";

const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY")!;
const genAI = new GoogleGenerativeAI(GEMINI_KEY);

const OCR_PROMPT = `너는 인바디(InBody) 체성분 분석 결과지를 읽는 OCR 엔진이다.
첨부된 이미지/PDF는 인바디 결과지다. 보이는 모든 측정 수치를 다음 JSON 스키마에 맞춰 추출해라.
이미지에 해당 항목이 없으면 null을 넣어라. 수치는 숫자(문자열 아님)로, 단위는 붙이지 마라.
반드시 JSON만 출력해라 (마크다운 코드블록 금지).

{
  "machine": "측정기기 모델명 (예: InBody 270)",
  "measuredAt": "측정일시 (YYYY-MM-DD 또는 YYYY-MM-DD HH:mm)",
  "gender": "남성 또는 여성",
  "age": 0,
  "heightCm": 0,
  "weightKg": 0,
  "skeletalMuscleKg": 0,
  "bodyFatKg": 0,
  "bodyFatPct": 0,
  "bmi": 0,
  "totalBodyWaterL": 0,
  "proteinKg": 0,
  "mineralKg": 0,
  "bmrKcal": 0,
  "visceralFatLevel": 0,
  "segmental": {
    "rightArmKg": 0, "leftArmKg": 0,
    "trunkKg": 0,
    "rightLegKg": 0, "leftLegKg": 0
  },
  "impedance": {
    "rightArm": 0, "leftArm": 0, "trunk": 0, "rightLeg": 0, "leftLeg": 0
  },
  "bodyType": "체형 진단 문구",
  "rawText": "이미지에서 읽은 모든 텍스트를 그대로 (디버깅용)"
}`;

serve(async (req) => {
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
    }
    try {
        const { imageBase64, mimeType } = await req.json();
        if (!imageBase64 || !mimeType) {
            return new Response(JSON.stringify({ error: "imageBase64 + mimeType required" }), { status: 400 });
        }

        // 1. Gemini Vision 호출
        // 🚨 핵심: gemini-2.5-flash 는 404 발생(신규 사용자 미제공). gemini-3.6-flash 사용 (ai.js 와 동일).
        const model = genAI.getGenerativeModel({
            model: "gemini-3.6-flash",
            generationConfig: { responseMimeType: "application/json" },
        });
        const result = await model.generateContent([
            { text: OCR_PROMPT },
            { inlineData: { mimeType, data: imageBase64 } },
        ]);
        const rawText = result.response.text();
        const cleanText = rawText.replace(/```json/gi, "").replace(/```/gi, "").trim();
        const parsed = JSON.parse(cleanText);

        // 🚨 설계: DB 저장은 프론트엔드가 anon 키로 직접 수행 (double-write 방지, 수동입력과 동일 코드 경로).
        return new Response(JSON.stringify({ success: true, data: parsed }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (e) {
        console.error("extract-inbody error:", e.message);
        return new Response(JSON.stringify({ success: false, error: e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
});
