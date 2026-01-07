use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteCache {
    pub fetched_at: Option<String>,
    pub config: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub ok: bool,
    pub fetched_at: Option<String>,
    pub endpoint: Option<String>,
    pub used_cache: bool,
    pub error: Option<String>,
}

pub struct ConfigManager {
    root: PathBuf,
    remote_cache_path: PathBuf,
    local_override_path: PathBuf,
}

impl ConfigManager {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?;
        if !root.exists() {
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        }
        Ok(Self {
            root: root.clone(),
            remote_cache_path: root.join("remote_config.json"),
            local_override_path: root.join("local_override.json"),
        })
    }

    pub fn read_local_override(&self) -> Value {
        read_json_value(&self.local_override_path).unwrap_or_else(|| Value::Object(Map::new()))
    }

    pub fn write_local_override(&self, value: &Value) -> Result<(), String> {
        write_json_value(&self.local_override_path, value)
    }

    pub fn read_remote_cache(&self) -> RemoteCache {
        if let Some(cache) = read_json_value(&self.remote_cache_path)
            .and_then(|value| serde_json::from_value(value).ok())
        {
            return cache;
        }
        RemoteCache {
            fetched_at: None,
            config: Value::Null,
        }
    }

    pub fn write_remote_cache(&self, cache: &RemoteCache) -> Result<(), String> {
        let value = serde_json::to_value(cache).map_err(|e| e.to_string())?;
        write_json_value(&self.remote_cache_path, &value)
    }

    pub fn effective_config(&self) -> Value {
        let remote = self.read_remote_cache().config;
        let local = self.read_local_override();
        merge_json(&remote, &local)
    }

    pub fn resolve_endpoint(&self, override_endpoint: Option<String>) -> Option<String> {
        if let Some(endpoint) = override_endpoint {
            if !endpoint.trim().is_empty() {
                return Some(endpoint);
            }
        }
        let local = self.read_local_override();
        local
            .get("remote")
            .and_then(|remote| remote.get("endpoint"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
    }

    fn resolve_headers(&self) -> HashMap<String, String> {
        let local = self.read_local_override();
        let mut headers = HashMap::new();
        if let Some(obj) = local
            .get("remote")
            .and_then(|remote| remote.get("headers"))
            .and_then(|value| value.as_object())
        {
            for (key, value) in obj {
                if let Some(value) = value.as_str() {
                    headers.insert(key.to_string(), value.to_string());
                }
            }
        }
        headers
    }

    pub fn sync_remote(&self, endpoint_override: Option<String>) -> SyncStatus {
        let endpoint = self.resolve_endpoint(endpoint_override);
        let used_cache = self.remote_cache_path.exists();
        let Some(endpoint) = endpoint else {
            return SyncStatus {
                ok: false,
                fetched_at: None,
                endpoint: None,
                used_cache,
                error: Some("Missing remote endpoint".to_string()),
            };
        };

        let client = match Client::builder()
            .timeout(Duration::from_secs(6))
            .connect_timeout(Duration::from_secs(4))
            .build()
        {
            Ok(client) => client,
            Err(err) => {
                return SyncStatus {
                    ok: false,
                    fetched_at: None,
                    endpoint: Some(endpoint),
                    used_cache,
                    error: Some(err.to_string()),
                };
            }
        };

        let mut request = client.get(&endpoint);
        for (key, value) in self.resolve_headers() {
            request = request.header(&key, &value);
        }

        match request.send().and_then(|response| response.error_for_status()) {
            Ok(response) => match response.json::<Value>() {
                Ok(config) => {
                    let fetched_at = chrono::Utc::now().to_rfc3339();
                    let cache = RemoteCache {
                        fetched_at: Some(fetched_at.clone()),
                        config,
                    };
                    let _ = self.write_remote_cache(&cache);
                    SyncStatus {
                        ok: true,
                        fetched_at: Some(fetched_at),
                        endpoint: Some(endpoint),
                        used_cache,
                        error: None,
                    }
                }
                Err(err) => SyncStatus {
                    ok: false,
                    fetched_at: None,
                    endpoint: Some(endpoint),
                    used_cache,
                    error: Some(err.to_string()),
                },
            },
            Err(err) => SyncStatus {
                ok: false,
                fetched_at: None,
                endpoint: Some(endpoint),
                used_cache,
                error: Some(err.to_string()),
            },
        }
    }

    pub fn root_dir(&self) -> &Path {
        &self.root
    }
}

fn read_json_value(path: &Path) -> Option<Value> {
    let data = fs::read_to_string(path).ok()?;
    if data.trim().is_empty() {
        return Some(Value::Object(Map::new()));
    }
    serde_json::from_str(&data).ok()
}

fn write_json_value(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn merge_json(base: &Value, overlay: &Value) -> Value {
    match (base, overlay) {
        (Value::Object(base_map), Value::Object(overlay_map)) => {
            let mut merged = base_map.clone();
            for (key, value) in overlay_map {
                let next = if let Some(existing) = merged.get(key) {
                    merge_json(existing, value)
                } else {
                    value.clone()
                };
                merged.insert(key.clone(), next);
            }
            Value::Object(merged)
        }
        (_, overlay_value) => overlay_value.clone(),
    }
}

