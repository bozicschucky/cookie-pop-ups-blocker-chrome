let observerStarted = false;
const hiddenElements = new Set();

// Track DOM state and modifications
const domState = {
  originalOverflow: '',
  originalPosition: '',
  modifications: new Map(), // Store original styles of modified elements
  scrollPosition: 0,
  isPageBroken: false,
  originalBodyStyles: null,
  originalHtmlStyles: null,
  scrollEnabled: true,
  lastScrollPosition: 0,
  bannerFound: false,
  scrollWasDisabled: false
};

// DOM health check parameters
const DOM_HEALTH = {
  maxHeightReduction: 100, // max pixels the document height should reduce by
  scrollCheckDelay: 250,   // ms to wait before checking scroll
  recoveryAttempts: 2,     // number of times to try recovery
  checkDuration: 1000,     // ms to monitor for issues
  debounceDelay: 50,       // Debounce delay for multiple operations
  removalTimeout: 150      // Time to wait before confirming removal
};

// Performance optimization constants
const PERFORMANCE = {
  batchSize: 35,          // Increased for better initial detection
  maxElementsPerCycle: 150, // Increased to catch more elements
  cleanupInterval: 60000,  // Increased to 60s to reduce interference
  processingDelay: 0,    // Changed to 0 for immediate processing
  queryTimeout: 0,     // Reduced timeout
  maxStoredElements: 1000, // Increased to prevent premature cleanup
  initialScanDelay: 0,   // Changed to 0 for immediate scan
  criticalScanDelay: 100, // Reduced delay
  forcedRemovalDelay: 50 // New constant for forced removal
};

// Add removal tracking
const removalQueue = new Set();
let removingElements = false;

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Enhance element removal with immediate visual hiding
function hideElementImmediately(element) {
  if (!element || hiddenElements.has(element)) return;
  
  const style = window.getComputedStyle(element);
  const isBannerOrOverlay = style.position === 'fixed' || style.position === 'absolute';
  
  // Only save scroll state if we found a banner/overlay
  if (isBannerOrOverlay) {
    domState.bannerFound = true;
    domState.lastScrollPosition = window.scrollY;
    domState.scrollWasDisabled = isScrollDisabled();
  }
  
  saveElementState(element);
  
  // Force hide with multiple methods
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
  
  // Only restore scroll if banner was affecting scroll
  if (isBannerOrOverlay && domState.scrollWasDisabled) {
    requestAnimationFrame(() => {
      enableScroll();
      if (domState.lastScrollPosition > 0) {
        window.scrollTo({
          top: domState.lastScrollPosition,
          behavior: 'auto'
        });
      }
    });
  }
}

