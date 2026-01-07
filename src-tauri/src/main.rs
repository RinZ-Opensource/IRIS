mod commands;
mod config;
mod error;
mod fsdecrypt;
mod games;
mod sync;
mod trusted;
mod vhd;

use crate::vhd::VhdMountHandle;
use std::sync::{atomic::AtomicBool, Arc, Mutex};

pub struct IrisState {
    pub mount: Arc<Mutex<Option<VhdMountHandle>>>,
    pub confirmed_launch: AtomicBool,
}

fn main() {
    tauri::Builder::default()
        .manage(IrisState {
            mount: Arc::new(Mutex::new(None)),
            confirmed_launch: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_local_override_cmd,
            commands::set_local_override_cmd,
            commands::get_effective_config_cmd,
            commands::sync_remote_config_cmd,
            commands::apply_games_from_config_cmd,
            commands::list_games_cmd,
            commands::save_game_cmd,
            commands::delete_game_cmd,
            commands::get_active_game_id_cmd,
            commands::set_active_game_id_cmd,
            commands::get_active_game_cmd,
            commands::load_segatools_config_cmd,
            commands::save_segatools_config_cmd,
            commands::default_segatools_config_cmd,
            commands::scan_game_folder_cmd,
            commands::confirm_launch_cmd,
            commands::run_startup_flow_cmd,
            commands::launch_active_game_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
