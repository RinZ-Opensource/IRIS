export type SyncStatus = {
  ok: boolean;
  fetchedAt?: string | null;
  endpoint?: string | null;
  usedCache: boolean;
  error?: string | null;
};

export type StartupStep = {
  name: string;
  status: "ok" | "skipped" | "warning" | "error" | "pending";
  detail?: string | null;
};

export type StartupResult = {
  steps: StartupStep[];
  canLaunch: boolean;
};

export type Game = {
  id: string;
  name: string;
  executable_path: string;
  working_dir?: string | null;
  launch_args: string[];
  enabled: boolean;
  tags: string[];
  launch_mode: "folder" | "vhd";
};
