export type StartupStep = {
  name: string;
  status: "pending" | "running" | "ok" | "skipped" | "warning" | "error";
  detail?: string | null;
};

export type StartupResult = {
  steps: StartupStep[];
  canLaunch: boolean;
};
