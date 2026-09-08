import type { RoomState, Env, WsAttachment } from "./types";
import { generateQuestions } from "./questions";

const QUESTION_SECONDS = 10;

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
      phase: "setup",
      settings: { difficulty: "keskmine", category: "Segamini", count: 10 },
      players: [],
      questions: [],
      currentIndex: -1,
      questionEndsAt: null,
      answers: {},
      hostToken: "",
      createdAt: Date.now(),
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
        player = { id: randomId(10), token: playerToken, name, score: 0, connected: true };
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
        if (this.state.phase !== "setup") return;
        this.state.settings = {
          difficulty: data.difficulty ?? this.state.settings.difficulty,
          category: (data.category ?? this.state.settings.category).slice(0, 40),
          count: Math.min(20, Math.max(3, Number(data.count) || this.state.settings.count)),
        };
        await this.persist();
        this.broadcastState();
        break;
      }

      case "start_game": {
        if (attachment.role !== "tv") return;
        if (this.state.phase !== "setup") return;
        if (this.state.players.length === 0) {
          this.broadcast({ type: "error", message: "Vähemalt üks mängija peab olema liitunud." });
          return;
        }

        this.broadcast({ type: "generating_questions" });
        try {
          this.state.questions = await generateQuestions(this.env.ANTHROPIC_API_KEY, this.state.settings);
          if (this.state.questions.length === 0) throw new Error("empty");
        } catch (err) {
          this.broadcast({ type: "error", message: "Küsimuste genereerimine ebaõnnestus. Proovi uuesti." });
          return;
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
        this.state.phase = "setup";
        this.state.questions = [];
        this.state.currentIndex = -1;
        this.state.answers = {};
        this.state.questionEndsAt = null;
        this.state.players = this.state.players.map((p) => ({ ...p, score: 0 }));
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
      this.broadcast({ type: "game_over", scoreboard: this.scoreboard() });
      return;
    }

    this.state.phase = "question";
    this.state.questionEndsAt = Date.now() + QUESTION_SECONDS * 1000;
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

    const windowStart = (this.state.questionEndsAt ?? Date.now()) - QUESTION_SECONDS * 1000;
    for (const player of this.state.players) {
      const answer = this.state.answers[player.id];
      if (answer && answer.choiceIndex === q.correctIndex) {
        const elapsed = Math.max(0, answer.answeredAt - windowStart);
        const speedBonus = Math.max(0, Math.round(500 * (1 - elapsed / (QUESTION_SECONDS * 1000))));
        player.score += 500 + speedBonus;
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
