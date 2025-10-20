use anyhow::{Context, Result};
use async_trait::async_trait;
use bimap::BiHashMap;
use dashmap::DashMap;
use regex::Regex;
use reqwest::Url;
use slack_morphism::prelude::*;
use std::sync::Arc;
use tokio::sync::broadcast;

use crate::config::ChannelSpec;
use crate::remote::{
    AttachedFile, ChannelJoinEvent, Event, EventReceiver, MessageEvent, Remote, VoiceReceiver,
    VoiceSender,
};

type SCHC = SlackClientHyperHttpsConnector;

pub struct SlackRemote {
    client: Arc<SlackClient<SCHC>>,
    socket_client: Arc<SlackClientSocketModeListener<SCHC>>,
    token: SlackApiToken,
    event_tx: broadcast::Sender<Event>,
    user_cache: Arc<DashMap<SlackUserId, SlackUser>>,
    channel_cache: Arc<DashMap<SlackChannelId, SlackChannelInfo>>,
    user_map: Option<Arc<BiHashMap<String, String>>>,
}

impl SlackRemote {
    pub async fn new(
        socket_token: &str,
        web_token: &str,
        user_map: Option<Arc<BiHashMap<String, String>>>,
    ) -> Result<Self> {
        let client = Arc::new(SlackClient::new(SlackClientHyperConnector::new()?));
        let token = SlackApiToken::new(web_token.into());

        let (event_tx, _) = broadcast::channel(100);

        let user_cache = Arc::new(DashMap::new());
        let channel_cache = Arc::new(DashMap::new());

        // Initialize user cache
        Self::update_user_cache(&client, &token, &user_cache).await?;

        // Initialize channel cache
        Self::update_channel_cache(&client, &token, &channel_cache).await?;

        // Set up socket mode listener
        let socket_mode_callbacks = SlackSocketModeListenerCallbacks::new()
            .with_push_events({
                let event_tx = event_tx.clone();
                let user_cache = user_cache.clone();
                let user_map = user_map.clone();

                move |callback_data: SlackPushEventCallback, _client: Arc<SlackClient<SCHC>>, _state: SlackClientEventsUserState| {
                    let event_tx = event_tx.clone();
                    let user_cache = user_cache.clone();
                    let user_map = user_map.clone();

                    async move {
                        match &callback_data.event {
                            SlackEventCallbackBody::Message(message_event) => {
                                Self::handle_message_event(
                                    message_event,
                                    &event_tx,
                                    &user_cache,
                                    &user_map,
                                )
                                .await;
                            }
                            _ => {}
                        }

                        UserCallbackResult::Ok(())
                    }
                }
            });

        let listener_environment = Arc::new(
            SlackClientEventsListenerEnvironment::new(client.clone())
        );

        let socket_mode_listener = SlackClientSocketModeListener::new(
            &SlackClientSocketModeConfig::new(),
            listener_environment.clone(),
            socket_mode_callbacks,
        );

        socket_mode_listener.listen_for(&SlackApiToken::new(socket_token.into())).await?;

        socket_mode_listener.start();

        Ok(Self {
            client,
            socket_client,
            token,
            event_tx,
            user_cache,
            channel_cache,
            user_map,
        })
    }

    async fn update_user_cache(
        client: &SlackClient<SCHC>,
        token: &SlackApiToken,
        cache: &DashMap<SlackUserId, SlackUser>,
    ) -> Result<()> {
        let session = client.open_session(token);
        let mut cursor: Option<SlackCursorId> = None;

        loop {
            let request = SlackApiUsersListRequest::new().opt_cursor(cursor.clone());
            let response = session.users_list(&request).await?;

            for user in response.members {
                cache.insert(user.id.clone(), user);
            }

            cursor = response.response_metadata.and_then(|m| m.next_cursor);
            if cursor.is_none() {
                break;
            }
        }

        Ok(())
    }

