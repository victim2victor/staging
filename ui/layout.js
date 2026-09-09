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
   Two builds, one source (the unframe online/offline split):
   - online (stg/prd): submissions are inserted into Supabase via its REST
     API; the //online-marked code below is kept.
   - offline (dev): the //online code is stripped, leaving the mailto:
     fallback so submissions still reach the team from the static demo. */
var CONTACT_EMAIL = "victim2victorinitiative@gmail.com";

/* ---- Supabase back-end config (online builds only) ----
   The project URL and publishable (anon) key are public by design and safe
   to commit — row-level security on the tables limits the anon role to
   INSERT (see supabase/migrations). These lines are back-end config, so they
   live inside //online markers: stripped from the dev build, present in
   stg/prd. Fill both in once the Victim2Victor Supabase project exists. */
//online-start
var SUPABASE_URL      = "https://YOUR_PROJECT_REF.supabase.co";
var SUPABASE_ANON_KEY = "YOUR_PUBLISHABLE_KEY";
// Stamped per build: prd keeps "production"; stg rewrites it to "staging"
// (see the Makefile), so staging rows can be filtered from production.
var SUPABASE_ENV      = "production";
//online-end

function handleForm(evt, table, subjectPrefix) {
    evt.preventDefault();
    var form = evt.currentTarget;

    //online-start
    // Online build: persist the submission to Supabase, then thank the user.
    // Each input's `name` is its column; the whole form maps to one row.
    var row = { environment: SUPABASE_ENV };
    var inputs = form.querySelectorAll("input, textarea");
    for (var j = 0; j < inputs.length; j++) {
        if (inputs[j].name) row[inputs[j].name] = inputs[j].value;
    }
    fetch(SUPABASE_URL + "/rest/v1/" + table, {
        method: "POST",
        headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
    }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        form.reset();
        alert("Thank you — your message has been sent.");
    }).catch(function () {
        alert("Sorry, something went wrong. Please email " + CONTACT_EMAIL + " directly.");
    });
    return false;
    //online-end

    // Offline build (dev): compose a mailto: from the fields' labels so
    // submissions still reach the team from the static demo.
    var lines = [];
    var fields = form.querySelectorAll("input, textarea");
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!f.name && !f.dataset.label) continue;
        var label = f.dataset.label || f.name;
        lines.push(label + ": " + f.value);
    }
    window.location.href =
        "mailto:" + CONTACT_EMAIL +
        "?subject=" + encodeURIComponent(subjectPrefix) +
        "&body=" + encodeURIComponent(lines.join("\n"));
    return false;
}
