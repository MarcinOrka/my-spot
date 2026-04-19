(function () {
  "use strict";

  /** @type {{ id: string, title: string, folder: string, logo: string, photos: string[] }[]} */
  var groups = window.PORTFOLIO_GROUPS || [];

  var root = document.getElementById("app-root");
  var lightboxEl = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightbox-image");
  var lightboxCaption = document.getElementById("lightbox-caption");
  var btnClose = document.getElementById("lightbox-close");
  var btnPrev = document.getElementById("lightbox-prev");
  var btnNext = document.getElementById("lightbox-next");
  var lightboxStage = document.getElementById("lightbox-stage");
  var headerNav = document.getElementById("header-nav");
  lightboxImg.fetchPriority = "high";

  /** @type {{ groupId: string, index: number } | null} */
  var lightboxState = null;

  function naturalCompare(a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }

  function sortPhotos(photos) {
    return photos.slice().sort(naturalCompare);
  }

  function photoUrl(folder, filename) {
    var encFolder = encodeURIComponent(folder).replace(/%2F/g, "/");
    var segments = filename.split("/");
    var encodedName = segments
      .map(function (part) {
        return encodeURIComponent(part);
      })
      .join("/");
    return encFolder + "/" + encodedName;
  }

  function findGroup(id) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === id) return groups[i];
    }
    return null;
  }

  function parseRoute() {
    var hash = window.location.hash || "";
    var path = hash.replace(/^#\/?/, "").trim();
    if (!path) return { name: "home" };
    var parts = path.split("/").filter(Boolean);
    if (parts.length === 1) return { name: "group", id: parts[0] };
    return { name: "home" };
  }

  function setRoute(route) {
    if (route.name === "home") {
      window.location.hash = "#/";
    } else {
      window.location.hash = "#/" + encodeURIComponent(route.id);
    }
  }

  function renderHeader(route) {
    headerNav.innerHTML = "";
    if (route.name === "group") {
      var back = document.createElement("button");
      back.type = "button";
      back.className = "btn btn--ghost";
      back.textContent = "← All collections";
      back.addEventListener("click", function () {
        setRoute({ name: "home" });
      });
      headerNav.appendChild(back);
    }
  }

  function renderHome() {
    document.title = "Portfolio — Collections";
    var hero = document.createElement("div");
    hero.className = "hero";
    hero.innerHTML =
      "<h1>Marcin Jaruszewicz's Photography</h1><p>Welcome to my photography portfolio. I'm happy you are here! Enjoy!</p>";

    var grid = document.createElement("div");
    grid.className = "group-grid";

    groups.forEach(function (g) {
      var sorted = sortPhotos(g.photos);
      var count = sorted.length;
      var card = document.createElement("a");
      card.className = "group-card";
      card.href = "#/" + encodeURIComponent(g.id);
      card.setAttribute("aria-label", g.title + ", " + count + " photographs");

      var img = document.createElement("img");
      img.className = "group-card__image";
      img.src = g.logo;
      img.alt = "";
      img.fetchPriority = "high";
      img.width = 250;
      img.height = 250;

      var body = document.createElement("div");
      body.className = "group-card__body";
      var title = document.createElement("h2");
      title.className = "group-card__title";
      title.textContent = g.title;
      var meta = document.createElement("span");
      meta.className = "group-card__meta";
      meta.textContent = count + (count === 1 ? " photo" : " photos");

      body.appendChild(title);
      body.appendChild(meta);
      card.appendChild(img);
      card.appendChild(body);
      grid.appendChild(card);
    });

    root.innerHTML = "";
    root.appendChild(hero);
    root.appendChild(grid);
  }

  function renderGroup(group) {
    document.title = group.title + " — Portfolio";
    var sorted = sortPhotos(group.photos);

    var title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = group.title;

    var grid = document.createElement("div");
    grid.className = "thumb-grid";

    sorted.forEach(function (filename, index) {
      var tile = document.createElement("button");
      tile.type = "button";
      tile.className = "thumb-tile";
      tile.setAttribute("aria-label", "Open " + filename);

      var thumb = document.createElement("img");
      thumb.src = photoUrl(group.folder, filename);
      thumb.alt = "";
      thumb.fetchPriority = "high";
      thumb.decoding = "async";

      tile.appendChild(thumb);
      tile.addEventListener("click", function () {
        openLightbox(group.id, index, sorted);
      });
      grid.appendChild(tile);
    });

    root.innerHTML = "";
    root.appendChild(title);
    root.appendChild(grid);
  }

  function getSortedPhotosForGroup(groupId) {
    var g = findGroup(groupId);
    if (!g) return [];
    return sortPhotos(g.photos);
  }

  function openLightbox(groupId, index, sortedOverride) {
    var sorted = sortedOverride || getSortedPhotosForGroup(groupId);
    if (!sorted.length) return;
    lightboxState = { groupId: groupId, index: Math.max(0, Math.min(index, sorted.length - 1)) };
    lightboxEl.hidden = false;
    document.body.style.overflow = "hidden";
    updateLightboxImage();
  }

  function closeLightbox() {
    lightboxState = null;
    lightboxEl.hidden = true;
    lightboxImg.classList.remove("is-loading");
    lightboxImg.removeAttribute("src");
    document.body.style.overflow = "";
  }

  function updateLightboxImage() {
    if (!lightboxState) return;
    var g = findGroup(lightboxState.groupId);
    if (!g) {
      closeLightbox();
      return;
    }
    var sorted = getSortedPhotosForGroup(lightboxState.groupId);
    var idx = lightboxState.index;
    var filename = sorted[idx];
    var nextSrc = photoUrl(g.folder, filename);
    lightboxImg.classList.add("is-loading");
    lightboxImg.removeAttribute("src");
    lightboxImg.onload = function () {
      lightboxImg.classList.remove("is-loading");
    };
    lightboxImg.onerror = function () {
      lightboxImg.classList.remove("is-loading");
    };
    lightboxImg.src = nextSrc;
    if (lightboxImg.complete) {
      window.requestAnimationFrame(function () {
        lightboxImg.classList.remove("is-loading");
      });
    }
    lightboxImg.alt = filename;
    lightboxCaption.textContent = g.title + " · " + (idx + 1) + " / " + sorted.length;
    btnPrev.disabled = idx <= 0;
    btnNext.disabled = idx >= sorted.length - 1;
  }

  function stepLightbox(delta) {
    if (!lightboxState) return;
    var sorted = getSortedPhotosForGroup(lightboxState.groupId);
    var next = lightboxState.index + delta;
    if (next < 0 || next >= sorted.length) return;
    lightboxState.index = next;
    updateLightboxImage();
  }

  function isProtectedPhotoElement(target) {
    return (
      target instanceof Element &&
      target.matches(".group-card__image, .thumb-tile img, .lightbox__image")
    );
  }

  function render() {
    var route = parseRoute();
    renderHeader(route);
    if (route.name === "home") {
      renderHome();
      return;
    }
    var group = findGroup(route.id);
    if (!group) {
      setRoute({ name: "home" });
      return;
    }
    renderGroup(group);
  }

  btnClose.addEventListener("click", closeLightbox);
  btnPrev.addEventListener("click", function () {
    stepLightbox(-1);
  });
  btnNext.addEventListener("click", function () {
    stepLightbox(1);
  });

  lightboxEl.addEventListener("click", function (e) {
    if (e.target === lightboxEl) closeLightbox();
  });

  lightboxStage.addEventListener("click", function (e) {
    if (e.target === lightboxStage) closeLightbox();
  });

  document.addEventListener("contextmenu", function (e) {
    if (!isProtectedPhotoElement(e.target)) return;
    e.preventDefault();
  });

  document.addEventListener("dragstart", function (e) {
    if (!isProtectedPhotoElement(e.target)) return;
    e.preventDefault();
  });

  document.addEventListener("keydown", function (e) {
    if (lightboxEl.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepLightbox(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stepLightbox(1);
    }
  });

  window.addEventListener("hashchange", render);

  if (!groups.length) {
    root.innerHTML =
      "<p>Missing gallery data. Ensure <code>gallery-data.js</code> loads before <code>portfolio.js</code>.</p>";
  } else {
    render();
  }
})();
