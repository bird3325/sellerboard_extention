/**
 * 기본 파서 클래스
 * 모든 플랫폼 파서가 상속받아야 하는 추상 클래스
 */

class BaseParser {
    constructor(platform) {
        this.platform = platform;
        this.selectors = this.getSelectors();
    }

    /**
     * 플랫폼별 CSS 선택자 반환
     * 각 파서에서 구현 필수
     * @returns {Object} CSS 선택자 객체
     */
    getSelectors() {
        throw new Error('getSelectors() must be implemented by subclass');
    }

    /**
     * 상품 정보 전체 파싱
     * @returns {Promise<Object>} 파싱된 상품 정보
     */
    async parseProduct() {
        try {


            // Lazy Loading 콘텐츠 로드를 위한 스크롤
            await this.scrollToLoadContent();

            const product = {
                name: await this.extractName(),
                price: await this.extractPrice(),
                images: await this.extractImages(),
                options: await this.extractOptions(),
                description: await this.extractDescription(),
                stock: await this.extractStock(),
                shipping: await this.extractShipping(),
                specs: await this.extractSpecs(),
                category: await this.extractCategory(),
                videos: await this.extractVideos(), // 비디오 추출 추가
                platformMetadata: await this.extractPlatformSpecificData(),

                // 메타 정보
                platform: this.platform,
                url: window.location.href,
                collectedAt: new Date().toISOString()
            };

            // 옵션이 없는 경우 기본 옵션 생성 (단일 상품)
            if (product.options.length === 0) {

                product.options.push({
                    name: '기본',
                    values: [{
                        value: '단품',
                        price: product.price,
                        stock: product.stock
                    }]
                });
            } else {
                // 옵션이 있지만 가격이 0인 경우 메인 가격으로 채움 (선택적)
                product.options.forEach(group => {
                    group.values.forEach(val => {
                        if (val.price === 0 && product.price > 0) {
                            // 옵션별 가격 차이가 0인 경우(즉, 기본가와 동일)가 아니라
                            // 절대 가격이 필요한 경우 메인 가격+차액 로직이 필요할 수 있음.
                            // 여기서는 단순히 '추가금' 개념이 0인 것은 정상이므로 패스.
                            // 만약 절대 가격이 필요한 구조라면 로직 수정 필요.
                        }
                    });
                });
            }


            return product;
        } catch (error) {
            console.error(`[${this.platform}] Parsing error:`, error);
            throw error;
        }
    }

    /**
     * Lazy Loading 콘텐츠 로드를 위해 스크롤
     */
    async scrollToLoadContent() {


        // 1. 전체 페이지 점진적 스크롤
        const totalHeight = document.body.scrollHeight;
        const steps = 3;
        const stepSize = totalHeight / steps;

        for (let i = 0; i <= steps; i++) {
            const currentScroll = i * stepSize;
            window.scrollTo({
                top: currentScroll,
                behavior: 'instant'
            });
            await this.wait(200);
        }

        // 2. 상세 설명 영역으로 명시적 스크롤 (선택자가 있는 경우)
        if (this.selectors && this.selectors.description) {
            const selector = this.selectors.description;
            const el = document.querySelector(selector);
            if (el) {

                el.scrollIntoView({ behavior: 'instant', block: 'start' });
                await this.wait(800); // 상세 설명 로딩 대기

                // 상세 설명 내부에서도 조금씩 스크롤
                if (el.scrollHeight > 1000) {
                    el.scrollBy({ top: 500, behavior: 'instant' });
                    await this.wait(300);
                }
            }
        }

        // 3. 다시 상단으로 이동 (필요한 경우)
        window.scrollTo({ top: 0, behavior: 'instant' });


    }

    /**
     * 상품명 추출
     * @returns {Promise<string>}
     */
    async extractName() {
        const selector = this.selectors.name;
        if (!selector) throw new Error('Name selector not defined');

        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : '';
    }

    /**
     * 가격 추출
     * @returns {Promise<number>}
     */
    async extractPrice() {
        const selectors = this.selectors.price;
        if (!selectors) throw new Error('Price selector not defined');

        // 선택자가 배열인 경우 순차적으로 시도
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];

