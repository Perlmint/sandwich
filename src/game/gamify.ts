import { Remote } from '../remote.js';
import { GuwaaGame } from './GuwaaGame.js'

export interface Game {
  readonly name: string;
  from: [Remote, string][];

  // message match method
  match(message: string, command: string): boolean;
  // do game
  doWork(remotes: [Remote, string][]): void;
  // send message to from
  sendMessageToFrom(message: string): void;
};

export interface GameConstructable {
  new(from: [Remote, string][]): Game;
}

export function makeGameObj(g: GameConstructable, from: [Remote, string][]) {
  return new g(from);
}

export function getGames(): Map<string, GameConstructable> {
  let map = new Map();

  map.set(GuwaaGame.name, GuwaaGame)

  return map;
}
