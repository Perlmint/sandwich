import { Client } from 'discord.js';
import { EventEmitter } from 'eventemitter3';
import { ChannelSpec } from './config';
import { Remote } from './remote';

export class DiscordRemote extends EventEmitter implements Remote {
  private client: Client;

  public constructor () {
    super();

    this.client = new Client();
  }

  public async init (token: string) {
    await this.client.login(token);
  }

  public async joinTextChannel (channel: ChannelSpec): Promise<string> {
    // TODO: join specified channel if not joined previously.
    throw new Error('Method not implemented.');
  }

  public async joinVoiceChannel (channel: ChannelSpec): Promise<ReadableStream<any>> {
    throw new Error('Method not implemented.');
  }

  public sendMessage (channel: string, userName: string, userIcon: string, message: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
