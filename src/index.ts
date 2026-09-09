import type { Env } from "./types";
import { GameRoom } from "./gameRoom";
import { QuestionLibrary } from "./questionLibrary";
import { renderTvPage, renderPlayerPage, renderHomePage } from "./pages";
import { LOGO_PNG_BASE64 } from "./logo";

export { GameRoom, QuestionLibrary };

const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ilma O,0,I,1 - vähem segadust ekraanilt lugedes

function generateRoomCode(len = 4): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // LuVu game logo, kasutatakse TV ja mängija lehtedel.
    if (url.pathname === "/logo.png") {
      const bytes = Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
      });
    }

    // Uue TV-seansi loomine: genereeri ruumikood, algata Durable Object, kuva TV leht.
    if (url.pathname === "/tv") {
      const roomCode = generateRoomCode();
      const id = env.GAME_ROOM.idFromName(roomCode);
      const stub = env.GAME_ROOM.get(id);
      const createRes = await stub.fetch(new Request("https://internal/internal/create", { method: "POST" }));
      const { hostToken } = (await createRes.json()) as { hostToken: string };
      return new Response(renderTvPage(roomCode, hostToken, url.origin), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Mängija liitumisleht: /play/ABCD
    const playMatch = url.pathname.match(/^\/play\/([A-Z0-9]{3,8})$/i);
    if (playMatch) {
      const roomCode = playMatch[1].toUpperCase();
      return new Response(renderPlayerPage(roomCode, url.origin), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // WebSocket ühendused (nii TV kui mängijad) suunatakse õigesse Durable Objecti.
    if (url.pathname === "/ws") {
      const room = url.searchParams.get("room");
      if (!room) return new Response("Puudub room parameeter", { status: 400 });
      const id = env.GAME_ROOM.idFromName(room.toUpperCase());
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === "/") {
      return new Response(renderHomePage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("Not found", { status: 404 });
  },
};
