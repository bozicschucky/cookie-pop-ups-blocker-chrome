/**********************
 * Global State & Constants
 **********************/
let observerStarted = false;
const hiddenElements = new Set();
const removalQueue = new Set();
let removingElements = false;
let popUpCount = 0;
let extensionDisabled = false;

const domState = {
  originalOverflow: "",
  originalPosition: "",
  modifications: new Map(),
  scrollPosition: 0,
  isPageBroken: false,
  originalBodyStyles: null,
  originalHtmlStyles: null,
  scrollWasDisabled: false,
  bannerFound: false,
  lastScrollPosition: 0,
  initialScrollHeight: 0,
};

const DOM_HEALTH = {
  maxHeightReduction: 100,
  scrollCheckDelay: 250,
  recoveryAttempts: 2,
  debounceDelay: 50,
};

const PERFORMANCE = {
  batchSize: 35,
  maxElementsPerCycle: 150,
  cleanupInterval: 60000,
  processingDelay: 0,
  maxStoredElements: 1000,
};

const SCROLL_FIXES = {
  retryAttempts: 3,
  retryDelay: 100,
  properties: [
    "overflow",
    "overflow-x",
    "overflow-y",
    "position",
    "height",
    "min-height",
  ],
};

const SCORING_RULES = {
  positionScore: 2,
  highZIndexScore: 2,
  textMatchScore: 3,
  acceptWordScore: 1,
  buttonScore: 1,
  privacyLinkScore: 1,
  coverageScore: 2,
  threshold: 8.7,
};

const textPatterns = [
  "cookie",
  "cookies",
  "consent",
  "gdpr",
  "privacy",
  "accept",
  "agree",
  "banner",
  "modal",
  "policy",
];

const BANNER_HEURISTICS = {
  positions: ["fixed", "sticky", "absolute"],
  locations: ["top", "bottom"],
  maxHeight: window.innerHeight * 0.4,
  minTextLength: 30,
  minScore: 3,
};

const COOKIE_BANNER_SELECTORS = [
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="consent"]',
  '[id*="consent"]',
  '[class*="banner"]',
  '[class*="notice"]',
  ".cc-window",
  "#cookieConsent",
  ".cookie-notice",
  ".cookie-banner",
  ".cookie-message",
  "#gdpr-banner",
  ".gdpr-notice",
  "#onetrust-banner-sdk",
  ".cookieBar",
];

const PROTECTED_ELEMENTS = {
  selectors: [
    'form:not([class*="cookie"]):not([class*="consent"])',
    "nav, .navigation, .menu",
    'header:not([class*="cookie"]):not([class*="consent"])',
    '.sidebar:not([class*="cookie"]):not([class*="consent"])',
    "main, article, .content, #content",
    ".search-form, .search-bar",
    ".shopping-cart, .cart",
    '.modal:not([class*="cookie"]):not([class*="consent"])',
    ".login, .signup, .authentication",
    '[role="main"], [role="navigation"]',
    ".site-header, .main-header",
  ],
  classes: ["menu", "nav", "header", "content", "main", "footer"],
  roles: ["navigation", "main", "banner", "contentinfo", "search", "form"],
};

const COOKIE_PATTERNS = {
  text: [
    /\b(accept|agree|allow).{0,30}(cookies?|privacy|terms)/i,
    /\b(cookie|privacy|gdpr).{0,30}(notice|banner|consent|policy)/i,
    /\b(we use|this site uses).{0,30}(cookies?|tracking)/i,
    /\b(privacy|cookie).{0,30}(settings|preferences)/i,
  ],
  buttons: [
    /\b(accept|agree|allow|got it|ok|dismiss)\b/i,
    /\b(reject|decline|deny)\b/i,
    /\b(cookie|privacy).{0,20}(settings|preferences)\b/i,
  ],
  classes: [
    /(cookie|consent|privacy|gdpr)-?(banner|notice|popup|alert|dialog)/i,
    /cc-window|cookie-law|cookie-message/i,
  ],
  frameworks: [
    "#onetrust-banner-sdk",
    "#CybotCookiebotDialog",
    "#cmplz-cookie-banner",
    ".cc-window.cc-banner",
    "#cookieConsentContainer",
  ],
};