        for (const selector of selectorList) {
            const elements = document.querySelectorAll(selector);

            for (const element of elements) {
                if (!element) continue;

                // 가시성 확인 (옵션)
                if (element.offsetParent === null) continue;

                const priceText = element.textContent.trim();

                const price = this.parsePrice(priceText);

                if (price > 0) return price;
            }
        }

        // 2. Fallback: 메타 태그 검색
        const metaPrice = document.querySelector('meta[property="og:price:amount"], meta[itemprop="price"]');
        if (metaPrice) {
            const price = this.parsePrice(metaPrice.content);
            if (price > 0) {

                return price;
            }
        }

        // 3. Last Resort: 페이지 전체에서 가격 패턴 검색 (가장 큰 숫자 또는 빈도수 높은 패턴)
        // 주의: 날짜나 전화번호를 가격으로 오인할 수 있으므로 보수적으로 접근

        try {
            // "원" 또는 "$" 주변의 숫자를 찾음
            // "원", "$", "¥" 주변의 숫자를 찾음
            const bodyText = document.body.innerText;
            // 1. KRW (100원~)
            // 2. USD/CNY/JPY ($10.99, ¥100, 100元)
            const priceRegex = /([0-9,]+)(?:원|\s*KW|\s*KRW)|(?:US\s*)?\$([0-9,]+\.?\d*)|(?:CNY|JP\s*)?¥([0-9,]+\.?\d*)|([0-9,]+\.?\d*)\s*元/g;
            let match;
            const foundPrices = [];

            while ((match = priceRegex.exec(bodyText)) !== null) {
                const rawNum = match[1] || match[2] || match[3] || match[4];
                const isKRW = !!match[1];
                const val = parseFloat(rawNum.replace(/,/g, ''));

                if (isKRW) {
                    // 원화: 100원 이상
                    if (val >= 100 && val < 50000000) {
                        foundPrices.push(val);
                    }
                } else {
                    // 달러/위안 등: 0.01 이상
                    if (val >= 0.01 && val < 100000) {
                        foundPrices.push(val);
                    }
                }
            }

            if (foundPrices.length > 0) {
                // 가장 많이 등장한 가격 또는 중간값 등을 사용할 수 있으나, 
                // 보통 상품 페이지 상단에 노출된 가격이 중요하므로 첫 번째 유효값을 쓰거나
                // 빈도 분석을 함. 여기서는 단순히 첫 번째 유효값(상단)을 선택하거나,
                // 가장 그럴듯한(빈도가 높은) 값을 선택.

                // 간단히 첫 5개 중 최빈값 선택
                const candidates = foundPrices.slice(0, 10);
                const modeMap = {};
                let maxEl = candidates[0], maxCount = 1;

                for (let i = 0; i < candidates.length; i++) {
                    const el = candidates[i];
                    if (modeMap[el] == null) modeMap[el] = 1;
                    else modeMap[el]++;
                    if (modeMap[el] > maxCount) {
                        maxEl = el;
                        maxCount = modeMap[el];
                    }
                }

                return maxEl;
            }
        } catch (e) {
            console.error('Deep price search failed:', e);
        }

