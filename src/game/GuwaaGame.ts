import { Game } from './gamify.js'
import { Remote } from '../remote.js';

export class GuwaaGame implements Game {
  readonly name: string = "guwaa";
  from: [Remote, string][];

  public constructor(from: [Remote, string][]) {
    this.from = from;
  }

  match(message: string, command: string): boolean {
    return true;
  }

  doWork(remotes: [Remote, string][]): void {
    for (const [remote, channelId] of remotes) {
      remote.sendMessageDefault(channelId, "test message").catch((e) => console.error(e));
    }
  }

  sendMessageToFrom(message: string): void {
    for (const [remote, channelId] of this.from) {
      remote.sendMessageDefault(channelId, message).catch((e) => console.error(e));
    }
  }
}