function isScrollDisabled() {
  const body = document.body;
  const html = document.documentElement;
  const bodyStyle = window.getComputedStyle(body);
  const htmlStyle = window.getComputedStyle(html);
  
  return bodyStyle.overflow === 'hidden' || 
         htmlStyle.overflow === 'hidden' ||
         bodyStyle.position === 'fixed' ||
         htmlStyle.position === 'fixed';
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

const processRemovalQueue = debounce(() => {
  if (removingElements || removalQueue.size === 0) return;
  removingElements = true;

  try {
    Array.from(removalQueue).forEach(element => {
      if (!hiddenElements.has(element)) {
        element.style.display = 'none';
        hiddenElements.add(element);
      }
    });
    removalQueue.clear();
  } finally {
    removingElements = false;
  }
}, 0);

// Heuristic-based scoring criteria for identifying cookie consent overlays
const SCORING_RULES = {
  positionScore: 2, // Score for fixed/absolute position
  highZIndexScore: 2, // Score for zIndex > 800
  textMatchScore: 3, // Score for encountering certain cookie/consent words
  acceptWordScore: 1, // Additional score if text includes "accept"
  buttonScore: 1, // Having a button boosts score
  privacyLinkScore: 1, // Having a privacy link
  coverageScore: 2, // Large coverage on screen
  threshold: 8.7, // Hide if total score >= threshold
};

// A broad range of words that might indicate cookie consent
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

// Cookie banner detection heuristics
const BANNER_HEURISTICS = {
  positions: ['fixed', 'sticky', 'absolute'],
  locations: ['top', 'bottom'],
  maxHeight: window.innerHeight * 0.4,
  minTextLength: 30,
  minScore: 3
};

function isBannerPosition(style) {
  const position = style.position;
  const isBottom = style.bottom === '0px' || parseInt(style.bottom) === 0;
  const isTop = style.top === '0px' || parseInt(style.top) === 0;
  
  return BANNER_HEURISTICS.positions.includes(position) && (isTop || isBottom);
}

function calculateBannerScore(element) {
  let score = 0;
  const style = window.getComputedStyle(element);
  const text = element.textContent?.toLowerCase() || '';
  const rect = element.getBoundingClientRect();

  // Position check
  if (isBannerPosition(style)) score += 2;

  // Size check
  if (rect.height < BANNER_HEURISTICS.maxHeight) score += 1;
  
  // Content checks
  if (text.length >= BANNER_HEURISTICS.minTextLength) {
    // Check for cookie-related content density
    const cookieTerms = textPatterns.filter(term => text.includes(term));
    score += cookieTerms.length * 0.5;

    // Check for interaction elements
    const hasButtons = element.querySelectorAll('button, [role="button"], .button, input[type="button"]').length > 0;
    const hasCheckbox = element.querySelectorAll('input[type="checkbox"]').length > 0;
    if (hasButtons) score += 1;
    if (hasCheckbox) score += 0.5;

    // Check for privacy links
    const hasPrivacyLinks = Array.from(element.querySelectorAll('a')).some(a => 
      a.textContent.toLowerCase().includes('privacy') || 
      a.href.toLowerCase().includes('privacy') ||
      /polic(y|ies)/.test(a.href.toLowerCase()) ||
      /cookies?/.test(a.href.toLowerCase())
    );
    if (hasPrivacyLinks) score += 1;
  }

  return score;
}

// Common cookie banner selectors
const COOKIE_BANNER_SELECTORS = [
  '[class*="cookie"]',
  '[id*="cookie"]',
  '[class*="consent"]',
  '[id*="consent"]',
  '[class*="banner"]',
  '[class*="notice"]',
  '.cc-window',
  '#cookieConsent',
  '.cookie-notice',
  '.cookie-banner',
  '.cookie-message',
  '#gdpr-banner',
  '.gdpr-notice',
  '#onetrust-banner-sdk',
  '.cookieBar',
];

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

  // Broad condition for an overlay that covers a significant portion
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
  const text = el.textContent?.toLowerCase() || "";

  // Position and z-index
  if (["fixed", "absolute"].includes(style.position)) {
    score += SCORING_RULES.positionScore;
  }
  if (parseInt(style.zIndex, 10) > 800) {
    score += SCORING_RULES.highZIndexScore;
  }

  console.log("Matched text: ", text);
  // Text patterns
  if (textPatterns.some((p) => text.includes(p))) {
    score += SCORING_RULES.textMatchScore;
  }

  // Specific words and elements
  if (text.includes("accept")) score += SCORING_RULES.acceptWordScore;
  if (el.querySelector('button, [role="button"]'))
    score += SCORING_RULES.buttonScore;
  if (el.querySelector('a[href*="privacy"]'))
    score += SCORING_RULES.privacyLinkScore;

  // Coverage check
  const coversEnough =
    rect.width >= window.innerWidth * 0.5 &&
    rect.height >= window.innerHeight * 0.3;
  if (coversEnough) score += SCORING_RULES.coverageScore;

  return score;
}

// Try hiding leftover overlays (large, high-zIndex, covering screen)
function removeLeftoverOverlays() {
  // Save scroll state if not already saved
  if (!domState.originalBodyStyles) {
    saveScrollState();
  }

  document.body.style.overflow = "auto";
  const allElements = document.querySelectorAll("*");
  allElements.forEach((el) => {
    if (isLargeOverlay(el)) {
      el.style.display = "none";
      
      // Check if element might be affecting scroll
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'absolute') {
        restoreScroll();
      }
    }
  });

  // Ensure scrolling is restored
  restoreScroll();
}

function saveElementState(element) {
  if (!domState.modifications.has(element)) {
    domState.modifications.set(element, {
      display: element.style.display,
      visibility: element.style.visibility,
      position: element.style.position,
      zIndex: element.style.zIndex
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
      // Check for severe DOM issues
      const heightReduction = beforeHeight - document.documentElement.scrollHeight;
      const cantScroll = window.scrollY === beforeScroll && beforeScroll > 0;
      const noVerticalScroll = document.documentElement.scrollHeight <= window.innerHeight;
      const bodyHidden = window.getComputedStyle(document.body).display === 'none';
      
      domState.isPageBroken = (
        heightReduction > DOM_HEALTH.maxHeightReduction ||
        cantScroll ||
        noVerticalScroll ||
        bodyHidden
      );
      
      const scrollDisabled = window.getComputedStyle(document.body).overflow === 'hidden' &&
                        window.getComputedStyle(document.documentElement).overflow === 'hidden';
                        
      if (scrollDisabled) {
        restoreScroll();
      }
      
      resolve(domState.isPageBroken);
    }, DOM_HEALTH.scrollCheckDelay);
  });
}

