(function () {
  "use strict";

  /** @type {{ id: string, title: string, folder: string, logo: string, photos: string[] }[]} */
  var groups = window.PORTFOLIO_GROUPS || [];
  var tribute = window.PORTFOLIO_TRIBUTE || null;
  var tributeContent = window.PORTFOLIO_TRIBUTE_CONTENT || null;

  var root = document.getElementById("app-root");
  var lightboxEl = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightbox-image");
  var lightboxCaption = document.getElementById("lightbox-caption");
  var btnClose = document.getElementById("lightbox-close");
  var btnPlay = document.getElementById("lightbox-play");
  var btnFastPlay = document.getElementById("lightbox-fast-play");
  var btnPrev = document.getElementById("lightbox-prev");
  var btnNext = document.getElementById("lightbox-next");
  var lightboxStage = document.getElementById("lightbox-stage");
  var headerNav = document.getElementById("header-nav");
  lightboxImg.fetchPriority = "high";

  /** @type {{ groupId: string, index: number } | null} */
  var lightboxState = null;
  var slideshowTimer = null;
  var slideshowMode = null;
  var SLIDESHOW_MS = 5000;
  var SLIDESHOW_FAST_MS = 3000;

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

  function thumbUrl(folder, relativePath) {
    var lastSlash = relativePath.lastIndexOf("/");
    if (lastSlash >= 0) {
      var dir = relativePath.substring(0, lastSlash);
      var name = relativePath.substring(lastSlash + 1);
      return photoUrl(folder, dir + "/thumbs/" + name);
    }
    return photoUrl(folder, "thumbs/" + relativePath);
  }

  function getGroupPhotos(group) {
    if (group.sections && group.sections.length) {
      var all = [];
      group.sections.forEach(function (section) {
        var prefix = section.folder ? section.folder + "/" : "";
        sortPhotos(section.photos).forEach(function (filename) {
          all.push(prefix + filename);
        });
      });
      return all;
    }
    return sortPhotos(group.photos || []);
  }

  function createThumbTile(group, relativePath, index, allPhotos) {
    var tile = document.createElement("button");
    tile.type = "button";
    tile.className = "thumb-tile";
    tile.setAttribute("aria-label", "Open " + relativePath.split("/").pop());

    var thumb = document.createElement("img");
    thumb.src = thumbUrl(group.folder, relativePath);
    thumb.alt = "";
    thumb.decoding = "async";
    if (index < 10) {
      thumb.fetchPriority = "high";
    } else {
      thumb.loading = "lazy";
    }

    tile.appendChild(thumb);
    tile.addEventListener("click", function () {
      openLightbox(group.id, index, allPhotos);
    });
    return tile;
  }

  function findGroup(id) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].id === id) return groups[i];
    }
    return null;
  }

  function findSectionTitle(id) {
    var group = findGroup(id);
    if (group) return group.title;
    if (tribute && id === tribute.id) return tribute.title;
    return id;
  }

  function parseRoute() {
    var hash = window.location.hash || "";
    var path = hash.replace(/^#\/?/, "").trim();
    if (!path) return { name: "home" };
    var parts = path.split("/").filter(Boolean);
    if (parts.length === 1) {
      var id = decodeURIComponent(parts[0]);
      if (tribute && id === tribute.id) return { name: "tribute", id: id };
      return { name: "group", id: id };
    }
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

    var menu = createSectionsMenu(getActiveSectionId(route));
    menu.classList.add("sections-menu--header");

    headerNav.appendChild(menu);
  }

  function getActiveSectionId(route) {
    if (route.name === "group" || route.name === "tribute") return route.id;
    return null;
  }

  function createSectionsMenu(activeSectionId) {
    var nav = document.createElement("nav");
    nav.className = "sections-menu";
    nav.setAttribute("aria-label", "Sections");

    groups.forEach(function (group) {
      var link = document.createElement("a");
      link.className = "sections-menu__link";
      link.href = "#/" + encodeURIComponent(group.id);
      link.textContent = group.title;
      if (activeSectionId === group.id) {
        link.classList.add("is-active");
      }
      nav.appendChild(link);
    });

    return nav;
  }

  function formatPortfolioLastUpdatedGb(iso) {
    if (!iso || typeof iso !== "string") return "";
    var t = Date.parse(iso + "T00:00:00Z");
    if (Number.isNaN(t)) return "";
    return new Date(t).toLocaleDateString("en-GB", {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function createTributeHomeCard() {
    if (!tribute) return null;

    var card = document.createElement("a");
    card.className = "group-card group-card--tribute";
    card.href = "#/" + encodeURIComponent(tribute.id);
    card.setAttribute("aria-label", tribute.title + ", " + (tribute.cardMeta || "photographers"));

    var img = document.createElement("img");
    img.className = "group-card__image";
    img.src = tribute.thumbnail;
    img.alt = "";
    img.decoding = "async";
    img.width = 200;
    img.height = 200;

    var body = document.createElement("div");
    body.className = "group-card__body";
    var title = document.createElement("h2");
    title.className = "group-card__title";
    title.textContent = tribute.title;
    var meta = document.createElement("span");
    meta.className = "group-card__meta";
    meta.textContent = tribute.cardMeta || "Photographers";

    body.appendChild(title);
    body.appendChild(meta);
    card.appendChild(img);
    card.appendChild(body);
    return card;
  }

  function renderTributeProfiles(data) {
    var article = document.createElement("article");
    article.className = "tribute-page";

    data.sections.forEach(function (section, sectionIndex) {
      var sectionEl = document.createElement("section");
      sectionEl.className =
        "tribute-section" +
        (sectionIndex === 0 ? " tribute-section--mentors" : " tribute-section--inspirations");

      var sectionHead = document.createElement("div");
      sectionHead.className = "tribute-section__head";

      var heading = document.createElement("h2");
      heading.className = "tribute-section__title";
      heading.textContent = section.title;
      sectionHead.appendChild(heading);

      sectionEl.appendChild(sectionHead);

      var list = document.createElement("div");
      list.className = "tribute-section__list";

      section.entries.forEach(function (entry) {
        var profile = document.createElement("article");
        profile.className = "tribute-profile";

        var header = document.createElement("header");
        header.className = "tribute-profile__header";

        var name = document.createElement("h3");
        name.className = "tribute-profile__name";
        name.textContent = entry.name;
        header.appendChild(name);

        profile.appendChild(header);

        if (entry.paragraphs.length) {
          var body = document.createElement("div");
          body.className = "tribute-profile__body";
          entry.paragraphs.forEach(function (paragraph) {
            var p = document.createElement("p");
            p.className = "tribute-profile__bio";
            p.innerHTML = paragraph;
            body.appendChild(p);
          });
          profile.appendChild(body);
        }

        var profileLinks = entry.profileLinks;
        if (!profileLinks && entry.profileUrl) {
          profileLinks = [{ label: entry.profileLabel, url: entry.profileUrl }];
        }
        if (profileLinks && profileLinks.length) {
          var footer = document.createElement("footer");
          footer.className = "tribute-profile__footer";
          profileLinks.forEach(function (profileLink) {
            var link = document.createElement("a");
            link.className = "tribute-profile__link";
            link.href = profileLink.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            var linkLabel = profileLink.label || "profile";
            link.textContent = linkLabel;
            link.setAttribute("aria-label", (profileLink.label || "Profile link") + " for " + entry.name);
            footer.appendChild(link);
          });
          profile.appendChild(footer);
        }

        list.appendChild(profile);
      });

      sectionEl.appendChild(list);
      article.appendChild(sectionEl);
    });

    return article;
  }

  function renderTribute() {
    if (!tribute || !tributeContent) {
      root.innerHTML = "<p>Missing tribute content. Ensure <code>tribute-data.js</code> loads before <code>portfolio.js</code>.</p>";
      return;
    }

    document.title = tribute.title + " — Portfolio";
    root.innerHTML = "";

    var hero = document.createElement("header");
    hero.className = "tribute-hero";

    var heroContent = document.createElement("div");
    heroContent.className = "tribute-hero__content";

    var heroText = document.createElement("div");
    heroText.className = "tribute-hero__text";

    var heroTitle = document.createElement("h1");
    heroTitle.className = "tribute-hero__title";
    heroTitle.textContent = tributeContent.title || tribute.title;
    heroText.appendChild(heroTitle);

    heroContent.appendChild(heroText);
    hero.appendChild(heroContent);

    if (tribute.heroImage) {
      var heroMedia = document.createElement("div");
      heroMedia.className = "tribute-hero__media";
      var heroPhoto = document.createElement("img");
      heroPhoto.className = "tribute-hero__photo";
      heroPhoto.src = tribute.heroImage;
      heroPhoto.alt = "";
      heroPhoto.decoding = "async";
      heroMedia.appendChild(heroPhoto);
      hero.appendChild(heroMedia);
    }

    root.appendChild(hero);
    root.appendChild(renderTributeProfiles(tributeContent));
  }

  function renderHome() {
    document.title = "Portfolio — Collections";

    var catalog = document.createElement("div");
    catalog.className = "home-catalog";

    var grid = document.createElement("div");
    grid.className = "group-grid";

    groups.forEach(function (g, cardIndex) {
      var sorted = getGroupPhotos(g);
      var count = sorted.length;
      var card = document.createElement("a");
      card.className = "group-card";
      card.href = "#/" + encodeURIComponent(g.id);
      card.setAttribute("aria-label", g.title + ", " + count + " photographs");

      var img = document.createElement("img");
      img.className = "group-card__image";
      img.src = g.logo;
      img.onerror = function () {
        if (img.dataset.logoFallback === "1") return;
        img.dataset.logoFallback = "1";
        if (sorted.length) {
          img.src = photoUrl(g.folder, sorted[0]);
        }
      };
      img.alt = "";
      if (cardIndex < 4) {
        img.fetchPriority = "high";
      }
      img.decoding = "async";
      img.width = 200;
      img.height = 200;

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

    var tributeCard = createTributeHomeCard();
    if (tributeCard) {
      grid.appendChild(tributeCard);
    }

    root.innerHTML = "";
    catalog.appendChild(grid);

    var lastUpdatedLabel = formatPortfolioLastUpdatedGb(window.PORTFOLIO_LAST_UPDATED);
    if (lastUpdatedLabel) {
      var footer = document.createElement("footer");
      footer.className = "home-footer";
      footer.setAttribute("aria-label", "Site last updated and recently changed albums");
      var footerLine = document.createElement("p");
      footerLine.className = "home-footer__line";

      var footerPre = document.createElement("span");
      footerPre.className = "home-footer__pre";
      footerPre.textContent = "Last updated: ";
      var footerDate = document.createElement("strong");
      footerDate.className = "home-footer__date";
      footerDate.textContent = lastUpdatedLabel;
      footerLine.appendChild(footerPre);
      footerLine.appendChild(footerDate);

      var updatedAlbumIds = window.PORTFOLIO_LAST_UPDATED_ALBUMS;
      if (Array.isArray(updatedAlbumIds) && updatedAlbumIds.length) {
        var albumsSep = document.createElement("span");
        albumsSep.className = "home-footer__albums-sep";
        albumsSep.textContent = ": ";
        footerLine.appendChild(albumsSep);

        var albumsWrap = document.createElement("span");
        albumsWrap.className = "home-footer__albums";
        updatedAlbumIds.forEach(function (id, idx) {
          if (idx > 0) {
            var comma = document.createElement("span");
            comma.className = "home-footer__albums-comma";
            comma.textContent = ", ";
            albumsWrap.appendChild(comma);
          }
          var link = document.createElement("a");
          link.className = "home-footer__album-link";
          link.href = "#/" + encodeURIComponent(id);
          link.textContent = findSectionTitle(id);
          albumsWrap.appendChild(link);
        });
        footerLine.appendChild(albumsWrap);
      }

      footer.appendChild(footerLine);

      catalog.appendChild(footer);
    }

    root.appendChild(catalog);
  }

  function renderGroup(group) {
    document.title = group.title + " — Portfolio";
    var allPhotos = getGroupPhotos(group);

    var title = document.createElement("h1");
    title.className = "page-title";
    title.textContent = group.title;

    root.innerHTML = "";
    root.appendChild(title);

    if (group.sections && group.sections.length) {
      group.sections.forEach(function (section) {
        var sectionEl = document.createElement("section");
        sectionEl.className = "album-section";

        var sectionTitle = document.createElement("h2");
        sectionTitle.className = "album-section__title";
        sectionTitle.textContent = section.title;
        sectionEl.appendChild(sectionTitle);

        var grid = document.createElement("div");
        grid.className = "thumb-grid";

        var prefix = section.folder ? section.folder + "/" : "";
        sortPhotos(section.photos).forEach(function (filename) {
          var relativePath = prefix + filename;
          var index = allPhotos.indexOf(relativePath);
          grid.appendChild(createThumbTile(group, relativePath, index, allPhotos));
        });

        sectionEl.appendChild(grid);
        root.appendChild(sectionEl);
      });
      return;
    }

    var grid = document.createElement("div");
    grid.className = "thumb-grid";

    allPhotos.forEach(function (filename, index) {
      grid.appendChild(createThumbTile(group, filename, index, allPhotos));
    });

    root.appendChild(grid);
  }

  function getSortedPhotosForGroup(groupId) {
    var g = findGroup(groupId);
    if (!g) return [];
    return getGroupPhotos(g);
  }

  function revealLightboxPhoto() {
    lightboxEl.classList.remove("lightbox--awaiting-photo");
  }

  function syncLightboxTopOffset() {
    var header = document.querySelector(".site-header");
    var offset = header ? header.offsetHeight : 56;
    document.documentElement.style.setProperty("--lightbox-top-offset", offset + "px");
  }

  function resetSlideshowButtons() {
    if (btnPlay) {
      btnPlay.classList.remove("is-playing");
      btnPlay.textContent = "Play";
      btnPlay.setAttribute("aria-label", "Play slideshow");
    }
    if (btnFastPlay) {
      btnFastPlay.classList.remove("is-playing");
      btnFastPlay.textContent = "Fast play";
      btnFastPlay.setAttribute("aria-label", "Fast play slideshow");
    }
  }

  function stopSlideshow() {
    if (slideshowTimer) {
      clearInterval(slideshowTimer);
      slideshowTimer = null;
    }
    slideshowMode = null;
    resetSlideshowButtons();
  }

  function updateSlideshowControls() {
    if (!lightboxState) return;
    var sorted = getSortedPhotosForGroup(lightboxState.groupId);
    var atLast = lightboxState.index >= sorted.length - 1;
    if (atLast) {
      stopSlideshow();
    }
    if (btnPlay) btnPlay.disabled = atLast;
    if (btnFastPlay) btnFastPlay.disabled = atLast;
  }

  function startSlideshow(mode) {
    var intervalMs = mode === "fast-play" ? SLIDESHOW_FAST_MS : SLIDESHOW_MS;
    var activeBtn = mode === "fast-play" ? btnFastPlay : btnPlay;
    var pauseLabel =
      mode === "fast-play" ? "Pause fast play slideshow" : "Pause slideshow";

    if (!lightboxState || !activeBtn || activeBtn.disabled) return;
    stopSlideshow();
    slideshowMode = mode;
    activeBtn.classList.add("is-playing");
    activeBtn.textContent = "Pause";
    activeBtn.setAttribute("aria-label", pauseLabel);
    slideshowTimer = setInterval(function () {
      if (!lightboxState) {
        stopSlideshow();
        return;
      }
      var sorted = getSortedPhotosForGroup(lightboxState.groupId);
      if (lightboxState.index >= sorted.length - 1) {
        stopSlideshow();
        return;
      }
      stepLightbox(1, true);
    }, intervalMs);
  }

  function toggleSlideshow(mode) {
    if (slideshowTimer && slideshowMode === mode) {
      stopSlideshow();
    } else {
      startSlideshow(mode);
    }
  }

  function openLightbox(groupId, index, sortedOverride) {
    stopSlideshow();
    var sorted = sortedOverride || getSortedPhotosForGroup(groupId);
    if (!sorted.length) return;
    lightboxState = { groupId: groupId, index: Math.max(0, Math.min(index, sorted.length - 1)) };
    lightboxEl.classList.add("lightbox--awaiting-photo");
    lightboxEl.hidden = false;
    document.body.classList.add("lightbox-open");
    syncLightboxTopOffset();
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        updateLightboxImage();
      });
    });
  }

  function closeLightbox() {
    stopSlideshow();
    lightboxState = null;
    lightboxEl.classList.remove("lightbox--awaiting-photo");
    lightboxEl.hidden = true;
    document.body.classList.remove("lightbox-open");
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
    lightboxEl.classList.add("lightbox--awaiting-photo");
    var sorted = getSortedPhotosForGroup(lightboxState.groupId);
    var idx = lightboxState.index;
    var filename = sorted[idx];
    var nextSrc = photoUrl(g.folder, filename);
    lightboxImg.classList.add("is-loading");
    lightboxImg.removeAttribute("src");
    lightboxImg.onload = function () {
      lightboxImg.classList.remove("is-loading");
      revealLightboxPhoto();
    };
    lightboxImg.onerror = function () {
      lightboxImg.classList.remove("is-loading");
      revealLightboxPhoto();
    };
    lightboxImg.src = nextSrc;
    if (lightboxImg.complete) {
      window.requestAnimationFrame(function () {
        lightboxImg.classList.remove("is-loading");
        revealLightboxPhoto();
      });
    }
    lightboxImg.alt = filename;
    lightboxCaption.textContent = g.title + " · " + (idx + 1) + " / " + sorted.length;
    btnPrev.disabled = idx <= 0;
    btnNext.disabled = idx >= sorted.length - 1;
    updateSlideshowControls();
  }

  function stepLightbox(delta, fromSlideshow) {
    if (!lightboxState) return;
    if (!fromSlideshow) {
      stopSlideshow();
    }
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
    closeLightbox();
    var route = parseRoute();
    renderHeader(route);
    if (route.name === "home") {
      renderHome();
      return;
    }
    if (route.name === "tribute") {
      renderTribute();
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
  if (btnPlay) {
    btnPlay.addEventListener("click", function () {
      toggleSlideshow("play");
    });
  }
  if (btnFastPlay) {
    btnFastPlay.addEventListener("click", function () {
      toggleSlideshow("fast-play");
    });
  }
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

  window.addEventListener("resize", function () {
    if (!lightboxEl.hidden) {
      syncLightboxTopOffset();
    }
  });

  syncLightboxTopOffset();

  var siteHeader = document.querySelector(".site-header");
  if (siteHeader) {
    siteHeader.addEventListener("click", function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      var link = t.closest("a[href^=\"#\"]");
      if (!link) return;
      closeLightbox();
    });
  }

  if (!groups.length) {
    root.innerHTML =
      "<p>Missing gallery data. Ensure <code>gallery-data.js</code> loads before <code>portfolio.js</code>.</p>";
  } else {
    render();
  }
})();
