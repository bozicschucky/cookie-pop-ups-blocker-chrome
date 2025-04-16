const PopupController = (function() {
  // State
  let cachedPopupCount = 0;
  let currentDomain = "";
  let globalSettings = {};
  let updateInterval = null;

  // DOM elements
  const elements = {
    disableCheckbox: document.getElementById("disable-extension-check-input"),
    popupCounter: document.getElementById("pop-up-count"),
    detectionStrength: document.getElementById("detection-strength"),
    learningToggle: document.getElementById("enable-learning"),
    resetButton: document.getElementById("reset-patterns"),
    resetStatus: document.getElementById("reset-status"),
    settingsToggle: document.getElementById("settings-toggle"),
    settingsContent: document.getElementById("settings-content")
  };

  const getCurrentTab = async () => {
    try {
      const queryOptions = { active: true, currentWindow: true };
      const [tab] = await chrome.tabs.query(queryOptions);
      return tab;
    } catch (error) {
      console.error("Error getting current tab:", error);
      return null;
    }
  };

  const getDomainFromUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (e) {
      console.error("Invalid URL:", url);
      return "";
    }
  };

  const updateBadge = (count) => {
    count = typeof count !== 'number' ? parseInt(count) || 0 : count;
    chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#f44336' });
  };

  const sendMessageToContentScript = async (msg) => {
    try {
      const tab = await getCurrentTab();
      if (!tab?.id) {
        console.warn("No active tab found");
        return;
      }
      
      chrome.tabs.sendMessage(tab.id, msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Message error:", chrome.runtime.lastError.message);
          return;
        }
        
        if (msg.msg === "getPopUpCount" && response?.count !== undefined) {
          cachedPopupCount = response.count;
          elements.popupCounter.innerText = response.count;
          updateBadge(response.count);
        }
      });
    } catch (error) {
      console.error("Error sending message:", error);
      
      // Use cached count if communication fails
      if (msg.msg === "getPopUpCount") {
        elements.popupCounter.innerText = cachedPopupCount;
        updateBadge(cachedPopupCount);
      }
    }
  };

  const loadSettings = async () => {
    return new Promise(resolve => {
      chrome.storage.local.get(['globalSettings'], result => {
        globalSettings = result.globalSettings || {
          scoring: {
            baseThreshold: 6.5,
            highConfidenceThreshold: 8
          },
          learning: { 
            enabled: true,
            confidenceThreshold: 9
          }
        };
        resolve(globalSettings);
      });
    });
  };

  const saveSettings = () => {
    chrome.storage.local.set({ globalSettings });
    sendMessageToContentScript({ msg: "updateSettings", settings: globalSettings });
  };

  const updateDetectionStrength = (event) => {
    const strength = event.target.value;
    
    const strengthSettings = {
      high: { baseThreshold: 5.5, highConfidenceThreshold: 7.0 },
      medium: { baseThreshold: 6.5, highConfidenceThreshold: 8.0 },
      low: { baseThreshold: 8.0, highConfidenceThreshold: 9.0 }
    };
    
    globalSettings.scoring = strengthSettings[strength] || strengthSettings.medium;
    saveSettings();
  };

  const toggleLearning = (enabled) => {
    if (!globalSettings.learning) {
      globalSettings.learning = {};
    }
    globalSettings.learning.enabled = enabled;
    saveSettings();
  };

  const checkExtensionStatus = async () => {
    try {
      if (currentDomain) {
        chrome.storage.local.get([`disabled_${currentDomain}`], (result) => {
          elements.disableCheckbox.checked = result[`disabled_${currentDomain}`] === true;
        });
      }
    } catch (error) {
      console.error("Error checking extension status:", error);
    }
  };

  const resetDomainPatterns = () => {
    if (!currentDomain) return;
    
    chrome.storage.local.get(['learnedPatterns'], result => {
      try {
        if (!result.learnedPatterns) return;
        
        const patterns = JSON.parse(result.learnedPatterns);
        const learnedPatterns = new Map(patterns);
        
        learnedPatterns.delete(currentDomain);
        
        chrome.storage.local.set({ 
          'learnedPatterns': JSON.stringify(Array.from(learnedPatterns.entries()))
        });
        
        sendMessageToContentScript({
          msg: "resetPatterns",
          domain: currentDomain
        });
        
        if (elements.resetStatus) {
          elements.resetStatus.textContent = "Reset complete!";
          setTimeout(() => {
            elements.resetStatus.textContent = "";
          }, 1500);
        }
      } catch (e) {
        console.error("Error resetting patterns:", e);
      }
    });
  };

  const setupEventListeners = () => {
    if (elements.disableCheckbox) {
      elements.disableCheckbox.addEventListener("click", (e) => {
        if (currentDomain) {
          const isDisabled = e.target.checked;
          chrome.storage.local.set({ [`disabled_${currentDomain}`]: isDisabled });
          
          sendMessageToContentScript({
            msg: isDisabled ? "disableExtension" : "enableExtension",
          });
        }
      });
    }

    if (elements.detectionStrength) {
      elements.detectionStrength.addEventListener("change", updateDetectionStrength);
    }

    if (elements.learningToggle) {
      elements.learningToggle.addEventListener("change", (e) => {
        toggleLearning(e.target.checked);
      });
    }

    if (elements.resetButton) {
      elements.resetButton.addEventListener("click", resetDomainPatterns);
    }

    if (elements.settingsToggle && elements.settingsContent) {
      elements.settingsToggle.addEventListener("click", () => {
        elements.settingsToggle.classList.toggle("collapsed");
        elements.settingsContent.classList.toggle("collapsed");
      });
    }

    window.addEventListener("unload", () => {
      if (updateInterval) {
        clearInterval(updateInterval);
      }
    });
  };

  const initialize = async () => {
    await loadSettings();
    
    const tab = await getCurrentTab();
    if (tab) {
      currentDomain = getDomainFromUrl(tab.url);
      checkExtensionStatus();
      sendMessageToContentScript({ msg: "getPopUpCount" });
      
      // Initialize detection strength dropdown
      if (elements.detectionStrength && globalSettings.scoring) {
        const { baseThreshold } = globalSettings.scoring;
        
        if (baseThreshold <= 5.5) {
          elements.detectionStrength.value = 'high';
        } else if (baseThreshold >= 8.0) {
          elements.detectionStrength.value = 'low';
        } else {
          elements.detectionStrength.value = 'medium';
        }
      }
      
      // Initialize learning toggle
      if (elements.learningToggle) {
        elements.learningToggle.checked = globalSettings.learning?.enabled !== false;
      }
    }

    // Set up update interval
    updateInterval = setInterval(() => {
      sendMessageToContentScript({ msg: "getPopUpCount" });
    }, 1000);

    setupEventListeners();
  };

  return {
    initialize,
    updateBadge,
    sendMessageToContentScript
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  PopupController.initialize();
  
  // Toggle advanced settings section on initial load
  const settingsToggle = document.getElementById('settings-toggle');
  if (settingsToggle) {
    settingsToggle.addEventListener('click', function() {
      this.classList.toggle('collapsed');
      document.getElementById('settings-content').classList.toggle('collapsed');
    });
  }
});
