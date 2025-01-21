let observerStarted = false;
const hiddenElements = new Set();
const TARGET_SCORE = 7;

// Common patterns
const patterns = [
  "cookie",
  "cookies",
  "consent",
  "gdpr",
  "privacy",
  "accept",
  "agree",
  "banner",
  "modal",
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
    essentialTags.includes(el.tagName) ||
    essentialRoles.includes(el.getAttribute("role")) ||
    el.id === "main" ||
    el.classList.contains("main")
  );
}

function scoreElement(el) {
  try {
    if (isEssentialElement(el)) return 0;
    let score = 0;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.position === "fixed") score += 2;
    if (parseInt(style.zIndex, 10) > 1000) score += 2;

    const text = el.textContent?.toLowerCase() || "";
    if (patterns.some((p) => text.includes(p))) score += 3;
    if (text.includes("accept")) score += 1;
    if (el.querySelector('button, [role="button"]')) score += 1;
    if (el.querySelector('a[href*="privacy"]')) score += 1;
    return score;
  } catch (error) {
    console.error("Error in scoreElement:", error);
    return 0;
  }
}

function fixOverlay() {
  // Restore scroll if body is locked
  document.body.style.overflow = "auto";

  // Only remove overlays if they are likely part of the cookie modal
  const overlays = document.querySelectorAll(
    "[class*='overlay'],[class*='backdrop'],[class*='modal']"
  );
  overlays.forEach((overlay) => {
    // Gather overlay characteristics
    const text = overlay.textContent?.toLowerCase() || "";
    const rect = overlay.getBoundingClientRect();
    const style = window.getComputedStyle(overlay);
    const isCoveringScreen =
      rect.width >= window.innerWidth * 0.8 &&
      rect.height >= window.innerHeight * 0.8;
    const isFixed = style.position === "fixed" || style.position === "absolute";

    // Hide only if overlay is big, fixed, and has cookie/consent references
    if (isCoveringScreen && isFixed && patterns.some((p) => text.includes(p))) {
      overlay.style.display = "none";
    }
  });
}

function checkAndHide(el) {
  if (!el || hiddenElements.has(el) || isEssentialElement(el)) return;
  const elScore = scoreElement(el);
  if (elScore >= TARGET_SCORE) {
    el.style.display = "none";
    hiddenElements.add(el);

    // Attempt to fix leftover overlays
    fixOverlay();
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
  setTimeout(initializeExtension, 1000);
  setTimeout(() => document.querySelectorAll("*").forEach(checkAndHide), 3000);
});

window.addEventListener("unload", () => {
  observer.disconnect();
  hiddenElements.clear();
});
