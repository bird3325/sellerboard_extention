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

        // Strategy 0: JSON Data (Highest fidelity)
        if (this.jsonData) {
            const groupProps = this.jsonData.groupProps ||
                (this.jsonData.data && this.jsonData.data.groupProps) ||
                (this.jsonData.mock && this.jsonData.mock.groupProps);
            if (groupProps && groupProps[0] && groupProps[0].groupName) {
                groupProps.forEach(group => {
                    if (group.props) {
                        group.props.forEach(p => addSpec(p.name, p.value));
                    }
                });
            }
            const props = this.jsonData.props || (this.jsonData.item && this.jsonData.item.props);
            if (props && Array.isArray(props)) {
                props.forEach(p => addSpec(p.name, p.value));
            }
        }

        // Strategy 1: Direct DOM Scraping based on User HTML structure
        // We use specific substring matchers for the container classes provided.
        // We DO NOT rely on inner class names (Title/SubTitle) but on DOM Position (Child 0 vs 1).

        // 1. Emphasis Items (e.g. "High Carbon Steel" - value is emphasized/top)
        // HTML: <div class="emphasisParamsInfoItem--..."><div ...Title">Value</div><div ...SubTitle">Key</div></div>
        const empItems = document.querySelectorAll('[class*="emphasisParamsInfoItem--"]');
        empItems.forEach(item => {
            if (item.children.length >= 2) {
                // Child 0 is Title (Value in this context)
                // Child 1 is SubTitle (Key in this context)
                const valNode = item.children[0];
                const keyNode = item.children[1];

                const val = valNode.getAttribute('title') || valNode.textContent;
                const key = keyNode.getAttribute('title') || keyNode.textContent;

                addSpec(key, val);
            }
        });

        // 2. General Items (e.g. "Brand: WuQiBao" - standard list)
        // HTML: <div class="generalParamsInfoItem--..."><div ...Title">Key</div><div ...SubTitle">Value</div></div>
        const genItems = document.querySelectorAll('[class*="generalParamsInfoItem--"]');
        genItems.forEach(item => {
            if (item.children.length >= 2) {
                // Child 0 is Title (Key in this context)
                // Child 1 is SubTitle (Value in this context)
                const keyNode = item.children[0];
                const valNode = item.children[1];

                const key = keyNode.getAttribute('title') || keyNode.textContent;
                const val = valNode.getAttribute('title') || valNode.textContent;

                addSpec(key, val);
            }
        });

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

    async stepLoadJsonData() {
        try {
            this.jsonData = null;
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent.trim();

                // 1. _DATA_Detail (Common in mobile/H5/modern PC)
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
        const selectors = [
            '[class*="Price--priceText"]', // Modern
            '.price-now',
            '.tm-price',
            '.tb-rmb-num',
            '[class*="extraPrice"]' // Discounted
        ];

        for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                const txt = el.textContent.trim();
                // Filter out empty or non-price strings
                if (txt && /\d/.test(txt)) {
                    const p = this.parsePrice(txt);
                    if (p > 0) return p;
                }
            }
        }

        // 2. JSON
        if (this.jsonData) {
            try {
                // Try deep path
                const mock = this.jsonData.mock;
                if (mock && mock.price && mock.price.price && mock.price.price.priceText) {
                    return this.parsePrice(mock.price.price.priceText);
                }
                const apiStack = this.jsonData.apiStack;
                if (apiStack && apiStack[0] && apiStack[0].value) {
                    const api = JSON.parse(apiStack[0].value);
                    if (api.price && api.price.price && api.price.price.priceText) {
                        return this.parsePrice(api.price.price.priceText);
                    }
                }
            } catch (e) { }
        }

        return 0;
    }

    async stepExtractOptions() {
        // 1. Attempt JSON SKU Mapping (Best Quality)
        if (this.jsonData) {
            // Path strategies for skuBase
            const skuBase = this.jsonData.skuBase ||
                (this.jsonData.data && this.jsonData.data.skuBase) ||
                (this.jsonData.mock && this.jsonData.mock.skuBase);

            if (skuBase && skuBase.props && skuBase.skus) {
                const combined = this.processSkuBase(skuBase);
                if (combined) return combined;
            }
        }

        // 2. DOM - Scroll and Scrape
        // The user indicated options are in the "right area" and might need scrolling.
        await this.scrollSkuPanel();

        return this.extractOptionsFromDOM();
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

    extractOptionsFromDOM() {
        const options = [];

        // Strategy 1: User specific structure - Bottom-Up Approach
        // Instead of looking for wrapper first, we look for values and group them by parent.
        // This is robust against wrapper class name changes.
        const allValueItems = document.querySelectorAll('[class*="valueItem--"]');

        if (allValueItems.length > 0) {
            // Group by parent container (the "row")
            const rows = new Map();
            allValueItems.forEach(item => {
                const parent = item.parentElement;
                if (!rows.has(parent)) rows.set(parent, []);
                rows.get(parent).push(item);
            });

            rows.forEach((items, parentContainer) => {
                // Try to find Label
                // 1. Look for Label inside the parent's parent (Grandparent usually holds Label + Content)
                // structure: <div class="skuItem--..."> <div class="label">...</div> <div class="content">...values...</div> </div>
                let name = '옵션';
                let labelFound = false;

                // Check Grandparent
                const grandParent = parentContainer.parentElement;
                if (grandParent) {
                    const labelEl = grandParent.querySelector('[class*="ItemLabel--"] span, [class*="ItemLabel--"]');
                    if (labelEl) {
                        name = labelEl.textContent.trim();
                        labelFound = true;
                    }
                }

                // If not found, check siblings of parentContainer
                if (!labelFound) {
                    let prev = parentContainer.previousElementSibling;
                    while (prev) {
                        if (prev.className && typeof prev.className === 'string' && prev.className.includes('ItemLabel')) {
                            name = prev.textContent.trim();
                            break;
                        }
                        prev = prev.previousElementSibling;
                    }
                }

                const values = [];
                items.forEach(item => {
                    const textEl = item.querySelector('[class*="valueItemText--"]');
                    const imgEl = item.querySelector('[class*="valueItemImg--"] img, img[class*="valueItemImg--"]');

                    // Check disabled state via class or data attribute
                    let disabled = item.getAttribute('data-disabled') === 'true' ||
                        item.classList.contains('disabled') ||
                        (item.className && typeof item.className === 'string' && item.className.includes('isDisabled')) ||
                        (item.className && typeof item.className === 'string' && item.className.includes('disabled'));

                    // Fallback to style check (often used in Taobao)
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

                        values.push({
                            value: valName,
                            price: 0,
                            stock: disabled ? 0 : 999,
                            imageUrl: src
                        });
                    }
                });

                if (values.length > 0) {
                    options.push({ name, values });
                }
            });

            return options;
        }

        // Strategy 2: Fallback (Legacy / Standard)
        const wrappers = document.querySelectorAll('.sku-property, .J_Prop, [class*="SkuContent--sku"], .tb-sku .tb-prop');
        wrappers.forEach(wrap => {
            const label = wrap.querySelector('dt, [class*="SkuContent--label"], .tb-property-type');
            const name = label ? label.textContent.replace(':', '').trim() : '옵션';

            const values = [];
            const items = wrap.querySelectorAll('li, dd li, [class*="SkuContent--value"]');

            items.forEach(item => {
                if (item.classList.contains('tb-property-type')) return; // skip label

                const span = item.querySelector('span');
                const valName = span ? span.textContent.trim() : item.textContent.trim();
                const img = item.querySelector('img');
                let src = img ? (img.src || img.getAttribute('data-src')) : null;
                if (src) src = src.replace(/_\d+x\d+.*$/, '');
                if (src && src.startsWith('//')) src = 'https:' + src;

                const disabled = item.classList.contains('disabled') || item.classList.contains('tb-out-of-stock');

                if (valName) {
                    values.push({
                        value: valName,
                        price: 0, // Unknown
                        stock: disabled ? 0 : 999,
                        imageUrl: src
                    });
                }
            });

            if (values.length > 0) {
                options.push({ name, values });
            }
        });

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
}

// Add to global window for browser extension availability
if (typeof window !== 'undefined') {
    window.TaobaoParser = TaobaoParser;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaobaoParser;
}
