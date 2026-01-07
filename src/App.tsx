import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "./api/tauri";
import type { StartupResult, StartupStep } from "./types/iris";

type StepStatus = "pending" | "running" | "ok" | "warning" | "error" | "skipped";

type UiStep = {
  key: string;
  status: StepStatus;
  detail?: string | null;
};

const STEP_KEYS = [
  "steps.auth",
  "steps.update",
  "steps.confirm",
  "steps.vhd",
  "steps.launch"
];

const BOOT_STEPS: UiStep[] = STEP_KEYS.map((key) => ({
  key,
  status: "pending"
}));

function normalizeStep(fallback: UiStep, step: StartupStep | undefined): UiStep {
  if (!step) {
    return { ...fallback, status: "ok" };
  }
  return {
    key: fallback.key,
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
  const { t, i18n } = useTranslation();
  const [steps, setSteps] = useState<UiStep[]>(BOOT_STEPS);
  const [statusText, setStatusText] = useState(t("status.ready"));
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const intervalRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  const pendingResultRef = useRef<StartupResult | null>(null);
  const pendingErrorRef = useRef<string | null>(null);

  useEffect(() => {
    setStatusText(t("status.ready"));
  }, [i18n.language, t]);

  useEffect(() => {
    const init = async () => {
      try {
        await getCurrentWindow().setFullscreen(true);
      } catch {
        // Ignore fullscreen failures in dev.
      }
      startBoot();
    };

    init();

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, []);

  const applyFinalResult = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (pendingErrorRef.current) {
      const message = pendingErrorRef.current;
      setBootError(message);
      setStatusText(t("status.failed"));
      setSteps((prev) =>
        prev.map((step, index) =>
          index === prev.length - 1
            ? { ...step, status: "error", detail: t("status.failed") }
            : { ...step, status: "warning" }
        )
      );
      setBooting(false);
      return;
    }

    const result = pendingResultRef.current;
    if (!result) {
      return;
    }

    const finalSteps = BOOT_STEPS.map((step, index) =>
      normalizeStep(step, result.steps?.[index])
    );
    setSteps(finalSteps);
    const hasError = finalSteps.some((step) => step.status === "error");
    setStatusText(hasError ? t("status.failed") : t("status.done"));
    setBooting(false);
  };

  const applyStubProgress = () => {
    if (indexRef.current >= BOOT_STEPS.length) {
      setSteps((prev) =>
        prev.map((step, index) =>
          index < BOOT_STEPS.length - 1
            ? { ...step, status: "ok" }
            : { ...step, status: "running" }
        )
      );
      setStatusText(t("status.finishing"));
      if (pendingResultRef.current || pendingErrorRef.current) {
        applyFinalResult();
      }
      return;
    }

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

    const stepLabel = STEP_KEYS[indexRef.current]
      ? t(STEP_KEYS[indexRef.current])
      : t("status.working");
    setStatusText(stepLabel);

    if (indexRef.current < BOOT_STEPS.length) {
      indexRef.current += 1;
    }
  };

  const startBoot = () => {
    setBooting(true);
    setBootError(null);
    setSteps(BOOT_STEPS);
    setStatusText(t("status.ready"));
    indexRef.current = 0;
    pendingResultRef.current = null;
    pendingErrorRef.current = null;

    applyStubProgress();
    intervalRef.current = window.setInterval(applyStubProgress, 5000);

    const runFlow = async () => {
      try {
        const result = await invokeCmd<StartupResult>("run_startup_flow_cmd");
        pendingResultRef.current = result;
      } catch (err) {
        pendingErrorRef.current = err instanceof Error ? err.message : t("status.failed");
      }

      if (indexRef.current >= BOOT_STEPS.length) {
        applyFinalResult();
      }
    };

    void runFlow();
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
            <div className="boot-brand">{t("brand.title")}</div>
            <div className="boot-tag">{t("brand.tag")}</div>
          </div>
        </div>

        <div className="boot-bottom">
          <div className="boot-arc" />
          <div className="boot-content">
            <img className="logo" src="/rinz.svg" alt="RinZ" />

            <div className="step-focus">
              <div className="step-index">{t("status.stepLabel", { index: currentIndex + 1 })}</div>
              <div className="step-title">
                {currentStep ? t(currentStep.key) : statusText}
              </div>
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
            {!booting && !bootError && <div className="boot-done">{t("status.idle")}</div>}
          </div>
        </div>
      </div>

      <div className="boot-shell-landscape">
        <div className="landscape-card">
          <div className="landscape-brand-row">
            <img className="logo logo-landscape" src="/rinz.svg" alt="RinZ" />
            <div>
              <div className="landscape-title">{t("brand.title")}</div>
              <div className="landscape-tag">{t("brand.tag")}</div>
            </div>
          </div>

          <div className="step-focus">
            <div className="step-index">{t("status.stepLabel", { index: currentIndex + 1 })}</div>
            <div className="step-title">
              {currentStep ? t(currentStep.key) : statusText}
            </div>
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
          {!booting && !bootError && <div className="boot-done">{t("status.idle")}</div>}
        </div>
      </div>
    </div>
  );
}
