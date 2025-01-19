// Pattern configuration object
const patternConfig = {
  // Base words that commonly appear in different combinations
  baseWords: {
    cookie: ["cookie", "cookies", "gdpr", "privacy", "consent"],
    action: ["accept", "agree", "continue", "got it", "ok", "yes", "customize"],
    site: ["site", "website", "page"],
    notice: ["notice", "banner", "policy", "settings"],
    signup: ["sign up", "signup", "subscribe", "newsletter", "register"],
  },

  // Language variations for common terms
  translations: {
    cookie: {
      es: ["galleta", "cookies", "política"],
      fr: ["cookie", "consentement"],
      de: ["cookie", "datenschutz", "zustimmen"],
      it: ["cookie", "consenso"],
      nl: ["cookie", "toestemming"],
    },
    privacy: {
      es: ["privacidad"],
      fr: ["confidentialité"],
      de: ["datenschutz"],
      it: ["privacy"],
      nl: ["privacy"],
    },
  },

  // Common combinations
  combinations: [
    "{cookie} {notice}",
    "{action} {cookie}",
    "{site} uses {cookie}",
    "we value your {privacy}",
  ],
};

// Dynamic pattern generator
const createPatterns = () => {
  const patterns = {};

  // Helper to create variations of a word
  const createVariations = (word) => {
    return [
      word,
      `${word}s?`,
      `${word}-?banner`,
      `${word}-?notice`,
      `${word}-?policy`,
    ];
  };

  // Helper to combine translations
  const getAllTranslations = (key) => {
    const translations = new Set(patternConfig.baseWords[key] || []);

    if (patternConfig.translations[key]) {
      Object.values(patternConfig.translations[key]).forEach((trans) => {
        trans.forEach((t) => translations.add(t));
      });
    }

    return Array.from(translations);
  };

  // Generate cookie patterns
  patterns.cookie = new RegExp(
    getAllTranslations("cookie").flatMap(createVariations).join("|"),
    "gi"
  );

  // Generate signup patterns
  patterns.signup = new RegExp(
    patternConfig.baseWords.signup
      .map((word) => word.replace(" ", "[ -]?"))
      .join("|"),
    "gi"
  );

  // Generate modal patterns
  patterns.modal = new RegExp(
    patternConfig.combinations
      .map((combo) => {
        let pattern = combo;
        Object.keys(patternConfig.baseWords).forEach((key) => {
          const words = getAllTranslations(key).join("|");
          pattern = pattern.replace(`{${key}}`, `(${words})`);
        });
        return pattern;
      })
      .join("|"),
    "gi"
  );

  // Generate button patterns
  patterns.buttons = new RegExp(
    patternConfig.baseWords.action
      .map((action) => action.replace(" ", "\\s+"))
      .join("|"),
    "gi"
  );

  return patterns;
};

const removeIntrusiveElements = () => {
  // Add protection for essential elements
  const PROTECTED_ELEMENTS =
    'body, html, head, main, #main, #root, #app, [role="main"]';

  // Enhanced selectors
  const commonSelectors = [
    '[class*="cookie"]',
    '[class*="consent"]',
    '[id*="cookie"]',
    '[id*="consent"]',
    '[class*="modal"]',
    '[class*="popup"]',
    '[class*="overlay"]',
    '[class*="dialog"]',
    '[class*="banner"]',
    '[class*="notice"]',
    '[aria-modal="true"]',
    '[role="dialog"]',
    '[aria-label*="cookie"]',
    '[aria-label*="consent"]',
    // Common fixed position elements
    'div[style*="position: fixed"]',
    'div[style*="position:fixed"]',
    'div[style*="z-index: 999"]',
  ].join(",");

  // Enhanced patterns with multilingual support
  const patterns = createPatterns();
  console.log({ patterns });

  // Add validation helper
  const isValidTarget = (el) => {
    if (!el || el.matches(PROTECTED_ELEMENTS)) return false;

    // Check element dimensions
    const rect = el.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    const elementArea = rect.width * rect.height;

    // Skip if element is too large (>50% of viewport)
    if (elementArea > viewportArea * 0.5) return false;

    return true;
  };

  // Throttle function
  const throttle = (func, limit) => {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => (inThrottle = false), limit);
      }
    };
  };

  // Update hideElement function
  const hideElement = (el) => {
    if (!isValidTarget(el)) return;

    // Skip if contains protected content
    if (el.querySelector(PROTECTED_ELEMENTS)) return;

    el.style.cssText = `
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
      height: 0 !important;
      width: 0 !important;
      position: absolute !important;
      z-index: -1 !important;
  `;
  };

  // Handle shadow DOM
  const checkShadowDOM = (element) => {
    if (element.shadowRoot) {
      const shadowElements =
        element.shadowRoot.querySelectorAll(commonSelectors);
      shadowElements.forEach(hideElement);
    }
  };

  // Main removal function
  // Update removeElements function
  const removeElements = () => {
    try {
      // Find elements by selectors
      document.querySelectorAll(commonSelectors).forEach((el) => {
        if (isValidTarget(el)) {
          hideElement(el);
        }
      });

      // Find elements by text content
      document
        .querySelectorAll(
          'div[role="dialog"], div[aria-modal="true"], .modal, .popup, [class*="cookie"]'
        )
        .forEach((el) => {
          if (!isValidTarget(el)) return;

          const text = el.textContent.toLowerCase();
          if (
            (patterns.cookie.test(text) && patterns.modal.test(text)) ||
            patterns.signup.test(text) ||
            patterns.buttons.test(text)
          ) {
            hideElement(el);

            // Check parents (max 2 levels)
            let parent = el.parentElement;
            let depth = 0;
            while (parent && depth < 2 && isValidTarget(parent)) {
              const style = window.getComputedStyle(parent);
              if (
                style.position === "fixed" ||
                style.position === "absolute" ||
                parseInt(style.zIndex) > 100
              ) {
                hideElement(parent);
              }
              checkShadowDOM(parent);
              parent = parent.parentElement;
              depth++;
            }
          }
        });

      // Handle iframes with safety check
      document.querySelectorAll("iframe").forEach((iframe) => {
        try {
          if (!isValidTarget(iframe)) return;
          const iframeDoc =
            iframe.contentDocument || iframe.contentWindow.document;
          iframeDoc
            .querySelectorAll(commonSelectors)
            .forEach((el) => isValidTarget(el) && hideElement(el));
        } catch (e) {}
      });
    } catch (error) {
      console.error("Cookie blocker error:", error);
    }
  };

  // Initial removal
  removeElements();

  // Watch for dynamic changes
  const observer = new MutationObserver(throttle(() => removeElements(), 100));
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.msg === "cookieBlockerChecked") {
    chrome.storage.sync.set({ blockCookies: true });
  }
  if (msg.msg === "cookieBlockerUnChecked") {
    chrome.storage.sync.set({ blockCookies: false });
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.blockCookies) {
    removeIntrusiveElements();
  }
});

removeIntrusiveElements();
