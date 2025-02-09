const htmlDiv = document.getElementById("html");
const disableExtensionCheckBox = document.getElementById(
  "disable-extension-check-input"
);
const popUpCountIndicator = document.getElementById("pop-up-count");

const getCurrentTab = async () => {
  let queryOptions = { active: true, currentWindow: true };
  let [tab] = await chrome.tabs.query(queryOptions);
  return tab;
};

const sendMessageToContentScript = async (msg) => {
  let tab = await getCurrentTab();
  chrome.tabs.sendMessage(tab.id, msg, (response) => {
    if (
      msg.msg === "getPopUpCount" &&
      response &&
      response.count !== undefined
    ) {
      popUpCountIndicator.innerText = response.count;
    }
  });
};

disableExtensionCheckBox.addEventListener("click", (e) => {
  sendMessageToContentScript({
    msg: e.target.checked ? "disableExtension" : "enableExtension",
  });
});

setInterval(() => {
  sendMessageToContentScript({ msg: "getPopUpCount" });
}, 1000);
