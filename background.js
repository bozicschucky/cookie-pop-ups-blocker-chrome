let color = "#3aa757";

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.sync.set({ color });
  console.log("default color is " + color);
});
