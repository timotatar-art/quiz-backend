import type { CheckersBoard, CheckersColor, CheckersMove, CheckersPiece } from "./types";

// Standardne (Ameerika/Inglise) kabe 8x8 laual: nupud liiguvad diagonaalis
// ainult edasi, kuningad igas diagonaalsuunas üks samm korraga ("mittelendav"
// kuningas). Löömine on kohustuslik, kui see on võimalik, ja üks nupp võib
// ühe käigu jooksul teha mitu järjestikust löömist.

export function createInitialBoard(): CheckersBoard {
  const board: CheckersBoard = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) board[row][col] = { color: "black", king: false };
    }
  }
  for (let row = 5; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) board[row][col] = { color: "white", king: false };
    }
  }
  return board;
}

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}

function directionsFor(piece: CheckersPiece): [number, number][] {
  if (piece.king) {
    return [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
  }
  return piece.color === "white"
    ? [
        [-1, -1],
        [-1, 1],
      ]
    : [
        [1, -1],
        [1, 1],
      ];
}

export function getCapturesForPiece(board: CheckersBoard, r: number, c: number): CheckersMove[] {
  const piece = board[r][c];
  if (!piece) return [];
  const moves: CheckersMove[] = [];
  for (const [dr, dc] of directionsFor(piece)) {
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
  return moves;
}

function getSimpleMovesForPiece(board: CheckersBoard, r: number, c: number): CheckersMove[] {
  const piece = board[r][c];
  if (!piece) return [];
  const moves: CheckersMove[] = [];
  for (const [dr, dc] of directionsFor(piece)) {
    const nr = r + dr;
    const nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === null) {
      moves.push({ from: [r, c], to: [nr, nc] });
    }
  }
  return moves;
}

// Kui `mustContinueFrom` on antud, on lubatud ainult sama nupu jätku-löömised
// (kohustusliku mitmiklöömise reegel). Muidu: kui mistahes nupp saab lüüa,
// on löömine kogu laual kohustuslik ja lihtkäigud pole lubatud.
export function getLegalMoves(
  board: CheckersBoard,
  color: CheckersColor,
  mustContinueFrom?: [number, number] | null
): CheckersMove[] {
  if (mustContinueFrom) {
    return getCapturesForPiece(board, mustContinueFrom[0], mustContinueFrom[1]);
  }

  const allCaptures: CheckersMove[] = [];
  const allSimple: CheckersMove[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && piece.color === color) {
        allCaptures.push(...getCapturesForPiece(board, r, c));
        allSimple.push(...getSimpleMovesForPiece(board, r, c));
      }
    }
  }
  return allCaptures.length > 0 ? allCaptures : allSimple;
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
  if (!piece.king && ((piece.color === "white" && toR === 0) || (piece.color === "black" && toR === 7))) {
    newPiece = { ...piece, king: true };
  }
  newBoard[toR][toC] = newPiece;
  return newBoard;
}

// Tagastab võitja (vastaspoole kaotus), kui `nextTurn` poolel pole enam
// käike ega nuppe teha - muidu null.
export function checkWinner(board: CheckersBoard, nextTurn: CheckersColor): CheckersColor | null {
  const hasPieces = board.some((row) => row.some((p) => p && p.color === nextTurn));
  if (!hasPieces) return nextTurn === "white" ? "black" : "white";
  const moves = getLegalMoves(board, nextTurn);
  if (moves.length === 0) return nextTurn === "white" ? "black" : "white";
  return null;
}

function evaluateBoard(board: CheckersBoard, aiColor: CheckersColor): number {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      let value = p.king ? 3 : 1;
      if (!p.king) {
        value += (p.color === "white" ? 7 - r : r) * 0.05;
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
      const further = getCapturesForPiece(newBoard, move.to[0], move.to[1]);
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

// Vali AI jaoks parim käik lihtsa minimax + alpha-beta otsinguga (sügavus 4).
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
      const further = getCapturesForPiece(newBoard, move.to[0], move.to[1]);
      if (further.length > 0) {
        nextColor = aiColor;
        nextMustContinue = move.to;
      }
    }
    const score = minimax(newBoard, nextColor, aiColor, 4, -Infinity, Infinity, nextMustContinue);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}
