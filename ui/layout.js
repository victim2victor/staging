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
   The project URL and publishable (anon) key are public by design and safe to
   commit — the tables are RLS-on with no policies, so the key cannot read or
   write them; every insert goes through the `submit-form` edge function, which
   also rate-limits (see supabase/). These lines are back-end config, so they
   live inside //online markers: stripped from the dev build, present in
   stg/prd. Fill both in once the Victim2Victor Supabase project exists. */
//online-start
var SUPABASE_URL  = "https://bhwzunirlxmfknelnjtx.supabase.co";
var SUPABASE_ANON = "sb_publishable_JYZYkEzooPHRLT0Jufi6hA_qe9373ZB";
// Stamped per build: prd keeps 1 (production); stg rewrites it to 0 (staging)
// (see the Makefile). The edge function trusts this only where the request
// origin doesn't already resolve the environment.
var SUPABASE_ENV  = 1;

// A random per-browser token, kept in localStorage — sent with each request so
// the edge function can resolve (or create) this browser's session row; it is
// also one of the rate-limit keys.
function sessionToken() {
    try {
        var t = localStorage.getItem("v2v_session");
        if (!t) {
            t = (crypto.randomUUID ? crypto.randomUUID()
                 : Date.now().toString(36) + Math.random().toString(36).slice(2));
            localStorage.setItem("v2v_session", t);
        }
        return t;
    } catch (e) { return null; }   // storage blocked → submit without a token
}

// Anonymous page-visit beacon: fire-and-forget to the track-visit edge
// function on load. Never blocks or affects the page; the offline build strips
// it entirely. The edge function bot-filters, geolocates and rate-limits.
(function trackVisit() {
    try {
        fetch(SUPABASE_URL + "/functions/v1/track-visit", {
            method: "POST",
            keepalive: true,
            headers: {
                "Authorization": "Bearer " + SUPABASE_ANON,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                token: sessionToken(),
                env: SUPABASE_ENV,
                page: location.pathname,
                referrer: document.referrer || null
            })
        }).catch(function () {});
    } catch (e) { /* tracking never affects the page */ }
})();
//online-end

function handleForm(evt, table, subjectPrefix) {
    evt.preventDefault();
    var form = evt.currentTarget;

    //online-start
    // Online build: POST to the submit-form edge function (service role writes;
    // it validates, honeypots and rate-limits). `table` names the form.
    var payload = { form: table, env: SUPABASE_ENV, token: sessionToken() };
    var inputs = form.querySelectorAll("input, textarea");
    for (var j = 0; j < inputs.length; j++) {
        if (inputs[j].name) payload[inputs[j].name] = inputs[j].value;
    }
    fetch(SUPABASE_URL + "/functions/v1/submit-form", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + SUPABASE_ANON,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.ok) {
                form.reset();
                alert("Thank you — your message has been sent.");
            } else {
                alert((data && data.error) ||
                    "Sorry, something went wrong. Please email " + CONTACT_EMAIL + " directly.");
            }
        });
    }).catch(function () {
        alert("Network error. Please try again, or email " + CONTACT_EMAIL + " directly.");
    });
    return false;
    //online-end

    // Offline build (dev): compose a mailto: from the fields' labels so
    // submissions still reach the team from the static demo.
    var lines = [];
    var fields = form.querySelectorAll("input, textarea");
    for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (f.dataset.hp) continue;                 // skip the honeypot
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
