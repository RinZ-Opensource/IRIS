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
            decrypt: "解密游戏 VHD",
            mount: "挂载游戏 VHD",
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
          },
          errors: {
            machineUnauthorized: "机台未授权",
            updateUnavailable: "更新服务不可用",
            confirmRequired: "启动配置未确认",
            decryptFailed: "解密失败",
            mountFailed: "挂载失败",
            launchFailed: "启动失败",
            gameNotFound: "未找到游戏",
            unexpectedGameFailure: "无法预计的游戏程序失败",
            bannedUser: "被封禁的用户",
            smgunge: "检测到 SMGUNGE",
            incompatibleInputDevice: "不兼容的输入设备",
            generic: "启动失败"
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
            decrypt: "Decrypt game VHD",
            mount: "Mount game VHD",
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
          },
          errors: {
            machineUnauthorized: "Machine unauthorized",
            updateUnavailable: "Update service unavailable",
            confirmRequired: "Launch config not confirmed",
            decryptFailed: "Decryption failed",
            mountFailed: "Mount failed",
            launchFailed: "Launch failed",
            gameNotFound: "Game not found",
            unexpectedGameFailure: "Unexpected game failure",
            bannedUser: "Banned User",
            incompatibleInputDevice: "Incompatible input device",
            generic: "Boot failed"
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
