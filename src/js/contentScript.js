/**********************
 * Global State & Constants
 **********************/
let observerStarted = false;
const hiddenElements = new Set();
const removalQueue = new Set();
let removingElements = false;
let popUpCount = 0;
let extensionDisabled = false;
let lastCleanupTime = Date.now();
let currentDomain = window.location.hostname;
let detectionStatistics = { totalDetected: 0, falsePositives: 0 };
let learnedPatterns = new Map(); // Store domain-specific learned patterns

// Dynamic configuration system that can be updated
const CONFIG = {
  DOM_HEALTH: {
    maxHeightReduction: 100,
    scrollCheckDelay: 250,
    recoveryAttempts: 2,
    debounceDelay: 50,
  },
  PERFORMANCE: {
    batchSize: 35,
    maxElementsPerCycle: 150,
    cleanupInterval: 60000,
    processingDelay: 0,
    maxStoredElements: 1000,
  },
  SCROLL_FIXES: {
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
  },
  SCORING: {
    positionScore: 2,
    highZIndexScore: 2,
    textMatchScore: 1.5,
    acceptWordScore: 1,
    buttonScore: 1,
    privacyLinkScore: 1.5,
    coverageScore: 2,
    baseThreshold: 4.0, // Even lower threshold to catch more banners
    highConfidenceThreshold: 6.0, // Lower high confidence threshold
    proximityBonus: 0.3,
    structureBonus: 1.5,
  },
  PATTERNS: {
    textPatterns: [
      "cookie",
      "cookies",
      "consent",
      "gdpr",
      "privacy",
      "accept",
      "agree",
      "banner",
      "notice",
      "policy",
      "personal information",
      "opt out",
      "rights",
      "data",
      "tracking",
      "third parties",
      "your choices"
    ],
    cookieBannerSelectors: [
      '[class*="cookie"]',
      '[id*="cookie"]',
      '[class*="consent"]',
      '[id*="consent"]',
      '[class*="banner"]',
      '[class*="notice"]',
      '[class*="privacy"]',
      '[class*="gdpr"]',
      '[class*="policy"]',
      '[id*="privacy"]',
      '[id*="gdpr"]',
      '[role="dialog"]',
      '[aria-label*="cookie"]',
      '[aria-label*="privacy"]',
      '[aria-describedby*="cookie"]',
      '[data-role*="privacy"]',
      '[data-role*="cookie"]',
      // Common bottom banner configurations
      '[style*="position: fixed"][style*="bottom"]',
      '[style*="position:fixed"][style*="bottom"]',
      // Common banner frameworks
      '.cc-window',
      '.cmpbox',
      '.message_container',
      '.message-container',
      // GDPR specific
      '[data-tracking-opt-in-overlay]',
      // Cookie specific
      '[data-testid*="cookie"]',
      '[data-testid*="privacy"]',
      '[aria-labelledby*="cookie"]',
    ],
    protectedSelectors: [
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
    protectedClasses: ["menu", "nav", "header", "content", "main", "footer"],
    protectedRoles: ["navigation", "main", "banner", "contentinfo", "search", "form"],
  },
  BANNER: {
    positions: ["fixed", "sticky", "absolute"],
    locations: ["top", "bottom"],
    maxHeight: window.innerHeight * 0.4,
    minTextLength: 30,
    minScore: 3,
  },
  LEARNING: {
    enabled: true,
    confidenceThreshold: 9,
    maxPatternsPerDomain: 15,
    scoreDifferential: 4,
    minOccurrences: 2
  }
};

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
  scrollFixesApplied: false,
  detectedElements: new Map(),
};

// Create MutationObserver instance
const observer = new MutationObserver((mutations) => {
  if (extensionDisabled) return;
  
  // Only process changes if we're not currently removing elements
  if (!removingElements) {
    const addedNodes = [];
    const changedElements = new Set();

    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) addedNodes.push(node);
        });
      } else if (mutation.type === "attributes") {
        changedElements.add(mutation.target);
      }
    });

    // Process any newly added DOM nodes for popup detection
    if (addedNodes.length > 0) {
      batchProcessElements(addedNodes, checkAndHide);
    }

    // Check if any changed elements are now cookie banners
    if (changedElements.size > 0) {
      batchProcessElements(Array.from(changedElements), checkAndHide);
    }
  }
});

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

/**
 * Generate standardized hiding style for elements
 * @returns {string} CSS styles to hide elements
 */
