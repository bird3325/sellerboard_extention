/**
 * 타오바오 파서
 * Taobao 상품 페이지에서 정보 추출
 * TMall 겸용 (동일한 구조 공유)
 */

class TaobaoParser extends BaseParser {
    constructor() {
        super('taobao');
        this.jsonData = null;
    }

    getSelectors() {
        return {
            name: '[class*="ItemHeader--title"], .tb-main-title, h1',
            price: '[class*="Price--priceText"], .tb-rmb-num, .price-now',
            images: '[class*="Image--mainImage"], .tb-booth img',
            stock: '[class*="Stock--stock"], .tb-amount',
            description: '[class*="Desc--desc"], .tb-detail',
            category: '.breadcrumb, .crumb-wrap'
        };
    }

    async parseProduct() {
        // 데이터 추출 시도 (가장 먼저 실행)
        await this.extractJsonData();
        return super.parseProduct();
    }

    async extractJsonData() {
        try {
            this.jsonData = null;
            const scripts = document.querySelectorAll('script');

            for (const script of scripts) {
                const content = script.textContent.trim();

                // 1. New Taobao/Tmall (__INITIAL_DATA__)
                if (content.includes('__INITIAL_DATA__=')) {
                    try {
                        // JSON만 추출
                        const jsonStr = content.split('__INITIAL_DATA__=')[1].split(';')[0];
                        if (jsonStr) {
                            this.jsonData = JSON.parse(jsonStr);
                            // console.log('[Taobao] Found __INITIAL_DATA__');
                            return;
                        }
                    } catch (e) {
                        // console.error('[Taobao] JSON Parse Error (__INITIAL_DATA__)', e);
                    }
                }

                // 2. Old Taobao (g_config)
                if (content.includes('g_config =')) {
                    try {
                        // g_config 객체 파싱은 복잡하므로 필요한 부분만 정규식으로 추출 시도할 수 있음
                        // 하지만 보통 g_config에는 제한된 정보만 있음 (idata 등)
                        // 여기서는 스킵하거나 필요시 구현
                    } catch (e) { }
                }

                // 3. TShop Setup
                if (content.includes('TShop.Setup(')) {
                    try {
                        const match = content.match(/TShop\.Setup\((.*?)\);/s);
                        if (match && match[1]) {
                            this.jsonData = JSON.parse(match[1]);
                            // console.log('[Taobao] Found TShop.Setup');
                            return;
                        }
                    } catch (e) { }
                }
            }
        } catch (e) {
            console.error('[Taobao] JSON Extraction Failed', e);
        }
    }

    async extractName() {
        await this.wait(1000);

        // 1. JSON Data
        if (this.jsonData) {
            // 구조가 다양할 수 있으므로 안전하게 접근
            const item = this.jsonData.item || this.jsonData.itemDO || (this.jsonData.data && this.jsonData.data.item);
            if (item && item.title) return item.title;
        }

        // 2. Selectors (Fallback)
        const selectors = [
            '[class*="ItemHeader--mainTitle"]',
            '[class*="ItemHeader--title"]',
            'h1[class*="title"]',
            '.tb-main-title',
            'h3.tb-item-title',
            '.tb-detail-hd h1',
            'h1[data-title]',
            'h1'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element.textContent.trim();
            }
        }

