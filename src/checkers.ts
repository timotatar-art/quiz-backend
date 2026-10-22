import type { CheckersBoard, CheckersColor, CheckersMove, CheckersPiece } from "./types";

// Rahvusvaheline (nn "vene"/"rahvusvaheline") kabe 10x10 laual, 20 nuppu
// kummalgi poolel:
// - mehed liiguvad lihtkäigul ainult edasi, aga lööma võivad nad igas
//   diagonaalsuunas (ka tagasi)
// - kuningad ("lendavad kuningad") liiguvad ja löövad suvalise arvu
//   ruutude kaugusele piki diagonaali, kuni esimese takistuseni
// - löömine on kohustuslik ja kui on mitu löömisvõimalust, tuleb valida
//   see, mis lööb KÕIGE ROHKEM nuppe (nn "enamusreegel")

const SIZE = 10;

export function createInitialBoard(): CheckersBoard {
  const board: CheckersBoard = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < SIZE; col++) {
      if ((row + col) % 2 === 1) board[row][col] = { color: "black", king: false };
    }
  }
  for (let row = SIZE - 4; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if ((row + col) % 2 === 1) board[row][col] = { color: "white", king: false };
    }
  }
  return board;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

const DIAGONALS: [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

// Löömisvõimalused - meestel kõigis 4 suunas, kuningatel "lendava" löögina
// (võib lüüa suvalise kaugusega vastasnupu, kui tema ja kuninga vahel on
// ainult tühje ruute, ning maanduda ükskõik millisele tühjale ruudule
// löödud nupu taga samal diagonaalil).
export function getCapturesForPiece(board: CheckersBoard, r: number, c: number): CheckersMove[] {
  const piece = board[r][c];
  if (!piece) return [];
  const moves: CheckersMove[] = [];

  if (piece.king) {
    for (const [dr, dc] of DIAGONALS) {
      let dist = 1;
      let enemyAt: [number, number] | null = null;
      while (true) {
        const rr = r + dr * dist;
        const cc = c + dc * dist;
        if (!inBounds(rr, cc)) break;
        const occ = board[rr][cc];
        if (occ === null) {
          if (enemyAt) {
            moves.push({ from: [r, c], to: [rr, cc], captured: enemyAt });
          }
          dist++;
          continue;
        }
        if (!enemyAt && occ.color !== piece.color) {
          enemyAt = [rr, cc];
          dist++;
          continue;
        }
        break; // omanupp ees, või juba teine nupp pärast leitud vaenlast
      }
    }
  } else {
    for (const [dr, dc] of DIAGONALS) {
      const midR = r + dr;
      const midC = c + dc;
      const landR = r + dr * 2;
      const landC = c + dc * 2;
      if (!inBounds(landR, landC)) continue;
      const midPiece = board[midR]?.[midC];
      if (midPiece && midPiece.color !== piece.color && board[landR][landC] === null) {
        moves.push({ from: [r, c], to: [landR, landC], captured: [midR, midC] });
      }
    }
  }
  return moves;
}

function getSimpleMovesForPiece(board: CheckersBoard, r: number, c: number): CheckersMove[] {
  const piece = board[r][c];
  if (!piece) return [];
  const moves: CheckersMove[] = [];

  if (piece.king) {
    for (const [dr, dc] of DIAGONALS) {
      let dist = 1;
      while (true) {
        const rr = r + dr * dist;
        const cc = c + dc * dist;
        if (!inBounds(rr, cc) || board[rr][cc] !== null) break;
        moves.push({ from: [r, c], to: [rr, cc] });
        dist++;
      }
    }
  } else {
    const dirs: [number, number][] = piece.color === "white" ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === null) {
        moves.push({ from: [r, c], to: [nr, nc] });
      }
    }
  }
  return moves;
}

function allPiecesOf(board: CheckersBoard, color: CheckersColor): [number, number][] {
  const result: [number, number][] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (p && p.color === color) result.push([r, c]);
    }
  }
  return result;
}

export function applyMove(board: CheckersBoard, move: CheckersMove): CheckersBoard {
  const newBoard = board.map((row) => row.slice());
  const piece = newBoard[move.from[0]][move.from[1]]!;
  newBoard[move.from[0]][move.from[1]] = null;
  if (move.captured) {
    newBoard[move.captured[0]][move.captured[1]] = null;
  }
  const [toR, toC] = move.to;
  let newPiece = piece;
  if (!piece.king && ((piece.color === "white" && toR === 0) || (piece.color === "black" && toR === SIZE - 1))) {
    newPiece = { ...piece, king: true };
  }
  newBoard[toR][toC] = newPiece;
  return newBoard;
}

// Pikim võimalik järjestikuste löömiste ahel, mis algab antud nupu
// positsioonilt (ei arvesta juba varem selles käigus löödud nuppe -
// need on juba laualt eemaldatud `board` argumendis).
function sequenceMaxLength(board: CheckersBoard, pos: [number, number], color: CheckersColor): number {
  const caps = getCapturesForPiece(board, pos[0], pos[1]);
  if (caps.length === 0) return 0;
  let best = 0;
  for (const cap of caps) {
    const nb = applyMove(board, cap);
    const len = 1 + sequenceMaxLength(nb, cap.to, color);
    if (len > best) best = len;
  }
  return best;
}

