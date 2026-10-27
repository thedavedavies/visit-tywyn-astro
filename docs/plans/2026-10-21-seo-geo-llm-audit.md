# SEO / GEO / LLM audit, October 2026

Branch: `seo/geo-audit-2026-10` (off `main` at `f36af4d`). Investigation only, no code changed.

Method: nine parallel dimension audits over the repo and the built `dist/`, then every finding put
through three independent adversarial verifiers (is it true of the code right now, does it measurably
help search or AI answers in late 2026, does the proposed fix respect this project's constraints).
113 findings survived the truth gate; the impact gate then downgraded or killed a large minority of
them. The downgrades are reported here too, because knowing what not to build is half the value.

Three claims that drive the biggest decisions were re-verified by hand and two of them changed shape.
They are flagged inline.

---

## 1. Emitted markup that is factually wrong

These are not optimisations. The site currently tells search engines things that are untrue.

**Status: done on 22 October, except 1.1's Tywyn Beach `social:` block, which Dave is still deciding
on.** Verified green: `astro check` 0 errors, link check clean, a11y 0 WCAG A/AA violations, and all
207 emitted JSON-LD blocks parse with every Event node carrying `location.address` and honest date
precision. Two data questions came out of it, in 1.2 below.

### 1.1 Tywyn Beach is declared to be the same entity as Visit Tywyn's social accounts

`src/content/things-to-do/tywyn-beach.md:29-32` carries a `social:` block, and
`src/pages/things-to-do/[slug].astro:67` passes `Object.values(social)` straight into `sameAs`. The
rendered beach node asserts `sameAs: [facebook.com/VisitTywyn, x.com/visittywyn, instagram.com/visittywyn]`,
which are the publisher's own profiles. `sameAs` is an identity claim, so this says the beach and the
website are one entity. The `social` block is rendered nowhere visible, so deleting it loses nothing.

**Left as-is at your request, pending your decision.** Nothing else in section 1 depends on it.

Same cluster, and these **are** done: `king-arthurs-labyrinth.md` listed a single YouTube video as a
`sameAs` identity for the attraction (deleted), and three eating entries carried junk in URLs that
feed `sameAs` (`?hc_ref=PAGES_TIMELINE` on Victorian Slipway's Facebook link, and TripAdvisor
`#photos;aggregationId=...` gallery fragments on Mor Tywyn and Seabreeze). All stripped; the cleaned
URLs still work as the visible sidebar links.

Still open, because it needs your knowledge rather than a judgement call: **Millie & Sid's `website`
is a third-party aggregator listing** (restaurantji.co.uk), which renders in the sidebar as if it
were the venue's own site and is first in its `sameAs`. Worth replacing if they have a real site, or
dropping if the aggregator genuinely is their only web presence.

### 1.2 Event nodes assert invented dates for 14 of 30 events

`events.json` marks 14 entries `month_only: true`, and the site's own notes say the card shows the
month "instead of a fabricated date". The JSON-LD does the opposite: Bonfire Night emits
`startDate 2026-11-05T00:00:00+00:00`, `endDate 2026-11-30T23:59:00+00:00`. Aberdovey Christmas
Market emits a full month span. The structured data contradicts the visible page.

Separately, every Event `location` is `{"@type":"Place","name":"Aberdyfi"}` with no `address`.
Google lists `location.address` as **required** for Event rich results, so none of these nodes is
currently eligible.

Fixed by giving `NormalisedEvent` a `schemaDates` field that is `null` when the span is synthesised,
and a new `locality` field in `events.json` feeding a typed `PostalAddress`. The three
`eventSchema()` call sites filter on both. The visible listing and the `ItemList` are untouched, so
every event still shows on the page.

The discriminator for "synthesised" is `month_only` **without** an explicit `end_date`, because that
is exactly when `lastDayOfMonth()` invents the end. Two `month_only` events do have authored spans
(Yarn Bombing Llwyngwril, 1 May to 30 Sep, and Aberdovey Regatta, 20 Jul to 2 Aug) and keep their
markup. Result: 16 of 29 events now emit a valid, eligible Event node, against 0 eligible before,
since every node previously failed the required-address check.

Two questions for you:

1. **Bonfire Night (`2026-11-05`) and Tywyn Christmas Market (`2026-11-14`) look mis-flagged.** They
   carry `month_only: true` but a specific day, where the other eight synthesised-span events all
   start on the 1st of the month, which is the real placeholder pattern. If those two dates are
   right, clearing `month_only` makes them correct single-day events and restores their markup. I
   did not change them because `month_only` also drives the visible date label and local events
   often shift to the nearest weekend.
2. **Six events have no single locality** and so stay out of structured data: New Year's Day Dip (no
   `location` at all), St David's Day Celebrations and Slip to the Brit (genuinely two towns),
   Winter Wildlife Walks ("Dyfi Biosphere"), Christmas Carol Concerts ("Local churches"). That is
   the right outcome unless you want to name one primary town for any of them.

