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
            videos: video,
            platform: this.platform,
            url: window.location.href,
            collectedAt: new Date().toISOString()
        };
    }

    // --- Step Implementations ---

    async stepLoadJsonData() {
        try {
            this.jsonData = null;
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent.trim();
                // Loose Regex match for __INITIAL_DATA__
                if (content.includes('__INITIAL_DATA__')) {
                    const match = content.match(/__INITIAL_DATA__\s*=\s*({[\s\S]+?});/);
                    if (match && match[1]) {
                        this.jsonData = JSON.parse(match[1]);
                        return;
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

        // 1. DOM - Thumbnails (Best source usually)
        const thumbSelectors = ['[class*="Image--thumbnails"] img', '#J_UlThumb li img', '.tb-thumb li img'];
        for (const sel of thumbSelectors) {
            const thumbs = document.querySelectorAll(sel);
            if (thumbs.length > 0) {
                thumbs.forEach(img => {
                    let src = img.src || img.getAttribute('data-src');
                    if (src) {
                        // Cleanup
                        src = src.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
                        if (src.startsWith('//')) src = 'https:' + src;
                        if (!images.includes(src)) images.push(src);
                    }
                });
            }
        }

        // 2. DOM - Main Image (If no thumbs found)
        if (images.length === 0) {
            const main = document.querySelector('[class*="Image--mainImage"] img, #J_ImgBooth');
            if (main) {
                let src = main.src;
                src = src.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
                if (src.startsWith('//')) src = 'https:' + src;
                images.push(src);
            }
        }

        // 3. JSON Backup
        if (images.length === 0 && this.jsonData) {
            const item = this.jsonData.item || (this.jsonData.data && this.jsonData.data.item);
            if (item && item.images && Array.isArray(item.images)) {
                images = item.images.map(url => url.startsWith('http') ? url : (url.startsWith('//') ? 'https:' + url : url));
            }
        }

        return images.slice(0, 20); // Limit
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
            const skuBase = this.jsonData.skuBase || (this.jsonData.data && this.jsonData.data.skuBase);
            if (skuBase && skuBase.props && skuBase.skus) {
                const combined = this.processSkuBase(skuBase);
                if (combined) return combined;
            }
        }

        // 2. Fallback to DOM (List of buttons)
        return this.extractOptionsFromDOM();
    }

    processSkuBase(skuBase) {
        try {
            // Needed for Price/Stock mapping
            let skuMap = {};
            if (this.jsonData.apiStack && this.jsonData.apiStack[0]) {
                try {
                    const api = JSON.parse(this.jsonData.apiStack[0].value);
                    if (api.skuCore && api.skuCore.sku2info) skuMap = api.skuCore.sku2info;
                    else if (api.data && api.data.skuModel) skuMap = api.data.skuModel.skus || {};
                } catch (e) { }
            }

            const propMap = {};
            skuBase.props.forEach(p => {
                p.values.forEach(v => {
                    propMap[v.vid] = { name: v.name, image: v.image };
                });
            });

            const skuList = [];
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
        // Fallback: Just grab the buttons visible on screen
        const options = [];
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
                const src = img ? img.src.replace(/_\d+x\d+.*$/, '') : null;
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

        if (!el) return { text: '', html: '' };

        // Fix images
        const imgs = el.querySelectorAll('img');
        const imgUrls = [];
        imgs.forEach(img => {
            const src = img.getAttribute('data-src') || img.getAttribute('data-ks-lazyload') || img.getAttribute('src');
            if (src && !src.includes('assets.alicdn.com')) {
                let fixedSrc = src;
                if (fixedSrc.startsWith('//')) fixedSrc = 'https:' + fixedSrc;
                img.setAttribute('src', fixedSrc);
                img.style.display = 'block'; // Ensure visible
                imgUrls.push(fixedSrc);
            }
        });

        const cleanEl = el.cloneNode(true);
        // Remove strictly unnecessary tags
        cleanEl.querySelectorAll('script, style, link').forEach(n => n.remove());

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

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaobaoParser;
}
