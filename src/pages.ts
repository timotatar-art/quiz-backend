const BASE_STYLE = `
  :root {
    --bg: #12141c;
    --bg-raised: #191c26;
    --amber: #f0a527;
    --text: #ededE5;
    --text-muted: #9c9c96;
    --border: #2a2d3a;
    --green: #3ddc84;
    --red: #e2453c;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: var(--bg); color: var(--text);
    font-family: 'Inter', system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3 { font-family: 'Space Grotesk', sans-serif; font-weight: 700; margin: 0; }
  button {
    font-family: inherit; cursor: pointer; border: none; border-radius: 10px;
    background: var(--amber); color: #241a05; font-weight: 600;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  input, select {
    font-family: inherit; background: var(--bg-raised); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;
  }
`;

function shell(title: string, body: string, extraStyle = ""): string {
  return `<!DOCTYPE html>
<html lang="et">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${BASE_STYLE}${extraStyle}</style>
</head>
<body>${body}</body>
</html>`;
}

export function renderTvPage(roomCode: string, hostToken: string, origin: string): string {
  const playUrl = `${origin}/play/${roomCode}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=10&data=${encodeURIComponent(playUrl)}`;

  const style = `
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 32px; }
    #app { width: 100%; max-width: 900px; text-align: center; }
    .roomcode { font-size: 20px; color: var(--text-muted); }
    .roomcode b { color: var(--amber); font-size: 32px; letter-spacing: 4px; }
    .qr { margin: 24px auto; border-radius: 16px; overflow: hidden; width: 240px; }
    .qr img { display: block; width: 100%; }
    .players { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 24px 0; }
    .chip { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 999px; padding: 8px 16px; font-size: 15px; }
    .settings { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin: 24px 0; }
    .settings label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-muted); }
    #startBtn { font-size: 18px; padding: 16px 40px; margin-top: 16px; }
    .question h2 { font-size: 40px; margin-bottom: 24px; }
    .options { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .opt { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 14px; padding: 24px; font-size: 22px; }
    .opt.correct { background: var(--green); color: #052912; border-color: var(--green); }
    .timer { font-size: 60px; color: var(--amber); font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
    .scoreboard { list-style: none; padding: 0; max-width: 400px; margin: 24px auto; text-align: left; }
    .scoreboard li { display: flex; justify-content: space-between; padding: 10px 16px; background: var(--bg-raised); border-radius: 10px; margin-bottom: 8px; }
    .funfact { color: var(--text-muted); margin-top: 16px; font-size: 16px; }
  `;

  const body = `
  <div id="app">
    <p class="eyebrow" style="color:var(--amber)">TV Kviis</p>
    <div id="content">Ühendamine...</div>
  </div>
  <script>
    const roomCode = ${JSON.stringify(roomCode)};
    const hostToken = ${JSON.stringify(hostToken)};
    const playUrl = ${JSON.stringify(playUrl)};
    const qrUrl = ${JSON.stringify(qrUrl)};
    const content = document.getElementById('content');
    let currentState = null;
    let timerInterval = null;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws?room=' + roomCode + '&role=tv&token=' + hostToken);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'room_state') { currentState = msg.state; renderSetupOrLobby(); }
      else if (msg.type === 'generating_questions') { content.innerHTML = '<h2>Genereerin küsimusi...</h2>'; }
      else if (msg.type === 'question_start') renderQuestion(msg);
      else if (msg.type === 'question_end') renderReveal(msg);
      else if (msg.type === 'game_over') renderGameOver(msg);
      else if (msg.type === 'error') alert(msg.message);
    };

    function renderSetupOrLobby() {
      if (!currentState) return;
      if (currentState.phase !== 'setup') return;
      const s = currentState.settings;
      content.innerHTML = \`
        <div class="roomcode">Liitu aadressil <b>\${location.host}</b><br>Ruumikood: <b>\${roomCode}</b></div>
        <div class="qr"><img src="\${qrUrl}" alt="QR"></div>
        <div class="players">\${currentState.players.length === 0 ? '<span style="color:var(--text-muted)">Ootan mängijaid...</span>' : currentState.players.map(p => '<span class="chip">' + p.name + '</span>').join('')}</div>
        <div class="settings">
          <label>Raskus
            <select id="difficulty">
              <option value="lihtne">Lihtne</option>
              <option value="keskmine" selected>Keskmine</option>
              <option value="raske">Raske</option>
            </select>
          </label>
          <label>Kategooria
            <input id="category" value="\${s.category}">
          </label>
          <label>Küsimuste arv
            <input id="count" type="number" min="3" max="20" value="\${s.count}">
          </label>
        </div>
        <button id="startBtn" \${currentState.players.length === 0 ? 'disabled' : ''}>Alusta mängu</button>
      \`;
      document.getElementById('difficulty').value = s.difficulty;
      document.getElementById('difficulty').onchange = sendSettings;
      document.getElementById('category').onchange = sendSettings;
      document.getElementById('count').onchange = sendSettings;
      document.getElementById('startBtn').onclick = () => ws.send(JSON.stringify({ type: 'start_game' }));
    }

    function sendSettings() {
      ws.send(JSON.stringify({
        type: 'update_settings',
        difficulty: document.getElementById('difficulty').value,
        category: document.getElementById('category').value,
        count: document.getElementById('count').value,
      }));
    }

    function renderQuestion(msg) {
      clearInterval(timerInterval);
      content.innerHTML = \`
        <div class="question">
          <div class="timer" id="timer">10</div>
          <h2>\${msg.question}</h2>
          <div class="options">\${msg.options.map((o, i) => '<div class="opt">' + String.fromCharCode(65 + i) + '. ' + o + '</div>').join('')}</div>
          <p style="color:var(--text-muted); margin-top:16px;">Küsimus \${msg.index + 1} / \${msg.total} — vasta oma telefonis</p>
        </div>
      \`;
      const timerEl = document.getElementById('timer');
      timerInterval = setInterval(() => {
        const left = Math.max(0, Math.round((msg.endsAt - Date.now()) / 1000));
        timerEl.textContent = left;
        if (left <= 0) clearInterval(timerInterval);
      }, 250);
    }

    function renderReveal(msg) {
      clearInterval(timerInterval);
      content.innerHTML = \`
        <div class="question">
          <h2>Õige vastus: \${String.fromCharCode(65 + msg.correctIndex)}</h2>
          \${msg.funFact ? '<p class="funfact">' + msg.funFact + '</p>' : ''}
          <ol class="scoreboard">\${msg.scoreboard.slice(0,8).map(p => '<li><span>' + p.name + '</span><span>' + p.score + '</span></li>').join('')}</ol>
          <button id="nextBtn">Järgmine küsimus</button>
        </div>
      \`;
      document.getElementById('nextBtn').onclick = () => ws.send(JSON.stringify({ type: 'next_question' }));
    }

    function renderGameOver(msg) {
      clearInterval(timerInterval);
      content.innerHTML = \`
        <h2>Mäng läbi! 🏆</h2>
        <ol class="scoreboard">\${msg.scoreboard.map(p => '<li><span>' + p.name + '</span><span>' + p.score + '</span></li>').join('')}</ol>
        <button id="restartBtn">Mängi uuesti</button>
      \`;
      document.getElementById('restartBtn').onclick = () => ws.send(JSON.stringify({ type: 'restart' }));
    }
  </script>
  `;

  return shell("TV Kviis", body, style);
}