function getHidingStyles() {
  return `
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
}

/**
 * Generate scroll fix styles for body/html elements
 * @returns {string} CSS styles to enable scrolling
 */
function getScrollFixStyles() {
  return `
    overflow: auto !important;
    overflow-x: auto !important;
    overflow-y: auto !important;
    position: static !important;
    height: auto !important;
    min-height: auto !important;
    max-height: none !important;
    margin-right: 0 !important;
    padding-right: 0 !important;
  `;
}

/**
 * Extracts and normalizes text content from an element
 * @param {HTMLElement} element - The element to get text from
 * @returns {string} Normalized lowercase text
 */
function getElementText(element) {
  return (element.textContent || "").toLowerCase().trim();
}

/**
 * Checks if element text contains cookie/consent related terms
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element contains cookie-related text
 */
function hasCookieRelatedText(element) {
  const text = getElementText(element);
  return /cookie|consent|privacy|gdpr|ccpa|personal|data|opt.?out|preference|choice/i.test(text);
}

/**
 * Gets viewport coverage of an element
 * @param {DOMRect} rect - Element bounding rect
 * @returns {number} Percentage of viewport covered by element (0-1)
 */
function getViewportCoverage(rect) {
  return (rect.width * rect.height) / (window.innerWidth * window.innerHeight);
}

/**
 * Centralized method to apply element hiding
 * @param {HTMLElement} element - Element to hide
 */
function applyElementHiding(element) {
  if (!element || hiddenElements.has(element) || !element.isConnected) return;
  
  saveElementState(element);
  element.style.cssText = getHidingStyles();
  hiddenElements.add(element);
  removalQueue.add(element);
  popUpCount++;
}

/**
 * Check if an element is likely an overlay
 * @param {HTMLElement} element - Element to check
 * @returns {boolean} True if element is an overlay
 */
function isLikelyOverlay(element) {
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  
  const isLargeElement = rect.width > window.innerWidth * 0.9 && rect.height > window.innerHeight * 0.9;
  const isFixed = style.position === "fixed";
  const hasBackdropEffect = style.backdropFilter || 
                       style.background?.includes('rgba') || 
                       parseFloat(style.opacity) < 1;
  const coversViewport = rect.top <= 5 && rect.left <= 5;
  const hasHighZIndex = parseInt(style.zIndex, 10) > 100;
  
  return isFixed && isLargeElement && coversViewport && (hasBackdropEffect || hasHighZIndex);
}

/**
 * Check if scrolling is disabled on the page
 * @returns {boolean} True if scroll is disabled
 */
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

/**
 * Fix scrolling issues by applying scroll-enabling styles
 */
function fixScrolling() {
  if (extensionDisabled) return;
  
  try {
    const body = document.body;
    const html = document.documentElement;
    
    // Check if scrolling is disabled
    if (isScrollDisabled()) {
      // Create a style element for more persistent overrides
      let styleEl = document.getElementById('cookie-blocker-scroll-fix');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'cookie-blocker-scroll-fix';
        document.head.appendChild(styleEl);
      }
      
      // Add CSS rules to forcibly enable scrolling
      styleEl.textContent = `
        body, html {
          ${getScrollFixStyles()}
        }
      `;
      
      // Apply scroll fixes directly to elements
      body.style.cssText += getScrollFixStyles();
      html.style.cssText += getScrollFixStyles();
      
      domState.scrollFixesApplied = true;
      
      // Restore scroll position if needed
      if (domState.lastScrollPosition > 0) {
        window.scrollTo({
          top: domState.lastScrollPosition,
          behavior: "auto"
        });
      }
    }
  } catch (e) {
    console.error("Error fixing scroll:", e);
  }
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

/**********************
 * Scroll Management
 **********************/
function enableScroll() {
  fixScrolling();
}

/**********************
 * Element Analysis & Scoring
 **********************/
function isEssentialElement(element) {
  const essentialTags = ["HTML", "BODY", "HEAD", "MAIN", "HEADER", "NAV", "ARTICLE"];
  const essentialRoles = ["main", "navigation", "banner", "contentinfo"];
  return (
    !element ||
    essentialTags.includes(element.tagName) ||
    essentialRoles.includes(element.getAttribute("role")) ||
    element.id === "main" ||
    element.classList.contains("main")
  );
}

function isOverlayPosition(style) {
  return ["fixed", "absolute", "sticky"].includes(style.position);
}

function hasHighZIndex(style) {
  return parseInt(style.zIndex, 10) > 800;
}

function isPositionedAt(style, edge) {
  const position = parseInt(style[edge], 10);
  return style.position === "fixed" && (style[edge] === "0px" || position === 0);
}

function isFixedAtBottom(style) {
  return isPositionedAt(style, "bottom");
}

function isFixedAtTop(style) {
  return isPositionedAt(style, "top");
}

function isFixedAtEdge(style) {
  return isFixedAtBottom(style) || isFixedAtTop(style);
}

function hasConsentButtons(element) {
  const buttons = element.querySelectorAll('button, [role="button"], .button, a.button, input[type="button"]');
  return Array.from(buttons).some((button) => {
    const text = getElementText(button);
    return /accept|agree|allow|got it|ok|consent|dismiss|confirm|yes|save|set|understand|acknowledge/i.test(text);
  });
}

function hasPrivacyLinks(element) {
  return !!element.querySelector('a[href*="privacy"], a[href*="cookie"], a[href*="policy"], a[href*="consent"], a[href*="terms"]');
}

function isMainNavigation(element) {
  return (
    element.querySelector("nav") || element.querySelectorAll("a").length > 5
  );
}

function isMainContent(element) {
  return element.id === "main" || element.classList.contains("main");
}

function isLargeOverlay(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width >= window.innerWidth * 0.5 &&
    rect.height >= window.innerHeight * 0.3 &&
    (style.position === "fixed" || style.position === "absolute") &&
    parseInt(style.zIndex, 10) > 800
  );
}

/**********************
 * Banner & Overlay Handling
 **********************/
function hideElementImmediately(element) {
  if (!element || hiddenElements.has(element) || extensionDisabled) return;

  const style = window.getComputedStyle(element);
  const isBannerOrOverlay =
    style.position === "fixed" || style.position === "absolute" || style.position === "sticky";
  const isLarge = isLargeOverlay(element); // Check if element is large overlay
  const score = calculateScore(element);

  if (isBannerOrOverlay) {
    domState.bannerFound = true;
    domState.lastScrollPosition = window.scrollY;
    domState.scrollWasDisabled = isScrollDisabled();
  }
  applyElementHiding(element);

  // Learn from this successful detection
  learnFromElement(element, score, true);

  if (isLarge && domState.scrollWasDisabled) {
    requestAnimationFrame(() => {
      enableScroll();
      if (domState.lastScrollPosition > 0) {
        window.scrollTo({ top: domState.lastScrollPosition, behavior: "auto" });
      }
    });
  }
}

function removeOverlays() {
  if (extensionDisabled) return;
  
  try {
    // Reset scroll-blocking styles
    enableScroll();
    
    // Look for common overlay patterns - these are usually semi-transparent divs covering the whole page
    const potentialOverlays = document.querySelectorAll(
      // Fixed position elements
      '[style*="position: fixed"], [style*="position:fixed"], ' + 
      // Common overlay classes
      '.overlay, .modal-backdrop, .backdrop, .dimmer, .modal-overlay, ' + 
      // Cookie-specific overlay names
      '[class*="cookie-overlay"], [class*="consent-overlay"], [id*="overlay"], ' +
      // GDPR compliance overlays
      '[class*="gdpr-overlay"], [class*="backdrop"], [class*="dimmed"]'
    );
    
    potentialOverlays.forEach(overlay => {
      if (hiddenElements.has(overlay) || isProtectedElement(overlay)) return;
      
      if (isLikelyOverlay(overlay)) {
        applyElementHiding(overlay);
        
        // Log detection for debugging
        console.log("Removed background overlay:", overlay.className || overlay.id || "unnamed overlay");
      }
    });
    
    // Fix body and html if scroll is disabled
    resetBodyScrollLocks();
  } catch (e) {
    console.error("Error removing overlays:", e);
  }
}

function resetBodyScrollLocks() {
  fixScrolling();
}

/**********************
 * Protected & Scoring Functions
 **********************/
function isProtectedElement(element) {
  if (!element) return true;
  try {
    if (CONFIG.PATTERNS.protectedSelectors.some((selector) => element.matches(selector)))
      return true;
    if (CONFIG.PATTERNS.protectedClasses.some((cls) => element.classList.contains(cls)))
      return true;
    const role = element.getAttribute("role");
    if (role && CONFIG.PATTERNS.protectedRoles.includes(role)) return true;
    if (element.tagName === "FORM" || element.querySelector("form")) {
      if (element.querySelectorAll('input:not([type="button"])').length > 0)
        return true;
    }
    if (isMainNavigation(element) || isMainContent(element)) return true;
  } catch (e) {
    console.warn("Error in isProtectedElement:", e);
    return false;
  }
  return false;
}

function calculateScore(element, options = {}) {
  if (!element || isProtectedElement(element)) return 0;
  let score = 0;
  
  try {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const text = getElementText(element);
    const viewportCoverage = getViewportCoverage(rect);

    // Position and style scoring
    if (isOverlayPosition(style)) {
      score += CONFIG.SCORING.positionScore;
      
      // Special bonus for fixed position at edges (common for cookie notices)
      if (isFixedAtBottom(style)) score += 1.5;
      if (isFixedAtTop(style)) score += 1;
    }
    
    if (hasHighZIndex(style)) score += CONFIG.SCORING.highZIndexScore;
    
    // Size and coverage analysis
    if (viewportCoverage > 0.9) score += CONFIG.SCORING.coverageScore;
    else if (viewportCoverage > 0.5) score += CONFIG.SCORING.coverageScore / 2;
    
    // Banner shape - wide but not tall (common for cookies)
    if (rect.width > window.innerWidth * 0.9 && rect.height < window.innerHeight * 0.3) {
      score += CONFIG.SCORING.coverageScore / 2;
    }
    
    // Text content analysis
    if (text.length >= CONFIG.BANNER.minTextLength) {
      // Match text patterns
      const cookieTerms = CONFIG.PATTERNS.textPatterns.filter(term => text.includes(term));
      score += cookieTerms.length * 0.5;
      
      // Strong privacy indicators
      if (text.includes("personal information")) score += 2;
      if (text.includes("your privacy")) score += 2;
      if (text.includes("third parties")) score += 1;
      if (text.includes("rights") && text.includes("privacy")) score += 1.5;
      if (text.includes("opt out") || text.includes("opt-out")) score += 1;
      if (text.includes("california residents")) score += 2;
    }

    // Interactive elements
    if (hasConsentButtons(element)) score += CONFIG.SCORING.buttonScore * 2;
    if (hasPrivacyLinks(element)) score += CONFIG.SCORING.privacyLinkScore;
    
    // Form elements
    if (element.querySelectorAll('input[type="checkbox"]').length) score += 0.5;
    
    // Background styling
    if (style.backgroundColor && style.backgroundColor !== 'transparent' && 
        style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      score += 0.5;
      
      // Semi-transparent backgrounds common for overlays
      if (style.backgroundColor.includes('rgba') && 
          style.backgroundColor.match(/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0\.\d+)\s*\)/)) {
        score += 0.75;
      }
    }
    
    // Structure analysis
    const hasContentContainer = !!element.querySelector('div > div');
    const hasButtons = element.querySelectorAll('button, [role="button"], a.button, .btn, input[type="button"]').length > 0;
    if (hasContentContainer && hasButtons) score += CONFIG.SCORING.structureBonus;
  } catch (e) {
    console.warn("Error calculating score:", e);
    return 0;
  }
  
  return score;
}

/**********************
 * Detection & Processing
 **********************/
function detectSimpleCookieBanner() {
  if (removingElements || extensionDisabled) return;
  
  try {
    // Check for common cookie banner selectors
    CONFIG.PATTERNS.cookieBannerSelectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((element) => {
          if (!hiddenElements.has(element) && element.isConnected && !isProtectedElement(element)) {
            if (hasCookieRelatedText(element)) {
              const score = calculateScore(element);
              if (score >= CONFIG.BANNER.minScore) {
                hideElementImmediately(element);
              }
            }
          }
        });
      } catch (e) {
        console.warn("Selector error:", selector, e);
      }
    });

    // Check for likely cookie banners based on position and content
    document
      .querySelectorAll("div, section, aside, footer")
      .forEach((element) => {
        if (!hiddenElements.has(element) && element.isConnected && !isProtectedElement(element)) {
          if (hasCookieRelatedText(element)) {
            const score = calculateScore(element);
            if (
              score >= CONFIG.BANNER.minScore &&
              !isMainNavigation(element) &&
              !element.querySelectorAll("*").length > 50
            )
              hideElementImmediately(element);
          }
        }
      });
    
    // Look for fixed position elements at bottom/top of page
    document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]').forEach(element => {
      const style = window.getComputedStyle(element);
      
      if (!hiddenElements.has(element) && element.isConnected && !isProtectedElement(element)) {
        if (isFixedAtEdge(style) && hasCookieRelatedText(element)) {
          const score = calculateScore(element);
          if (score >= CONFIG.BANNER.minScore) {
            hideElementImmediately(element);
          }
        }
      }
    });
    
    removeLeftoverOverlays();
    removeOverlays();
  } catch (e) {
    console.error("Error in detectSimpleCookieBanner:", e);
  }
}

function removeLeftoverOverlays() {
  fixScrolling();
}

/**********************
 * Batch Processing
 **********************/
function batchProcessElements(elements, processor) {
  if (extensionDisabled || !elements.length) return;
  
  try {
    const batches = [];
    for (let i = 0; i < elements.length; i += CONFIG.PERFORMANCE.batchSize) {
      batches.push(Array.from(elements).slice(i, i + CONFIG.PERFORMANCE.batchSize));
    }
    let processed = 0;
    function processBatch() {
      if (batches.length === 0) return;
      const batch = batches.shift();
      batch.forEach((element) => {
        if (processed < CONFIG.PERFORMANCE.maxElementsPerCycle && element && element.isConnected) {
          processor(element);
          processed++;
        }
      });
      if (batches.length > 0)
        setTimeout(processBatch, CONFIG.PERFORMANCE.processingDelay);
    }
    processBatch();
  } catch (e) {
    console.error("Error in batchProcessElements:", e);
  }
}

const processRemovalQueue = debounce(() => {
  if (removingElements || !removalQueue.size || extensionDisabled) return;
  
  removingElements = true;
  try {
    Array.from(removalQueue).forEach((element) => {
      if (!hiddenElements.has(element) && element && element.isConnected) {
        element.style.display = "none";
        hiddenElements.add(element);
      }
    });
    removalQueue.clear();
  } catch (e) {
    console.error("Error processing removal queue:", e);
  } finally {
    removingElements = false;
  }
}, 0);

function checkAndHide(element) {
  if (!element || 
      !element.isConnected ||
      extensionDisabled || 
      hiddenElements.has(element) || 
      isProtectedElement(element)) return;

  try {
    // Quick check for primary keywords
    if (!hasCookieRelatedText(element)) return;

    // For elements that match keywords, calculate full score
    const score = calculateScore(element);
    
    // Hide if score exceeds threshold
    if (score >= CONFIG.SCORING.highConfidenceThreshold) {
      hideElementImmediately(element);
    } else if (score >= CONFIG.SCORING.baseThreshold) {
      safeHideElement(element);
    }
    
    // Check for child elements that might be cookie banners
    if (element.children.length > 0) {
      Array.from(element.children).forEach(child => {
        if (child.nodeType === Node.ELEMENT_NODE && 
            !hiddenElements.has(child) &&
            !isProtectedElement(child)) {
          checkAndHide(child);
        }
      });
    }
  } catch (e) {
    console.warn("Error in checkAndHide:", e);
  }
}

function safeHideElement(element) {
  applyElementHiding(element);
}

/**********************
 * Learning System
 **********************/
function saveSettings() {
  if (!CONFIG.LEARNING.enabled) return;
  
  try {
    const patterns = Array.from(learnedPatterns.entries());
    chrome.storage.local.set({ 
      'learnedPatterns': JSON.stringify(patterns)
    });
  } catch (e) {
    console.warn("Error saving patterns:", e);
  }
}

function learnFromElement(element, score, wasHidden) {
  if (!element || !CONFIG.LEARNING.enabled || !wasHidden || score < CONFIG.LEARNING.confidenceThreshold) {
    return;
  }
  
  try {
    // Record this detection to learn from
    if (!domState.detectedElements.has(element)) {
      domState.detectedElements.set(element, { 
        score, 
        occurrences: 1
      });
    } else {
      domState.detectedElements.get(element).occurrences++;
    }
    
    // Only learn after minimum occurrences
    if (domState.detectedElements.get(element).occurrences < CONFIG.LEARNING.minOccurrences) {
      return;
    }
    
    let domainPatterns = learnedPatterns.get(currentDomain) || { textPatterns: [], selectors: [] };
    
    // Extract potentially useful patterns
    const text = getElementText(element);
    const classNames = element.className?.split?.(' ') || [];
    const id = element.id;
    
    // Look for unique classes that might be cookie banner specific
    for (const cls of classNames) {
      if (cls && cls.length > 3 && !CONFIG.PATTERNS.cookieBannerSelectors.some(s => s.includes(cls))) {
        if (/banner|cookie|consent|privacy|notice|gdpr|ccpa|policy/i.test(cls)) {
          const newSelector = `[class*="${cls}"]`;
          if (!domainPatterns.selectors.includes(newSelector)) {
            domainPatterns.selectors.push(newSelector);
          }
        }
      }
    }
    
    // Learn from ID
    if (id && id.length > 3 && !CONFIG.PATTERNS.cookieBannerSelectors.some(s => s.includes(id))) {
      if (/banner|cookie|consent|privacy|notice|gdpr|ccpa|policy/i.test(id)) {
        const newSelector = `#${id}`;
        if (!domainPatterns.selectors.includes(newSelector)) {
          domainPatterns.selectors.push(newSelector);
        }
      }
    }
    
    // Find unique phrases that seem to be cookie-consent related
    const phrases = text.match(/([a-z]{3,}\s){2,5}/g) || [];
    for (const phrase of phrases) {
      const cleanPhrase = phrase.trim();
      // Check if this phrase is likely to be cookie-consent related but not in our patterns
      if (cleanPhrase && 
          cleanPhrase.length > 10 && 
          !CONFIG.PATTERNS.textPatterns.includes(cleanPhrase) && 
          (/privacy|consent|cookie|data|choice|agree|accept|necessary|legitimate|interest|setting|prefer/i.test(cleanPhrase))) {
        
        if (!domainPatterns.textPatterns.includes(cleanPhrase)) {
          domainPatterns.textPatterns.push(cleanPhrase);
        }
      }
    }
    
    // Trim patterns if they exceed maximum
    if (domainPatterns.selectors.length > CONFIG.LEARNING.maxPatternsPerDomain) {
      domainPatterns.selectors = domainPatterns.selectors.slice(0, CONFIG.LEARNING.maxPatternsPerDomain);
    }
    if (domainPatterns.textPatterns.length > CONFIG.LEARNING.maxPatternsPerDomain) {
      domainPatterns.textPatterns = domainPatterns.textPatterns.slice(0, CONFIG.LEARNING.maxPatternsPerDomain);
    }
    
    // Save learned patterns for this domain
    learnedPatterns.set(currentDomain, domainPatterns);
    saveSettings();
  } catch (e) {
    console.warn("Error in pattern learning:", e);
  }
}

