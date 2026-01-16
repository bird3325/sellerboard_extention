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

            // 옵션 추출 및 조합 처리
            let options = await this.extractOptions();
            if (options.length >= 2) {
                options = this.combineOptionGroups(options);
            }

            // 기본 가격 추출 (페이지 표시 가격)
            let pagePrice = await this.extractPrice();
            let finalPrice = pagePrice;

            // 옵션 중 최저가를 찾아 비교 (더 낮은 가격 선택)
            if (options && options.length > 0) {
                let minOptionPrice = -1;
                let hasValidOptionPrice = false;

                options.forEach(group => {
                    if (group.values) {
                        group.values.forEach(val => {
                            // 문자열일 경우 처리 (ex: "10.00")
                            const valPrice = typeof val.price === 'string' ? parseFloat(val.price.replace(/[^0-9.]/g, '')) : val.price;

                            if (valPrice !== undefined && valPrice !== null && !isNaN(valPrice) && valPrice > 0) {
                                if (minOptionPrice === -1 || valPrice < minOptionPrice) {
                                    minOptionPrice = valPrice;
                                    hasValidOptionPrice = true;
                                }
                            }
                        });
                    }
                });

                if (hasValidOptionPrice) {
                    // 페이지 가격이 0이거나, 옵션 최저가가 더 낮으면 교체
                    if (pagePrice <= 0 || minOptionPrice < pagePrice) {
                        finalPrice = minOptionPrice;
                    }
                }
            }

            const product = {
                name: await this.extractName(),
                price: finalPrice, // 최종 계산된 최저가 사용
                images: await this.extractImages(),
                options: options,
                description: await this.extractDescription(),
                stock: await this.extractStock(),
                shipping: await this.extractShipping(),
                specs: await this.extractSpecs(),
                category: await this.extractCategory(),
                currency: await this.extractCurrency(), // 화폐 단위 추가
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
     * 화폐 단위 추출
     * @returns {Promise<string>} 'KRW', 'USD', 'CNY', 'JPY' etc.
     */
    async extractCurrency() {
        // 1. 메타 데이터 확인 (og:price:currency)
        const metaCurrency = document.querySelector('meta[property="og:price:currency"], meta[itemprop="priceCurrency"]');
        if (metaCurrency && metaCurrency.content) {
            return metaCurrency.content.toUpperCase();
        }

        // 2. 가격 텍스트 패턴 분석
        try {
            const priceSelectors = this.selectors.price;
            const selectorList = Array.isArray(priceSelectors) ? priceSelectors : [priceSelectors];

            for (const sel of selectorList) {
                const el = document.querySelector(sel);
                if (el) {
                    const txt = el.textContent.trim();
                    // Symbol Priority
                    if (txt.includes('₩')) return 'KRW'; // Strict Won Symbol
                    if (txt.includes('$')) return 'USD';
                    if (txt.includes('¥') || txt.includes('元')) return 'CNY';

                    // Regex for "Number + 원" pattern (e.g. 1000원, 1,000 원)
                    if (/[\d,]+\s*원/.test(txt)) return 'KRW';

                    // Code Priority
                    if (txt.includes('KRW')) return 'KRW';
                    if (txt.includes('USD')) return 'USD';
                    if (txt.includes('CNY')) return 'CNY';
                    if (txt.includes('JPY')) return 'JPY';
                }
            }

            /*
            // 3. Body 텍스트 스캔 (보수적) - False Positive 위험으로 제거
            const bodyText = document.body.innerText.substring(0, 2000); // 상단만
            if (bodyText.includes('원') && !bodyText.includes('元')) return 'KRW';
            if (bodyText.includes('CNY') || bodyText.includes('元')) return 'CNY';
            */
        } catch (e) { }

        return 'UNK'; // Unknown
    }

    /**
     * 플랫폼별 특화 데이터 추출
     * @returns {Promise<Object>}
     */
    async extractPlatformSpecificData() {
        return {};
    }

    /**
     * 옵션 그룹 조합 (Cartesian Product)
     * @param {Array} groups - 옵션 그룹 배열
     * @returns {Array} 조합된 단일 옵션 그룹 배열
     */
    combineOptionGroups(groups) {
        if (!groups || groups.length === 0) return [];

        // 재귀함수: depth는 현재 처리 중인 그룹 인덱스
        const combine = (depth, currentPart) => {
            // 기저 사례: 모든 그룹을 순회했을 때
            if (depth === groups.length) {
                return [currentPart];
            }

            const group = groups[depth];
            // 값이 없는 그룹(빈 그룹) 처리: 건너뛰기
            if (!group.values || group.values.length === 0) {
                return combine(depth + 1, currentPart);
            }

            const results = [];

            // 현재 그룹의 모든 옵션 값 순회
            for (const option of group.values) {
                // 첫 번째 처리되는 그룹(유효한 값 있는)인지 확인
                const isFirst = (!currentPart.text && !currentPart.value);

                // 텍스트/값 처리 (text가 없으면 value 사용)
                const optText = option.text || option.value || '';
                const optValue = option.value || option.text || '';

                const newText = isFirst ? optText : `${currentPart.text} ${optText}`;
                const newValue = isFirst ? optValue : `${currentPart.value} ${optValue}`;

                // 가격: 하위 옵션 가격 우선 (없으면 상위 유지)
                let price = currentPart.price || 0;
                if (option.price !== undefined && option.price !== null && option.price !== 0) {
                    price = option.price;
                }

                // 재고: 하위 옵션 재고 우선
                let stock = currentPart.stock;
                if (option.stock !== undefined && option.stock !== null) {
                    stock = option.stock;
                }

                // 이미지: 하위 옵션 이미지 우선
                const optImage = option.image || option.imageUrl;
                let image = optImage || currentPart.image;

                // 병합된 객체 생성
                const merged = {
                    text: newText,
                    value: newValue,
                    price: price,
                    stock: stock,
                    image: image,
                    imageUrl: image // 일관성 유지
                };

                // 재귀 호출
                results.push(...combine(depth + 1, merged));
            }
            return results;
        };

        const combinedValues = combine(0, {});

        // 그룹 이름 합치기
        const combinedName = groups.map(g => g.name || '옵션').join(' / ');

        // 전체 재고 합계 계산
        const totalStock = combinedValues.reduce((sum, item) => {
            const s = typeof item.stock === 'number' ? item.stock : 0;
            return sum + s;
        }, 0);

        return [{
            name: combinedName,
            type: 'combination',
            values: combinedValues,
            totalStock: totalStock
        }];
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

    /**
     * 검색 결과 페이지에서 상품 리스트 데이터 추출 (Sourcing용)
     * @returns {Promise<Array>} { id, name, price, imageUrl, detailUrl, platform }
     */
    async extractSearchResults() {
        // 기본 구현: 링크만 수집하는 것이 아니라, 카드 단위로 정보를 긁어와야 함.
        // 각 플랫폼 파서에서 오버라이딩 권장.
        // 여기서는 Base 구현으로 "상품 링크"를 포함한 a 태그 주변에서 정보를 긁는 휴리스틱 적용.

        const items = [];
        const seenUrls = new Set();

        const productLinks = document.querySelectorAll('a[href]');

        for (const a of productLinks) {
            const h = a.href;
            if (!h || seenUrls.has(h)) continue;

            const isProduct = (
                h.includes('/item/') ||
                h.includes('/product/') ||
                h.includes('/goods/') ||
                h.includes('/products/') ||
                (h.includes('smartstore.naver.com') && h.includes('/products/'))
            );

            if (!isProduct) continue;

            // 이 a 태그가 "카드"의 일부라고 가정하고, 상위 요소를 탐색하며 컨텍스트 파악
            // 보통 카드 컨테이너는 div나 li
            const card = a.closest('div[class*="item"], li, div[class*="card"], div[class*="product"]');

            if (card) {
                // 카드 내에서 정보 추출
                let name = '';
                let price = 0;
                let imageUrl = '';

                // 1. 이름: card 내의 제목 요소
                const titleEl = card.querySelector('h1, h2, h3, h4, .title, .name, [class*="title"], [class*="name"');
                if (titleEl) name = titleEl.textContent.trim();
                if (!name) name = a.textContent.trim(); // a 태그 자체가 텍스트일 수 있음

                // 2. 가격
                const priceEl = card.querySelector('[class*="price"], span, strong, em');
                if (priceEl) {
                    // 가격 텍스트가 포함된 요소 찾기 (숫자 포함)
                    const potentialPrices = card.querySelectorAll('[class*="price"], span, strong, div');
                    for (const p of potentialPrices) {
                        const txt = p.textContent.trim();
                        if (/[0-9]/.test(txt) && (txt.includes('$') || txt.includes('won') || txt.includes('원') || txt.includes('¥'))) {
                            price = this.parsePrice(txt);
                            if (price > 0) break;
                        }
                    }
                }

                // 3. 이미지
                const img = card.querySelector('img');
                if (img) imageUrl = img.src || img.dataset.src;

                if (name && (price > 0 || imageUrl)) {
                    seenUrls.add(h);
                    items.push({
                        id: h, // URL을 ID로 사용
                        name: name,
                        price: price,
                        imageUrl: imageUrl,
                        detailUrl: h,
                        platform: this.platform
                    });
                }
            }
        }

        return items;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BaseParser;
}
