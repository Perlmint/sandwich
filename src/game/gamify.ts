import { Remote } from '../remote.js';
import { GuwaaGame } from './GuwaaGame.js'

export interface Game {
  readonly name: string;
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

export function makeGameObj(g: GameConstructable, commandFrom: [Remote, string][], messageTarget: [Remote, string][], command: string) {
  return new g(commandFrom, messageTarget, command);
}

export function getGames(): Map<string, GameConstructable> {
  const map = new Map();

  map.set(GuwaaGame.name, GuwaaGame)

  return map;
}