        return 0;
    }

    /**
     * 이미지 URL 추출
     * @returns {Promise<string[]>}
     */
    async extractImages() {
        const selector = this.selectors.images;
        if (!selector) return [];

        const elements = document.querySelectorAll(selector);
        const images = [];

        elements.forEach(el => {
            const src = el.src || el.dataset.src || el.getAttribute('data-original');
            if (src && !images.includes(src)) {
                images.push(src);
            }
        });

        return images;
    }

    /**
     * 비디오 URL 추출
     * @returns {Promise<string[]>}
     */
    async extractVideos() {
        const selector = this.selectors.videos;
        if (!selector) return [];

        const elements = document.querySelectorAll(selector);
        const videos = [];

        elements.forEach(el => {
            const src = el.src || el.dataset.src || el.getAttribute('data-original') || el.querySelector('source')?.src;
            if (src && !videos.includes(src)) {
                videos.push(src);
            }
        });

        // video 태그 직접 탐색
        document.querySelectorAll('video').forEach(v => {
            const src = v.src || v.querySelector('source')?.src;
            if (src && !videos.includes(src) && src.startsWith('http')) {
                videos.push(src);
            }
        });

        return videos;
    }

    /**
     * 옵션 추출
     * @returns {Promise<Array>}
     */
    async extractOptions() {
        // 각 플랫폼에서 구현
        return [];
    }

    /**
     * 상세 설명 추출
     * @returns {Promise<Object>}
     */
    async extractDescription() {
        const selector = this.selectors.description;
        if (!selector) return { text: '', html: '' };

        const element = document.querySelector(selector);
        if (!element) return { text: '', html: '' };

        return {
            text: element.textContent.trim(),
            html: element.innerHTML
        };
    }

    /**
     * 재고 상태 추출
     * @returns {Promise<string>}
     */
    async extractStock() {
        const selector = this.selectors.stock;
        if (!selector) return 'unknown';

        const element = document.querySelector(selector);
        if (!element) return 'unknown';

        const text = element.textContent.toLowerCase();

        if (text.includes('품절') || text.includes('sold out')) {
            return 'out_of_stock';
        } else if (text.includes('재고') || text.includes('in stock')) {
            return 'in_stock';
        }

        // 품절 문구가 없고 가격이 존재하면 재고 있음으로 간주
        const price = await this.extractPrice();
        if (price > 0) {
            // 메타 데이터 추가 확인 (Schema.org)
            const availability = document.querySelector('meta[itemprop="availability"]');
            if (availability && availability.content) {
                if (availability.content.includes('OutOfStock') || availability.content.includes('SoldOut')) {
                    return 'out_of_stock';
                }
            }
            return 'in_stock';
        }

        return 'unknown';
    }

    /**
     * 배송 정보 추출
     * @returns {Promise<Object>}
     */
    async extractShipping() {
        // 각 플랫폼에서 구현
        return {};
    }

    /**
     * 제품 사양 추출
     * @returns {Promise<Object>}
     */
    async extractSpecs() {
        // 각 플랫폼에서 구현
        return {};
    }

    /**
     * 카테고리 추출
     * @returns {Promise<string>}
     */
    async extractCategory() {
        const selector = this.selectors.category;
        if (!selector) return '';

        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : '';
    }

    /**
     * 플랫폼별 특화 데이터 추출
     * @returns {Promise<Object>}
     */
    async extractPlatformSpecificData() {
        return {};
    }

    /**
     * 가격 문자열을 숫자로 변환
     * @param {string} priceText - 가격 문자열
     * @returns {number} 숫자로 변환된 가격
     */
    parsePrice(priceText) {
        if (!priceText) return 0;

        // 1. 퍼센트 패턴 (%와 결합된 숫자) 제거 - 할인율 오인 방지
        let cleaned = priceText.replace(/\d+(?:\.\d+)?%/g, '');

        // 2. 숫자가 아닌 문자 제거 (단, . 은 소수점으로 유지)
        cleaned = cleaned.replace(/[^\d.]/g, '');

        const price = parseFloat(cleaned);
        return isNaN(price) ? 0 : price;
    }

    /**
     * 대기 함수
     * @param {number} ms - 대기 시간 (밀리초)
     */
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 요소가 로드될 때까지 대기
     * @param {string} selector - CSS 선택자
     * @param {number} timeout - 타임아웃 (밀리초)
     * @returns {Promise<Element>}
     */
    waitForElement(selector, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element ${selector} not found within ${timeout}ms`));
            }, timeout);
        });
    }
    /**
     * 상품 링크 추출 (몰털이용)
     * @returns {Promise<string[]>}
     */
    async extractProductLinks() {
        const links = [];
        try {
            document.querySelectorAll('a[href]').forEach(a => {
                const h = a.href;
                // 일반적인 상품 URL 패턴
                if (h && (
                    h.includes('/item/') ||
                    h.includes('/product/') ||
                    h.includes('/goods/') ||
                    h.includes('/products/') ||
                    h.includes('smartstore.naver.com') && h.includes('/products/')
                )) {
                    links.push(h);
                }
            });
        } catch (e) {
            console.error('Link extraction failed:', e);
        }
        return [...new Set(links)];
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaseParser;
}
