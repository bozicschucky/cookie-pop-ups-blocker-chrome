let observerStarted = false;
const hiddenElements = new Set();

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
  document.body.style.overflow = "auto";
  const allElements = document.querySelectorAll("*");
  allElements.forEach((el) => {
    if (isLargeOverlay(el)) {
      el.style.display = "none";
    }
  });
}

function checkAndHide(el) {
  if (!el || hiddenElements.has(el) || isEssentialElement(el)) return;
  const s = scoreElement(el);

  // If score is high enough, hide element, then remove leftover overlays
  if (s >= SCORING_RULES.threshold) {
    el.style.display = "none";
    hiddenElements.add(el);
    removeLeftoverOverlays();
  }
}

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        checkAndHide(node);
        node.querySelectorAll("*").forEach(checkAndHide);
      }
    });
  });
});

function initializeExtension() {
  if (observerStarted) return;
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  observerStarted = true;
  document.querySelectorAll("*").forEach(checkAndHide);
}

// Start observing
window.addEventListener("load", () => {
  setTimeout(initializeExtension, 500);
  // Periodically re-check in case the overlay reappears or changes
  setTimeout(() => document.querySelectorAll("*").forEach(checkAndHide), 1000);
});

window.addEventListener("unload", () => {
  observer.disconnect();
  hiddenElements.clear();
});
