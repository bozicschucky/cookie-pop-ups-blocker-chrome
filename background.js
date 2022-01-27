let color = "#3aa757";
const contextMenusItems = ["disable cookie popup", "disable sign up popup"];

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.sync.set({ color });
  console.log("default color is " + color);
  for (const menu of contextMenusItems) {
    chrome.contextMenus.create({
      id: menu,
      title: menu,
      type: "normal",
      contexts: ["selection"],
    });
  }
});
