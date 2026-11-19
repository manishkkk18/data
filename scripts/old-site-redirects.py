# Redirect pages for the two old sites (manishkkk18.github.io/india-night-lights/ and
# /delhi-smoke-watch/), published as the only files on each old repo's gh-pages branch.
# Usage: python scripts/old-site-redirects.py OUTDIR, then force-push OUTDIR/<repo> to that
# repo's gh-pages branch as a single commit.
"""Build the redirect pages for the two old sites (index.html and 404.html are identical)."""
import pathlib, sys

out = pathlib.Path(sys.argv[1])
SITES = {
    "india-night-lights": ("India Night Lights", "night-lights", "#ffb547", "#0b0f1a",
        "How bright every Indian district is at night, month by month since 2015, from NASA Black Marble satellite data."),
    "delhi-smoke-watch": ("India Smoke Watch", "smoke-watch", "#ff7a3d", "#14110f",
        "Whose smoke is your city breathing today? Fires across India from NASA satellites, the winds that carry their smoke, and air quality in 12 cities."),
}
TEMPLATE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{name} has moved</title>
    <link rel="canonical" href="{new}/" />
    <meta name="robots" content="noindex, follow" />
    <!-- Share previews (LinkedIn etc. don't run the redirect script, so old links still preview the app). -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="India from data" />
    <meta property="og:url" content="{new}/" />
    <meta property="og:title" content="{name}" />
    <meta property="og:description" content="{desc}" />
    <meta property="og:image" content="https://manishkkk18.github.io/data/india/og/{new_path}.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <script>
      // Forward to the same place on the new site: sub-path, query (?d=, ?hw=, ?city=…) and #section.
      (function () {{
        var OLD = "/{old}", NEW = "{new}";
        var p = location.pathname, sub = p.indexOf(OLD) === 0 ? p.slice(OLD.length) : "/";
        if (!sub || sub === "/index.html" || sub === "/404.html") sub = "/";
        var to = NEW + sub + location.search + location.hash;
        location.replace(to);
        document.addEventListener("DOMContentLoaded", function () {{
          var a = document.getElementById("to");
          a.href = to;
          a.textContent = to;
        }});
      }})();
    </script>
    <!-- Without JavaScript: go to the new home of the app (the address's details can't be kept). -->
    <noscript><meta http-equiv="refresh" content="0; url={new}/" /></noscript>
    <style>
      body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
        background: {bg}; color: #e8ecf5; font: 16px/1.5 system-ui, sans-serif; text-align: center; }}
      main {{ max-width: 560px; }}
      h1 {{ font-weight: 500; font-size: 24px; margin: 0 0 8px; }}
      a {{ color: {accent}; word-break: break-all; display: inline-block; min-height: 44px; line-height: 44px; }}
    </style>
  </head>
  <body>
    <main>
      <h1>This page has moved</h1>
      <p>{name} now lives at <a id="to" href="{new}/">{new}/</a></p>
      <p>Taking you there… If nothing happens, click the link above.</p>
    </main>
  </body>
</html>
"""
for old, (name, new_path, accent, bg, desc) in SITES.items():
    d = out / old
    d.mkdir(parents=True, exist_ok=True)
    html = TEMPLATE.format(name=name, old=old, new=f"https://manishkkk18.github.io/data/india/{new_path}", new_path=new_path, accent=accent, bg=bg, desc=desc)
    (d / "index.html").write_text(html, encoding="utf-8", newline="\n")
    (d / "404.html").write_text(html, encoding="utf-8", newline="\n")
    (d / ".nojekyll").write_text("", encoding="utf-8")
    print("wrote", d)
