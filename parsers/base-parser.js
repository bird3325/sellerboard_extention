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
            console.log(`[${this.platform}] Starting product parsing...`);

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
                platformMetadata: await this.extractPlatformSpecificData(),

                // 메타 정보
                platform: this.platform,
                url: window.location.href,
                collectedAt: new Date().toISOString()
            };

            console.log(`[${this.platform}] Parsing completed:`, product);
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
        console.log(`[${this.platform}] Scrolling to load content...`);

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
                console.log(`[${this.platform}] Scrolling to description: ${selector}`);
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

        console.log(`[${this.platform}] Scroll completed`);
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
        const selector = this.selectors.price;
        if (!selector) throw new Error('Price selector not defined');

        const element = document.querySelector(selector);
        if (!element) return 0;

        const priceText = element.textContent.trim();
        return this.parsePrice(priceText);
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
        // 숫자가 아닌 문자 제거
        const cleaned = priceText.replace(/[^\d.]/g, '');
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
