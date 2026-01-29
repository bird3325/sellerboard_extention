/**
 * 알리익스프레스 파서
 * AliExpress 상품 페이지에서 정보 추출
 * 다국어 및 동적 로딩 처리 필요
 */

class AliexpressParser extends BaseParser {
    constructor() {
        super('aliexpress');
    }

    getSelectors() {
        return {
            name: '.product-title-text, h1[data-pl="product-title"]',
            name: '.product-title-text, h1[data-pl="product-title"]',
            price: [
                '.product-price-value',
                '.price--currentPriceText--V8_y_b5',
                '[class*="price--currentPriceText"]',
                '.product-price .price-current',
                '.uniform-banner-box-price',
                'span[itemprop="price"]',
                '.sku-price',
                '[class*="price-kr--current"]', // Added from user screenshot
                '.price-kr--currentWrap--mCxOJo3 span'
            ],
            images: '.images-view-item img, .magnifier-image',
            stock: '.product-quantity-tip, .quantity--stock',
            description: '.product-description, .detail-desc-decorate-richtext',
            category: '.breadcrumb, nav[aria-label="breadcrumb"]',
            videos: 'video, .video-view video'
        };
    }

    async extractSearchResults(filters = {}) {
        // limit 적용
        const limit = filters.limit || 1000;
        const items = [];
        const seenIds = new Set();

        // Scroll to bottom to trigger lazy loading
        await this.scrollToBottom();

        // Product Card Selectors (Modern & Legacy)
        const selectors = [
            '.k7_v', // User provided structure wrapper - Priority 1
            '.search-item-card-wrapper-gallery', // Modern
            '.list-item',
            '.product-card',
            '[class*="manhattan--container"]',
            '.search-card-item'
        ];

        // Find all potential cards
        let cards = [];
        for (const sel of selectors) {
            const elements = document.querySelectorAll(sel);
            if (elements.length > 0) {
                cards = Array.from(elements);
                // console.log(`[AliexpressParser] Found ${cards.length} cards using selector: ${sel}`);
                break;
            }
        }

        // Fallback: Find by Child Elements (User provided structure: .k7_v > .k7_kw / .k7_lu)
        if (cards.length === 0) {
            // Try finding titles or prices and going up to parent
            const childSelectors = ['.k7_kw', '.k7_lu', '.k7_z'];
            for (const childSel of childSelectors) {
                const children = document.querySelectorAll(childSel);
                if (children.length > 0) {
                    // Assuming structure: k7_v (card) > ... > k7_kw (child)
                    // We traverse up to find a div that looks like a wrapper
                    // user snippet: k7_v > k7_z > ...
                    const foundCards = new Set();
                    children.forEach(child => {
                        // Traverse up 1-3 levels to find the card container
                        let parent = child.parentElement;
                        for (let i = 0; i < 4; i++) {
                            if (!parent) break;
                            if (parent.classList.contains('k7_v') || parent.tagName === 'DIV' || parent.tagName === 'A') {
                                // If it has class k7_v, it's definitely it.
                                // If not, we might be guessing. 
                                // But if we found the child, we likely found a card.
                                // Let's use the closest meaningful DIV.
                                if (parent.classList.contains('k7_v')) {
                                    foundCards.add(parent);
                                    break;
                                }
                            }
                            parent = parent.parentElement;
                        }
                        // If we didn't find k7_v explicitly but found children, 
                        // maybe the user ID'd the container wrong? 
                        // Let's rely on the first loop mainly. 
                        // But if that failed, let's try to grab the parent of k7_kw (title)
                        if (childSel === '.k7_kw') {
                            // Title is usually direct child or close descendant
                            const cardCandidate = child.closest('.k7_v') || child.closest('div[class*="item"]');
                            if (cardCandidate) foundCards.add(cardCandidate);
                        }
                    });

                    if (foundCards.size > 0) {
                        cards = Array.from(foundCards);
                        break;
                    }
                }
            }
        }

        // Heuristic Fallback: Find links looking like products and analyze their containers
        if (cards.length === 0) {
            // console.log('[AliexpressParser] Class selectors failed. Trying heuristic search...');
            const allLinks = document.querySelectorAll('a[href*="/item/"]');
            const candidates = new Set();

            allLinks.forEach(link => {
                // Determine a potential card container by traversing up
                // We stop at the first DIV that looks "wrappery" (has text content and structure)
                let parent = link.parentElement;
                let foundContainer = null;

                // Go up 5 levels max
                for (let i = 0; i < 5; i++) {
                    if (!parent) break;
                    // Check if this parent has price-like text
                    const text = parent.textContent;
                    if ((text.includes('$') || text.includes('₩') || text.includes('US') || text.includes('KRW')) &&
                        /\d/.test(text)) { // Must have numbers
                        foundContainer = parent;
                        // Don't break immediately, go up one more to capture full card? 
                        // Actually, the smallest container with price + name is best.
                        // But usually the card contains the image too.
                        if (parent.querySelector('img')) {
                            // Found a container with Price + Image + Link
                            break;
                        }
                    }
                    parent = parent.parentElement;
                }

                if (foundContainer) {
                    candidates.add(foundContainer);
                } else {
                    // Fallback: just use the parent div of the link
                    candidates.add(link.closest('div') || link);
                }
            });

            if (candidates.size > 0) {
                cards = Array.from(candidates);
                // Filter out small elements (likely just text links)
                cards = cards.filter(c => c.textContent.length > 20 && c.tagName !== 'SPAN');
            }
        }

        for (const card of cards) {
            if (items.length >= limit) break;

            try {
                // Link Extraction
                const linkEl = card.querySelector('a[href*="/item/"]') || card.closest('a') || card.querySelector('a');
                if (!linkEl) continue;

                let href = linkEl.href;
                if (!href || !href.includes('/item/')) continue;

                // Clean URL
                href = href.split('?')[0];

                // ID Extraction (from URL)
                const idMatch = href.match(/\/item\/(\d+)\.html/);
                const id = idMatch ? idMatch[1] : href;

                if (seenIds.has(id)) continue;
                seenIds.add(id);

                // Title Extraction - Try User Selector -> Common -> H tags -> Longest Text
                let name = '';
                const userTitle = card.querySelector('.k7_kw');
                if (userTitle) name = userTitle.textContent.trim();

                if (!name) {
                    const titleEl = card.querySelector('h1, h2, h3, [class*="title"], .item-title');
                    if (titleEl) name = titleEl.textContent.trim();
                }

                // Last resort for title: Find the text node with longest length in the link
                if (!name) {
                    name = linkEl.textContent.trim();
                    if (name.length < 5) {
                        // Check image alt
                        const img = card.querySelector('img');
                        if (img && img.alt) name = img.alt;
                    }
                }

                // Price Extraction (Enhanced with User Structure + Heuristics)
                let price = 0;

                // 1. User Selector
                const userPriceEl = card.querySelector('.k7_lu');
                if (userPriceEl) {
                    const priceText = userPriceEl.textContent.replace(/[^0-9.]/g, '');
                    price = parseFloat(priceText) || 0;
                }

                // 2. Common Selectors
                if (price === 0) {
                    const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
                    if (priceEl) {
                        // exclude hidden or non-current prices if possible? 
                        // Simple extraction
                        price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) || 0;
                    }
                }

                // 3. Text Walker (The most robust fallback)
                if (price === 0) {
                    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
                    while (walker.nextNode()) {
                        const txt = walker.currentNode.textContent.trim();
                        // Look for currency symbols or patterns like "10,000원", "US $10.00"
                        if (/(?:₩|KRW|\$|US\s*\$)\s*[\d,]+/.test(txt)) {
                            price = parseFloat(txt.replace(/[^0-9.]/g, '')) || 0;
                            if (price > 0) break;
                        }
                    }
                }

                // Image Extraction (Robust)
                let imageUrl = '';
                const imgs = Array.from(card.querySelectorAll('img'));

                // Sort by likely relevance (size or class)
                // Filter out obviously small icons
                const validImgs = imgs.filter(img => {
                    const w = img.width || 0;
                    const h = img.height || 0;
                    // Skip very small icons
                    if (w > 0 && w < 50) return false;
                    if (h > 0 && h < 50) return false;
                    return true;
                });

                if (validImgs.length > 0) {
                    // Prefer images with 'product' or 'search' in class or src
                    // Or just take the first larger image
                    let bestImg = validImgs.find(img => img.className.includes('product') || img.src.includes('.jpg') || img.src.includes('.png'));
                    if (!bestImg) bestImg = validImgs[0];

                    imageUrl = bestImg.src || bestImg.dataset.src || '';
                    if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
                } else {
                    // Fallback: Check if the card itself has a background image? Unlikely for search results.
                    // Try finding image in the link element
                    const linkImg = linkEl.querySelector('img');
                    if (linkImg) {
                        imageUrl = linkImg.src || linkImg.dataset.src || '';
                        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
                    }
                }

                // Sales Extraction (Enhanced with User Structure)
                // User provided: span.k7_km text "92 판매"
                let salesText = '';
                const userSalesEl = card.querySelector('.k7_km');
                if (userSalesEl) {
                    salesText = userSalesEl.textContent.trim();
                }

                if (!salesText) {
                    const salesEl = card.querySelector('[class*="sales--"], .manhattan--trade--2PeJIEB');
                    if (salesEl) {
                        salesText = salesEl.textContent.trim();
                    } else {
                        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
                        while (walker.nextNode()) {
                            const txt = walker.currentNode.textContent.trim();
                            if (/(sold|orders|판매|누적)/i.test(txt)) {
                                salesText = txt;
                                break;
                            }
                        }
                    }
                }

                // Rating Extraction (Enhanced with User Structure)
                // User provided: span.k7_kg text "4.6"
                let rating = 0;
                const userRatingEl = card.querySelector('.k7_kg');
                if (userRatingEl) {
                    rating = parseFloat(userRatingEl.textContent.trim()) || 0;
                }

                if (rating === 0) {
                    const starEl = card.querySelector('[class*="star--"], .manhattan--star--3m-Uq-o');
                    if (starEl) {
                        rating = parseFloat(starEl.textContent.trim()) || 0;
                    }
                }

                if (rating === 0) {
                    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
                    while (walker.nextNode()) {
                        const txt = walker.currentNode.textContent.trim();
                        if (/^[45]\.\d$/.test(txt)) { // "4.8", "5.0"
                            rating = parseFloat(txt);
                            break;
                        }
                    }
                }

                // Clean Sales Volume
                let salesVolume = 0;
                if (salesText) {
                    // "92 판매", "1,000+ sold" -> 92, 1000
                    // 숫자만 추출 (콤마 제거)
                    const numStr = salesText.replace(/,/g, '').replace(/[^0-9]/g, '');
                    if (numStr) {
                        salesVolume = parseInt(numStr, 10);
                    }
                }

                if (name && href) {
                    items.push({
                        id,
                        name,
                        price,
                        imageUrl,
                        detailUrl: href,
                        platform: 'aliexpress',
                        salesVolume, // 숫자만 저장
                        rating: rating,
                        reviewCount: 0
                    });
                }
            } catch (e) {
                // Ignore individual card errors
            }
        }

