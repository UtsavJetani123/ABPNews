/**
 * ABP TV Web Application - Splash Screen, Language Selection & Home Feed
 */

// Polyfill for AbortController in older TV browser engines (e.g. webOS 3.x/4.x/5.x)
if (typeof AbortController === "undefined") {
  window.AbortController = function() {
    this.signal = {};
    this.abort = function() {};
  };
}

// Prevent native focus-scroll displacement on older TV engines
window.addEventListener("scroll", function() {
  document.body.scrollTop = 0;
  document.body.scrollLeft = 0;
  if (document.documentElement) {
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
  }
});
window.addEventListener("DOMContentLoaded", function() {
  const preventScroll = function(el) {
    if (!el) return;
    el.addEventListener("scroll", function() {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
  };
  preventScroll(document.getElementById("home-screen"));
  preventScroll(document.querySelector(".home-content"));
  preventScroll(document.getElementById("language-screen"));
  preventScroll(document.getElementById("navigation-drawer"));
  document.querySelectorAll(".screen-view").forEach(preventScroll);
});

// Dynamic scale handler for TV aspect ratio fitting
(function() {
  function updateAppScale() {
    const scaleX = window.innerWidth / 960;
    const scaleY = window.innerHeight / 540;
    const scale = Math.min(scaleX, scaleY);
    document.documentElement.style.setProperty('--app-scale', scale.toString());
  }
  window.addEventListener('resize', updateAppScale);
  window.addEventListener('DOMContentLoaded', updateAppScale);
  updateAppScale();
})();

// Helper for ES5 compatible object assign (removes ES6/ES2018 object spread dependencies)
function assign(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];
    if (source) {
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }
  }
  return target;
}

// Global State
const APP_STATE = {
  deviceToken: localStorage.getItem("device_token") || null,
  deviceId: localStorage.getItem("device_uuid") || null,
  hmacSecret: "ABP_CTV_RELEASE_HMAC_SECRET_KEY_VERSION_A72_FS51_BUILD_2026_a9e4f41032a0152454657e3ef61a3ccb9c1a68a941998a0afff40fd8777ecef6",
  baseUrl: "https://cheetah.abplive.com/v3/",
  selectedLanguage: localStorage.getItem("selected_language") || "hindi",
  currentScreen: "",
  languages: [],
  config: null,
  homeData: null
};

// Server clock offset correction (in seconds) to handle client clock drift
let serverTimeOffset = 0;

// Navigation coordinates for Home screen
let currentLanguageIndex = 2; // Default to Hindi (Index 2 in the array)
let activeSidebarIndex = 1;   // Default to Home item (Index 1)
let activeRailIndex = 0;
let activeCardIndex = 0;
let focusArea = "SIDEBAR";     // "SIDEBAR" or "GRID"
// Anchor Spotlight Section state
let anchorActiveTabIndex = 0; // Default to first tab (Chitra Tripathi)
let anchorSubFocus = "TABS";  // "TABS" or "CARDS"

// Live Player flow state variables
let livePlayTimer = null;
let liveHideTimer = null;
let isLiveVideoPlaying = false;
let hlsPlayer = null;
let playerActiveButton = "MUTE"; // "MUTE" or "FULLSCREEN"
let isMuted = false;

// Generate a random UUID for device tracking
function getOrGenerateDeviceUuid() {
  if (!APP_STATE.deviceId) {
    APP_STATE.deviceId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    localStorage.setItem("device_uuid", APP_STATE.deviceId);
  }
  return APP_STATE.deviceId;
}

// Calculate HMAC SHA-256 using SubtleCrypto
async function computeHMACSignature(timestamp, payload, secret) {
  try {
    const message = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);
    
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw", 
      keyData, 
      { name: "HMAC", hash: "SHA-256" }, 
      false, 
      ["sign"]
    );
    
    const signatureBuffer = await window.crypto.subtle.sign("HMAC", cryptoKey, messageData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (err) {
    console.error("HMAC signature generation failed:", err);
    return "";
  }
}

// Helper to clean up double slashes and URL-encode spaces in API image paths
function cleanAllUrlsInObject(obj) {
  if (!obj) return obj;
  
  if (typeof obj === "string") {
    if (obj.indexOf("http://") === 0 || obj.indexOf("https://") === 0) {
      // 1. Convert double slashes to single slashes (except the one after http/https protocol)
      var cleaned = obj.replace(/([^:]\/)\/+/g, "$1");
      // 2. URL encode spaces and special characters
      try {
        return encodeURI(cleaned).replace(/\(/g, "%28").replace(/\)/g, "%29");
      } catch (e) {
        return cleaned;
      }
    }
    return obj;
  }
  
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      obj[i] = cleanAllUrlsInObject(obj[i]);
    }
    return obj;
  }
  
  if (typeof obj === "object") {
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        obj[key] = cleanAllUrlsInObject(obj[key]);
      }
    }
    return obj;
  }
  
  return obj;
}

// Perform signed fetch calls to backend
async function fetchSigned(endpoint, method = "GET", bodyPayload = null, skipAuth = false, retryCount = 0) {
  const timestamp = Math.floor(Date.now() / 1000) + serverTimeOffset;
  const requestId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    let r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
  
  const payloadStr = bodyPayload ? (typeof bodyPayload === "string" ? bodyPayload : JSON.stringify(bodyPayload)) : "";
  const signature = await computeHMACSignature(timestamp, payloadStr, APP_STATE.hmacSecret);
  
  const headers = {
    "X-Device-ID": getOrGenerateDeviceUuid(),
    "X-Platform": "android_tv",
    "X-App-Version": "1.0.0",
    "X-Request-ID": requestId,
    "Content-Type": "application/json"
  };
  
  if (signature) {
    headers["X-Timestamp"] = timestamp.toString();
    headers["X-Signature"] = signature;
  }
  
  if (!skipAuth && APP_STATE.deviceToken) {
    headers["Authorization"] = `Bearer ${APP_STATE.deviceToken}`;
  }
  
  const controller = new AbortController();
  const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.protocol === "file:";
  const timeoutLimit = isLocalhost ? 60000 : 15000; // 60s for local testing/debugging, 15s for production TV device
  const timeoutId = setTimeout(() => controller.abort(), timeoutLimit);
  
  const options = {
    method,
    headers,
    signal: controller.signal
  };
  
  if (bodyPayload !== null && bodyPayload !== undefined) {
    options.body = payloadStr;
  } else if (method === "POST" || method === "PUT") {
    options.body = "";
  }
  
  const url = `${APP_STATE.baseUrl}${endpoint}`;
  console.log(`API FETCH: ${url} (offset: ${serverTimeOffset}s, retry: ${retryCount})`);
  
  try {
    const response = await fetch(url, options);
    clearTimeout(timeoutId);
    
    // Automatically correct client-server clock skew if signature/request expired fails
    if (response.status === 401 && retryCount < 1) {
      try {
        const cloneRes = response.clone();
        const json = await cloneRes.json();
        if (json.error === "Request expired" || json.error === "Invalid signature") {
          const serverDateStr = response.headers.get("date");
          if (serverDateStr) {
            const serverTime = new Date(serverDateStr).getTime();
            const clientTime = Date.now();
            serverTimeOffset = Math.floor((serverTime - clientTime) / 1000);
            console.warn(`Clock skew detected! Adjusted serverTimeOffset to ${serverTimeOffset}s. Retrying ${endpoint}...`);
            return await fetchSigned(endpoint, method, bodyPayload, skipAuth, retryCount + 1);
          }
        }
      } catch (jsonErr) {
        console.warn("Failed to check expired response json:", jsonErr);
      }
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const json = await response.json();
    return cleanAllUrlsInObject(json);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      console.warn(`API FETCH TIMEOUT/ABORTED (${timeoutLimit}ms): ${url}`);
    } else {
      console.error(`API FETCH ERROR: ${url} - Details: ${error.message || error}`, error);
    }
    throw error;
  }
}

/**
 * Universal ABP API response parser.
 * Tries every known envelope shape and returns the first array it finds.
 * Also logs the raw JSON structure so you can see exactly what the API returns.
 */
function parseItemsFromResponse(json, screenName) {
  if (!json) return [];

  console.log(`[${screenName}] RAW API response keys:`, Object.keys(json));
  console.log(`[${screenName}] RAW API response:`, JSON.stringify(json).substring(0, 500));

  // All container levels we probe
  const containers = [
    json,
    json.data,
    json.result,
    json.response,
    json.body,
    json.payload,
    json.data && json.data.data,
    json.data && json.data.response,
    json.data && json.data.result,
    json.result && json.result.data,
  ].filter(Boolean);

  // All array keys we accept (add more as needed)
  const arrayKeys = [
    "items", "data", "response", "results", "list",
    "listing", "videos", "content", "records", "entries",
    "posts", "articles", "shows", "shorts"
  ];

  for (const container of containers) {
    if (Array.isArray(container) && container.length > 0) {
      console.log(`[${screenName}] Found items as root array, count:`, container.length);
      return container;
    }
    for (const key of arrayKeys) {
      if (Array.isArray(container[key]) && container[key].length > 0) {
        console.log(`[${screenName}] Found items at key "${key}", count:`, container[key].length);
        if (container[key][0]) {
          console.log(`[${screenName}] First item keys:`, Object.keys(container[key][0]));
          console.log(`[${screenName}] First item:`, JSON.stringify(container[key][0]).substring(0, 300));
        }
        return container[key];
      }
    }
  }

  console.warn(`[${screenName}] Could not find items array in response. Full response:`, JSON.stringify(json).substring(0, 1000));
  return [];
}

function getItemImageUrl(item, layoutType) {
  if (!item) return "assets/placeholder.png";

  const landscapeKeys = [
    "thumbnail_image",
    "image_url",
    "image",
    "poster_image",
    "lg_poster_image",
    "banner_image",
    "hero_image"
  ];
  const portraitKeys = [
    "poster_image",
    "lg_poster_image",
    "thumbnail_image",
    "image_url",
    "image",
    "vertical_image",
    "portrait_image"
  ];
  const keys = layoutType === "portrait" ? portraitKeys : landscapeKeys;

  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return "assets/placeholder.png";
}

function extractPaginatedItems(json, screenName) {
  const parsedItems = parseItemsFromResponse(json, screenName);
  if (parsedItems.length > 0) {
    if (parsedItems[0] && Array.isArray(parsedItems[0].data)) {
      return parsedItems.flatMap(rail => Array.isArray(rail.data) ? rail.data : []);
    }
    return parsedItems;
  }

  const rails = json && json.data && json.data.response && Array.isArray(json.data.response.rails)
    ? json.data.response.rails
    : [];
  return rails.flatMap(rail => Array.isArray(rail.data) ? rail.data : []);
}


// Fetch Language master response from API
async function loadLanguageMaster() {
  try {
    console.log("Fetching language-master from API...");
    const res = await fetchSigned("language-master", "GET");
    if (res && res.success && res.data && res.data.response && Array.isArray(res.data.response.languages)) {
      APP_STATE.languages = res.data.response.languages.map(lang => ({
        lang_native: lang.lang_native,
        lang_code: lang.lang_code,
        lang_slug: lang.lang_slug,
        logo: lang.logo,
        bg_image: lang.bg_image,
        short_desc: lang.short_desc
      }));
      console.log("Languages loaded dynamically from API successfully.");
    } else {
      throw new Error("Invalid language payload structure");
    }
  } catch (err) {
    console.warn("Failed to load languages from live API. Falling back to local database...", err);
    APP_STATE.languages = [
      { lang_native: "தமிழ்", lang_code: "ta", lang_slug: "tamil", logo: "assets/language_logos/nadu_h.svg", bg_image: "assets/bg_language_news.png", short_desc: "" },
      { lang_native: "ગુજરાતી", lang_code: "gu", lang_slug: "gujarati", logo: "assets/language_logos/asmita_h.svg", bg_image: "assets/bg_language_news.png", short_desc: "" },
      { lang_native: "हिन्दी", lang_code: "hi", lang_slug: "hindi", logo: "assets/language_logos/news_h.svg", bg_image: "assets/bg_language_news.png", short_desc: 'अपने ऐप की डिफ़ॉल्ट भाषा के रूप में "हिंदी" का चयन करें।' },
      { lang_native: "বাংলা", lang_code: "bn", lang_slug: "bengali", logo: "assets/language_logos/ananda_h.svg", bg_image: "assets/bg_language_maza.png", short_desc: "" },
      { lang_native: "मराठी", lang_code: "mr", lang_slug: "marathi", logo: "assets/language_logos/majha_h.svg", bg_image: "assets/bg_language_maza.png", short_desc: '"मराठी" आपल्या ॲप भाषेच्या डिफॉल्ट म्हणून सेट करा.' }
    ];
  }
}

// Layout Screen view transitions
function switchScreen(screen) {
  const previousScreen = APP_STATE.currentScreen;
  if (previousScreen === "HOME" && screen !== "HOME") {
    resetLivePlayer();
    hideHomeLiveBackdrop();
  }

  const currentActive = document.querySelector(".screen-view.active-screen");
  if (currentActive) {
    currentActive.classList.remove("active-screen");
  }
  
  APP_STATE.currentScreen = screen;
  
  const bgContainer = document.getElementById("background-player-container");
  const sidebarContainer = document.getElementById("global-sidebar-container");
  if (sidebarContainer) {
    if (screen === "LANGUAGE" || screen === "VIDEOS" || screen === "TVSHOWS" || screen === "SHORTVIDEOS") {
      sidebarContainer.style.display = "none";
    } else {
      sidebarContainer.style.display = "block";
    }
  }
  
  let targetScreenEl = null;
  if (screen === "LANGUAGE") {
    targetScreenEl = document.getElementById("language-screen");
    if (bgContainer) {
      bgContainer.style.display = "block";
    }
  } else if (screen === "HOME") {
    targetScreenEl = document.getElementById("home-screen");
    if (bgContainer) {
      bgContainer.style.display = "none"; // Hide backdrop gradients/images on Home screen
    }
  } else if (screen === "SEARCH") {
    targetScreenEl = document.getElementById("search-screen");
    if (bgContainer) {
      bgContainer.style.display = "none";
    }
  } else if (screen === "VIDEOS") {
    targetScreenEl = document.getElementById("videos-screen");
    if (bgContainer) bgContainer.style.display = "none";
  } else if (screen === "TVSHOWS") {
    targetScreenEl = document.getElementById("tvshows-screen");
    if (bgContainer) bgContainer.style.display = "none";
  } else if (screen === "SHORTVIDEOS") {
    targetScreenEl = document.getElementById("shortvideos-screen");
    if (bgContainer) bgContainer.style.display = "none";
  }
  
  if (targetScreenEl) {
    targetScreenEl.classList.add("active-screen");
  }
}

// Renders the horizontal language selection cards inside the slider container
function renderLanguageCarousel() {
  const container = document.getElementById("language-strip-container");
  if (!container) return;
  
  let slider = document.getElementById("language-slider");
  if (!slider) {
    slider = document.createElement("div");
    slider.id = "language-slider";
    container.appendChild(slider);
  }
  
  slider.innerHTML = "";
  
  APP_STATE.languages.forEach((lang, idx) => {
    const card = document.createElement("div");
    card.className = "lang-card";
    card.innerHTML = `<img src="${lang.logo}" alt="${lang.lang_native}">`;
    
    // Clicking card triggers selection
    card.addEventListener("click", () => {
      confirmLanguageSelection(lang.lang_slug);
    });
    
    slider.appendChild(card);
  });
  
  updateLanguageCarouselFocus();
}

// Adjusts active card scaling and translates the slider to center the focused element
function updateLanguageCarouselFocus() {
  const slider = document.getElementById("language-slider");
  if (!slider) return;
  
  const cards = Array.from(slider.children);
  const len = cards.length;
  if (len === 0) return;
  
  // Clamp index to array bounds (preventing wrap-around)
  currentLanguageIndex = Math.max(0, Math.min(currentLanguageIndex, len - 1));
  
  cards.forEach((card, idx) => {
    let offset = idx - currentLanguageIndex;
    if (offset > 2) offset -= len;
    if (offset < -2) offset += len;
    
    card.className = "lang-card";
    card.removeAttribute("tabindex");
    card.removeAttribute("id");
    
    if (offset === 0) {
      card.classList.add("focused");
      card.setAttribute("tabindex", "0");
      card.id = "focused-language-card";
      card.focus({ preventScroll: true });
    } else if (Math.abs(offset) > 1) {
      card.classList.add("opacity-low");
    }
  });
  
  // Centering translation: 402 - activeIndex * 176
  const translateX = 402 - currentLanguageIndex * 176;
  slider.style.transform = `translateX(${translateX}px)`;
  
  // Prevent browser auto-scroll behavior on TV focus events
  const resetScroll = () => {
    const screenEl = document.getElementById("language-screen");
    if (screenEl) {
      screenEl.scrollLeft = 0;
      screenEl.scrollTop = 0;
    }
    const stripEl = document.getElementById("language-strip-container");
    if (stripEl) {
      stripEl.scrollLeft = 0;
      stripEl.scrollTop = 0;
    }
    document.body.scrollLeft = 0;
    document.body.scrollTop = 0;
  };
  resetScroll();
  setTimeout(resetScroll, 0);
  
  // Update backdrop and center group previews
  const activeLang = APP_STATE.languages[currentLanguageIndex];
  if (activeLang) {
    const backdropEl = document.getElementById("backdrop-image");
    if (backdropEl) {
      if (activeLang.bg_image) {
        backdropEl.style.backgroundImage = `url('${activeLang.bg_image}')`;
        backdropEl.style.opacity = "0.45"; // Blend with container's red linear gradient backdrop
      } else {
        backdropEl.style.backgroundImage = "none";
        backdropEl.style.opacity = "0"; // Shows container's red linear gradient
      }
    }
    
    const logoPreview = document.getElementById("language-logo-preview");
    if (logoPreview) {
      logoPreview.src = activeLang.logo;
    }
    
    const subtitle = document.getElementById("language-subtitle");
    if (subtitle) {
      // Force English default subtitle style exactly matching the design
      const displayLangName = activeLang.lang_slug.charAt(0).toUpperCase() + activeLang.lang_slug.slice(1);
      subtitle.innerText = `"${displayLangName}" will be set as your default app language.`;
    }
  }
}

