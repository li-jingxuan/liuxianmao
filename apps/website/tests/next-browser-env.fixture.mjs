// Next normally replaces these constants when compiling next/link. The standalone
// Vite fixtures use the same defaults as next.config.ts (no basePath or i18n).
// Keep the real Link implementation; do not replace browser process.env wholesale.
export const nextBrowserDefines = {
  "process.env.__NEXT_ROUTER_BASEPATH": JSON.stringify(""),
  "process.env.__NEXT_I18N_SUPPORT": "false",
  "process.env.__NEXT_TRAILING_SLASH": "false",
  "process.env.__NEXT_MANUAL_TRAILING_SLASH": "false",
  "process.env.__NEXT_MANUAL_CLIENT_BASE_PATH": "false",
  "process.env.__NEXT_LINK_NO_TOUCH_START": "false",
};
