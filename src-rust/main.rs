mod config;
mod discord;
mod name;
mod remote;
mod slack;
mod tts;
mod user_map;
mod utils;

use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{error, info, warn};
use tracing_subscriber;

use crate::config::{BridgeDirection, Config, RemoteConfig};
use crate::name::format_name;
use crate::remote::{Event, Remote, UserInfo};
use crate::user_map::UserMap;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("Starting Sandwich bot...");

    // Load configuration
    let config = Config::load("config.toml").await?;
    let user_map = UserMap::load("user_map.toml").await?;

    info!("Configuration loaded successfully");

    // Initialize remotes
    let mut remotes: HashMap<String, Arc<dyn Remote>> = HashMap::new();

    for (name, remote_config) in &config.remotes {
        match remote_config {
            RemoteConfig::Discord(discord_config) => {
                info!("Initializing Discord remote: {}", name);
                let discord_remote = discord::DiscordRemote::new(
                    &discord_config.token,
                    &discord_config.server,
                    user_map.get_map(name),
                )
                .await?;
                remotes.insert(name.clone(), Arc::new(discord_remote));
            }
            RemoteConfig::Slack(slack_config) => {
                info!("Initializing Slack remote: {}", name);
                let slack_remote = slack::SlackRemote::new(
                    &slack_config.socket_token,
                    &slack_config.web_token,
                    user_map.get_map(name),
                )
                .await?;
                remotes.insert(name.clone(), Arc::new(slack_remote));
            }
        }
    }

    // Initialize text bridges
    if let Some(bridges) = &config.bridges {
        for bridge_config in bridges {
            info!("Setting up bridge: {}", bridge_config.name_format);

            // For each input remote, set up listeners
            for (in_idx, in_remote_cfg) in bridge_config.remotes.iter().enumerate() {
                // Skip output-only remotes
                if matches!(in_remote_cfg.direction, BridgeDirection::Out) {
                    continue;
                }

                let in_remote = match remotes.get(&in_remote_cfg.name) {
                    Some(r) => r.clone(),
                    None => {
                        error!("Remote not found: {}", in_remote_cfg.name);
                        continue;
                    }
                };

                // Join the input channel
                let in_channel_id = match in_remote.join_text_channel(&in_remote_cfg.channel).await
                {
                    Ok(id) => id,
                    Err(e) => {
                        error!(
                            "Failed to join channel for remote {}: {}",
                            in_remote_cfg.name, e
                        );
                        continue;
                    }
                };

                info!(
                    "Joined channel {} on remote {}",
                    in_channel_id, in_remote_cfg.name
                );

                // Collect output remotes
                let mut out_remotes = Vec::new();
                for (out_idx, out_remote_cfg) in bridge_config.remotes.iter().enumerate() {
                    if in_idx == out_idx {
                        continue;
                    }

                    // Skip input-only remotes
                    if matches!(out_remote_cfg.direction, BridgeDirection::In) {
                        continue;
                    }

                    let out_remote = match remotes.get(&out_remote_cfg.name) {
                        Some(r) => r.clone(),
                        None => {
                            error!("Output remote not found: {}", out_remote_cfg.name);
                            continue;
                        }
                    };

                    // Join the output channel
                    match out_remote.join_text_channel(&out_remote_cfg.channel).await {
                        Ok(out_channel_id) => {
                            info!(
                                "Joined output channel {} on remote {}",
                                out_channel_id, out_remote_cfg.name
                            );
                            out_remotes.push((out_remote, out_channel_id));
                        }
                        Err(e) => {
                            error!(
                                "Failed to join output channel for remote {}: {}",
                                out_remote_cfg.name, e
                            );
                        }
                    }
                }

                // Subscribe to events from this remote
                let mut event_rx = in_remote.subscribe();
                let name_format = bridge_config.name_format.clone();
                let in_protocol = in_remote.protocol().to_string();
                let in_channel_id_clone = in_channel_id.clone();

                // Spawn a task to handle events
                tokio::spawn(async move {
                    loop {
                        match event_rx.recv().await {
                            Ok(Event::Message(msg_event)) => {
                                // Only process messages from the channel we're listening to
                                if msg_event.channel_id != in_channel_id_clone {
                                    continue;
                                }

                                let user_info = UserInfo {
                                    user_name: msg_event.user_name.clone(),
                                    user_id: msg_event.user_id.clone(),
                                };

                                let mut username =
                                    format_name(&name_format, &user_info, &in_protocol);
                                if msg_event.modified {
                                    username.push_str("*message modified");
                                }

                                // Forward to all output remotes
                                for (out_remote, out_channel_id) in &out_remotes {
                                    if let Err(e) = out_remote
                                        .send_message(
                                            out_channel_id,
                                            &username,
                                            &msg_event.user_icon,
                                            &msg_event.message,
                                            &msg_event.files,
                                        )
                                        .await
                                    {
                                        error!("Failed to forward message: {}", e);
                                    }
                                }
                            }
                            Ok(_) => {
                                // Other event types can be handled here if needed
                            }
                            Err(e) => {
                                warn!("Error receiving event: {}", e);
                                break;
                            }
                        }
                    }
                });
            }
        }
    }

    // Initialize TTS if configured
    let _tts = if let Some(tts_config) = &config.tts {
        Some(tts::init_tts(tts_config).await?)
    } else {
        None
    };

    // Initialize audio streams if configured
    if let Some(audio_streams) = &config.audio_streams {
        for stream_config in audio_streams {
            info!("Setting up audio stream for remote: {}", stream_config.remote);

            // TODO: Implement audio stream logic
        }
    }

    info!("Bot is ready!");

    // Keep the bot running
    tokio::signal::ctrl_c().await?;
    info!("Shutting down...");

    Ok(())
}