async function recoverDOM() {
  console.warn('DOM recovery initiated');
  
  // Restore body/html defaults first
  document.body.style.overflow = domState.originalOverflow;
  document.body.style.position = domState.originalPosition;
  
  // Restore all modified elements
  for (const [element] of domState.modifications) {
    restoreElement(element);
  }
  
  // Clear our tracking
  domState.modifications.clear();
  hiddenElements.clear();
  
  // Restore scroll position
  window.scrollTo(0, domState.scrollPosition);
  
  return await checkDOMHealth();
}

// Enhance the existing hide functions with safety checks
async function safeHideElement(element) {
  hideElementImmediately(element);
  processRemovalQueue();
}

function checkAndHide(el) {
  if (!el || hiddenElements.has(el) || isEssentialElement(el)) return;
  const s = scoreElement(el);

  // If score is high enough, hide element, then remove leftover overlays
  if (s >= SCORING_RULES.threshold) {
    safeHideElement(el);
    removeLeftoverOverlays();
  }
}

// Add helper functions for performance optimization
function isNavigationMenu(element) {
  return element.querySelector('nav') || 
         element.querySelectorAll('a').length > 5;
}

function isTooComplex(element) {
  return element.querySelectorAll('*').length > 50;
}

// Optimize element check with batch processing
function batchProcessElements(elements, processor) {
  const batches = [];
  for (let i = 0; i < elements.length; i += PERFORMANCE.batchSize) {
    batches.push(Array.from(elements).slice(i, i + PERFORMANCE.batchSize));
  }

  let processed = 0;
  function processBatch() {
    if (batches.length === 0) return;
    const batch = batches.shift();
    
    batch.forEach(element => {
      if (processed < PERFORMANCE.maxElementsPerCycle) {
        processor(element);
        processed++;
      }
    });

    if (batches.length > 0) {
      setTimeout(processBatch, PERFORMANCE.processingDelay);
    }
  }

  processBatch();
}

// Modified detection function to use optimizations
function detectSimpleCookieBanner() {
  if (removingElements) return;

  // Immediate removal of known cookie banners
  COOKIE_BANNER_SELECTORS.forEach(selector => {
    try {
      document.querySelectorAll(selector).forEach(element => {
        if (!hiddenElements.has(element) && !isEssentialElement(element)) {
          hideElementImmediately(element);
        }
      });
    } catch (e) {
      console.warn('Selector error:', selector, e);
    }
  });

  // Check for other potential banners
  document.querySelectorAll('div, section, aside, footer').forEach(element => {
    if (!hiddenElements.has(element) && !isEssentialElement(element)) {
      const score = calculateBannerScore(element);
      if (score >= BANNER_HEURISTICS.minScore) {
        if (!isNavigationMenu(element) && !isTooComplex(element)) {
          hideElementImmediately(element);
        }
      }
    }
  });

  // Force cleanup of any remaining overlays
  removeLeftoverOverlays();
}

// Enhanced protected elements and patterns
const PROTECTED_ELEMENTS = {
  selectors: [
    'form:not([class*="cookie"]):not([class*="consent"])',
    'nav, .navigation, .menu',
    'header:not([class*="cookie"]):not([class*="consent"])',
    '.sidebar:not([class*="cookie"]):not([class*="consent"])',
    'main, article, .content, #content',
    '.search-form, .search-bar',
    '.shopping-cart, .cart',
    '.modal:not([class*="cookie"]):not([class*="consent"])',
    '.login, .signup, .authentication',
    '[role="main"], [role="navigation"]',
    '.site-header, .main-header'
  ],
  classes: ['menu', 'nav', 'header', 'content', 'main', 'footer'],
  roles: ['navigation', 'main', 'banner', 'contentinfo', 'search', 'form']
};

