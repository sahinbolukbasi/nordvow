export const THEME_KEY = "infl-theme";
/** Kök düzende <head> içine: kayıtlı temayı (yoksa varsayılan beyaz/açık temayı) boyamadan önce uygular. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(!t){t="light"}document.documentElement.dataset.theme=t}catch(e){}})();`;