/**********************
 * Advanced Behavior-Based Detection
 **********************/
function findDynamicOverlays() {
  if (extensionDisabled) return;
  
  try {
    const candidates = [];
    
    // Use more dynamic selectors instead of hardcoded ones
    const positionSelectors = ['fixed', 'sticky', 'absolute'].map(pos => 
      `[style*="position: ${pos}"], [style*="position:${pos}"]`
    ).join(', ');
    
    const potentialBanners = document.querySelectorAll(
      `${positionSelectors}, [style*="z-index"]`
    );
    
    potentialBanners.forEach(element => {
      if (hiddenElements.has(element) || !element.isConnected || isProtectedElement(element)) return;
      
      const totalScore = calculateScore(element);
      
      if (totalScore >= CONFIG.SCORING.highConfidenceThreshold) {
        hideElementImmediately(element);
      } else if (totalScore >= CONFIG.SCORING.baseThreshold) {
        safeHideElement(element);
      }
    });
  } catch (e) {
    console.error("Error finding dynamic overlays:", e);
  }
}

/**********************
 * Initialization & Message Handling
 **********************/
function initializeExtension() {
  if (observerStarted || extensionDisabled) return;
  
  try {
    console.log("Cookie popup blocker initializing");
    
    domState.originalOverflow = document.body.style.overflow;
    domState.originalPosition = document.body.style.position;
    domState.bannerFound = false;
    domState.scrollWasDisabled = isScrollDisabled();
    domState.initialScrollHeight = document.documentElement.scrollHeight;

    // Run detection with progressively increasing delays
    const runDetectionWithDelay = (delay) => {
      setTimeout(() => {
        if (!extensionDisabled) {
          detectSimpleCookieBanner();
          findDynamicOverlays();
          processRemovalQueue();
        }
      }, delay);
    };

    // Initial detection
    detectSimpleCookieBanner();
    findDynamicOverlays();
    
    // Set up mutation observer
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "id"],
      characterData: false, // Improve performance by ignoring text changes
    });

    // Process initial visible elements
    const initialElements = Array.from(document.querySelectorAll("body *")).slice(
      0,
      CONFIG.PERFORMANCE.maxElementsPerCycle * 2
    );
    batchProcessElements(initialElements, checkAndHide);

    // Progressive detection to catch delayed banners
    [100, 500, 1000, 2000, 3500].forEach(runDetectionWithDelay);
    
    // Add window resize listener to catch banners that appear after resize
    window.addEventListener("resize", debounce(() => {
      if (!extensionDisabled) {
        detectSimpleCookieBanner();
        findDynamicOverlays();
      }
    }, 200));
    
    observerStarted = true;
    console.log("Cookie popup blocker initialized successfully");
  } catch (e) {
    console.error("Error initializing extension:", e);
  }
}

