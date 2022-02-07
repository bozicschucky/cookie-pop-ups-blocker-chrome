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

  // make the cookie divs invisible
  cookieElms.forEach((el) => {
    el.style.display = "none";
  });
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.msg === "cookieBlockerChecked") {
    chrome.storage.sync.set({ blockCookies: true });
  }
  if (msg.msg === "cookieBlockerUnChecked") {
    chrome.storage.sync.set({ blockCookies: false });
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.blockCookies) {
    removeCookieElements();
  }
});

//disable the cookie popups on the page start up
chrome.storage.sync.get("blockCookies", (storage) => {
  const cookiesBlocked = storage.blockCookies;
  if (cookiesBlocked) {
    removeCookieElements();
  }
});
