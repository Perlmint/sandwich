import { Game } from './gamify.js'
import { EventType, MessageEvent, Remote } from '../remote.js';

export class GuwaaGame implements Game {
  readonly name: string = "guwaa";
  from: [Remote, string][];
  messageTarget: [Remote, string][];
  command: string;

  // 이건 이 게임에서만 사용할 parameter
  guwaaCounterMap: Map<string, [string, number]>;

  public constructor(from: [Remote, string][], messageTarget: [Remote, string][], command: string) {
    this.from = from;
    this.messageTarget = messageTarget;
    this.command = command;

    this.guwaaCounterMap = new Map()

    this.initRemoteCommandEventHandler();

    for (const [rm, cId] of this.messageTarget) {
      rm.on(EventType.message, (event) => {
        if (event.channelId == cId) {
          this.guwaaConter(event);
        }
      });
    }
  }

  guwaaConter(event: MessageEvent): void {
    let prevCounter = this.guwaaCounterMap.get(event.userId);
    if (prevCounter) {
      prevCounter[1] = ++prevCounter[1]
      this.guwaaCounterMap.set(event.userId, prevCounter);
    } else {
      this.guwaaCounterMap.set(event.userId, [event.userName, 1]);
    }
  }

  initRemoteCommandEventHandler(): void {
    // command 받는 부분 선언
    for (const [rm, cId] of this.from) {
      rm.on(EventType.message, (event) => {
        if (event.channelId == cId && this.commandMatch(event.message)) {
          this.doWork()
          const message = this.makeMessage();
          this.sendMessageToFrom(message);
        }
      });
    }
  }

  commandMatch(message: string): boolean {
    return this.command === message;
  }

  doWork(): void {
    for (const [remote, channelId] of this.messageTarget) {
      remote.sendMessageAsBot(channelId, "test message").catch((e) => console.error(e));
    }
  }

  sendMessageToFrom(message: string): void {
    for (const [remote, channelId] of this.from) {
      remote.sendMessageAsBot(channelId, message).catch((e) => console.error(e));
    }
  }

  makeMessage(): string {
    const result = [...this.guwaaCounterMap.entries()].sort((a, b) => b[1][1] - a[1][1]);
    const entries = [...result.entries()].map(function (v) { return v[1][1] })
    return entries.map(this.makeMessageFromTemplate).join("¥n");
  }

  makeMessageFromTemplate(userNameCount: [string, number]): string {
    return "${userNameCount[0]} : ${userNameCount[1]}"
  }
}