// Triggers when language is chosen/confirmed
async function confirmLanguageSelection(slug) {
  console.log(`Language selected and confirmed: ${slug}`);
  APP_STATE.selectedLanguage = slug;
  localStorage.setItem("selected_language", slug);
  
  showToast(`Loading ${slug.toUpperCase()} feed...`);
  
  try {
    // Parallel fetch configuration and home feed from cheetah server
    const [configRes, homeRes] = await Promise.all([
      fetchSigned(`${slug}/getConfig`, "GET"),
      fetchSigned(`${slug}/home`, "GET")
    ]);
    
    if (configRes && configRes.navigation && configRes.navigation.primary) {
      APP_STATE.config = configRes;
      localStorage.setItem("app_config", JSON.stringify(configRes));
    }
    
    if (homeRes && homeRes.data && homeRes.data.response) {
      APP_STATE.homeData = homeRes.data.response;
    }
    
    await openHomeScreen();
  } catch (err) {
    console.error("Failed to load language feed from live API:", err);
    showToast("API load failed. Falling back to local data...");
    
    // Backup/fallback home data
    APP_STATE.homeData = {
      rails: [
        {
          title: "Top TV Shows",
          items: [
            { title: "महादंगल", poster_image: "assets/placeholder.png", video_duration: "30:00 Min", description: "Sansani | Ketan Agrawal Murder Case" },
            { title: "जनहित", poster_image: "assets/placeholder.png", video_duration: "30:00 Min", description: "Janhit | Crime News and Investigative report" },
            { title: "सास बहू और साजिश", poster_image: "assets/placeholder.png", video_duration: "30:00 Min", description: "Saas Bahu Aur Saazish | Celebrity updates" }
          ]
        }
      ]
    };
    await openHomeScreen();
  }
}

// Show standard TV UI toast message
function showToast(message, duration = 3000) {
  const toast = document.getElementById("error-toast");
  if (toast) {
    toast.innerText = "";
    toast.classList.add("hidden-element");
  }
}

// Open language screen setup handler
async function openLanguageSelectionScreen() {
  console.log("Opening language selection screen...");
  await loadLanguageMaster();
  
  // Set index matching cached language slug
  const matchedIdx = APP_STATE.languages.findIndex(l => l.lang_slug === APP_STATE.selectedLanguage);
  if (matchedIdx !== -1) {
    currentLanguageIndex = matchedIdx;
  }
  
  switchScreen("LANGUAGE");
  renderLanguageCarousel();
}

// Initializer and Splash Screen flow
window.addEventListener("DOMContentLoaded", async () => {
  const savedLanguage = localStorage.getItem("selected_language");
  if (savedLanguage) {
    APP_STATE.selectedLanguage = savedLanguage;
  }

  // Try loading cached config first for faster startups
  const savedConfig = localStorage.getItem("app_config");
  if (savedConfig) {
    try {
      APP_STATE.config = JSON.parse(savedConfig);
      console.log("Loaded cached config from localStorage.");
    } catch (e) {
      console.error("Failed to parse cached config:", e);
    }
  }

  // 1. Start device initialization and fetch configuration/home feed on splash screen
  const deviceInitPromise = (async () => {
    try {
      console.log("Splash Screen API Call: Initializing device token...");
      const initRes = await fetchSigned("device/init", "POST", "", true);
      if (initRes && initRes.success && initRes.data && initRes.data.access_token) {
        APP_STATE.deviceToken = initRes.data.access_token;
        localStorage.setItem("device_token", APP_STATE.deviceToken);
        console.log("Splash Screen API Call: Access token saved successfully.");
        
        // Fetch config API
        console.log(`Splash Screen API Call: Fetching configuration for ${APP_STATE.selectedLanguage}...`);
        const configRes = await fetchSigned(`${APP_STATE.selectedLanguage}/getConfig`, "GET");
        if (configRes && configRes.navigation && configRes.navigation.primary) {
          APP_STATE.config = configRes;
          localStorage.setItem("app_config", JSON.stringify(configRes));
          console.log("Splash Screen API Call: Configuration saved successfully.");
        }
        
        // Fetch home feed if language is already selected
        if (savedLanguage) {
          console.log(`Splash Screen API Call: Fetching home feed for ${savedLanguage}...`);
          const homeRes = await fetchSigned(`${savedLanguage}/home`, "GET");
          if (homeRes && homeRes.data && homeRes.data.response) {
            APP_STATE.homeData = homeRes.data.response;
            console.log("Splash Screen API Call: Home feed saved successfully.");
          }
        }
      }
    } catch (err) {
      console.error("Splash Screen API Calls failed: " + (err ? (err.message || err.toString()) : "unknown"), err);
      // Fallback/backup mockup data on failure
      if (savedLanguage) {
        APP_STATE.homeData = {
          rails: [
            {
              title: "Top TV Shows",
              items: [
                { title: "महादंगल", poster_image: "assets/placeholder.png", video_duration: "30:00 Min", description: "Sansani | Ketan Agrawal Murder Case" },
                { title: "जनहित", poster_image: "assets/placeholder.png", video_duration: "30:00 Min", description: "Janhit | Crime News and Investigative report" },
                { title: "सास बहू और साजिश", poster_image: "assets/placeholder.png", video_duration: "30:00 Min", description: "Saas Bahu Aur Saazish | Celebrity updates" }
              ]
            }
          ]
        };
      }
    }
  })();
  
  // 2. Minimum splash animation delay of 4800ms
  const splashPromise = new Promise(resolve => setTimeout(resolve, 4800));
  
  // Wait for both device init/feeds load and minimum animation duration
  await Promise.all([deviceInitPromise, splashPromise]);
  
  // 3. Hide splash screen
  const splashEl = document.getElementById("splash-screen");
  if (splashEl) {
    splashEl.classList.add("hidden");
  }
  
  // 4. Navigate automatically to home or language selection
  if (savedLanguage) {
    await openHomeScreen();
  } else {
    await openLanguageSelectionScreen();
  }
});

/* ==========================================================================
   Home Screen Features & Layout Rendering
   ========================================================================== */

// Open Home screen and initialize focus
async function openHomeScreen() {
  console.log("Opening Home Screen...");
  switchScreen("HOME");
  
  // 1. Render Dynamic Navigation Drawer
  renderNavigationDrawer();
  
  // 2. Render Main Content Reels
  renderHomeRails();
  
  // 3. Reset and prepare Live TV autoplay flow
  resetLivePlayer();
  lastActiveRailIndex = -1;
  lastActiveCardIndex = -1;
  
  hideHomeLiveBackdrop();
  
  // 4. Set Initial Focus to the first item in the first row list
  focusArea = "GRID";
  activeSidebarIndex = getHomeSidebarIndex();
  activeRailIndex = 0;
  activeCardIndex = 0;
  
  collapseDrawer();
  updateSidebarFocus();
  updateGridFocus();
}

// Get all navigation elements inside sidebar in order
function getSidebarElements() {
  const topMenu = document.getElementById("drawer-top-menu");
  const bottomMenu = document.getElementById("drawer-bottom-menu");
  const topItems = topMenu ? Array.from(topMenu.children) : [];
  const bottomItems = bottomMenu ? Array.from(bottomMenu.children) : [];
  return topItems.concat(bottomItems);
}

function getHomeSidebarIndex() {
  const items = getSidebarElements();
  const homeIndex = items.findIndex(item => {
    const label = (item.querySelector(".nav-label")?.innerText || "").trim().toLowerCase();
    return label === "home";
  });
  return homeIndex >= 0 ? homeIndex : 0;
}

const FALLBACK_NAV_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='4' y='4' width='16' height='16' rx='3' fill='white'/%3E%3C/svg%3E";
const FALLBACK_NAV_ITEMS = [
  "Search",
  "Home",
  "Live TV",
  "Videos",
  "TV Shows",
  "Short Videos",
  "Languages",
  "Settings"
].map(label => ({
  icon: FALLBACK_NAV_ICON,
  label: { en: label }
}));

// Build dynamic navigation drawer from API configuration
function renderNavigationDrawer() {
  const topMenu = document.getElementById("drawer-top-menu");
  const bottomMenu = document.getElementById("drawer-bottom-menu");
  if (!topMenu || !bottomMenu) return;
  
  topMenu.innerHTML = "";
  bottomMenu.innerHTML = "";
  
  const items = APP_STATE.config && APP_STATE.config.navigation && Array.isArray(APP_STATE.config.navigation.primary)
    ? APP_STATE.config.navigation.primary
    : FALLBACK_NAV_ITEMS;
    
  items.forEach((item, idx) => {
      const navItem = document.createElement("div");
      navItem.className = "nav-item";
      navItem.setAttribute("data-index", idx.toString());
      
      const labelText = item.label.en || item.label[APP_STATE.selectedLanguage] || item.label.hi || "Menu Item";
      
      navItem.innerHTML = `
        <img src="${item.icon || FALLBACK_NAV_ICON}" alt="${labelText}">
        <span class="nav-label">${labelText}</span>
      `;
      
      navItem.addEventListener("click", () => {
        handleSidebarItemClick(item);
      });
      
      // Separate Languages and Settings to bottom section
      const lowerLabel = labelText.toLowerCase();
      if (lowerLabel === "language" || lowerLabel === "languages" || lowerLabel === "settings") {
        bottomMenu.appendChild(navItem);
      } else {
        topMenu.appendChild(navItem);
      }
    });
}

// Update focused nav item inside the sidebar
function updateSidebarFocus() {
  const items = getSidebarElements();
  if (items.length === 0) return;
  
  activeSidebarIndex = Math.max(0, Math.min(activeSidebarIndex, items.length - 1));
  
  items.forEach((item, idx) => {
    item.classList.remove("focused", "selected");
    if (idx === activeSidebarIndex) {
      if (focusArea === "SIDEBAR") {
        item.classList.add("focused");
        item.focus({ preventScroll: true });
      } else {
        item.classList.add("selected");
      }
    }
  });
  
  // Set hero watermark brand name dynamically matching focused sidebar item
  const activeItem = items[activeSidebarIndex];
  if (activeItem && focusArea === "SIDEBAR") {
    if (APP_STATE.currentScreen === "HOME") {
      hideHomeLiveBackdrop();
    }
    const label = activeItem.querySelector(".nav-label").innerText;
    document.getElementById("home-active-section-title").innerText = `Top ${label}`;
    document.getElementById("home-active-section-desc").innerText = `Browse our selected ${label} category from cheetah server.`;
  }
}

// Action handlers for sidebar menu clicks
function handleSidebarItemClick(item) {
  const labelEn = (item.label.en || "").toLowerCase();
  const labelHi = (item.label.hi || "").toLowerCase();
  const labelNormal = (item.label[APP_STATE.selectedLanguage] || "").toLowerCase();
  
  if (labelEn === "language" || labelEn === "languages" || labelHi === "language" || labelHi === "languages" || labelNormal === "language" || labelNormal === "languages" || labelEn.includes("language") || labelHi.includes("language") || labelNormal.includes("language")) {
    openLanguageSelectionScreen();
  } else if (labelEn === "search" || labelHi === "search" || labelNormal === "search" || labelEn.includes("search")) {
    openSearchScreen();
  } else if (labelEn === "tv shows" || labelHi === "tv shows" || labelNormal === "tv shows" || labelEn.includes("tv show") || labelEn.includes("show")) {
    openTVShowsScreen(item);
  } else if (labelEn === "short videos" || labelHi === "short videos" || labelNormal === "short videos" || labelEn.includes("short")) {
    openShortVideosScreen(item);
  } else if (labelEn === "videos" || labelHi === "videos" || labelNormal === "videos" || labelEn.includes("video")) {
    openVideosScreen(item);
  } else if (labelEn === "settings" || labelHi === "settings" || labelNormal === "settings") {
    showToast("Settings not implemented. Re-select language using the Languages item.");
  } else {
    if (APP_STATE.currentScreen === "SEARCH") {
      switchScreen("HOME");
      focusArea = "SIDEBAR";
      expandDrawer();
      updateSidebarFocus();
    } else {
      showToast(`Category switched to: ${item.label.en || "Category"}`);
    }
  }
}

// Expand navigation drawer layout
function expandDrawer() {
  const drawer = document.getElementById("navigation-drawer");
  const pill = document.getElementById("menu-pill");
  if (drawer) {
    drawer.classList.remove("drawer-pill", "drawer-icons");
    drawer.classList.add("drawer-expanded");
  }
  if (pill) {
    pill.classList.add("hidden");
  }
}

// Collapse navigation drawer layout
function collapseDrawer() {
  const drawer = document.getElementById("navigation-drawer");
  const pill = document.getElementById("menu-pill");
  if (drawer) {
    drawer.classList.remove("drawer-expanded", "drawer-icons");
    drawer.classList.add("drawer-pill");
  }
  if (pill) {
    pill.classList.remove("hidden");
  }
}

// Render dynamic content rails from home API response
// Helper to filter and split rails for home rendering (e.g. splitting most_popular_shows_rail into two rows)
function getHomeRenderRails() {
  const rails = APP_STATE.homeData && Array.isArray(APP_STATE.homeData.rails) ? APP_STATE.homeData.rails : [];
  const renderRails = [];
  
  rails.forEach(rail => {
    const items = rail.items || rail.data || [];
    if (items.length === 0) return;
    
    if (rail.card_type === "most_popular_shows_rail") {
      // Split into two rows
      const row1Items = items.slice(0, 2);
      const row2Items = items.slice(2);
      
      renderRails.push(assign({}, rail, {
        card_type: "most_popular_shows_rail_row1",
        items: row1Items
      }));
      
      if (row2Items.length > 0) {
        renderRails.push(assign({}, rail, {
          title: "", // No title for row 2
          card_type: "most_popular_shows_rail_row2",
          items: row2Items
        }));
      }
    } else {
      renderRails.push(assign({}, rail, {
        items: items // Normalise items vs data
      }));
    }
  });
  
  return renderRails;
}

/** Renders the shell for the Anchor Spotlight section */
function renderAnchorSpotlight(railEl, rail, rIdx) {
  railEl.style.display = "block"; // Override flex layout
  
  // Outer section wrapper
  railEl.innerHTML = `
    <div class="anchor-section">
      <!-- Section header with logo and TITLE -->
      <div class="anchor-section-header">
        <span class="anchor-abp-red-triangle">&#9650;</span>
        <span class="anchor-abp-logo-text">abp</span>
        <span class="anchor-title-text">ANCHORS</span>
      </div>
      
      <!-- Selectable Anchor Category Pills -->
      <div class="anchor-tabs-container">
        ${rail.data.map((anchor, idx) => `
          <div class="anchor-tab-btn ${idx === anchorActiveTabIndex ? 'active' : ''}" 
               data-rail="${rIdx}" 
               data-tab-idx="${idx}">
            ${anchor.anchor_name || anchor.anchor_english_name || ''}
          </div>
        `).join('')}
      </div>
      
      <div class="anchor-details-layout">
        <!-- Left content panel (selected anchor details & episodes) -->
        <div class="anchor-left-details">
          <h1 class="anchor-focused-name"></h1>
          <p class="anchor-focused-desc"></p>
          
          <div class="rail-scroll" id="rail-scroll-${rIdx}">
            <div class="rail-scroll-inner anchor-episodes-scroll-inner"></div>
          </div>
        </div>
        
        <!-- Right side anchor portrait cut-out -->
        <div class="anchor-right-portrait">
          <img class="anchor-portrait-img" src="" alt="Anchor Portrait">
        </div>
      </div>
    </div>
  `;
  
  // Populate the active anchor details & episodes
  updateAnchorSpotlightContent(railEl, rail, rIdx);
}

/** Removes the white/gray/colored background from an image using an adaptive flood-fill canvas algorithm */
function removeImageBackground(imgUrl, callback) {
  if (!imgUrl) {
    callback("");
    return;
  }
  
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = imgUrl;
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const width = canvas.width;
      const height = canvas.height;
      
      // Sample target background color from the top-left corner
      const targetR = data[0];
      const targetG = data[1];
      const targetB = data[2];
      
      // If the background is already very close to black (all channels < 28),
      // it already blends perfectly with the page black background, so skip keyout to avoid artifacts.
      if (targetR < 28 && targetG < 28 && targetB < 28) {
        console.log("Background is already black, skipping keyout.");
        callback(imgUrl);
        return;
      }
      
      const visited = new Uint8Array(width * height);
      const queue = [];
      const tolerance = 32; // Color distance tolerance threshold
      
      function isBackgroundPixel(r, g, b) {
        return Math.abs(r - targetR) < tolerance && 
               Math.abs(g - targetG) < tolerance && 
               Math.abs(b - targetB) < tolerance;
      }
      
      function addPixelToQueue(x, y) {
        if (x < 0 || x >= width || y < 0 || y >= height) return;
        const idx = y * width + x;
        if (visited[idx]) return;
        
        const r = data[idx * 4];
        const g = data[idx * 4 + 1];
        const b = data[idx * 4 + 2];
        
        if (isBackgroundPixel(r, g, b)) {
          visited[idx] = 1;
          queue.push(idx);
        }
      }
      
      // Seed from corners and edges
      addPixelToQueue(0, 0);
      addPixelToQueue(width - 1, 0);
      addPixelToQueue(0, height - 1);
      addPixelToQueue(width - 1, height - 1);
      
      for (let x = 0; x < width; x += 10) addPixelToQueue(x, 0);
      for (let y = 0; y < height; y += 10) {
        addPixelToQueue(0, y);
        addPixelToQueue(width - 1, y);
      }
      
      // BFS flood fill
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % width;
        const y = Math.floor(idx / width);
        
        // Clear background color pixel
        data[idx * 4 + 3] = 0;
        
        addPixelToQueue(x + 1, y);
        addPixelToQueue(x - 1, y);
        addPixelToQueue(x, y + 1);
        addPixelToQueue(x, y - 1);
      }
      
      ctx.putImageData(imgData, 0, 0);
      callback(canvas.toDataURL());
    } catch (e) {
      console.warn("CORS/Security error when processing image background:", e);
      callback(imgUrl);
    }
  };
  
  img.onerror = () => {
    callback(imgUrl);
  };
}

