import type { Env, Question, Settings } from "./types";
import { QUESTION_BANK } from "./bank";

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

  if (filtered.length === 0) {
    throw new Error("AI ei tagastanud ühtegi kasutatavat küsimust");
  }

  // AI-mudelid kipuvad õiget vastust järjekindlalt samale kohale (nt A) paigutama.
  // Segame variandid serveris juhuslikult, et see ei kordu.
  return filtered.map(shuffleOptions);
}

function shuffleOptions(q: Question): Question {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correctIndex: order.indexOf(q.correctIndex),
  };
}

async function callLibrary(env: Env, path: string, body: unknown): Promise<any> {
  const id = env.QUESTION_LIBRARY.idFromName("global");
  const stub = env.QUESTION_LIBRARY.get(id);
  const res = await stub.fetch(`https://internal${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Salvestab äsja AI genereeritud küsimused kasvavasse raamatukokku, et neid
// saaks hiljem taaskasutada (kui AI-tokenid otsas või host valib panga).
export async function addToLibrary(env: Env, settings: Settings, questions: Question[]): Promise<void> {
  try {
    await callLibrary(env, "/add", {
      questions: questions.map((q) => ({
        ...q,
        category: settings.category === "Segamini" ? "Segamini" : settings.category,
        difficulty: settings.difficulty,
      })),
    });
  } catch {
    // Parim katse - kui raamatukogu ebaõnnestub, mäng jätkub ikkagi ilma selleta.
  }
}

// Varu-küsimuste valik: kõigepealt kasvavast AI-raamatukogust, seejärel
// vajadusel täiendatakse staatilise algpangaga. Kasutatakse, kui AI
// genereerimine ebaõnnestub (nt tokenid otsas) või kui host valib
// küsimuste allikaks panga.
export async function drawFromBank(env: Env, settings: Settings): Promise<Question[]> {
  let libraryQuestions: Question[] = [];
  try {
    const data = await callLibrary(env, "/draw", {
      category: settings.category,
      difficulty: settings.difficulty,
      count: settings.count,
    });
    libraryQuestions = Array.isArray(data?.questions) ? data.questions : [];
  } catch {
    // Raamatukogu pole kättesaadav - kasuta ainult staatilist panka.
  }

  if (libraryQuestions.length >= settings.count) {
    return libraryQuestions.slice(0, settings.count).map(shuffleOptions);
  }

  const already = new Set(libraryQuestions.map((q) => q.question));
  const staticPicks = drawFromStaticBank(settings, settings.count - libraryQuestions.length, already);
  return [...libraryQuestions, ...staticPicks].map(shuffleOptions);
}

function drawFromStaticBank(settings: Settings, count: number, exclude: Set<string>): Question[] {
  const wantCategory = settings.category === "Segamini" ? null : settings.category;

  let pool = QUESTION_BANK.filter(
    (q) => q.dif === settings.difficulty && (wantCategory === null || q.cat === wantCategory) && !exclude.has(q.q)
  );
  if (pool.length < count) {
    pool = QUESTION_BANK.filter((q) => q.dif === settings.difficulty && !exclude.has(q.q));
  }
  if (pool.length < count) {
    pool = QUESTION_BANK.filter((q) => !exclude.has(q.q));
  }

  const shuffledPool = [...pool];
  for (let i = shuffledPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledPool[i], shuffledPool[j]] = [shuffledPool[j], shuffledPool[i]];
  }

  return shuffledPool.slice(0, count).map((bq) => ({
    question: bq.q,
    options: [...bq.o],
    correctIndex: bq.c,
    funFact: bq.f,
  }));
}
