const htmlDiv = document.getElementById("html");
const btn = document.getElementById("btn");
const cookieCheckBox = document.getElementById("cookie-pop-up-check-input");
const signUpCheckBox = document.getElementById("sign-up-pop-up-check-input");

const getCurrentTab = async () => {
  let queryOptions = { active: true, currentWindow: true };
  let [tab] = await chrome.tabs.query(queryOptions);
  return tab;
};

const sendMessageToContentScript = async (msg) => {
  let tab = await getCurrentTab();
  chrome.tabs.sendMessage(tab.id, msg);
};

btn.addEventListener("click", (e) => {
  sendMessageToContentScript({ greeting: "getDom" });
});

cookieCheckBox.addEventListener("click", (e) => {
  if (e.target.checked) {
    sendMessageToContentScript({ msg: "cookieBlockerChecked" });
  } else {
    console.log("checked not checked");
    sendMessageToContentScript({ msg: "cookieBlockerUnChecked" });
  }
});