Unrelated but adjacent, noticed while verifying: all five currently-upcoming events lack both
`internal_url` and `external_url`, so `/events/` is shipping no `ItemList` at all right now. That is
pre-existing, not from this change, and it fixes itself as soon as any upcoming event gets a link.

### 1.3 A Google Maps search string is published as a postal address

`src/content/things-to-do/honey-ice-cream.md:5` has `address: holgates honey ice cream`. That string
is emitted as JSON-LD `streetAddress` and rendered visibly on the page by
`src/pages/things-to-do/[slug].astro:100-105`.

Fixed by deleting the line, which removed both the false markup and the visible error. The dead
`geo.address` copy of the same string went too (nothing in the repo reads `geo.address`; the map
uses `lat`/`lng`). The shop now renders no visible address at all, so if you know the real one it is
worth adding back.

### 1.4 Restaurant vs FoodEstablishment is chosen by dog friendliness

`src/lib/jsonld.ts:188-189` sets `'@type': dogFriendly ? 'Restaurant' : 'FoodEstablishment'`. The
result across the 16 open venues is that cafes (Medina, Toast, Millie & Sid's, King's Cafe) and pubs
(Dovey Inn, Peniarth Arms, The Retreat) are all typed `Restaurant`, while genuine restaurants that
happen not to take dogs are typed with the vaguer parent. The type also flips if the dog flag ever
changes, which moves the `@id` fragment with it.

Fixed with an optional `kind` enum on the eating schema, mirroring the `kind` field `thingsToDo`
already uses for exactly this job. One stable `#venue` fragment replaces both old ones (nothing
referenced them). Dog friendliness is now an `amenityFeature`, which is what it actually is, on the
8 open dog-friendly venues.

`kind` was assigned from each venue's own summary wording, not invented: 6 `Restaurant`, 6
`CafeOrCoffeeShop`, 4 `BarOrPub`. Two are judgement calls worth your eye: **Pen-y-Bont Hotel** is
really a hotel with two bars and two restaurants and I typed it `Restaurant` because it sits in the
eating collection, and **The Retreat Bar & Cafe** could equally be `CafeOrCoffeeShop` where I chose
`BarOrPub`. The two closed venues correctly emit no node at all.

---

## 2. Cheap wins, high confidence

### 2.1 Six live venue pages render no body text at all

`dine-india`, `dovey-inn`, `medina-coffee-house`, `mor-tywyn`, `victorian-slipway` and `whitehall`
have zero words of body. The template renders `<h2>About {title}</h2>` then `<Content />`
(`src/pages/eating/[slug].astro:139-140`), so the page reads "About Whitehall" immediately followed
by "Find Whitehall". The one-sentence `summary` is required by the schema, already written, and
already shown on the listing page, but never appears on the venue's own page.

Fix, one line between 139 and 140:

```
{!venue.body?.trim() && <p>{venue.data.summary}</p>}
```

Thirteen of 16 live venues are under 60 words, so this is a floor, not a fix for thin content
generally. It is still the best ratio in the audit: one line, six pages.

### 2.2 Venue and attraction titles waste 46 characters and omit the locality

