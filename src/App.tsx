import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invokeCmd } from "./api/tauri";
import type { StartupResult, StartupStep } from "./types/iris";

type StepStatus = "pending" | "running" | "ok" | "warning" | "error" | "skipped";

type UiStep = {
  name: string;
  status: StepStatus;
  detail?: string | null;
};

const STEP_NAMES = [
  "验证机台授权状态",
  "检查机台更新",
  "确认启动配置",
  "解密挂载游戏 VHD",
  "启动游戏"
];

const BOOT_STEPS: UiStep[] = STEP_NAMES.map((name) => ({
  name,
  status: "pending"
}));

function normalizeStep(fallback: UiStep, step: StartupStep | undefined): UiStep {
  if (!step) {
    return { ...fallback, status: "ok" };
  }
  return {
    name: fallback.name,
    status: (step.status as StepStatus) ?? "ok",
    detail: step.detail ?? null
  };
}

function resolveCurrentIndex(steps: UiStep[]) {
  const runningIndex = steps.findIndex((step) => step.status === "running");
  if (runningIndex >= 0) {
    return runningIndex;
  }
  const pendingIndex = steps.findIndex((step) => step.status === "pending");
  if (pendingIndex >= 0) {
    return pendingIndex;
  }
  return Math.max(steps.length - 1, 0);
}

export default function App() {
  const [steps, setSteps] = useState<UiStep[]>(BOOT_STEPS);
  const [statusText, setStatusText] = useState("准备启动");
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const intervalRef = useRef<number | null>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    const init = async () => {
      try {
        await getCurrentWindow().setFullscreen(true);
      } catch {
        // Ignore fullscreen failures in dev.
      }
      await startBoot();
    };

    init();

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  const applyStubProgress = () => {
    setSteps((prev) =>
      prev.map((step, index) => {
        if (index < indexRef.current) {
          return { ...step, status: "ok" };
        }
        if (index === indexRef.current) {
          return { ...step, status: "running" };
        }
        return { ...step, status: "pending" };
      })
    );

    setStatusText(STEP_NAMES[indexRef.current] ?? "执行中");

    if (indexRef.current < BOOT_STEPS.length - 1) {
      indexRef.current += 1;
    }
  };

  const startBoot = async () => {
    setBooting(true);
    setBootError(null);
    setSteps(BOOT_STEPS);
    indexRef.current = 0;
    applyStubProgress();
    intervalRef.current = window.setInterval(applyStubProgress, 5000);

    try {
      const result = await invokeCmd<StartupResult>("run_startup_flow_cmd");
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      const finalSteps = BOOT_STEPS.map((step, index) =>
        normalizeStep(step, result.steps?.[index])
      );
      setSteps(finalSteps);
      const hasError = finalSteps.some((step) => step.status === "error");
      setStatusText(hasError ? "启动失败" : "启动完成");
    } catch (err) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
      setBootError(err instanceof Error ? err.message : "启动失败");
      setStatusText("启动失败");
      setSteps((prev) =>
        prev.map((step, index) =>
          index === prev.length - 1
            ? { ...step, status: "error", detail: "启动失败" }
            : { ...step, status: "warning" }
        )
      );
    } finally {
      setBooting(false);
    }
  };

  const currentIndex = useMemo(() => resolveCurrentIndex(steps), [steps]);
  const currentStep = steps[currentIndex];
  const progressPercent = useMemo(() => {
    if (steps.length <= 1) {
      return 100;
    }
    return Math.round((currentIndex / (steps.length - 1)) * 100);
  }, [currentIndex, steps.length]);

  return (
    <div className="boot-shell">
      <div className="boot-shell-portrait">
        <div className="boot-top">
          <div>
            <div className="boot-brand">IRIS</div>
            <div className="boot-tag">RINZ ARCADE SYSTEM</div>
          </div>
        </div>

        <div className="boot-bottom">
          <div className="boot-arc" />
          <div className="boot-content">
            <img className="logo" src="/rinz.svg" alt="RinZ" />

            <div className="step-focus">
              <div className="step-index">STEP {currentIndex + 1}</div>
              <div className="step-title">{currentStep?.name ?? statusText}</div>
            </div>

            <div className="progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="progress-meta">
                <span>{progressPercent}%</span>
                <span>{currentStep?.detail ?? statusText}</span>
              </div>
            </div>

            {bootError && <div className="boot-error">{bootError}</div>}
            {!booting && !bootError && <div className="boot-done">待机中</div>}
          </div>
        </div>
      </div>

      <div className="boot-shell-landscape">
        <div className="landscape-card">
          <div className="landscape-brand-row">
            <img className="logo logo-landscape" src="/rinz.svg" alt="RinZ" />
            <div>
              <div className="landscape-title">IRIS</div>
              <div className="landscape-tag">RINZ ARCADE SYSTEM</div>
            </div>
          </div>

          <div className="step-focus">
            <div className="step-index">STEP {currentIndex + 1}</div>
            <div className="step-title">{currentStep?.name ?? statusText}</div>
          </div>

          <div className="progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="progress-meta">
              <span>{progressPercent}%</span>
              <span>{currentStep?.detail ?? statusText}</span>
            </div>
          </div>

          {bootError && <div className="boot-error">{bootError}</div>}
          {!booting && !bootError && <div className="boot-done">待机中</div>}
        </div>
      </div>
    </div>
  );
}
