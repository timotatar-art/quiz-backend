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
    --blue: #3d7fe2;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; color: var(--text);
    background: radial-gradient(circle at 50% 0%, #1c2030 0%, #101219 65%);
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
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    #app { width: 100%; max-width: 960px; text-align: center; }
    .roomcode { font-size: 18px; color: var(--text-muted); }
    .roomcode b { color: var(--amber); font-size: 28px; letter-spacing: 4px; }
    .lobby-card { display: inline-flex; align-items: center; gap: 28px; background: var(--bg-raised); border: 1px solid var(--border); border-radius: 18px; padding: 28px 36px; text-align: left; margin: 16px auto; }
    .lobby-left { flex: none; }
    .lobby-right { flex: none; width: 260px; }
    .qr { border-radius: 12px; overflow: hidden; width: 170px; box-shadow: 0 8px 30px rgba(240,165,39,0.15); }
    .qr img { display: block; width: 100%; }
    .players { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
    .chip { background: var(--bg-raised); border: 1px solid var(--border); border-radius: 999px; padding: 6px 14px; font-size: 14px; }
    .lobby-summary { color: var(--text-muted); margin: 0 0 16px; font-size: 15px; line-height: 1.5; }
    .settings { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin: 24px 0; }
    .settings label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-muted); }
    #startBtn { font-size: 18px; padding: 16px 40px; width: 100%; }
    .question h2 { font-size: 40px; margin-bottom: 24px; }
    .options { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .opt { border: none; border-radius: 14px; padding: 24px; font-size: 22px; color: #fff; text-align: left; font-weight: 600; position: relative; opacity: 0.55; transition: opacity 0.2s ease; }
    .opt.correct { opacity: 1; box-shadow: 0 0 0 4px #fff inset; }
    .opt-a { background: var(--red); }
    .opt-b { background: var(--blue); }
    .opt-c { background: var(--amber); color: #241a05; }
    .opt-d { background: var(--green); color: #052912; }
    .timer { font-size: 60px; color: var(--amber); font-family: 'Space Grotesk', sans-serif; font-weight: 700; }
    .scoreboard { list-style: none; padding: 0; max-width: 400px; margin: 24px auto; text-align: left; }
    .scoreboard li { display: flex; justify-content: space-between; padding: 10px 16px; background: var(--bg-raised); border-radius: 10px; margin-bottom: 8px; }
    .funfact { color: var(--text-muted); margin-top: 16px; font-size: 16px; }
  `;

  const body = `
  <div id="app">
    <p class="eyebrow" style="color:var(--amber); display:flex; align-items:center; justify-content:center; gap:10px;"><img src="/logo.png" alt="" style="height:36px; width:36px; border-radius:8px;">LuVu game</p>
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
    let lastTickSecond = null;
    let lastQuestionMsg = null;
    let ws = null;
    let reconnectAttempts = 0;

    // Kogu heli on genereeritud Web Audio API-ga (ostsillaatorid) - ei vaja
    // ühtegi välist audiofaili ega autoriõiguslikku muusikat.
    let audioCtx = null;
    let bgGain = null;
    let melodyTimer = null;
    let melodyStep = 0;
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
    const melodyPattern = [0, 2, 4, 3, 5, 4, 2, 1, 0, 2, 4, 6, 4, 3, 2, 0];

    function initAudio() {
      if (audioCtx) return;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    function playNote(freq, duration, gainNode) {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(g);
      g.connect(gainNode);
      const t = audioCtx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.start(t);
      osc.stop(t + duration + 0.05);
    }

    function startBackgroundMusic() {
      if (!audioCtx) return;
      stopBackgroundMusic();
      bgGain = audioCtx.createGain();
      bgGain.gain.value = 0.1;
      bgGain.connect(audioCtx.destination);
      melodyStep = 0;
      const noteLength = 0.26;
      melodyTimer = setInterval(() => {
        const idx = melodyPattern[melodyStep % melodyPattern.length];
        playNote(scale[idx], noteLength * 0.85, bgGain);
        melodyStep++;
      }, noteLength * 1000);
    }

    function stopBackgroundMusic() {
      if (melodyTimer) { clearInterval(melodyTimer); melodyTimer = null; }
      if (bgGain) { try { bgGain.disconnect(); } catch (e) {} bgGain = null; }
    }

    function playTick(urgent) {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = urgent ? 880 : 660;
      g.gain.value = 0.09;
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start();
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.stop(audioCtx.currentTime + 0.09);
    }

    function playReveal() {
      if (!audioCtx) return;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = audioCtx.currentTime + i * 0.12;
        osc.connect(g);
        g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.start(t);
        osc.stop(t + 0.32);
      });
    }

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/ws?room=' + roomCode + '&role=tv&token=' + hostToken);

      ws.onopen = () => { reconnectAttempts = 0; };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'room_state') { currentState = msg.state; renderForPhase(); }
        else if (msg.type === 'generating_questions') { content.innerHTML = '<h2>✨ Genereerin küsimusi...</h2>'; }
        else if (msg.type === 'question_start') renderQuestion(msg);
        else if (msg.type === 'question_end') renderReveal(msg);
        else if (msg.type === 'game_over') renderGameOver(msg);
        else if (msg.type === 'error') alert(msg.message);
      };

      ws.onclose = () => {
        if (reconnectAttempts < 20) {
          reconnectAttempts++;
          setTimeout(connect, Math.min(1000 * reconnectAttempts, 5000));
        }
      };
    }
    connect();

    function renderForPhase() {
      if (!currentState) return;
      if (currentState.phase === 'menu') renderMenu();
      else if (currentState.phase === 'lobby') renderLobby();
    }

    function renderMenu() {
      const s = currentState.settings;
      content.innerHTML = \`
        <h2 style="margin-bottom:24px;">⚙️ Mängu seaded</h2>
        <div class="settings">
          <label>Raskus
            <select id="difficulty">
              <option value="lihtne">Lihtne</option>
              <option value="keskmine">Keskmine</option>
              <option value="raske">Raske</option>
            </select>
          </label>
          <label>Kategooria
            <select id="category">
              <option value="Segamini">Segamini</option>
              <option value="Sport">Sport</option>
              <option value="Ajalugu">Ajalugu</option>
              <option value="Geograafia">Geograafia</option>
              <option value="Teadus">Teadus</option>
              <option value="Filmid ja muusika">Filmid ja muusika</option>
              <option value="Eesti">Eesti</option>
              <option value="Loomad ja loodus">Loomad ja loodus</option>
            </select>
          </label>
          <label>Küsimuste arv
            <select id="count">
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="15">15</option>
              <option value="20">20</option>
            </select>
          </label>
          <label>Vastamisaeg (sek)
            <select id="answerSeconds">
              <option value="8">8</option>
              <option value="10">10</option>
              <option value="12">12</option>
              <option value="15">15</option>
              <option value="20">20</option>
              <option value="30">30</option>
            </select>
          </label>
          <label>Küsimuste allikas
            <select id="questionSource">
              <option value="ai">AI genereerib elavalt</option>
              <option value="bank">Valmis küsimuste pank</option>
            </select>
          </label>
        </div>
        <button id="lobbyBtn" style="font-size:18px; padding:16px 40px; margin-top:16px;">Edasi ootesaali →</button>
      \`;
      document.getElementById('difficulty').value = s.difficulty;
      document.getElementById('difficulty').onchange = sendSettings;
      document.getElementById('category').value = s.category;
      document.getElementById('category').onchange = sendSettings;
      document.getElementById('count').value = s.count;
      document.getElementById('count').onchange = sendSettings;
      document.getElementById('answerSeconds').value = s.answerSeconds;
      document.getElementById('answerSeconds').onchange = sendSettings;
      document.getElementById('questionSource').value = s.questionSource;
      document.getElementById('questionSource').onchange = sendSettings;
      document.getElementById('lobbyBtn').onclick = () => ws.send(JSON.stringify({ type: 'enter_lobby' }));
    }

    function renderLobby() {
      const s = currentState.settings;
      content.innerHTML = \`
        <div class="lobby-card">
          <div class="lobby-left">
            <div class="roomcode">Liitu aadressil <b>\${location.host}</b><br>Ruumikood: <b>\${roomCode}</b></div>
            <div class="qr" style="margin-top:10px;"><img src="\${qrUrl}" alt="QR"></div>
          </div>
          <div class="lobby-right">
            <div class="players">\${currentState.players.length === 0 ? '<span style="color:var(--text-muted)">Ootan mängijaid...</span>' : currentState.players.map(p => '<span class="chip">👤 ' + p.name + '</span>').join('')}</div>
            <p class="lobby-summary">\${s.difficulty} · \${s.category} · \${s.count} küsimust · \${s.answerSeconds}s vastamiseks · \${s.questionSource === 'bank' ? 'küsimuste pank' : 'AI genereerib'}</p>
            <button id="startBtn" \${currentState.players.length === 0 ? 'disabled' : ''}>🚀 Alusta mängu</button>
          </div>
        </div>
      \`;
      document.getElementById('startBtn').onclick = () => {
        initAudio();
        startBackgroundMusic();
        ws.send(JSON.stringify({ type: 'start_game' }));
      };
    }

    function sendSettings() {
      ws.send(JSON.stringify({
        type: 'update_settings',
        difficulty: document.getElementById('difficulty').value,
        category: document.getElementById('category').value,
        count: document.getElementById('count').value,
        answerSeconds: document.getElementById('answerSeconds').value,
        questionSource: document.getElementById('questionSource').value,
      }));
    }

    const optClasses = ['opt-a', 'opt-b', 'opt-c', 'opt-d'];

    function renderQuestion(msg) {
      clearInterval(timerInterval);
      lastQuestionMsg = msg;
      const initialLeft = Math.max(0, Math.round((msg.endsAt - Date.now()) / 1000));
      content.innerHTML = \`
        <div class="question">
          <div class="timer">⏱ <span id="timer">\${initialLeft}</span></div>
          <h2>\${msg.question}</h2>
          <div class="options">\${msg.options.map((o, i) => '<div class="opt ' + optClasses[i] + ' correct">' + String.fromCharCode(65 + i) + '. ' + o + '</div>').join('')}</div>
          <p style="color:var(--text-muted); margin-top:16px;">Küsimus \${msg.index + 1} / \${msg.total} — vasta oma telefonis</p>
        </div>
      \`;
      const timerEl = document.getElementById('timer');
      lastTickSecond = null;
      timerInterval = setInterval(() => {
        const left = Math.max(0, Math.round((msg.endsAt - Date.now()) / 1000));
        timerEl.textContent = left;
        if (left !== lastTickSecond) {
          lastTickSecond = left;
          if (left > 0) playTick(left <= 3);
        }
        if (left <= 0) clearInterval(timerInterval);
      }, 100);
    }

    function renderReveal(msg) {
      clearInterval(timerInterval);
      playReveal();
      const optionsHtml = lastQuestionMsg
        ? lastQuestionMsg.options.map((o, i) => '<div class="opt ' + optClasses[i] + (i === msg.correctIndex ? ' correct' : '') + '">' + String.fromCharCode(65 + i) + '. ' + o + (i === msg.correctIndex ? ' ✅' : '') + '</div>').join('')
        : '';
      content.innerHTML = \`
        <div class="question">
          <h2>✅ Õige vastus: \${String.fromCharCode(65 + msg.correctIndex)}</h2>
          <div class="options">\${optionsHtml}</div>
          \${msg.funFact ? '<p class="funfact">💡 ' + msg.funFact + '</p>' : ''}
          <ol class="scoreboard">\${msg.scoreboard.slice(0,8).map(p => '<li><span>' + p.name + '</span><span>' + p.score + '</span></li>').join('')}</ol>
          <p style="color:var(--text-muted); margin-top:16px;">Järgmine küsimus tuleb kohe...</p>
        </div>
      \`;
    }

    function renderGameOver(msg) {
      clearInterval(timerInterval);
      stopBackgroundMusic();
      playReveal();
      content.innerHTML = \`
        <h2>🏆 Mäng läbi!</h2>
        <ol class="scoreboard">\${msg.scoreboard.map(p => '<li><span>' + p.name + '</span><span>' + p.score + '</span></li>').join('')}</ol>
        <button id="restartBtn">🔁 Mängi uuesti</button>
      \`;
      document.getElementById('restartBtn').onclick = () => ws.send(JSON.stringify({ type: 'restart' }));
    }
  </script>
  `;

  return shell("LuVu game", body, style);
}

export function renderPlayerPage(roomCode: string, origin: string): string {
  const style = `
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
    #app { width: 100%; max-width: 420px; text-align: center; }
    input { width: 100%; font-size: 18px; padding: 14px; text-align: center; margin-bottom: 12px; }
    #joinBtn { width: 100%; font-size: 18px; padding: 14px; }
    .opt-btn { width: 100%; font-size: 18px; padding: 22px; margin-bottom: 12px; text-align: left; color: #fff; border: none; font-weight: 600; }
    .opt-a { background: var(--red); }
    .opt-b { background: var(--blue); }
    .opt-c { background: var(--amber); color: #241a05; }
    .opt-d { background: var(--green); color: #052912; }
    .opt-btn.selected { box-shadow: 0 0 0 4px #fff inset; }
    .opt-btn.correct { background: var(--green) !important; color: #052912 !important; box-shadow: 0 0 0 4px #fff inset; }
    .opt-btn.wrong { opacity: 0.35; }
    .status { color: var(--text-muted); font-size: 16px; }
  `;

  const body = `
  <div id="app">
    <p style="color:var(--amber); display:flex; align-items:center; justify-content:center; gap:8px;"><img src="/logo.png" alt="" style="height:28px; width:28px; border-radius:6px;">LuVu game · ${roomCode}</p>
    <div id="content">
      <input id="nameInput" placeholder="Sinu nimi" maxlength="20">
      <button id="joinBtn">Liitu mänguga</button>
    </div>
  </div>
  <script>
    const roomCode = ${JSON.stringify(roomCode)};
    const content = document.getElementById('content');
    const optClasses = ['opt-a', 'opt-b', 'opt-c', 'opt-d'];
    let ws = null;
    let answered = false;
    let playerName = '';
    let reconnectAttempts = 0;

    const tokenKey = 'tvkviis_token_' + roomCode;
    let playerToken = localStorage.getItem(tokenKey);
    if (!playerToken) {
      playerToken = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(tokenKey, playerToken);
    }

    document.getElementById('joinBtn').onclick = () => {
      playerName = document.getElementById('nameInput').value.trim() || 'Mängija';
      connect();
    };

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/ws?room=' + roomCode + '&role=player&name=' + encodeURIComponent(playerName) + '&playerToken=' + playerToken);

      ws.onopen = () => {
        reconnectAttempts = 0;
        content.innerHTML = '<p class="status">✅ Liitusid! Oota, kuni mäng algab...</p>';
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'question_start') renderQuestion(msg);
        else if (msg.type === 'question_end') renderResult(msg);
        else if (msg.type === 'game_over') renderGameOver(msg);
        else if (msg.type === 'error') alert(msg.message);
      };

      ws.onclose = () => {
        if (reconnectAttempts < 20) {
          reconnectAttempts++;
          content.innerHTML = '<p class="status">🔄 Ühendus katkes, proovin uuesti...</p>';
          setTimeout(connect, Math.min(1000 * reconnectAttempts, 4000));
        } else {
          content.innerHTML = '<p class="status">Ühendus katkes. Värskenda lehte.</p>';
        }
      };
    }

    function renderQuestion(msg) {
      answered = false;
      content.innerHTML = '<h3>' + msg.question + '</h3>' +
        msg.options.map((o, i) => '<button class="opt-btn ' + optClasses[i] + '" data-i="' + i + '">' + String.fromCharCode(65 + i) + '. ' + o + '</button>').join('');
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
      document.querySelectorAll('.opt-btn').forEach((b, i) => {
        if (i === msg.correctIndex) b.classList.add('correct');
        else if (b.classList.contains('selected')) b.classList.add('wrong');
        else b.classList.add('wrong');
      });
      setTimeout(() => {
        content.innerHTML = '<p class="status">⏳ Oota järgmist küsimust...</p>';
      }, 2500);
    }

    function renderGameOver(msg) {
      content.innerHTML = '<h2>🏆 Mäng läbi!</h2><p class="status">Vaata lõpptulemust suurelt ekraanilt</p>';
    }
  </script>
  `;

  return shell("Liitu kviisiga", body, style);
}

export function renderHomePage(): string {
  return shell(
    "LuVu game backend",
    `<div style="padding:40px; text-align:center;">
      <h1>LuVu game backend töötab</h1>
      <p style="color:var(--text-muted)">See on API/WebSocket server. TV rakendus peaks avama <code>/tv</code>.</p>
    </div>`
  );
}