    async fn update_channel_cache(
        client: &SlackClient<SCHC>,
        token: &SlackApiToken,
        cache: &DashMap<SlackChannelId, SlackChannelInfo>,
    ) -> Result<()> {
        let session = client.open_session(token);
        let mut cursor: Option<SlackCursorId> = None;

        loop {
            let request = SlackApiConversationsListRequest::new().opt_cursor(cursor.clone());
            let response = session.conversations_list(&request).await?;

            for channel in response.channels {
                cache.insert(channel.id.clone(), channel);
            }

            cursor = response.response_metadata.and_then(|m| m.next_cursor);
            if cursor.is_none() {
                break;
            }
        }

        Ok(())
    }

    async fn handle_message_event(
        message_event: &SlackMessageEvent,
        event_tx: &broadcast::Sender<Event>,
        user_cache: &DashMap<SlackUserId, SlackUser>,
        user_map: &Option<Arc<BiHashMap<String, String>>>,
    ) {
        // Filter out bot messages
        if message_event.sender.bot_id.is_some() {
            return;
        }

        let Some(ref user_id) = message_event.sender.user else {
            return;
        };

        let Some(user) = user_cache.get(user_id) else {
            tracing::warn!("User not found in cache: {:?}", user_id);
            return;
        };

        let Some(ref channel_id) = message_event.origin.channel else {
            return;
        };

        let Some(ref text) = message_event.content.as_ref().and_then(|c| c.text.as_ref()) else {
            return;
        };

        // Transform message
        let transformed_message = Self::transform_slack_to_internal(text, user_map);

        // Handle files if present
        let files: Vec<AttachedFile> = message_event
            .content
            .as_ref()
            .and_then(|c| c.files.as_ref())
            .map(|f| {
                f.iter()
                    .map(|file| AttachedFile {
                        url: file.url_private.as_ref().map(|u| u.to_string()).unwrap_or_default(),
                        name: file.name.clone().unwrap_or_default(),
                        mimetype: file.mimetype.clone().map(|m| m.to_string()).unwrap_or_else(|| "application/octet-stream".to_string()),
                        data: None,
                    })
                    .collect()
            })
            .unwrap_or_default();

        let user_icon = user
            .profile
            .as_ref()
            .and_then(|p| p.icon)
            .and_then(|icon| icon.images)
            .and_then(|images| images.resolutions))
            .map(|url| url.to_string())
            .unwrap_or_default();

        let event = MessageEvent {
            channel_id: channel_id.to_string(),
            user_name: user.real_name.clone().unwrap_or_else(|| user.name.clone().unwrap_or_default()),
            user_id: user_id.to_string(),
            user_icon,
            message: transformed_message,
            files,
            modified: false,
        };

        let _ = event_tx.send(Event::Message(event));
    }

    fn transform_slack_to_internal(message: &str, user_map: &Option<Arc<BiHashMap<String, String>>>) -> String {
        let mention_regex = Regex::new(r"<@([A-Z0-9]+)>").unwrap();
        let link_regex = Regex::new(r"<([^|]+)\|([^>]+)>").unwrap();
        let strikethrough_regex = Regex::new(r"~([^~]+)~").unwrap();

        let mut result = message.to_string();

        // Convert Slack strikethrough to Discord
        result = strikethrough_regex
            .replace_all(&result, "~~$1~~")
            .to_string();

        // Convert Slack links
        result = link_regex.replace_all(&result, "$1").to_string();

        // Map mentions
        if let Some(user_map) = user_map {
            result = mention_regex
                .replace_all(&result, |caps: &regex::Captures| {
                    let slack_id = &caps[1];
                    if let Some(internal_id) = user_map.get_by_left(slack_id) {
                        format!("<@{}>", internal_id)
                    } else {
                        tracing::warn!("Unknown Slack user ID: {}", slack_id);
                        format!("<@unknown>")
                    }
                })
                .to_string();
        }

        result
    }

    fn transform_internal_to_slack(message: &str, user_map: &Option<Arc<BiHashMap<String, String>>>) -> String {
        let mention_regex = Regex::new(r"<@(\d+)>").unwrap();
        let strikethrough_regex = Regex::new(r"~~([^~]+)~~").unwrap();

        let mut result = message.to_string();

        // Convert Discord strikethrough to Slack
        result = strikethrough_regex
            .replace_all(&result, "~$1~")
            .to_string();

        // Map mentions back to Slack IDs
        if let Some(user_map) = user_map {
            result = mention_regex
                .replace_all(&result, |caps: &regex::Captures| {
                    let internal_id = &caps[1];
                    if let Some(slack_id) = user_map.get_by_right(internal_id) {
                        format!("<@{}>", slack_id)
                    } else {
                        tracing::warn!("Unknown internal user ID: {}", internal_id);
                        format!("<@unknown>")
                    }
                })
                .to_string();
        }

        result
    }
}

