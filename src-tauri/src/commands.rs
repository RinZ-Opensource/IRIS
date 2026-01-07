use crate::config::paths::{get_active_game_id, segatoools_path_for_game_id, set_active_game_id};
use crate::config::{default_segatoools_config, load_segatoools_config, save_segatoools_config, SegatoolsConfig};
use crate::games::{launcher::launch_game_child, model::{Game, LaunchMode}, store};
use crate::sync::{ConfigManager, SyncStatus};
use crate::vhd::{load_vhd_config, mount_vhd_with_elevation, resolve_vhd_config, unmount_vhd_handle};
use crate::IrisState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::{atomic::Ordering, Arc};
use std::time::Duration;
use tauri::{command, AppHandle, State};

#[derive(Serialize)]
pub struct StartupStep {
    pub name: String,
    pub status: String,
    pub detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupResult {
    pub steps: Vec<StartupStep>,
    pub can_launch: bool,
}

#[command]
pub fn get_local_override_cmd(app: AppHandle) -> Result<Value, String> {
    let manager = ConfigManager::new(&app)?;
    Ok(manager.read_local_override())
}

#[command]
pub fn set_local_override_cmd(app: AppHandle, override_json: Value) -> Result<(), String> {
    let manager = ConfigManager::new(&app)?;
    manager.write_local_override(&override_json)
}

#[command]
pub fn get_effective_config_cmd(app: AppHandle) -> Result<Value, String> {
    let manager = ConfigManager::new(&app)?;
    Ok(manager.effective_config())
}

#[command]
pub fn sync_remote_config_cmd(app: AppHandle, endpoint: Option<String>) -> Result<SyncStatus, String> {
    let manager = ConfigManager::new(&app)?;
    Ok(manager.sync_remote(endpoint))
}

#[command]
pub fn apply_games_from_config_cmd(app: AppHandle) -> Result<usize, String> {
    let manager = ConfigManager::new(&app)?;
    let config = manager.effective_config();
    let games_value = config.get("games").cloned().unwrap_or(Value::Null);
    if games_value.is_null() {
        return Ok(0);
    }
    let games: Vec<Game> = serde_json::from_value(games_value)
        .map_err(|e| format!("Invalid games config: {e}"))?;
    let mut count = 0;
    for game in games {
        store::save_game(game).map_err(|e| e.to_string())?;
        count += 1;
    }
    Ok(count)
}

#[command]
pub fn list_games_cmd() -> Result<Vec<Game>, String> {
    store::list_games().map_err(|e| e.to_string())
}

#[command]
pub fn save_game_cmd(game: Game) -> Result<(), String> {
    store::save_game(game).map_err(|e| e.to_string())
}

#[command]
pub fn delete_game_cmd(id: String) -> Result<(), String> {
    store::delete_game(&id).map_err(|e| e.to_string())
}

#[command]
pub fn get_active_game_id_cmd() -> Result<Option<String>, String> {
    get_active_game_id().map_err(|e| e.to_string())
}

#[command]
pub fn set_active_game_id_cmd(id: String) -> Result<(), String> {
    set_active_game_id(&id).map_err(|e| e.to_string())
}

#[command]
pub fn get_active_game_cmd() -> Result<Game, String> {
    active_game()
}

#[command]
pub fn load_segatools_config_cmd(game_id: Option<String>) -> Result<SegatoolsConfig, String> {
    let id = resolve_game_id(game_id)?;
    let path = segatoools_path_for_game_id(&id).map_err(|e| e.to_string())?;
    load_segatoools_config(&path).map_err(|e| e.to_string())
}

#[command]
pub fn save_segatools_config_cmd(game_id: Option<String>, config: SegatoolsConfig) -> Result<(), String> {
    let id = resolve_game_id(game_id)?;
    let path = segatoools_path_for_game_id(&id).map_err(|e| e.to_string())?;
    save_segatoools_config(&path, &config).map_err(|e| e.to_string())
}

#[command]
pub fn default_segatools_config_cmd() -> SegatoolsConfig {
    default_segatoools_config()
}

#[command]
pub fn scan_game_folder_cmd(path: String) -> Result<Game, String> {
    scan_game_folder_logic(&path)
}

#[command]
pub fn confirm_launch_cmd(state: State<IrisState>) -> Result<(), String> {
    state.confirmed_launch.store(true, Ordering::SeqCst);
    Ok(())
}

#[command]
pub fn run_startup_flow_cmd(app: AppHandle, state: State<IrisState>) -> Result<StartupResult, String> {
    let mut steps = Vec::new();

    let manager = ConfigManager::new(&app)?;
    let sync_status = manager.sync_remote(None);
    steps.push(StartupStep {
        name: "远程配置同步".to_string(),
        status: if sync_status.ok { "ok".to_string() } else { "warning".to_string() },
        detail: sync_status.error.clone(),
    });

    let config = manager.effective_config();

    let authorized = config
        .pointer("/machine/authorized")
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    if !authorized {
        steps.push(StartupStep {
            name: "授权校验".to_string(),
            status: "error".to_string(),
            detail: Some("设备未授权".to_string()),
        });
        return Ok(StartupResult { steps, can_launch: false });
    }
    steps.push(StartupStep {
        name: "授权校验".to_string(),
        status: "ok".to_string(),
        detail: None,
    });

    let update_endpoint = config
        .pointer("/updates/endpoint")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    if let Some(endpoint) = update_endpoint {
        let update_ok = check_update_endpoint(&endpoint).is_ok();
        steps.push(StartupStep {
            name: "检查更新".to_string(),
            status: if update_ok { "ok".to_string() } else { "warning".to_string() },
            detail: if update_ok { None } else { Some("更新服务不可用".to_string()) },
        });
    } else {
        steps.push(StartupStep {
            name: "检查更新".to_string(),
            status: "skipped".to_string(),
            detail: Some("未配置更新服务".to_string()),
        });
    }

    let confirm_required = config
        .pointer("/startup/confirm_launch")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if confirm_required && !state.confirmed_launch.load(Ordering::SeqCst) {
        steps.push(StartupStep {
            name: "启动确认".to_string(),
            status: "pending".to_string(),
            detail: Some("需要确认".to_string()),
        });
        return Ok(StartupResult { steps, can_launch: false });
    }
    steps.push(StartupStep {
        name: "启动确认".to_string(),
        status: if confirm_required { "ok".to_string() } else { "skipped".to_string() },
        detail: None,
    });

    match decrypt_from_config(&config) {
        Ok(DecryptOutcome::Skipped) => steps.push(StartupStep {
            name: "解密容器".to_string(),
            status: "skipped".to_string(),
            detail: Some("未配置加密".to_string()),
        }),
        Ok(DecryptOutcome::Done) => steps.push(StartupStep {
            name: "解密容器".to_string(),
            status: "ok".to_string(),
            detail: None,
        }),
        Err(err) => {
            steps.push(StartupStep {
                name: "解密容器".to_string(),
                status: "error".to_string(),
                detail: Some(err),
            });
            return Ok(StartupResult { steps, can_launch: false });
        }
    }

    let game = match active_game() {
        Ok(game) => game,
        Err(err) => {
            steps.push(StartupStep {
                name: "加载游戏配置".to_string(),
                status: "error".to_string(),
                detail: Some(err),
            });
            return Ok(StartupResult { steps, can_launch: false });
        }
    };
    if let Err(err) = ensure_vhd_mounted(&state, &game) {
        steps.push(StartupStep {
            name: "挂载 VHD".to_string(),
            status: "error".to_string(),
            detail: Some(err),
        });
        return Ok(StartupResult { steps, can_launch: false });
    }
    let mount_status = if game.launch_mode == LaunchMode::Vhd {
        "ok"
    } else {
        "skipped"
    };
    steps.push(StartupStep {
        name: "挂载 VHD".to_string(),
        status: mount_status.to_string(),
        detail: None,
    });

    launch_game_internal(&state, &game)?;
    steps.push(StartupStep {
        name: "启动游戏".to_string(),
        status: "ok".to_string(),
        detail: None,
    });

    Ok(StartupResult { steps, can_launch: true })
}

#[command]
pub fn launch_active_game_cmd(state: State<IrisState>) -> Result<(), String> {
    let game = active_game()?;
    ensure_vhd_mounted(&state, &game)?;
    launch_game_internal(&state, &game)
}

fn resolve_game_id(game_id: Option<String>) -> Result<String, String> {
    if let Some(id) = game_id {
        if !id.trim().is_empty() {
            return Ok(id);
        }
    }
    get_active_game_id()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No active game selected".to_string())
}

fn active_game() -> Result<Game, String> {
    let active_id = get_active_game_id()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No active game selected".to_string())?;
    let games = store::list_games().map_err(|e| e.to_string())?;
    games
        .into_iter()
        .find(|game| game.id == active_id)
        .ok_or_else(|| "Active game not found".to_string())
}

fn ensure_vhd_mounted(state: &State<IrisState>, game: &Game) -> Result<(), String> {
    if game.launch_mode != LaunchMode::Vhd {
        return Ok(());
    }

    if state.mount.lock().unwrap().is_some() {
        return Ok(());
    }

    let cfg = load_vhd_config(&game.id).map_err(|e| e.to_string())?;
    let resolved = resolve_vhd_config(&game.id, &cfg)?;
    let handle = mount_vhd_with_elevation(&resolved)?;
    *state.mount.lock().unwrap() = Some(handle);
    Ok(())
}

fn launch_game_internal(state: &State<IrisState>, game: &Game) -> Result<(), String> {
    let mount = state.mount.lock().unwrap().clone();
    let mut child = launch_game_child(game).map_err(|e| e.to_string())?;
    if mount.is_some() {
        let mount_state = Arc::clone(&state.mount);
        std::thread::spawn(move || {
            let _ = child.wait();
            if let Some(handle) = mount {
                let _ = unmount_vhd_handle(&handle);
            }
            if let Ok(mut guard) = mount_state.lock() {
                *guard = None;
            }
        });
    }
    Ok(())
}

fn check_update_endpoint(endpoint: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    client.get(endpoint).send().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DecryptConfig {
    files: Vec<String>,
    #[serde(alias = "key_url")]
    key_url: Option<String>,
}

enum DecryptOutcome {
    Skipped,
    Done,
}

fn decrypt_from_config(config: &Value) -> Result<DecryptOutcome, String> {
    let decrypt_value = config.pointer("/vhd/decrypt");
    let decrypt: Option<DecryptConfig> = decrypt_value
        .cloned()
        .and_then(|value| serde_json::from_value(value).ok());
    let Some(decrypt) = decrypt else {
        return Ok(DecryptOutcome::Skipped);
    };
    if decrypt.files.is_empty() {
        return Ok(DecryptOutcome::Skipped);
    }
    let files: Vec<PathBuf> = decrypt
        .files
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let summary = crate::fsdecrypt::decrypt_game_files(
        files,
        false,
        decrypt.key_url,
        None,
        None,
    )
    .map_err(|e| e.to_string())?;
    if summary.results.iter().any(|result| result.failed) {
        return Err("解密失败".to_string());
    }
    Ok(DecryptOutcome::Done)
}

fn scan_game_folder_logic(path: &str) -> Result<Game, String> {
    let dir = Path::new(path);
    if !dir.exists() || !dir.is_dir() {
        return Err("Invalid directory".to_string());
    }

    let detected = detect_game_with_fallback(dir)
        .ok_or_else(|| "No supported game executable found".to_string())?;

    Ok(build_folder_game(detected))
}

struct DetectedGameInfo {
    name: String,
    executable_path: String,
    working_dir: String,
    launch_args: Vec<String>,
}

fn default_launch_args(game_name: &str) -> Vec<String> {
    match game_name {
        "Sinmai" => vec![
            "-screen-fullscreen".into(),
            "0".into(),
            "-popupwindow".into(),
            "-screen-width".into(),
            "2160".into(),
            "-screen-height".into(),
            "1920".into(),
            "-silent-crashes".into(),
        ],
        "Chunithm" => vec![],
        "Ongeki" => vec![
            "-screen-fullscreen".into(),
            "0".into(),
            "-popupwindow".into(),
            "-screen-width".into(),
            "1080".into(),
            "-screen-height".into(),
            "1920".into(),
        ],
        _ => vec![],
    }
}

fn detect_game_in_dir(dir: &Path) -> Option<DetectedGameInfo> {
    let join_path = |p: &str| dir.join(p).to_string_lossy().to_string();

    if dir.join("Sinmai.exe").exists() {
        let name = "Sinmai".to_string();
        return Some(DetectedGameInfo {
            name: name.clone(),
            executable_path: join_path("Sinmai.exe"),
            working_dir: dir.to_string_lossy().to_string(),
            launch_args: default_launch_args(&name),
        });
    }
    if dir.join("chusanApp.exe").exists() {
        let name = "Chunithm".to_string();
        return Some(DetectedGameInfo {
            name: name.clone(),
            executable_path: join_path("chusanApp.exe"),
            working_dir: dir.to_string_lossy().to_string(),
            launch_args: default_launch_args(&name),
        });
    }
    if dir.join("mu3.exe").exists() {
        let name = "Ongeki".to_string();
        return Some(DetectedGameInfo {
            name: name.clone(),
            executable_path: join_path("mu3.exe"),
            working_dir: dir.to_string_lossy().to_string(),
            launch_args: default_launch_args(&name),
        });
    }
    None
}

fn detect_game_with_fallback(dir: &Path) -> Option<DetectedGameInfo> {
    if let Some(detected) = detect_game_in_dir(dir) {
        return Some(detected);
    }

    let package_bin = dir.join("package").join("bin");
    if let Some(detected) = detect_game_in_dir(&package_bin) {
        return Some(detected);
    }

    let mut subdirs = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                subdirs.push(path);
            }
        }
    }
    subdirs.sort_by_key(|p| p.to_string_lossy().to_lowercase());

    for subdir in subdirs {
        if let Some(detected) = detect_game_in_dir(&subdir) {
            return Some(detected);
        }
    }

    None
}

fn build_folder_game(detected: DetectedGameInfo) -> Game {
    Game {
        id: chrono::Utc::now().timestamp_millis().to_string(),
        name: detected.name,
        executable_path: detected.executable_path,
        working_dir: Some(detected.working_dir),
        launch_args: detected.launch_args,
        enabled: true,
        tags: vec![],
        launch_mode: LaunchMode::Folder,
    }
}
