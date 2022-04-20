import { Client, Guild, GuildBasedChannel, GuildChannel, MessageAttachment, MessagePayload, TextChannel, VoiceChannel, Webhook, WebhookMessageOptions } from 'discord.js';
import fetch from 'node-fetch';
import EventEmitter from 'eventemitter3';
import { ChannelSpec } from './config.js';
import { AttachedFile, ChannelJoinEvent, EventType, MessageEvent, Remote, VoiceReceiver, VoiceSender } from './remote.js';
import { Readable } from 'stream';
import { ApplicationCommandOptionType } from 'discord-api-types';
import { AudioPlayer, createAudioPlayer, createAudioResource, getVoiceConnection, joinVoiceChannel, VoiceConnection } from '@discordjs/voice';

import { Message } from './message.js';
import { parse as parseMsg } from './discord_msg_parser.js';
import { UserMapStorage } from './storage.js';

export class DiscordRemote extends EventEmitter implements Remote {
  private client: Client;
  private webhooks: Map<string, Webhook> = new Map();
  private listenChannels: Map<string, GuildChannel> = new Map();
  private guild!: Guild;
  private audioPlayer: AudioPlayer;

  public readonly protocol = 'discord';
  public readonly supportMultiVoice = false;

  public constructor(private server: string, private storage: UserMapStorage) {
    super();

    this.client = new Client({
      intents: []
    });
    this.audioPlayer = createAudioPlayer();
  }

  private parseMessage(message: string): Message {
    const ret: Message = parseMsg(message, {
      findUser(uid: string) {

      },
    });
    return ret;
  }

  private toDiscordMessage(message: Message): string {
    return '';
  }

  public async init(token: string) {
    await this.client.login(token);

    const guild = await this.client.guilds.resolve(this.server);
    if (!guild) {
      throw Error(`Can't resolve guild ${this.server}`);
    }

    this.guild = guild;

    this.client.application?.commands.create({
      name: 'register',
      description: 'User registration',
      options: [{
        type: ApplicationCommandOptionType.String,
        name: 'registration key',
        required: false,
        description: 'registration key provided by bot',
      }],
    }, this.server);

    this.client.on('message', async (event) => {
      if (!this.listenChannels.has(event.channel.id)) {
        return;
      }
      if (event.system) {
        return;
      }
      if (event.author.bot) {
        return;
      }

      const files = [...event.attachments.values()].map((attachment) => {
        return {
          buffer: async () => fetch(attachment.url).then((resp) => resp.buffer()),
          mimetype: '',
          name: attachment.name ?? '',
          url: attachment.url
        };
      });

      this.emit(EventType.message, {
        channelId: event.channel.id,
        message: this.parseMessage(event.content),
        userId: event.author.id,
        userIcon: event.author.displayAvatarURL({
          format: 'png'
        }),
        userName: event.author.username,
        files: files,
        modified: false,
      } as MessageEvent);
    });

    this.client.on('voiceStateUpdate', (oldState, newState) => {
      if (oldState.channelId == null && newState.channelId != null) {
        // join
        const user = newState.member!.user;

        if (getVoiceConnection(newState.channelId) === undefined) {
          const connection = joinVoiceChannel({
            channelId: newState.channelId,
            guildId: this.server,
            adapterCreator: newState.guild.voiceAdapterCreator,
          });
          connection.subscribe(this.audioPlayer);
        }

        this.emit(EventType.joinChannel, {
          channelId: newState.channelId,
          userId: user.id,
          userName: user.username
        } as ChannelJoinEvent);
      } else if (oldState.channelId != null && newState.channelId == null) {
        // leave
        const user = oldState.member!.user;

        if (newState.channel?.members.size == 0) {
          const connection = getVoiceConnection(oldState.channelId);
          if (connection !== undefined) {
            connection.destroy();
          }
        }

        this.emit(EventType.leaveChannel, {
          channelId: oldState.channelId,
          userId: user.id,
          userName: user.username
        } as ChannelJoinEvent);
      }
    });

    return new Promise<void>((resolve) => this.client.once('ready', () => resolve()));
  }

  private async resolveChannel(channelSpec: ChannelSpec): Promise<GuildBasedChannel> {
    let channel: GuildBasedChannel | undefined | null = null;
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
      if (channel.type === 'GUILD_TEXT') {
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

    if (channel.type !== 'GUILD_VOICE') {
      throw new Error(`channel ${channel.name}(${channel.id}) is not a voice channel`);
    }

    const player = this.audioPlayer;

    return [
      channel.id,
      {},
      {
        async play(pathOrStream: string | Readable) {
          player.play(createAudioResource(pathOrStream));
        }
      }
    ];
  }

  public async sendMessage(channelName: string, userName: string, userIcon: string, message: Message, files: AttachedFile[]): Promise<void> {
    const webhook = this.webhooks.get(channelName);
    if (webhook) {
      const webhookOption: WebhookMessageOptions = {
        username: userName,
        avatarURL: userIcon,
        files: await Promise.all(files.map(async (file) => new MessageAttachment(await file.buffer(), file.name)))
      };
      const payload = new MessagePayload(webhook, webhookOption);
      if (message.length !== 0) {
        payload.data = {
          content: this.toDiscordMessage(message),
        };
      }
      await webhook.send(
        payload
      );
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
