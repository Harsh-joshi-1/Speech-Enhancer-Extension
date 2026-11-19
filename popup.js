const toggleBtn = document.getElementById("enhancerToggleBtn");
const badge = document.getElementById("badge");
const statusLabel = document.getElementById("statusLabel");
const stateCard = document.getElementById("stateCard");
const mainTitle = document.getElementById("mainTitle");
const subTitle = document.getElementById("subTitle");

const slider = document.getElementById("gainFloorSlider");
const gainVal = document.getElementById("gainVal");
const recalibBtn = document.getElementById("recalibBtn");

let isEnabled = true;

// Load stored settings
chrome.storage.sync.get(["enabled", "gainFloor"], (data) => {
  if (data.enabled !== undefined) {
    isEnabled = data.enabled;
  }
  if (data.gainFloor !== undefined) {
    slider.value = data.gainFloor;
    gainVal.textContent = parseFloat(data.gainFloor).toFixed(2);
  }
  renderUI();
});

function renderUI() {
  if (isEnabled) {
    badge.className = "badge";
    statusLabel.textContent = "Active";
    toggleBtn.textContent = "Turn off";
    mainTitle.textContent = "Noise filter is active";
    subTitle.textContent = "Continuous ambient noise suppression in Google Meet and Zoom.";
    stateCard.className = "state-card dark-theme";
  } else {
    badge.className = "badge off";
    statusLabel.textContent = "Paused";
    toggleBtn.textContent = "Turn on";
    mainTitle.textContent = "Enhancement paused";
    subTitle.textContent = "Microphone audio passes through unaltered to your call.";
    stateCard.className = "state-card";
  }
}

function broadcastConfig(config) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "SPEECH_ENHANCER_CONFIG",
        ...config,
      }).catch(() => {});
    }
  });
}

toggleBtn.addEventListener("click", () => {
  isEnabled = !isEnabled;
  renderUI();
  chrome.storage.sync.set({ enabled: isEnabled });
  broadcastConfig({ enabled: isEnabled, gainFloor: parseFloat(slider.value) });
});

slider.addEventListener("input", () => {
  const val = parseFloat(slider.value).toFixed(2);
  gainVal.textContent = val;
  chrome.storage.sync.set({ gainFloor: parseFloat(val) });
  broadcastConfig({ enabled: isEnabled, gainFloor: parseFloat(val) });
});

recalibBtn.addEventListener("click", () => {
  broadcastConfig({ recalibrate: true });
  const originalHTML = recalibBtn.innerHTML;
  recalibBtn.textContent = "Recalibrated";
  setTimeout(() => {
    recalibBtn.innerHTML = originalHTML;
  }, 1200);
});
