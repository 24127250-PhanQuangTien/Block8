# Block 7 — Evidence

## Database and scripts

- Migration command: `npm.cmd run migrate:block7`. It applied six idempotent DDL statements: `pg_trgm`, name trigram GIN, full-text GIN, and category/price/available indexes.
- Seed command: `npm.cmd run seed:block7`. It was run twice consecutively; both runs printed `SELECT count(*) = 1016`, so the second run did not duplicate the 1,006 Block 7 dishes. Ten pre-existing dishes remained. The seed's 1,000 generated dishes include repeated prices, zero prices, both availability values, NULL descriptions, eight categories, and Vietnamese names; six named fixtures are also inserted.
- Verification command: `npm.cmd run verify:block7` against the running Express API and Supabase PostgreSQL. All 25 checks passed: count >=1,000; complete non-repeating pagination; out-of-range page; 12 invalid-input cases; literal `%`, `_`, `!`; advanced AND/false/zero behavior; legacy status/category compatibility; four full-result sorts; full-text non-adjacent terms/NULL; fuzzy threshold/order; and equal totals on first/final pages.
- `npm.cmd --prefix api test`: 9 passed, 0 failed. `npm.cmd --prefix web test`: 5 passed, 0 failed. `npm.cmd --prefix web run build`: passed.

## Search examples from the live API

`total` below is the count matching the displayed predicate, not the number on the first page.

| Mode | Example URL | Query behavior | Observed result |
|---|---|---|---|
| `basic` | `/api/dishes?mode=basic&q=100%25&pageSize=10` | `name ILIKE '%100!%%' ESCAPE '!'` | `total=1`; `100% Beef Burger`. The literal percent did not become a wildcard. |
| `advanced` | `/api/dishes?mode=advanced&category=M%C3%B3n+N%C6%B0%E1%BB%9Bc&minPrice=0&maxPrice=0&available=false&pageSize=10` | AND of exact category, `price >= 0`, `price <= 0`, and `available = false` | `total=14`; first page begins `B7 Seed 0001 - Phở Bò Tái`, `B7 Seed 0073 - Phở Bò Tái`. |
| `fulltext` | `/api/dishes?mode=fulltext&q=smoky+basil&pageSize=10` | `to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'')) @@ plainto_tsquery('simple', $q)`; sorted by `ts_rank DESC, id ASC` | `total=2`; `Garden Bowl Fixture` (rank 0.0761), `100% Beef Burger` (0.0645). Both descriptions contain the two terms separated by other words. |
| `fuzzy` | `/api/dishes?mode=fuzzy&q=Pho+Bo+Hu&pageSize=10` | `similarity(name, $q) >= 0.3`; sorted by similarity descending then ID ascending | `total=3`; `Pho Bo Hue` (0.7500), `Pho Bo Hanoi` (0.5333), `Bun!Bo Hue` (0.3333). |

For each mode, the page-ID query and `COUNT(*)` use the same constructed predicate. User text, filter values, page size, and offset are parameter-bound. Sort SQL fragments are selected from a fixed whitelist.

## UI and network checks

- Opened `http://localhost:5173/dishes` against the real API. The page displayed 10 items for the initial page. Network requests returned JSON page data; the browser did not fetch the full dish table to search or sort locally.
- Số trang: moved from page 1 to page 2; URL changed to `page=2`, and the first displayed item changed from `Phở Bò Tái Nạm` to `B7 Seed 0001 - Phở Bò Tái`.
- Load More: one click loaded 10 items; the next appended the following 10 (20 accumulated). The API full-pagination check confirmed IDs do not repeat across pages.
- Infinite Scroll: selecting it reset the list and requested the first 10 after the sentinel entered its observation region. The keyboard-accessible Tải thêm control remained visible.
- Advanced UI was applied with category `Món Nước`, min/max price `0`, and `available=false`; URL encoded all filters and returned 10 items on page 1 (`total=14`). Reload restored the same URL, advanced mode, `minPrice=0`, and `available=false`. Browser Back returned to the prior unfiltered URL; Forward restored the advanced URL. Opening the copied URL in a new tab restored advanced mode and its results.
- Injected one HTTP 503 during the second Load More request: the existing 10 items remained, the retry control appeared, and retry fetched the same next page, producing 20 items after three requests total.
- Opened `/admin/dishes` against the real API; all 1,016 rows loaded, preserving the existing admin list.

## Lỗi đã phát hiện

1. `prisma migrate deploy` initially returned Prisma `P3005` because the Supabase schema was already non-empty and had no migration baseline. No reset or baseline mutation was used. The implementation switched to an idempotent runner for the checked-in, fixed DDL migration; rerunning it succeeded.
2. The first browser render found `ReferenceError: query is not defined` in the new `DishList` while wiring legacy filter compatibility. The misplaced block was moved into the request-parameter builder; reloading then rendered real dish data and the page/build checks passed.
3. The first scripted Load More assertion expected 20 items after the first click, but Load More correctly starts from an empty accumulated list and loads page 1 (10 items) on that click. The check was corrected to click twice; the UI then showed 20 items. This was a test expectation error, not an application defect.

The repository's optional Playwright CLI suites were not run because Playwright is not installed as a project dependency. UI behavior above was checked in the integrated browser against the running app; browser test fixtures were updated to the paginated API response shape.
