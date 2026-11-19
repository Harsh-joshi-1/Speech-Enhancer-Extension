/**
 * Injected script into Google Meet / Zoom Web tabs.
 * Hooks navigator.mediaDevices.getUserMedia so when Meet/Zoom asks for microphone access,
 * we route the microphone stream through the in-browser WebAudio Wiener Filter AudioWorklet
 * and return the enhanced clean audio stream!
 */

(function () {
  const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let audioCtx = null;
  let workletNode = null;
  let isEnhancementEnabled = true;

  window.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SPEECH_ENHANCER_CONFIG") {
      isEnhancementEnabled = event.data.enabled;
      if (workletNode && event.data.gainFloor !== undefined) {
        workletNode.port.postMessage({ gainFloor: event.data.gainFloor });
      }
      if (workletNode && event.data.recalibrate) {
        workletNode.port.postMessage({ recalibrate: true });
      }
    }
  });

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    // If not requesting audio, passthrough
    if (!constraints || !constraints.audio) {
      return origGetUserMedia(constraints);
    }

    const realStream = await origGetUserMedia(constraints);

    if (!isEnhancementEnabled) {
      return realStream;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass({ sampleRate: 16000 });

      // Load the Wiener filter worklet
      const workletUrl = chrome.runtime.getURL("wiener_processor.js");
      await audioCtx.audioWorklet.addModule(workletUrl);

      const sourceNode = audioCtx.createMediaStreamSource(realStream);
      workletNode = new AudioWorkletNode(audioCtx, "wiener-filter-processor");
      const destNode = audioCtx.createMediaStreamDestination();

      sourceNode.connect(workletNode);
      workletNode.connect(destNode);

      console.log("[SpeechEnhancer] Microphone hooked and enhanced successfully for Meet/Zoom!");

      // Return the enhanced audio stream to Meet/Zoom
      const enhancedTrack = destNode.stream.getAudioTracks()[0];
      
      // Keep real video tracks if user requested video
      const tracks = [...realStream.getVideoTracks(), enhancedTrack];
      return new MediaStream(tracks);
    } catch (err) {
      console.error("[SpeechEnhancer] AudioWorklet failed, falling back to raw mic:", err);
      return realStream;
    }
  };
})();

