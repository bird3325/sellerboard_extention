/**
 * Taobao/Tmall Parser - Robust Step-by-Step Implementation
 * 
 * Strategy:
 * 1. Prioritize visible DOM elements for critical data (Title, Main Image).
 * 2. Use JSON (__INITIAL_DATA__) for complex data (SKUs, exact Stock) if available.
 * 3. Graceful degradation: If JSON fails, fall back to simple DOM scraping.
 */

class TaobaoParser extends BaseParser {
    constructor() {
        super('taobao');
        this.jsonData = null;
    }

    getSelectors() {
        // Fallback selectors
        return {
            name: 'h1, .tb-main-title, [class*="ItemHeader--title"]',
            price: '.price, .tb-rmb-num, [class*="Price--priceText"]',
            images: '#J_ImgBooth, .tb-booth img, [class*="Image--mainImage"]',
            stock: '.tb-amount, [class*="Stock--stock"]',
            description: '#description, .tb-detail, [class*="Desc--desc"]',
            category: '.breadcrumb'
        };
    }

    async parseProduct() {
        console.log('[Taobao] Starting Step-by-Step Parsing (V2 - No Mobile Bypass)...');

        // Step 0: Try to load JSON data (Non-blocking)
        await this.stepLoadJsonData();

        // Step 1: Critical Info (Title & Images)
        // If these fail, we throw error because a product without title/image is useless.
        const name = await this.stepExtractName();
        const images = await this.stepExtractImages();

        // Step 2: Price
        let price = await this.stepExtractPrice();
        if (!price || price === 0) price = 0; // Ensure number

        // Step 3: Options (SKU)
        // This is complex. We try JSON first, then DOM. We swallow errors to preserve basics.
        let options = [];
        try {
            options = await this.stepExtractOptions();
        } catch (e) {
            console.error('[Taobao] Option step failed, continuing...', e);
        }

        // [User Request] Overwrite base price with minimum option price
        if (options && options.length > 0) {
            let minOptionPrice = Infinity;
            options.forEach(grp => {
                if (grp.values) {
                    grp.values.forEach(v => {
                        if (v.price && v.price > 0 && v.price < minOptionPrice) {
                            minOptionPrice = v.price;
                        }
                    });
                }
            });

            if (minOptionPrice !== Infinity && minOptionPrice > 0) {
                console.log('[Taobao] Updated base price to min option price:', minOptionPrice);
                price = minOptionPrice;
            }
        }

        // Step 4: Description
        let description = { text: '', html: '', images: [] };
        try {
            description = await this.stepExtractDescription();
        } catch (e) {
            console.error('[Taobao] Description step failed, continuing...', e);
        }

        // Step 5: Stock & Category
        const stock = await this.stepExtractStock();
        const category = await this.stepExtractCategory();
        const video = await this.extractVideos(); // BaseParser method

        console.log('[Taobao] Parsing Complete', { name, price, optionsLen: options.length });

        return {
            name,
            price,
            images,
            options,
            description,
            stock,
            category,
            specifications: await this.stepExtractSpecifications(),
            videos: video,
            platform: this.platform,
            url: window.location.href,
            collectedAt: new Date().toISOString()
        };
    }

    // --- Step Implementations ---