#[async_trait]
impl Remote for SlackRemote {
    fn protocol(&self) -> &str {
        "slack"
    }

    fn supports_multi_voice(&self) -> bool {
        false
    }

    async fn join_text_channel(&self, channel_spec: &ChannelSpec) -> Result<String> {
        let channel = match channel_spec {
            ChannelSpec::ByName { channel_name } => {
                self.channel_cache
                    .iter()
                    .find(|entry| {
                        entry
                            .value()
                            .name
                            .as_ref()
                            .map(|n| n.as_ref() == channel_name)
                            .unwrap_or(false)
                    })
                    .map(|entry| entry.key().clone())
                    .context(format!("Channel '{}' not found", channel_name))?
            }
            ChannelSpec::ById { channel_id } => SlackChannelId::new(channel_id.clone()),
        };

        // Check if we're already a member
        if let Some(channel_info) = self.channel_cache.get(&channel) {
            if channel_info..unwrap_or(false) {
                return Ok(channel.to_string());
            }
        }

        // Join the channel
        let session = self.client.open_session(&self.token);
        let request = SlackApiConversationsJoinRequest::new(channel.clone());
        session.conversations_join(&request).await?;

        Ok(channel.to_string())
    }

    async fn send_message(
        &self,
        channel: &str,
        user_name: &str,
        user_icon: &str,
        message: &str,
        files: &[AttachedFile],
    ) -> Result<()> {
        let session = self.client.open_session(&self.token);
        let channel_id = SlackChannelId::new(channel.to_string());

        let transformed_message = Self::transform_internal_to_slack(message, &self.user_map);

        // Build message blocks
        let mut blocks = vec![];

        if !transformed_message.is_empty() {
            blocks.push(SlackBlock::Section(SlackSectionBlock::new().with_text(
                SlackBlockText::MarkDown(SlackBlockMarkDownText::new(transformed_message.clone())),
            )));
        }

        // Add image blocks for files
        for file in files {
            blocks.push(SlackBlock::Image(
                SlackImageBlock::new(SlackImageUrlOrFile::ImageUrl { image_url: Url::parse(&file.url).unwrap() }, file.name.clone()),
            ));
        }

        let request = SlackApiChatPostMessageRequest::new(channel_id, SlackMessageContent::new().with_text(if transformed_message.is_empty() {
                " ".into()
            } else {
                transformed_message.into()
            }).with_blocks(blocks))
            .with_username(user_name.into())
            .with_icon_url(user_icon.into());

        session.chat_post_message(&request).await?;

        Ok(())
    }

    async fn send_message_as_bot(&self, channel: &str, message: &str) -> Result<()> {
        let session = self.client.open_session(&self.token);
        let channel_id = SlackChannelId::new(channel.to_string());

        let request = SlackApiChatPostMessageRequest::new(channel_id, SlackMessageContent::new().with_text(message.into()));

        session.chat_post_message(&request).await?;

        Ok(())
    }

    fn subscribe(&self) -> EventReceiver {
        self.event_tx.subscribe()
    }
}