Rendered titles are the bare name: `Dovey Inn | Visit Tywyn` (23 chars), `Whitehall | Visit Tywyn`,
`Seabreeze | Visit Tywyn`. `BaseLayout` appends ` | Visit Tywyn`, leaving about 46 characters free.
No eating entry sets `seo.title`; only one attraction does. The four Aberdyfi venues (Coast Deli,
Dovey Inn, Medina, Seabreeze) are all titled under "Visit Tywyn" with no "Aberdyfi" anywhere in the
title.

Fix: `seo.title` is already in the schema. Pattern `<Name>, <type> in <Town>`, under 46 characters.
Frontmatter only, zero code. Verifier note: do not touch the two walk pages, whose existing titles
are already better than the proposed replacements.

### 2.3 Postcodes are present in the address strings and never emitted

`postalAddress()` (`src/lib/jsonld.ts:36-43`) crams the whole address line into `streetAddress` with
only `addressCountry`. A verifier extracted postcodes from 20 of the 22 open entries that have an
address and resolved every one of them against postcodes.io successfully.

Fix: one regex in `postalAddress()` to pull `postalCode` out. Do not attempt to split town or street
as well; a trial split mangles entries where the business name is embedded in the address.

### 2.4 The Organization node has no logo, though the logo ships

`src/assets/img/site/logo.png` exists. `organization()` emits only `name`, `url` and two `sameAs`.
The known Instagram profile is also missing from `sameAs` while being referenced elsewhere in content.

### 2.5 `article:published_time` is emitted on zero pages

All 18 eating and 11 things-to-do entries carry `published:` frontmatter. No route passes
`publishedTime`; only two routes pass `modifiedTime`. Fix: pass the dates that already exist. Do not
add dates to `/tide-times/` or `/weather/`, which have no truthful frontmatter date.

### 2.6 AdSense loads on two pages that render no ads

`/weather/` and `/tide-times/` pass `hideSidebar`, which drops the only `AdSlot`, but
`src/layouts/PageLayout.astro:22` forwards `baseProps` untouched so `hasAds` stays `true` and the
loader is injected anyway. Confirmed in `dist`: both pages contain `adsbygoogle.js` and zero ad
slots. That is three requests and roughly 222 KB for nothing.

Fix: `<BaseLayout hasAds={!hideSidebar} {...baseProps}>`.

### 2.7 Social cards are cropped from 4.8:1 banners

Thirteen routes use a 1908x397 hero as `og:image` while `twitter:card` is hard-coded
`summary_large_image`, which expects roughly 1.91:1. A further 18 pages, including every listing and
hub page, fall back to the default card. Fix: widen `ogImage` to accept `ImageMetadata`, and either
normalise through `getImage` or fall back to the default card when the aspect ratio exceeds 2.5.

### 2.8 Money pages are missing from the footer

`/holiday-accommodation/*` receive 2 to 3 inbound internal links each (my own count over the built
graph), and appear in no sitewide chrome. For comparison, `/wales-coastal-path/` gets 106 and
`/dog-friendly-cafes/` 110. The cinema page has three sitewide anchors and 165 inbound links.

Honest correction from verification: three of the four category pages are reachable in two hops via
`/where-to-stay/`, so this is not an orphan problem. It is a link-equity distribution problem. The
smallest fix is four entries appended to `FOOTER_COLUMNS[0].links` in `src/lib/nav.ts`.

### 2.9 Related items are random, and eating never links to things-to-do

`eating/[slug].astro:39-41` and `things-to-do/[slug].astro:41-44` both use `seededShuffle`. The one
relevance rule, narrowing to dog-friendly venues when the current venue is dog friendly, turns the
eight dog-friendly venues into an equity sink. The two silos never cross, so no venue page links to
a single thing to do.

Fix: order by distance using the `geo` data already present on 26 of 29 entries, and emit one
same-silo block plus one cross-silo block. Verifier note: skip haversine, scaled squared degrees
rank identically over a 20 km area.

---

## 3. Process and plumbing

- **No `updated` field exists** on the eating, things-to-do or stay-categories schemas, so the
  sitemap's `lastmod` plumbing can never fire for them. 43 of 49 sitemap URLs ship a stale or absent
  `lastmod`. The cheapest honest source is a single guarded `git log` pass at build, not a new
  manual-discipline field.
