import type { Question, Settings } from "./types";

interface StoredQuestion extends Question {
  category: string;
  difficulty: "lihtne" | "keskmine" | "raske";
}

const MAX_STORED = 5000;

// Üks globaalne instants (idFromName("global")) kogub kokku kõik AI poolt varem
// genereeritud küsimused, et neid saaks hiljem taaskasutada, kui AI-tokenid
// otsas on või host valib küsimuste allikaks panga. Nii kasvab pank iseenesest
// iga mängitud AI-põhise mängu järel.
export class QuestionLibrary {
  ctx: DurableObjectState;
  questions: StoredQuestion[] = [];

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<StoredQuestion[]>("questions");
      if (saved) this.questions = saved;
    });
  }

  private async persist() {
    await this.ctx.storage.put("questions", this.questions);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/add") {
      const body = (await request.json()) as { questions: StoredQuestion[] };
      const existing = new Set(this.questions.map((q) => q.question));
      let added = 0;
      for (const q of body.questions ?? []) {
        if (q?.question && !existing.has(q.question)) {
          this.questions.push(q);
          existing.add(q.question);
          added++;
        }
      }
      if (this.questions.length > MAX_STORED) {
        this.questions = this.questions.slice(this.questions.length - MAX_STORED);
      }
      await this.persist();
      return Response.json({ added, total: this.questions.length });
    }

    if (request.method === "POST" && url.pathname === "/draw") {
      const body = (await request.json()) as { category: string; difficulty: Settings["difficulty"]; count: number };
      const wantCategory = body.category === "Segamini" ? null : body.category;
      const pool = this.questions.filter(
        (q) => q.difficulty === body.difficulty && (wantCategory === null || q.category === wantCategory)
      );
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return Response.json({ questions: shuffled.slice(0, Math.max(0, body.count)) });
    }

    return new Response("Not found", { status: 404 });
  }
}