// Kui `mustContinueFrom` on antud, tagastab ainult need sama nupu
// jätku-löömised, mis viivad pikima võimaliku löömisahelani sellest
// positsioonist (st on ikka veel osa parimast võimalikust jadast).
// Muidu: kui mistahes nupp saab lüüa, on löömine kohustuslik ja valida
// tuleb nuppude seast, mis saavutavad kõige PIKEMA löömisahela
// (enamusreegel) - alles siis, kui lööki pole, on lihtkäigud lubatud.
export function getLegalMoves(
  board: CheckersBoard,
  color: CheckersColor,
  mustContinueFrom?: [number, number] | null
): CheckersMove[] {
  if (mustContinueFrom) {
    const caps = getCapturesForPiece(board, mustContinueFrom[0], mustContinueFrom[1]);
    if (caps.length === 0) return [];
    const bestHere = sequenceMaxLength(board, mustContinueFrom, color);
    return caps.filter((cap) => {
      const nb = applyMove(board, cap);
      return 1 + sequenceMaxLength(nb, cap.to, color) === bestHere;
    });
  }

  const options: { move: CheckersMove; len: number }[] = [];
  for (const [r, c] of allPiecesOf(board, color)) {
    for (const cap of getCapturesForPiece(board, r, c)) {
      const nb = applyMove(board, cap);
      const len = 1 + sequenceMaxLength(nb, cap.to, color);
      options.push({ move: cap, len });
    }
  }
  if (options.length > 0) {
    const globalMax = Math.max(...options.map((o) => o.len));
    return options.filter((o) => o.len === globalMax).map((o) => o.move);
  }

  const simple: CheckersMove[] = [];
  for (const [r, c] of allPiecesOf(board, color)) {
    simple.push(...getSimpleMovesForPiece(board, r, c));
  }
  return simple;
}

export function checkWinner(board: CheckersBoard, nextTurn: CheckersColor): CheckersColor | null {
  const hasPieces = board.some((row) => row.some((p) => p && p.color === nextTurn));
  if (!hasPieces) return nextTurn === "white" ? "black" : "white";
  const moves = getLegalMoves(board, nextTurn);
  if (moves.length === 0) return nextTurn === "white" ? "black" : "white";
  return null;
}

function evaluateBoard(board: CheckersBoard, aiColor: CheckersColor): number {
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const p = board[r][c];
      if (!p) continue;
      let value = p.king ? 3 : 1;
      if (!p.king) {
        value += (p.color === "white" ? SIZE - 1 - r : r) * 0.03;
      }
      score += p.color === aiColor ? value : -value;
    }
  }
  return score;
}

function minimax(
  board: CheckersBoard,
  color: CheckersColor,
  aiColor: CheckersColor,
  depth: number,
  alpha: number,
  beta: number,
  mustContinueFrom: [number, number] | null
): number {
  const moves = getLegalMoves(board, color, mustContinueFrom);
  if (depth <= 0 || moves.length === 0) {
    return evaluateBoard(board, aiColor);
  }
  const maximizing = color === aiColor;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const newBoard = applyMove(board, move);
    let nextColor: CheckersColor = color === "white" ? "black" : "white";
    let nextMustContinue: [number, number] | null = null;
    let nextDepth = depth - 1;
    if (move.captured) {
      const further = getLegalMoves(newBoard, color, move.to);
      if (further.length > 0) {
        nextColor = color;
        nextMustContinue = move.to;
        nextDepth = depth;
      }
    }
    const val = minimax(newBoard, nextColor, aiColor, nextDepth, alpha, beta, nextMustContinue);
    if (maximizing) {
      if (val > best) best = val;
      if (val > alpha) alpha = val;
    } else {
      if (val < best) best = val;
      if (val < beta) beta = val;
    }
    if (beta <= alpha) break;
  }
  return best;
}

// Vali AI jaoks parim käik minimax + alpha-beta otsinguga. 10x10 laua ja
// lendavate kuningate tõttu on harusid rohkem kui 8x8 variandis, seega
// sügavus on tagasihoidlikum (3), et püsida Workeri aja piirides.
export function chooseAiMove(
  board: CheckersBoard,
  aiColor: CheckersColor,
  mustContinueFrom: [number, number] | null = null
): CheckersMove | null {
  const moves = getLegalMoves(board, aiColor, mustContinueFrom);
  if (moves.length === 0) return null;
  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const newBoard = applyMove(board, move);
    let nextColor: CheckersColor = aiColor === "white" ? "black" : "white";
    let nextMustContinue: [number, number] | null = null;
    if (move.captured) {
      const further = getLegalMoves(newBoard, aiColor, move.to);
      if (further.length > 0) {
        nextColor = aiColor;
        nextMustContinue = move.to;
      }
    }
    const score = minimax(newBoard, nextColor, aiColor, 3, -Infinity, Infinity, nextMustContinue);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}
