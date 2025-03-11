// ==UserScript==
// @name         YouTube VK Toggle Translation for French, German, Russian, Ukrainian
// @namespace    http://tampermonkey.net/
// @version      1.5
// @license      Unlicense
// @description  Toggle translation for YouTube and VK videos with a fixed translation box
// @author       Jim Chen
// @homepage     https://jimchen.me
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://vkvideo.ru/*
// @run-at       document-idle
// ==/UserScript==
(function () {
  "use strict";
  let lastUrl = location.href;
  let processingSubtitles = false;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleVideoNavigation();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  handleVideoNavigation();

  async function handleVideoNavigation() {
    if (processingSubtitles) return;
    processingSubtitles = true;

    let subtitleURL;
    if (window.location.href.includes("youtube.com")) {
      subtitleURL = await extractSubtitleUrlYouTube();
    } else {
      subtitleURL = await extractSubtitleUrlVK();
    }

    if (!subtitleURL) {
      processingSubtitles = false;
      return;
    }

    if (window.location.href.includes("youtube.com")) {
      await addOneSubtitleYouTube(subtitleURL);
    } else {
      await addOneSubtitleVK(subtitleURL, 5, 1000);
    }

    processingSubtitles = false;
  }

  async function extractSubtitleUrlYouTube() {
    function extractYouTubeVideoID() {
      const url = window.location.href;
      const patterns = {
        standard: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([^&]+)/,
        embed: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/,
        mobile: /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([^?]+)/,
      };

      let videoID = null;

      if (patterns.standard.test(url)) {
        videoID = url.match(patterns.standard)[1];
      } else if (patterns.embed.test(url)) {
        videoID = url.match(patterns.embed)[1];
      } else if (patterns.mobile.test(url)) {
        videoID = url.match(patterns.mobile)[1];
      }

      return videoID;
    }
    let videoID = extractYouTubeVideoID();
    if (videoID == null) return;

    const playerData = await new Promise((resolve) => {
      const checkForPlayer = () => {
        let ytAppData = document.querySelector("#movie_player");
        let captionData = ytAppData?.getPlayerResponse()?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (captionData) {
          const fetchedBaseUrl = captionData[0].baseUrl;
          const fetchedVideoID = fetchedBaseUrl.match(/[?&]v=([^&]+)/)?.[1];
          if (fetchedVideoID !== videoID) setTimeout(checkForPlayer, 1000);
          else resolve(captionData);
        } else setTimeout(checkForPlayer, 1000);
      };
      checkForPlayer();
    });

    if (!playerData) return;
    const hasForeignTrack = playerData.some(({ vssId }) => /(ru|uk|de|fr)/.test(vssId));
    if (hasForeignTrack) {
      const autoGeneratedTrack = playerData.find((track) => ["a.ru", "a.uk", "a.de", "a.fr"].includes(track.vssId));
      const manualTrack = playerData.find((track) => ["ru", "uk", "de", "fr"].some((code) => track.vssId.includes(code)));
      const otherTrack = autoGeneratedTrack || manualTrack;
      if (!otherTrack) return;
      return `${otherTrack.baseUrl}&fmt=vtt`;
    }
  }

  async function extractSubtitleUrlVK() {
    const url = window.location.href;
    const vkPattern = /(?:https?:\/\/)?(?:www\.)?vkvideo\.ru\/video-?\d+_(\d+)/;
    const vkMatch = url.match(vkPattern);
    if (!vkMatch) return null;

    const subtitleElement =  document.querySelector('[id^="vk_external_ru_"]')
    if (subtitleElement) {
      const subtitleUrl = subtitleElement.getAttribute("src");
      if (subtitleUrl) return subtitleUrl;
    }

    return await new Promise((resolve) => {
      const checkForSubtitle = () => {
        const subtitleElement =  document.querySelector('[id^="vk_external_ru_"]')
        if (subtitleElement) {
          const subtitleUrl = subtitleElement.getAttribute("src");
          if (subtitleUrl) resolve(subtitleUrl);
          else resolve(null);
        } else {
          setTimeout(checkForSubtitle, 1000);
        }
      };
      checkForSubtitle();
    });
  }

  async function addOneSubtitleYouTube(url, maxRetries = 5, delay = 1000) {
    let currentVideo = document.querySelector("video");
    if (!currentVideo) return;

    try {
      // Step 1: Parse VTT
      console.log(`[Dual Subs] Starting Step 1, Subtitle URL ${url}`);
      const response = await fetch(url);
      const subtitleData = await response.text();

      function parseVTTTime(timeStr) {
        const parts = timeStr.split(/[:.]/);
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]) + parseInt(parts[3]) / 1000;
      }

      function parseVTT(subtitleData) {
        const subtitleQueue = [];
        const lines = subtitleData.trim().split("\n");
        let i = 0;
        while (i < lines.length && !lines[i].includes("-->")) i++;
        while (i < lines.length) {
          const line = lines[i].trim();
          if (!line) {
            i++;
            continue;
          }
          const timeMatch = line.match(/(\d+:\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+)/);
          if (timeMatch) {
            const start = parseVTTTime(timeMatch[1]);
            const end = parseVTTTime(timeMatch[2]);
            const textLines = [];
            i++;
            while (i < lines.length && lines[i].trim()) {
              textLines.push(lines[i].trim());
              i++;
            }
            if (textLines.length > 0) {
              subtitleQueue.push({ start, end, textLines });
            }
          } else {
            i++;
          }
        }
        return subtitleQueue;
      }

      const subtitleQueue = parseVTT(subtitleData);

      // Step 2: Create HTML Elements with Fixed Translation Box
      console.log(`[Dual Subs] Starting Step 2, Trying to Insert Subtitle Element`);
      function createCaptionWindow() {
        const videoPlayer = document.querySelector(".html5-video-player");
        if (!videoPlayer) {
          console.error("HTML5 video player not found");
          return null;
        }

        const captionWindow = document.createElement("div");
        captionWindow.className = "caption-window ytp-caption-window-bottom";
        captionWindow.style.cssText = `
                    touch-action: none;
                    text-align: center;
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    bottom: 10%;
                    width: 90%;
                    max-width: 800px;
                `;

        const captionsText = document.createElement("span");
        captionsText.className = "captions-text";
        captionsText.style.cssText = "overflow-wrap: normal; display: block;";

        const captionVisualLine = document.createElement("span");
        captionVisualLine.className = "caption-visual-line";
        captionVisualLine.style.cssText = "display: block;";

        const ytpCaptionSegment = document.createElement("span");
        ytpCaptionSegment.className = "ytp-caption-segment";
        ytpCaptionSegment.style.cssText = `
                    display: inline-block;
                    white-space: pre-wrap;
                    background: rgba(8, 8, 8, 0.75);
                    font-size: 2.5vw;
                    color: rgb(255, 255, 255);
                    fill: rgb(255, 255, 255);
                `;

        // Add Fixed Translation Box
        const translationBox = document.createElement("div");
        translationBox.className = "translation-box";
        translationBox.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 8px;
        border-radius: 4px;
        font-size: 24px;
        top: -40px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999;
        display: none;
        transition: opacity 0.1s ease; /* Add smooth fade */
        opacity: 1;
    `;

        captionWindow.appendChild(translationBox);
        captionVisualLine.appendChild(ytpCaptionSegment);
        captionsText.appendChild(captionVisualLine);
        captionWindow.appendChild(captionsText);
        videoPlayer.appendChild(captionWindow);

        return { ytpCaptionSegment, translationBox };
      }

      const { ytpCaptionSegment, translationBox } = createCaptionWindow() || {};
      if (!ytpCaptionSegment || !translationBox) return;

      // Step 3: Setup Event Listener
      currentVideo.addEventListener("timeupdate", () => {
        const currentTime = currentVideo.currentTime;
        const currentSubtitle = subtitleQueue.find((sub) => currentTime >= sub.start && currentTime <= sub.end);
        updateSubtitle(currentSubtitle);
      });

      // Step 4: Display Subtitle and Fixed Translation
      const translationCache = new Map();

      async function translateText(text, targetLang = "en") {
        if (translationCache.has(text)) return translationCache.get(text);
        try {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
          const response = await fetch(url);
          const data = await response.json();
          const translatedText = data[0][0][0];
          translationCache.set(text, translatedText);
          return translatedText;
        } catch (error) {
          console.error("[Dual Subs] Translation error:", error);
          return text;
        }
      }

      // Debounce function to limit rapid hover events
      function debounce(func, wait) {
        let timeout;
        return function (...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func.apply(this, args), wait);
        };
      }

      let currentTranslation = {
        word: null,
        translation: null,
        visible: false,
      };

      function updateSubtitle(currentSubtitle) {
        while (ytpCaptionSegment.firstChild) ytpCaptionSegment.removeChild(ytpCaptionSegment.firstChild);

        // Only hide translation box if no word is being hovered
        if (!currentTranslation.visible) {
          translationBox.style.display = "none";
        } else {
          // Maintain translation box state
          translationBox.textContent = currentTranslation.translation;
          translationBox.style.display = "block";
        }

        if (!currentSubtitle) {
          ytpCaptionSegment.style.display = "none";
          return;
        }

        ytpCaptionSegment.style.display = "inline-block";

        currentSubtitle.textLines.forEach((line) => {
          const lineSpan = document.createElement("span");
          lineSpan.style.display = "block";

          if (line.includes("<c>")) {
            const currentTime = currentVideo.currentTime;
            const timeTagRegex = /<(\d{2}:\d{2}:\d{2}\.\d{3})><c>(.*?)<\/c>/g;
            let lastIndex = 0;
            let wordArray = [];
            let timeArray = [];

            let match;
            while ((match = timeTagRegex.exec(line)) !== null) {
              const timeStr = match[1];
              const text = match[2];
              const time = parseVTTTime(timeStr);

              if (match.index > lastIndex) {
                const untaggedText = line.slice(lastIndex, match.index).trim();
                if (untaggedText) {
                  wordArray.push(untaggedText);
                  timeArray.push(currentSubtitle.start);
                }
              }

              wordArray.push(text);
              timeArray.push(time);
              lastIndex = timeTagRegex.lastIndex;
            }

            if (lastIndex < line.length) {
              const untaggedText = line.slice(lastIndex).trim();
              if (untaggedText) {
                wordArray.push(untaggedText);
                timeArray.push(currentSubtitle.start);
              }
            }

            let currentWordIndex = 0;
            for (let i = 0; i < wordArray.length; i++) {
              if (currentTime >= timeArray[i]) currentWordIndex = i;
              else break;
            }

            wordArray.forEach((word, index) => {
              const wordSpan = document.createElement("span");
              wordSpan.textContent = word + " ";
              wordSpan.className = "subtitle-word";
              wordSpan.style.cursor = "pointer";

              if (index < currentWordIndex) {
                wordSpan.style.color = "#ffffff";
              } else if (index === currentWordIndex && currentTime >= timeArray[index]) {
                const startTime = timeArray[index];
                const endTime = index + 1 < timeArray.length ? timeArray[index + 1] : currentSubtitle.end;
                const progress = (currentTime - startTime) / (endTime - startTime);
                wordSpan.style.cssText = `
                                    background: linear-gradient(to right, #ffffff 50%, #888888 50%);
                                    background-size: 200% 100%;
                                    background-position: ${100 - progress * 100}%;
                                    color: transparent;
                                    background-clip: text;
                                    -webkit-background-clip: text;
                                    transition: background-position 0.1s linear;
                                `;
              } else {
                wordSpan.style.color = "#888888";
              }

              // Debounced hover for translation
              const showTranslation = debounce(async () => {
                const translation = await translateText(word);
                translationBox.textContent = translation;
                translationBox.style.display = "block";
              }, 200);

              wordSpan.addEventListener("mouseenter", async () => {
                currentTranslation.word = word;
                currentTranslation.visible = true;

                // Only fetch translation if not already cached
                if (!translationCache.has(word)) {
                  const translation = await translateText(word);
                  translationBox.textContent = translation;
                  currentTranslation.translation = translation;
                } else {
                  translationBox.textContent = translationCache.get(word);
                  currentTranslation.translation = translationCache.get(word);
                }

                translationBox.style.display = "block";
              });

              wordSpan.addEventListener("mouseleave", () => {
                currentTranslation.visible = false;
                translationBox.style.display = "none";
              });

              lineSpan.appendChild(wordSpan);
            });
          } else {
            // For regular words without timing
            const words = line.split(" ");
            words.forEach((word) => {
              const wordSpan = document.createElement("span");
              wordSpan.textContent = word + " ";
              wordSpan.className = "subtitle-word";
              wordSpan.style.color = "#ffffff";
              wordSpan.style.cursor = "pointer";

              // Same approach for non-timed words
              wordSpan.addEventListener("mouseenter", async () => {
                currentTranslation.word = word;
                currentTranslation.visible = true;

                if (!translationCache.has(word)) {
                  const translation = await translateText(word);
                  translationBox.textContent = translation;
                  currentTranslation.translation = translation;
                } else {
                  translationBox.textContent = translationCache.get(word);
                  currentTranslation.translation = translationCache.get(word);
                }

                translationBox.style.display = "block";
              });

              wordSpan.addEventListener("mouseleave", () => {
                currentTranslation.visible = false;
                translationBox.style.display = "none";
              });

              lineSpan.appendChild(wordSpan);
            });
          }

          ytpCaptionSegment.appendChild(lineSpan);
        });
      }
      // Add CSS
      const styleSheet = document.createElement("style");
      styleSheet.textContent = `
                @keyframes slideColor {
                    0% { background-position: 100%; }
                    100% { background-position: 0%; }
                }
                .subtitle-word:hover {
                    text-decoration: underline;
                }
                @media (max-width: 768px) {
                    .ytp-caption-segment {
                        font-size: 20px;
                    }
                    .translation-box {
                        font-size: 24px;
                        padding: 6px;
                    }
                }
            `;
      document.head.appendChild(styleSheet);

      console.log(`[Dual Subs] Subtitle and Translation Setup Complete`);
    } catch (error) {
      console.error("[Dual Subs] Error:", error);
      if (maxRetries > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return addOneSubtitleYouTube(url, maxRetries - 1, delay);
      }
    }
  }

  async function addOneSubtitleVK(url, maxRetries = 5, delay = 1000) {
    let currentVideo = document.querySelector("video");
    if (!currentVideo) return;

    try {
      // Step 1: Parse VTT
      console.log(`[Dual Subs VK] Starting Step 1, Subtitle URL ${url}`);
      const response = await fetch(url);
      const subtitleData = await response.text();

      function parseVTTTime(timeStr) {
        const parts = timeStr.split(/[:.]/);
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]) + parseInt(parts[3]) / 1000;
      }

      function parseVTT(subtitleData) {
        const subtitleQueue = [];
        const lines = subtitleData.trim().split("\n");
        let i = 0;
        while (i < lines.length && !lines[i].includes("-->")) i++;
        while (i < lines.length) {
          const line = lines[i].trim();
          if (!line) {
            i++;
            continue;
          }
          const timeMatch = line.match(/(\d+:\d+:\d+\.\d+)\s+-->\s+(\d+:\d+:\d+\.\d+)/);
          if (timeMatch) {
            const start = parseVTTTime(timeMatch[1]);
            const end = parseVTTTime(timeMatch[2]);
            const textLines = [];
            i++;
            while (i < lines.length && lines[i].trim()) {
              textLines.push(lines[i].trim());
              i++;
            }
            if (textLines.length > 0) {
              subtitleQueue.push({ start, end, textLines });
            }
          } else {
            i++;
          }
        }
        return subtitleQueue;
      }

      const subtitleQueue = parseVTT(subtitleData);

      console.log(`[Dual Subs VK] Starting Step 2, Trying to Insert Subtitle Element for VK`);

      function createCaptionWindow() {
        const videoPlayer = document.querySelector(".videoplayer_media");
        if (!videoPlayer) {
          console.error("VK video player container not found");
          return null;
        }

        const captionWindow = document.createElement("div");
        captionWindow.className = "caption-window vk-caption-window-bottom";
        captionWindow.style.cssText = `
                touch-action: none;
                text-align: center;
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                bottom: 10%;
                width: 90%;
                max-width: 800px;
            `;

        const captionsText = document.createElement("span");
        captionsText.className = "captions-text";
        captionsText.style.cssText = "overflow-wrap: normal; display: block;";

        const captionVisualLine = document.createElement("span");
        captionVisualLine.className = "caption-visual-line";
        captionVisualLine.style.cssText = "display: block;";

        const vkCaptionSegment = document.createElement("span");
        vkCaptionSegment.className = "vk-caption-segment";
        vkCaptionSegment.style.cssText = `
                display: inline-block;
                white-space: pre-wrap;
                background: rgba(8, 8, 8, 0.75);
                font-size: 2.5vw;
                color: rgb(255, 255, 255);
                fill: rgb(255, 255, 255);
            `;

        const translationBox = document.createElement("div");
        translationBox.className = "translation-box";
        translationBox.style.cssText = `
                position: absolute;
                background: rgba(0, 0, 0, 0.9);
                color: white;
                padding: 8px;
                border-radius: 4px;
                font-size: 24px;
                top: -40px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 9999;
                display: none;
                transition: opacity 0.1s ease;
                opacity: 1;
            `;

        captionWindow.appendChild(translationBox);
        captionVisualLine.appendChild(vkCaptionSegment);
        captionsText.appendChild(captionVisualLine);
        captionWindow.appendChild(captionsText);
        videoPlayer.appendChild(captionWindow);

        return { vkCaptionSegment, translationBox };
      }

      const { vkCaptionSegment, translationBox } = createCaptionWindow() || {};
      if (!vkCaptionSegment || !translationBox) return;

      // Step 3: Setup Event Listener
      currentVideo.addEventListener("timeupdate", () => {
        const currentTime = currentVideo.currentTime;
        const currentSubtitle = subtitleQueue.find((sub) => currentTime >= sub.start && currentTime <= sub.end);
        updateSubtitle(currentSubtitle);
      });

      // Step 4: Display Subtitle and Fixed Translation
      const translationCache = new Map();

      async function translateText(text, targetLang = "en") {
        if (translationCache.has(text)) return translationCache.get(text);
        try {
          const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
          const response = await fetch(url);
          const data = await response.json();
          const translatedText = data[0][0][0];
          translationCache.set(text, translatedText);
          return translatedText;
        } catch (error) {
          console.error("[Dual Subs VK] Translation error:", error);
          return text;
        }
      }

      function debounce(func, wait) {
        let timeout;
        return function (...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func.apply(this, args), wait);
        };
      }

      let currentTranslation = {
        word: null,
        translation: null,
        visible: false,
      };

      function updateSubtitle(currentSubtitle) {
        while (vkCaptionSegment.firstChild) vkCaptionSegment.removeChild(vkCaptionSegment.firstChild);

        if (!currentTranslation.visible) {
          translationBox.style.display = "none";
        } else {
          translationBox.textContent = currentTranslation.translation;
          translationBox.style.display = "block";
        }

        if (!currentSubtitle) {
          vkCaptionSegment.style.display = "none";
          return;
        }

        vkCaptionSegment.style.display = "inline-block";

        currentSubtitle.textLines.forEach((line) => {
          const lineSpan = document.createElement("span");
          lineSpan.style.display = "block";

          if (line.includes("<c>")) {
            const currentTime = currentVideo.currentTime;
            const timeTagRegex = /<(\d{2}:\d{2}:\d{2}\.\d{3})><c>(.*?)<\/c>/g;
            let lastIndex = 0;
            let wordArray = [];
            let timeArray = [];

            let match;
            while ((match = timeTagRegex.exec(line)) !== null) {
              const timeStr = match[1];
              const text = match[2];
              const time = parseVTTTime(timeStr);

              if (match.index > lastIndex) {
                const untaggedText = line.slice(lastIndex, match.index).trim();
                if (untaggedText) {
                  wordArray.push(untaggedText);
                  timeArray.push(currentSubtitle.start);
                }
              }

              wordArray.push(text);
              timeArray.push(time);
              lastIndex = timeTagRegex.lastIndex;
            }

            if (lastIndex < line.length) {
              const untaggedText = line.slice(lastIndex).trim();
              if (untaggedText) {
                wordArray.push(untaggedText);
                timeArray.push(currentSubtitle.start);
              }
            }

            let currentWordIndex = 0;
            for (let i = 0; i < wordArray.length; i++) {
              if (currentTime >= timeArray[i]) currentWordIndex = i;
              else break;
            }

            wordArray.forEach((word, index) => {
              const wordSpan = document.createElement("span");
              wordSpan.textContent = word + " ";
              wordSpan.className = "subtitle-word";
              wordSpan.style.cursor = "pointer";

              if (index < currentWordIndex) {
                wordSpan.style.color = "#ffffff";
              } else if (index === currentWordIndex && currentTime >= timeArray[index]) {
                const startTime = timeArray[index];
                const endTime = index + 1 < timeArray.length ? timeArray[index + 1] : currentSubtitle.end;
                const progress = (currentTime - startTime) / (endTime - startTime);
                wordSpan.style.cssText = `
                                background: linear-gradient(to right, #ffffff 50%, #888888 50%);
                                background-size: 200% 100%;
                                background-position: ${100 - progress * 100}%;
                                color: transparent;
                                background-clip: text;
                                -webkit-background-clip: text;
                                transition: background-position 0.1s linear;
                            `;
              } else {
                wordSpan.style.color = "#888888";
              }
              wordSpan.addEventListener("mouseenter", async () => {
                currentTranslation.word = word;
                currentTranslation.visible = true;

                if (!translationCache.has(word)) {
                  const translation = await translateText(word);
                  translationBox.textContent = translation;
                  currentTranslation.translation = translation;
                } else {
                  translationBox.textContent = translationCache.get(word);
                  currentTranslation.translation = translationCache.get(word);
                }

                translationBox.style.display = "block";
              });

              wordSpan.addEventListener("mouseleave", () => {
                currentTranslation.visible = false;
                translationBox.style.display = "none";
              });

              lineSpan.appendChild(wordSpan);
            });
          } else {
            const words = line.split(" ");
            words.forEach((word) => {
              const wordSpan = document.createElement("span");
              wordSpan.textContent = word + " ";
              wordSpan.className = "subtitle-word";
              wordSpan.style.color = "#ffffff";
              wordSpan.style.cursor = "pointer";
              wordSpan.addEventListener("mouseenter", async () => {

                currentTranslation.word = word;
                currentTranslation.visible = true;

                if (!translationCache.has(word)) {
                  const translation = await translateText(word);
                  translationBox.textContent = translation;
                  currentTranslation.translation = translation;
                } else {
                  translationBox.textContent = translationCache.get(word);
                  currentTranslation.translation = translationCache.get(word);
                }

                translationBox.style.display = "block";
              });

              wordSpan.addEventListener("mouseleave", () => {
                currentTranslation.visible = false;
                translationBox.style.display = "none";
              });

              lineSpan.appendChild(wordSpan);
            });
          }

          vkCaptionSegment.appendChild(lineSpan);
        });
      }

      const styleSheet = document.createElement("style");
      styleSheet.textContent = `

            .vk-caption-window-bottom {
                z-index: 999999 !important; /* Higher than video player elements */
                pointer-events: auto !important;
            }
            .vk-caption-segment {
                z-index: 999999 !important;
                pointer-events: auto !important;
            }
            .subtitle-word {
                z-index: 999999 !important;
                pointer-events: auto !important;
            }
            @keyframes slideColor {
                0% { background-position: 100%; }
                100% { background-position: 0%; }
            }
            .subtitle-word:hover {
                text-decoration: underline;
            }
            @media (max-width: 768px) {
                .vk-caption-segment {  /* Changed from ytp-caption-segment */
                    font-size: 20px;
                }
                .translation-box {
                    font-size: 24px;
                    padding: 6px;
                }
            }
        `;
      document.head.appendChild(styleSheet);

      console.log(`[Dual Subs VK] Subtitle and Translation Setup Complete`);
    } catch (error) {
      console.error("[Dual Subs VK] Error:", error);
      if (maxRetries > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return addOneSubtitleVK(url, maxRetries - 1, delay); // Fixed recursive call to VK version
      }
    }
  }
})();