/**********************
 * Utility Functions
 **********************/
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**********************
 * DOM & Element Helpers
 **********************/
function saveElementState(element) {
  if (!domState.modifications.has(element)) {
    domState.modifications.set(element, {
      display: element.style.display,
      visibility: element.style.visibility,
      position: element.style.position,
      zIndex: element.style.zIndex,
    });
  }
}

function restoreElement(element) {
  const originalState = domState.modifications.get(element);
  if (originalState) {
    Object.assign(element.style, originalState);
    domState.modifications.delete(element);
    hiddenElements.delete(element);
  }
}

function checkDOMHealth() {
  const beforeHeight = document.documentElement.scrollHeight;
  const beforeScroll = window.scrollY;

  return new Promise((resolve) => {
    setTimeout(() => {
      const heightReduction =
        beforeHeight - document.documentElement.scrollHeight;
      const cantScroll = window.scrollY === beforeScroll && beforeScroll > 0;
      const noVerticalScroll =
        document.documentElement.scrollHeight <= window.innerHeight;
      const bodyHidden =
        window.getComputedStyle(document.body).display === "none";

      domState.isPageBroken =
        heightReduction > DOM_HEALTH.maxHeightReduction ||
        cantScroll ||
        noVerticalScroll ||
        bodyHidden;

      // Restore scroll if needed
      const scrollDisabled =
        window.getComputedStyle(document.body).overflow === "hidden" &&
        window.getComputedStyle(document.documentElement).overflow === "hidden";
      if (scrollDisabled) restoreScroll();

      resolve(domState.isPageBroken);
    }, DOM_HEALTH.scrollCheckDelay);
  });
}

async function recoverDOM() {
  console.warn("DOM recovery initiated");

  // Restore basic body and document settings
  document.body.style.overflow = domState.originalOverflow;
  document.body.style.position = domState.originalPosition;

  // Restore all modified elements
  for (const [element] of domState.modifications) {
    restoreElement(element);
  }
  domState.modifications.clear();
  hiddenElements.clear();
  window.scrollTo(0, domState.scrollPosition);

  return await checkDOMHealth();
}

/**********************
 * Scroll Management
 **********************/
function saveScrollState() {
  const body = document.body;
  const html = document.documentElement;
  domState.originalBodyStyles = SCROLL_FIXES.properties.reduce(
    (styles, prop) => {
      styles[prop] = body.style[prop];
      return styles;
    },
    {}
  );
  domState.originalHtmlStyles = SCROLL_FIXES.properties.reduce(
    (styles, prop) => {
      styles[prop] = html.style[prop];
      return styles;
    },
    {}
  );
}

function restoreScroll() {
  if (isDynamicPage()) return;
  const body = document.body;
  const html = document.documentElement;
  if (
    window.getComputedStyle(body).overflow === "hidden" ||
    window.getComputedStyle(html).overflow === "hidden"
  ) {
    body.style.cssText += `
      overflow: auto !important;
      overflow-x: auto !important;
      overflow-y: auto !important;
      position: static !important;
    `;
    html.style.cssText += `
      overflow: auto !important;
      overflow-x: auto !important;
      overflow-y: auto !important;
    `;
  }
}

function enableScroll() {
  const body = document.body;
  const html = document.documentElement;
  if (domState.scrollWasDisabled) {
    body.style.cssText += `
      overflow: auto !important;
      overflow-x: auto !important;
      overflow-y: auto !important;
      position: static !important;
    `;
    html.style.cssText += `
      overflow: auto !important;
      overflow-x: auto !important;
      overflow-y: auto !important;
    `;
  }
}