// More precise cookie banner patterns
const COOKIE_PATTERNS = {
  text: [
    /\b(accept|agree|allow).{0,30}(cookies?|privacy|terms)/i,
    /\b(cookie|privacy|gdpr).{0,30}(notice|banner|consent|policy)/i,
    /\b(we use|this site uses).{0,30}(cookies?|tracking)/i,
    /\b(privacy|cookie).{0,30}(settings|preferences)/i
  ],
  buttons: [
    /\b(accept|agree|allow|got it|ok|dismiss)\b/i,
    /\b(reject|decline|deny)\b/i,
    /\b(cookie|privacy).{0,20}(settings|preferences)\b/i
  ],
  classes: [
    /(cookie|consent|privacy|gdpr)-?(banner|notice|popup|alert|dialog)/i,
    /cc-window|cookie-law|cookie-message/i
  ],
  // Common cookie banner frameworks
  frameworks: [
    '#onetrust-banner-sdk',
    '#CybotCookiebotDialog',
    '#cmplz-cookie-banner',
    '.cc-window.cc-banner',
    '#cookieConsentContainer'
  ]
};

// Enhanced scoring system
function calculateEnhancedScore(element) {
  if (isProtectedElement(element)) return 0;
  
  let score = 0;
  const text = element.textContent?.toLowerCase() || '';
  const rect = element.getBoundingClientRect();
  const computedStyle = window.getComputedStyle(element);
  
  // Position and style checks
  if (isOverlayPosition(computedStyle)) score += 2;
  if (hasHighZIndex(computedStyle)) score += 1;
  
  // Content analysis
  if (containsCookiePatterns(text)) score += 3;
  if (hasConsentButtons(element)) score += 2;
  if (hasPrivacyLinks(element)) score += 1;
  
  // Framework detection
  if (isCookieBannerFramework(element)) score += 4;
  
  // Visual characteristics
  if (isBannerShaped(rect)) score += 1;
  if (isReasonableSize(rect)) score += 1;
  
  return score;
}

function isProtectedElement(element) {
  // Check if element matches any protected selector
  if (PROTECTED_ELEMENTS.selectors.some(selector => element.matches(selector))) {
    return true;
  }

  // Check for protected classes
  if (PROTECTED_ELEMENTS.classes.some(cls => element.classList.contains(cls))) {
    return true;
  }

  // Check roles
  const role = element.getAttribute('role');
  if (role && PROTECTED_ELEMENTS.roles.includes(role)) {
    return true;
  }

  // Check for forms with user input
  if (element.tagName === 'FORM' || element.querySelector('form')) {
    const hasInputs = element.querySelectorAll('input:not([type="button"])').length > 0;
    if (hasInputs) return true;
  }

  // Check for main navigation
  if (isMainNavigation(element)) return true;

  // Check for main content
  if (isMainContent(element)) return true;

  return false;
}

function isCookieBannerFramework(element) {
  return COOKIE_PATTERNS.frameworks.some(selector => element.matches(selector));
}

function containsCookiePatterns(text) {
  return COOKIE_PATTERNS.text.some(pattern => pattern.test(text));
}

function hasConsentButtons(element) {
  const buttons = element.querySelectorAll('button, [role="button"], .button');
  return Array.from(buttons).some(button => 
    COOKIE_PATTERNS.buttons.some(pattern => 
      pattern.test(button.textContent || '')
    )
  );
}

// Enhanced hiding function with safety checks
function safeHideElement(element) {
  if (!element || isProtectedElement(element)) return;

  const score = calculateEnhancedScore(element);
  if (score < 7) return; // Minimum threshold for hiding

  // Store original styles
  const originalStyles = {
    display: element.style.display,
    visibility: element.style.visibility,
    position: element.style.position,
    zIndex: element.style.zIndex
  };

  // Apply minimal hiding styles
  element.style.cssText = `
    display: none !important;
    visibility: hidden !important;
  `;

  // Verify if hiding was successful and didn't break layout
  setTimeout(() => {
    const didBreakLayout = checkLayoutBreakage();
    if (didBreakLayout) {
      Object.assign(element.style, originalStyles);
    } else {
      hiddenElements.add(element);
    }
  }, 50);
}

// Modified observer to use optimizations
const observer = new MutationObserver(throttle((mutations) => {
  if (removingElements) return;

  const validMutations = mutations.filter(mutation => {
    const target = mutation.target;
    return !hiddenElements.has(target) && 
           !Array.from(hiddenElements).some(hidden => hidden.contains(target));
  }).slice(0, PERFORMANCE.maxElementsPerCycle);

  if (validMutations.length === 0) return;

  batchProcessElements(validMutations, mutation => {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          checkAndHide(node);
          batchProcessElements(node.querySelectorAll('*'), checkAndHide);
        }
      });
    } else if (mutation.type === 'attributes') {
      checkAndHide(mutation.target);
    }
  });

  detectSimpleCookieBanner();
}, PERFORMANCE.processingDelay));

