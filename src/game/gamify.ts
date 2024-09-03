import { Remote } from '../remote.js';
import { GoSleep } from './GoSleep.js';
import { GuwaaGame } from './GuwaaGame.js'

export interface Game {
  from: [Remote, string][];
  messageTarget: [Remote, string][];
  command: string;

  // init command input receiver
  initRemoteCommandEventHandler(): void;
  // message match method
  commandMatch(message: string): boolean;
  // do game
  doWork(): void;
  // send message to from
  sendMessageToFrom(message: string): void;
};

export interface GameConstructable {
  new(from: [Remote, string][], messageTarget: [Remote, string][], command: string): Game;
}

export function getGames(): Map<string, GameConstructable> {
  const map = new Map();

  map.set(GuwaaGame.name, GuwaaGame);
  map.set(GoSleep.name, GoSleep);

  return map;
}