/** Updates the selected anchor details, portrait, and episodes cards in the DOM */
function updateAnchorSpotlightContent(railEl = null, rail = null, rIdx = null) {
  // Resolve arguments if not passed (from global state)
  if (!railEl || !rail || rIdx === null) {
    const container = document.getElementById("home-rails-container");
    if (!container) return;
    const rails = Array.from(container.querySelectorAll(".home-rail"));
    const renderRails = getHomeRenderRails();
    
    // Find the index of the anchor spotlight section
    const idx = renderRails.findIndex(r => r.card_type === "anchor_spotlight_section");
    if (idx === -1) return;
    
    railEl = rails[idx];
    rail = renderRails[idx];
    rIdx = idx;
  }
  
  if (!rail || !railEl || !rail.data) return;
  
  const anchor = rail.data[anchorActiveTabIndex];
  if (!anchor) return;
  
  // 1. Update text info
  const nameEl = railEl.querySelector(".anchor-focused-name");
  const descEl = railEl.querySelector(".anchor-focused-desc");
  if (nameEl) nameEl.textContent = anchor.anchor_name || anchor.anchor_english_name || "";
  if (descEl) descEl.textContent = anchor.description || anchor.short_description || "";
  
  // 2. Update active tab pill class
  const tabs = railEl.querySelectorAll(".anchor-tab-btn");
  tabs.forEach((tab, idx) => {
    if (idx === anchorActiveTabIndex) {
      tab.classList.add("active");
    } else {
      tab.classList.remove("active");
    }
  });
  
  // 3. Update right side portrait image
  const imgEl = railEl.querySelector(".anchor-portrait-img");
  if (imgEl) {
    const imgSrc = anchor.poster_image || anchor.lg_poster_image || anchor.thumbnail_image || "";
    imgEl.style.opacity = "0";
    removeImageBackground(imgSrc, (processedSrc) => {
      imgEl.src = processedSrc;
      imgEl.style.opacity = "1";
    });
  }
  
  // 4. Update episodes cards row
  const scrollInnerEl = railEl.querySelector(".anchor-episodes-scroll-inner");
  if (scrollInnerEl) {
    scrollInnerEl.innerHTML = "";
    // Reset transform position of row
    scrollInnerEl.style.transform = "translateX(0px)";
    scrollInnerEl.dataset.offset = "0";
    
    const episodes = anchor.episodes || [];
    episodes.forEach((episode, cIdx) => {
      const cardWrapper = document.createElement("div");
      cardWrapper.className = "card-focus-wrapper anchor-episode-wrapper";
      cardWrapper.setAttribute("data-rail", rIdx.toString());
      cardWrapper.setAttribute("data-card", cIdx.toString());
      
      cardWrapper.innerHTML = `
        <div class="anchor-episode-card">
          <div class="anchor-episode-thumb">
            <img src="${episode.poster_image || episode.thumbnail_image || 'assets/placeholder.png'}" alt="${episode.title || ''}">
          </div>
          <div class="anchor-episode-title">${episode.title || ""}</div>
        </div>
      `;
      
      cardWrapper.addEventListener("click", () => {
        showToast(`Playing video: ${episode.title}`);
      });
      
      scrollInnerEl.appendChild(cardWrapper);
    });
  }
}

