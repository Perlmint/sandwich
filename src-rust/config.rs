use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::fs;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct Config {
    pub remotes: HashMap<String, RemoteConfig>,
    #[serde(default)]
    pub bridges: Option<Vec<BridgeConfig>>,
    #[serde(default)]
    pub tts: Option<TtsConfig>,
    #[serde(default)]
    pub audio_streams: Option<Vec<AudioStreamConfig>>,
    #[serde(default)]
    pub database: Option<DatabaseConfig>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(tag = "protocol", rename_all = "lowercase")]
pub enum RemoteConfig {
    Discord(DiscordConfig),
    Slack(SlackConfig),
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DiscordConfig {
    pub token: String,
    pub server: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SlackConfig {
    pub socket_token: String,
    pub web_token: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BridgeConfig {
    pub name_format: String,
    pub remotes: Vec<BridgeRemoteConfig>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BridgeRemoteConfig {
    pub name: String,
    pub direction: BridgeDirection,
    #[serde(flatten)]
    pub channel: ChannelSpec,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum BridgeDirection {
    In,
    Out,
    InOut,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(untagged)]
pub enum ChannelSpec {
    ByName { channel_name: String },
    ById { channel_id: String },
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TtsConfig {
    AwsPolly {
        region: String,
        access_key_id: String,
        secret_access_key: String,
        voice_id: String,
    },
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AudioStreamConfig {
    pub remote: String,
    #[serde(flatten)]
    pub channel: ChannelSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entrance_audio_notification: Option<EntranceNotificationConfig>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct EntranceNotificationConfig {
    pub format: EntranceFormatConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct EntranceFormatConfig {
    pub join: Vec<String>,
    pub leave: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DatabaseConfig {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_days: Option<u32>,
}

impl Config {
    pub async fn load(path: &str) -> Result<Self> {
        let content = fs::read_to_string(path)
            .await
            .context(format!("Failed to read config file: {}", path))?;

        let config: Config =
            toml::from_str(&content).context("Failed to parse TOML configuration")?;

        Ok(config)
    }
}
