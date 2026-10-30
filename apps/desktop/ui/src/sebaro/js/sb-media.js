// sb-media.js: the audio row and the video of spec/02 §3.25 and §3.26 (D91 B11b, B12b).
// Classic script (pages open from file://), CSP-safe: no inline handlers, no eval, no innerHTML.
// The browser plays: a native <audio> / <video> is the engine and the fallback. Without this script the page shows the
// native controls (the markup carries `controls`) and everything still plays, seeks and shows captions.
//
// Audio row (custom controls from system parts, the native element stays the engine):
//   <div class="sb-audio" data-sb-audio data-sb-name="Sprachnotiz vom 20.10.2026">
//     <p class="sb-audio__head"><span class="sb-audio__title">Sprachnotiz</span>
//       <span class="sb-audio__time"><time class="sb-audio__now" datetime="PT0S">0:00</time> /
//       <time class="sb-audio__total" datetime="PT8S">0:08</time></span></p>
//     <audio class="sb-audio__media" src="…" preload="none" controls></audio>
//     <button class="sb-icon-button sb-audio__toggle" type="button" aria-label="Sprachnotiz vom 20.10.2026 abspielen" hidden>
//       <svg class="sb-icon" …><use href="#play"/></svg></button>
//     <div class="sb-range__track sb-audio__seek" hidden><span class="sb-range__rail"></span><span class="sb-range__fill"></span>
//       <input type="range" min="0" max="8" step="1" value="0" aria-label="Stelle in der Sprachnotiz" aria-valuetext="0:00 von 0:08"></div>
//     <p class="sb-audio__message" role="status"></p>   (empty, so not shown, until a failure)
//   </div>
//   The script removes `controls`, shows the toggle and the slider. The toggle is named „<name> abspielen“ /
//   „<name> anhalten“ (MESSAGES) and swaps the play / pause icon; the row carries data-sb-state="playing" while it plays
//   (D85: ARIA has no word for it). The slider seeks: pointer, Home / End, arrows ±5 s, PageUp / PageDown ±10 %; its
//   aria-valuetext is „0:12 von 0:42“. The time is text in tabular figures and <time datetime>. Starting one medium
//   pauses every other audio row and video on the page. A failure writes „Die Aufnahme lässt sich nicht abspielen.“
//   after a danger glyph into __message (D83 (2): the reason in text, never colour alone).
//
// Video (native element with poster, a real play button over the poster):
//   <figure class="sb-video" data-sb-video>
//     <div class="sb-video__frame">
//       <video class="sb-video__media" poster="…-light.webp" data-sb-poster-dark="…-dark.webp" preload="none"
//              playsinline controls aria-labelledby="v1-cap" aria-describedby="v1-poster">
//         <source src="…" type="video/webm"><track kind="captions" srclang="de" label="Deutsch" src="….vtt" default></video>
//       <button class="sb-video__play" type="button" aria-label="Abspielen: <title>, Video, 3 Minuten 42 Sekunden"
//               aria-describedby="v1-poster" hidden>
//         <svg class="sb-icon" …><use href="#play--filled"/></svg><span>Abspielen</span></button>
//     </div>
//     <figcaption id="v1-cap">Erste Schritte · <time datetime="PT3M42S">3:42</time> · Untertitel Deutsch, Englisch</figcaption>
//     <p class="sb-visually-hidden" id="v1-poster">Vorschaubild: what the picture shows, in one sentence</p>
//   </figure>
//   The script removes `controls` until the start and shows the button. Its press gives the video the browser's
//   controls (with the captions menu), starts it, drops the poster description (the button's aria-describedby) from
//   the video's aria-describedby, since the poster is gone once it plays, and moves focus to the video, so the
//   keyboard reaches its controls. No autoplay, ever. What loads when: the poster with the page (one request to the
//   product's own server, D18; in dark mode a second one for data-sb-poster-dark), the video only after the press
//   (preload="none"). data-sb-poster-dark is the poster in dark mode (follows <html data-theme> and the system
//   setting, and "sb-theme-change"); while the page prints the light poster stands (beforeprint / afterprint).
// Motion (D80): none of its own. The slider fill moves while a medium plays because the user started it; nothing moves
// on load. Words per language (D87, spec/09 §6.1): MESSAGES; window.sbMessages["sb-media"] adds a language.
(function () {
  "use strict";
  var MESSAGES = {
    de: { play: "{name} abspielen", pause: "{name} anhalten", position: "{now} von {total}",
          audioFailed: "Die Aufnahme lässt sich nicht abspielen.", videoFailed: "Das Video lässt sich nicht abspielen." },
    en: { play: "Play {name}", pause: "Pause {name}", position: "{now} of {total}",
          audioFailed: "This recording can’t be played.", videoFailed: "This video can’t be played." }
  };
  var extra = window.sbMessages && window.sbMessages["sb-media"];
  if (extra) Object.keys(extra).forEach(function (l) { MESSAGES[l.toLowerCase()] = extra[l]; });
  var SVGNS = "http://www.w3.org/2000/svg";
  var STEP = 5;                                       // seconds per arrow key

  function t(el, key, vars) {
    var holder = el.closest("[lang]");
    var lang = ((holder || document.documentElement).getAttribute("lang") || "de").toLowerCase();
    var tb = MESSAGES[lang] || MESSAGES[lang.split("-")[0]] || MESSAGES.de;
    var s = tb[key] != null ? tb[key] : MESSAGES.de[key];
    return s.replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? vars[k] : all; });
  }
  function clock(sec) {                               // m:ss, or h:mm:ss from one hour
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function duration(sec) { sec = Math.max(0, Math.floor(sec || 0)); return "PT" + (sec >= 60 ? Math.floor(sec / 60) + "M" : "") + (sec % 60) + "S"; }
  function setIcon(button, id) {
    var use = button.querySelector("use");
    if (use) use.setAttribute("href", "#" + id);
  }
  function glyph(id) {
    var svg = document.createElementNS(SVGNS, "svg"), use = document.createElementNS(SVGNS, "use");
    svg.setAttribute("class", "sb-icon sb-icon--16"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
    use.setAttribute("href", "#" + id); svg.appendChild(use);
    return svg;
  }
  function fail(message, text) {
    if (!message) return;
    message.replaceChildren(glyph("error--filled-16"), document.createTextNode(text));   // a live region, empty until now
  }
  function pauseOthers(except) {
    document.querySelectorAll(".sb-audio__media, .sb-video__media").forEach(function (m) { if (m !== except && !m.paused) m.pause(); });
  }

  // ------------------------------------------------------------------ audio row
  function initAudio(row) {
    var media = row.querySelector(".sb-audio__media"), toggle = row.querySelector(".sb-audio__toggle");
    var seek = row.querySelector(".sb-audio__seek"), input = seek && seek.querySelector("input[type='range']");
    var now = row.querySelector(".sb-audio__now"), total = row.querySelector(".sb-audio__total");
    var message = row.querySelector(".sb-audio__message");
    if (!media || !toggle || !input || row.hasAttribute("data-sb-ready")) return;
    row.setAttribute("data-sb-ready", "");
    var name = row.getAttribute("data-sb-name") || (row.querySelector(".sb-audio__title") || row).textContent.trim();
    var length = +input.max || 0;

    function sync() {
      var pos = media.currentTime || +input.value || 0, len = isFinite(media.duration) && media.duration > 0 ? media.duration : length;
      input.max = String(Math.round(len) || 1);
      if (document.activeElement !== input || !seeking) input.value = String(Math.min(pos, len));
      input.setAttribute("aria-valuetext", t(row, "position", { now: clock(pos), total: clock(len) }));
      seek.style.setProperty("--sb-range-from", "0");
      seek.style.setProperty("--sb-range-to", String(len ? Math.min(1, pos / len) : 0));
      if (now) { now.textContent = clock(pos); now.setAttribute("datetime", duration(pos)); }
      if (total) { total.textContent = clock(len); total.setAttribute("datetime", duration(len)); }
    }
    function label() {
      var playing = !media.paused && !media.ended;
      toggle.setAttribute("aria-label", t(row, playing ? "pause" : "play", { name: name }));
      setIcon(toggle, playing ? "pause" : "play");
      if (playing) row.setAttribute("data-sb-state", "playing"); else row.removeAttribute("data-sb-state");
    }
    var seeking = false;

    media.controls = false;
    media.hidden = true;
    toggle.hidden = false;
    seek.hidden = false;
    label(); sync();

    toggle.addEventListener("click", function () {
      if (media.paused || media.ended) {
        pauseOthers(media);
        var p = media.play();
        if (p && p.catch) p.catch(function () { /* the error event reports it */ });
      } else media.pause();
    });
    input.addEventListener("input", function () { seeking = true; media.currentTime = +input.value; sync(); seeking = false; });
    input.addEventListener("keydown", function (event) {
      var len = +input.max, v = +input.value, next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") next = v + STEP;
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = v - STEP;
      else if (event.key === "PageUp") next = v + len / 10;
      else if (event.key === "PageDown") next = v - len / 10;
      if (next == null) return;                       // Home / End stay native
      event.preventDefault();
      if (getComputedStyle(input).direction === "rtl" && (event.key === "ArrowRight" || event.key === "ArrowLeft")) next = 2 * v - next;
      media.currentTime = Math.max(0, Math.min(len, next));
      input.value = String(media.currentTime);
      sync();
    });
    ["play", "pause", "ended"].forEach(function (e) { media.addEventListener(e, label); });
    ["timeupdate", "durationchange", "loadedmetadata", "seeked"].forEach(function (e) { media.addEventListener(e, sync); });
    media.addEventListener("ended", function () { media.currentTime = 0; sync(); });
    media.addEventListener("error", function () { label(); fail(message, t(row, "audioFailed")); }, true);
  }

  // ------------------------------------------------------------------ video
  var printing = false;   // paper is light (spec/09 §18.3): the light poster while the page prints (OR-11)
  function dark() {
    if (printing) return false;
    var theme = document.documentElement.getAttribute("data-theme");
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function poster(video) {
    var light = video.getAttribute("data-sb-poster-light") || video.getAttribute("poster");
    if (!video.hasAttribute("data-sb-poster-light") && light) video.setAttribute("data-sb-poster-light", light);
    var night = video.getAttribute("data-sb-poster-dark");
    var want = night && dark() ? night : light;
    if (want && video.getAttribute("poster") !== want) video.setAttribute("poster", want);
  }
  function initVideo(figure) {
    var video = figure.querySelector(".sb-video__media"), play = figure.querySelector(".sb-video__play");
    var message = figure.querySelector(".sb-video__message");
    if (!video || figure.hasAttribute("data-sb-ready")) return;
    figure.setAttribute("data-sb-ready", "");
    poster(video);
    if (!play) return;
    video.controls = false;
    play.hidden = false;
    play.addEventListener("click", function () {
      pauseOthers(video);
      video.controls = true;
      play.hidden = true;
      var said = (play.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
      var left = (video.getAttribute("aria-describedby") || "").split(/\s+/).filter(function (id) { return id && said.indexOf(id) < 0; });
      if (left.length) video.setAttribute("aria-describedby", left.join(" ")); else video.removeAttribute("aria-describedby");
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* the error event reports it */ });
      video.focus();
    });
    video.addEventListener("play", function () { pauseOthers(video); });
    video.addEventListener("error", function () { fail(message, t(figure, "videoFailed")); }, true);
  }

  function themeChanged() { document.querySelectorAll(".sb-video__media[data-sb-poster-dark]").forEach(poster); }
  document.addEventListener("sb-theme-change", themeChanged);
  window.addEventListener("beforeprint", function () { printing = true; themeChanged(); });
  window.addEventListener("afterprint", function () { printing = false; themeChanged(); });
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mq.addEventListener) mq.addEventListener("change", themeChanged);
  }

  function init() {
    document.querySelectorAll("[data-sb-audio]").forEach(initAudio);
    document.querySelectorAll("[data-sb-video]").forEach(initVideo);
  }
  window.sbMedia = { init: init };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