function isDynamicPage() {
  const initial =
    domState.initialScrollHeight || document.documentElement.scrollHeight;
  return document.documentElement.scrollHeight > initial * 1.1;
}

/**********************
 * Banner & Overlay Handling
 **********************/
function hideElementImmediately(element) {
  if (!element || hiddenElements.has(element) || extensionDisabled) return;

  const style = window.getComputedStyle(element);
  const isBannerOrOverlay =
    style.position === "fixed" || style.position === "absolute";
  const isLarge = isLargeOverlay(element); // Check if element is large overlay

  if (isBannerOrOverlay) {
    domState.bannerFound = true;
    domState.lastScrollPosition = window.scrollY;
    domState.scrollWasDisabled = isScrollDisabled();
  }
  saveElementState(element);

  // Hide element using multiple style overrides
  element.style.cssText = `
    display: none !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    position: absolute !important;
    z-index: -9999 !important;
    height: 0 !important;
    width: 0 !important;
    overflow: hidden !important;
    transform: scale(0) !important;
    max-height: 0 !important;
  `;
  hiddenElements.add(element);
  removalQueue.add(element);
  popUpCount++;

  if (isLarge && domState.scrollWasDisabled) {
    requestAnimationFrame(() => {
      enableScroll();
      if (domState.lastScrollPosition > 0) {
        window.scrollTo({ top: domState.lastScrollPosition, behavior: "auto" });
      }
    });
  }
}

function isScrollDisabled() {
  const bodyStyle = window.getComputedStyle(document.body);
  const htmlStyle = window.getComputedStyle(document.documentElement);
  return (
    bodyStyle.overflow === "hidden" ||
    htmlStyle.overflow === "hidden" ||
    bodyStyle.position === "fixed" ||
    htmlStyle.position === "fixed"
  );
}

function checkAndHide(el) {
  if (
    extensionDisabled ||
    !el ||
    hiddenElements.has(el) ||
    isEssentialElement(el)
  )
    return;
  const text = (el.textContent || "").toLowerCase();
  if (!/cookie|consent|privacy/.test(text)) return;

  const score =
    typeof calculateEnhancedScore === "function"
      ? calculateEnhancedScore(el)
      : scoreElement(el);
  if (score >= 7) {
    safeHideElement(el);
    removeLeftoverOverlays();
  }
}

function isEssentialElement(el) {
  const essentialTags = [
    "HTML",
    "BODY",
    "HEAD",
    "MAIN",
    "HEADER",
    "NAV",
    "ARTICLE",
  ];
  const essentialRoles = ["main", "navigation", "banner", "contentinfo"];
  return (
    !el ||
    essentialTags.includes(el.tagName) ||
    essentialRoles.includes(el.getAttribute("role")) ||
    el.id === "main" ||
    el.classList.contains("main")
  );
}

function isLargeOverlay(el) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return (
    rect.width >= window.innerWidth * 0.5 &&
    rect.height >= window.innerHeight * 0.3 &&
    (style.position === "fixed" || style.position === "absolute") &&
    parseInt(style.zIndex, 10) > 800
  );
}

function scoreElement(el) {
  if (isEssentialElement(el)) return 0;

  let score = 0;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const text = (el.textContent || "").toLowerCase();

  if (["fixed", "absolute"].includes(style.position))
    score += SCORING_RULES.positionScore;
  if (parseInt(style.zIndex, 10) > 800) score += SCORING_RULES.highZIndexScore;
  if (textPatterns.some((p) => text.includes(p)))
    score += SCORING_RULES.textMatchScore;
  if (text.includes("accept")) score += SCORING_RULES.acceptWordScore;
  if (el.querySelector('button, [role="button"]'))
    score += SCORING_RULES.buttonScore;
  if (el.querySelector('a[href*="privacy"]'))
    score += SCORING_RULES.privacyLinkScore;

  const coversEnough =
    rect.width >= window.innerWidth * 0.5 &&
    rect.height >= window.innerHeight * 0.3;
  if (coversEnough) score += SCORING_RULES.coverageScore;

  return score;
}

