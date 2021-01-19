import { Remote } from '../remote.js';
import { GuwaaGame } from './GuwaaGame.js'

export interface Game {
  name: string,

  // do game
  doWork(remotes: [Remote, string][]): void;
};

export function getGames(): Map<string, Game> {
  let gameList = [
    new GuwaaGame()
  ]

  return gameList.reduce(function (map, obj) {
    map.set(obj.name, obj);
    return map;
  }, new Map());
}
