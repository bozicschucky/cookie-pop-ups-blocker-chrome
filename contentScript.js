chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  const dom = document.documentElement.outerHTML;
  console.log("onMessage", msg, dom);
  if (msg.greeting == "getDom") {
    sendResponse({
      msg: "dom loaded",
      dom,
    });
  } else {
    sendResponse({});
  }
});
