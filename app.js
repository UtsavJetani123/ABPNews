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
  const currentActive = document.querySelector(".screen-view.active-screen");
  if (currentActive) {
    currentActive.classList.remove("active-screen");
  }
  
  APP_STATE.currentScreen = screen;
  
  const bgContainer = document.getElementById("background-player-container");
  
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
  if (!toast) return;
  
  toast.innerText = message;
  toast.classList.remove("hidden-element");
  
  setTimeout(() => {
    toast.classList.add("hidden-element");
  }, duration);
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
  
  // Set up initial backdrop from first card of the first visible rail if present
  const validRails = APP_STATE.homeData && Array.isArray(APP_STATE.homeData.rails)
    ? APP_STATE.homeData.rails.filter(r => {
        if (r.card_type === "live_tv_channel_rail") return false;
        return (r.items || r.data || []).length > 0;
      })
    : [];
    
  const firstRail = validRails[0];
  if (firstRail) {
    const items = firstRail.items || firstRail.data || [];
    const activeCard = items[0];
    if (activeCard) {
      const backdrop = document.getElementById("home-bg-backdrop");
      if (backdrop) {
        backdrop.style.backgroundImage = `url('${activeCard.lg_poster_image || activeCard.poster_image}')`;
        backdrop.style.opacity = "1";
      }
    }
  }
  
  // 4. Set Initial Focus area to sidebar
  focusArea = "SIDEBAR";
  activeSidebarIndex = 1; // Default to Home
  activeRailIndex = 0;
  activeCardIndex = 0;
  
  expandDrawer();
  updateSidebarFocus();
}

// Get all navigation elements inside sidebar in order
function getSidebarElements() {
  const topMenu = document.getElementById("drawer-top-menu");
  const bottomMenu = document.getElementById("drawer-bottom-menu");
  const topItems = topMenu ? Array.from(topMenu.children) : [];
  const bottomItems = bottomMenu ? Array.from(bottomMenu.children) : [];
  return topItems.concat(bottomItems);
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
      if (lowerLabel === "languages" || lowerLabel === "settings") {
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
    const label = activeItem.querySelector(".nav-label").innerText;
    document.getElementById("home-active-section-title").innerText = `Top ${label}`;
    document.getElementById("home-active-section-desc").innerText = `Browse our selected ${label} category from cheetah server.`;
  }
}

// Action handlers for sidebar menu clicks
function handleSidebarItemClick(item) {
  const label = (item.label.en || "Home").toLowerCase();
  if (label === "languages") {
    switchScreen("LANGUAGE");
    updateLanguageCarouselFocus();
  } else if (label === "settings") {
    showToast("Settings not implemented. Re-select language using the Languages item.");
  } else {
    showToast(`Category switched to: ${item.label.en}`);
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
    if (rail.card_type === "live_tv_channel_rail") {
      return; // Exclude live TV channel rail
    }
    
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

    if (isAnchorSpotlight) {
      renderAnchorSpotlight(railEl, rail, rIdx);
      container.appendChild(railEl);
      return;
    }

    if (isPopularRow1) {
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
      
      if (isPopularRow1 || isPopularRow2) {
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
  
  // Update header brand logo & background watermark logo
  const brandLogoEl = document.getElementById("home-brand-logo");
  const watermarkLogoEl = document.getElementById("home-watermark-logo");
  const activeLang = APP_STATE.languages[currentLanguageIndex];
  if (activeLang) {
    if (brandLogoEl) brandLogoEl.src = activeLang.logo;
    if (watermarkLogoEl) watermarkLogoEl.src = activeLang.logo;
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
          
          if (railData && (railData.card_type === "social_trending_shorts_rail" || railData.card_type === "short_video_news_grid")) {
            // Shorts/News Grid: keep the focused card perfectly centered in the viewport
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
    
    const validRails = APP_STATE.homeData && Array.isArray(APP_STATE.homeData.rails)
      ? APP_STATE.homeData.rails.filter(r => {
          if (r.card_type === "live_tv_channel_rail") return false;
          return (r.items || r.data || []).length > 0;
        })
      : [];
    const currentRailData = validRails[activeRailIndex];
    const isLiveTVFocused = currentRailData && currentRailData.card_type === "live_tv_channel_rail";
    
    if (isLiveTVFocused) {
      // Focus is on the live TV rail
      const liveRail = APP_STATE.homeData && Array.isArray(APP_STATE.homeData.rails)
        ? APP_STATE.homeData.rails.find(r => r.card_type === "live_tv_channel_rail")
        : null;
        
      if (liveRail) {
        const items = liveRail.items || liveRail.data || [];
        const activeCard = items[activeCardIndex];
        if (activeCard) {
          const backdrop = document.getElementById("home-bg-backdrop");
          if (backdrop) {
            backdrop.style.backgroundImage = `url('${activeCard.lg_poster_image || activeCard.poster_image}')`;
            backdrop.style.opacity = "1";
          }
        }
      }
      
      // Schedule auto-play after 10s
      startLivePlayTimer();
      
      // If video was already playing, restart the 5s auto-hide timer
      if (isLiveVideoPlaying) {
        startLiveHideTimer();
      }
    } else {
      // Focus moved away: stop HLS video playback completely
      resetLivePlayer();
    }
  }
}

// Start the 10-second auto-play timer for the live TV channel rail
function startLivePlayTimer() {
  clearTimeout(livePlayTimer);
  
  // Find the live rail
  const liveRail = APP_STATE.homeData && Array.isArray(APP_STATE.homeData.rails) 
    ? APP_STATE.homeData.rails.find(r => r.card_type === "live_tv_channel_rail")
    : null;
    
  if (liveRail) {
    const items = liveRail.items || liveRail.data || [];
    const currentItem = items[activeCardIndex];
    
    if (currentItem && currentItem.video_url) {
      console.log(`Live Player: Scheduling auto-play for ${currentItem.title} in 10s...`);
      livePlayTimer = setTimeout(() => {
        playLiveVideo(currentItem);
      }, 10000);
    }
  }
}

// Play live video using HLS.js or native HTML5 video player
function playLiveVideo(item) {
  const videoEl = document.getElementById("live-video-element");
  if (!videoEl) return;
  
  console.log(`Live Player: Starting video playback for: ${item.title}`);
  resetLivePlayer();
  
  isLiveVideoPlaying = true;
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
  
  const railsContainer = document.getElementById("home-rails-container");
  if (railsContainer) {
    railsContainer.classList.add("scrolled-down");
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
  
  // Start the 5-second timer to auto-hide the row list
  startLiveHideTimer();
}

// Reset the live player state, elements, and cancel timeouts
function resetLivePlayer() {
  clearTimeout(livePlayTimer);
  clearTimeout(liveHideTimer);
  
  isLiveVideoPlaying = false;
  
  const videoEl = document.getElementById("live-video-element");
  if (videoEl) {
    videoEl.pause();
    videoEl.src = "";
    videoEl.removeAttribute("src");
    videoEl.load();
  }
  
  if (hlsPlayer) {
    hlsPlayer.destroy();
    hlsPlayer = null;
  }
  
  // Restore backdrop
  const backdrop = document.getElementById("home-bg-backdrop");
  if (backdrop) {
    backdrop.style.opacity = "1";
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
  if (focusArea === "GRID" && activeRailIndex === 0 && isLiveVideoPlaying) {
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

// Master Keyboard Navigation listener
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