function calculateBannerScore(element) {
  let score = 0;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const text = (element.textContent || "").toLowerCase();

  if (isBannerPosition(style)) score += 2;
  if (rect.height < BANNER_HEURISTICS.maxHeight) score += 1;
  if (text.length >= BANNER_HEURISTICS.minTextLength) {
    const cookieTerms = textPatterns.filter((term) => text.includes(term));
    score += cookieTerms.length * 0.5;
    if (
      element.querySelectorAll(
        'button, [role="button"], .button, input[type="button"]'
      ).length
    )
      score += 1;
    if (element.querySelectorAll('input[type="checkbox"]').length) score += 0.5;
    const hasPrivacyLinks = Array.from(element.querySelectorAll("a")).some(
      (a) =>
        a.textContent.toLowerCase().includes("privacy") ||
        a.href.toLowerCase().includes("privacy") ||
        /polic(y|ies)/.test(a.href.toLowerCase()) ||
        /cookies?/.test(a.href.toLowerCase())
    );
    if (hasPrivacyLinks) score += 1;
  }
  return score;
}

function isBannerPosition(style) {
  const isTop = style.top === "0px" || parseInt(style.top) === 0;
  const isBottom = style.bottom === "0px" || parseInt(style.bottom) === 0;
  return (
    BANNER_HEURISTICS.positions.includes(style.position) && (isTop || isBottom)
  );
}

function removeLeftoverOverlays() {
  if (!domState.originalBodyStyles) saveScrollState();

  // Force reset scroll-blocking styles on both body and html
  const body = document.body;
  const html = document.documentElement;

  // Reset all potential scroll-blocking styles
  const scrollResetStyles = `
    overflow: auto !important;
    overflow-x: auto !important;
    overflow-y: auto !important;
    position: static !important;
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
  `;

  let overlayRemoved = false; // Flag to track if any large overlay was removed
  body.style.cssText += scrollResetStyles;
  html.style.cssText += scrollResetStyles;

  // Remove overlays
  document.querySelectorAll("*").forEach((el) => {
    if (isLargeOverlay(el)) {
      el.style.display = "none";
      overlayRemoved = true;
      // Force scroll reset immediately after hiding each overlay
      if (isScrollDisabled()) {
        body.style.cssText += scrollResetStyles;
        html.style.cssText += scrollResetStyles;
      }
    }
  });

  // Final scroll restoration check
  if (overlayRemoved && (domState.scrollWasDisabled || isScrollDisabled())) {
    requestAnimationFrame(() => {
      body.style.cssText += scrollResetStyles;
      html.style.cssText += scrollResetStyles;

      // Restore scroll position if needed
      if (domState.lastScrollPosition > 0) {
        window.scrollTo({
          top: domState.lastScrollPosition,
          behavior: "auto",
        });
      }
    });
  }
}

/**********************
 * Enhanced Hiding: Protected & Scoring
 **********************/
function isProtectedElement(element) {
  if (
    PROTECTED_ELEMENTS.selectors.some((selector) => element.matches(selector))
  )
    return true;
  if (PROTECTED_ELEMENTS.classes.some((cls) => element.classList.contains(cls)))
    return true;
  const role = element.getAttribute("role");
  if (role && PROTECTED_ELEMENTS.roles.includes(role)) return true;
  if (element.tagName === "FORM" || element.querySelector("form")) {
    if (element.querySelectorAll('input:not([type="button"])').length > 0)
      return true;
  }
  if (isMainNavigation(element) || isMainContent(element)) return true;
  return false;
}

function isMainNavigation(element) {
  return (
    element.querySelector("nav") || element.querySelectorAll("a").length > 5
  );
}

