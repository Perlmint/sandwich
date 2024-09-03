import { Game } from './gamify.js'
import { EventType, MessageEvent, Remote } from '../remote.js';

export class GoSleep implements Game {

  // 이건 이 게임에서만 사용할 parameter
  sleepy_queue: Date[] = [];

  public constructor(public from: [Remote, string][], public messageTarget: [Remote, string][], public command: string) {
    this.initCounterLogic();
  }

  initRemoteCommandEventHandler(): void {
  }
  commandMatch(_: string): boolean {
    return false;
  }

  doWork(): void {
  }

  sendMessageToFrom(message: string): void {
  }

  handle_message(event: MessageEvent): void {
    if (event.message.indexOf("졸려") != -1) {
      this.sleepy_queue.push(new Date());
    } else if (event.message.indexOf("자장자장") != -1) {
      const current = new Date();
      const popped = this.sleepy_queue.splice(0, 1);
      if (popped.length == 0) {
        return;
      }

      // in ms
      let duration = current.getTime() - popped[0].getTime();
      const time_str = [];
      {
        const ms = Math.floor(duration % 1000);
        duration = (duration - ms) / 1000;
        const s = Math.floor(duration % 60);
        duration = (duration - s) / 60;
        const m = Math.floor(duration % 60);
        duration = (duration - m) / 60;
        const h = Math.floor(duration % 24);
        duration = (duration - h) / 24;
        const day = Math.floor(duration);
        if (day > 1) {
          time_str.push(`${day}days`);
        } else if (day > 0) {
          time_str.push(`${day}day`);
        }
        if (h > 1) {
          time_str.push(`${h}hours`);
        } else if (h > 0) {
          time_str.push(`${h}hour`);
        }
        if (m > 1) {
          time_str.push(`${m}minutes`);
        } else if (m > 0) {
          time_str.push(`${m}minute`);
        }
        if (s > 1) {
          time_str.push(`${s}seconds`);
        } else if (s > 0) {
          time_str.push(`${s}second`);
        }
        if (ms > 0) {
          time_str.push(`${ms}ms`);
        }
      }
      const message = `Reply from ${event.userName}: time=${time_str.join(' ')}`;
      for (const [remote, channelId] of this.messageTarget) {
        remote.sendMessageAsBot(channelId, message).catch((e) => console.error(e));
      }
    }
  }

  initCounterLogic(): void {
    for (const [rm, cId] of this.messageTarget) {
      rm.on(EventType.message, (event) => {
        if (event.channelId == cId) {
          this.handle_message(event);
        }
      });
    }
  }
}
