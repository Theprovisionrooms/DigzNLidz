// Cookie notice banner, shared across every page. Shows once until
// dismissed (stored in localStorage, not a cookie, since remembering "the
// user dismissed this" shouldn't itself need consent). Kept as a single
// acknowledgement rather than a granular accept/reject: this site doesn't
// set any non-essential cookies of its own (Cloudflare Web Analytics is
// cookie-free), the only cookies in play come from Square's payment form
// as part of completing a transaction the visitor explicitly started.
// Whether that specific case needs a fuller opt-in mechanism rather than
// a notice is a question for the solicitor reviewing the privacy policy,
// not something decided here.

(function () {
  if (localStorage.getItem("dnl-cookie-notice-dismissed")) return;

  var banner = document.createElement("div");
  banner.className = "cookie-notice";
  banner.innerHTML =
    '<p>This site uses minimal cookies, mainly from Square as part of taking secure payments. See our <a href="/privacy/">Privacy Policy</a> for details.</p>' +
    '<button type="button">Got it</button>';

  document.body.appendChild(banner);

  banner.querySelector("button").addEventListener("click", function () {
    localStorage.setItem("dnl-cookie-notice-dismissed", "1");
    banner.remove();
  });
})();