// Render dynamic content rails from home API response
function toCssBackgroundImage(imageUrl) {
  if (!imageUrl) return "";
  return `url("${String(imageUrl).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

function getOriginalsBackgroundImage(rail, item) {
  return (item && (item.background_image || item.hero_image || item.bg_image || item.banner_image || item.lg_poster_image || item.poster_image || item.thumbnail_image))
    || rail.background_image
    || rail.hero_image
    || rail.bg_image
    || rail.banner_image
    || rail.poster_image
    || "";
}

function getLiveTvBackgroundImage(rail, item) {
  return (item && (
    item.background_image ||
    item.hero_image ||
    item.banner_image ||
    item.lg_poster_image ||
    item.poster_image ||
    item.thumbnail_image ||
    item.image_url ||
    item.image
  ))
    || (rail && (
      rail.background_image ||
      rail.hero_image ||
      rail.banner_image ||
      rail.lg_poster_image ||
      rail.poster_image
    ))
    || "assets/background.png";
}

function hideHomeLiveBackdrop() {
  const backdrop = document.getElementById("home-bg-backdrop");
  if (backdrop) {
    backdrop.style.opacity = "0";
  }
}

function showHomeLiveBackdrop(rail, item) {
  const backdrop = document.getElementById("home-bg-backdrop");
  if (backdrop && item) {
    backdrop.style.backgroundImage = toCssBackgroundImage(getLiveTvBackgroundImage(rail, item));
    backdrop.style.opacity = "1";
  }
}

function isLiveTvRailFocused() {
  const currentRail = getHomeRenderRails()[activeRailIndex];
  return focusArea === "GRID" && currentRail && currentRail.card_type === "live_tv_channel_rail";
}

function renderRedLoader(spanCols) {
  const cols = spanCols || 1;
  return `<div class="red-loader-wrap" style="grid-column: span ${cols};"><div class="red-loader" aria-label="Loading"></div></div>`;
}

function renderHomeRails() {
  const container = document.getElementById("home-rails-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  const renderRails = getHomeRenderRails();
  
  if (renderRails.length === 0) {
    container.innerHTML = `<div style="color: #aaa; text-align: center; margin-top: 40px;">No content feeds available for this language.</div>`;
    return;
  }
  
  const popularShowColors = [
    "#9B1C1C", // Deep Red (Janhit)
    "#8D5B4C", // Earthy Brown (Sidha Sawal)
    "#704A6B", // Purple-Grey (Bharat Ki Baat)
    "#50352A", // Dark Cocoa (Mahadangal)
    "#6D1B57", // Dark Magenta (Saas Bahu Aur Saazish)
    "#4E1F1F", // Deep Crimson (Sansani)
    "#2E4057"  // Steel Blue (fallback)
  ];
  
  let popularWrapper = null;
  
  renderRails.forEach((rail, rIdx) => {
    const railEl = document.createElement("div");
    railEl.className = "home-rail";
    railEl.style.display = "flex";
    railEl.style.flexDirection = "column";
    
    const titleText = rail.title || "";
    const isPopularRow1 = rail.card_type === "most_popular_shows_rail_row1";
    const isPopularRow2 = rail.card_type === "most_popular_shows_rail_row2";
    const isCategoryTopics = rail.card_type === "category_topics_rail";
    const isOriginalsShowcase = rail.card_type === "originals_featured_showcase";
    const isShortsRail = rail.card_type === "social_trending_shorts_rail";
    const isShortVideoNewsGrid = rail.card_type === "short_video_news_grid";
    const isAnchorSpotlight = rail.card_type === "anchor_spotlight_section";
    const isLiveTvRail = rail.card_type === "live_tv_channel_rail";

    if (isAnchorSpotlight) {
      renderAnchorSpotlight(railEl, rail, rIdx);
      container.appendChild(railEl);
      return;
    }

    if (isLiveTvRail) {
      railEl.style.display = "block";
      railEl.classList.add("live-tv-home-rail");
      railEl.innerHTML = `
        <div class="live-tv-hero-section">
          <div class="live-tv-rail-gradient"></div>
          <div class="rail-scroll live-tv-rail-scroll" id="rail-scroll-${rIdx}">
            <div class="rail-scroll-inner live-tv-scroll-inner"></div>
          </div>
          <div class="live-tv-down-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14"></path>
              <path d="m5 12 7 7 7-7"></path>
            </svg>
          </div>
        </div>
      `;
    } else if (isPopularRow1) {
      // Create a wrapper for the popular shows section with the background gradient image
      popularWrapper = document.createElement("div");
      popularWrapper.className = "popular-shows-section-wrapper";
      popularWrapper.style.width = "100%";
      popularWrapper.style.display = "flex";
      popularWrapper.style.flexDirection = "column";
      // popularWrapper.style.padding = "28px 0";
      popularWrapper.style.boxSizing = "border-box";
      
      railEl.innerHTML = `
        <div style="display: flex; align-items: flex-end; width: 100%; padding-left: 28px; box-sizing: border-box;">
          <!-- Left text block matching mockup -->
          <div style="width: 280px; display: flex; flex-direction: column; justify-content: flex-end; flex-shrink: 0; padding-bottom: 40px; text-align: left;">
            <span style="color: #E53935; font-size: 31px; font-weight: 800; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.8px;">${rail.title || "Top TV Shows"}</span>
            <span style="color: #FFF; font-size: 32px; font-weight: 800; line-height: 1.1; margin-bottom: 10px;">${rail.subtitle || "ABP News"}</span>
            <span style="color: #AAA; font-size: 12px; line-height: 1.4; max-width: 250px;">${rail.short_desc || ""}</span>
          </div>
          <!-- Right scroll row -->
          <div class="rail-scroll" id="rail-scroll-${rIdx}" style="flex: 1; min-width: 0; margin-left: 24px;">
            <div class="rail-scroll-inner"></div>
          </div>
        </div>
      `;
    } else if (isPopularRow2) {
      railEl.innerHTML = `
        <div class="rail-scroll" id="rail-scroll-${rIdx}" style="width: 100%;">
          <div class="rail-scroll-inner"></div>
        </div>
      `;
    } else if (isOriginalsShowcase) {
      // Originals Featured Showcase — full-width cinematic section with ranked card row
      const firstItem = (rail.items && rail.items[0]) || {};
      const bgImg = getOriginalsBackgroundImage(rail, firstItem);
      const heroImg = rail.hero_display_image || rail.featured_image
        || firstItem.lg_poster_image || firstItem.poster_image || "";
      const featuredTitle = rail.featured_title
        || firstItem.title
        || rail.title || "";
      
      railEl.style.display = "block"; // override flex-column for this special rail
      railEl.innerHTML = `
        <div class="originals-showcase">
          <!-- Full-section background image -->
          <div class="originals-bg"></div>
          <!-- Hero display image (show title art) on the right -->
          ${heroImg ? `<div class="originals-hero-img"></div>` : ""}
          <!-- Left-to-right gradient so left text stays readable -->
          <div class="originals-left-gradient"></div>
          <!-- Large decorative watermark behind content -->
          <div class="originals-watermark">ORIGINALS</div>
          <!-- Info panel: badge, title, Watch Now -->
          <div class="originals-info">
            <div class="originals-abp-badge">
              <img class="originals-abp-logo" src="assets/abp_live_logo.png" alt="abp">
              <span class="originals-badge-text">ORIGINALS</span>
            </div>
            <div class="originals-featured-title">${featuredTitle}</div>
            <button class="originals-watch-btn">&#9654;&nbsp;&nbsp;Watch Now</button>
          </div>
          <!-- Ranked card row at the bottom -->
          <div class="originals-cards-area">
            <div class="rail-scroll" id="rail-scroll-${rIdx}">
              <div class="rail-scroll-inner"></div>
            </div>
          </div>
        </div>
      `;
      const originalsBgEl = railEl.querySelector(".originals-bg");
      const originalsHeroEl = railEl.querySelector(".originals-hero-img");
      if (originalsBgEl && bgImg) {
        originalsBgEl.style.backgroundImage = toCssBackgroundImage(bgImg);
      }
      if (originalsHeroEl && heroImg) {
        originalsHeroEl.style.backgroundImage = toCssBackgroundImage(heroImg);
      }
    } else if (isShortsRail) {
      // Social Trending Shorts Rail — portrait cards with centered focus + description bar
      const sectionTitle = rail.title || "#ABPShorts";
      railEl.style.display = "block";
      railEl.innerHTML = `
        <div class="shorts-section">
          <div class="shorts-section-bg"></div>
          <div class="shorts-section-title">${sectionTitle}</div>
          <div class="rail-scroll" id="rail-scroll-${rIdx}">
            <div class="rail-scroll-inner shorts-scroll-inner"></div>
          </div>
          <div class="shorts-focused-desc" id="shorts-desc-${rIdx}"></div>
        </div>
      `;
    } else if (isShortVideoNewsGrid) {
      // Short Video News Grid — split layout with left panel text and right scrolling rail
      railEl.style.display = "block";
      railEl.innerHTML = `
        <div class="news-grid-section">
          <div class="news-grid-section-bg"></div>
          <div class="news-grid-container">
            <!-- Left Fixed Panel -->
            <div class="news-grid-left-panel">
              <h2 class="news-grid-heading">Short Videos</h2>
              <h1 class="news-grid-subheading">Big News</h1>
              <p class="news-grid-description">Catch the biggest stories in under a minute. Watch what matters - fast.</p>
            </div>
            <!-- Right Scrolling Panel -->
            <div class="news-grid-right-panel">
              <div class="rail-scroll" id="rail-scroll-${rIdx}">
                <div class="rail-scroll-inner news-grid-scroll-inner"></div>
              </div>
              <!-- Focused Description below the cards -->
              <div class="news-grid-focused-desc" id="news-grid-desc-${rIdx}"></div>
            </div>
          </div>
        </div>
      `;
    } else {
      railEl.innerHTML = `
        <div class="rail-title">${titleText}</div>
        <div class="rail-scroll" id="rail-scroll-${rIdx}">
          <div class="rail-scroll-inner"></div>
        </div>
      `;
    }
    
    const scrollEl = railEl.querySelector(".rail-scroll");
    const scrollInnerEl = scrollEl.querySelector(".rail-scroll-inner");
    const items = rail.items || [];
    
    items.forEach((item, cIdx) => {
      const cardWrapper = document.createElement("div");
      cardWrapper.className = "card-focus-wrapper";
      cardWrapper.setAttribute("data-rail", rIdx.toString());
      cardWrapper.setAttribute("data-card", cIdx.toString());
      
      if (isLiveTvRail) {
        const thumbSrc = getLiveTvBackgroundImage(rail, item);
        const title = item.title || item.name || "";
        const isLive = (item.is_live !== false) && ((item.news_type || "").toLowerCase() !== "video");

        cardWrapper.classList.add("live-tv-card-wrapper");
        cardWrapper.innerHTML = `
          <div class="live-tv-card">
            <img src="${thumbSrc}" alt="${title}">
            <div class="live-tv-card-shade"></div>
            ${isLive ? `
              <div class="live-tv-badge">
                <span class="live-tv-badge-icon">⌾</span>
                <span>LIVE TV</span>
              </div>
            ` : ""}
            <div class="live-tv-expand-dot" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H3v5"></path>
                <path d="M16 3h5v5"></path>
                <path d="M8 21H3v-5"></path>
                <path d="M16 21h5v-5"></path>
              </svg>
            </div>
          </div>
        `;
      } else if (isPopularRow1 || isPopularRow2) {
        // Render custom colored banner popular card
        const colorIdx = isPopularRow2 ? cIdx + 2 : cIdx;
        const bannerColor = popularShowColors[colorIdx % popularShowColors.length];
        
        cardWrapper.innerHTML = `
          <div class="popular-show-card">
            <div class="popular-show-card-image">
              <img src="${item.poster_image || 'assets/placeholder.png'}" alt="${item.title}">
            </div>
            <div class="popular-show-card-banner" style="background-color: ${bannerColor};">
              ${item.title || "Show Title"}
            </div>
          </div>
        `;
      } else if (isShortsRail) {
        // Portrait shorts card: thumbnail with overlays for badge, title, duration
        const thumbSrc = item.poster_image || item.thumbnail_image || "assets/placeholder.png";
        const rawDur = item.duration || item.video_duration || item.duration_text || "";
        const dur = rawDur.replace(/\s*min\s*/gi, "").trim();
        
        cardWrapper.innerHTML = `
          <div class="shorts-card">
            <img src="${thumbSrc}" alt="${item.title || ''}">
            <div class="shorts-card-top-overlay">
              <div class="shorts-abp-badge">
                <img src="assets/abp_live_logo.png" class="shorts-logo-img" alt="abp">
              </div>
              <div class="shorts-card-title-text">${item.title || ""}</div>
            </div>
            ${dur ? `<div class="shorts-duration-badge">${dur}</div>` : ""}
          </div>
        `;
      } else if (isShortVideoNewsGrid) {
        // Portrait short video card with a white banner across the middle containing the title in bold black
        const thumbSrc = item.poster_image || item.thumbnail_image || "assets/placeholder.png";
        const rawDur = item.duration || item.video_duration || item.duration_text || "";
        const dur = rawDur.replace(/\s*min\s*/gi, "").trim();
        
        // Alternate between purple ENT LIVE and red ABP LIVE badges
        const useEntLive = (cIdx % 4) < 2;
        let badgeHtml = "";
        if (useEntLive) {
          badgeHtml = `
            <div class="news-grid-ent-badge">
              <span>ENT LIVE</span>
            </div>
          `;
        } else {
          badgeHtml = `
            <div class="news-grid-abp-badge">
              <img src="assets/abp_live_logo.png" class="news-grid-logo-img" alt="abp">
            </div>
          `;
        }

        cardWrapper.innerHTML = `
          <div class="news-grid-card">
            <img src="${thumbSrc}" alt="${item.title || ''}">
            <!-- Top badge -->
            <div class="news-grid-card-top">
              ${badgeHtml}
            </div>
            <!-- Middle white banner overlay with title -->
            <div class="news-grid-card-middle">
              <div class="news-grid-title-banner">
                ${item.title || ""}
              </div>
            </div>
            <!-- Bottom duration -->
            ${dur ? `<div class="news-grid-duration-badge">${dur}</div>` : ""}
          </div>
        `;
      } else if (isOriginalsShowcase) {
        // Ranked card: large grey number + landscape thumbnail + title below
        cardWrapper.innerHTML = `
          <div class="originals-ranked-card">
            <span class="originals-rank-num">${cIdx + 1}</span>
            <div class="originals-ranked-thumb-block">
              <div class="originals-ranked-thumb">
                <img src="${item.poster_image || item.thumbnail_image || 'assets/placeholder.png'}" alt="${item.title || ''}">
              </div>
              <div class="originals-ranked-title">${item.title || ""}</div>
            </div>
          </div>
        `;
      } else if (isCategoryTopics) {
        // Category Topics Rail: 16:9 thumbnail with gradient overlay at bottom containing title + duration
        const thumbSrc = item.thumbnail_image || item.poster_image || "assets/placeholder.png";
        const rawDuration = item.duration || item.video_duration || item.duration_text || "";
        const duration = rawDuration.replace(/\s*min\s*/gi, "").trim();
        const durationHtml = duration ? `<span class="duration-badge">${duration}</span>` : "";
        
        // Rotating accent colors for the gradient overlay — gives each card a distinct look
        const categoryOverlayColors = [
          { a: "rgba(10,  10,  18,  0.46)", b: "rgba(12,  12,  28,  0.84)", c: "rgba(10,  10,  22,  0.97)" }, // Deep navy-black
          { a: "rgba(45,  28,   0,  0.46)", b: "rgba(60,  38,   4,  0.84)", c: "rgba(50,  30,   2,  0.97)" }, // Rich amber
          { a: "rgba(45,   5,   8,  0.46)", b: "rgba(65,   8,  12,  0.84)", c: "rgba(55,   5,   8,  0.97)" }, // Deep crimson
          { a: "rgba( 5,  32,  50,  0.46)", b: "rgba(  6, 42,  68,  0.84)", c: "rgba(  4, 34,  55,  0.97)" }, // Ocean blue
          { a: "rgba(28,   8,  45,  0.46)", b: "rgba( 38, 10,  60,  0.84)", c: "rgba( 30,  7,  50,  0.97)" }, // Deep violet
          { a: "rgba( 5,  38,  15,  0.46)", b: "rgba(  6, 50,  18,  0.84)", c: "rgba(  4, 40,  14,  0.97)" }, // Forest green
          { a: "rgba(45,  25,   5,  0.46)", b: "rgba( 60, 32,   6,  0.84)", c: "rgba( 50, 26,   4,  0.97)" }, // Burnt orange
          { a: "rgba(10,  38,  38,  0.46)", b: "rgba( 12, 50,  50,  0.84)", c: "rgba(  9, 40,  40,  0.97)" }, // Dark teal
        ];
        const col = categoryOverlayColors[cIdx % categoryOverlayColors.length];
        const overlayGradient = `linear-gradient(to bottom, transparent 0%, transparent 28%, ${col.a} 52%, ${col.b} 76%, ${col.c} 100%)`;
        
        cardWrapper.innerHTML = `
          <div class="category-topic-card">
            <div class="category-topic-thumbnail">
              <img src="${thumbSrc}" alt="${item.title || ''}">
              <div class="category-topic-overlay" style="background: ${overlayGradient};">
                <div class="category-topic-title">${item.title || ""}</div>
                ${durationHtml}
              </div>
            </div>
          </div>
        `;
      } else {
        // Determine aspect ratio class (16:9 for videos/trending, 2:3 for shows/anchors)
        const titleLower = titleText.toLowerCase();
        const isLandscape = titleLower.includes("trending") || titleLower.includes("video") || titleLower.includes("live") || titleLower.includes("auto") || titleLower.includes("sport");
        
        const cardWidthClass = isLandscape ? "video-card-width" : "show-card-width";
        const posterEl = isLandscape 
          ? `<div class="card-thumbnail-container" style="border-radius: 12px; overflow: hidden;"><img src="${item.poster_image || item.thumbnail_image || 'assets/placeholder.png'}" alt="${item.title}"></div>`
          : `<div class="show-card-poster" style="border-radius: 12px; overflow: hidden;"><img src="${item.poster_image || 'assets/placeholder.png'}" alt="${item.title}"></div>`;
        
        cardWrapper.innerHTML = `
          <div class="focusable-card ${cardWidthClass}">
            ${posterEl}
            <div class="show-card-title">${item.title || "Show Title"}</div>
          </div>
        `;
      }
      
      cardWrapper.addEventListener("click", () => {
        showToast(`Playing video: ${item.title}`);
      });
      
      scrollInnerEl.appendChild(cardWrapper);
    });
    
    if (isPopularRow1 || isPopularRow2) {
      if (popularWrapper) {
        popularWrapper.appendChild(railEl);
      }
      if (isPopularRow2 && popularWrapper) {
        container.appendChild(popularWrapper);
        popularWrapper = null;
      }
    } else {
      container.appendChild(railEl);
    }
  });
  
  // Safety append in case Row 2 was missing
  if (popularWrapper && popularWrapper.children.length > 0) {
    container.appendChild(popularWrapper);
  }
  
  // Update header brand logo
  const brandLogoEl = document.getElementById("home-brand-logo");
  const activeLang = APP_STATE.languages[currentLanguageIndex];
  if (activeLang) {
    if (brandLogoEl) brandLogoEl.src = activeLang.logo;
  }
}

// Helper to get absolute offset top of an element relative to a parent container
function getAbsoluteOffsetTop(element, targetContainer) {
  let offsetTop = 0;
  let curr = element;
  while (curr && curr !== targetContainer) {
    offsetTop += curr.offsetTop;
    curr = curr.offsetParent;
  }
  return offsetTop;
}

/** Returns the Watch Now button of the currently focused originals showcase rail, or null. */
function getOriginalsWatchBtn() {
  const container = document.getElementById("home-rails-container");
  if (!container) return null;
  const rails = Array.from(container.querySelectorAll(".home-rail"));
  const railEl = rails[activeRailIndex];
  return railEl ? railEl.querySelector(".originals-watch-btn") : null;
}

/** Adds/removes the focused class on the Watch Now button. */
function updateOriginalsButtonFocus(focused) {
  // Clear from all buttons first
  document.querySelectorAll(".originals-watch-btn").forEach(b => b.classList.remove("focused"));
  if (focused) {
    const btn = getOriginalsWatchBtn();
    if (btn) {
      btn.classList.add("focused");
      btn.focus({ preventScroll: true });
    }
  }
}

// Adjusts active card border and scrolls horizontal container
function updateGridFocus() {
  const container = document.getElementById("home-rails-container");
  if (!container) return;
  
  const rails = Array.from(container.querySelectorAll(".home-rail"));
  if (rails.length === 0) return;
  
  activeRailIndex = Math.max(0, Math.min(activeRailIndex, rails.length - 1));
  
  rails.forEach((railEl, rIdx) => {
    const scrollEl = railEl.querySelector(".rail-scroll");
    const scrollInnerEl = scrollEl ? scrollEl.querySelector(".rail-scroll-inner") : null;
    const cards = Array.from((scrollInnerEl || scrollEl).querySelectorAll(".card-focus-wrapper"));
    
    // Resolve this rail's data object (needed for originals showcase live-update)
    const renderRailsArr = getHomeRenderRails();
    const railData = renderRailsArr[rIdx] || null;
    
    // Reset non-active rails back to start position when focus moves to a different row
    if (rIdx !== activeRailIndex && scrollInnerEl) {
      scrollInnerEl.style.transform = "translateX(0px)";
      scrollInnerEl.dataset.offset = "0";
    }
    
    if (railData && railData.card_type === "anchor_spotlight_section") {
      // Clear all first
      const tabs = Array.from(railEl.querySelectorAll(".anchor-tab-btn"));
      tabs.forEach(tab => tab.classList.remove("focused"));
      cards.forEach(card => card.classList.remove("focused"));
      
      if (rIdx === activeRailIndex && focusArea === "GRID") {
        if (anchorSubFocus === "TABS") {
          // Focus the active tab
          const tab = tabs[anchorActiveTabIndex];
          if (tab) {
            tab.classList.add("focused");
            tab.focus({ preventScroll: true });
          }
        } else {
          // Focus the active episode card
          const targetCardIdx = Math.max(0, Math.min(activeCardIndex, cards.length - 1));
          activeCardIndex = targetCardIdx;
          const card = cards[targetCardIdx];
          if (card) {
            card.classList.add("focused");
            card.focus({ preventScroll: true });
            
            // Scroll logic for anchor episodes row (ensures focused card stays left of 480px wide right portrait)
            if (scrollInnerEl) {
              const currentOffset = parseFloat(scrollInnerEl.dataset.offset || "0");
              const cardLeft  = card.offsetLeft;
              const cardRight = cardLeft + card.offsetWidth;
              const viewWidth = scrollEl.clientWidth || 1280;
              const visibleWidth = Math.max(400, viewWidth - 480); // 480px right portrait width
              
              let newOffset = currentOffset;
              const scaleBuffer = Math.ceil(card.offsetWidth * 0.06) + 10;
              if (cardRight - currentOffset > visibleWidth - scaleBuffer) {
                newOffset = cardRight - visibleWidth + scaleBuffer + 28;
              } else if (cardLeft - currentOffset < 40) {
                newOffset = Math.max(0, cardLeft - 40);
              }
              
              if (newOffset < 0) newOffset = 0;
              
              scrollInnerEl.dataset.offset = String(newOffset);
              scrollInnerEl.style.transform = `translateX(-${newOffset}px)`;
            }
          }
        }
      }
      return; // Skip normal focus handling for this rail
    }
    
    let maxCardIdx = cards.length - 1;
    let targetCardIdx = activeCardIndex;
    if (rIdx === activeRailIndex) {
      targetCardIdx = Math.max(0, Math.min(activeCardIndex, maxCardIdx));
      activeCardIndex = targetCardIdx;
    }
    
    cards.forEach((card, cIdx) => {
      card.classList.remove("focused");
      if (rIdx === activeRailIndex && cIdx === targetCardIdx && focusArea === "GRID") {
        card.classList.add("focused");
        card.focus({ preventScroll: true });
        
        // --- Originals Showcase: update background + title on focus change ---
        if (railData && railData.card_type === "originals_featured_showcase") {
          const items = railData.items || [];
          const focusedItem = items[targetCardIdx];
          if (focusedItem) {
            const showcase = railEl.querySelector(".originals-showcase");
            const bgEl     = showcase && showcase.querySelector(".originals-bg");
            const titleEl  = showcase && showcase.querySelector(".originals-featured-title");
            
            const newBg = getOriginalsBackgroundImage(railData, focusedItem);
            if (bgEl && newBg) {
              bgEl.style.backgroundImage = toCssBackgroundImage(newBg);
            }
            if (titleEl && focusedItem.title) {
              titleEl.textContent = focusedItem.title;
            }
          }
        }
        // --- Shorts Rail: update description text + center-scroll on focus ---
        if (railData && railData.card_type === "social_trending_shorts_rail") {
          const items = railData.items || [];
          const focusedItem = items[targetCardIdx];
          const descEl = railEl.querySelector(".shorts-focused-desc");
          if (descEl) {
            descEl.textContent = (focusedItem && (focusedItem.description || focusedItem.title)) || "";
          }
        }
        // --- Short Video News Grid: update description text + center-scroll on focus ---
        if (railData && railData.card_type === "short_video_news_grid") {
          const items = railData.items || [];
          const focusedItem = items[targetCardIdx];
          const descEl = railEl.querySelector(".news-grid-focused-desc");
          if (descEl) {
            descEl.textContent = (focusedItem && (focusedItem.description || focusedItem.title)) || "";
          }
        }
        // --- Live TV Channel Rail: update only the home backdrop on focus ---
        if (railData && railData.card_type === "live_tv_channel_rail") {
          const items = railData.items || [];
          const focusedItem = items[targetCardIdx];
          showHomeLiveBackdrop(railData, focusedItem);
        }
        // -------------------------------------------------------------------
        
        if (scrollInnerEl) {
          // Transform-based scrolling: no scrollLeft, no overflow clipping.
          // card.offsetLeft is the card's natural layout position inside scrollInnerEl.
          // currentOffset is how many px we have already translateX'd to the left.
          const currentOffset = parseFloat(scrollInnerEl.dataset.offset || "0");
          const cardLeft  = card.offsetLeft;
          const cardRight = cardLeft + card.offsetWidth;
          // viewWidth: use scrollEl's clientWidth (CSS-defined width) as the visible viewport.
          const viewWidth = scrollEl.clientWidth || (scrollEl.parentElement ? scrollEl.parentElement.clientWidth : 700);
          
          let newOffset = currentOffset;
          
          if (railData && (railData.card_type === "social_trending_shorts_rail" || railData.card_type === "short_video_news_grid" || railData.card_type === "live_tv_channel_rail")) {
            // Tall/special rails: keep the focused card centered in the viewport
            newOffset = cardLeft - viewWidth / 2 + card.offsetWidth / 2;
          } else {
            // Standard rails: keep card within visible bounds
            const scaleBuffer = Math.ceil(card.offsetWidth * 0.06) + 10;
            if (cardRight - currentOffset > viewWidth - scaleBuffer - 16) {
              // Card right edge (after scale) would be outside viewport — slide left
              newOffset = cardRight - viewWidth + scaleBuffer + 28;
            } else if (cardLeft - currentOffset < 40) {
              // Card left edge is before visible area — slide right
              newOffset = Math.max(0, cardLeft - 40);
            }
          }
          
          if (newOffset < 0) newOffset = 0;
          
          scrollInnerEl.dataset.offset = String(newOffset);
          scrollInnerEl.style.transform = `translateX(-${newOffset}px)`;
        }
      }
    });
  });
  
  // Scroll parent container vertically to bring focused rail into view
  const activeRailEl = rails[activeRailIndex];
  if (activeRailEl && focusArea === "GRID") {
    const renderRails = getHomeRenderRails();
    const railData = renderRails[activeRailIndex];
    const isPopularRow1 = railData && railData.card_type === "most_popular_shows_rail_row1";
    const isPopularRow2 = railData && railData.card_type === "most_popular_shows_rail_row2";
    
    const railOffsetTop = getAbsoluteOffsetTop(activeRailEl, container);
    
    if (isPopularRow1 || isPopularRow2) {
      let row1El = activeRailEl;
      if (isPopularRow2) {
        row1El = rails[activeRailIndex - 1] || activeRailEl;
      }
      const row1Offset = getAbsoluteOffsetTop(row1El, container);
      container.scrollTop = row1Offset - 24;
    } else if (railData && (railData.card_type === "social_trending_shorts_rail" || railData.card_type === "short_video_news_grid" || railData.card_type === "anchor_spotlight_section")) {
      // Shorts, News Grid, and Anchors rails are tall, let's scroll so that the bottom is fully visible.
      const containerHeight = container.clientHeight || 500;
      const railHeight = activeRailEl.offsetHeight || 480;
      const railBottom = railOffsetTop + railHeight;
      // Scroll so that the bottom is aligned with the viewport bottom, with some padding.
      const targetScroll = railBottom - containerHeight + 36;
      container.scrollTop = Math.max(railOffsetTop - 20, targetScroll);
    } else if (railData && railData.card_type === "live_tv_channel_rail") {
      container.scrollTop = Math.max(0, railOffsetTop);
    } else if (railData && railData.card_type === "originals_featured_showcase") {
      // Originals showcase is also tall (approx 430px). Let's align its top with less offset to keep it fully visible.
      container.scrollTop = Math.max(0, railOffsetTop - 10);
    } else {
      if (activeRailIndex === 0) {
        container.scrollTop = 0;
      } else {
        container.scrollTop = railOffsetTop - 120;
      }
    }
    
    // Update top header description to match active focused rail card
    const titleEl = activeRailEl.querySelector(".rail-title");
    if (titleEl) {
      document.getElementById("home-active-section-title").innerText = titleEl.innerText;
      
      const renderRails = getHomeRenderRails();
      const railData = renderRails[activeRailIndex];
      if (railData) {
        const items = railData.items || [];
        if (items[activeCardIndex]) {
          document.getElementById("home-active-section-desc").innerText = items[activeCardIndex].description || items[activeCardIndex].title;
        }
      }
    }
  }
  
  // Track focus changes for Live TV autoplay flow
  handleGridFocusChange();
}

let lastActiveRailIndex = -1;
let lastActiveCardIndex = -1;

function handleGridFocusChange() {
  if (activeRailIndex !== lastActiveRailIndex || activeCardIndex !== lastActiveCardIndex) {
    console.log(`Focus coordinate change: [${lastActiveRailIndex}, ${lastActiveCardIndex}] -> [${activeRailIndex}, ${activeCardIndex}]`);
    
    lastActiveRailIndex = activeRailIndex;
    lastActiveCardIndex = activeCardIndex;
    
    // Clear auto-hide timer on navigate
    clearTimeout(liveHideTimer);
    
    const renderRails = getHomeRenderRails();
    const currentRailData = renderRails[activeRailIndex];
    const isLiveTVFocused = currentRailData && currentRailData.card_type === "live_tv_channel_rail";
    
    if (isLiveTVFocused) {
      // Focus is on the live TV rail
      const liveRail = currentRailData;
      let activeCard = null;

      if (liveRail) {
        const items = liveRail.items || liveRail.data || [];
        activeCard = items[activeCardIndex] || null;
      }

      if (activeCard) {
        // Every Live TV focus move stops the current video, shows the new card image,
        // then schedules playback for the newly focused item.
        resetLivePlayer();
        showHomeLiveBackdrop(liveRail, activeCard);
        startLivePlayTimer(activeCard);
      }
    } else {
      // Focus moved away: stop HLS video playback completely
      resetLivePlayer();
      hideHomeLiveBackdrop();
    }
  }
}

// Start the 10-second auto-play timer for the live TV channel rail
function startLivePlayTimer(item) {
  clearTimeout(livePlayTimer);

  let currentItem = item || null;

  if (!currentItem) {
    const liveRail = APP_STATE.homeData && Array.isArray(APP_STATE.homeData.rails)
      ? APP_STATE.homeData.rails.find(r => r.card_type === "live_tv_channel_rail")
      : null;
    const items = liveRail ? (liveRail.items || liveRail.data || []) : [];
    currentItem = items[activeCardIndex] || null;
  }

  if (currentItem && currentItem.video_url) {
    console.log(`Live Player: Scheduling auto-play for ${currentItem.title} in 10s...`);
    livePlayTimer = setTimeout(() => {
      playLiveVideo(currentItem);
    }, 10000);
  }
}

// Play live video using HLS.js or native HTML5 video player
function playLiveVideo(item) {
  const videoEl = document.getElementById("live-video-element");
  if (!videoEl) return;
  
  console.log(`Live Player: Starting video playback for: ${item.title}`);
  resetLivePlayer();
  
  isLiveVideoPlaying = true;
  const homeScreen = document.getElementById("home-screen");
  if (homeScreen) {
    homeScreen.classList.add("live-playing");
  }
  videoEl.muted = isMuted;
  
  if (Hls.isSupported()) {
    hlsPlayer = new Hls({
      enableWorker: true,
      lowLatencyMode: true
    });
    hlsPlayer.loadSource(item.video_url);
    hlsPlayer.attachMedia(videoEl);
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => {
      videoEl.play().catch(e => console.error("Error playing video via Hls.js:", e));
    });
    hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
      console.error("Hls.js error:", data);
    });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS playback support (like Safari)
    videoEl.src = item.video_url;
    videoEl.addEventListener('loadedmetadata', () => {
      videoEl.play().catch(e => console.error("Error playing native video:", e));
    });
  }
  
  // Reveal video, shift rails container downward, show seek bar
  const backdrop = document.getElementById("home-bg-backdrop");
  if (backdrop) {
    backdrop.style.opacity = "0"; // Fade out backdrop to reveal video
  }
  videoEl.style.opacity = "1";
  
  const railsContainer = document.getElementById("home-rails-container");
  if (railsContainer) {
    railsContainer.classList.add("scrolled-down");
    railsContainer.classList.remove("hidden-rails");
  }
  
  const controls = document.getElementById("live-player-controls");
  if (controls) {
    controls.classList.add("active");
  }
  
  // Set progress bars to 100% since it is a Live stream
  const fill = document.getElementById("player-progress-fill");
  const knob = document.getElementById("player-progress-knob");
  if (fill) fill.style.width = "100%";
  if (knob) knob.style.left = "100%";
  
  updatePlayerFocus();
  startLiveHideTimer();
}

// Reset the live player state, elements, and cancel timeouts
function resetLivePlayer() {
  clearTimeout(livePlayTimer);
  clearTimeout(liveHideTimer);
  
  isLiveVideoPlaying = false;
  const homeScreen = document.getElementById("home-screen");
  if (homeScreen) {
    homeScreen.classList.remove("live-playing");
  }
  
  const videoEl = document.getElementById("live-video-element");
  if (videoEl) {
    videoEl.pause();
    videoEl.src = "";
    videoEl.removeAttribute("src");
    videoEl.style.opacity = "0";
    videoEl.load();
  }
  
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  
  // Restore backdrop
  const backdrop = document.getElementById("home-bg-backdrop");
  if (backdrop) {
    backdrop.style.opacity = isLiveTvRailFocused() ? "1" : "0";
  }
  
  // Restore rails position and visibility
  const railsContainer = document.getElementById("home-rails-container");
  if (railsContainer) {
    railsContainer.classList.remove("scrolled-down", "hidden-rails");
  }
  
  // Hide controls
  const controls = document.getElementById("live-player-controls");
  if (controls) {
    controls.classList.remove("active");
  }
}

// Start the 5-second timer to auto-hide the row list and focus control buttons
function startLiveHideTimer() {
  clearTimeout(liveHideTimer);
  
  // Only start timer if focus is on grid, in the live rail, and video is playing
  const currentRail = getHomeRenderRails()[activeRailIndex];
  if (focusArea === "GRID" && currentRail && currentRail.card_type === "live_tv_channel_rail" && isLiveVideoPlaying) {
    liveHideTimer = setTimeout(() => {
      hideRailsAndFocusControls();
    }, 5000);
  }
}

// Auto-hide the row list of cards and automatically transfer focus to player control buttons
function hideRailsAndFocusControls() {
  console.log("Live Player: Auto-hiding rails container and focusing controls...");
  
  const railsContainer = document.getElementById("home-rails-container");
  if (railsContainer) {
    railsContainer.classList.add("hidden-rails");
  }
  
  // Shift focus area to PLAYER controls
  focusArea = "PLAYER";
  playerActiveButton = "MUTE"; // Focus Mute button by default
  
  updatePlayerFocus();
  updateGridFocus(); // Clears focus highlighting on active card
}

// Restore row list visibility and return focus to active grid card
function restoreRailsFromPlayer() {
  console.log("Live Player: Restoring rails and focusing grid...");
  
  const railsContainer = document.getElementById("home-rails-container");
  if (railsContainer) {
    railsContainer.classList.remove("hidden-rails");
  }
  
  focusArea = "GRID";
  updatePlayerFocus(); // Removes focus highlights from player buttons
  updateGridFocus();    // Highlights the active card
  
  // Reset the 5-second hide timer
  startLiveHideTimer();
}

// Update focused CSS classes for Mute and Fullscreen buttons
function updatePlayerFocus() {
  const muteBtn = document.getElementById("player-btn-mute");
  const fsBtn = document.getElementById("player-btn-fullscreen");
  
  if (muteBtn) muteBtn.classList.remove("focused");
  if (fsBtn) fsBtn.classList.remove("focused");
  
  if (focusArea === "PLAYER") {
    if (playerActiveButton === "MUTE" && muteBtn) {
      muteBtn.classList.add("focused");
      muteBtn.focus({ preventScroll: true });
    } else if (playerActiveButton === "FULLSCREEN" && fsBtn) {
      fsBtn.classList.add("focused");
      fsBtn.focus({ preventScroll: true });
    }
  }
}

// Toggle audio mute state
function toggleMute() {
  const videoEl = document.getElementById("live-video-element");
  if (!videoEl) return;
  
  isMuted = !isMuted;
  videoEl.muted = isMuted;
  
  const path = document.getElementById("svg-mute-icon").querySelector("path");
  if (path) {
    if (isMuted) {
      // Muted icon path (speaker with no waves)
      path.setAttribute("d", "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z");
      showToast("Muted");
    } else {
      // Unmuted icon path
      path.setAttribute("d", "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z");
      showToast("Unmuted");
    }
  }
}

// Toggle native full screen mode
function toggleFullScreen() {
  const videoEl = document.getElementById("live-video-element");
  if (!videoEl) return;
  
  if (!document.fullscreenElement) {
    videoEl.requestFullscreen().catch(err => {
      console.error(`Error attempting to enable full-screen mode: ${err.message}`);
    });
    showToast("Full Screen Mode");
  } else {
    document.exitFullscreen();
  }
}

// Search Feature State & Helpers
const SEARCH_STATE = {
  query: "",
  history: ["SS", "S", "Breaking News"],
  results: [],
  focusArea: "KEYBOARD", // "BACK", "PROFILE", "INPUT", "VOICE", "HISTORY", "RESULTS", "KEYBOARD"
  keyboardRow: 0,
  keyboardCol: 0,
  historyIndex: 0,
  resultIndex: 0,
  isShiftActive: false
};
const SEARCH_HISTORY_VISIBLE_LIMIT = 3;

function getVisibleSearchHistoryCount() {
  return Math.min(SEARCH_STATE.history.length, SEARCH_HISTORY_VISIBLE_LIMIT);
}

const KEYBOARD_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "."],
  ["↑", "z", "x", "c", "v", "b", "n", "m", "@", "⌫"],
  ["?123", "CLR", "◀", "▶", " ", "-", "_", "→"]
];

function openSearchScreen() {
  switchScreen("SEARCH");
  
  // Render Keyboard and History
  renderKeyboard();
  renderHistoryChips();
  
  // Reset query and results
  SEARCH_STATE.query = "";
  SEARCH_STATE.results = [];
  SEARCH_STATE.focusArea = "KEYBOARD";
  SEARCH_STATE.keyboardRow = 0;
  SEARCH_STATE.keyboardCol = 0;
  SEARCH_STATE.historyIndex = 0;
  SEARCH_STATE.resultIndex = 0;

  // Set focus to the sidebar Search item initially
  focusArea = "SIDEBAR";
  activeSidebarIndex = 0;
  expandDrawer();
  updateSidebarFocus();
  
  const queryDisplay = document.getElementById("search-query-display");
  if (queryDisplay) {
    queryDisplay.innerText = "Search for shows, videos...";
    queryDisplay.classList.add("search-placeholder");
  }
  
  // When user opens search screen, immediately fetch default entertainment data and render design below
  performSearch("");
  
  // Add direct click event listeners
  const backBtn = document.getElementById("search-back-btn");
  if (backBtn) {
    backBtn.onclick = () => {
      switchScreen("HOME");
      focusArea = "SIDEBAR";
      activeSidebarIndex = 1; // back to Home
      expandDrawer();
      updateSidebarFocus();
    };
  }
  const profileBtn = document.getElementById("search-profile-btn");
  if (profileBtn) {
    profileBtn.onclick = () => {
      showToast("Profile clicked");
    };
  }
  const searchInputField = document.getElementById("search-bar-input-field");
  if (searchInputField) {
    searchInputField.onclick = () => {
      SEARCH_STATE.focusArea = "KEYBOARD";
      SEARCH_STATE.keyboardRow = 0;
      SEARCH_STATE.keyboardCol = 0;
      updateSearchFocus();
    };
  }
  const voiceBtn = document.getElementById("voice-search-button");
  if (voiceBtn) {
    voiceBtn.onclick = () => {
      showToast("Voice Search not implemented");
    };
  }
  
  updateSearchFocus();
}

function renderKeyboard() {
  const container = document.getElementById("tv-keyboard");
  if (!container) return;
  
  container.innerHTML = "";
  
  KEYBOARD_ROWS.forEach((row, rIdx) => {
    const rowEl = document.createElement("div");
    rowEl.className = "keyboard-row";
    
    row.forEach((key, cIdx) => {
      const keyBtn = document.createElement("button");
      keyBtn.className = "key-btn";
      keyBtn.setAttribute("data-row", rIdx.toString());
      keyBtn.setAttribute("data-col", cIdx.toString());
      
      let displayKey = key;
      if (key === " ") {
        keyBtn.classList.add("space-key");
        displayKey = "␣";
      } else if (key === "→") {
        keyBtn.classList.add("action-key");
      } else if (key === "↑") {
        if (SEARCH_STATE.isShiftActive) {
          keyBtn.classList.add("shift-active");
        }
      } else if (key === "?123" || key === "CLR" || key === "⌫") {
        keyBtn.classList.add("compact-key");
      }
      
      // If shift is active and it's a lowercase character, render uppercase
      if (SEARCH_STATE.isShiftActive && key.length === 1 && key >= 'a' && key <= 'z') {
        displayKey = key.toUpperCase();
      }
      
      keyBtn.innerText = displayKey;
      
      // Add click handler
      keyBtn.addEventListener("click", () => handleKeyboardKeyPress(key));
      rowEl.appendChild(keyBtn);
    });
    
    container.appendChild(rowEl);
  });
}

function renderHistoryChips() {
  const container = document.getElementById("search-suggestions-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  if (SEARCH_STATE.history.length === 0) {
    container.innerHTML = `<div style="color: #666; font-size: 13px;">No recent searches</div>`;
    return;
  }
  
  SEARCH_STATE.history.slice(0, SEARCH_HISTORY_VISIBLE_LIMIT).forEach((item, idx) => {
    const chip = document.createElement("div");
    chip.className = "history-chip";
    chip.setAttribute("data-index", idx.toString());
    
    // Add clock history SVG icon
    chip.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span>${item}</span>
    `;
    
    chip.addEventListener("click", () => {
      SEARCH_STATE.query = item;
      const queryDisplay = document.getElementById("search-query-display");
      if (queryDisplay) {
        queryDisplay.innerText = item;
        queryDisplay.classList.remove("search-placeholder");
      }
      performSearch(item);
      SEARCH_STATE.focusArea = "RESULTS";
      SEARCH_STATE.resultIndex = 0;
      updateSearchFocus();
    });
    
    container.appendChild(chip);
  });
}