// Check if extension is disabled for current domain on load
chrome.storage.local.get([`disabled_${currentDomain}`, 'globalSettings', 'learnedPatterns'], (result) => {
  extensionDisabled = result[`disabled_${currentDomain}`] === true;
  
  // Load global settings or use defaults
  const settings = result.globalSettings || {};
  
  // Configure constants with user preferences or defaults
  if (settings.scoring) {
    Object.keys(settings.scoring).forEach(key => {
      if (CONFIG.SCORING[key] !== undefined) {
        CONFIG.SCORING[key] = settings.scoring[key];
      }
    });
  }
  
  // Load learned patterns if available
  if (result.learnedPatterns) {
    try {
      const patterns = JSON.parse(result.learnedPatterns);
      learnedPatterns = new Map(patterns);
      
      // Apply domain-specific patterns if available
      const domainPatterns = learnedPatterns.get(currentDomain);
      if (domainPatterns) {
        // Merge domain-specific patterns with global patterns
        if (domainPatterns.textPatterns) {
          CONFIG.PATTERNS.textPatterns = [
            ...new Set([...CONFIG.PATTERNS.textPatterns, ...domainPatterns.textPatterns])
          ];
        }
        if (domainPatterns.selectors) {
          CONFIG.PATTERNS.cookieBannerSelectors = [
            ...new Set([...CONFIG.PATTERNS.cookieBannerSelectors, ...domainPatterns.selectors])
          ];
        }
      }
    } catch (e) {
      console.warn("Error loading learned patterns:", e);
    }
  }
  
  if (!extensionDisabled) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeExtension);
    } else {
      initializeExtension();
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.msg === "getPopUpCount") {
    sendResponse({ count: popUpCount });
  } else if (message.msg === "disableExtension") {
    extensionDisabled = true;
    console.log("Cookie popup blocker disabled for this site");
  } else if (message.msg === "enableExtension") {
    extensionDisabled = false;
    console.log("Cookie popup blocker enabled for this site");
    initializeExtension();
  } else if (message.msg === "updateSettings" && message.settings) {
    // Update configuration with new settings
    try {
      if (message.settings.scoring) {
        Object.keys(message.settings.scoring).forEach(key => {
          if (CONFIG.SCORING[key] !== undefined) {
            CONFIG.SCORING[key] = message.settings.scoring[key];
          }
        });
      }
      if (message.settings.learning) {
        Object.keys(message.settings.learning).forEach(key => {
          if (CONFIG.LEARNING[key] !== undefined) {
            CONFIG.LEARNING[key] = message.settings.learning[key];
          }
        });
      }
      console.log("Settings updated successfully");
    } catch (e) {
      console.warn("Error updating settings:", e);
    }
  } else if (message.msg === "resetPatterns" && message.domain) {
    learnedPatterns.delete(message.domain);
    saveSettings();
    console.log("Patterns reset for domain:", message.domain);
  }
  
  // Always return true for async response
  return true;
});

window.addEventListener("load", () => {
  if (!extensionDisabled && !observerStarted) {
    initializeExtension();
  }
  
  // Additional detection passes after load
  if (!extensionDisabled) {
    [0, 500, 1000, 2000].forEach((delay) => {
      setTimeout(() => {
        detectSimpleCookieBanner();
        findDynamicOverlays();
        processRemovalQueue();
      }, delay);
    });
  }
});

window.addEventListener("unload", () => {
  observer.disconnect();
  hiddenElements.clear();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !extensionDisabled && !hiddenElements.size) {
    initializeExtension();
  }
});
