export interface Player {
  id: string;
  token: string;
  name: string;
  score: number;
  connected: boolean;
}

export interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  funFact?: string;
}

export type Phase = "menu" | "lobby" | "question" | "reveal" | "ended";

export interface Settings {
  difficulty: "lihtne" | "keskmine" | "raske";
  category: string;
  count: number;
  answerSeconds: number;
  questionSource: "ai" | "bank";
}

export interface Answer {
  choiceIndex: number;
  answeredAt: number;
}

export interface RoomState {
  phase: Phase;
  settings: Settings;
  players: Player[];
  questions: Question[];
  currentIndex: number;
  questionEndsAt: number | null;
  answers: Record<string, Answer>;
  hostToken: string;
  createdAt: number;
}

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  QUESTION_LIBRARY: DurableObjectNamespace;
  ANTHROPIC_API_KEY: string;
}

export interface WsAttachment {
  role: "tv" | "player";
  playerId?: string;
  name?: string;
}
