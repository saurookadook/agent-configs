# Beautiful Soup Standards

Applies to code that extracts data from HTML pages: listing and article scrapers in
`services/`, and HTML-to-text steps inside crawlers. Fetching rules shared with API
clients are in [httpx.md](httpx.md); text processing after extraction is in
[nltk.md](nltk.md).

**Stack:** `beautifulsoup4` with the standard library `html.parser`. Crawling many pages
(link following, throttling, JavaScript rendering) is Scrapy's job, with Beautiful Soup
used only to turn a fetched body into text.

---

## Module shape

**SOUP-1 — One module per site, at `services/<site>.py`,** exposing a `HOST` constant and
three public functions:

```python
HOST = "news.example.com"


def fetch(url: str) -> str:
    """Retrieves a page. Raises ``FetchError`` if it cannot be read."""


def parse_article_html(html: str) -> dict[str, Any]:
    """Extracts an article payload from a page. Raises ``ScrapeError``."""


def scrape(url: str) -> dict[str, Any]:
    """Fetches and parses an article, returning a payload ready to store."""
    payload = parse_article_html(fetch(url))
    payload["source_url"] = url
    return payload
```

Parsing takes a string and touches nothing else (no network, no database, no clock
except a documented default), so it can be tested on saved pages.

**SOUP-2 — Route URLs to site modules through a registry keyed by normalized host**
(`services/<thing>_source.py`): lowercase the host, strip any port, userinfo, and a
leading `www.`, and look it up in `_PARSERS` / `_FETCHERS`. An unknown host raises
`UnsupportedSource` listing the supported hosts. Adding a site is a new module and one
registry entry.

---

## Fetching

**SOUP-3 — Fetch with an explicit `User-Agent`, a timeout, and `raise_for_status()`,**
and wrap every transport failure in `FetchError` with the URL in the message (httpx.md
HTTPX-4). Keep the headers and timeout as module constants:

```python
REQUEST_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; ...) Chrome/120.0 Safari/537.36"}
REQUEST_TIMEOUT = 30  # seconds
```

**SOUP-4 — Be polite to the site:** fetch only the pages you need, never in a tight loop.
A crawler sets a download delay (Scrapy `DOWNLOAD_DELAY = 2`) and stops following links
that lead to log-in pages, paywalled content, or other domains.

---

## Parsing

**SOUP-5 — Always name the parser:** `BeautifulSoup(html, "html.parser")`. Without one,
Beautiful Soup picks whichever parser happens to be installed and warns, so results can
differ between machines. Switching to `lxml` is a project-wide change that adds the
dependency.

**SOUP-6 — Prefer structured data over markup, and merge sources in tiers:**

1. Embedded application state (`<script id="__NEXT_DATA__">`, `window.__INITIAL_STATE__`)
2. JSON-LD (`<script type="application/ld+json">`)
3. Rendered markup, through CSS selectors

Each tier is a private function returning `(fields, notes)`. Merge them in order, the
first non-`None` value winning, and document the tiers and what only one tier can supply
in the public function's docstring:

```python
for parser in (_parse_next_data, _parse_json_ld, _parse_dom):
    parsed, parsed_notes = parser(html)
    for key, value in parsed.items():
        if merged.get(key) is None:
            merged[key] = value
```

**SOUP-7 — Read an embedded JSON block defensively.** Locate it with
`soup.select_one('script#__NEXT_DATA__')` or with a compiled regex that tolerates extra
attributes on the tag, then `json.loads` it. Catch `json.JSONDecodeError`, `KeyError`,
and `TypeError` together, log a warning naming the block, and return an empty result so
the next tier can run. Identify JSON-LD blocks by their shape (the keys you need) when the
site's declared `@type` is unreliable, and say so in a comment.

**SOUP-8 — Keep every CSS selector in one module-level dict,** so a site redesign is a
one-place fix, and map visible labels to field names in another:

```python
_DOM_SELECTORS = {
    "author": ".article-header .author-name",
    "body": "article .article-body",
    "published_at": "time[itemprop=datePublished]",
}

_DETAIL_LABELS = {"Autor": "author", "Sección": "section"}
```

Use `select_one()` and `select()` with CSS selectors. Do not chain `find()` /
`find_all()` calls or navigate by position (`.contents[3]`, `.next_sibling`), which
break on the first markup change.

**SOUP-9 — Treat every lookup as possibly missing.** `select_one()` returns `None`; check
it before use. Read attributes with `.get("datetime")`, never `["datetime"]`. Extract
text through one helper:

```python
def _text_or_none(element: Any) -> Optional[str]:
    if element is None:
        return None
    text = element.get_text(" ", strip=True)
    return text or None
```

Pass a separator to `get_text` so adjacent elements do not run together
(`"<p>one</p><p>two</p>"` becomes `"one two"`, not `"onetwo"`).

**SOUP-10 — Parse numbers and dates in small named helpers** that return `None` for empty
input: strip everything but digits for a localized price (`$ 700.000.000` →
`700000000.0`), and parse dates to timezone-aware UTC (PY-24). Comment the format the
site uses.

**SOUP-11 — Drop non-content elements before extracting article text:**

```python
body = soup.select_one(_DOM_SELECTORS["body"])
for element in body.select("script, style, aside, [class*=RelatedContent]"):
    element.decompose()
raw_text = body.get_text("\n", strip=True)
```

Extract from the content container, never `soup.get_text()` on the whole page, which
includes navigation, footers, and inline scripts.

---

## Results and failures

**SOUP-12 — After merging, check the required fields and raise `ScrapeError` naming every
missing one.** Fill site-level facts the page never states from a commented constant
(`COUNTRY = "Colombia"`), and record values the scraper had to infer in a `notes` dict so
a degraded parse is visible in the stored row instead of failing outright. Drop `None`
values from each tier with a `_drop_empty` helper so they cannot overwrite a later tier.

**SOUP-13 — Never take a derived value from the site when the system computes its own**
(a currency conversion, a score). Leave it out of the payload and say why in the
docstring.

---

## Testing

**SOUP-14 — Test parsers against a real saved page,** stored gzipped as
`_fixtures/html/<site>_<subject>.html.gz` and loaded by a session-scoped fixture whose
docstring gives the source URL (pytest.md PYTEST-16). Derive degraded variants in
fixtures by removing whole blocks with a regex (`..._without_next_data`,
`..._dom_only`), and cover cases the saved page lacks with a fixture that rewrites keys
in its embedded JSON. Tests never fetch a live page: `fetch` is tested with requests-mock
(pytest.md PYTEST-15).
