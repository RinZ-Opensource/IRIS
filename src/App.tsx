import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeCmd } from "./api/tauri";
import type { Game, StartupResult, SyncStatus } from "./types/iris";

const EMPTY_JSON = "{}";

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export default function App() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [effectiveConfig, setEffectiveConfig] = useState<unknown>({});
  const [localOverrideText, setLocalOverrideText] = useState(EMPTY_JSON);
  const [endpoint, setEndpoint] = useState("");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [startupResult, setStartupResult] = useState<StartupResult | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [scanPath, setScanPath] = useState("");
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [manualGame, setManualGame] = useState({
    name: "",
    exePath: "",
    workingDir: "",
    launchArgs: ""
  });
  const [segatoolsText, setSegatoolsText] = useState(EMPTY_JSON);
  const [segatoolsStatus, setSegatoolsStatus] = useState<string | null>(null);
  const [segatoolsBusy, setSegatoolsBusy] = useState(false);
  const [busy, setBusy] = useState({
    syncing: false,
    savingOverride: false,
    startup: false,
    launching: false,
    applyingGames: false
  });

  useEffect(() => {
    const init = async () => {
      try {
        await getCurrentWindow().setFullscreen(true);
      } catch {
        // Ignore fullscreen failures (e.g. in dev or unsupported environments).
      }
      await Promise.all([refreshConfig(), refreshGames()]);
    };

    init();
  }, []);

  const refreshConfig = async () => {
    const local = await invokeCmd<unknown>("get_local_override_cmd");
    const remoteEndpoint =
      typeof local === "object" && local
        ? (local as any).remote?.endpoint
        : "";
    setEndpoint(typeof remoteEndpoint === "string" ? remoteEndpoint : "");
    setLocalOverrideText(formatJson(local));

    const merged = await invokeCmd<unknown>("get_effective_config_cmd");
    setEffectiveConfig(merged ?? {});
  };

  const refreshGames = async () => {
    const list = await invokeCmd<Game[]>("list_games_cmd");
    setGames(list ?? []);
    const active = await invokeCmd<string | null>("get_active_game_id_cmd");
    setActiveGameId(active);
  };

  const handleSync = async () => {
    setBusy((prev) => ({ ...prev, syncing: true }));
    const status = await invokeCmd<SyncStatus>("sync_remote_config_cmd", {
      endpoint: endpoint.trim() || null
    });
    setSyncStatus(status);
    await refreshConfig();
    setBusy((prev) => ({ ...prev, syncing: false }));
  };

  const handleSaveOverride = async () => {
    setBusy((prev) => ({ ...prev, savingOverride: true }));
    setOverrideError(null);
    try {
      const parsed = localOverrideText.trim() ? JSON.parse(localOverrideText) : {};
      await invokeCmd("set_local_override_cmd", { override_json: parsed });
      await refreshConfig();
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : "Invalid JSON");
    }
    setBusy((prev) => ({ ...prev, savingOverride: false }));
  };

  const handleStartup = async () => {
    setBusy((prev) => ({ ...prev, startup: true }));
    const result = await invokeCmd<StartupResult>("run_startup_flow_cmd");
    setStartupResult(result);
    setBusy((prev) => ({ ...prev, startup: false }));
  };

  const handleConfirmLaunch = async () => {
    await invokeCmd("confirm_launch_cmd");
    await handleStartup();
  };

  const handleLaunchActive = async () => {
    setBusy((prev) => ({ ...prev, launching: true }));
    await invokeCmd("launch_active_game_cmd");
    setBusy((prev) => ({ ...prev, launching: false }));
  };

  const handleApplyRemoteGames = async () => {
    setBusy((prev) => ({ ...prev, applyingGames: true }));
    await invokeCmd("apply_games_from_config_cmd");
    await refreshGames();
    setBusy((prev) => ({ ...prev, applyingGames: false }));
  };

  const handleScanFolder = async () => {
    setScanStatus(null);
    if (!scanPath.trim()) {
      setScanStatus("请输入有效路径");
      return;
    }
    try {
      const game = await invokeCmd<Game>("scan_game_folder_cmd", {
        path: scanPath.trim()
      });
      await invokeCmd("save_game_cmd", { game });
      await refreshGames();
      setScanStatus("已添加游戏配置");
    } catch (err) {
      setScanStatus(err instanceof Error ? err.message : "扫描失败");
    }
  };

  const handleManualAdd = async () => {
    if (!manualGame.name.trim() || !manualGame.exePath.trim()) {
      setScanStatus("名称和可执行文件路径必填");
      return;
    }
    const payload: Game = {
      id: `${Date.now()}`,
      name: manualGame.name.trim(),
      executable_path: manualGame.exePath.trim(),
      working_dir: manualGame.workingDir.trim() || null,
      launch_args: manualGame.launchArgs
        .split(" ")
        .map((arg) => arg.trim())
        .filter(Boolean),
      enabled: true,
      tags: [],
      launch_mode: "folder"
    };
    await invokeCmd("save_game_cmd", { game: payload });
    await refreshGames();
    setManualGame({ name: "", exePath: "", workingDir: "", launchArgs: "" });
    setScanStatus("已添加游戏配置");
  };

  const handleLoadSegatools = async () => {
    if (!activeGameId) {
      setSegatoolsStatus("请先选择主游戏");
      return;
    }
    setSegatoolsBusy(true);
    setSegatoolsStatus(null);
    try {
      const config = await invokeCmd<unknown>("load_segatools_config_cmd", {
        game_id: activeGameId
      });
      setSegatoolsText(formatJson(config));
    } catch (err) {
      setSegatoolsStatus(err instanceof Error ? err.message : "加载失败");
    }
    setSegatoolsBusy(false);
  };

  const handleDefaultSegatools = async () => {
    setSegatoolsBusy(true);
    setSegatoolsStatus(null);
    try {
      const config = await invokeCmd<unknown>("default_segatools_config_cmd");
      setSegatoolsText(formatJson(config));
    } catch (err) {
      setSegatoolsStatus(err instanceof Error ? err.message : "获取默认配置失败");
    }
    setSegatoolsBusy(false);
  };

  const handleSaveSegatools = async () => {
    if (!activeGameId) {
      setSegatoolsStatus("请先选择主游戏");
      return;
    }
    setSegatoolsBusy(true);
    setSegatoolsStatus(null);
    try {
      const parsed = segatoolsText.trim() ? JSON.parse(segatoolsText) : {};
      await invokeCmd("save_segatools_config_cmd", {
        game_id: activeGameId,
        config: parsed
      });
      setSegatoolsStatus("配置已保存");
    } catch (err) {
      setSegatoolsStatus(err instanceof Error ? err.message : "保存失败");
    }
    setSegatoolsBusy(false);
  };

  const activeGame = useMemo(
    () => games.find((game) => game.id === activeGameId),
    [games, activeGameId]
  );

  return (
    <div className="app">
      <header className="topbar" data-reveal>
        <div>
          <div className="title">IRIS</div>
          <div className="subtitle">Local-first arcade frontend</div>
        </div>
        <div className="status">
          <span className="dot" data-status={syncStatus?.ok ? "ok" : "idle"} />
          <span>
            {syncStatus?.ok
              ? `已同步 ${syncStatus.fetchedAt ?? ""}`
              : "等待同步"}
          </span>
        </div>
      </header>

      <main className="content">
        <section className="panel" data-reveal>
          <h2>启动流程</h2>
          <div className="actions">
            <button onClick={handleStartup} disabled={busy.startup}>
              {busy.startup ? "运行中..." : "开始启动"}
            </button>
            <button onClick={handleConfirmLaunch} className="ghost">
              确认并继续
            </button>
            <button onClick={handleLaunchActive} className="ghost" disabled={busy.launching}>
              {busy.launching ? "启动中..." : "仅启动游戏"}
            </button>
          </div>
          <div className="steps">
            {(startupResult?.steps ?? []).map((step) => (
              <div key={step.name} className={`step step-${step.status}`}>
                <span>{step.name}</span>
                <span>{step.detail ?? step.status}</span>
              </div>
            ))}
            {!startupResult && <div className="step step-pending">等待执行</div>}
          </div>
          <div className="meta">
            当前游戏：{activeGame?.name ?? "未选择"}
          </div>
        </section>

        <section className="panel" data-reveal>
          <h2>远程同步</h2>
          <label className="field">
            <span>配置地址</span>
            <input
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://radix.example/api/iris/config"
            />
          </label>
          <div className="actions">
            <button onClick={handleSync} disabled={busy.syncing}>
              {busy.syncing ? "同步中..." : "立即同步"}
            </button>
            <button
              onClick={handleApplyRemoteGames}
              className="ghost"
              disabled={busy.applyingGames}
            >
              {busy.applyingGames ? "应用中..." : "应用远程游戏列表"}
            </button>
          </div>
          <div className="meta">
            {syncStatus?.error ? `同步失败：${syncStatus.error}` : ""}
          </div>
        </section>

        <section className="panel" data-reveal>
          <h2>本地覆盖</h2>
          <textarea
            value={localOverrideText}
            onChange={(event) => setLocalOverrideText(event.target.value)}
          />
          <div className="actions">
            <button onClick={handleSaveOverride} disabled={busy.savingOverride}>
              {busy.savingOverride ? "保存中..." : "保存覆盖"}
            </button>
          </div>
          {overrideError && <div className="meta">{overrideError}</div>}
        </section>

        <section className="panel" data-reveal>
          <h2>Segatools 配置</h2>
          <div className="actions">
            <button onClick={handleLoadSegatools} disabled={segatoolsBusy}>
              {segatoolsBusy ? "处理中..." : "加载配置"}
            </button>
            <button onClick={handleDefaultSegatools} className="ghost" disabled={segatoolsBusy}>
              使用默认模板
            </button>
            <button onClick={handleSaveSegatools} className="ghost" disabled={segatoolsBusy}>
              保存配置
            </button>
          </div>
          <textarea
            value={segatoolsText}
            onChange={(event) => setSegatoolsText(event.target.value)}
          />
          {segatoolsStatus && <div className="meta">{segatoolsStatus}</div>}
        </section>

        <section className="panel" data-reveal>
          <h2>生效配置</h2>
          <pre>{formatJson(effectiveConfig)}</pre>
        </section>

        <section className="panel" data-reveal>
          <h2>游戏列表</h2>
          <div className="game-list">
            {games.map((game) => (
              <div key={game.id} className={"game"}>
                <div>
                  <div className="game-name">{game.name}</div>
                  <div className="game-path">{game.executable_path}</div>
                </div>
                <div className="game-actions">
                  <button
                    className={game.id === activeGameId ? "primary" : "ghost"}
                    onClick={async () => {
                      await invokeCmd("set_active_game_id_cmd", { id: game.id });
                      setActiveGameId(game.id);
                    }}
                  >
                    {game.id === activeGameId ? "已激活" : "设为主游戏"}
                  </button>
                  <button
                    className="ghost"
                    onClick={async () => {
                      await invokeCmd("delete_game_cmd", { id: game.id });
                      await refreshGames();
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            {games.length === 0 && <div className="empty">暂无游戏</div>}
          </div>

          <div className="form-grid">
            <label className="field">
              <span>扫描路径</span>
              <input
                value={scanPath}
                onChange={(event) => setScanPath(event.target.value)}
                placeholder="D:\\Games\\Sinmai"
              />
            </label>
            <button onClick={handleScanFolder} className="ghost">
              扫描并添加
            </button>
          </div>

          <div className="divider" />

          <div className="form-grid">
            <label className="field">
              <span>名称</span>
              <input
                value={manualGame.name}
                onChange={(event) =>
                  setManualGame((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>可执行文件</span>
              <input
                value={manualGame.exePath}
                onChange={(event) =>
                  setManualGame((prev) => ({ ...prev, exePath: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>工作目录</span>
              <input
                value={manualGame.workingDir}
                onChange={(event) =>
                  setManualGame((prev) => ({ ...prev, workingDir: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>启动参数</span>
              <input
                value={manualGame.launchArgs}
                onChange={(event) =>
                  setManualGame((prev) => ({ ...prev, launchArgs: event.target.value }))
                }
              />
            </label>
            <button onClick={handleManualAdd} className="ghost">
              手动添加
            </button>
          </div>

          {scanStatus && <div className="meta">{scanStatus}</div>}
        </section>
      </main>
    </div>
  );
}

