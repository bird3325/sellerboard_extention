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

    async extractName() {
        // 동적 로딩 대기
        await this.wait(1000);

        const selectors = [
            'h1[data-pl="product-title"]',
            '.product-title-text',
            'h1.product-title',
            '.title--wrap--Ms9Zv4A h1'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element.textContent.trim();
            }
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
            '.sku-price'
        ];

        // Helper to parse price from text strictly
        const parsePrice = (text) => {
            if (!text) return 0;

            // 1. Strict Regex: Look for Currency Symbol followed by Number
            // e.g. "US $244.01", "₩ 10,000", "$50.5"
            // Handles comma and dot correctly
            const currencyRegex = /(?:US\s*\$|USD|₩|KRW|\$|€|£|¥)\s*([\d,.]+)/i;
            const match = text.match(currencyRegex);
            if (match) {
                const numStr = match[1].replace(/,/g, '');
                return parseFloat(numStr) || 0;
            }

            // 2. Trailing Currency Regex (e.g. "1000원")
            // Strict check to ensure no bare numbers are accepted
            const trailingRegex = /([\d,.]+)\s*(?:원|won|KRW)/i;
            const matchTrailing = text.match(trailingRegex);
            if (matchTrailing) {
                const numStr = matchTrailing[1].replace(/,/g, '');
                return parseFloat(numStr) || 0;
            }

            // 3. REJECT bare numbers if no currency symbol found
            // This prevents "5%" from being parsed as "5"
            return 0;
        };

        for (const sel of specificSelectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                // Ignore if class indicates discount
                if (el.className.includes('discount') || el.className.includes('original')) continue;

                const txt = el.textContent.trim();
                const price = parsePrice(txt);
                if (price > 0) return price;
            }
        }

        // 2. Fallback: Search in Price-looking elements generally (stricter than before)
        const fallbackEls = document.querySelectorAll('[class*="price"]');
        for (const el of fallbackEls) {
            // Skip known bad classes
            if (el.className.includes('discount') || el.className.includes('del') || el.className.includes('original')) continue;

            const txt = el.textContent.trim();
            const price = parsePrice(txt);
            if (price > 0) return price;
        }

        // 3. Fallback to generic text search via BaseParser (usually meta tags)
        return await super.extractPrice();
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

        const priceSelector = '[class*="price-tr--current"], [class*="price-current"], span[class*="price"]';

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

                    if (text && !seen.has(text)) {
                        seen.add(text);

                        let price = null;
                        let priceText = null;
                        let stock = null;

                        try {
                            if (!wasSelected) {

                                item.click();
                                await new Promise(resolve => setTimeout(resolve, 600));
                            }

                            const priceEl = document.querySelector(priceSelector);
                            if (priceEl) {
                                priceText = priceEl.textContent.trim();
                                // STRICT CURRENCY CHECK also here
                                const priceMatch = priceText.match(/(?:US\s*\$|USD|₩|KRW|\$|€|£|¥)\s*([\d,]+\.?\d*)/i);
                                if (priceMatch) {
                                    price = parseFloat(priceMatch[1].replace(/,/g, ''));
                                }
                            }

                            await new Promise(resolve => setTimeout(resolve, 300));

                            const bodyText = document.body.innerText;
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
                                    } else {
                                        const stockSelectors = ['[class*="quantity"]', '[class*="stock"]', '[class*="available"]', '[class*="inventory"]', '[data-spm*="quantity"]', '.product-quantity', '#quantity', '[id*="quantity"]'];
                                        let found = false;
                                        for (const sel of stockSelectors) {
                                            const elements = document.querySelectorAll(sel);
                                            for (const stockEl of elements) {
                                                const stockText = stockEl.textContent.trim();
                                                if (stockText.length > 0 && stockText.length < 100) {
                                                    const numMatch = stockText.match(/(\d+)/);
                                                    if (numMatch) {
                                                        const num = parseInt(numMatch[1], 10);
                                                        if (num > 0 && num < 100000) {
                                                            stock = num;
                                                            found = true;
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            if (found) break;
                                        }
                                        if (stock === null) stock = 'in_stock';
                                    }
                                }
                            }
                        } catch (e) {

                        }

                        const optValue = { text, value, selected: wasSelected, image: imageUrl };
                        if (price !== null) {
                            optValue.price = price;
                            optValue.priceType = 'absolute';
                            optValue.priceText = priceText;
                        }
                        if (stock !== null) optValue.stock = stock;
                        data.values.push(optValue);
                    }
                }
                if (data.values.length >= 1) {
                    opts.push(data);

                }
            }
        }
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

        const d = { text: '', html: '', images: [] };

        try {
            const expandSelectors = ['button[class*="expand"]', 'button[class*="more"]', 'div[class*="expand"]', '.view-more-btn', '#product-description-expand'];
            const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
            const textExpanders = buttons.filter(b => {
                const t = b.textContent.trim().toLowerCase();
                return t === 'view more' || t === 'show more' || t === '더보기' || t === '펼치기' || t.includes('description');
            });
            const allExpanders = [...document.querySelectorAll(expandSelectors.join(',')), ...textExpanders];

            for (const btn of allExpanders) {
                if (btn && btn.offsetParent !== null) {
                    try {
                        btn.click();
                        await new Promise(r => setTimeout(r, 500));
                    } catch (e) { }
                }
            }

            let descEl = null;

            let shadowRoots = [];
            const mainContainer = document.querySelector('.pdp-body') || document.querySelector('#root') || document.body;
            const walker = document.createTreeWalker(mainContainer, NodeFilter.SHOW_ELEMENT);
            let currentNode = walker.currentNode;
            while (currentNode) {
                if (currentNode.shadowRoot) shadowRoots.push(currentNode.shadowRoot);
                currentNode = walker.nextNode();
            }

            for (const root of shadowRoots) {
                const target = root.querySelector('.detail-desc-decorate-richtext, .detailmodule_html, #product-description, [name="description"]');
                if (target && target.textContent.trim().length > 50) {
                    descEl = target;
                    break;
                }
                const divs = root.querySelectorAll('div, p, span');
                let bestTextDiv = null;
                let maxLen = 0;
                for (const div of divs) {
                    const len = div.textContent.trim().length;
                    if (len > 200 && len > maxLen && div.children.length < 20) {
                        maxLen = len;
                        bestTextDiv = div;
                    }
                }
                if (bestTextDiv) {
                    descEl = bestTextDiv;
                    break;
                }
                const imgs = root.querySelectorAll('img');
                if (imgs.length > 3) {
                    descEl = root.querySelector('div') || root;
                    break;
                }
            }

            if (!descEl) {
                const candidates = document.querySelectorAll('h2, h3, h4, div, span, p, strong');
                for (const el of candidates) {
                    const t = el.textContent.trim();
                    if (t === '개요' || t === 'Overview') {
                        let parent = el.parentElement;
                        let headerRow = null;
                        for (let i = 0; i < 4; i++) {
                            if (!parent) break;
                            const parentText = parent.textContent;
                            if (parentText.includes('신고하기') || parentText.includes('Report')) {
                                headerRow = parent;
                                break;
                            }
                            parent = parent.parentElement;
                        }
                        if (headerRow) {
                            let next = headerRow.nextElementSibling;
                            if (next) {
                                descEl = next;
                                break;
                            }
                        }
                    }
                }
            }

            if (!descEl) {
                const divs = document.querySelectorAll('div');
                for (const div of divs) {
                    if (div.textContent.trim().startsWith('설명') && div.textContent.length > 100) {
                        descEl = div;
                    }
                }
            }

            if (!descEl) {
                const headers = document.querySelectorAll('h2, h3, h4, .title, .section-title');
                for (const h of headers) {
                    const t = h.textContent.trim();
                    if (t === '개요' || t === '설명' || t === 'Description' || t === 'Overview' || t.includes('Product Description')) {
                        let next = h.nextElementSibling;
                        if (next && next.tagName === 'DIV') {
                            descEl = next;
                            break;
                        }
                        const parentContent = h.closest('div[class*="container"], div[class*="wrap"]');
                        if (parentContent) {
                            descEl = parentContent.nextElementSibling || parentContent;
                            break;
                        }
                    }
                }
            }

            if (descEl) {
                const iframe = descEl.querySelector('iframe') || (descEl.tagName === 'IFRAME' ? descEl : null);
                if (iframe) {
                    if (!iframe.contentDocument && iframe.src) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }
                    try {
                        const doc = iframe.contentDocument || iframe.contentWindow?.document;
                        if (doc && doc.body) {
                            descEl = doc.body;
                        } else if (iframe.src && iframe.src.startsWith('http')) {
                            const response = await fetch(iframe.src);
                            if (response.ok) {
                                const text = await response.text();
                                if (text && text.length > 100) {
                                    const parser = new DOMParser();
                                    const doc = parser.parseFromString(text, 'text/html');
                                    if (doc.body) descEl = doc.body;
                                }
                            }
                        }
                    } catch (e) { }
                }
            }

            if (descEl) {
                if (!d.text) d.text = descEl.textContent.trim().substring(0, 5000);
                d.html = descEl.innerHTML;
            }

        } catch (e) {

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