    async stepExtractSpecifications() {
        const specifications = [];
        const seen = new Set(); // Deduplication

        const addSpec = (name, value) => {
            if (!name || !value) return;
            const k = name.replace(/[:：]/g, '').trim();
            const v = value.trim();
            if (!k || !v) return;

            const keyStr = k + ':' + v;
            if (seen.has(keyStr)) return;
            seen.add(keyStr);
            specifications.push({ name: k, value: v });
        };

        // Strategy 0: JSON Data (ICE_APP_CONTEXT - Tmall Specific)
        if (this.jsonData) {
            let extensionInfo = this.jsonData.loaderData?.home?.data?.res?.extensionInfoVO;

            // Validation function: Check if this object actually has specifications
            const isValidExtInfo = (obj) => {
                return obj && obj.infos && Array.isArray(obj.infos) && obj.infos.some(i => i.type === 'BASE_PROPS');
            };

            // If direct path is invalid, try deep search
            if (!isValidExtInfo(extensionInfo)) {
                // Helper to find object with "infos" array containing BASE_PROPS
                const findExtensionInfo = (obj, depth = 0) => {
                    if (!obj || depth > 8 || typeof obj !== 'object') return null;

                    if (isValidExtInfo(obj)) return obj;

                    // Optimization: Arrays first
                    if (Array.isArray(obj)) {
                        for (const item of obj) {
                            const found = findExtensionInfo(item, depth + 1);
                            if (found) return found;
                        }
                        return null;
                    }

                    for (const key in obj) {
                        // Skip text/huge fields to speed up
                        if (key === 'html' || key === 'desc' || key.length > 20) continue;
                        const found = findExtensionInfo(obj[key], depth + 1);
                        if (found) return found;
                    }
                    return null;
                };
                extensionInfo = findExtensionInfo(this.jsonData);
            }

            if (isValidExtInfo(extensionInfo)) {
                try {
                    const baseProps = extensionInfo.infos.find(i => i.type === 'BASE_PROPS');
                    if (baseProps && baseProps.items) {
                        baseProps.items.forEach(item => {
                            const key = item.title;
                            const val = item.text ? item.text[0] : '';
                            addSpec(key, val);
                        });
                        console.log('[Taobao] Successfully extracted specs from extensionInfoVO');
                    }
                } catch (e) {
                    console.error('[Taobao] Error parsing extensionInfoVO', e);
                }
            }
        }

        // Strategy 0.5: JSON Data (Deep Search - Fallback)
        if (this.jsonData) {
            const foundProps = this.findPropsInObject(this.jsonData);
            foundProps.forEach(p => addSpec(p.name, p.value));
        }

        if (specifications.length > 0) return specifications;

        // Strategy 1: Direct DOM Scraping based on verified Tmall structure
        await this.scrollForSpecs(); // Ensure specs are loaded

        // 1. Emphasis Items (Top Box)

        // 1. Emphasis Items (Top Box)
        // Verified: Value has "Title" class, Key has "SubTitle" class
        const empItems = document.querySelectorAll('[class*="emphasisParamsInfoItem--"]');
        empItems.forEach(item => {
            const valNode = item.querySelector('[class*="emphasisParamsInfoItemTitle--"]');
            const keyNode = item.querySelector('[class*="emphasisParamsInfoItemSubTitle--"]');

            if (valNode && keyNode) {
                const key = keyNode.getAttribute('title') || keyNode.textContent.trim();
                const val = valNode.getAttribute('title') || valNode.textContent.trim();
                addSpec(key, val);
            }
        });

        // 2. General Items (List)
        // Verified: Key has "Title" class, Value has "SubTitle" class
        const genItems = document.querySelectorAll('[class*="generalParamsInfoItem--"]');
        genItems.forEach(item => {
            const keyNode = item.querySelector('[class*="generalParamsInfoItemTitle--"]');
            const valNode = item.querySelector('[class*="generalParamsInfoItemSubTitle--"]');

            if (keyNode && valNode) {
                const key = keyNode.getAttribute('title') || keyNode.textContent.trim();
                const val = valNode.getAttribute('title') || valNode.textContent.trim();
                addSpec(key, val);
            }
        });

        if (specifications.length > 0) return specifications;

        // Strategy A: Header Search (Generic Fallback)
        try {
            const allElements = document.querySelectorAll('div, h4, th');
            for (const el of allElements) {
                const txt = el.textContent.trim();
                if (txt === '参数信息' || txt === '产品参数' || txt.includes('规格参数')) {
                    // Search Siblings and Parent's Siblings
                    let container = el.parentElement;
                    let foundList = false;

                    // Search up to 5 levels up for a list container
                    for (let i = 0; i < 5; i++) {
                        if (!container) break;

                        // Check if this container has many children that look like list items
                        const children = container.querySelectorAll('li, div, dl');
                        let qualifiedChildren = [];

                        children.forEach(c => {
                            // Check if child has structure of Spec Item (2 parts)
                            if (c.childElementCount === 2 || (c.textContent.includes('：') || c.textContent.includes(':'))) {
                                qualifiedChildren.push(c);
                            }
                        });


                        if (qualifiedChildren.length > 3) {
                            qualifiedChildren.forEach(c => {
                                let k, v;
                                if (c.childElementCount === 2) {
                                    // Assume first is key, second is value (most common) or check classes
                                    k = c.children[0].textContent.trim();
                                    v = c.children[1].textContent.trim();
                                } else {
                                    const parts = c.textContent.split(/[:：]/);
                                    if (parts.length >= 2) {
                                        k = parts[0].trim();
                                        v = parts.slice(1).join(':').trim();
                                    }
                                }
                                addSpec(k, v);
                            });
                            foundList = true;
                            break;
                        }
                        container = container.parentElement;
                    }
                    if (foundList) break;
                }
            }
        } catch (e) {
            console.warn('[Taobao] Generic Spec Search failed', e);
        }

        if (specifications.length > 0) return specifications;

        // Strategy 2: Legacy fallback
        const legacyItems = document.querySelectorAll('.attributes-list li, #attributes li, .tb-attributes-list li');
        legacyItems.forEach(li => {
            const text = li.getAttribute('title') || li.textContent.trim();
            const parts = text.split(/[:：]/).map(s => s.trim());
            if (parts.length >= 2) {
                addSpec(parts[0], parts.slice(1).join(':'));
            }
        });

        return specifications;
    }

    findPropsInObject(obj, depth = 0) {
        if (!obj || depth > 10 || typeof obj !== 'object') return [];
        let results = [];

        // Check if array of props
        if (Array.isArray(obj)) {
            // Check if this array contains prop-like objects
            const isPropArray = obj.every(item => item && item.name && item.value && typeof item.name === 'string');
            if (isPropArray && obj.length > 0) {
                return obj;
            }
            obj.forEach(item => results = results.concat(this.findPropsInObject(item, depth + 1)));
            return results;
        }

        // Object search
        if (obj.groupProps && Array.isArray(obj.groupProps)) {
            obj.groupProps.forEach(g => {
                if (g.props) results = results.concat(g.props);
            });
        }
        if (obj.props && Array.isArray(obj.props)) {
            // Validate props
            if (obj.props.length > 0 && obj.props[0].name && obj.props[0].value) {
                results = results.concat(obj.props);
            }
        }

        Object.keys(obj).forEach(key => {
            if (key !== 'groupProps' && key !== 'props') { // Optimization
                results = results.concat(this.findPropsInObject(obj[key], depth + 1));
            }
        });

        return results;
    }