function isMainContent(element) {
  return element.id === "main" || element.classList.contains("main");
}

function calculateEnhancedScore(element) {
  if (isProtectedElement(element)) return 0;
  let score = 0;
  const text = (element.textContent || "").toLowerCase();
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);

  if (isOverlayPosition(computedStyle)) score += 2;
  if (hasHighZIndex(computedStyle)) score += 1;
  if (containsCookiePatterns(text)) score += 3;
  if (hasConsentButtons(element)) score += 2;
  if (hasPrivacyLinks(element)) score += 1;
  if (isCookieBannerFramework(element)) score += 4;
  if (isBannerShaped(rect)) score += 1;
  if (isReasonableSize(rect)) score += 1;
  return score;
}

function isOverlayPosition(style) {
  return ["fixed", "absolute"].includes(style.position);
}

function hasHighZIndex(style) {
  return parseInt(style.zIndex, 10) > 800;
}

function containsCookiePatterns(text) {
  return COOKIE_PATTERNS.text.some((pattern) => pattern.test(text));
}

function hasConsentButtons(element) {
  const buttons = element.querySelectorAll('button, [role="button"], .button');
  return Array.from(buttons).some((button) =>
    COOKIE_PATTERNS.buttons.some((pattern) =>
      pattern.test(button.textContent || "")
    )
  );
}

function hasPrivacyLinks(element) {
  return !!element.querySelector('a[href*="privacy"]');
}

function isCookieBannerFramework(element) {
  return COOKIE_PATTERNS.frameworks.some((selector) =>
    element.matches(selector)
  );
}

function isBannerShaped(rect) {
  return rect.width / rect.height < 4;
}

function isReasonableSize(rect) {
  return rect.width > 100 && rect.height > 50;
}

function safeHideElement(element) {
  if (!element || isProtectedElement(element)) return;
  const score = calculateEnhancedScore(element);
  if (score < 7) return;

  const originalStyles = {
    display: element.style.display,
    visibility: element.style.visibility,
    position: element.style.position,
    zIndex: element.style.zIndex,
  };

  element.style.cssText = `
    display: none !important;
    visibility: hidden !important;
  `;

  // Verify layout isn’t broken and restore if necessary
  setTimeout(() => {
    const didBreakLayout = false; // Placeholder: implement layout check if needed
    if (didBreakLayout) {
      Object.assign(element.style, originalStyles);
    } else {
      hiddenElements.add(element);
    }
  }, 50);
}

/**********************
 * Batch Processing & Memory Management
 **********************/
function batchProcessElements(elements, processor) {
  const batches = [];
  for (let i = 0; i < elements.length; i += PERFORMANCE.batchSize) {
    batches.push(Array.from(elements).slice(i, i + PERFORMANCE.batchSize));
  }
  let processed = 0;
  function processBatch() {
    if (batches.length === 0) return;
    const batch = batches.shift();
    batch.forEach((element) => {
      if (processed < PERFORMANCE.maxElementsPerCycle) {
        processor(element);
        processed++;
      }
    });
    if (batches.length > 0)
      setTimeout(processBatch, PERFORMANCE.processingDelay);
  }
  processBatch();
}

const processRemovalQueue = debounce(() => {
  if (removingElements || removalQueue.size === 0) return;
  removingElements = true;
  try {
    Array.from(removalQueue).forEach((element) => {
      if (!hiddenElements.has(element)) {
        element.style.display = "none";
        hiddenElements.add(element);
      }
    });
    removalQueue.clear();
  } finally {
    removingElements = false;
  }
}, 0);

