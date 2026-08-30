/* ============================================================
   Victim2Victor — layout.js
   No framework, no dependencies. Inlined into dist/index.html.
   ============================================================ */

/* ---- Mobile navigation toggle ---- */
(function initNav() {
    var toggle = document.querySelector(".nav-toggle");
    var links  = document.getElementById("nav-links");
    if (!toggle || !links) return;

    toggle.addEventListener("click", function () {
        var open = links.classList.toggle("open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });

    // close the menu after tapping a link (mobile)
    links.addEventListener("click", function (e) {
        if (e.target.tagName === "A") links.classList.remove("open");
    });
})();

/* ---- Contact forms ----
   Backend is intentionally deferred (see README). Until a backend
   (e.g. Supabase, per the unframe online build) is wired in, each
   form composes a mailto: to info@victim2victor.co.za from its
   fields so submissions still reach the team. Swap `handleForm`
   for a `fetch(...)` inside //online markers when the backend lands. */
var CONTACT_EMAIL = "info@victim2victor.co.za";

function handleForm(evt, subjectPrefix) {
    evt.preventDefault();
    var form = evt.currentTarget;
    var lines = [];
    var fields = form.querySelectorAll("input, textarea");
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f.name && !f.dataset.label) continue;
        var label = f.dataset.label || f.name;
        lines.push(label + ": " + f.value);
    }
    var subject = subjectPrefix;
    var body = lines.join("\n");
    window.location.href =
        "mailto:" + CONTACT_EMAIL +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(body);
    return false;
}
