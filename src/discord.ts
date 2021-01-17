import { Client, Guild, GuildChannel, TextChannel, Webhook } from 'discord.js';
import EventEmitter from 'eventemitter3';
import { ChannelSpec } from './config.js';
import { EventType, MessageEvent, Remote } from './remote.js';

export class DiscordRemote extends EventEmitter implements Remote {
  private client: Client;
  private webhooks: {[channelId: string]: Webhook} = {};
  private listenChannels: Map<string, GuildChannel> = new Map();
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

    this.client.on('message', (event) => {
      if (!this.listenChannels.has(event.channel.id)) {
        return;
      }
      if (event.system) {
        return;
      }
      if (event.author.bot) {
        return;
      }

      if (event.content.length > 0) {
        this.emit(EventType.message, {
          channelId: event.channel.id,
          message: event.content,
          userIcon: event.author.displayAvatarURL({
            format: 'png'
          }),
          userId: event.author.id,
          userName: event.author.username
        } as MessageEvent);
      } else {
        // TODO: Handle text message is empty. It may have attachment.
      }
    });

    return new Promise<void>((resolve) => this.client.once('ready', resolve));
  }

  // Discord doesn't have joining text channel.
  // Simply verify channel & return channel id
  // if possible, create webhook
  public async joinTextChannel (channelSpec: ChannelSpec): Promise<string> {
    let channel: GuildChannel | undefined | null = null;
    if ('channelName' in channelSpec) {
      channel = this.guild.channels.cache.find(ch => ch.name === channelSpec.channelName);
    } else {
      channel = await this.guild.channels.resolve(channelSpec.channelId);
    }

    if (channel) {
      if (!this.listenChannels.has(channel.id)) {
        if (channel.type === 'text') {
          this.listenChannels.set(channel.id, channel);
          if (!(channel.id in this.webhooks)) {
            const textChannel = channel as TextChannel;
            const webhooks = await textChannel.fetchWebhooks();
            let webhook = webhooks.find((hook) => hook.name === 'sandwich');
            if (!webhook) {
              webhook = await textChannel.createWebhook('sandwich');
            }
            this.webhooks[channel.id] = webhook;
          }
        } else {
          throw new Error(`channel ${channel.name}(${channel.id}) is not a text channel`);
        }
      }

      return channel.id;
    } else {
      throw new Error(`Resolving channel ${JSON.stringify(channel)} failed`);
    }
  }

  public async joinVoiceChannel (channel: ChannelSpec): Promise<ReadableStream<any>> {
    throw new Error('Method not implemented.');
  }

  public async sendMessage (channelName: string, userName: string, userIcon: string, message: string): Promise<void> {
    const webhook = this.webhooks[channelName];
    if (webhook) {
      await webhook.send(
        message,
        {
          username: userName,
          avatarURL: userIcon
        });
    } else {
      throw new Error('send message without webhook is not implementd');
    }
  }
}