- **FAQPage extraction is dead.** `extractFaq()` is gated on `<div class="faqs">`, which is exactly
  the presentational markup the project's own content rules forbid in content files. No new answer
  page can ever carry Q/A structured data under the current gate.
- **Nothing validates the emitted JSON-LD in CI**, and `tools/perf/seo-compare.ts` now compares the
  build against itself. Every error in section 1 would have been caught by a parse-and-assert step.
- **The events calendar is a single hard-coded year.** All 30 entries are 2026. The file's own notes
  say to roll the dates forward each January, so this is a known manual task, but nothing warns when
  it lapses. On 1 January 2027 every Event node and the home events block go quiet. Ten weeks away.
- **`Vary: Accept` is on the wrong responses:** set on `/*.md` (where it does nothing) rather than on
  the HTML page URLs that are actually negotiated.
- **No IndexNow key or ping**, so Bing, and therefore Copilot and ChatGPT search grounding, has no
  push discovery channel.

---

## 4. The Markdown-for-Agents bet, honestly

This is the finding I most expected to be a win, and the adversarial pass refuted the whole cluster.

What is true: content negotiation **is broken live**. I verified by hand on 21 October:

```
curl -H 'Accept: text/markdown' https://visit-tywyn.co.uk/eating/dovey-inn/
  -> content-type: text/html

curl https://visit-tywyn.co.uk/eating/dovey-inn/index.md
  -> content-type: text/markdown
```

So the Cloudflare URL Rewrite Rule is absent, disabled, or mis-ordered, and the twins are reachable
only by guessing the `/index.md` path. The twins also drop every contact fact (phone, website,
TripAdvisor, Facebook, grid reference) because the sidebar sits outside `article.site-content`, and
40% of their combined bytes are site-wide JSON-LD duplicated into every file inside a fence that is
not valid JSON.

Why the verifiers killed it anyway: **no consumer**. No crawler or model is documented as requesting
`Accept: text/markdown` for a page it found normally. The llms.txt v2 spec of August 2026 only
"recommends" `rel="alternate"` and names no consumer. The same reasoning killed `/llms.txt`,
`/llms-full.txt` and the `rel="alternate"` head tag.

Recommendation: fix the dashboard rule because it is free and the intent was already paid for, but
stop treating this as an SEO or GEO lever. Do not build llms.txt. If you want AI answer engines to
cite the site, sections 1 and 2 above (correct markup, real text on the page, locality in the title)
do more than any machine-readable twin.

---

## 5. Content: where the actual traffic is

### 5.1 The big one: `wip/things-to-do` already holds the content

