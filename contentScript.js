const removeCookieElements = () => {
  const dom = document.querySelectorAll("*");
  // regex to match a sentence that contains the word cookie(s) case insensitive
  const regex = /cookie(s)?/gi;
  // regex that that matches a sentence that contains this site or this website
  const thisSiteRegex = /(this site|this website)/gi;
  // regex that matches a sentence that contains the word uses cookie(s) case insensitive
  const usesCookieRegex = /uses cookie(s)?/gi;

  // find all the elements that have the word cookie(s) in their text
  const AllCookieElements = Array.from(dom).filter(
    (el) =>
      (el.textContent.match(regex) && el.textContent.match(thisSiteRegex)) ||
      el.textContent.match(usesCookieRegex)
  );
  let cookieElms = [];

  // filter out the elements that are body or html
  AllCookieElements.forEach((el) => {
    if (el.tagName !== "BODY" && el.tagName !== "HTML") {
      cookieElms.push(el);
    }
  });

  // remove the cookie divs
  cookieElms.forEach((el) => el.remove());

  // make the cookie divs invisible
  cookieElms.forEach((el) => {
    el.style.display = "none";
  });
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.greeting == "getDom") {
    sendResponse({
      msg: "dom loaded",
      dom,
    });
  }
  if (msg.msg === "cookieBlockerChecked") {
    console.log(msg.msg);
    removeCookieElements();
  }
  if (msg.msg === "cookieBlockerUnChecked") {
    console.log(msg.msg);
  }
});