    async stepLoadJsonData() {
        try {
            this.jsonData = null;
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent.trim();

                // Strategy 1: Check for __ICE_APP_CONTEXT__ script source (Tmall)
                // We parse the script text directly because extension isolation or hydration might hide the data in the window object.
                if (content.includes('__ICE_APP_CONTEXT__') && content.includes('extensionInfoVO')) {
                    console.log('[Taobao] Found ICE_APP_CONTEXT script');
                    try {
                        // Pattern: var b = {"appData": ... };
                        // Robust Extraction: Balanced Brace Counting
                        // Regex is too brittle for nested JSON containing "};". 

                        const startMarker = '{"appData":';
                        const startIndex = content.indexOf(startMarker);

                        if (startIndex !== -1) {
                            // Helper inside scope for robust parsing
                            const extractJsonQuoteAware = (str, startPos) => {
                                let braceCount = 0;
                                let inString = false;
                                let escaped = false;
                                let endPos = -1;

                                for (let i = startPos; i < str.length; i++) {
                                    const char = str[i];
                                    if (escaped) { escaped = false; continue; }
                                    if (char === '\\') { escaped = true; continue; }
                                    if (char === '"') { inString = !inString; continue; }

                                    if (!inString) {
                                        if (char === '{') braceCount++;
                                        else if (char === '}') {
                                            braceCount--;
                                            if (braceCount === 0) {
                                                endPos = i + 1;
                                                break;
                                            }
                                        }
                                    }
                                }
                                return endPos !== -1 ? str.substring(startPos, endPos) : null;
                            };

                            const jsonString = extractJsonQuoteAware(content, startIndex);

                            if (jsonString) {
                                this.jsonData = JSON.parse(jsonString);
                                console.log('[Taobao] Successfully extracted ICE_APP_CONTEXT using Quote-Aware Parser');
                                return;
                            }
                        }
                    } catch (parseErr) {
                        console.warn('[Taobao] Failed to parse ICE_APP_CONTEXT from script', parseErr);
                    }
                }

                // Strategy 2: _DATA_Detail (Common in mobile/H5/modern PC)
                if (content.includes('_DATA_Detail')) {
                    const match = content.match(/_DATA_Detail\s*=\s*({[\s\S]+?});/);
                    if (match && match[1]) {
                        this.jsonData = JSON.parse(match[1]);
                        return; // Priority return
                    }
                }

                // 2. __INITIAL_DATA__
                if (content.includes('__INITIAL_DATA__')) {
                    const match = content.match(/__INITIAL_DATA__\s*=\s*({[\s\S]+?});/);
                    if (match && match[1]) {
                        this.jsonData = JSON.parse(match[1]);
                        return;
                    }
                }

                // 3. g_config (Sometimes has idata)
                if (content.includes('g_config')) {
                    const match = content.match(/g_config\s*=\s*({[\s\S]+?});/);
                    if (match && match[1]) {
                        // Store as backup or merge, but don't return yet as _DATA_Detail is better
                        const conf = JSON.parse(match[1]);
                        if (!this.jsonData) this.jsonData = conf.idata || conf;
                    }
                }

                // Legacy TShop
                if (content.includes('TShop.Setup(')) {
                    const match = content.match(/TShop\.Setup\((.*?)\);/s);
                    if (match && match[1]) {
                        this.jsonData = JSON.parse(match[1]);
                        return;
                    }
                }
            }
        } catch (e) {
            console.warn('[Taobao] JSON Load skipped', e);
        }
    }

    async stepExtractName() {
        let name = '';

        // 1. Selector strategy (Most reliable for "Visible" title)
        const selectors = [
            '[class*="ItemHeader--title"]',
            '.tb-main-title',
            'h1',
            '[class*="mainTitle"]'
        ];

        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim()) {
                name = el.textContent.trim();
                break;
            }
        }

        // 2. JSON Backup
        if (!name && this.jsonData) {
            const item = this.jsonData.item || (this.jsonData.data && this.jsonData.data.item);
            if (item && item.title) name = item.title;
        }

        // 3. Document Title Backup
        if (!name) name = document.title;

        return name;
    }

    async stepExtractImages() {
        let images = [];

        // 1. JSON Data (Priority - usually highest quality)
        if (this.jsonData) {
            // Check various paths
            let candidateImages = [];
            const item = this.jsonData.item || (this.jsonData.data && this.jsonData.data.item);

            if (item && item.images && Array.isArray(item.images)) {
                candidateImages = item.images;
            } else if (this.jsonData.mock && this.jsonData.mock.multimedia && this.jsonData.mock.multimedia.images) {
                // Some structures use mock.multimedia
                candidateImages = this.jsonData.mock.multimedia.images;
            }

            if (candidateImages.length > 0) {
                images = candidateImages.map(url => {
                    let u = url;
                    if (u.startsWith('//')) u = 'https:' + u;
                    return u;
                });
            }
        }

        // 2. DOM - Thumbnails (If JSON failed or we want to augment)
        if (images.length === 0) {
            const thumbSelectors = [
                '[class*="Image--thumbnails"] img',
                '#J_UlThumb li img',
                '.tb-thumb li img',
                '.picGallery--thumbnails img',
                '.thumbnailPic--QasTmWDm' // New from user
            ];

            for (const sel of thumbSelectors) {
                const thumbs = document.querySelectorAll(sel);
                if (thumbs.length > 0) {
                    thumbs.forEach(img => {
                        let src = img.src || img.getAttribute('data-src') || img.getAttribute('placeholder'); // Sometimes placeholder has real one? No, usually src.
                        // User html shows src has the image (maybe tiny), but we want to clean it.
                        // If src starts with //img.alicdn... ensure we take that.

                        if (src) {
                            // Cleanup logic
                            // format: url.jpg_q50.jpg_.webp -> url.jpg
                            // format: url.jpg_400x400.jpg -> url.jpg
                            src = src.split('_.webp')[0] // Remove ._.webp suffix
                                .replace(/_q\d+\.jpg$/, '') // Remove _q50.jpg
                                .replace(/_\d+x\d+.*$/, '') // Remove _400x400...
                                .replace(/\.jpg_.+$/, '.jpg') // Catch all .jpg_...
                                .replace(/_sum\.jpg$/, '');

                            if (src.startsWith('//')) src = 'https:' + src;
                            if (!images.includes(src)) images.push(src);
                        }
                    });
                }
            }
        }

        // 3. DOM - Main Image (Last resort)
        if (images.length === 0) {
            const main = document.querySelector('[class*="Image--mainImage"] img, #J_ImgBooth, .MainPic img');
            if (main) {
                let src = main.src;
                src = src.split('_.webp')[0]
                    .replace(/_q\d+\.jpg$/, '')
                    .replace(/_\d+x\d+.*$/, '')
                    .replace(/\.jpg_.+$/, '.jpg')
                    .replace(/_sum\.jpg$/, '');
                if (src.startsWith('//')) src = 'https:' + src;
                images.push(src);
            }
        }

        return images.slice(0, 20); // Limit
    }

    async extractVideos() {
        const videos = new Set();
        const videoIds = new Set(); // Track unique video IDs (filenames) to prevent duplicates

        const addVideo = (url) => {
            if (!url) return;
            let u = url;
            if (u.startsWith('//')) u = 'https:' + u;

            // Basic valid check
            if (!u.includes('.mp4') && !u.includes('alicdn.com') && !u.startsWith('blob:')) return;

            // Deduplication Logic
            try {
                // If blob, just add (can't parse easily)
                if (u.startsWith('blob:')) {
                    videos.add(u);
                    return;
                }

                const urlObj = new URL(u);
                const pathname = urlObj.pathname; // /avpl/.../video.mp4
                const filename = pathname.substring(pathname.lastIndexOf('/') + 1);

                // If we extracted a meaningful filename (e.g. .mp4), use it for dedup
                if (filename && filename.length > 5) {
                    if (videoIds.has(filename)) return; // Duplicate ID
                    videoIds.add(filename);
                } else {
                    // Fallback to full URL check if filename matches failures
                    if (videos.has(u)) return;
                }
            } catch (e) {
                if (videos.has(u)) return;
            }

            videos.add(u);
        };

        // 1. DOM Search - Broad & Specific
        const videoSelectors = [
            '#videox-video-el',
            '#mainPicVideoEl video',
            '[class*="mainPicVideo"] video',
            '.videox-container video',
            'video' // Catch-all
        ];

        videoSelectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                let src = el.src || el.getAttribute('src');
                if (!src) {
                    const source = el.querySelector('source');
                    if (source) src = source.src || source.getAttribute('src');
                }
                if (src) addVideo(src);
            });
        });

        // 2. JSON Search
        if (this.jsonData) {
            const findVideos = (obj) => {
                if (!obj || typeof obj !== 'object') return;

                const candidate = obj.videoUrl || obj.video_url || obj.url;
                if (typeof candidate === 'string') {
                    addVideo(candidate);
                }

                Object.keys(obj).forEach(key => {
                    const val = obj[key];
                    if (Array.isArray(val)) val.forEach(findVideos);
                    else findVideos(val);
                });
            };

            if (this.jsonData.item) findVideos(this.jsonData.item);
            if (this.jsonData.mock) findVideos(this.jsonData.mock);
            if (this.jsonData.apiStack) findVideos(this.jsonData.apiStack);
        }

        // 3. Regex Fallback
        if (videos.size === 0) {
            try {
                const html = document.body.innerHTML;
                const patterns = [
                    /"(https?:)?\/\/tbm-auth\.alicdn\.com\/[^"]+?\.mp4[^"]*?"/g,
                    /"(https?:)?\/\/cloud\.video\.taobao\.com\/[^"]+?\.mp4[^"]*?"/g
                ];

                patterns.forEach(regex => {
                    const matches = html.match(regex);
                    if (matches) {
                        matches.forEach(m => {
                            addVideo(m.replace(/"/g, ''));
                        });
                    }
                });
            } catch (e) {
                console.warn('[Taobao] Video Regex failed', e);
            }
        }

        return Array.from(videos);
    }

    async stepExtractPrice() {
        // Priority: DOM (Real visible price) -> JSON

        // 1. DOM
        // Refined selectors based on modern Taobao/Tmall structures
        const selectors = [
            '[class*="Price--priceText"]', // Common Modern
            '[class*="priceText--"]',      // Variation
            '.price-now',                  // Legacy
            '.tm-price',                   // Tmall Legacy
            '.tb-rmb-num',                 // Taobao Legacy
            '[class*="extraPrice"]',       // Discount/Promo Banner
            '[class*="Price--extraPrice"]' // Modern Discount
        ];

        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                // Handle "After Coupon" text like "券后 ¥168"
                const txt = el.textContent.trim();

                // Explicitly check for currency symbol + number pattern
                const priceMatch = txt.match(/[¥￥$](\d+(?:\.\d+)?)/);
                if (priceMatch) {
                    const p = parseFloat(priceMatch[1]);
                    if (p > 0) {
                        this.priceElement = el; // Save for currency check
                        return p;
                    }
                }

                // Fallback normal parse
                if (txt && /\d/.test(txt)) {
                    const p = this.parsePrice(txt);
                    if (p > 0) {
                        this.priceElement = el; // Save for currency check
                        return p;
                    }
                }
            }
        }

        // Strategy 2: Look for big recursive price elements (often red text)
        const potentialPriceEls = document.querySelectorAll('span, div, em, strong');
        for (const el of potentialPriceEls) {
            const style = window.getComputedStyle(el);
            // Red-ish color + large font is usually price
            if (style.color && (style.color.includes('255, 0, 0') || style.color.includes('255, 80, 0') || style.color.includes('#f') || style.color.includes('#F'))) {
                const fontSize = parseFloat(style.fontSize);
                if (fontSize >= 18) { // reasonably big
                    const txt = el.textContent.trim();
                    // Strict number check
                    if (/^\d+(?:\.\d+)?$/.test(txt)) {
                        this.priceElement = el; // Save for currency check
                        return parseFloat(txt);
                    }
                }
            }
        }

        return 0;
    }

    async stepExtractOptions() {
        // [User Request] Click-based scraping is required.
        // We prioritize DOM interaction to capture the dynamic price update upon checking an option.

        // 1. JSON SKU Mapping - Skipped to enforce DOM interaction as requested
        /*
        if (this.jsonData) {
            const skuBase = this.jsonData.skuBase ||
                (this.jsonData.data && this.jsonData.data.skuBase) ||
                (this.jsonData.mock && this.jsonData.mock.skuBase);

            if (skuBase && skuBase.props && skuBase.skus) {
                const combined = this.processSkuBase(skuBase);
                if (combined) return combined;
            }
        }
        */

        // 2. DOM - Scroll and Scrape
        await this.scrollSkuPanel();

        // Must await the async DOM extraction
        return await this.extractOptionsFromDOM();
    }

    async scrollSkuPanel() {
        return new Promise(resolve => {
            const rightPanel = document.querySelector('#tbpcDetail_SkuPanelBody, [class*="scrollWrap--"], .rightWrap--XKiM7k8y .scrollWrap--ou3MEdhf');
            if (rightPanel) {
                // Scroll to bottom to trigger lazy load
                const totalHeight = rightPanel.scrollHeight;
                let currentScroll = 0;
                const step = totalHeight / 5;

                const interval = setInterval(() => {
                    currentScroll += step;
                    rightPanel.scrollTop = currentScroll;
                    if (currentScroll >= totalHeight) {
                        clearInterval(interval);
                        setTimeout(resolve, 500); // Wait for render
                    }
                }, 100);
            } else {
                resolve();
            }
        });
    }

    processSkuBase(skuBase) {
        try {
            // Needed for Price/Stock mapping
            let skuMap = {};

            // Strategy 1: apiStack (Common)
            if (this.jsonData.apiStack && this.jsonData.apiStack[0]) {
                try {
                    const api = JSON.parse(this.jsonData.apiStack[0].value);
                    if (api.skuBase) skuBase = api.skuBase; // Check if we should override or merge? Usually override if apiStack has better data.
                    else if (api.data && api.data.skuBase) skuBase = api.data.skuBase;

                    if (api.skuCore && api.skuCore.sku2info) skuMap = api.skuCore.sku2info;
                    else if (api.data && api.data.skuModel) skuMap = api.data.skuModel.skus || {};
                } catch (e) { }
            }

            // Strategy 2: mock (Common in _DATA_Detail)
            if (Object.keys(skuMap).length === 0 && this.jsonData.mock && this.jsonData.mock.skuCore) {
                skuMap = this.jsonData.mock.skuCore.sku2info || {};
            }

            // Strategy 3: Direct in jsonData (Rare)
            if (Object.keys(skuMap).length === 0 && this.jsonData.skuCore) {
                skuMap = this.jsonData.skuCore.sku2info || {};
            }

            if (!skuBase || !skuBase.props) return null;

            const propMap = {};
            if (skuBase.props) {
                skuBase.props.forEach(p => {
                    p.values.forEach(v => {
                        propMap[v.vid] = { name: v.name, image: v.image };
                    });
                });
            }

            const skuList = [];
            if (skuBase.skus) {
                skuBase.skus.forEach(sku => {
                    const path = sku.propPath; // e.g. "123:456;789:101"
                    if (!path) return;

                    const ids = path.split(';').filter(Boolean);
                    const names = [];
                    let img = null;

                    ids.forEach(idPair => {
                        const vid = idPair.split(':')[1];
                        if (propMap[vid]) {
                            names.push(propMap[vid].name);
                            if (propMap[vid].image) img = propMap[vid].image;
                        }
                    });

                    const info = skuMap[sku.skuId] || skuMap[path] || {};

                    // Resolving Price
                    let pVal = 0;
                    if (info.price) pVal = this.parsePrice(info.price.priceText);
                    else if (info.subPrice) pVal = this.parsePrice(info.subPrice.priceText);
                    // Fallback: originalPrice
                    else if (info.originalPrice) pVal = this.parsePrice(info.originalPrice.priceText);
                    else pVal = 0;

                    // Resolving Stock
                    let sVal = 999;
                    if (info.quantity) sVal = parseInt(info.quantity);
                    else if (info.quantityText) sVal = parseInt(info.quantityText);

                    skuList.push({
                        value: names.join(' / '),
                        price: pVal,
                        stock: sVal,
                        imageUrl: img
                    });
                });
            }

            if (skuList.length > 0) {
                return [{
                    name: '옵션 선택', // Unified name for combination
                    type: 'combination',
                    values: skuList
                }];
            }
        } catch (e) {
            console.warn('[Taobao] processSkuBase failed', e);
        }
        return null;
    }

    async extractOptionsFromDOM() {
        const options = [];
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        // Strategy 1: User specific structure - Bottom-Up Approach
        const allValueItems = document.querySelectorAll('[class*="valueItem--"]');

        if (allValueItems.length > 0) {
            // Group by parent container (the "row")
            const rows = new Map();
            allValueItems.forEach(item => {
                const parent = item.parentElement;
                if (!rows.has(parent)) rows.set(parent, []);
                rows.get(parent).push(item);
            });

            // Use for...of loop for async iteration
            for (const [parentContainer, items] of rows) {
                // Try to find Label
                let name = '옵션';
                let labelFound = false;

                // Strategy 1 Label Improvement
                name = '옵션';
                labelFound = false;

                // 1. Try generic sibling search (upwards)
                let prev = parentContainer.previousElementSibling;
                // Limit lookback
                let lookback = 3;
                while (prev && lookback > 0) {
                    // Check if it looks like a label
                    const txt = prev.textContent.trim();
                    if (txt && txt.length < 20 && !txt.includes('¥')) {
                        // Check class
                        if (prev.className && typeof prev.className === 'string' && (prev.className.includes('ItemLabel') || prev.className.includes('label'))) {
                            name = txt;
                            labelFound = true;
                            break;
                        }
                        // Check simple tag
                        if (prev.tagName === 'DT' || prev.tagName === 'LABEL' || prev.tagName === 'H4' || (prev.tagName === 'DIV' && txt.endsWith('：'))) {
                            name = txt.replace(/[:：]/g, '');
                            labelFound = true;
                            break;
                        }
                    }
                    prev = prev.previousElementSibling;
                    lookback--;
                }

                // 2. Grandparent search (if parent is just a wrapper for the list)
                if (!labelFound) {
                    const grandParent = parentContainer.parentElement;
                    if (grandParent) {
                        const labelEl = grandParent.querySelector('[class*="ItemLabel--"] span, [class*="ItemLabel--"], .label, dt');
                        if (labelEl) {
                            name = labelEl.textContent.trim();
                            labelFound = true;
                        } else {
                            // First child of grandparent might be label if it's not the container itself
                            const first = grandParent.firstElementChild;
                            if (first && first !== parentContainer && first.textContent.length < 20 && !first.querySelector('img')) {
                                name = first.textContent.trim().replace(/[:：]/g, '');
                                labelFound = true;
                            }
                        }
                    }
                }

                const values = [];
                for (const item of items) {
                    const textEl = item.querySelector('[class*="valueItemText--"]');
                    const imgEl = item.querySelector('[class*="valueItemImg--"] img, img[class*="valueItemImg--"]');

                    let disabled = item.getAttribute('data-disabled') === 'true' ||
                        item.classList.contains('disabled') ||
                        (item.className && typeof item.className === 'string' && item.className.includes('isDisabled')) ||
                        (item.className && typeof item.className === 'string' && item.className.includes('disabled'));

                    if (!disabled && item.style.opacity && item.style.opacity < 1) disabled = true;

                    if (textEl) {
                        const valName = textEl.getAttribute('title') || textEl.textContent.trim();
                        let src = null;
                        if (imgEl) {
                            src = imgEl.src || imgEl.getAttribute('placeholder') || imgEl.getAttribute('data-src');
                            if (src) {
                                src = src.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
                                if (src.startsWith('//')) src = 'https:' + src;
                            }
                        }


                        // Start Interaction: Click and scrape price
                        let currentPrice = 0;
                        if (!disabled) {
                            try {
                                // 1. Scroll into view to ensure clickability
                                item.scrollIntoView({ behavior: 'instant', block: 'center' });

                                // 2. Click
                                item.click();

                                // 3. Wait slightly longer for React/Vue to update
                                await sleep(500);

                                // 4. Check if price updated (or just scrape whatever is there)
                                currentPrice = await this.stepExtractPrice();

                                // Retry click on text element if price seems invalid or 0, just in case
                                if (currentPrice === 0 && textEl) {
                                    textEl.click();
                                    await sleep(500);
                                    currentPrice = await this.stepExtractPrice();
                                }
                            } catch (e) {
                                console.warn('[Taobao] Click option failed', e);
                            }
                        }

                        values.push({
                            value: valName,
                            price: currentPrice,
                            stock: disabled ? 0 : 999,
                            imageUrl: src
                        });
                    }
                }

                if (values.length > 0) {
                    options.push({
                        name,
                        type: 'sku',
                        values: values.map(v => ({
                            text: v.value,
                            image: v.imageUrl,
                            price: v.price,
                            stock: v.stock,
                            value: v.value,
                            selected: false,
                            priceText: v.price > 0 ? `${v.price}` : null, // Placeholder
                            priceType: 'absolute'
                        }))
                    });
                }
            }

            return options;
        }

        // Strategy 2: Fallback (Legacy / Standard)
        const wrappers = document.querySelectorAll('.sku-property, .J_Prop, [class*="SkuContent--sku"], .tb-sku .tb-prop, dl, div[class*="prop-"]');
        for (const wrap of wrappers) {
            const label = wrap.querySelector('dt, [class*="SkuContent--label"], .tb-property-type, span[class*="label"], h4');
            const name = label ? label.textContent.replace(/[:：]/g, '').trim() : '옵션';

            const values = [];
            const items = wrap.querySelectorAll('li, dd li, [class*="SkuContent--value"]');

            for (const item of items) {
                if (item.classList.contains('tb-property-type')) continue;

                const span = item.querySelector('span');
                const valName = span ? span.textContent.trim() : item.textContent.trim();
                const img = item.querySelector('img');
                let src = img ? (img.src || img.getAttribute('data-src')) : null;
                if (src) src = src.replace(/_\d+x\d+.*$/, '');
                if (src && src.startsWith('//')) src = 'https:' + src;

                const disabled = item.classList.contains('disabled') || item.classList.contains('tb-out-of-stock');

                if (valName) {
                    let currentPrice = 0;
                    if (!disabled) {
                        try {
                            // Find clickable element (often 'a' tag inside 'li' for legacy)
                            const clickable = item.querySelector('a') || item;
                            if (clickable) {
                                if (clickable.scrollIntoView) clickable.scrollIntoView({ behavior: 'instant', block: 'center' });
                                clickable.click();
                                await sleep(500);
                                currentPrice = await this.stepExtractPrice();
                            }
                        } catch (e) { }
                    }

                    values.push({
                        value: valName,
                        price: currentPrice,
                        stock: disabled ? 0 : 999,
                        imageUrl: src
                    });
                }
            }

            if (values.length > 0) {
                options.push({
                    name,
                    type: 'sku',
                    values: values.map(v => ({
                        text: v.value,
                        image: v.imageUrl,
                        price: v.price,
                        stock: v.stock,
                        value: v.value,
                        selected: false,
                        priceText: v.price > 0 ? `${v.price}` : null,
                        priceType: 'absolute'
                    }))
                });
            }
        }

        /*
        // Strategy 3: Generic / Catch-all (for very new or obscure layouts)
        // Look for any grid-like structure that resembles options
        if (options.length === 0) {
            // Find all containers that look like property lines
            // Criteria: Has a label-like child and a value-list-like child
            const allDivs = document.querySelectorAll('div, dl, ul');

            for (const wrap of allDivs) {
                // Must not be too big
                if (wrap.childElementCount > 20) continue;

                // Check direct children for list of items
                const validChildren = Array.from(wrap.children).filter(c => {
                    const s = window.getComputedStyle(c);
                    return s.display !== 'none' && s.visibility !== 'hidden';
                });

                if (validChildren.length < 2) continue;

                // Identify if this looks like an option group
                // Often: Label (static) + List of clickable items (float or flex)

                // 1. Try to find label
                let name = null;
                const firstChild = validChildren[0];
                if (firstChild.tagName.match(/DT|LABEL|SPAN|H\d/) && firstChild.textContent.length < 10) {
                    name = firstChild.textContent.trim().replace(/[:：]/g, '');
                }

                if (!name) {
                    // Look strictly above?
                    const prev = wrap.previousElementSibling;
                    if (prev && prev.textContent.length < 20 && prev.tagName.match(/DIV|P|DT/)) {
                        name = prev.textContent.trim().replace(/[:：]/g, '');
                    }
                }

                if (!name) continue; // Must have a name to be an option group

                const values = [];
                // Process only likely option items (exclude the label itself)
                const candidateItems = validChildren.filter(c => c !== firstChild);

                // If candidate items are wrapped in a single container, unwrap them
                let finalItems = candidateItems;
                if (candidateItems.length === 1 && candidateItems[0].childElementCount > 1) {
                    finalItems = Array.from(candidateItems[0].children);
                }

                for (const item of finalItems) {
                    const txt = item.textContent.trim();
                    if (!txt && !item.querySelector('img')) continue;

                    // Must look interactive (border, pointer, or specific styling)
                    const style = window.getComputedStyle(item);
                    // Simple heuristic: Borders often mean buttons
                    const hasBorder = style.borderWidth !== '0px';
                    const hasCursor = style.cursor === 'pointer';
                    const hasImage = !!item.querySelector('img');

                    if (!hasBorder && !hasCursor && !hasImage && finalItems.length < 30) {
                        // Loose check
                    }

                    let disabled = item.classList.contains('disabled') || item.getAttribute('aria-disabled') === 'true';
                    if (!disabled && style.opacity < 0.5) disabled = true;
                    if (!disabled && style.color === 'rgb(204, 204, 204)') disabled = true; // Grayed out

                    // Image
                    const img = item.querySelector('img');
                    let src = img ? (img.src || img.getAttribute('data-src')) : null;
                    if (!src && item.style.backgroundImage) {
                        const bgMatch = item.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
                        if (bgMatch) src = bgMatch[1];
                    }
                    if (src) {
                        src = src.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
                        if (src.startsWith('//')) src = 'https:' + src;
                    }

                    let currentPrice = 0;
                    if (!disabled) {
                        try {
                            // Find the best clickable target
                            const targets = [
                                item.querySelector('a'),
                                item.querySelector('input'),
                                item.querySelector('img'), // sometimes image is the click target
                                item
                            ];
                            const clickable = targets.find(t => t); // First non-null

                            if (clickable) {
                                if (clickable.scrollIntoView) clickable.scrollIntoView({ behavior: 'instant', block: 'center' });
                                clickable.click();
                                await sleep(500);
                                currentPrice = await this.stepExtractPrice();
                            }
                        } catch (e) { }
                    }

                    values.push({
                        value: txt || name, // Fallback to group name + index if needed, but txt prefers
                        price: currentPrice,
                        stock: disabled ? 0 : 999,
                        imageUrl: src
                    });
                }

                if (values.length > 1) { // Needs at least 2 choices to be an option usually
                    if (!options.find(o => o.name === name)) {
                        options.push({ name, values });
                    }
                }
            }
        }
        */

        return options;
    }

    async stepExtractDescription() {
        const selectors = [
            '#imageTextInfo-content', // New high priority
            '.desc-root',            // New high priority
            '#J_DivDetailDesc',
            '[class*="Desc--desc"]',
            '.tb-detail',
            '#description'
        ];

        let el = null;
        for (const sel of selectors) {
            el = document.querySelector(sel);
            if (el) break;
        }

        if (!el) return { text: '', html: '', images: [] };

        // Fix images
        const imgs = el.querySelectorAll('img');
        const imgUrls = [];

        imgs.forEach(img => {
            // Priority: data-src -> data-ks-lazyload -> src
            // Also check for specific Taobao lazyload attributes
            const src = img.getAttribute('data-src') ||
                img.getAttribute('data-ks-lazyload') ||
                img.src; // Use property .src to get absolute URL if possible, but attribute 'src' might be lazy placeholder

            // Clean up source
            let fixedSrc = src;
            if (img.getAttribute('src') && img.getAttribute('src').includes('g.alicdn.com/s.gif')) {
                // It's a placeholder, definitely use data-src
                fixedSrc = img.getAttribute('data-src') || img.getAttribute('data-ks-lazyload');
            }

            if (fixedSrc && !fixedSrc.includes('assets.alicdn.com') && !fixedSrc.includes('g.alicdn.com/s.gif')) {
                if (fixedSrc.startsWith('//')) fixedSrc = 'https:' + fixedSrc;
                else if (fixedSrc.startsWith('/') && !fixedSrc.startsWith('http')) {
                    // Start relative path? unlikely for images usually full url or //
                    // But to be safe lets leave it if its just path
                }

                // Update the img element to point to real image
                img.setAttribute('src', fixedSrc);
                img.removeAttribute('data-src'); // Clean up
                img.style.display = 'block'; // Ensure visible
                imgUrls.push(fixedSrc);
            }
        });

        // specific cleanup for hotArea links which might be clutter
        // el.querySelectorAll('.descV8-hotArea').forEach(n => n.remove()); // Optional: decide if keeping links is ok. Usually mapping links are useless in scraped content.

        const cleanEl = el.cloneNode(true);
        // Remove strictly unnecessary tags
        cleanEl.querySelectorAll('script, style, link, .descV8-hotArea').forEach(n => n.remove());

        // Return outerHTML of the content wrapper to preserve structure
        return {
            text: cleanEl.textContent.trim(),
            html: cleanEl.innerHTML,
            images: imgUrls
        };
    }

    async stepExtractStock() {
        // Simple stock extraction from DOM
        const el = document.querySelector('.tb-amount, [class*="Stock--stock"]');
        if (el) {
            const txt = el.textContent.replace(/[^0-9]/g, '');
            if (txt) return parseInt(txt);
        }
        return 999;
    }

    async stepExtractCategory() {
        const els = document.querySelectorAll('.breadcrumb a, .crumb-wrap a');
        return Array.from(els).map(a => a.textContent.trim()).join(' > ');
    }

    async extractCurrency() {
        return 'CNY'; // Force CNY as per user request
    }

    async _legacy_extractCurrency() {
        // Strict Currency Check using the actual price element found
        try {
            if (this.priceElement) {
                // 1. Check the element itself
                let txt = this.priceElement.textContent.trim();
                if (txt.includes('₩') || txt.includes('KRW')) return 'KRW';
                if (txt.includes('$') || txt.includes('USD')) return 'USD';
                if (txt.includes('¥') || txt.includes('元') || txt.includes('CNY')) return 'CNY';

                // 2. Check the Parent
                const parent = this.priceElement.parentElement;
                if (parent) {
                    txt = parent.textContent.trim();
                    // Parent might contain shipping fee "0원", so be careful.
                    // Only accept KRW if it's explicitly the symbol ₩ or KRW code.
                    if (txt.includes('₩') || txt.includes('KRW')) return 'KRW';
                    if (txt.includes('$') || txt.includes('USD')) return 'USD';
                    if (txt.includes('¥') || txt.includes('元') || txt.includes('CNY')) return 'CNY';
                }

                // 3. Check Previous Sibling
                const prev = this.priceElement.previousElementSibling;
                if (prev) {
                    txt = prev.textContent.trim();
                    if (txt.includes('₩') || txt.includes('KRW')) return 'KRW';
                    if (txt.includes('$') || txt.includes('USD')) return 'USD';
                    if (txt.includes('¥') || txt.includes('元') || txt.includes('CNY')) return 'CNY';
                }
            } else {
                // Fallback if priceElement wasn't saved (e.g. stepExtractPrice wasn't called or failed)
                // Do a safe scan for specific currency classes
                const currencyEls = document.querySelectorAll('[class*="Price--currency"], [class*="priceCurrency"], .tb-rmb');
                for (const el of currencyEls) {
                    const txt = el.textContent.trim();
                    if (txt.match(/^[¥￥元]$/)) return 'CNY'; // Strict match
                }
            }
        } catch (e) { }

        return 'CNY'; // Default for Taobao
    }

    async scrollForSpecs() {
        return new Promise(resolve => {
            // Try to find the spec header or container to scroll to
            const specTarget = document.querySelector('[class*="paramsInfoArea"]') ||
                document.querySelector('[class*="paramsWrap--"]') ||
                Array.from(document.querySelectorAll('div, h4, th')).find(el =>
                    (el.textContent.includes('参数信息') || el.textContent.includes('产品参数')) && el.offsetParent !== null
                );

            if (specTarget) {
                specTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
            } else {
                // Even if we don't find the scroll target, we should still try to poll
                // because it might appear later or be somewhere we missed scrolling to
            }

            // POLLING: Wait until spec items appear in the DOM
            // We use the verified classes from our browser session
            let attempts = 0;
            const maxAttempts = 25; // 25 * 200ms = 5 seconds
            const interval = setInterval(() => {
                attempts++;
                const empItems = document.querySelectorAll('[class*="emphasisParamsInfoItem--"]');
                const genItems = document.querySelectorAll('[class*="generalParamsInfoItem--"]');

                if (empItems.length > 0 || genItems.length > 0) {
                    clearInterval(interval);
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(interval);
                    resolve(); // Give up waiting
                }
            }, 200);
        });
    }
}

// Add to global window for browser extension availability
if (typeof window !== 'undefined') {
    window.TaobaoParser = TaobaoParser;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaobaoParser;
}