// Update initialization to handle initial elements more efficiently
function initializeExtension() {
  if (observerStarted) return;
  
  domState.originalOverflow = document.body.style.overflow;
  domState.originalPosition = document.body.style.position;
  domState.bannerFound = false;
  domState.scrollWasDisabled = isScrollDisabled();
  
  // Remove initial scroll position save
  // domState.scrollPosition = window.scrollY;
  
  // Immediate scan for obvious cookie banners
  detectSimpleCookieBanner();
  
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true, // Added to catch attribute changes
    attributeFilter: ['style', 'class', 'id'], // Only watch relevant attributes
    characterData: true
  });
  
  // Process initial elements efficiently
  const initialElements = Array.from(document.querySelectorAll("*"))
    .slice(0, PERFORMANCE.maxElementsPerCycle * 2);
  
  batchProcessElements(initialElements, checkAndHide);
  
  // Secondary scan after short delay
  setTimeout(detectSimpleCookieBanner, 100);
  
  // Final cleanup scan
  setTimeout(() => {
    detectSimpleCookieBanner();
    processRemovalQueue();
    removeLeftoverOverlays();
  }, 500);
  observerStarted = true;
}

// Start observing
window.addEventListener("load", () => {
  initializeExtension();
  
  // Multiple passes to catch dynamic content
  const checkIntervals = [0, 100, 500, 1000, 2000];
  checkIntervals.forEach(delay => {
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

// Add memory management
let lastCleanupTime = Date.now();
let processingTimeout = null;

function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Memory cleanup function
function performMemoryCleanup() {
  if (Date.now() - lastCleanupTime < PERFORMANCE.cleanupInterval) return;
  
  // Only cleanup if we're well over the limits
  if (domState.modifications.size > PERFORMANCE.maxStoredElements * 1.5) {
    const entriesToRemove = Array.from(domState.modifications.entries())
      .slice(0, domState.modifications.size - PERFORMANCE.maxStoredElements);
    entriesToRemove.forEach(([key]) => domState.modifications.delete(key));
  }

  // Keep more hidden elements in memory
  if (hiddenElements.size > PERFORMANCE.maxStoredElements * 2) {
    const elementsArray = Array.from(hiddenElements);
    const excessElements = elementsArray.slice(0, 
      hiddenElements.size - PERFORMANCE.maxStoredElements);
    excessElements.forEach(el => hiddenElements.delete(el));
  }

  lastCleanupTime = Date.now();
}

// Optimize element queries
const optimizedQuerySelector = (selector, isPriority = false) => {
  try {
    // Direct query for better performance
    return document.querySelectorAll(selector);
  } catch (e) {
    console.warn('Selector error:', e);
    return [];
  }
};

// Add scroll management constants
const SCROLL_FIXES = {
  retryAttempts: 3,
  retryDelay: 100,
  properties: [
    'overflow',
    'overflow-x',
    'overflow-y',
    'position',
    'height',
    'min-height'
  ]
};

// Add these new functions for scroll management
function saveScrollState() {
  const body = document.body;
  const html = document.documentElement;
  
  domState.originalBodyStyles = SCROLL_FIXES.properties.reduce((styles, prop) => {
    styles[prop] = body.style[prop];
    return styles;
  }, {});
  
  domState.originalHtmlStyles = SCROLL_FIXES.properties.reduce((styles, prop) => {
    styles[prop] = html.style[prop];
    return styles;
  }, {});
}

// Modify the existing restoreScroll function
function restoreScroll() {
  // Only restore if we actually found and removed a banner
  if (!domState.bannerFound) return;
  
  enableScroll();
  
  if (domState.lastScrollPosition > 0) {
    requestAnimationFrame(() => {
      window.scrollTo({
        top: domState.lastScrollPosition,
        behavior: 'auto'
      });
    });
  }
}

function restoreScroll() {
  const body = document.body;
  const html = document.documentElement;

  // Only modify overflow if it's currently hidden
  if (window.getComputedStyle(body).overflow === 'hidden' ||
      window.getComputedStyle(html).overflow === 'hidden') {
    
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
