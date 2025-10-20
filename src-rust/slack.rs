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
use crate::remote::{AttachedFile, Event, EventReceiver, MessageEvent, Remote};

type Schc = SlackClientHyperHttpsConnector;

pub struct SlackRemote {
    client: Arc<SlackClient<Schc>>,
    token: SlackApiToken,
    event_tx: broadcast::Sender<Event>,
    #[allow(dead_code)]
    user_cache: Arc<DashMap<SlackUserId, SlackUser>>,
    channel_cache: Arc<DashMap<SlackChannelId, SlackChannelInfo>>,
    user_map: Option<Arc<BiHashMap<String, String>>>,
    _listener_handle: tokio::task::JoinHandle<()>,
}

// Free function for handling push events
async fn handle_push_event(
    callback_data: SlackPushEventCallback,
    _client: Arc<SlackClient<Schc>>,
    state: SlackClientEventsUserState,
) -> UserCallbackResult<()> {
    if let SlackEventCallbackBody::Message(message_event) = &callback_data.event {
        let state_guard = state.read().await;

        if let (Some(event_tx), Some(user_cache), Some(user_map)) = (
            state_guard.get_user_state::<broadcast::Sender<Event>>(),
            state_guard.get_user_state::<Arc<DashMap<SlackUserId, SlackUser>>>(),
            state_guard.get_user_state::<Option<Arc<BiHashMap<String, String>>>>(),
        ) {
            SlackRemote::handle_message_event(message_event, event_tx, user_cache, user_map).await;
        }
    }

    UserCallbackResult::Ok(())
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
        let socket_mode_callbacks =
            SlackSocketModeListenerCallbacks::new().with_push_events(handle_push_event);

        let mut user_state_storage = SlackClientEventsUserStateStorage::new();
        user_state_storage.set_user_state(event_tx.clone());
        user_state_storage.set_user_state(user_cache.clone());
        user_state_storage.set_user_state(user_map.clone());

        let listener_environment = Arc::new(
            SlackClientEventsListenerEnvironment::new(client.clone())
                .with_user_state(SlackClientEventsUserState::new(user_state_storage)),
        );

        let socket_mode_listener = SlackClientSocketModeListener::new(
            &SlackClientSocketModeConfig::new(),
            listener_environment.clone(),
            socket_mode_callbacks,
        );

        socket_mode_listener
            .listen_for(&SlackApiToken::new(socket_token.into()))
            .await?;

        let listener_handle = tokio::spawn(async move {
            let _ = socket_mode_listener.start().await;
        });

        Ok(Self {
            client,
            token,
            event_tx,
            user_cache,
            channel_cache,
            user_map,
            _listener_handle: listener_handle,
        })
    }

    async fn update_user_cache(
        client: &SlackClient<Schc>,
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
        client: &SlackClient<Schc>,
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

        // Filter out thread_broadcast messages (replies also sent to channel)
        if message_event.subtype == Some(SlackMessageEventType::ThreadBroadcast) {
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

        let Some(text) = message_event.content.as_ref().and_then(|c| c.text.as_ref()) else {
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
                        url: file
                            .url_private
                            .as_ref()
                            .map(|u| u.to_string())
                            .unwrap_or_default(),
                        name: file.name.clone().unwrap_or_default(),
                        mimetype: file
                            .mimetype
                            .clone()
                            .map(|m| m.to_string())
                            .unwrap_or_else(|| "application/octet-stream".to_string()),
                        data: None,
                    })
                    .collect()
            })
            .unwrap_or_default();

        let user_icon = user
            .profile
            .as_ref()
            .and_then(|p| p.icon.as_ref())
            .and_then(|icon| icon.images.as_ref())
            .map(|images| &images.resolutions)
            .and_then(|resolutions| {
                // Try to find 72px resolution first
                resolutions
                    .iter()
                    .find(|(size, _)| *size == 72)
                    .or_else(|| {
                        // If not found, find the smallest resolution >= 72
                        resolutions
                            .iter()
                            .filter(|(size, _)| *size >= 72)
                            .min_by_key(|(size, _)| *size)
                    })
                    .or_else(|| {
                        // If no resolution >= 72, take the largest available
                        resolutions.iter().max_by_key(|(size, _)| *size)
                    })
                    .map(|(_, url)| url.clone())
            })
            .unwrap_or_default();

        // Extract message timestamp (message ID in Slack)
        let message_id = Some(message_event.origin.ts.to_string());

        // Check if this is a message edit
        let modified = message_event.subtype == Some(SlackMessageEventType::MessageChanged);

        // Extract thread information
        let (thread_id, parent_message_id) =
            if let Some(ref thread_ts) = message_event.origin.thread_ts {
                let thread_ts_str = thread_ts.to_string();
                let msg_ts_str = message_event.origin.ts.to_string();

                // If thread_ts == ts, this is the parent message
                // If thread_ts != ts, this is a reply in the thread
                if thread_ts_str == msg_ts_str {
                    (Some(thread_ts_str), None)
                } else {
                    (Some(thread_ts_str.clone()), Some(thread_ts_str))
                }
            } else {
                (None, None)
            };

        let event = MessageEvent {
            channel_id: channel_id.to_string(),
            message_id,
            user_name: user
                .real_name
                .clone()
                .unwrap_or_else(|| user.name.clone().unwrap_or_default()),
            user_id: user_id.to_string(),
            user_icon,
            message: transformed_message,
            files,
            modified,
            thread_id,
            parent_message_id,
        };

        let _ = event_tx.send(Event::Message(event));
    }

    fn transform_slack_to_internal(
        message: &str,
        user_map: &Option<Arc<BiHashMap<String, String>>>,
    ) -> String {
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
                        "<@unknown>".to_string()
                    }
                })
                .to_string();
        }

        result
    }

    fn transform_internal_to_slack(
        message: &str,
        user_map: &Option<Arc<BiHashMap<String, String>>>,
    ) -> String {
        let mention_regex = Regex::new(r"<@(\d+)>").unwrap();
        let strikethrough_regex = Regex::new(r"~~([^~]+)~~").unwrap();

        let mut result = message.to_string();

        // Convert Discord strikethrough to Slack
        result = strikethrough_regex.replace_all(&result, "~$1~").to_string();

        // Map mentions back to Slack IDs
        if let Some(user_map) = user_map {
            result = mention_regex
                .replace_all(&result, |caps: &regex::Captures| {
                    let internal_id = &caps[1];
                    if let Some(slack_id) = user_map.get_by_right(internal_id) {
                        format!("<@{}>", slack_id)
                    } else {
                        tracing::warn!("Unknown internal user ID: {}", internal_id);
                        "<@unknown>".to_string()
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
            ChannelSpec::ByName { channel_name } => self
                .channel_cache
                .iter()
                .find(|entry| {
                    entry
                        .value()
                        .name
                        .as_ref()
                        .map(|n| n.as_str() == channel_name)
                        .unwrap_or(false)
                })
                .map(|entry| entry.key().clone())
                .context(format!("Channel '{}' not found", channel_name))?,
            ChannelSpec::ById { channel_id } => SlackChannelId::new(channel_id.clone()),
        };

        // Check if we're already a member
        if let Some(channel_info) = self.channel_cache.get(&channel) {
            if channel_info.flags.is_member.unwrap_or(false) {
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
        thread_id: Option<&str>,
    ) -> Result<String> {
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
            blocks.push(SlackBlock::Image(SlackImageBlock::new(
                SlackImageUrlOrFile::ImageUrl {
                    image_url: Url::parse(&file.url).unwrap(),
                },
                file.name.clone(),
            )));
        }

        let mut request = SlackApiChatPostMessageRequest::new(
            channel_id,
            SlackMessageContent::new()
                .with_text(if transformed_message.is_empty() {
                    " ".into()
                } else {
                    transformed_message
                })
                .with_blocks(blocks),
        )
        .with_username(user_name.into())
        .with_icon_url(user_icon.into());

        // Add thread_ts if this is a threaded message
        if let Some(thread_ts) = thread_id {
            request = request.with_thread_ts(SlackTs::new(thread_ts.into()));
        }

        let response = session.chat_post_message(&request).await?;

        // Return the message timestamp as the message ID
        Ok(response.ts.to_string())
    }

    async fn edit_message(
        &self,
        channel: &str,
        message_id: &str,
        message: &str,
        files: &[AttachedFile],
        _thread_id: Option<&str>,
    ) -> Result<()> {
        let session = self.client.open_session(&self.token);
        let channel_id = SlackChannelId::new(channel.to_string());
        let ts = SlackTs::new(message_id.into());

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
            blocks.push(SlackBlock::Image(SlackImageBlock::new(
                SlackImageUrlOrFile::ImageUrl {
                    image_url: Url::parse(&file.url).unwrap(),
                },
                file.name.clone(),
            )));
        }

        let request = SlackApiChatUpdateRequest::new(
            channel_id,
            SlackMessageContent::new()
                .with_text(if transformed_message.is_empty() {
                    " ".into()
                } else {
                    transformed_message
                })
                .with_blocks(blocks),
            ts,
        );

        match session.chat_update(&request).await {
            Ok(_) => Ok(()),
            Err(e) => {
                // Check if the error is because the message was not found or too old
                let error_str = e.to_string();
                if error_str.contains("message_not_found")
                    || error_str.contains("cant_update_message")
                {
                    // Slack free tier discards old messages - log and ignore
                    tracing::warn!("Cannot edit Slack message {}: {}", message_id, e);
                    Ok(())
                } else {
                    // Propagate auth/permission errors
                    Err(e.into())
                }
            }
        }
    }

    async fn create_thread(
        &self,
        _channel: &str,
        _message_id: Option<&str>,
        _name: &str,
    ) -> Result<String> {
        // Slack threads are implicit - they're created automatically when
        // you send a message with thread_ts. Return empty string as no-op.
        Ok(String::new())
    }

    async fn send_message_as_bot(&self, channel: &str, message: &str) -> Result<()> {
        let session = self.client.open_session(&self.token);
        let channel_id = SlackChannelId::new(channel.to_string());

        let request = SlackApiChatPostMessageRequest::new(
            channel_id,
            SlackMessageContent::new().with_text(message.into()),
        );

        session.chat_post_message(&request).await?;

        Ok(())
    }

    fn subscribe(&self) -> EventReceiver {
        self.event_tx.subscribe()
    }
}
