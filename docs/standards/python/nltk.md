# NLTK Standards

Applies to text processing: tokenizing, cleaning, and lemmatizing scraped text, and
scoring sentiment with VADER. Extracting the text from HTML is in
[beautiful-soup.md](beautiful-soup.md).

**Stack:** `nltk` 3.9 for tokenizers, stop words, and the WordNet lemmatizer;
`vaderSentiment` for sentiment scores.

> Several rules here correct habits in the reference spiders: data downloaded at import
> time, an untrained sentence tokenizer used to split words, and VADER scoring text that
> had already lost its case, punctuation, and negations. Each of those changes the output
> silently, so the rules are MUSTs.

---

## Where text processing lives

**NLTK-1 — Put text processing in one pure module** (`services/text_processing.py`) of
functions that take a string and return strings or lists of strings. Spiders, scripts,
and services call it; none of them carries its own copy of `clean()`. The module imports
no database, HTTP, or framework code.

---

## Data packages

**NLTK-2 — Install NLTK data when the image is built, never at import time or at
runtime:**

```dockerfile
ENV NLTK_DATA=/usr/local/share/nltk_data
RUN uv run python -m nltk.downloader -d "$NLTK_DATA" punkt_tab stopwords wordnet
```

Application modules MUST NOT call `nltk.download()`. Each call checks the network and
the disk, and a module-level call runs again for every module that imports it. A
developer setup script MAY download the same list into `~/nltk_data`. Keep the list of
packages in one place (the Dockerfile and the setup script read the same constant or
file).

**NLTK-3 — Install the package each function needs:**

| Function                                        | Package                          |
| ----------------------------------------------- | -------------------------------- |
| `word_tokenize`, `sent_tokenize`                | `punkt_tab` (not `punkt`; NLTK 3.9 no longer loads the pickled model) |
| `stopwords.words("english")`                    | `stopwords`                      |
| `WordNetLemmatizer().lemmatize`                 | `wordnet` (and `omw-1.4` if the installed version asks for it) |
| `pos_tag`                                       | `averaged_perceptron_tagger_eng` |

`vaderSentiment` ships its own lexicon and needs no NLTK data. Do not mix it with
`nltk.sentiment.vader`; use one VADER implementation.

**NLTK-4 — Load corpora once, lazily:**

```python
@functools.cache
def english_stopwords() -> frozenset[str]:
    return frozenset(stopwords.words("english"))


_LEMMATIZER = WordNetLemmatizer()
```

Never rebuild the stop-word set inside a per-document or per-word function.

---

## Tokenizing and cleaning

**NLTK-5 — Use the tokenizer for the unit you want:** `sent_tokenize(text,
language="english")` for sentences and `word_tokenize(text, language="english")` for
words. `PunktSentenceTokenizer().tokenize()` returns sentences, not words, and an
instance created without training text has learned no abbreviations; do not use it
directly. Always pass the language explicitly.

**NLTK-6 — Clean in this order:**

1. Remove URLs and leftover markup from the raw text.
2. Tokenize (NLTK-5), so contractions and punctuation are split correctly
   (`"don't"` → `"do"`, `"n't"`).
3. Lowercase each token.
4. Keep tokens that contain a letter or digit.
5. Remove stop words.
6. Lemmatize.

```python
_URL_PATTERN = re.compile(r"https?://\S+")
_WORD_PATTERN = re.compile(r"[^\W_]")  # any Unicode letter or digit


def clean_words(text: str) -> list[str]:
    text = _URL_PATTERN.sub("", text)
    tokens = (token.lower() for token in word_tokenize(text, language="english"))
    words = [token for token in tokens if _WORD_PATTERN.search(token)]
    stops = english_stopwords()
    return [_LEMMATIZER.lemmatize(word) for word in words if word not in stops]
```

Removing punctuation with a regex before tokenizing (`re.sub(r"[^a-zA-Z0-9]", " ", ...)`)
breaks contractions and strips every non-ASCII letter; do not do it.

**NLTK-7 — Lemmatize with a part of speech when the result matters.** `lemmatize(word)`
treats every word as a noun (`"running"` stays `"running"`). Tag with `pos_tag` and map
the tag to a WordNet POS (`J` → `ADJ`, `V` → `VERB`, `R` → `ADV`, otherwise `NOUN`) when
the output feeds a model or a search index.

---

## Sentiment

**NLTK-8 — Choose preprocessing for the consumer.** Word cleaning (NLTK-6) is for
bag-of-words features, keyword counts, and topic models. VADER is built for raw text: it
reads capitalization (`"GREAT"`), punctuation (`"good!!!"`), emoji, degree words, and
negations, and `"not"`, `"no"`, and `"nor"` are all in NLTK's English stop-word list.
Text sent to VADER MUST NOT be lowercased, stripped of punctuation, stop-word filtered,
or lemmatized.

**NLTK-9 — Score sentiment per sentence and aggregate:**

```python
_ANALYZER = SentimentIntensityAnalyzer()


def score_text(raw_text: str) -> float:
    """Return the mean VADER compound score of the text's sentences.

    Scores run from -1.0 (most negative) to 1.0 (most positive).
    """
    sentences = sent_tokenize(raw_text, language="english")
    if not sentences:
        return 0.0
    return statistics.fmean(
        _ANALYZER.polarity_scores(sentence)["compound"] for sentence in sentences
    )
```

Create one analyzer per process. Keep the full `polarity_scores` output alongside the
summary score when it is stored, so the summary can be recomputed.

**NLTK-10 — Map a compound score to a label with named thresholds in one pure function:**

```python
POSITIVE_THRESHOLD = 0.05
"""VADER's documented cut-off: compound >= 0.05 is positive."""
NEGATIVE_THRESHOLD = -0.05


def sentiment_from_compound(compound: float) -> SentimentEnum:
    if compound >= POSITIVE_THRESHOLD:
        return SentimentEnum.POSITIVE
    if compound <= NEGATIVE_THRESHOLD:
        return SentimentEnum.NEGATIVE
    return SentimentEnum.NEUTRAL
```

---

## Storage

**NLTK-11 — Store the raw text, and store processed tokens as an array.** Keep the
extracted text (`raw_content`) so any step can be re-run with better preprocessing. Store
token lists in a `postgresql.ARRAY(postgresql.TEXT)` column, not as the string form of a
Python list in a `TEXT` column.

---

## Testing

**NLTK-12 — Unit-test text functions with literal strings** and exact expected outputs,
including a negation case for anything feeding sentiment (`"not good"` must not score as
positive), and parametrize the threshold function at and around each boundary
(`0.0499`, `0.05`, `-0.05`, `-0.0501`). The test image installs the same NLTK data as the
application image (NLTK-2); tests never download.