        return 'Basic Product';
    }

    async extractPrice() {
        // 1. JSON Data
        if (this.jsonData) {
            const mock = this.jsonData.mock;
            if (mock && mock.price && mock.price.price && mock.price.price.priceText) {
                return this.parsePrice(mock.price.price.priceText);
            }

            const api = this.jsonData.api;
            // 복잡한 JSON 경로 탐색 필요...

            // TShop Model
            if (this.jsonData.detail && this.jsonData.detail.defaultItemPrice) {
                return this.parsePrice(this.jsonData.detail.defaultItemPrice);
            }
        }

        // 2. Selectors
        const modernSelectors = [
            '[class*="Price--priceText"]',
            '[class*="Price--extraPrice"]',
            '[class*="Price--current"]'
        ];

        for (const selector of modernSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const price = this.parsePrice(element.textContent);
                if (price > 0) return price;
            }
        }

        const legacySelectors = [
            '.tb-rmb-num',
            '.tm-price',
            '.price-now',
            '#J_PromoPriceNum',
            '#J_StrPriceModBox .tm-price'
        ];

        for (const selector of legacySelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const price = this.parsePrice(element.textContent);
                if (price > 0) return price;
            }
        }

        const rangeEl = document.querySelector('.tb-range-price, [class*="Price--priceRange"]');
        if (rangeEl) {
            const match = rangeEl.textContent.match(/(\d+\.?\d*)/);
            if (match) return parseFloat(match[1]);
        }

        return 0;
    }

    async extractImages() {
        // 1. JSON Data
        if (this.jsonData) {
            const item = this.jsonData.item || (this.jsonData.data && this.jsonData.data.item);
            if (item && item.images && Array.isArray(item.images)) {
                return item.images.map(url => {
                    if (!url.startsWith('http')) return 'https:' + url;
                    return url;
                });
            }

            // Property Pics
            if (this.jsonData.propertyPics && this.jsonData.propertyPics.default) {
                return this.jsonData.propertyPics.default;
            }
        }

        // 2. Selectors
        let mainImage = null;
        const modernImg = document.querySelector('[class*="Image--mainImage"] img, [class*="MainPic--mainPic"] img');
        if (modernImg) mainImage = modernImg.src;

        if (!mainImage) {
            const legacyImg = document.querySelector('#J_ImgBooth, .tb-booth img, #J_UlThumb img');
            if (legacyImg) mainImage = legacyImg.src;
        }

        if (mainImage) {
            mainImage = mainImage.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
        }

        const images = mainImage ? [mainImage] : [];
        const thumbSelectors = [
            '[class*="Image--thumbnails"] img',
            '#J_UlThumb li img',
            '.tb-thumb li img'
        ];

        for (const selector of thumbSelectors) {
            const thumbs = document.querySelectorAll(selector);
            if (thumbs.length > 0) {
                thumbs.forEach(img => {
                    let src = img.src || img.getAttribute('data-src');
                    if (src) {
                        src = src.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
                        if (!images.includes(src)) images.push(src);
                    }
                });
                break;
            }
        }

        return images.slice(0, 10);
    }

    async extractOptions() {
        const options = [];

        // 1. JSON Data (매우 강력)
        if (this.jsonData) {
            try {
                // skuBase 구조 (Modern)
                const skuBase = this.jsonData.skuBase || (this.jsonData.data && this.jsonData.data.skuBase);

                if (skuBase && skuBase.props) {
                    skuBase.props.forEach(prop => {
                        const name = prop.name;
                        const values = prop.values.map(v => {
                            return {
                                value: v.name,
                                image: v.image, // 이미지 포함될 수 있음
                                id: v.vid
                            };
                        });

                        // 재고 / 가격 매핑 정보 (skuBase.skus)
                        // 단, options 배열에는 "목록"만 넣고, 실제 가격 매핑은 조합 단계에서 처리해야 하는데,
                        // 현재 구조상 options에 가격을 넣을 수 있음 (선택 시 가격)
                        // 하지만 2-dimension 옵션의 경우 단순 가격 매핑이 어려움 (조합 필요)
                        // 여기서는 "목록"을 충실히 뽑아내고, 이미지 매핑에 집중

                        if (values.length > 0) {
                            // SkuMap에서 가격 정보 매핑 시도 (단순 매핑이 어려울 수 있음)
                            // 여기서는 값 목록만 생성
                            const optValues = values.map(v => {
                                const res = {
                                    value: v.value,
                                    stock: 'in_stock', // 기본값
                                    imageUrl: v.image
                                };
                                return res;
                            });
                            options.push({ name, values: optValues });
                        }
                    });

                    if (options.length > 0) return options;
                }
            } catch (e) {
                // JSON 파싱 실패 시 fallback
            }
        }

        // 2. DOM Selectors (Fallback)
        const skuWrappers = document.querySelectorAll('[class*="SkuContent--sku"], .tb-sku .tb-prop, .tm-clear.J_TSaleProp');

        skuWrappers.forEach(wrapper => {
            const labelEl = wrapper.querySelector('dt, [class*="SkuContent--label"], .tb-property-type');
            let name = labelEl ? labelEl.textContent.replace(':', '').trim() : 'Option';

            const values = [];
            const items = wrapper.querySelectorAll('dd li, [class*="SkuContent--value"]');

            items.forEach(item => {
                const textEl = item.querySelector('span') || item;
                const value = textEl.textContent.trim();
                const imgEl = item.querySelector('img');
                const imageUrl = imgEl ? imgEl.src.replace(/_\d+x\d+.*$/, '') : null;

                const isOutOfStock = item.classList.contains('tb-out-of-stock') ||
                    item.classList.contains('disabled') ||
                    item.getAttribute('aria-disabled') === 'true';

                if (value) {
                    values.push({
                        value,
                        price: 0,
                        stock: isOutOfStock ? 'out_of_stock' : 'in_stock',
                        imageUrl
                    });
                }
            });

            if (values.length > 0) {
                options.push({ name, values });
            }
        });

        return options;
    }

    async extractShipping() {
        const shipping = {
            fee: 0,
            freeThreshold: 0,
            type: 'standard',
            isTmall: window.location.hostname.includes('tmall')
        };

        // JSON 처리 생략 (배송비는 복잡한 로직이 많음)

        const shippingTexts = [
            document.querySelector('[class*="Delivery--delivery"]'),
            document.querySelector('.tb-postage'),
            document.querySelector('.post-age-info')
        ];

        for (const el of shippingTexts) {
            if (el) {
                const text = el.textContent.trim();
                if (text.includes('免运费') || text.includes('包邮')) {
                    shipping.fee = 0;
                    shipping.type = 'free';
                } else {
                    const match = text.match(/[\d.]+/);
                    if (match) {
                        shipping.fee = parseFloat(match[0]);
                    }
                }
                break;
            }
        }

        return shipping;
    }

    async extractSpecs() {
        const specs = {};

        // 1. JSON (props)
        if (this.jsonData) {
            const props = this.jsonData.props || (this.jsonData.data && this.jsonData.data.props);
            if (props && props.groupProps && props.groupProps[0] && props.groupProps[0].가) {
                // 구조가 매우 가변적임. 일단 DOM 방식 권장
            }
        }

        const specItems = document.querySelectorAll('.tb-property-type, .tb-detail-hd');
        specItems.forEach(item => {
            const label = item.querySelector('.tb-property-type');
            const value = item.querySelector('.tb-property-value');

            if (label && value) {
                const key = label.textContent.replace(':', '').trim();
                const val = value.textContent.trim();
                if (key && val) {
                    specs[key] = val;
                }
            }
        });

        return specs;
    }

    async extractStock() {
        // 1. JSON
        if (this.jsonData) {
            const quantity = this.jsonData.quantity || (this.jsonData.data && this.jsonData.data.quantity);
            if (quantity && quantity.total) {
                return quantity.total > 0 ? 'in_stock' : 'out_of_stock';
            }
        }

        const stockEl = document.querySelector('.tb-amount, .tb-stock');
        if (stockEl) {
            const text = stockEl.textContent;
            if (text.includes('无货') || text.includes('已下架')) return 'out_of_stock';
            const match = text.match(/(\d+)/);
            if (match) {
                const stock = parseInt(match[1]);
                return stock > 0 ? 'in_stock' : 'out_of_stock';
            }
        }

        const buyButton = document.querySelector('.tb-btn-buy, #J_LinkBuy');
        if (buyButton && buyButton.classList.contains('tb-disabled')) {
            return 'out_of_stock';
        }

        return 'in_stock';
    }

    async extractPlatformSpecificData() {
        const metadata = {
            reviewCount: 0,
            rating: 0,
            monthSales: 0,
            seller: '',
            shopScore: 0,
            isTmall: false,
            wangwangId: '',
            currency: 'CNY'
        };

        metadata.isTmall = window.location.hostname.includes('tmall') || !!document.querySelector('.tm-logo, .tmall-logo');

        if (this.jsonData) {
            const seller = this.jsonData.seller || (this.jsonData.data && this.jsonData.data.seller);
            if (seller) {
                metadata.seller = seller.shopName || seller.sellerNick;
                metadata.wangwangId = seller.sellerNick;
                metadata.shopScore = seller.evaluates ? parseFloat(seller.evaluates[0]?.score) : 0;
            }
        }

        // Fallback for DOM
        if (!metadata.seller) {
            const sellerEl = document.querySelector('.tb-shop-name, .shop-name');
            if (sellerEl) metadata.seller = sellerEl.textContent.trim();
        }

        const reviewEl = document.querySelector('.tb-rate-counter, .rate-counter');
        if (reviewEl) {
            const reviewText = reviewEl.textContent.replace(/[^\d]/g, '');
            metadata.reviewCount = parseInt(reviewText) || 0;
        }

        return metadata;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaobaoParser;
}
