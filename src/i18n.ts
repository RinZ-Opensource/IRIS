import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "zh",
    supportedLngs: ["zh", "en"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["navigator", "htmlTag"],
      caches: []
    },
    resources: {
      zh: {
        translation: {
          brand: {
            title: "IRIS",
            tag: "Interactive RinZ Interface System"
          },
          steps: {
            auth: "验证机台授权状态",
            update: "检查机台更新",
            confirm: "确认启动配置",
            vhd: "解密挂载游戏 VHD",
            launch: "启动游戏"
          },
          status: {
            stepLabel: "STEP {{index}}",
            ready: "准备启动",
            working: "执行中",
            finishing: "即将完成",
            failed: "启动失败",
            done: "启动完成",
            idle: "待机中"
          }
        }
      },
      en: {
        translation: {
          brand: {
            title: "IRIS",
            tag: "Interactive RinZ Interface System"
          },
          steps: {
            auth: "Verify machine authorization",
            update: "Check machine updates",
            confirm: "Confirm launch config",
            vhd: "Decrypt and mount game VHD",
            launch: "Launch game"
          },
          status: {
            stepLabel: "STEP {{index}}",
            ready: "Preparing",
            working: "Working",
            finishing: "Finishing",
            failed: "Boot failed",
            done: "Boot complete",
            idle: "Idle"
          }
        }
      }
    }
  });

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.language;
  i18n.on("languageChanged", (lng) => {
    document.documentElement.lang = lng;
  });
}

export default i18n;
