import type { Env } from "./types";
import { GameRoom } from "./gameRoom";
import { QuestionLibrary } from "./questionLibrary";
import { renderTvPage, renderPlayerPage, renderTopicPage, renderHomePage } from "./pages";
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

    // Rakendus küsib siit, kas on olemas uuem versioon kui hetkel paigaldatud.
    // Ehitusnumber (tag "build-N") vastab otse Android versionCode'ile.
    if (url.pathname === "/app-version") {
      try {
        const ghRes = await fetch("https://api.github.com/repos/timotatar-art/tvkviis/releases/latest", {
          headers: { "user-agent": "luvu-game-version-check", accept: "application/vnd.github+json" },
        });
        if (!ghRes.ok) throw new Error(`GitHub API ${ghRes.status}`);
        const release = (await ghRes.json()) as {
          tag_name?: string;
          assets?: { name: string; browser_download_url: string }[];
        };
        const match = /^build-(\d+)$/.exec(release.tag_name ?? "");
        const versionCode = match ? parseInt(match[1], 10) : 0;
        const asset = (release.assets ?? []).find((a) => a.name === "app-debug.apk");
        return Response.json(
          { versionCode, url: asset?.browser_download_url ?? null },
          { headers: { "cache-control": "public, max-age=300" } }
        );
      } catch {
        return Response.json({ versionCode: 0, url: null }, { status: 502 });
      }
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

    // Kasutaja oma teema valimise leht (telefonis, QR kaudu menüüst): /topic/ABCD
    const topicMatch = url.pathname.match(/^\/topic\/([A-Z0-9]{3,8})$/i);
    if (topicMatch) {
      const roomCode = topicMatch[1].toUpperCase();
      return new Response(renderTopicPage(roomCode, url.origin), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // Salvestab telefonis sisestatud teema vastavasse mänguruumi ja teavitab TV-d.
    const apiTopicMatch = url.pathname.match(/^\/api\/topic\/([A-Z0-9]{3,8})$/i);
    if (apiTopicMatch && request.method === "POST") {
      const roomCode = apiTopicMatch[1].toUpperCase();
      const id = env.GAME_ROOM.idFromName(roomCode);
      const stub = env.GAME_ROOM.get(id);
      const bodyText = await request.text();
      return stub.fetch(
        new Request("https://internal/internal/set-topic", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: bodyText,
        })
      );
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
