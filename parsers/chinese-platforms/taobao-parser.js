/**
 * 타오바오 파서
 * Taobao 상품 페이지에서 정보 추출
 * TMall 겸용 (동일한 구조 공유)
 */

class TaobaoParser extends BaseParser {
    constructor() {
        super('taobao');
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

    async extractName() {
        await this.wait(1000);

        const selectors = [
            // Modern TMall/Taobao (React based)
            '[class*="ItemHeader--mainTitle"]',
            '[class*="ItemHeader--title"]',
            'h1[class*="title"]',

            // Legacy Taobao
            '.tb-main-title',
            'h3.tb-item-title',

            // Legacy TMall
            '.tb-detail-hd h1',

            // Generic Fallback
            'h1[data-title]',
            'h1'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim()) {
                return element.textContent.trim();
            }
        }

        return '商品名称未找到';
    }

    async extractPrice() {
        // 1. Modern Price Elements (React)
        const modernSelectors = [
            '[class*="Price--priceText"]',
            '[class*="Price--extraPrice"]',
            '[class*="Price--current"]'
        ];

        for (const selector of modernSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                // "¥ 29.9" 형식 등에서 숫자만 추출
                const price = this.parsePrice(element.textContent);
                if (price > 0) return price;
            }
        }

        // 2. Legacy Selectors
        const legacySelectors = [
            '.tb-rmb-num',      // Taobao
            '.tm-price',        // TMall (Original)
            '.price-now',       // Common
            '#J_PromoPriceNum', // Promo
            '#J_StrPriceModBox .tm-price'
        ];