function performMemoryCleanup() {
  const now = Date.now();
  if (now - lastCleanupTime < PERFORMANCE.cleanupInterval) return;

  if (domState.modifications.size > PERFORMANCE.maxStoredElements * 1.5) {
    const entriesToRemove = Array.from(domState.modifications.entries()).slice(
      0,
      domState.modifications.size - PERFORMANCE.maxStoredElements
    );
    entriesToRemove.forEach(([key]) => domState.modifications.delete(key));
  }
  if (hiddenElements.size > PERFORMANCE.maxStoredElements * 2) {
    const excess = Array.from(hiddenElements).slice(
      0,
      hiddenElements.size - PERFORMANCE.maxStoredElements
    );
    excess.forEach((el) => hiddenElements.delete(el));
  }
  lastCleanupTime = now;
}

/**********************
 * DOM Mutation Observer
 **********************/
const observer = new MutationObserver(
  throttle((mutations) => {
    if (removingElements) return;
    const validMutations = mutations
      .filter((mutation) => {
        const target = mutation.target;
        return (
          !hiddenElements.has(target) &&
          !Array.from(hiddenElements).some((hidden) => hidden.contains(target))
        );
      })
      .slice(0, PERFORMANCE.maxElementsPerCycle);

    if (validMutations.length === 0) return;
    batchProcessElements(validMutations, (mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            checkAndHide(node);
            batchProcessElements(node.querySelectorAll("*"), checkAndHide);
          }
        });
      } else if (mutation.type === "attributes") {
        checkAndHide(mutation.target);
      }
    });
    detectSimpleCookieBanner();
  }, PERFORMANCE.processingDelay)
);

function detectSimpleCookieBanner() {
  if (removingElements) return;
  COOKIE_BANNER_SELECTORS.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((element) => {
        if (!hiddenElements.has(element) && !isEssentialElement(element)) {
          const text = (element.textContent || "").toLowerCase();
          if (/cookie|consent|privacy/.test(text))
            hideElementImmediately(element);
        }
      });
    } catch (e) {
      console.warn("Selector error:", selector, e);
    }
  });
  document
    .querySelectorAll("div, section, aside, footer")
    .forEach((element) => {
      if (!hiddenElements.has(element) && !isEssentialElement(element)) {
        const text = (element.textContent || "").toLowerCase();
        if (/cookie|consent|privacy/.test(text)) {
          const score = calculateBannerScore(element);
          if (
            score >= BANNER_HEURISTICS.minScore &&
            !isMainNavigation(element) &&
            !element.querySelectorAll("*").length > 50
          )
            hideElementImmediately(element);
        }
      }
    });
  removeLeftoverOverlays();
}

/**********************
 * Runtime Messaging & Initialization
 **********************/
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.msg === "getPopUpCount") sendResponse({ count: popUpCount });
  else if (message.msg === "disableExtension") extensionDisabled = true;
  else if (message.msg === "enableExtension") {
    extensionDisabled = false;
    initializeExtension();
  }
});

function initializeExtension() {
  if (observerStarted) return;
  domState.originalOverflow = document.body.style.overflow;
  domState.originalPosition = document.body.style.position;
  domState.bannerFound = false;
  domState.scrollWasDisabled = isScrollDisabled();
  domState.initialScrollHeight = document.documentElement.scrollHeight;

  detectSimpleCookieBanner();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style", "class", "id"],
    characterData: true,
  });

  const initialElements = Array.from(document.querySelectorAll("*")).slice(
    0,
    PERFORMANCE.maxElementsPerCycle * 2
  );
  batchProcessElements(initialElements, checkAndHide);

  setTimeout(detectSimpleCookieBanner, 100);
  setTimeout(() => {
    detectSimpleCookieBanner();
    processRemovalQueue();
    removeLeftoverOverlays();
  }, 500);
  observerStarted = true;
}

window.addEventListener("load", () => {
  initializeExtension();
  [0, 100, 500, 1000, 2000].forEach((delay) => {
    setTimeout(() => {
      detectSimpleCookieBanner();
      processRemovalQueue();
    }, delay);
  });
});

window.addEventListener("unload", () => {
  observer.disconnect();
  hiddenElements.clear();
});
