(function () {
  const STORAGE_KEY = 'langOverride';
  const SUPPORTED = ['en', 'fr'];
  let defaultsCaptured = false;

  function markI18nReady() {
    document.documentElement.setAttribute('data-i18n-ready', '1');
    document.documentElement.removeAttribute('data-i18n-block');
  }

  function normaliseLanguage(value) {
    if (!value || typeof value !== 'string') return null;
    const lower = value.toLowerCase();
    if (lower.startsWith('fr')) return 'fr';
    if (lower.startsWith('en')) return 'en';
    return null;
  }

  function getPreferredLanguage() {
    try {
      const override = localStorage.getItem(STORAGE_KEY);
      const normalisedOverride = normaliseLanguage(override);
      if (normalisedOverride && SUPPORTED.includes(normalisedOverride)) {
        return normalisedOverride;
      }
    } catch (e) {
      // Ignore localStorage access issues.
    }

    const langs = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || 'en'];

    for (const lang of langs) {
      const normalised = normaliseLanguage(lang);
      if (normalised && SUPPORTED.includes(normalised)) {
        return normalised;
      }
    }

    return 'en';
  }

  function setLanguageOverride(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      // Ignore localStorage access issues.
    }
  }

  function updateLangSelect() {
    const select = document.querySelector('.lang-select');
    if (select) {
      select.value = window.i18next.language;
    }
  }

  function captureDefaultDomValues() {
    if (defaultsCaptured) {
      return;
    }

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (!el.hasAttribute('data-i18n-default')) {
        el.setAttribute('data-i18n-default', el.textContent);
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      if (!el.hasAttribute('data-i18n-placeholder-default')) {
        const value = el.getAttribute('placeholder') || '';
        el.setAttribute('data-i18n-placeholder-default', value);
      }
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      if (!el.hasAttribute('data-i18n-aria-label-default')) {
        const value = el.getAttribute('aria-label') || '';
        el.setAttribute('data-i18n-aria-label-default', value);
      }
    });

    defaultsCaptured = true;
  }

  function translateDom() {
    const t = window.i18next.t.bind(window.i18next);

    document.documentElement.lang = window.i18next.language;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (window.i18next.exists(key)) {
        el.textContent = t(key);
      } else {
        const fallback = el.getAttribute('data-i18n-default');
        if (fallback !== null) {
          el.textContent = fallback;
        }
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (window.i18next.exists(key)) {
        el.setAttribute('placeholder', t(key));
      } else {
        const fallback = el.getAttribute('data-i18n-placeholder-default');
        if (fallback !== null) {
          el.setAttribute('placeholder', fallback);
        }
      }
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (window.i18next.exists(key)) {
        el.setAttribute('aria-label', t(key));
      } else {
        const fallback = el.getAttribute('data-i18n-aria-label-default');
        if (fallback !== null) {
          el.setAttribute('aria-label', fallback);
        }
      }
    });

    updateLangSelect();
  }

  function waitForDom() {
    if (document.readyState === 'loading') {
      return new Promise((resolve) => {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      });
    }
    return Promise.resolve();
  }

  async function initI18n() {
    if (!window.i18next || !window.i18nextHttpBackend) {
      window.t = function (_key, options = {}) {
        return options.defaultValue || '';
      };
      markI18nReady();
      return;
    }

    try {
      await waitForDom();
      captureDefaultDomValues();

      const initialLanguage = getPreferredLanguage();

      await window.i18next
        .use(window.i18nextHttpBackend)
        .init({
          lng: initialLanguage,
          fallbackLng: 'en',
          supportedLngs: SUPPORTED,
          load: 'languageOnly',
          backend: {
            loadPath: './locales/{{lng}}/translation.json'
          },
          interpolation: {
            escapeValue: false
          }
        });

      window.t = function (key, options) {
        return window.i18next.t(key, options);
      };

      translateDom();

      const langSelect = document.querySelector('.lang-select');
      if (langSelect) {
        langSelect.addEventListener('change', async () => {
          const nextLang = normaliseLanguage(langSelect.value) || 'en';
          await window.i18next.changeLanguage(nextLang);
          setLanguageOverride(nextLang);
        });
      }

      window.i18next.on('languageChanged', () => {
        translateDom();
        document.dispatchEvent(new CustomEvent('i18n:languageChanged'));
      });

      document.dispatchEvent(new CustomEvent('i18n:ready'));
    } finally {
      markI18nReady();
    }
  }

  window.i18nReadyPromise = initI18n();
})();
