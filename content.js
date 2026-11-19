// Content script runs in Meet / Zoom tabs and bridges messages to injected page script
const s = document.createElement("script");
s.src = chrome.runtime.getURL("inject.js");
(document.head || document.documentElement).appendChild(s);
s.onload = () => s.remove();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  window.postMessage(msg, "*");
  sendResponse({ ok: true });
});

