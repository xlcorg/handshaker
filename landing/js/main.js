/* Nav overlay, scroll reveals, and the tagline word trigger.
   Scroll work is throttled through requestAnimationFrame. */

(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var button = document.querySelector("[data-menu-button]");
  var overlay = document.querySelector("[data-menu]");

  if (button && overlay) {
    var links = overlay.querySelectorAll("a");

    function setOpen(open) {
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      overlay.hidden = !open;
      document.body.classList.toggle("menu-open", open);
    }

    button.addEventListener("click", function () {
      var open = button.getAttribute("aria-expanded") === "true";
      setOpen(!open);
      if (!open && links[0]) links[0].focus();
      if (open) button.focus();
    });

    overlay.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
        event.preventDefault();
        setOpen(false);
        button.focus();
      }
    });
  }

  if (!reduce) {
    var nodes = document.querySelectorAll(".reveal");
    if ("IntersectionObserver" in window && nodes.length) {
      var reveal = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            reveal.unobserve(entry.target);
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
      );
      nodes.forEach(function (node) {
        reveal.observe(node);
      });
    } else {
      nodes.forEach(function (node) {
        node.classList.add("is-in");
      });
    }
  }

  var section = document.querySelector("[data-tagline]");
  if (!section) return;
  var words = section.querySelectorAll(".word");

  function updateTagline() {
    if (reduce || !words.length) {
      words.forEach(function (word) {
        word.classList.add("is-on");
      });
      return;
    }
    var rect = section.getBoundingClientRect();
    var vh = window.innerHeight || 1;
    var start = vh * 0.85;
    var end = vh * 0.28;
    var span = start - end || 1;
    var progress = (start - rect.top) / span;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;
    var lit = progress <= 0 ? 0 : progress >= 1 ? words.length : Math.ceil(progress * words.length);
    words.forEach(function (word, index) {
      word.classList.toggle("is-on", index < lit);
    });
  }

  var ticking = false;
  function requestTick() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      updateTagline();
    });
  }

  updateTagline();
  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", requestTick);
})();
