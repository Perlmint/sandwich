import { Client, Guild, GuildChannel, TextChannel, VoiceChannel, Webhook } from 'discord.js';
import EventEmitter from 'eventemitter3';
import { ChannelSpec } from './config.js';
import { ChannelJoinEvent, EventType, MessageEvent, Remote, VoiceReceiver, VoiceSender } from './remote.js';
import { Readable } from 'stream';

export class DiscordRemote extends EventEmitter implements Remote {
  private client: Client;
  private webhooks: Map<string, Webhook> = new Map();
  private listenChannels: Map<string, GuildChannel> = new Map();
  private guild!: Guild;

  public readonly protocol = 'discord';
  public readonly supportMultiVoice = false;

  public constructor(private server: string) {
    super();

    this.client = new Client();
  }

  public async init(token: string) {
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

    this.client.on('voiceStateUpdate', (oldState, newState) => {
      if (oldState.channelID == null && newState.channelID != null) {
        // join
        const user = newState.member!.user;
        this.emit(EventType.joinChannel, {
          channelId: newState.channelID,
          userId: user.id,
          userName: user.username
        } as ChannelJoinEvent);
      } else if (oldState.channelID != null && newState.channelID == null) {
        // leave
        const user = oldState.member!.user;
        this.emit(EventType.leaveChannel, {
          channelId: oldState.channelID,
          userId: user.id,
          userName: user.username
        } as ChannelJoinEvent);
      }
    });

    return new Promise<void>((resolve) => this.client.once('ready', resolve));
  }

  private async resolveChannel(channelSpec: ChannelSpec): Promise<GuildChannel> {
    let channel: GuildChannel | undefined | null = null;
    if ('channelName' in channelSpec) {
      channel = this.guild.channels.cache.find(ch => ch.name === channelSpec.channelName);
    } else {
      channel = await this.guild.channels.resolve(channelSpec.channelId);
    }

    if (!channel) {
      throw new Error(`Resolving channel ${JSON.stringify(channelSpec)} failed`);
    }

    return channel;
  }

  // Discord doesn't have joining text channel.
  // Simply verify channel & return channel id
  // if possible, create webhook
  public async joinTextChannel(channelSpec: ChannelSpec): Promise<string> {
    const channel = await this.resolveChannel(channelSpec);

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
          this.webhooks.set(channel.id, webhook);
        }
      } else {
        throw new Error(`channel ${channel.name}(${channel.id}) is not a text channel`);
      }
    }

    return channel.id;
  }

  public async joinVoiceChannel(channelSpec: ChannelSpec): Promise<[string, VoiceReceiver, VoiceSender]> {
    const channel = await this.resolveChannel(channelSpec);

    if (channel.type !== 'voice') {
      throw new Error(`channel ${channel.name}(${channel.id}) is not a voice channel`);
    }

    const voiceChannel = channel as VoiceChannel;
    const connection = await voiceChannel.join();
    console.log('join voice!');

    return [
      channel.id,
      {},
      {
        async play(pathOrStream: string | Readable) {
          connection.play(pathOrStream);
        }
      }
    ];
  }

  public async sendMessage(channelName: string, userName: string, userIcon: string, message: string): Promise<void> {
    const webhook = this.webhooks.get(channelName);
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

  public async sendMessageAsBot(channelName: string, message: string): Promise<void> {
    const webhook = this.webhooks.get(channelName);
    if (webhook) {
      webhook.send(message);
    } else {
      throw new Error('send message without webhook is not implementd');
    }
  }
}