        for (const selector of legacySelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const price = this.parsePrice(element.textContent);
                if (price > 0) return price;
            }
        }

        // 3. Price Range Handling (e.g. 100-200)
        const rangeEl = document.querySelector('.tb-range-price, [class*="Price--priceRange"]');
        if (rangeEl) {
            const match = rangeEl.textContent.match(/(\d+\.?\d*)/);
            if (match) return parseFloat(match[1]);
        }

        return 0;
    }

    async extractImages() {
        // 메인 이미지
        let mainImage = null;

        // Modern - Look for large image container
        const modernImg = document.querySelector('[class*="Image--mainImage"] img, [class*="MainPic--mainPic"] img');
        if (modernImg) {
            mainImage = modernImg.src;
        }

        // Legacy
        if (!mainImage) {
            const legacyImg = document.querySelector('#J_ImgBooth, .tb-booth img, #J_UlThumb img');
            if (legacyImg) {
                mainImage = legacyImg.src;
            }
        }

        // 고해상도 변환 (ex: _50x50.jpg -> _800x800.jpg or remove suffix)
        if (mainImage) {
            // 타오바오 이미지 URL 정리 ( _400x400.jpg 등 제거하여 원본 확보)
            mainImage = mainImage.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
        }

        // 추가 이미지 (썸네일)
        const images = mainImage ? [mainImage] : [];

        const thumbSelectors = [
            '[class*="Image--thumbnails"] img', // Modern
            '#J_UlThumb li img',                // Legacy Taobao
            '.tb-thumb li img'                  // Legacy Common
        ];

        for (const selector of thumbSelectors) {
            const thumbs = document.querySelectorAll(selector);
            if (thumbs.length > 0) {
                thumbs.forEach(img => {
                    let src = img.src || img.getAttribute('data-src');
                    if (src) {
                        // 원본 해상도로 변환
                        src = src.replace(/_\d+x\d+.*$/, '').replace(/_sum\.jpg$/, '');
                        if (!images.includes(src)) images.push(src);
                    }
                });
                break; // 한 그룹에서 찾으면 중단
            }
        }

        return images.slice(0, 10); // 최대 10장
    }

    async extractOptions() {
        const options = [];

        // Modern Selectors (SKU Properties)
        // React 컴포넌트 클래스명이 자주 바뀌므로 data- 속성이나 구조적 특징을 혼합 사용

        // Strategy 1: Look for Sku wrappers
        const skuWrappers = document.querySelectorAll('[class*="SkuContent--sku"], .tb-sku .tb-prop, .tm-clear.J_TSaleProp');

        skuWrappers.forEach(wrapper => {
            // 옵션명 추출
            const labelEl = wrapper.querySelector('dt, [class*="SkuContent--label"], .tb-property-type');
            let name = labelEl ? labelEl.textContent.replace(':', '').trim() : 'Option';

            // 옵션값 추출
            const values = [];
            const items = wrapper.querySelectorAll('dd li, [class*="SkuContent--value"]');

            items.forEach(item => {
                // 텍스트
                const textEl = item.querySelector('span') || item;
                const value = textEl.textContent.trim();

                // 이미지 (색상 옵션 등)
                const imgEl = item.querySelector('img');
                const imageUrl = imgEl ? imgEl.src.replace(/_\d+x\d+.*$/, '') : null;

                // 품절 여부
                const isOutOfStock = item.classList.contains('tb-out-of-stock') ||
                    item.classList.contains('disabled') ||
                    item.getAttribute('aria-disabled') === 'true';

                if (value) {
                    values.push({
                        value,
                        price: 0, // 옵션별 가격은 별도 로직 필요 (복잡도 높음)
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
            isTmall: window.location.hostname.includes('tmall'),
            location: ''
        };

        // 배송비 (Modern & Legacy)
        // "快递: 0.00" 또는 "免运费" 등을 찾음
        const shippingTexts = [
            document.querySelector('[class*="Delivery--delivery"]'), // Modern
            document.querySelector('.tb-postage'), // Legacy
            document.querySelector('.post-age-info') // Old
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

                // 배송지 추출 시도
                if (text.includes('从')) {
                    const parts = text.split('从');
                    if (parts.length > 1) {
                        shipping.location = parts[1].split('发货')[0].trim();
                    }
                }
                break;
            }
        }

        return shipping;
    }

    async extractSpecs() {
        const specs = {};

        // 상품 속성
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
        const stockEl = document.querySelector('.tb-amount, .tb-stock');
        if (stockEl) {
            const text = stockEl.textContent;

            if (text.includes('无货') || text.includes('已下架')) {
                return 'out_of_stock';
            }

            const match = text.match(/(\d+)/);
            if (match) {
                const stock = parseInt(match[1]);
                return stock > 0 ? 'in_stock' : 'out_of_stock';
            }
        }

        // 구매 버튼 상태
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
            monthSales: 0,  // 月销量
            seller: '',
            shopScore: 0,
            isTmall: false,
            wangwangId: '',  // 旺旺号
            currency: 'CNY'
        };

        // TMall 여부
        metadata.isTmall = window.location.hostname.includes('tmall') ||
            !!document.querySelector('.tm-logo, .tmall-logo');

        // 리뷰 수
        const reviewEl = document.querySelector('.tb-rate-counter, .rate-counter');
        if (reviewEl) {
            const reviewText = reviewEl.textContent.replace(/[^\d]/g, '');
            metadata.reviewCount = parseInt(reviewText) || 0;
        }

        // 평점
        const ratingEl = document.querySelector('.tb-rate-score, .rate-score');
        if (ratingEl) {
            metadata.rating = parseFloat(ratingEl.textContent) || 0;
        }

        // 월 판매량
        const salesEl = document.querySelector('.tb-sell-counter, .month-sell-count');
        if (salesEl) {
            const salesText = salesEl.textContent.replace(/[^\d]/g, '');
            metadata.monthSales = parseInt(salesText) || 0;
        }

        // 판매자 정보
        const sellerEl = document.querySelector('.tb-shop-name, .shop-name');
        if (sellerEl) {
            metadata.seller = sellerEl.textContent.trim();
        }

        // 상점 평점
        const shopScoreEl = document.querySelector('.tb-shop-rate, .shop-rate-score');
        if (shopScoreEl) {
            metadata.shopScore = parseFloat(shopScoreEl.textContent) || 0;
        }

        // 왕왕(wangwang) ID - 타오바오 메신저
        const wangwangEl = document.querySelector('.tb-wangwang, a[href*="wangwang"]');
        if (wangwangEl) {
            metadata.wangwangId = wangwangEl.getAttribute('data-nick') ||
                wangwangEl.textContent.trim();
        }

        return metadata;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TaobaoParser;
}