        return items;
    }

    async extractTitle() {
        // 동적 로딩 대기
        await this.wait(1000);

        // [FIX] 수정보강 내용: 다양한 타이틀 선택자 및 폴백 추가
        const selectors = [
            'h1[data-pl="product-title"]',
            '.product-title-text',
            'h1.product-title',
            '.title--wrap--Ms9Zv4A h1',
            '[class*="title--wrap"] h1',
            'h1'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element.textContent.trim();
            }
        }

        // Meta tag Fallback
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.content) return ogTitle.content;

        const titleTag = document.querySelector('title');
        if (titleTag) {
            return titleTag.innerText.split('|')[0].trim();
        }

        return 'Product name not found';
    }

    async extractPrice() {
        // 가격 로딩 대기
        await this.wait(500);

        // 1. User specific selector (Prioritize current price over discount)
        const specificSelectors = [
            '[class*="price-kr--current"]',
            '.price--currentPriceText--V8_y_b5',
            '.product-price-value',
            '[class*="price--current"]',
            '.uniform-banner-box-price',
            '.sku-price',
            '[class*="price--main"]',  // New layout
            '[class*="current-price"]' // Generic
        ];

        // Helper to parse price from text strictly
        const parsePrice = (text) => {
            if (!text) return 0;
            // 1. Strict Regex: Look for Currency Symbol followed by Number
            const currencyRegex = /(?:US\s*\$|USD|₩|KRW|\$|€|£|¥)\s*([\d,.]+)/i;
            const match = text.match(currencyRegex);
            if (match) {
                // Remove commas and handle weird formatting if any
                const numStr = match[1].replace(/,/g, '');
                // Check if it's a valid float
                const val = parseFloat(numStr);
                return isNaN(val) ? 0 : val;
            }
            // 2. Trailing Currency Regex (e.g. "1000원")
            const trailingRegex = /([\d,.]+)\s*(?:원|won|KRW)/i;
            const matchTrailing = text.match(trailingRegex);
            if (matchTrailing) {
                const numStr = matchTrailing[1].replace(/,/g, '');
                const val = parseFloat(numStr);
                return isNaN(val) ? 0 : val;
            }
            return 0;
        };

        for (const sel of specificSelectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                // Ignore if class indicates discount/original/del
                if (el.className.includes('discount') || el.className.includes('original') || el.className.includes('del')) continue;
                const txt = el.textContent.trim();
                const price = parsePrice(txt);
                if (price > 0) return price;
            }
        }

        // 2. Fallback: Search in Price-looking elements generally (stricter than before)
        const fallbackEls = document.querySelectorAll('[class*="price"]');
        for (const el of fallbackEls) {
            if (el.className.includes('discount') || el.className.includes('del') || el.className.includes('original')) continue;
            const txt = el.textContent.trim();
            const price = parsePrice(txt);
            if (price > 0) return price;
        }

        // 3. Fallback: Meta tags (og:price:amount, product:price:amount)
        const metaPrice = document.querySelector('meta[property="og:price:amount"], meta[property="product:price:amount"]');
        if (metaPrice && metaPrice.content) {
            return parseFloat(metaPrice.content) || 0;
        }

        // 4. Fallback to generic text search via BaseParser (usually meta tags)
        // If BaseParser fails, we try a final aggressive text walker on the top section
        const basePrice = await super.extractPrice();
        if (basePrice > 0) return basePrice;

        return 0;
    }

    async extractOptions() {
        const opts = [];

        // 1. Select 옵션
        const selectOpts = this.extractSelectOptions();
        if (selectOpts.length > 0) opts.push(...selectOpts);

        // 2. Radio/Checkbox 옵션
        const radioOpts = this.extractRadioOptions();
        if (radioOpts.length > 0) opts.push(...radioOpts);

        // 3. SKU 옵션 (AliExpress 등) - 동적 가격 수집 포함
        const skuOpts = await this.extractSkuOptionsAsync();
        if (skuOpts.length > 0) opts.push(...skuOpts);

        return opts;
    }

    extractSelectOptions() {
        const opts = [];
        const sels = document.querySelectorAll('select');
        sels.forEach(sel => {
            const options = sel.querySelectorAll('option');
            if (options.length === 0) return;
            const data = { name: this.getLabel(sel), type: 'select', values: [] };
            options.forEach((opt, i) => {
                const t = opt.textContent.trim();
                if (i === 0 && (!opt.value || t.includes('선택'))) return;
                if (t && opt.value !== 'on') data.values.push({ text: t, value: opt.value });
            });
            if (data.values.length > 0) opts.push(data);
        });
        return opts;
    }

    extractRadioOptions() {
        const opts = [];
        const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');
        const grouped = {};
        inputs.forEach(inp => {
            const n = inp.name || 'option';
            let groupName = n;
            if (n === 'opt' || n === 'option' || n.length <= 3) {
                const label = document.querySelector(`label[for="${inp.id}"]`);
                if (label) {
                    const parent = label.closest('[class*="option"], [class*="sku"], [class*="property"]');
                    if (parent) {
                        const titleEl = parent.querySelector('[class*="title"], [class*="label"], h3, h4, strong');
                        if (titleEl && titleEl.textContent.trim().length < 30) {
                            groupName = titleEl.textContent.trim().replace(/[:\：]/g, '').trim();
                        }
                    }
                }
            } else {
                groupName = n.replace(/[_-]/g, ' ').trim();
            }

            if (!grouped[n]) grouped[n] = { name: groupName, type: inp.type, values: [] };
            const label = document.querySelector(`label[for="${inp.id}"]`);
            const t = label ? label.textContent.trim() : inp.value;
            if (t && inp.value !== 'on') grouped[n].values.push({ text: t, value: inp.value });
        });
        Object.values(grouped).forEach(g => {
            if (g.values.length > 0) opts.push(g);
        });
        return opts;
    }

    async extractSkuOptionsAsync() {
        const opts = [];
        const skuProps = document.querySelectorAll('[class*="sku-item--property"], [class*="sku-property"], [class*="sku-property-item"]');


        if (skuProps.length === 0) return opts;

        const priceSelector = [
            '[class*="price-kr--current"]',
            '.price--currentPriceText--V8_y_b5',
            '.product-price-value',
            '[class*="price--current"]',
            '.uniform-banner-box-price',
            '.sku-price',
            '[class*="price--main"]',
            '[class*="price-tr--current"]',
            'span[class*="price"]'
        ].join(', ');

        // Helper to parse price strictly (Reusable logic)
        const parseSkuPrice = (text) => {
            if (!text) return 0;
            // 1. Prefix Currency
            const prefixMatch = text.match(/(?:US\s*\$|USD|₩|KRW|\$|€|£|¥)\s*([\d,.]+)/i);
            if (prefixMatch) {
                return parseFloat(prefixMatch[1].replace(/,/g, '')) || 0;
            }
            // 2. Suffix Currency (Korean style)
            const suffixMatch = text.match(/([\d,.]+)\s*(?:원|won|KRW)/i);
            if (suffixMatch) {
                return parseFloat(suffixMatch[1].replace(/,/g, '')) || 0;
            }
            return 0;
        };

        for (const prop of skuProps) {
            const titleEl = prop.querySelector('[class*="sku-item--title"], [class*="sku-title"], [class*="property-title"]');
            let optName = '옵션';
            if (titleEl) {
                const titleText = titleEl.textContent.trim();
                const m = titleText.match(/^([^:：]+)/);
                if (m) optName = m[1].trim();
            }

            const skuItems = prop.querySelectorAll('[class*="sku-item--image"], [class*="sku-item--text"], [data-sku-col], [data-sku-id]');


            if (skuItems.length >= 1) {
                const data = { name: optName, type: 'sku', values: [] };
                const seen = new Set();

                for (let i = 0; i < skuItems.length; i++) {
                    const item = skuItems[i];
                    const img = item.querySelector('img');
                    let text = '';
                    let imageUrl = null;

                    if (img) {
                        text = img.alt || img.title || '';
                        imageUrl = img.src;
                    } else {
                        text = item.textContent.trim();
                        if (!text) text = item.getAttribute('title') || '';
                    }

                    const value = item.getAttribute('data-sku-col') || item.getAttribute('data-sku-id') || text;
                    const wasSelected = item.className.includes('selected');

                    // Skip disabled/unavailable items if possible
                    const isDisabled = item.classList.contains('disabled') || item.getAttribute('aria-disabled') === 'true';
                    if (isDisabled) {
                        console.log(`[AliexpressParser] SKU Item disabled, skipping: ${text}`);
                        continue;
                    }

                    if (text && !seen.has(text)) {
                        seen.add(text);

                        let price = null;
                        let priceText = null;
                        let stock = null;

                        try {
                            if (!wasSelected) {

                                item.click();
                                // Reduced from 600ms to 450ms for performance
                                await new Promise(resolve => setTimeout(resolve, 450));
                            }

                            // Try multiple selectors
                            const priceEls = document.querySelectorAll(priceSelector);
                            for (const pEl of priceEls) {
                                // Skip discount/original prices to get current price
                                if (pEl.className.includes('discount') || pEl.className.includes('del') || pEl.className.includes('original')) continue;

                                const txt = pEl.textContent.trim();
                                const parsed = parseSkuPrice(txt);
                                if (parsed > 0) {
                                    price = parsed;
                                    priceText = txt;
                                    break;
                                }
                            }

                            // Reduced from 300ms to 200ms
                            await new Promise(resolve => setTimeout(resolve, 200));

                            // [Performance] Use targeted container for stock text to avoid body.innerText reflow
                            const infoContainer = document.querySelector('.pdp-info-right') || document.querySelector('[class*="product-info"]') || document.body;
                            const bodyText = infoContainer.textContent;

                            let piecesMatch = bodyText.match(/(\d+)\s*pieces?\s*available/i);
                            if (piecesMatch) {
                                stock = parseInt(piecesMatch[1], 10);
                            } else {
                                let leftMatch = bodyText.match(/only\s*(\d+)\s*left/i);
                                if (leftMatch) {
                                    stock = parseInt(leftMatch[1], 10);
                                } else {
                                    let koreanMatch = bodyText.match(/(\d+)\s*개\s*남음/i) || bodyText.match(/재고\s*[:\s]*(\d+)/i);
                                    if (koreanMatch) {
                                        stock = parseInt(koreanMatch[1], 10);
                                    } else if (bodyText.toLowerCase().includes('sold out') || bodyText.includes('품절') || bodyText.toLowerCase().includes('out of stock')) {
                                        stock = 'out_of_stock';
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`[AliexpressParser] Failed to extract price/stock for option: ${text}`, err);
                        }

                        data.values.push({
                            text: text,
                            value: value,
                            price: price,
                            priceText: priceText,
                            stock: stock,
                            image: imageUrl,
                            imageUrl: imageUrl
                        });
                    }
                }
                if (data.values.length > 0) {
                    opts.push(data);

                }
            }
        }
        console.log(`[AliexpressParser] SKU collection done. Found ${opts.length} groups.`);
        return opts;
    }

    getLabel(el) {
        if (el.id) {
            const lb = document.querySelector(`label[for="${el.id}"]`);
            if (lb) return lb.textContent.trim();
        }
        const pr = el.previousElementSibling;
        if (pr && pr.textContent) {
            const t = pr.textContent.trim();
            if (t.length < 50) return t.replace(':', '');
        }
        return el.name || el.id || '옵션';
    }

    async extractDescription() {
        // [FIX] 수정보강 내용: 재귀적 Shadow DOM 탐색 및 Iframe Fallback 완벽 지원
        console.log('[AliexpressParser] 상세 설명 추출 시작 (Recursive Shadow DOM)');

        // 1. 재귀적 Shadow Root 수집 헬퍼 함수
        const collectAllShadowRoots = (root, roots = new Set()) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let currentNode = walker.currentNode;
            while (currentNode) {
                if (currentNode.shadowRoot) {
                    if (!roots.has(currentNode.shadowRoot)) {
                        roots.add(currentNode.shadowRoot);
                        // 재귀 호출: 발견된 Shadow Root 내부도 탐색
                        collectAllShadowRoots(currentNode.shadowRoot, roots);
                    }
                }
                currentNode = walker.nextNode();
            }
            return roots; // Set 반환
        };

        // 2. 하단 스크롤 (지연 로딩 트리거)
        await this.scrollToBottom();
        await this.wait(1000);

        // 3. 상세 설명 앵커로 스크롤
        const descSelectors = [
            '#product-description',
            '.product-description',
            '.detail-desc-decorate-richtext',
            '[name="description"]'
        ];

        let anchorEl = null;
        for (const sel of descSelectors) {
            const el = document.querySelector(sel);
            if (el) {
                console.log('[AliexpressParser] 위치 기준 요소 발견, 스크롤 이동:', sel);
                el.scrollIntoView({ behavior: 'instant', block: 'center' });
                await this.wait(1500);
                anchorEl = el;
                break;
            }
        }

        const d = { text: '', html: '', images: [] };
        let descEl = null;

        try {
            // 4. 재귀적 Shadow DOM 탐색 (가장 강력한 방법)
            console.log('[AliexpressParser] 재귀적 Shadow DOM 탐색 시작');
            const mainContainer = document.querySelector('.pdp-body') || document.querySelector('#root') || document.body;

            // 모든 Shadow Root 수집 (중첩된 것 포함)
            const allRootsSet = collectAllShadowRoots(mainContainer);

            // [Optimized] redundant querySelectorAll('*') loop 제거.
            // collectAllShadowRoots가 이미 재귀적으로 모든 shadow root를 수집함.
            // 만약 놓친게 있을까봐 걱정된다면 light DOM의 최상위 shadow hosts만 추가로 확인
            const topShadowHosts = document.querySelectorAll('div, section, main, article');
            topShadowHosts.forEach(el => {
                if (el.shadowRoot && !allRootsSet.has(el.shadowRoot)) {
                    allRootsSet.add(el.shadowRoot);
                    collectAllShadowRoots(el.shadowRoot, allRootsSet);
                }
            });

            const allRoots = Array.from(allRootsSet);
            console.log(`[AliexpressParser] 발견된 총 Shadow Root: ${allRoots.length}개`);

            // Shadow Root 순회하며 설명 요소 찾기
            for (let i = 0; i < allRoots.length; i++) {
                const root = allRoots[i];

                // [FIX] Detect by class or ID + Check for Images (User Screenshot case)
                const target = root.querySelector('.detail-desc-decorate-richtext, .detailmodule_html, #product-description, [name="description"]');
                if (target) {
                    const hasMuchText = target.textContent.trim().length > 50;
                    const hasImages = target.querySelector('img') !== null;

                    if (hasMuchText || hasImages) {
                        console.log(`[AliexpressParser] Shadow Root #${i}에서 설명 요소 확정 (${hasMuchText ? '텍스트형' : '이미지형'})`);
                        descEl = target;
                        break;
                    }
                }

                // 이미지 많은 div 검색 (Fallback)
                const imgs = root.querySelectorAll('img');
                if (imgs.length > 5) {
                    // 이미지가 많으면 상세설명일 확률 높음 (보수적 접근)
                    // 텍스트 길이도 어느정도 되거나 이미지가 8개 이상이면 채택
                    if (root.textContent.length > 200 || imgs.length > 8) {
                        console.log(`[AliexpressParser] Shadow Root #${i}에서 설명 추정 요소 발견 (이미지 ${imgs.length}개)`);
                        descEl = root.querySelector('div') || root;
                        break;
                    }
                }
            }

            // 5. Iframe 탐색 (Shadow DOM에서 못 찾은 경우)
            if (!descEl) {
                console.log('[AliexpressParser] Shadow DOM 실패, Iframe 탐색 시도');

                // 5-1. 메인 문서 Iframe
                let targetIframe = document.querySelector('iframe[class*="extend--iframe"]') || document.querySelector('iframe[src*="detail-desc"]');

                // 5-2. [NEW] Shadow Root 내부 Iframe 탐색
                if (!targetIframe && allRoots.length > 0) {
                    for (const root of allRoots) {
                        const shadowIframe = root.querySelector('iframe');
                        if (shadowIframe && (shadowIframe.src.includes('detail-desc') || shadowIframe.classList.contains('extend--iframe'))) {
                            targetIframe = shadowIframe;
                            console.log('[AliexpressParser] Shadow Root 내부에서 설명 Iframe 발견');
                            break;
                        }
                    }
                }

                if (!targetIframe && anchorEl) {
                    // 앵커 바로 다음 형제 요소 탐색 (User Screenshot 구조)
                    // #product-description -> iframe.extend--iframe--...
                    let next = anchorEl.nextElementSibling;
                    // 중간에 텍스트 노드나 주석이 있을 수 있으므로 몇 번 더 탐색
                    for (let k = 0; k < 3; k++) {
                        if (!next) break;
                        if (next.tagName === 'IFRAME') {
                            targetIframe = next;
                            console.log('[AliexpressParser] 앵커(#product-description) 인접 Iframe 발견');
                            break;
                        }
                        // div wrapper 안에 있을 수도 있음
                        const innerIframe = next.querySelector('iframe');
                        if (innerIframe) {
                            targetIframe = innerIframe;
                            console.log('[AliexpressParser] 앵커(#product-description) 인접 요소 내부 Iframe 발견');
                            break;
                        }
                        next = next.nextElementSibling;
                    }
                }

                if (targetIframe) {
                    console.log('[AliexpressParser] 설명 Iframe 발견:', targetIframe.src);
                    try {
                        const doc = targetIframe.contentDocument || targetIframe.contentWindow?.document;
                        if (doc && doc.body && doc.body.textContent.length > 50) {
                            descEl = doc.body;
                        }
                    } catch (e) { /* CORS */ }

                    if (!descEl && targetIframe.src && targetIframe.src.startsWith('http')) {
                        try {
                            const response = await fetch(targetIframe.src);
                            if (response.ok) {
                                const text = await response.text();
                                const parser = new DOMParser();
                                const doc = parser.parseFromString(text, 'text/html');
                                if (doc.body) descEl = doc.body;
                            }
                        } catch (e) {
                            console.error('[AliexpressParser] Fetch Error:', e);
                        }
                    }
                }
            }

            // 6. [NEW] 소스 코드 정규식 및 스크립트 변수 탐색 (강력함)
            if (!descEl) {
                console.log('[AliexpressParser] Iframe 실패, 스크립트/Regex 정밀 탐색 시도');
                try {
                    const html = document.documentElement.outerHTML;

                    // 패턴 1: descriptionUrl (JSON, RunParams) - 따옴표 및 공백 유연화
                    const descUrlPatterns = [
                        /descriptionUrl"?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i,
                        /detailDesc"?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i,
                        /productDescUrl"?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i,
                        // 일반적인 desc.htm 링크 탐색 (키 없이 URL만 있을 경우)
                        /["'](https?:\/\/[^"']*\/product\/description\/[^"']+)["']/i,
                        // [BRUTE FORCE] 파일명 기반 탐색 (alicdn 포함된 html/htm 파일)
                        /["'](https?:\/\/[^"']*alicdn[^"']*\.(?:html|htm)[^"']*)["']/i
                    ];

                    let descUrl = null;

                    // 1. HTML 소스 전체에서 검색
                    for (const pattern of descUrlPatterns) {
                        const match = html.match(pattern);
                        if (match && match[1]) {
                            // 제외 필터: 통계나 트래킹 URL 제외
                            if (!match[1].includes('stat') && !match[1].includes('log')) {
                                descUrl = match[1];
                                console.log('[AliexpressParser] HTML 소스에서 URL 발견:', descUrl);
                                break;
                            }
                        }
                    }

                    // 2. 스크립트 태그 내부 정밀 검색 (HTML match로 놓친 경우)
                    if (!descUrl) {
                        const scripts = document.querySelectorAll('script');
                        for (const script of scripts) {
                            const content = script.textContent;
                            if (!content || content.length < 50) continue;

                            for (const pattern of descUrlPatterns) {
                                const match = content.match(pattern);
                                if (match && match[1]) {
                                    // 제외 필터
                                    if (!match[1].includes('stat') && !match[1].includes('log')) {
                                        descUrl = match[1];
                                        console.log('[AliexpressParser] 스크립트 태그에서 URL 발견:', descUrl);
                                        break;
                                    }
                                }
                            }
                            if (descUrl) break;
                        }
                    }

                    if (descUrl) {
                        console.log('[AliexpressParser] Description URL Fetch 시도:', descUrl);
                        try {
                            const response = await fetch(descUrl);
                            if (response.ok) {
                                let text = await response.text();

                                // JSONP 또는 JS 변수 할당 형태인 경우 처리
                                if (text.trim().startsWith('var') || text.trim().startsWith('window') || text.includes('(')) {
                                    // 괄호나 따옴표 안의 내용만 추출 시도
                                    const strMatch = text.match(/["'](.*)["']/s); // s flag for dotAll
                                    if (strMatch) text = strMatch[1];
                                }

                                const parser = new DOMParser();
                                const doc = parser.parseFromString(text, 'text/html');
                                if (doc.body && doc.body.textContent.length > 20) {
                                    descEl = doc.body;
                                    console.log('[AliexpressParser] Fetch 및 파싱 성공');
                                }
                            }
                        } catch (err) {
                            console.error('[AliexpressParser] Description Fetch 실패:', err);
                        }
                    }
                } catch (e) {
                    console.error('[AliexpressParser] Regex 탐색 오류:', e);
                }
            }

            // 7. 일반 DOM 검색 (정말 최후의 수단)
            if (!descEl) {
                console.log('[AliexpressParser] 일반 DOM 탐색');
                const simpleTarget = document.querySelector('.detail-desc-decorate-richtext, .detailmodule_html, #product-description');
                if (simpleTarget) {
                    if (simpleTarget.textContent.trim().length > 20 || simpleTarget.querySelector('img')) {
                        descEl = simpleTarget;
                    }
                }
            }

            // 7. 데이터 추출
            if (descEl) {
                console.log('[AliexpressParser] 추출 대상 확정, 데이터 파싱 중...');

                if (!d.text) d.text = descEl.textContent.trim().substring(0, 5000);
                d.html = descEl.innerHTML;

                const imgs = descEl.querySelectorAll('img');
                imgs.forEach(img => {
                    const src = img.src || img.dataset.src;
                    if (src && !src.includes('data:image')) {
                        let finalSrc = src;
                        if (src.includes('alicdn.com')) {
                            finalSrc = src.replace(/(_\d+x\d+)\.(jpg|png|webp).*/i, '').replace(/\.(jpg|png|webp)_.*/i, '.$1');
                        }
                        d.images.push(finalSrc);
                    }
                });
                d.images = [...new Set(d.images)].slice(0, 20);
                console.log(`[AliexpressParser] 완료: 텍스트 ${d.text.length}자, 이미지 ${d.images.length}개`);
            } else {
                console.warn('[AliexpressParser] 상세 설명을 찾지 못했습니다.');
            }

        } catch (e) {
            console.error('[AliexpressParser] 로직 실행 중 오류:', e);
        }

        return d;
    }


    async extractShipping() {
        const shipping = {
            fee: 0,
            freeThreshold: 0,
            type: 'standard',
            estimatedDays: '',
            methods: []
        };

        // 배송비 및 배송 시간
        const shippingEl = document.querySelector('.product-shipping, .dynamic-shipping, .dynamic-shipping-line, [class*="dynamic-shipping-titleLayout"]');
        if (shippingEl) {
            const text = shippingEl.textContent;

            if (text.includes('Free shipping') || text.includes('무료 배송') || text.includes('무료배송')) {
                shipping.fee = 0;
                shipping.type = 'free';
            } else {
                const feeMatch = text.match(/\$?\s*(\d+\.?\d*)/);
                if (feeMatch) {
                    shipping.fee = parseFloat(feeMatch[1]);
                }
            }

            // 배송 기간
            const daysMatch = text.match(/(\d+)-(\d+)\s*days/i);
            if (daysMatch) {
                shipping.estimatedDays = `${daysMatch[1]}-${daysMatch[2]} days`;
            }
        }

        // 배송 방법
        const methodEls = document.querySelectorAll('.shipping-method-item, .logistics-item');
        methodEls.forEach(el => {
            shipping.methods.push({
                name: el.querySelector('.method-name')?.textContent.trim() || '',
                price: this.parsePrice(el.querySelector('.method-price')?.textContent || '0'),
                days: el.querySelector('.method-days')?.textContent.trim() || ''
            });
        });

        return shipping;
    }

    async extractSpecs() {
        const specs = {};

        // 1. ID 및 Data Attribute 기반 정밀 탐색 (최우선)
        // 사용자가 제공한 스크린샷 기반: id="nav-specification" 또는 data-pl="product-specs"
        const specContainer = document.querySelector('#nav-specification, [data-pl="product-specs"]');
        if (specContainer) {


            // 내부의 리스트 찾기 (클래스명 무관하게 ul 태그 탐색)
            const list = specContainer.querySelector('ul');
            if (list) {
                const items = list.querySelectorAll('li');
                items.forEach(item => {
                    let key = '';
                    let value = '';

                    // li 내부의 span 구조 확인
                    const spans = item.querySelectorAll('span');
                    if (spans.length >= 2) {
                        key = spans[0].textContent.trim().replace(/[:：]/g, '');
                        value = spans[1].textContent.trim();
                    } else {
                        // 텍스트 분리 시도
                        const text = item.textContent.trim();
                        if (text.includes(':')) {
                            const parts = text.split(':');
                            if (parts.length >= 2) {
                                key = parts[0].trim();
                                value = parts.slice(1).join(':').trim();
                            }
                        } else if (text.includes('：')) { // 전각 콜론
                            const parts = text.split('：');
                            if (parts.length >= 2) {
                                key = parts[0].trim();
                                value = parts.slice(1).join('：').trim();
                            }
                        }
                    }

                    if (key && value && key.length < 50) {
                        specs[key] = value;
                    }
                });
            }
        }

        // 2. 텍스트 기반 헤더 검색 (Fallback)
        if (Object.keys(specs).length === 0) {
            const headers = document.querySelectorAll('h2, h3, h4, .title, .section-title, div, span');
            for (const h of headers) {
                const t = h.textContent.trim();
                if (t.length > 50 || t.length < 2) continue;

                if (t.includes('상품 정보') || t.includes('Specifications') || t.includes('Item Specifics') || t.includes('Product Information')) {


                    let candidates = [
                        h.nextElementSibling,
                        h.parentElement?.nextElementSibling,
                        h.parentElement?.parentElement?.nextElementSibling
                    ];

                    for (const container of candidates) {
                        if (!container) continue;
                        const items = container.querySelectorAll('li, .do-entry-item, tr, div[class*="item"], div[class*="line"]');
                        if (items.length > 0) {
                            items.forEach(item => {
                                let key = '';
                                let value = '';
                                const keyEl = item.querySelector('.do-entry-item-title, .propery-title, .specification-title, .params-title, .title, dt, td:first-child, span[class*="title"], span[class*="key"]');
                                const valEl = item.querySelector('.do-entry-item-content, .propery-des, .specification-value, .params-value, .value, dd, td:last-child, span[class*="value"], span[class*="content"]');

                                if (keyEl) key = keyEl.textContent.trim().replace(/[:：]/g, '');
                                if (valEl) value = valEl.textContent.trim();

                                if ((!key || !value) && item.innerText.includes(':')) {
                                    const parts = item.innerText.split(/[:：]/);
                                    if (parts.length >= 2) {
                                        const potentialKey = parts[0].trim();
                                        if (potentialKey.length < 50) {
                                            key = potentialKey;
                                            value = parts.slice(1).join(':').trim();
                                        }
                                    }
                                }

                                if (key && value && key.length < 50) {
                                    specs[key] = value;
                                }
                            });
                            if (Object.keys(specs).length > 0) break;
                        }
                    }
                    if (Object.keys(specs).length > 0) break;
                }
            }
        }

        // 3. 기존 클래스 기반 수집 (Last Resort)
        if (Object.keys(specs).length === 0) {
            const newLayoutItems = document.querySelectorAll('.do-entry-item');
            newLayoutItems.forEach(item => {
                const label = item.querySelector('.do-entry-item-val, .do-entry-item-title');
                const value = item.querySelector('.do-entry-item-text, .do-entry-item-content');
                if (label && value) {
                    specs[label.textContent.trim().replace(/[:：]/g, '')] = value.textContent.trim();
                }
            });

            // 기존 레이아웃 (product-prop)
            const oldLayoutItems = document.querySelectorAll('.product-prop');
            oldLayoutItems.forEach(group => {
                const key = group.querySelector('.propery-title, .title')?.textContent.trim();
                const value = group.querySelector('.propery-des, .value')?.textContent.trim();
                if (key && value) {
                    specs[key.replace(/[:：]/g, '')] = value;
                }
            });

            // Specification List
            const specItems = document.querySelectorAll('.specification-item, .params-list li');
            specItems.forEach(item => {
                const key = item.querySelector('.specification-title, .params-title')?.textContent.trim();
                const value = item.querySelector('.specification-value, .params-value')?.textContent.trim();
                if (key && value) {
                    specs[key.replace(/[:：]/g, '')] = value;
                }
            });
        }


        return specs;
    }

    async extractStock() {
        // 재고 수량 표시
        const stockEl = document.querySelector('.product-quantity-tip, .quantity-info, [class*="quantity--info"]');
        if (stockEl) {
            const text = stockEl.textContent.toLowerCase();

            // "재고수량 287" 형태 (User Screenshot)
            if (stockEl.textContent.includes('재고수량')) {
                const match = stockEl.textContent.match(/재고수량\s*(\d+)/);
                if (match) {
                    const remaining = parseInt(match[1]);
                    return remaining > 0 ? remaining : 'out_of_stock'; // Return number if possible
                }
            }

            if (text.includes('only') && text.includes('left')) {
                // "Only 5 left" 형태
                const match = text.match(/only\s+(\d+)\s+left/);
                if (match) {
                    const remaining = parseInt(match[1]);
                    return remaining > 0 ? 'in_stock' : 'out_of_stock';
                }
            }

            if (text.includes('out of stock') || text.includes('sold out')) {
                return 'out_of_stock';
            }
        }

        // 구매 버튼 상태
        const buyButton = document.querySelector('.product-action .add-to-cart, button[data-role="addToCart"]');
        if (buyButton && buyButton.disabled) {
            return 'out_of_stock';
        }

        return 'in_stock';
    }

    /**
     * 이미지 추출 (고급 - 스크립트 데이터 포함)
     * Override BaseParser method with AliExpress-specific logic
     */
    async extractImages() {
        const images = [];
        const seen = new Set();

        const addImg = (src) => {
            if (!src || src.includes('data:image')) return;

            // AliExpress 이미지 고해상도 변환
            let finalSrc = src;
            if (src.includes('alicdn.com')) {
                // _50x50.jpg, _80x80.jpg, .jpg_640x640.jpg 등 패턴 제거
                finalSrc = src.replace(/(_\d+x\d+)\.(jpg|png|webp).*/i, '')  // _50x50.jpg 제거
                    .replace(/\.(jpg|png|webp)_.*/i, '.$1');       // .jpg_... 제거
            }

            if (!seen.has(finalSrc)) {
                seen.add(finalSrc);
                images.push(finalSrc);
            }
        };

        // 1. 스크립트 데이터에서 imagePathList 추출 (가장 확실한 방법)
        try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent;
                if (content.includes('imagePathList')) {
                    const match = content.match(/"imagePathList":\s*(\[[^\]]+\])/);
                    if (match) {
                        try {
                            const urls = JSON.parse(match[1]);

                            urls.forEach(url => addImg(url));
                        } catch (e) {

                        }
                    }
                }
            }
        } catch (e) {

        }

        // 2. 갤러리 이미지 추출
        const gallerySelectors = [
            '.images-view-item img',
            '.magnifier-image',
            '.image-view-list img',
            '.main-image-viewer img',
            '.gallery-view img',
            '[class*="image-view"] img'
        ];

        gallerySelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(img => {
                // 관련 상품 이미지 제외
                if (!img.closest('[class*="related"]') &&
                    !img.closest('[class*="recommend"]') &&
                    !img.closest('[class*="suggestion"]')) {
                    addImg(img.src || img.dataset.src || img.getAttribute('data-original'));
                }
            });
        });

        // 3. og:image 메타태그
        document.querySelectorAll('meta[property="og:image"]').forEach(m => {
            addImg(m.content);
        });

        // 4. Fallback: 큰 이미지만 추출
        if (images.length === 0) {

            document.querySelectorAll('img').forEach(img => {
                if (img.width > 200 && img.height > 200) {
                    if (!img.closest('[class*="related"]') &&
                        !img.closest('[class*="recommend"]')) {
                        addImg(img.src);
                    }
                }
            });
        }


        return images;
    }

    /**
     * 비디오 추출 (AliExpress 특화)
     */
    async extractVideos() {
        const videos = [];
        const seen = new Set();

        const addVideo = (src) => {
            if (!src || src.includes('blob:')) return;
            if (!seen.has(src)) {
                seen.add(src);
                videos.push(src);
            }
        };

        // 1. video 태그 탐색
        document.querySelectorAll('video').forEach(v => {
            addVideo(v.src || v.querySelector('source')?.src);
        });

        // 2. 스크립트 데이터에서 video 정보 추출
        try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent;
                if (content.includes('videoUid') || content.includes('videoUrl')) {
                    // 다양한 비디오 URL 패턴 매칭
                    const matches = content.match(/"videoUrl":\s*"([^"]+)"/g);
                    if (matches) {
                        matches.forEach(m => {
                            const urlMatch = m.match(/"videoUrl":\s*"([^"]+)"/);
                            if (urlMatch) addVideo(urlMatch[1]);
                        });
                    }
                }
            }
        } catch (e) {

        }


        return videos;
    }

    async extractPlatformSpecificData() {
        const metadata = {
            reviewCount: 0,
            rating: 0,
            orders: 0,
            seller: '',
            storeName: '',
            storeRating: 0,
            currency: 'USD' // Default
        };

        // 주문 수
        const ordersEl = document.querySelector('.product-reviewer-sold, span[data-pl="order-count"]');
        if (ordersEl) {
            const ordersText = ordersEl.textContent.replace(/[^\d]/g, '');
            metadata.orders = parseInt(ordersText) || 0;
        }

        // 판매자 정보
        const sellerEl = document.querySelector('.shop-name, a[data-pl="store-name"]');
        if (sellerEl) {
            metadata.seller = sellerEl.textContent.trim();
            metadata.storeName = metadata.seller;
        }

        // 상점 평점
        const storeRatingEl = document.querySelector('.store-rating, .shop-score');
        if (storeRatingEl) {
            metadata.storeRating = parseFloat(storeRatingEl.textContent) || 0;
        }

        return metadata;
    }

    async extractCurrency() {
        return 'USD'; // Force USD as per user request
    }

    async _legacy_extractCurrency() {
        // 1. Check specific AE selector for currency
        const currencyEl = document.querySelector('[class*="currency-code"], .currency-symbol');
        if (currencyEl) {
            const txt = currencyEl.textContent.trim();
            if (txt === 'KRW' || txt === '₩') return 'KRW';
            if (txt === 'USD' || txt === '$') return 'USD';
        }

        // 2. Check Price Element Context
        const priceEl = document.querySelector(this.selectors.price[0]); // Use first selector
        if (priceEl) {
            const txt = priceEl.textContent;
            if (txt.includes('₩')) return 'KRW';
            if (txt.includes('$')) return 'USD';
        }

        // 3. Script Data (common in AE)
        try {
            if (window.runParams && window.runParams.data && window.runParams.data.currencyCode) {
                return window.runParams.data.currencyCode;
            }
        } catch (e) { }

        return 'USD'; // Default for global site
    }

    /**
     * 알리익스프레스는 페이지 로딩이 느리므로 추가 대기 시간 필요
     */
    async parseProduct() {
        // 페이지 완전 로딩 대기
        await this.wait(2000);

        return await super.parseProduct();
    }

    async scrollToBottom() {
        return new Promise((resolve) => {
            let totalHeight = 0;
            // Scroll faster/more aggressively
            let distance = 500;
            let maxScrolls = 30; // Max 30 scrolls * 100ms = 3s approx
            let count = 0;

            let timer = setInterval(() => {
                let scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                count++;

                // Stop if we scrolled enough or hit bottom
                if ((window.innerHeight + window.scrollY) >= scrollHeight || count >= maxScrolls) {
                    clearInterval(timer);
                    // Wait a bit for final render
                    setTimeout(resolve, 1000);
                }
            }, 100);
        });
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AliexpressParser;
}
