const htmlDiv = document.getElementById("html");
const btn = document.getElementById("btn");

btn.addEventListener("click", (e) => {
  console.log("the btn has been clicked");

  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    var tab = tabs[0];
    console.log(tab.url, tab.title);

    chrome.tabs.sendMessage(tab.id, { greeting: "getDom" }, function (msg) {
      msg = msg || {};
      console.log("onResponse", msg.msg);
    });
  });
});
