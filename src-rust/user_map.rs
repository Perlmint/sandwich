use anyhow::{Context, Result};
use bimap::BiHashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::fs;

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct UserMapFile {
    #[serde(default)]
    pub mappings: Vec<UserMapping>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct UserMapping {
    #[serde(flatten)]
    pub users: HashMap<String, String>,
}

pub struct UserMap {
    maps: HashMap<String, Arc<BiHashMap<String, String>>>,
}

impl UserMap {
    pub async fn load(path: &str) -> Result<Self> {
        let content = match fs::read_to_string(path).await {
            Ok(c) => c,
            Err(_) => {
                // If file doesn't exist, create an empty user map
                return Ok(Self {
                    maps: HashMap::new(),
                });
            }
        };

        let user_map_file: UserMapFile =
            toml::from_str(&content).context("Failed to parse user mapping file")?;

        let mut maps: HashMap<String, BiHashMap<String, String>> = HashMap::new();

        // Build bidirectional maps for each remote
        for (idx, mapping) in user_map_file.mappings.iter().enumerate() {
            let internal_id = (idx + 1).to_string();

            for (remote_name, user_id) in &mapping.users {
                maps.entry(remote_name.clone())
                    .or_insert_with(BiHashMap::new)
                    .insert(user_id.clone(), internal_id.clone());
            }
        }

        // Convert to Arc for sharing
        let maps = maps
            .into_iter()
            .map(|(k, v)| (k, Arc::new(v)))
            .collect();

        Ok(Self { maps })
    }

    pub fn get_map(&self, remote_name: &str) -> Option<Arc<BiHashMap<String, String>>> {
        self.maps.get(remote_name).cloned()
    }
}
