# TV Kviis backend

Cloudflare Worker + Durable Objects põhine reaalajaline mänguserver TV Kviisi jaoks.

## Arhitektuur

- **Worker** (`src/index.ts`) — marsruutimine: `/tv` loob uue mänguruumi ja kuvab TV lehe, `/play/:kood` kuvab mängija liitumislehe, `/ws` suunab WebSocket-ühendused õigesse ruumi.
- **`GameRoom` Durable Object** (`src/gameRoom.ts`) — üks instants ruumi kohta. Hoiab mängu seisundit (mängijad, küsimused, skoor, faas), WebSocket Hibernation API kaudu, nii et ruum ei kaota olekut ka siis, kui Cloudflare selle ajutiselt "magama" paneb.
- **AI küsimused** (`src/questions.ts`) — kutsub Anthropic API-t, genereerib terve küsimuste komplekti mängu alguses.
- **Lehed** (`src/pages.ts`) — TV ekraani ja mängija telefoni HTML/JS, samas tumedas stiilis nagu quiz.lu.vu.

## Kasutuselevõtt

1. `npm install`
2. Sea AI võti saladusena: `npx wrangler secret put ANTHROPIC_API_KEY`
3. `npx wrangler deploy` (või ühenda see repo Cloudflare Workers Builds'iga automaatseks deploy'ks igal pushil)

Pärast deploy't on rakendus saadaval aadressil `https://tvkviis-backend.<sinu-alamdomeen>.workers.dev`. TV rakenduse (`tvkviis` repo, `MainActivity.kt`) `tvDisplayUrl` peab osutama `<see-aadress>/tv`.

## Mänguloogika lühidalt

- Iga küsimuse vastamisaeg: 10 sekundit, jõustatud serveris (Durable Object alarm), mitte ainult kliendis.
- Skoor: 500 punkti õige vastuse eest + kiirusboonus (kuni 500 lisapunkti, mida kiirem, seda rohkem).
- Faasid: `setup` (sätete valik ja ootesaal) → `question` → `reveal` (õige vastus + pingerida) → tagasi `question` või `ended`.
