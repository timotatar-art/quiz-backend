import type { RoomState, Env, WsAttachment } from "./types";
import { generateQuestions, drawFromBank, addToLibrary } from "./questions";

function randomId(len = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export class GameRoom {
  state: RoomState;
  env: Env;
  ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.state = {
      phase: "menu",
      settings: {
        difficulty: "keskmine",
        category: "Segamini",
        count: 10,
        answerSeconds: 12,
        questionSource: "ai",
        customTopic: "",
      },
      players: [],
      questions: [],
      currentIndex: -1,
      questionEndsAt: null,
      answers: {},
      hostToken: "",
      createdAt: Date.now(),
      askedQuestions: [],
    };
    // Taasta seisund pärast hibernatsiooni (DO objekt luuakse iga ärkamise järel uuesti).
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<RoomState>("state");
      if (saved) this.state = saved;
    });
  }

  private async persist() {
    await this.ctx.storage.put("state", this.state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/internal/create") {
      this.state.hostToken = randomId(16);
      this.state.createdAt = Date.now();
      await this.persist();
      return Response.json({ hostToken: this.state.hostToken });
    }

    if (url.pathname === "/internal/set-topic" && request.method === "POST") {
      const body = (await request.json()) as { topic?: string };
      const topic = (body.topic ?? "").toString().trim().slice(0, 150);
      if (topic) {
        this.state.settings.customTopic = topic;
        this.state.settings.questionSource = "custom";
        await this.persist();
        this.broadcastState();
      }
      return Response.json({ ok: Boolean(topic), topic });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(url);
    }

    return new Response("Not found", { status: 404 });
  }

  private handleWebSocketUpgrade(url: URL): Response {
    const role = url.searchParams.get("role");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (role === "tv") {
      const token = url.searchParams.get("token") ?? "";
      if (!this.state.hostToken || token !== this.state.hostToken) {
        server.close(4001, "Vale token");
        return new Response(null, { status: 101, webSocket: client });
      }
      this.ctx.acceptWebSocket(server, ["tv"]);
      server.serializeAttachment({ role: "tv" } satisfies WsAttachment);
    } else if (role === "player") {
      const name = (url.searchParams.get("name") ?? "Mängija").slice(0, 20);
      const playerToken = url.searchParams.get("playerToken") ?? randomId(16);
      this.ctx.acceptWebSocket(server, ["player"]);

      let player = this.state.players.find((p) => p.token === playerToken);
      if (player) {
        // Taasühendumine - sama mängija, säilita skoor.
        player.connected = true;
        player.name = name;
      } else {
        player = {
          id: randomId(10),
          token: playerToken,
          name,
          score: 0,
          connected: true,
          correctCount: 0,
          answeredCount: 0,
          correctTotalMs: 0,
        };
        this.state.players.push(player);
      }
      server.serializeAttachment({ role: "player", playerId: player.id, name: player.name } satisfies WsAttachment);
      this.ctx.waitUntil(this.persist());
    } else {
      server.close(4000, "Tundmatu roll");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.broadcastState();
    this.sendResumeIfNeeded(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Kui klient (TV või mängija) ühendub keset küsimust või tulemuste kuva,
  // saadab talle kohe hetkeseisu, mitte ei jäta teda tühja ekraani ette ootama järgmist sündmust.
  private sendResumeIfNeeded(ws: WebSocket) {
    if (this.state.phase === "question" && this.state.questionEndsAt) {
      const q = this.state.questions[this.state.currentIndex];
      if (q) {
        ws.send(
          JSON.stringify({
            type: "question_start",
            index: this.state.currentIndex,
            total: this.state.questions.length,
            question: q.question,
            options: q.options,
            endsAt: this.state.questionEndsAt,
          })
        );
      }
    } else if (this.state.phase === "reveal") {
      const q = this.state.questions[this.state.currentIndex];
      if (q) {
        ws.send(
          JSON.stringify({
            type: "question_end",
            correctIndex: q.correctIndex,
            funFact: q.funFact ?? null,
            scoreboard: this.scoreboard(),
          })
        );
      }
    }
  }

  private broadcast(payload: unknown, tag?: string) {
    const msg = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets(tag)) {
      try {
        ws.send(msg);
      } catch {
        // ühendus juba katkenud, koristub webSocketClose'is
      }
    }
  }

  private publicState() {
    return {
      phase: this.state.phase,
      settings: this.state.settings,
      players: this.state.players.map((p) => ({ id: p.id, name: p.name, score: p.score })),
      currentIndex: this.state.currentIndex,
      totalQuestions: this.state.questions.length,
      questionEndsAt: this.state.questionEndsAt,
    };
  }

  private broadcastState() {
    this.broadcast({ type: "room_state", state: this.publicState() });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string") return;
    let data: any;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    if (!attachment) return;

    switch (data.type) {
      case "update_settings": {
        if (attachment.role !== "tv") return;
        if (this.state.phase !== "menu") return;
        this.state.settings = {
          difficulty: data.difficulty ?? this.state.settings.difficulty,
          category: (data.category ?? this.state.settings.category).slice(0, 40),
          count: Math.min(20, Math.max(3, Number(data.count) || this.state.settings.count)),
          answerSeconds: Math.min(60, Math.max(5, Number(data.answerSeconds) || this.state.settings.answerSeconds)),
          questionSource:
            data.questionSource === "bank" ? "bank" : data.questionSource === "custom" ? "custom" : "ai",
          customTopic: this.state.settings.customTopic,
        };
        await this.persist();
        this.broadcastState();
        break;
      }

      case "enter_lobby": {
        if (attachment.role !== "tv") return;
        if (this.state.phase !== "menu") return;
        this.state.phase = "lobby";
        await this.persist();
        this.broadcastState();
        break;
      }

      case "start_game": {
        if (attachment.role !== "tv") return;
        if (this.state.phase !== "lobby") return;
        if (this.state.players.length === 0) {
          this.broadcast({ type: "error", message: "Vähemalt üks mängija peab olema liitunud." });
          return;
        }

        // "custom" režiimis kasutatakse kasutaja telefonis sisestatud teemat
        // kategooriana - AI genereerib selle põhjal, mitte fikseeritud rippmenüü järgi.
        const effectiveSettings =
          this.state.settings.questionSource === "custom" && this.state.settings.customTopic.trim()
            ? { ...this.state.settings, category: this.state.settings.customTopic.trim() }
            : this.state.settings;

        if (this.state.settings.questionSource === "bank") {
          this.state.questions = await drawFromBank(this.env, this.state.settings, this.state.askedQuestions);
        } else {
          this.broadcast({ type: "generating_questions" });
          try {
            this.state.questions = await generateQuestions(
              this.env.ANTHROPIC_API_KEY,
              effectiveSettings,
              this.state.askedQuestions.slice(-40)
            );
            // Täienda kasvavat küsimuste raamatukogu, et neid saaks tulevikus taaskasutada.
            this.ctx.waitUntil(addToLibrary(this.env, effectiveSettings, this.state.questions));
          } catch (err) {
            // AI genereerimine ebaõnnestus (nt tokenid otsas) - kasuta varupanka.
            this.state.questions = await drawFromBank(this.env, this.state.settings, this.state.askedQuestions);
          }
        }

        if (this.state.questions.length === 0) {
          this.broadcast({ type: "error", message: "Küsimusi ei õnnestunud hankida. Proovi uuesti." });
          return;
        }

        // Jäta need küsimused meelde, et sama ruum (sama TV-seanss) ei kordaks
        // neid enam ka järgmistel "Mängi uuesti" ringidel.
        this.state.askedQuestions.push(...this.state.questions.map((q) => q.question));
        if (this.state.askedQuestions.length > 300) {
          this.state.askedQuestions = this.state.askedQuestions.slice(this.state.askedQuestions.length - 300);
        }

        this.state.currentIndex = -1;
        await this.persist();
        await this.nextQuestion();
        break;
      }

      case "submit_answer": {
        if (attachment.role !== "player" || !attachment.playerId) return;
        if (this.state.phase !== "question") return;
        if (this.state.answers[attachment.playerId]) return;
        this.state.answers[attachment.playerId] = {
          choiceIndex: Number(data.choiceIndex),
          answeredAt: Date.now(),
        };
        await this.persist();

        if (Object.keys(this.state.answers).length >= this.state.players.length) {
          await this.endQuestion();
        }
        break;
      }

      case "next_question": {
        if (attachment.role !== "tv") return;
        if (this.state.phase !== "reveal") return;
        await this.nextQuestion();
        break;
      }

      case "restart": {
        if (attachment.role !== "tv") return;
        this.state.phase = "menu";
        this.state.questions = [];
        this.state.currentIndex = -1;
        this.state.answers = {};
        this.state.questionEndsAt = null;
        this.state.players = this.state.players.map((p) => ({
          ...p,
          score: 0,
          correctCount: 0,
          answeredCount: 0,
          correctTotalMs: 0,
        }));
        await this.persist();
        this.broadcastState();
        break;
      }
    }
  }

  private async nextQuestion() {
    this.state.currentIndex += 1;
    this.state.answers = {};

    if (this.state.currentIndex >= this.state.questions.length) {
      this.state.phase = "ended";
      this.state.questionEndsAt = null;
      await this.persist();
      this.broadcast({ type: "game_over", scoreboard: this.finalStats() });
      return;
    }

    this.state.phase = "question";
    this.state.questionEndsAt = Date.now() + this.state.settings.answerSeconds * 1000;
    await this.persist();
    await this.ctx.storage.setAlarm(this.state.questionEndsAt);

    const q = this.state.questions[this.state.currentIndex];
    this.broadcast({
      type: "question_start",
      index: this.state.currentIndex,
      total: this.state.questions.length,
      question: q.question,
      options: q.options,
      endsAt: this.state.questionEndsAt,
    });
  }

  private async endQuestion() {
    if (this.state.phase !== "question") return;
    const q = this.state.questions[this.state.currentIndex];
    if (!q) return;

    const totalMs = this.state.settings.answerSeconds * 1000;
    const windowStart = (this.state.questionEndsAt ?? Date.now()) - totalMs;
    for (const player of this.state.players) {
      const answer = this.state.answers[player.id];
      if (!answer) continue;
      player.answeredCount += 1;
      if (answer.choiceIndex === q.correctIndex) {
        const elapsed = Math.max(0, answer.answeredAt - windowStart);
        const speedBonus = Math.max(0, Math.round(500 * (1 - elapsed / totalMs)));
        player.score += 500 + speedBonus;
        player.correctCount += 1;
        player.correctTotalMs += elapsed;
      }
    }

    this.state.phase = "reveal";
    this.state.questionEndsAt = null;
    await this.persist();
    // Automaatne edasiliikumine 3 sekundi pärast, ilma et host peaks nuppu vajutama.
    await this.ctx.storage.setAlarm(Date.now() + 3000);

    this.broadcast({
      type: "question_end",
      correctIndex: q.correctIndex,
      funFact: q.funFact ?? null,
      scoreboard: this.scoreboard(),
    });
  }

  private scoreboard() {
    return [...this.state.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ name: p.name, score: p.score }));
  }

  // Detailsem lõpp-statistika, mida näidatakse ainult "Mäng läbi" ekraanil:
  // õigete vastuste osakaal ja keskmine vastamiskiirus (ainult õigete vastuste seas).
  private finalStats() {
    const totalQuestions = this.state.questions.length;
    return [...this.state.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({
        name: p.name,
        score: p.score,
        correctCount: p.correctCount,
        totalQuestions,
        avgCorrectMs: p.correctCount > 0 ? Math.round(p.correctTotalMs / p.correctCount) : null,
      }));
  }

  async alarm() {
    if (this.state.phase === "question") {
      await this.endQuestion();
    } else if (this.state.phase === "reveal") {
      await this.nextQuestion();
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    if (attachment?.role === "player" && attachment.playerId) {
      const player = this.state.players.find((p) => p.id === attachment.playerId);
      if (player) player.connected = false;
      await this.persist();
      this.broadcastState();
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}