**This changed shape on manual verification, so read this carefully.** The branch holds roughly 50
extra content entries (97 content files against main's 47), covering Aberdyfi, the Dysynni valley,
and three area hub pages (`/tywyn/`, `/aberdyfi/`, `/dysynni-valley/`) plus the `area` taxonomy that
cross-links them. Three independent auditors flagged this as the largest live demand gap, and all
three framed it as "already solved, just ship it".

It is not shippable. `wip/things-to-do` is **662 commits behind `main`**, has one commit of its own,
was last touched on 13 July, and its commit message literally reads "work in progress, do not ship".
Merging it would revert three months of work, including the water-quality Worker, the image audit
tool and most of `refresh-conditions.ts`.

The right move is to cherry-pick the content files and the `area` taxonomy plumbing onto a fresh
branch off `main`, re-validate each entry against the current schemas (`jsonld.ts` has changed
underneath it, for instance the hardcoded `addressLocality: 'Tywyn'` that main deliberately removed),
and ship it in batches. That is real work, not a merge, and it is the highest-value content work
available.

### 5.2 New additive URLs, ranked by demand against effort

All of these are new URLs, nothing existing moves, so the additive-only policy holds.

1. `/rainy-day-things-to-do-in-tywyn/`, assembled almost entirely from existing and `wip` entries.
2. `/parking-in-tywyn-and-aberdyfi/` with a car-park table. High intent, weak competition.
3. `/walks-near-tywyn/`, a hub over the five walk pages that already exist with no hub above them.
4. `/dog-friendly-tywyn-and-aberdyfi/`, widening the cafes-only page into beaches and walks with a
   sourced beach-rules table. Dog friendliness is this site's most defensible niche.
5. `/cadair-idris-from-tywyn/`. Cadair Idris is the area's headline entity and its current page is
   1.5 KB with no routes, car parks or transport, and no `geo` or address at all.
6. A hotels / pubs-with-rooms stay category. "Hotels in Tywyn" is the head accommodation query and
   there is no such category page.
7. A Thomas the Tank Engine / Rev. W. Awdry page for the Talyllyn Railway connection, which has zero
   coverage and an obvious engine-twins table.

### 5.3 Spelling and entity disambiguation

"Aberdyfi" appears 80 times across the content, "Aberdovey" 11, and never together on the same page.
English-language SERPs overwhelmingly use "Aberdovey". Cadair Idris is never written "Cader Idris".
There is no "Towyn" disambiguator anywhere, and Towyn is a different Welsh town entirely, which is a
real confusion risk for a model summarising the area.

Verifier note: the impact pass downgraded the "Towyn" half of this to low and kept the Aberdovey
half at low-to-medium. Treat it as content vocabulary hygiene to fold into other edits, not as a
project of its own.

### 5.4 Opening hours

No opening-hours data exists anywhere in the repo, for any venue. This is the single largest
unexploited structured-data surface on a site whose main content type is places that open and close,
and "what's open in Tywyn" is exactly the question an AI assistant gets asked.

It is also a standing data-maintenance commitment rather than a code change, and bad hours are worse
than no hours. Flagging it as a decision for you, not a recommendation.

### 5.5 Publisher identity

No page states who publishes the guide. There is no About page, the footer carries only a copyright
line, and contact routes are Facebook and X only. For a site competing with tourism boards on
trust signals, this is the cheapest E-E-A-T gap to close.

---

## 6. Checked and found already correct

Reported here so it is not re-audited: `_redirects` wildcard ordering is safe; canonicals are correct
on every route shape; the closed-venue sitemap filter works as designed; no route is reachable at two
URLs; the markdown twins are correctly excluded from the sitemap; `robots.txt` is sound; the 404
behaves; no content is hidden behind JavaScript.

## 7. Explicitly not worth doing

The impact pass killed these after confirming the facts. Mechanism absent, not evidence absent.

- `llms.txt` and `llms-full.txt`, and the `rel="alternate"` markdown head tag. No consumer.
- `ImageObject` galleries, image dimensions, and Creative Commons licence metadata in JSON-LD.
- The dead `facilities` field, and `priceRange` / `servesCuisine` on venues.
- Narrowing `TouristAttraction` subtypes, for instance the duplicated `TrainStation` typing.
- Adding `WebPage` nodes to the 35 pages that lack one.
- H1 rewording on `/tide-times/` and `/weather/`, and template H2 rewording.
- Deferring GA4, Ahrefs and AdSense to the `load` event. Measured at roughly 320 to 370 ms LCP on
  slow mobile, so the gain is real, but it costs analytics sessions and ad fill. Your call, and it
  needs a week of revenue and field-CLS watching after deploy.
- A `noindex` header for the `*.pages.dev` host. Correct and trivial, but the duplicate has no
  inbound links and the site is far below any crawl-budget threshold, so the benefit is near nil.
- An events RSS, Atom or ICS feed.

## 8. Not in the repo

Unchanged from previous triage, listed for completeness: the Cloudflare AI-training block that also
403s Googlebot, Bot Fight Mode, Rocket Loader, the CF analytics beacon, AdSense-injected CLS, and the
zone HSTS override. The markdown rewrite rule in section 4 joins this list.

---

## Suggested order

1. Section 1 in one commit. Wrong markup, mostly frontmatter deletions.
2. Section 2.1, 2.3, 2.4, 2.5, 2.6, then 2.2. All small, all independent.
3. Section 3: JSON-LD validation in CI first, so it guards everything after it, then the events-year
   guard.
4. Section 2.7, 2.8, 2.9.
5. Section 5.1 as its own batched project.
6. Section 5.2 pages, in the order given.