function handleKeyboardKeyPress(key) {
  if (key === "↑") {
    SEARCH_STATE.isShiftActive = !SEARCH_STATE.isShiftActive;
    renderKeyboard();
    updateSearchFocus();
    return;
  }
  
  const queryDisplay = document.getElementById("search-query-display");
  
  if (key === "⌫") {
    if (SEARCH_STATE.query.length > 0) {
      SEARCH_STATE.query = SEARCH_STATE.query.slice(0, -1);
    }
  } else if (key === "CLR") {
    SEARCH_STATE.query = "";
  } else if (key === "→") {
    if (SEARCH_STATE.query.trim().length > 0) {
      // Add to search history if not already there
      const cleanQ = SEARCH_STATE.query.trim();
      if (!SEARCH_STATE.history.includes(cleanQ)) {
        SEARCH_STATE.history.unshift(cleanQ);
        if (SEARCH_STATE.history.length > SEARCH_HISTORY_VISIBLE_LIMIT) SEARCH_STATE.history.pop();
        renderHistoryChips();
      }
      performSearch(cleanQ);
      SEARCH_STATE.focusArea = "RESULTS";
      SEARCH_STATE.resultIndex = 0;
      updateSearchFocus();
    }
    return;
  } else if (key === "◀" || key === "▶" || key === "?123") {
    // Action helper keys (could show numbers or move cursor if needed)
    return;
  } else {
    // Standard char
    let char = key;
    if (SEARCH_STATE.isShiftActive) {
      char = key.toUpperCase();
    }
    SEARCH_STATE.query += char;
  }
  
  if (queryDisplay) {
    if (SEARCH_STATE.query.length === 0) {
      queryDisplay.innerText = "Search for shows, videos...";
      queryDisplay.classList.add("search-placeholder");
    } else {
      queryDisplay.innerText = SEARCH_STATE.query;
      queryDisplay.classList.remove("search-placeholder");
    }
  }
  
  // Real-time search update
  performSearch(SEARCH_STATE.query);
}

async function performSearch(query) {
  const cleanQuery = query && query.trim() !== "" ? query.trim() : "";
  const endpointQuery = cleanQuery !== "" ? cleanQuery : "entertainment";
  let apiResponded = false;
  
  // The exact request payload/headers from user's request
  try {
    const myHeaders = new Headers();
    myHeaders.append("X-Device-ID", " 123456");
    myHeaders.append("X-Platform", " android_tv");
    myHeaders.append("X-App-Version", " 1.0.0");
    myHeaders.append("X-Request-ID", " abc-123");
    myHeaders.append("Content-Type", " application/json");
    myHeaders.append("Authorization", "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ5b3VyLWFwcCIsImlhdCI6MTc4MzUwNjA4MywiZXhwIjoxNzgzNTkyNDgzLCJkYXRhIjp7InR5cGUiOiJndWVzdCIsImRldmljZV9pZCI6IjEyMzQ1NiJ9fQ.Esl4K-NBymJEEMoIwP4_acRxevMxE7lyQnd2plAZqa0");

    // Try computing signature headers just in case
    const timestamp = Math.floor(Date.now() / 1000) + serverTimeOffset;
    const signature = await computeHMACSignature(timestamp, "", APP_STATE.hmacSecret);
    if (signature) {
      myHeaders.append("X-Timestamp", timestamp.toString());
      myHeaders.append("X-Signature", signature);
    }

    const requestOptions = {
      method: "GET",
      headers: myHeaders,
      redirect: "follow"
    };

    const url = `https://cheetah.abplive.com/v3/${APP_STATE.selectedLanguage || "hindi"}/search/${encodeURIComponent(endpointQuery)}`;
    console.log("SEARCH LIVE FETCH:", url);
    const response = await fetch(url, requestOptions);
    if (response.ok) {
      apiResponded = true;
      const json = await response.json();
      if (json && json.data && json.data.response) {
        let items = [];
        let railTitle = "";
        
        if (Array.isArray(json.data.response.rails) && json.data.response.rails.length > 0) {
          const firstRail = json.data.response.rails[0];
          items = firstRail.data || [];
          railTitle = firstRail.title || "";
        } else if (Array.isArray(json.data.response.items)) {
          items = json.data.response.items;
        } else if (Array.isArray(json.data.response)) {
          items = json.data.response;
        }

        if (Array.isArray(items) && items.length > 0) {
          renderSearchResults(items, cleanQuery, railTitle);
          return;
        }

        renderSearchNoData(cleanQuery, railTitle);
        return;
      }
    }
    if (apiResponded) {
      renderSearchNoData(cleanQuery, "");
      return;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch (err) {
    console.warn("Live search API failed, using visual mockup fallbacks...", err);
  }

  // Fallback mockup results matching the screenshot exactly
  const mockResults = [
    {
      title: `bBollywood News: 'वाराणसी' को लेकर चर्चाएं ...`,
      poster_image: "assets/placeholder.png",
      video_duration: "30:00 Min"
    },
    {
      title: "Mahesh Babu और SS Rajamouli की 100...",
      poster_image: "assets/placeholder.png",
      video_duration: "45:00 Min"
    },
    {
      title: "Mahesh Babu की Film में विलेन बनेंगे Aamir...",
      poster_image: "assets/placeholder.png",
      video_duration: "15:00 Min"
    },
    {
      title: "SS Rajamouli की f...",
      poster_image: "assets/placeholder.png",
      video_duration: "10:00 Min"
    }
  ];

  renderSearchResults(mockResults, cleanQuery, cleanQuery ? `${cleanQuery} Video List` : "entertainment Video List");
}

function renderSearchResults(items, query, railTitle) {
  SEARCH_STATE.results = items;
  
  const section = document.getElementById("search-results-section");
  const title = document.getElementById("search-results-title");
  const container = document.getElementById("search-results-container");
  
  if (!section || !title || !container) return;
  
  if (!items || items.length === 0) {
    renderSearchNoData(query, railTitle);
    return;
  }
  
  const displayTitle = railTitle || (query ? `${query} Video List` : "entertainment Video List");
  title.innerText = `Results from "${displayTitle}"`;
  container.innerHTML = "";
  
  items.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "search-card-wrapper";
    card.setAttribute("data-index", idx.toString());
    
    const thumbSrc = item.poster_image || item.thumbnail_image || "assets/placeholder.png";
    const titleText = item.title || "";
    
    card.innerHTML = `
      <div class="search-card-live-tag">LIVE</div>
      <img src="${thumbSrc}" alt="${titleText}" onerror="this.src='assets/placeholder.png'">
      <div class="search-card-title">${titleText}</div>
    `;
    
    card.addEventListener("click", () => {
      showToast(`Playing video: ${titleText}`);
    });
    
    container.appendChild(card);
  });
  
  section.style.display = "block";
  
  // If focus area is currently in results, update focus
  if (SEARCH_STATE.focusArea === "RESULTS") {
    updateSearchFocus();
  }
}

