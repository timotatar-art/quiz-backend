import type { Question, Settings } from "./types";

export async function generateQuestions(
  apiKey: string,
  settings: Settings,
  previousQuestions: string[] = []
): Promise<Question[]> {
  const prompt = `Sa oled meelelahutusliku mälumängu küsimuste generaator.

Loo ${settings.count} unikaalset valikvastustega küsimust.
Kategooria: ${settings.category}
Raskusaste: ${settings.difficulty}

Nõuded igale küsimusele:
- faktiliselt kontrollitav ja õige
- meelelahutuslik, sobib laiale ja peresõbralikule publikule
- 4 vastusevarianti, ainult üks õige, ülejäänud 3 usutavad, aga selgelt valed
- vastuste pikkus sarnane (et õige vastus ei paistaks pikkuse järgi silma)
${previousQuestions.length > 0 ? `- ei tohi kattuda nende varasemate küsimustega: ${previousQuestions.join("; ")}` : ""}

Väljasta AINULT JSON massiivina, ilma lisatekstita, backtickideta ja seletusteta:
[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"funFact":"üks lause lisainfoks pärast vastamist"}]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`AI päring ebaõnnestus: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const textBlock = data.content.find((b) => b.type === "text");
  if (!textBlock?.text) throw new Error("AI vastus oli tühi");

  const cleaned = textBlock.text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "");

  const parsed = JSON.parse(cleaned) as Question[];

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AI vastus polnud korrektne küsimuste massiiv");
  }

  const filtered = parsed.filter(
    (q) =>
      typeof q.question === "string" &&
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      typeof q.correctIndex === "number" &&
      q.correctIndex >= 0 &&
      q.correctIndex < 4
  );

  // AI-mudelid kipuvad õiget vastust järjekindlalt samale kohale (nt A) paigutama.
  // Segame variandid serveris juhuslikult, et see ei kordu.
  return filtered.map((q) => {
    const correctText = q.options[q.correctIndex];
    const shuffled = [...q.options];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return { ...q, options: shuffled, correctIndex: shuffled.indexOf(correctText) };
  });
}
