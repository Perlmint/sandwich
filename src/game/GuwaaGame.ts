import { Game } from './gamify.js'
import { Remote } from '../remote.js';

export class GuwaaGame implements Game {
  name: string

  public constructor() {
    this.name = "guwaa";
  }

  doWork(remotes: Remote[]): void {

  }
}