export function renderPlayerPage(roomCode: string, origin: string): string {
  const style = `
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    #app { width: 100%; max-width: 420px; text-align: center; }
    input { width: 100%; font-size: 18px; padding: 14px; text-align: center; margin-bottom: 12px; }
    #joinBtn { width: 100%; font-size: 18px; padding: 14px; }
    .opt-btn { width: 100%; font-size: 18px; padding: 20px; margin-bottom: 12px; text-align: left; background: var(--bg-raised); color: var(--text); border: 1px solid var(--border); }
    .opt-btn.selected { background: var(--amber); color: #241a05; }
    .opt-btn.correct { background: var(--green); color: #052912; }
    .opt-btn.wrong { background: var(--red); color: #fff; }
    .score { font-size: 40px; color: var(--amber); font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
  `;

  const body = `
  <div id="app">
    <p style="color:var(--amber)">TV Kviis · ${roomCode}</p>
    <div id="content">
      <input id="nameInput" placeholder="Sinu nimi" maxlength="20">
      <button id="joinBtn">Liitu mänguga</button>
    </div>
  </div>
  <script>
    const roomCode = ${JSON.stringify(roomCode)};
    const content = document.getElementById('content');
    let ws = null;
    let answered = false;

    document.getElementById('joinBtn').onclick = () => {
      const name = document.getElementById('nameInput').value.trim() || 'Mängija';
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/ws?room=' + roomCode + '&role=player&name=' + encodeURIComponent(name));
      ws.onopen = () => { content.innerHTML = '<p>Liitusid! Oota, kuni mäng algab...</p>'; };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'question_start') renderQuestion(msg);
        else if (msg.type === 'question_end') renderResult(msg);
        else if (msg.type === 'game_over') renderGameOver(msg);
        else if (msg.type === 'error') alert(msg.message);
      };
      ws.onclose = () => { content.innerHTML = '<p>Ühendus katkes. Värskenda lehte.</p>'; };
    };

    function renderQuestion(msg) {
      answered = false;
      content.innerHTML = '<h3>' + msg.question + '</h3>' +
        msg.options.map((o, i) => '<button class="opt-btn" data-i="' + i + '">' + String.fromCharCode(65 + i) + '. ' + o + '</button>').join('');
      document.querySelectorAll('.opt-btn').forEach(btn => {
        btn.onclick = () => {
          if (answered) return;
          answered = true;
          const i = Number(btn.dataset.i);
          document.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          ws.send(JSON.stringify({ type: 'submit_answer', choiceIndex: i }));
        };
      });
    }

    function renderResult(msg) {
      const mine = document.querySelector('.opt-btn.selected');
      document.querySelectorAll('.opt-btn').forEach((b, i) => {
        if (i === msg.correctIndex) b.classList.add('correct');
        else if (b.classList.contains('selected')) b.classList.add('wrong');
      });
      setTimeout(() => {
        content.innerHTML = '<p>Oota järgmist küsimust...</p>';
      }, 2500);
    }

    function renderGameOver(msg) {
      content.innerHTML = '<h2>Mäng läbi!</h2><p>Vaata lõpptulemust suurelt ekraanilt 🏆</p>';
    }
  </script>
  `;

  return shell("Liitu kviisiga", body, style);
}

export function renderHomePage(): string {
  return shell(
    "TV Kviis backend",
    `<div style="padding:40px; text-align:center;">
      <h1>TV Kviis backend töötab</h1>
      <p style="color:var(--text-muted)">See on API/WebSocket server. TV rakendus peaks avama <code>/tv</code>.</p>
    </div>`
  );
}