function renderSearchNoData(query, railTitle) {
  SEARCH_STATE.results = [];

  const section = document.getElementById("search-results-section");
  const title = document.getElementById("search-results-title");
  const container = document.getElementById("search-results-container");

  if (!section || !title || !container) return;

  const displayTitle = railTitle || (query ? `${query} Video List` : "Search Results");
  title.innerText = `Results from "${displayTitle}"`;
  container.innerHTML = `<div class="search-no-data">Data Not Found</div>`;
  section.style.display = "block";

  if (SEARCH_STATE.focusArea === "RESULTS") {
    SEARCH_STATE.focusArea = "INPUT";
    SEARCH_STATE.resultIndex = 0;
    updateSearchFocus();
  }
}

function updateSearchFocus() {
  // Remove focused classes from all elements
  document.querySelectorAll(".key-btn").forEach(el => el.classList.remove("focused"));
  const backBtn = document.getElementById("search-back-btn");
  if (backBtn) backBtn.classList.remove("focused");
  const profileBtn = document.getElementById("search-profile-btn");
  if (profileBtn) profileBtn.classList.remove("focused");
  const searchInput = document.getElementById("search-bar-input-field");
  if (searchInput) searchInput.classList.remove("focused");
  const voiceBtn = document.getElementById("voice-search-button");
  if (voiceBtn) voiceBtn.classList.remove("focused");
  document.querySelectorAll(".history-chip").forEach(el => el.classList.remove("focused"));
  document.querySelectorAll(".search-card-wrapper").forEach(el => el.classList.remove("focused"));
  
  if (focusArea === "SIDEBAR") {
    updateSidebarFocus();
    return;
  }
  
  // Set focus based on SEARCH_STATE.focusArea
  if (SEARCH_STATE.focusArea === "KEYBOARD") {
    const row = SEARCH_STATE.keyboardRow;
    const col = SEARCH_STATE.keyboardCol;
    const keyEl = document.querySelector(`.key-btn[data-row="${row}"][data-col="${col}"]`);
    if (keyEl) {
      keyEl.classList.add("focused");
      keyEl.focus({ preventScroll: true });
    }
  } else if (SEARCH_STATE.focusArea === "BACK") {
    if (backBtn) {
      backBtn.classList.add("focused");
      backBtn.focus({ preventScroll: true });
    }
  } else if (SEARCH_STATE.focusArea === "PROFILE") {
    if (profileBtn) {
      profileBtn.classList.add("focused");
      profileBtn.focus({ preventScroll: true });
    }
  } else if (SEARCH_STATE.focusArea === "INPUT") {
    if (searchInput) {
      searchInput.classList.add("focused");
      searchInput.focus({ preventScroll: true });
    }
  } else if (SEARCH_STATE.focusArea === "VOICE") {
    if (voiceBtn) {
      voiceBtn.classList.add("focused");
      voiceBtn.focus({ preventScroll: true });
    }
  } else if (SEARCH_STATE.focusArea === "HISTORY") {
    const idx = SEARCH_STATE.historyIndex;
    const chip = document.querySelector(`.history-chip[data-index="${idx}"]`);
    if (chip) {
      chip.classList.add("focused");
      chip.focus({ preventScroll: true });
    }
  } else if (SEARCH_STATE.focusArea === "RESULTS") {
    const idx = SEARCH_STATE.resultIndex;
    const card = document.querySelector(`.search-card-wrapper[data-index="${idx}"]`);
    if (card) {
      card.classList.add("focused");
      card.focus({ preventScroll: true });
      
      // Auto scroll container horizontally to bring card into view
      const container = document.getElementById("search-results-container");
      if (container) {
        const offsetLeft = card.offsetLeft;
        const width = card.offsetWidth;
        const containerWidth = container.offsetWidth;
        const targetScrollLeft = Math.max(0, offsetLeft - (containerWidth / 2) + (width / 2));
        container.scrollTo({
          left: targetScrollLeft,
          behavior: 'smooth'
        });
      }
    }
  }
}

function handleSearchScreenKey(key, event) {
  if (focusArea === "SIDEBAR") {
    if (key === "ArrowDown") {
      event.preventDefault();
      const items = getSidebarElements();
      if (activeSidebarIndex < items.length - 1) {
        activeSidebarIndex++;
        updateSidebarFocus();
      }
    } else if (key === "ArrowUp") {
      event.preventDefault();
      if (activeSidebarIndex > 0) {
        activeSidebarIndex--;
        updateSidebarFocus();
      }
    } else if (key === "ArrowRight") {
      event.preventDefault();
      // Shift focus to search layout panel
      focusArea = "GRID";
      SEARCH_STATE.focusArea = "BACK"; // Default to back button on right panel entry
      collapseDrawer();
      updateSidebarFocus();
      updateSearchFocus();
    } else if (key === "Enter") {
      event.preventDefault();
      const items = getSidebarElements();
      const activeItem = items[activeSidebarIndex];
      if (activeItem) {
        activeItem.click();
      }
    }
    return;
  }

  if (SEARCH_STATE.focusArea === "KEYBOARD") {
    if (key === "ArrowLeft") {
      event.preventDefault();
      if (SEARCH_STATE.keyboardCol > 0) {
        SEARCH_STATE.keyboardCol--;
        updateSearchFocus();
      } else {
        // Move focus to Left Panel (inputs / history / results)
        if (SEARCH_STATE.keyboardRow === 0) {
          SEARCH_STATE.focusArea = "INPUT";
        } else if (SEARCH_STATE.keyboardRow === 1 || SEARCH_STATE.keyboardRow === 2) {
          const visibleHistoryCount = getVisibleSearchHistoryCount();
          if (visibleHistoryCount > 0) {
            SEARCH_STATE.focusArea = "HISTORY";
            SEARCH_STATE.historyIndex = Math.min(SEARCH_STATE.historyIndex, visibleHistoryCount - 1);
          } else {
            SEARCH_STATE.focusArea = "INPUT";
          }
        } else {
          if (SEARCH_STATE.results.length > 0) {
            SEARCH_STATE.focusArea = "RESULTS";
            SEARCH_STATE.resultIndex = 0;
          } else {
            SEARCH_STATE.focusArea = "INPUT";
          }
        }
        updateSearchFocus();
      }
    } else if (key === "ArrowRight") {
      event.preventDefault();
      const maxCol = KEYBOARD_ROWS[SEARCH_STATE.keyboardRow].length - 1;
      if (SEARCH_STATE.keyboardCol < maxCol) {
        SEARCH_STATE.keyboardCol++;
        updateSearchFocus();
      }
    } else if (key === "ArrowUp") {
      event.preventDefault();
      if (SEARCH_STATE.keyboardRow > 0) {
        SEARCH_STATE.keyboardRow--;
        // Clamp column index
        const maxCol = KEYBOARD_ROWS[SEARCH_STATE.keyboardRow].length - 1;
        SEARCH_STATE.keyboardCol = Math.min(SEARCH_STATE.keyboardCol, maxCol);
        updateSearchFocus();
      }
    } else if (key === "ArrowDown") {
      event.preventDefault();
      if (SEARCH_STATE.keyboardRow < KEYBOARD_ROWS.length - 1) {
        SEARCH_STATE.keyboardRow++;
        // Clamp column index
        const maxCol = KEYBOARD_ROWS[SEARCH_STATE.keyboardRow].length - 1;
        SEARCH_STATE.keyboardCol = Math.min(SEARCH_STATE.keyboardCol, maxCol);
        updateSearchFocus();
      } else if (SEARCH_STATE.results.length > 0) {
        SEARCH_STATE.focusArea = "RESULTS";
        SEARCH_STATE.resultIndex = 0;
        updateSearchFocus();
      }
    } else if (key === "Enter") {
      event.preventDefault();
      const currentKey = KEYBOARD_ROWS[SEARCH_STATE.keyboardRow][SEARCH_STATE.keyboardCol];
      handleKeyboardKeyPress(currentKey);
    }
  }
  
  else if (SEARCH_STATE.focusArea === "BACK") {
    if (key === "ArrowLeft") {
      event.preventDefault();
      focusArea = "SIDEBAR";
      activeSidebarIndex = 0; // Search item is index 0
      expandDrawer();
      updateSidebarFocus();
      updateSearchFocus();
    } else if (key === "ArrowRight") {
      event.preventDefault();
      SEARCH_STATE.focusArea = "INPUT";
      updateSearchFocus();
    } else if (key === "ArrowDown") {
      event.preventDefault();
      SEARCH_STATE.focusArea = "INPUT";
      updateSearchFocus();
    } else if (key === "Enter") {
      event.preventDefault();
      // Go back to home
      switchScreen("HOME");
      focusArea = "SIDEBAR";
      activeSidebarIndex = 1;
      expandDrawer();
      updateSidebarFocus();
    }
  }
  
  else if (SEARCH_STATE.focusArea === "INPUT") {
    if (key === "ArrowUp") {
      event.preventDefault();
      SEARCH_STATE.focusArea = "BACK";
      updateSearchFocus();
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      SEARCH_STATE.focusArea = "BACK";
      updateSearchFocus();
    } else if (key === "ArrowRight") {
      event.preventDefault();
      SEARCH_STATE.focusArea = "KEYBOARD";
      SEARCH_STATE.keyboardRow = 0;
      SEARCH_STATE.keyboardCol = 0;
      updateSearchFocus();
    } else if (key === "ArrowDown") {
      event.preventDefault();
      if (getVisibleSearchHistoryCount() > 0) {
        SEARCH_STATE.focusArea = "HISTORY";
        SEARCH_STATE.historyIndex = 0;
      } else if (SEARCH_STATE.results.length > 0) {
        SEARCH_STATE.focusArea = "RESULTS";
        SEARCH_STATE.resultIndex = 0;
      }
      updateSearchFocus();
    } else if (key === "Enter") {
      event.preventDefault();
      SEARCH_STATE.focusArea = "KEYBOARD";
      SEARCH_STATE.keyboardRow = 0;
      SEARCH_STATE.keyboardCol = 0;
      updateSearchFocus();
    }
  }
  
  else if (SEARCH_STATE.focusArea === "HISTORY") {
    if (key === "ArrowLeft") {
      event.preventDefault();
      focusArea = "SIDEBAR";
      activeSidebarIndex = 0;
      expandDrawer();
      updateSidebarFocus();
      updateSearchFocus();
    } else if (key === "ArrowUp") {
      event.preventDefault();
      if (SEARCH_STATE.historyIndex > 0) {
        SEARCH_STATE.historyIndex--;
      } else {
        SEARCH_STATE.focusArea = "INPUT";
      }
      updateSearchFocus();
    } else if (key === "ArrowDown") {
      event.preventDefault();
      const visibleHistoryCount = getVisibleSearchHistoryCount();
      if (SEARCH_STATE.historyIndex < visibleHistoryCount - 1) {
        SEARCH_STATE.historyIndex++;
      } else if (SEARCH_STATE.results.length > 0) {
        SEARCH_STATE.focusArea = "RESULTS";
        SEARCH_STATE.resultIndex = 0;
      }
      updateSearchFocus();
    } else if (key === "ArrowRight") {
      event.preventDefault();
      SEARCH_STATE.focusArea = "KEYBOARD";
      SEARCH_STATE.keyboardRow = 1;
      SEARCH_STATE.keyboardCol = 0;
      updateSearchFocus();
    } else if (key === "Enter") {
      event.preventDefault();
      const chip = document.querySelector(`.history-chip[data-index="${SEARCH_STATE.historyIndex}"]`);
      if (chip) chip.click();
    }
  }
  
  else if (SEARCH_STATE.focusArea === "RESULTS") {
    if (key === "ArrowUp") {
      event.preventDefault();
      const visibleHistoryCount = getVisibleSearchHistoryCount();
      if (visibleHistoryCount > 0) {
        SEARCH_STATE.focusArea = "HISTORY";
        SEARCH_STATE.historyIndex = visibleHistoryCount - 1;
      } else {
        SEARCH_STATE.focusArea = "INPUT";
      }
      updateSearchFocus();
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      if (SEARCH_STATE.resultIndex > 0) {
        SEARCH_STATE.resultIndex--;
        updateSearchFocus();
      } else {
        focusArea = "SIDEBAR";
        activeSidebarIndex = 0;
        expandDrawer();
        updateSidebarFocus();
        updateSearchFocus();
      }
    } else if (key === "ArrowRight") {
      event.preventDefault();
      if (SEARCH_STATE.resultIndex < SEARCH_STATE.results.length - 1) {
        SEARCH_STATE.resultIndex++;
        updateSearchFocus();
      } else {
        // Move to keyboard
        SEARCH_STATE.focusArea = "KEYBOARD";
        SEARCH_STATE.keyboardRow = 3;
        SEARCH_STATE.keyboardCol = 0;
        updateSearchFocus();
      }
    }
  }
}

// Videos Screen State & Action Handlers
const VIDEOS_STATE = {
  focusArea: "GRID", // "BACK" or "GRID"
  activeIndex: 0,
  items: [],
  page: 1,
  limit: 12,
  isLoading: false,
  menuItem: null
};

async function openVideosScreen(menuItem) {
  switchScreen("VIDEOS");
  
  const container = document.getElementById("videos-grid-container");
  if (container) {
    container.innerHTML = renderRedLoader(3);
  }
  
  VIDEOS_STATE.focusArea = "GRID";
  VIDEOS_STATE.activeIndex = 0;
  VIDEOS_STATE.items = [];
  VIDEOS_STATE.page = 1;
  VIDEOS_STATE.isLoading = false;
  VIDEOS_STATE.menuItem = menuItem;
  
  // Set up back button handler
  const backBtn = document.getElementById("videos-back-btn");
  if (backBtn) {
    backBtn.onclick = () => {
      switchScreen("HOME");
      focusArea = "SIDEBAR";
      activeSidebarIndex = 3; // Focus back to "Videos" in sidebar
      expandDrawer();
      updateSidebarFocus();
    };
  }
  
  let items = [];
  try {
    let url = menuItem.url || "https://cheetah.abplive.com/v3/hindi/videos/PAGE/LIMIT";
    url = url.replace("PAGE", VIDEOS_STATE.page.toString()).replace("LIMIT", VIDEOS_STATE.limit.toString());
    
    let endpoint = url;
    if (endpoint.startsWith(APP_STATE.baseUrl)) {
      endpoint = endpoint.substring(APP_STATE.baseUrl.length);
    }
    
    console.log("VIDEOS API FETCH:", endpoint);
    const json = await fetchSigned(endpoint, "GET");
    items = extractPaginatedItems(json, "VIDEOS");
  } catch (err) {
    console.warn("Failed to fetch videos from API, using fallback data...", err);
  }
  
  if (!items || items.length === 0) {
    items = [
      { title: "Sansani | Crime News | Ketan Murder Case: सिया...सहेली और खूनी भ...", video_duration: "21:55 Min", duration: "21:55", poster_image: "assets/placeholder.png" },
      { title: "Ram Mandir Chadhava Chori | Janhit: कल 6 जुलाई... क्या होगी 'चंपत' की...", video_duration: "42:31 Min", duration: "42:31", poster_image: "assets/placeholder.png" },
      { title: "Amir Khan Wedding: दिल है की मानता नहीं | Bollywood News | ABP News", video_duration: "22:13 Min", duration: "22:13", poster_image: "assets/placeholder.png" },
      { title: "Ram Mandir Daan Chori | Sandeep Chaudhary | Trust में गड़बड़झाले का सबसे सटीक विश्लेषण!", video_duration: "54:35 Min", duration: "54:35", poster_image: "assets/placeholder.png" },
      { title: "Ram Mandir Donation Scam : चढ़ावा चोरी... मास्टरमाइंड की उल्टी गिनती!", video_duration: "41:50 Min", duration: "41:50", poster_image: "assets/placeholder.png" },
      { title: "Ram Mandir Daan Chori | Champat Rai: चंपत राय के इस्तीफे पर महामंथन से पहले ही भंग होगा ट्रस्ट?", video_duration: "50:30 Min", duration: "50:30", poster_image: "assets/placeholder.png" }
    ];
  }
  
  VIDEOS_STATE.items = items;
  renderVideosGrid();
}

