const contextMenusItems = ["disable cookie popup", "disable sign up popup"];
async function getCurrentTab() {
  let queryOptions = { active: true, currentWindow: true };
  let [tab] = await chrome.tabs.query(queryOptions);
  return tab;
}

chrome.runtime.onInstalled.addListener(async function () {
  console.log("first time install");
  let tab = await getCurrentTab();
  console.log("🚀 ~ file: background.js ~ line 12 ~ tab", tab);
});

//listen for messages from contentScript.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("messages -->", msg);
});
