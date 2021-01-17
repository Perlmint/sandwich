import { Client } from 'discord.js';
import EventEmitter from 'eventemitter3';
import { ChannelSpec } from './config.js';
import { Remote } from './remote.js';

export class DiscordRemote extends EventEmitter implements Remote {
  private client: Client;
  private guild!: Guild;

  public constructor (private server: string) {
    super();

    this.client = new Client();
  }

  public async init (token: string) {
    await this.client.login(token);

    const guild = await this.client.guilds.resolve(this.server);
    if (!guild) {
      throw Error(`Can't resolve guild ${this.server}`);
    }

    this.guild = guild;

    return new Promise<void>((resolve) => this.client.once('ready', resolve));
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