function renderVideosGrid() {
  const container = document.getElementById("videos-grid-container");
  if (!container) return;
  
  container.innerHTML = "";
  
  VIDEOS_STATE.items.forEach((item, idx) => {
    const rawDur = item.duration || item.video_duration || item.duration_text || "";
    const cleanDur = rawDur.replace(/\s*min\s*/gi, "").trim();
    
    const card = document.createElement("div");
    card.className = "video-grid-card";
    card.setAttribute("data-index", idx.toString());
    
    const imgUrl = getItemImageUrl(item, "landscape");
    
    card.innerHTML = `
      <img src="${imgUrl}" alt="${item.title || ''}">
      ${cleanDur ? `<div class="video-duration-badge">${cleanDur}</div>` : ""}
      <div class="video-title-overlay">
        <div class="video-title-text">${item.title || "Video Title"}</div>
      </div>
    `;
    
    card.addEventListener("click", () => {
      showToast(`Playing video: ${item.title}`);
    });
    
    container.appendChild(card);
  });
  
  updateVideosFocus();
}

async function triggerBackgroundLoad() {
  if (VIDEOS_STATE.isLoading) return;
  VIDEOS_STATE.isLoading = true;
  VIDEOS_STATE.page++;
  
  console.log(`Background loading page ${VIDEOS_STATE.page}...`);
  
  let newItems = [];
  try {
    let url = (VIDEOS_STATE.menuItem && VIDEOS_STATE.menuItem.url) || "https://cheetah.abplive.com/v3/hindi/videos/PAGE/LIMIT";
    url = url.replace("PAGE", VIDEOS_STATE.page.toString()).replace("LIMIT", VIDEOS_STATE.limit.toString());
    
    let endpoint = url;
    if (endpoint.startsWith(APP_STATE.baseUrl)) {
      endpoint = endpoint.substring(APP_STATE.baseUrl.length);
    }
    
    const json = await fetchSigned(endpoint, "GET");
    newItems = extractPaginatedItems(json, "VIDEOS_PAGE");
  } catch (err) {
    console.warn("Failed background fetch, using mock pagination fallbacks...", err);
  }
  
  if (!newItems || newItems.length === 0) {
    const pageNum = VIDEOS_STATE.page;
    newItems = [
      { title: "Video Category Update | Latest from News Desk", video_duration: "10:15 Min", duration: "10:15", poster_image: "assets/placeholder.png" },
      { title: "Live Reporting: Ground zero update from Varanasi", video_duration: "18:40 Min", duration: "18:40", poster_image: "assets/placeholder.png" },
      { title: "Entertainment Weekly: Bollywood stars shine at gala", video_duration: "05:22 Min", duration: "05:22", poster_image: "assets/placeholder.png" },
      { title: "Special Report: Economy analysis and future projections", video_duration: "35:10 Min", duration: "35:10", poster_image: "assets/placeholder.png" },
      { title: "Sports segment: India vs West Indies highlights", video_duration: "12:00 Min", duration: "12:00", poster_image: "assets/placeholder.png" },
      { title: "Weather update: Monsoons arrival and warnings", video_duration: "08:45 Min", duration: "08:45", poster_image: "assets/placeholder.png" }
    ];
  }
  
  VIDEOS_STATE.items = VIDEOS_STATE.items.concat(newItems);
  renderVideosGrid();
  VIDEOS_STATE.isLoading = false;
  console.log(`Page ${VIDEOS_STATE.page} background load completed.`);
}

