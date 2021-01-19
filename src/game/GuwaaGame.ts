import { Game } from './gamify.js'
import { Remote } from '../remote.js';

export class GuwaaGame implements Game {
  name: string

  public constructor() {
    this.name = "guwaa";
  }

  doWork(remotes: [Remote, string][]): void {
    for (const [remote, channelId] of remotes) {
      remote.sendMessageDefault(channelId, "test message").catch((e) => console.error(e));
    }
  }
}