function updateVideosFocus() {
  const backBtn = document.getElementById("videos-back-btn");
  if (backBtn) backBtn.classList.remove("focused");
  
  const cards = document.querySelectorAll(".video-grid-card");
  cards.forEach(c => c.classList.remove("focused"));
  
  if (VIDEOS_STATE.focusArea === "BACK") {
    if (backBtn) {
      backBtn.classList.add("focused");
      backBtn.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  } else if (VIDEOS_STATE.focusArea === "GRID") {
    const activeCard = document.querySelector(`.video-grid-card[data-index="${VIDEOS_STATE.activeIndex}"]`);
    if (activeCard) {
      activeCard.classList.add("focused");
      activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
  
  // If active card is in the last row, load the next page of videos in the background
  if (VIDEOS_STATE.focusArea === "GRID" && VIDEOS_STATE.items.length > 0) {
    const totalItems = VIDEOS_STATE.items.length;
    const cols = 3;
    const lastRowStart = Math.floor((totalItems - 1) / cols) * cols;
    
    if (VIDEOS_STATE.activeIndex >= lastRowStart && !VIDEOS_STATE.isLoading) {
      triggerBackgroundLoad();
    }
  }
}

function handleVideosScreenKey(key, event) {
  if (VIDEOS_STATE.focusArea === "BACK") {
    if (key === "ArrowDown") {
      event.preventDefault();
      if (VIDEOS_STATE.items.length > 0) {
        VIDEOS_STATE.focusArea = "GRID";
        VIDEOS_STATE.activeIndex = 0;
        updateVideosFocus();
      }
    } else if (key === "Enter") {
      event.preventDefault();
      const backBtn = document.getElementById("videos-back-btn");
      if (backBtn) backBtn.click();
    }
  } else if (VIDEOS_STATE.focusArea === "GRID") {
    const cols = 3;
    const totalItems = VIDEOS_STATE.items.length;
    const curIdx = VIDEOS_STATE.activeIndex;
    
    if (key === "ArrowUp") {
      event.preventDefault();
      if (curIdx < cols) {
        VIDEOS_STATE.focusArea = "BACK";
      } else {
        VIDEOS_STATE.activeIndex = curIdx - cols;
      }
      updateVideosFocus();
    } else if (key === "ArrowDown") {
      event.preventDefault();
      if (curIdx + cols < totalItems) {
        VIDEOS_STATE.activeIndex = curIdx + cols;
        updateVideosFocus();
      }
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      if (curIdx % cols > 0) {
        VIDEOS_STATE.activeIndex = curIdx - 1;
        updateVideosFocus();
      }
    } else if (key === "ArrowRight") {
      event.preventDefault();
      if ((curIdx % cols < cols - 1) && (curIdx < totalItems - 1)) {
        VIDEOS_STATE.activeIndex = curIdx + 1;
        updateVideosFocus();
      }
    } else if (key === "Enter") {
      event.preventDefault();
      const activeCard = document.querySelector(`.video-grid-card[data-index="${curIdx}"]`);
      if (activeCard) activeCard.click();
    }
  }
}

// ==============================================================
// TV Shows Screen
// ==============================================================
const TVSHOWS_STATE = {
  focusArea: "GRID",
  activeIndex: 0,
  items: [],
  page: 1,
  limit: 12,
  isLoading: false,
  menuItem: null
};

async function openTVShowsScreen(menuItem) {
  switchScreen("TVSHOWS");

  const container = document.getElementById("tvshows-grid-container");
  if (container) {
    container.innerHTML = renderRedLoader(3);
  }

  // Set dynamic screen title from menu item label
  const screenTitleEl = document.querySelector("#tvshows-screen .generic-screen-title");
  if (screenTitleEl && menuItem && menuItem.label) {
    screenTitleEl.textContent = menuItem.label[APP_STATE.selectedLanguage] || menuItem.label.en || menuItem.label.hi || "TV Shows";
  }

  TVSHOWS_STATE.focusArea = "GRID";
  TVSHOWS_STATE.activeIndex = 0;
  TVSHOWS_STATE.items = [];
  TVSHOWS_STATE.page = 1;
  TVSHOWS_STATE.isLoading = false;
  TVSHOWS_STATE.menuItem = menuItem;

  const backBtn = document.getElementById("tvshows-back-btn");
  if (backBtn) {
    backBtn.onclick = () => {
      switchScreen("HOME");
      focusArea = "SIDEBAR";
      expandDrawer();
      updateSidebarFocus();
    };
  }

  let items = [];
  try {
    // Use menuItem.url if provided, otherwise fall back to the TV shows endpoint
    let url = (menuItem && menuItem.url) ||
      `${APP_STATE.baseUrl}${APP_STATE.selectedLanguage || "hindi"}/tv-shows/1/12`;
    url = url.replace("PAGE", TVSHOWS_STATE.page.toString()).replace("LIMIT", TVSHOWS_STATE.limit.toString());

    let endpoint = url;
    if (endpoint.startsWith(APP_STATE.baseUrl)) endpoint = endpoint.substring(APP_STATE.baseUrl.length);

    const json = await fetchSigned(endpoint, "GET");
    items = extractPaginatedItems(json, "TVSHOWS");
    console.log("TVSHOWS API items:", items.length);
  } catch (err) {
    console.warn("TV Shows API failed, using mock data.", err);
  }

  if (!items || items.length === 0) {
    items = [
      { title: "जनहित", poster_image: "assets/placeholder.png" },
      { title: "सीधा सवाल", poster_image: "assets/placeholder.png" },
      { title: "भारत की बात", poster_image: "assets/placeholder.png" },
      { title: "महादंगल", poster_image: "assets/placeholder.png" },
      { title: "साड़ी बहू और साजिश", poster_image: "assets/placeholder.png" },
      { title: "सनसनी", poster_image: "assets/placeholder.png" },
      { title: "ABP Live Debate", poster_image: "assets/placeholder.png" },
      { title: "Newsroom Live", poster_image: "assets/placeholder.png" },
      { title: "Prime Time Special", poster_image: "assets/placeholder.png" }
    ];
  }

  TVSHOWS_STATE.items = items;
  renderTVShowsGrid();
}

function renderTVShowsGrid() {
  const container = document.getElementById("tvshows-grid-container");
  if (!container) return;
  container.innerHTML = "";

  TVSHOWS_STATE.items.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "tvshow-card";
    card.setAttribute("data-index", idx.toString());

    const imgUrl = getItemImageUrl(item, "landscape");
    const title = item.title || item.name || "TV Show";

    card.innerHTML = `
      <div class="tvshow-card-thumb">
        <img src="${imgUrl}" alt="${title}" loading="lazy">
      </div>
      <div class="tvshow-card-title">${title}</div>
    `;

    card.addEventListener("click", () => showToast(`Playing: ${title}`));
    container.appendChild(card);
  });

  updateTVShowsFocus();
}

async function triggerTVShowsBackgroundLoad() {
  if (TVSHOWS_STATE.isLoading) return;
  TVSHOWS_STATE.isLoading = true;
  TVSHOWS_STATE.page++;

  let newItems = [];
  try {
    let url = (TVSHOWS_STATE.menuItem && TVSHOWS_STATE.menuItem.url) ||
      `${APP_STATE.baseUrl}${APP_STATE.selectedLanguage || "hindi"}/tv-shows/PAGE/LIMIT`;
    url = url.replace("PAGE", TVSHOWS_STATE.page.toString()).replace("LIMIT", TVSHOWS_STATE.limit.toString());
    let endpoint = url;
    if (endpoint.startsWith(APP_STATE.baseUrl)) endpoint = endpoint.substring(APP_STATE.baseUrl.length);
    const json = await fetchSigned(endpoint, "GET");
    newItems = extractPaginatedItems(json, "TVSHOWS_PAGE");
  } catch (err) { /* silent */ }

  if (!newItems || newItems.length === 0) {
    const p = TVSHOWS_STATE.page;
    newItems = [
      { title: "Crime Patrol Special", poster_image: "assets/placeholder.png" },
      { title: "Aap Ki Adalat", poster_image: "assets/placeholder.png" },
      { title: "Weekend Special", poster_image: "assets/placeholder.png" },
      { title: "Breakfast News", poster_image: "assets/placeholder.png" },
      { title: "Late Night Live", poster_image: "assets/placeholder.png" },
      { title: "Business Hour", poster_image: "assets/placeholder.png" }
    ];
  }

  TVSHOWS_STATE.items = TVSHOWS_STATE.items.concat(newItems);
  renderTVShowsGrid();
  TVSHOWS_STATE.isLoading = false;
}

function updateTVShowsFocus() {
  const backBtn = document.getElementById("tvshows-back-btn");
  if (backBtn) backBtn.classList.remove("focused");
  document.querySelectorAll(".tvshow-card").forEach(c => c.classList.remove("focused"));

  if (TVSHOWS_STATE.focusArea === "BACK") {
    if (backBtn) { backBtn.classList.add("focused"); backBtn.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  } else {
    const activeCard = document.querySelector(`.tvshow-card[data-index="${TVSHOWS_STATE.activeIndex}"]`);
    if (activeCard) { activeCard.classList.add("focused"); activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }

  // Background load on last row
  if (TVSHOWS_STATE.focusArea === "GRID" && TVSHOWS_STATE.items.length > 0) {
    const cols = 3;
    const lastRowStart = Math.floor((TVSHOWS_STATE.items.length - 1) / cols) * cols;
    if (TVSHOWS_STATE.activeIndex >= lastRowStart && !TVSHOWS_STATE.isLoading) {
      triggerTVShowsBackgroundLoad();
    }
  }
}

function handleTVShowsScreenKey(key, event) {
  const cols = 3;
  if (TVSHOWS_STATE.focusArea === "BACK") {
    if (key === "ArrowDown") {
      event.preventDefault();
      if (TVSHOWS_STATE.items.length > 0) { TVSHOWS_STATE.focusArea = "GRID"; TVSHOWS_STATE.activeIndex = 0; updateTVShowsFocus(); }
    } else if (key === "Enter") {
      event.preventDefault();
      document.getElementById("tvshows-back-btn")?.click();
    }
  } else if (TVSHOWS_STATE.focusArea === "GRID") {
    const total = TVSHOWS_STATE.items.length;
    const cur = TVSHOWS_STATE.activeIndex;
    if (key === "ArrowUp") {
      event.preventDefault();
      if (cur < cols) { TVSHOWS_STATE.focusArea = "BACK"; } else { TVSHOWS_STATE.activeIndex = cur - cols; }
      updateTVShowsFocus();
    } else if (key === "ArrowDown") {
      event.preventDefault();
      if (cur + cols < total) { TVSHOWS_STATE.activeIndex = cur + cols; updateTVShowsFocus(); }
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      if (cur % cols > 0) { TVSHOWS_STATE.activeIndex = cur - 1; updateTVShowsFocus(); }
    } else if (key === "ArrowRight") {
      event.preventDefault();
      if (cur % cols < cols - 1 && cur < total - 1) { TVSHOWS_STATE.activeIndex = cur + 1; updateTVShowsFocus(); }
    } else if (key === "Enter") {
      event.preventDefault();
      document.querySelector(`.tvshow-card[data-index="${cur}"]`)?.click();
    }
  }
}

// ==============================================================
// Short Videos Screen
// ==============================================================
const SHORTVIDEOS_STATE = {
  focusArea: "GRID",
  activeIndex: 0,
  items: [],
  page: 1,
  limit: 15,
  isLoading: false,
  menuItem: null
};

async function openShortVideosScreen(menuItem) {
  switchScreen("SHORTVIDEOS");

  const container = document.getElementById("shortvideos-grid-container");
  if (container) {
    container.innerHTML = renderRedLoader(5);
  }

  // Set dynamic screen title from menu item label
  const screenTitleEl = document.querySelector("#shortvideos-screen .generic-screen-title");
  if (screenTitleEl && menuItem && menuItem.label) {
    screenTitleEl.textContent = menuItem.label[APP_STATE.selectedLanguage] || menuItem.label.en || menuItem.label.hi || "Short Videos";
  }

  SHORTVIDEOS_STATE.focusArea = "GRID";
  SHORTVIDEOS_STATE.activeIndex = 0;
  SHORTVIDEOS_STATE.items = [];
  SHORTVIDEOS_STATE.page = 1;
  SHORTVIDEOS_STATE.isLoading = false;
  SHORTVIDEOS_STATE.menuItem = menuItem;

  const backBtn = document.getElementById("shortvideos-back-btn");
  if (backBtn) {
    backBtn.onclick = () => {
      switchScreen("HOME");
      focusArea = "SIDEBAR";
      expandDrawer();
      updateSidebarFocus();
    };
  }

  let items = [];
  try {
    // Use menuItem.url if provided, otherwise fall back to the short videos endpoint
    let url = (menuItem && menuItem.url) ||
      `${APP_STATE.baseUrl}${APP_STATE.selectedLanguage || "hindi"}/short-videos/1/15`;
    url = url.replace("PAGE", SHORTVIDEOS_STATE.page.toString()).replace("LIMIT", SHORTVIDEOS_STATE.limit.toString());

    let endpoint = url;
    if (endpoint.startsWith(APP_STATE.baseUrl)) endpoint = endpoint.substring(APP_STATE.baseUrl.length);

    const json = await fetchSigned(endpoint, "GET");
    items = extractPaginatedItems(json, "SHORTVIDEOS");
    console.log("SHORTVIDEOS API items:", items.length);
  } catch (err) {
    console.warn("Short Videos API failed, using mock data.", err);
  }

  if (!items || items.length === 0) {
    items = [
      { title: "Influencer से Actor बनने वाली अपनी journey पर क्या बोला Sanchita Bashu ने?", poster_image: "assets/placeholder.png" },
      { title: "SRK की King को पीछे छोड़ गई Ramayana!", poster_image: "assets/placeholder.png" },
      { title: "Lock Upp बन गया है Bigg Boss?", poster_image: "assets/placeholder.png" },
      { title: "डिलीवरी बॉय पर दादा बैठा CCTV", poster_image: "assets/placeholder.png" },
      { title: "गुरुग्राम में फंसी गाड़ियां बने बाधा", poster_image: "assets/placeholder.png" },
      { title: "कारें टकराई, फिर हुई बड़ी घटना", poster_image: "assets/placeholder.png" },
      { title: "इससे पहले कभी नहीं देखी दोहरी भयावह घटना", poster_image: "assets/placeholder.png" },
      { title: "मस्त ठंडी हवा और बारिश के साथ ये था दृश्य", poster_image: "assets/placeholder.png" }
    ];
  }

  SHORTVIDEOS_STATE.items = items;
  renderShortVideosGrid();
}

function renderShortVideosGrid() {
  const container = document.getElementById("shortvideos-grid-container");
  if (!container) return;
  container.innerHTML = "";

  SHORTVIDEOS_STATE.items.forEach((item, idx) => {
    const card = document.createElement("div");
    card.className = "shortvideo-card";
    card.setAttribute("data-index", idx.toString());

    const imgUrl = getItemImageUrl(item, "portrait");
    const title = item.title || item.name || "Short Video";

    card.innerHTML = `
      <img src="${imgUrl}" alt="${title}" loading="lazy">
      <div class="shortvideo-badge">
        <div class="shortvideo-badge-text">ENT<br>LIVE</div>
      </div>
      <div class="shortvideo-title-overlay">
        <div class="shortvideo-title-text">${title}</div>
      </div>
    `;

    card.addEventListener("click", () => showToast(`Playing: ${title}`));
    container.appendChild(card);
  });

  updateShortVideosFocus();
}

async function triggerShortVideosBackgroundLoad() {
  if (SHORTVIDEOS_STATE.isLoading) return;
  SHORTVIDEOS_STATE.isLoading = true;
  SHORTVIDEOS_STATE.page++;

  let newItems = [];
  try {
    let url = (SHORTVIDEOS_STATE.menuItem && SHORTVIDEOS_STATE.menuItem.url) ||
      `${APP_STATE.baseUrl}${APP_STATE.selectedLanguage || "hindi"}/short-videos/PAGE/LIMIT`;
    url = url.replace("PAGE", SHORTVIDEOS_STATE.page.toString()).replace("LIMIT", SHORTVIDEOS_STATE.limit.toString());
    let endpoint = url;
    if (endpoint.startsWith(APP_STATE.baseUrl)) endpoint = endpoint.substring(APP_STATE.baseUrl.length);
    const json = await fetchSigned(endpoint, "GET");
    newItems = extractPaginatedItems(json, "SHORTVIDEOS_PAGE");
  } catch (err) { /* silent */ }

  if (!newItems || newItems.length === 0) {
    const p = SHORTVIDEOS_STATE.page;
    newItems = [
      { title: "Cricket Highlights: India vs Australia", poster_image: "assets/placeholder.png" },
      { title: "Monsoon Special: Chai aur Baarish", poster_image: "assets/placeholder.png" },
      { title: "Street Food Tour: Old Delhi", poster_image: "assets/placeholder.png" },
      { title: "Tech Bytes: AI future explained", poster_image: "assets/placeholder.png" },
      { title: "Motivational clip: Never give up", poster_image: "assets/placeholder.png" }
    ];
  }

  SHORTVIDEOS_STATE.items = SHORTVIDEOS_STATE.items.concat(newItems);
  renderShortVideosGrid();
  SHORTVIDEOS_STATE.isLoading = false;
}

function updateShortVideosFocus() {
  const backBtn = document.getElementById("shortvideos-back-btn");
  if (backBtn) backBtn.classList.remove("focused");
  document.querySelectorAll(".shortvideo-card").forEach(c => c.classList.remove("focused"));

  if (SHORTVIDEOS_STATE.focusArea === "BACK") {
    if (backBtn) { backBtn.classList.add("focused"); backBtn.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  } else {
    const activeCard = document.querySelector(`.shortvideo-card[data-index="${SHORTVIDEOS_STATE.activeIndex}"]`);
    if (activeCard) { activeCard.classList.add("focused"); activeCard.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  }

  // Background load on last row
  if (SHORTVIDEOS_STATE.focusArea === "GRID" && SHORTVIDEOS_STATE.items.length > 0) {
    const cols = 5;
    const lastRowStart = Math.floor((SHORTVIDEOS_STATE.items.length - 1) / cols) * cols;
    if (SHORTVIDEOS_STATE.activeIndex >= lastRowStart && !SHORTVIDEOS_STATE.isLoading) {
      triggerShortVideosBackgroundLoad();
    }
  }
}

function handleShortVideosScreenKey(key, event) {
  const cols = 5;
  if (SHORTVIDEOS_STATE.focusArea === "BACK") {
    if (key === "ArrowDown") {
      event.preventDefault();
      if (SHORTVIDEOS_STATE.items.length > 0) { SHORTVIDEOS_STATE.focusArea = "GRID"; SHORTVIDEOS_STATE.activeIndex = 0; updateShortVideosFocus(); }
    } else if (key === "Enter") {
      event.preventDefault();
      document.getElementById("shortvideos-back-btn")?.click();
    }
  } else if (SHORTVIDEOS_STATE.focusArea === "GRID") {
    const total = SHORTVIDEOS_STATE.items.length;
    const cur = SHORTVIDEOS_STATE.activeIndex;
    if (key === "ArrowUp") {
      event.preventDefault();
      if (cur < cols) { SHORTVIDEOS_STATE.focusArea = "BACK"; } else { SHORTVIDEOS_STATE.activeIndex = cur - cols; }
      updateShortVideosFocus();
    } else if (key === "ArrowDown") {
      event.preventDefault();
      if (cur + cols < total) { SHORTVIDEOS_STATE.activeIndex = cur + cols; updateShortVideosFocus(); }
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      if (cur % cols > 0) { SHORTVIDEOS_STATE.activeIndex = cur - 1; updateShortVideosFocus(); }
    } else if (key === "ArrowRight") {
      event.preventDefault();
      if (cur % cols < cols - 1 && cur < total - 1) { SHORTVIDEOS_STATE.activeIndex = cur + 1; updateShortVideosFocus(); }
    } else if (key === "Enter") {
      event.preventDefault();
      document.querySelector(`.shortvideo-card[data-index="${cur}"]`)?.click();
    }
  }
}


window.addEventListener("keydown", (event) => {
  const key = event.key;
  
  // 1. Language Screen Navigation
  if (APP_STATE.currentScreen === "LANGUAGE") {
    if (key === "ArrowLeft") {
      event.preventDefault();
      if (currentLanguageIndex > 0) {
        currentLanguageIndex--;
        updateLanguageCarouselFocus();
      }
    } else if (key === "ArrowRight") {
      event.preventDefault();
      if (currentLanguageIndex < APP_STATE.languages.length - 1) {
        currentLanguageIndex++;
        updateLanguageCarouselFocus();
      }
    } else if (key === "Enter") {
      event.preventDefault();
      const activeCard = document.getElementById("focused-language-card");
      if (activeCard) {
        activeCard.click();
      }
    }
  }
  
  // 3. Search Screen Navigation
  else if (APP_STATE.currentScreen === "SEARCH") {
    handleSearchScreenKey(key, event);
  }
  
  // 4. Videos Screen Navigation
  else if (APP_STATE.currentScreen === "VIDEOS") {
    handleVideosScreenKey(key, event);
  }
  
  // 5. TV Shows Screen Navigation
  else if (APP_STATE.currentScreen === "TVSHOWS") {
    handleTVShowsScreenKey(key, event);
  }
  
  // 6. Short Videos Screen Navigation
  else if (APP_STATE.currentScreen === "SHORTVIDEOS") {
    handleShortVideosScreenKey(key, event);
  }
  
  // 2. Home Screen Navigation
  else if (APP_STATE.currentScreen === "HOME") {
    if (focusArea === "SIDEBAR") {
      if (key === "ArrowDown") {
        event.preventDefault();
        const items = getSidebarElements();
        if (activeSidebarIndex < items.length - 1) {
          activeSidebarIndex++;
          updateSidebarFocus();
        }
      } else if (key === "ArrowUp") {
        event.preventDefault();
        if (activeSidebarIndex > 0) {
          activeSidebarIndex--;
          updateSidebarFocus();
        }
      } else if (key === "ArrowRight") {
        event.preventDefault();
        // Shift focus to grid rails
        const container = document.getElementById("home-rails-container");
        const rails = container ? container.querySelectorAll(".home-rail") : [];
        if (rails.length > 0) {
          focusArea = "GRID";
          collapseDrawer();
          updateSidebarFocus();
          updateGridFocus();
        }
      } else if (key === "Enter") {
        event.preventDefault();
        const items = getSidebarElements();
        const activeItem = items[activeSidebarIndex];
        if (activeItem) {
          activeItem.click();
        }
      }
    } 
    else if (focusArea === "GRID") {
      // Reset live player inactivity timer on any grid key action
      startLiveHideTimer();
      
      const renderRailsArr2 = getHomeRenderRails();
      const currentRailData = renderRailsArr2[activeRailIndex];
      const isAnchorSpotlight = currentRailData && currentRailData.card_type === "anchor_spotlight_section";
      
      if (isAnchorSpotlight) {
        if (key === "ArrowLeft") {
          event.preventDefault();
          if (anchorSubFocus === "TABS") {
            if (anchorActiveTabIndex > 0) {
              anchorActiveTabIndex--;
              updateAnchorSpotlightContent();
              updateGridFocus();
            } else {
              // Return focus to sidebar
              focusArea = "SIDEBAR";
              expandDrawer();
              updateSidebarFocus();
              updateGridFocus();
            }
          } else {
            if (activeCardIndex > 0) {
              activeCardIndex--;
              updateGridFocus();
            } else {
              // Return focus to sidebar
              focusArea = "SIDEBAR";
              expandDrawer();
              updateSidebarFocus();
              updateGridFocus();
            }
          }
        } else if (key === "ArrowRight") {
          event.preventDefault();
          if (anchorSubFocus === "TABS") {
            const tabsCount = currentRailData.data ? currentRailData.data.length : 0;
            if (anchorActiveTabIndex < tabsCount - 1) {
              anchorActiveTabIndex++;
              updateAnchorSpotlightContent();
              updateGridFocus();
            }
          } else {
            const container = document.getElementById("home-rails-container");
            const rails = container ? container.querySelectorAll(".home-rail") : [];
            const activeRailEl = rails[activeRailIndex];
            const cardsCount = activeRailEl ? activeRailEl.querySelectorAll(".card-focus-wrapper").length : 0;
            if (activeCardIndex < cardsCount - 1) {
              activeCardIndex++;
              updateGridFocus();
            }
          }
        } else if (key === "ArrowUp") {
          event.preventDefault();
          if (anchorSubFocus === "CARDS") {
            // Switch back to TABS
            anchorSubFocus = "TABS";
            updateGridFocus();
          } else {
            // Go to previous rail
            if (activeRailIndex > 0) {
              activeRailIndex--;
              activeCardIndex = 0;
              const prevRailData = renderRailsArr2[activeRailIndex];
              if (prevRailData && prevRailData.card_type === "anchor_spotlight_section") {
                anchorSubFocus = "CARDS";
              }
              updateGridFocus();
            } else {
              // Return to sidebar menu bar
              focusArea = "SIDEBAR";
              expandDrawer();
              updateSidebarFocus();
              updateGridFocus();
            }
          }
        } else if (key === "ArrowDown") {
          event.preventDefault();
          if (anchorSubFocus === "TABS") {
            // Move down to CARDS row
            const container = document.getElementById("home-rails-container");
            const rails = container ? container.querySelectorAll(".home-rail") : [];
            const activeRailEl = rails[activeRailIndex];
            const cardsCount = activeRailEl ? activeRailEl.querySelectorAll(".card-focus-wrapper").length : 0;
            if (cardsCount > 0) {
              anchorSubFocus = "CARDS";
              activeCardIndex = 0;
              updateGridFocus();
            } else {
              // No cards, go to next rail
              const railsCount = rails.length;
              if (activeRailIndex < railsCount - 1) {
                activeRailIndex++;
                activeCardIndex = 0;
                const nextRailData = renderRailsArr2[activeRailIndex];
                if (nextRailData && nextRailData.card_type === "anchor_spotlight_section") {
                  anchorSubFocus = "TABS";
                  anchorActiveTabIndex = 0;
                }
                updateGridFocus();
              }
            }
          } else {
            // CARDS row: move down to next rail
            const container = document.getElementById("home-rails-container");
            const railsCount = container ? container.querySelectorAll(".home-rail").length : 0;
            if (activeRailIndex < railsCount - 1) {
              activeRailIndex++;
              activeCardIndex = 0;
              const nextRailData = renderRailsArr2[activeRailIndex];
              if (nextRailData && nextRailData.card_type === "anchor_spotlight_section") {
                anchorSubFocus = "TABS";
                anchorActiveTabIndex = 0;
              }
              updateGridFocus();
            }
          }
        } else if (key === "Enter") {
          event.preventDefault();
          if (anchorSubFocus === "CARDS") {
            const container = document.getElementById("home-rails-container");
            const rails = container ? container.querySelectorAll(".home-rail") : [];
            const activeRailEl = rails[activeRailIndex];
            if (activeRailEl) {
              const cards = activeRailEl.querySelectorAll(".card-focus-wrapper");
              const activeCard = cards[activeCardIndex];
              if (activeCard) {
                activeCard.click();
              }
            }
          }
        }
      } else {
        // Standard non-anchor rail key handler
        if (key === "ArrowLeft") {
          event.preventDefault();
          if (activeCardIndex > 0) {
            activeCardIndex--;
            updateGridFocus();
          } else {
            // Return focus to sidebar
            focusArea = "SIDEBAR";
            expandDrawer();
            updateSidebarFocus();
            updateGridFocus();
          }
        } else if (key === "ArrowRight") {
          event.preventDefault();
          const container = document.getElementById("home-rails-container");
          const rails = container ? container.querySelectorAll(".home-rail") : [];
          const activeRailEl = rails[activeRailIndex];
          if (activeRailEl) {
            const cardsCount = activeRailEl.querySelectorAll(".card-focus-wrapper").length;
            if (activeCardIndex < cardsCount - 1) {
              activeCardIndex++;
              updateGridFocus();
            }
          }
        } else if (key === "ArrowUp") {
          event.preventDefault();
          const currentRailData = renderRailsArr2[activeRailIndex];
          if (currentRailData && currentRailData.card_type === "originals_featured_showcase") {
            // Move focus to the Watch Now button
            focusArea = "ORIGINALS_BTN";
            updateOriginalsButtonFocus(true);
            updateGridFocus();
          } else if (activeRailIndex > 0) {
            activeRailIndex--;
            activeCardIndex = 0;
            const prevRailData = renderRailsArr2[activeRailIndex];
            if (prevRailData && prevRailData.card_type === "anchor_spotlight_section") {
              anchorSubFocus = "CARDS"; // Focus cards row when entering from below
            }
            updateGridFocus();
          } else {
            // At the top row: pressing ArrowUp moves focus back to the sidebar menu bar
            focusArea = "SIDEBAR";
            expandDrawer();
            updateSidebarFocus();
            updateGridFocus();
          }
        } else if (key === "ArrowDown") {
          event.preventDefault();
          const container = document.getElementById("home-rails-container");
          const railsCount = container ? container.querySelectorAll(".home-rail").length : 0;
          if (activeRailIndex < railsCount - 1) {
            activeRailIndex++;
            activeCardIndex = 0; // reset column focus to start of row
            const nextRailData = renderRailsArr2[activeRailIndex];
            if (nextRailData && nextRailData.card_type === "anchor_spotlight_section") {
              anchorSubFocus = "TABS"; // Focus tabs when entering from above
              anchorActiveTabIndex = 0;
            }
            updateGridFocus();
          }
        } else if (key === "Enter") {
          event.preventDefault();
          const container = document.getElementById("home-rails-container");
          const rails = container ? container.querySelectorAll(".home-rail") : [];
          const activeRailEl = rails[activeRailIndex];
          if (activeRailEl) {
            const cards = activeRailEl.querySelectorAll(".card-focus-wrapper");
            const activeCard = cards[activeCardIndex];
            if (activeCard) {
              activeCard.click();
            }
          }
        }
      }
    }
    // ── Watch Now button focus (originals showcase) ──────────────────────────
    else if (focusArea === "ORIGINALS_BTN") {
      if (key === "ArrowDown" || key === "ArrowRight") {
        // Move back to the card row
        event.preventDefault();
        focusArea = "GRID";
        activeCardIndex = 0;
        updateOriginalsButtonFocus(false);
        updateGridFocus();
      } else if (key === "ArrowLeft") {
        // Go to sidebar
        event.preventDefault();
        focusArea = "SIDEBAR";
        updateOriginalsButtonFocus(false);
        expandDrawer();
        updateSidebarFocus();
        updateGridFocus();
      } else if (key === "ArrowUp") {
        // Move to previous rail or sidebar
        event.preventDefault();
        focusArea = "GRID";
        updateOriginalsButtonFocus(false);
        if (activeRailIndex > 0) {
          activeRailIndex--;
          activeCardIndex = 0;
          updateGridFocus();
        } else {
          focusArea = "SIDEBAR";
          expandDrawer();
          updateSidebarFocus();
          updateGridFocus();
        }
      } else if (key === "Enter") {
        event.preventDefault();
        const btn = getOriginalsWatchBtn();
        if (btn) btn.click();
      }
    }
    else if (focusArea === "PLAYER") {
      if (key === "ArrowLeft") {
        event.preventDefault();
        if (playerActiveButton === "FULLSCREEN") {
          playerActiveButton = "MUTE";
          updatePlayerFocus();
        }
      } else if (key === "ArrowRight") {
        event.preventDefault();
        if (playerActiveButton === "MUTE") {
          playerActiveButton = "FULLSCREEN";
          updatePlayerFocus();
        }
      } else if (key === "ArrowDown") {
        event.preventDefault();
        // Restore row list visibility and return focus to active grid card
        restoreRailsFromPlayer();
      } else if (key === "Enter") {
        event.preventDefault();
        if (playerActiveButton === "MUTE") {
          toggleMute();
        } else if (playerActiveButton === "FULLSCREEN") {
          toggleFullScreen();
        }
      }
    }
  }
});
