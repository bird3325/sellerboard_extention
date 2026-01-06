/**
 * 범용 상품 데이터 파싱 유틸리티
 */

class ProductParser {
    constructor() {
        this.DEBUG = false; // 배포 시 false로 설정
        this.platformSelectors = {
            naver: {
                name: ['.productname_15188', '._2QpdnSKF4Y', '.product_title'],
                price: ['._1LY7DqCnwR', '.price_15191', '.total_price strong'],
                images: ['.image_more_view img', '._25CKxIKjAk img'],
                description: ['#INTRODUCE', '.detail_content'],
                category: ['.breadcrumb', '.category_path']
            },
            coupang: {
                name: ['.prod-buy-header__title'],
                price: ['.total-price strong'],
                images: ['.product-image-thumb img'],
                description: ['.product-detail'],
                category: ['.breadcrumbs']
            },
            aliexpress: {
                name: ['[class*="product-title"]', 'h1[class*="title"]'],
                price: ['[class*="product-price"]', '[class*="price-current"]'],
                images: [
                    '[class*="images-view"] img',
                    '.images-view-list img',
                    '.images-view-item img',
                    '.gallery-view img',
                    '.pdp-info-left .main-container img'
                ],
                description: [
                    // 실제 콘텐츠가 있는 내부 요소 우선!
                    '.detail-desc-decorate-richtext',
                    '.detailmodule_html',
                    '#product-description .detail-desc-decorate-richtext',
                    '#product-description .detailmodule_html',
                    '#product-description',
                    '.product-description',
                    '[data-pl="product-description"]',
                    '[class*="product-description"]',
                    '[class*="detail-desc"]'
                ],
                category: ['[class*="breadcrumb"]']
            },
            generic: {
                name: ['[itemprop="name"]', 'h1'],
                price: ['[itemprop="price"]', 'span[class*="price"]'],
                images: ['[itemprop="image"]', 'img'],
                description: ['.product-description', '#product-detail', '.detail'],
                category: ['.breadcrumb']
            }
        };
    }

    log(...args) {
        // console.log('[Parser]', ...args);
    }

    detectPlatform(url) {
        const h = new URL(url).hostname.toLowerCase();
        if (h.includes('smartstore.naver') || h.includes('shopping.naver')) return 'naver';
        if (h.includes('coupang.com')) return 'coupang';
        if (h.includes('aliexpress')) return 'aliexpress';
        return 'generic';
    }

    async extractProductData(url = window.location.href) {
        this.log('=== 상품 데이터 추출 시작 ===');

        // Lazy Loading 콘텐츠 로드를 위한 스크롤
        await this.scrollToLoadContent();

        const platform = this.detectPlatform(url);
        const sel = this.platformSelectors[platform];
        const name = this.extractText(sel.name) || this.extractNameFromTitle();
        const price = this.extractPrice(sel.price) || this.extractPriceFromPage();
        const images = this.extractAllImages(sel.images, platform);
        const options = await this.extractOptions();
        const description = await this.extractDetailedDescription(platform);
        const specs = await this.extractSpecifications(platform);

        this.log(`추출 완료 - 이미지:${images.length}, 옵션:${options.length}`);
        return {
            url,
            platform,
            name: name || '제목 없음',
            price,
            images,
            description,
            options,
            specs,
            stock: this.extractStock(platform),
            category: this.extractCategory(sel.category),
            collectedAt: new Date().toISOString(),
            metadata: {
                title: document.title,
                metaDescription: this.getMetaTag('description'),
                ogImage: this.getMetaTag('og:image')
            }
        };
    }

    async scrollToLoadContent() {
        this.log('🔄 Lazy Loading 콘텐츠 로드를 위해 스크롤 시작...');

        const totalHeight = document.body.scrollHeight;
        const viewportHeight = window.innerHeight;
        let currentScroll = 0;
        const steps = 3; // 스크롤 횟수 최적화 (5 -> 3)
        const stepSize = totalHeight / steps;

        // 1. 전체 페이지 점진적 스크롤 (속도 개선)
        for (let i = 0; i <= steps; i++) {
            currentScroll = i * stepSize;
            window.scrollTo({
                top: currentScroll,
                behavior: 'instant' // smooth -> instant로 변경하여 속도 향상
            });
            // 각 스크롤 단계마다 대기 (이미지 로딩 등)
            await new Promise(resolve => setTimeout(resolve, 200)); // 500ms -> 200ms
        }

        // 2. 상세 설명 영역으로 명시적 스크롤 (중요!)
        const platform = this.detectPlatform(window.location.href);
        const sel = this.platformSelectors[platform];

        if (sel && sel.description) {
            for (const selector of sel.description) {
                const el = document.querySelector(selector);
                if (el) {
                    this.log(`📍 상세 설명 영역 발견: ${selector}, 스크롤 이동`);
                    el.scrollIntoView({ behavior: 'instant', block: 'start' });
                    await new Promise(resolve => setTimeout(resolve, 800)); // 상세 설명 로딩 대기

                    // 상세 설명 내부에서도 조금씩 스크롤
                    const descHeight = el.scrollHeight;
                    if (descHeight > 1000) {
                        el.scrollBy({ top: 500, behavior: 'instant' });
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                    break;
                }
            }
        }

        this.log('✅ 스크롤 완료');
    }

    extractText(sels) {
        if (!sels) return null;
        for (const s of sels) {
            try {
                const el = document.querySelector(s);
                if (el && el.textContent.trim()) return el.textContent.trim();
            } catch (e) { }
        }
        return null;
    }

    extractPrice(sels) {
        const t = this.extractText(sels);
        return t ? this.parsePrice(t) : null;
    }

    extractPriceFromPage() {
        const m = document.body.innerText.match(/(\d{1,3}(?:,\d{3})+)원/);
        if (m) {
            const p = this.parsePrice(m[1]);
            if (p && p >= 100) return p;
        }
        return null;
    }

    parsePrice(text) {
        return parseFloat(text.replace(/[^0-9.]/g, ''));
    }

    extractNameFromTitle() {
        return document.title.split(' - ')[0].trim();
    }

    extractAllImages(sels, platform = 'generic') {
        const images = [];
        const seen = new Set();

        const addImg = (src, element = null) => {
            // 관련 상품 이미지 제외
            if (element && element.closest) {
                if (element.closest('[class*="related"]') ||
                    element.closest('[class*="recommend"]') ||
                    element.closest('[class*="suggestion"]') ||
                    element.closest('[class*="bottom-layer"]') ||
                    element.closest('[id*="related"]') ||
                    element.closest('[id*="recommend"]')) {
                    return;
                }
            }

            if (src && !src.includes('data:image')) {
                // AliExpress 이미지 고해상도 변환
                let finalSrc = src;
                if (src.includes('alicdn.com')) {
                    // 1. _50x50.jpg, _80x80.jpg, .jpg_640x640.jpg 등 패턴 제거
                    finalSrc = src.replace(/_(\d+x\d+)\.(jpg|png|webp).*/i, '')  // _50x50.jpg 제거
                        .replace(/\.(jpg|png|webp)_.*/i, '.$1');       // .jpg_... 제거
                }

                if (!seen.has(finalSrc)) {
                    seen.add(finalSrc);
                    images.push(finalSrc);
                }
            }
        };

        // 1. 선택자 기반 추출
        if (sels) {
            sels.forEach(s => {
                document.querySelectorAll(s).forEach(img => addImg(img.src, img));
            });
        }

        // 2. AliExpress 스크립트 데이터 추출 (가장 확실한 방법)
        if (platform === 'aliexpress') {
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

            // 3. DOM 광범위 탐색 (Fallback)
            const galleryImages = document.querySelectorAll('.pdp-info-left img, .image-view-list img, .main-image-viewer img, .images-view-item img, .gallery-view img');
            galleryImages.forEach(img => addImg(img.src, img));
        }



        document.querySelectorAll('meta[property="og:image"]').forEach(m => addImg(m.content));

        if (images.length === 0) {
            document.querySelectorAll('img').forEach(img => {
                if (img.width > 200 && img.height > 200) addImg(img.src, img);
            });
        }

        return images;
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

        // [New] 2개 이상의 옵션 그룹이 있으면 조합(Combination) 생성
        if (opts.length >= 2) {
            this.log(`🧩 옵션 그룹 ${opts.length}개 감지 - 조합 생성 시작`);
            return this.combineOptionGroups(opts);
        }

        return opts;
    }

    combineOptionGroups(groups) {
        if (!groups || groups.length === 0) return [];

        this.log(`🔄 옵션 조합 시작: ${groups.length}개 그룹`);

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
                // currentPart가 비어있는지(초기값인지)로 판단
                const isFirst = (!currentPart.text && !currentPart.value);

                const newText = isFirst ? option.text : `${currentPart.text} ${option.text}`;
                const newValue = isFirst ? option.value : `${currentPart.value} ${option.value}`;

                // 가격/재고/이미지/선택여부 병합 로직
                // 1. 가격: 하위 옵션에 명시된 가격이 있으면 사용, 없으면 상위 옵션 가격 유지
                let price = currentPart.price;
                if (option.price !== undefined && option.price !== null) {
                    price = option.price;
                }

                // 2. 재고: 하위 옵션 재고 우선
                let stock = currentPart.stock;
                if (option.stock !== undefined && option.stock !== null) {
                    stock = option.stock;
                }

                // 3. 이미지: 하위 옵션 이미지 우선 (없으면 상위 이미지 유지)
                let image = option.image || currentPart.image;

                // 4. 선택 여부: 모든 경로가 선택되어야 함 (하나라도 선택 안되면 false)
                // 첫 번째는 option.selected, 이후는 AND 연산
                const selected = isFirst ? option.selected : (currentPart.selected && option.selected);

                // 병합된 객체 생성
                const merged = {
                    text: newText,
                    value: newValue,
                    price: price,
                    stock: stock,
                    image: image,
                    selected: selected,
                    // 기타 메타데이터 유지 (하위 정보 우선)
                    priceText: option.priceText || currentPart.priceText,
                    priceType: option.priceType || currentPart.priceType
                };

                // 재귀 호출
                results.push(...combine(depth + 1, merged));
            }
            return results;
        };

        const combinedValues = combine(0, {});

        // 그룹 이름 합치기
        const combinedName = groups.map(g => g.name || '옵션').join(' / ');
        const totalStock = combinedValues.reduce((sum, item) => sum + (typeof item.stock === 'number' ? item.stock : 0), 0);

        this.log(`✅ 조합 완료: ${combinedValues.length}개의 옵션 생성됨 (${combinedName})`);

        return [{
            name: combinedName,
            type: 'combination',
            values: combinedValues,
            totalStock: totalStock // 전체 재고 합계 추가 권장
        }];
    }

    extractSelectOptions() {
        const opts = [];
        const sels = document.querySelectorAll('select');
        sels.forEach(sel => {
            const options = sel.querySelectorAll('option');
            if (options.length <= 1) return;
            const data = { name: this.getLabel(sel), type: 'select', values: [] };
            options.forEach((opt, i) => {
                const t = opt.textContent.trim();
                if (i === 0 && (!opt.value || t.includes('선택'))) return;
                // "on" 같은 의미없는 값 제외
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

            // 옵션 그룹명 결정 (더 의미있는 이름 사용)
            let groupName = n;

            // name이 의미없는 경우 (opt, option 등) label이나 주변 텍스트에서 찾기
            if (n === 'opt' || n === 'option' || n.length <= 3) {
                // label의 상위 요소나 주변 텍스트에서 옵션 그룹명 찾기
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
                // 언더스코어/하이픈을 공백으로 변경 (단, 전체가 의미없는 이름이 되지 않도록)
                groupName = n.replace(/[_-]/g, ' ').trim();
            }

            if (!grouped[n]) grouped[n] = { name: groupName, type: inp.type, values: [] };
            const label = document.querySelector(`label[for="${inp.id}"]`);
            const t = label ? label.textContent.trim() : inp.value;
            // "on" 같은 의미없는 값 제외
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
        this.log(`🔍 SKU 옵션 (동적 가격): ${skuProps.length}개 속성`);

        if (skuProps.length === 0) return opts;

        // 가격 표시 요소 찾기
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
            this.log(`  "${optName}": ${skuItems.length}개`);

            if (skuItems.length >= 2) {
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
                            // 옵션 클릭
                            if (!wasSelected) {
                                this.log(`    [${i + 1}/${skuItems.length}] "${text}" 클릭...`);
                                item.click();
                                await new Promise(resolve => setTimeout(resolve, 600));
                            }

                            // 가격 읽기
                            const priceEl = document.querySelector(priceSelector);
                            if (priceEl) {
                                priceText = priceEl.textContent.trim();
                                this.log(`      가격 텍스트: "${priceText}"`);

                                // 가격 파싱 (US $19.01, $19.01, 19.01 등)
                                const priceMatch = priceText.match(/(?:US\s*)?\$?\s*([\d,]+\.?\d*)/);
                                if (priceMatch) {
                                    price = parseFloat(priceMatch[1].replace(/,/g, ''));
                                    this.log(`      ✓ 가격: ${price}`);
                                }
                            } else {
                                this.log(`      ⚠️ 가격 요소 없음`);
                            }

                            // 재고 읽기 (대기 시간 증가)
                            await new Promise(resolve => setTimeout(resolve, 300)); // 재고 로드 대기

                            this.log(`      🔍 재고 검색 중...`);
                            const bodyText = document.body.innerText;

                            // 1. AliExpress "pieces available" 패턴
                            let piecesMatch = bodyText.match(/(\d+)\s*pieces?\s*available/i);
                            if (piecesMatch) {
                                stock = parseInt(piecesMatch[1], 10);
                                this.log(`      ✅ 재고: ${stock}개 (pieces available)`);
                            }
                            // 2. AliExpress "only X left" 패턴
                            else {
                                let leftMatch = bodyText.match(/only\s*(\d+)\s*left/i);
                                if (leftMatch) {
                                    stock = parseInt(leftMatch[1], 10);
                                    this.log(`      ✅ 재고: ${stock}개 (only left)`);
                                }
                                // 3. 한국어 패턴
                                else {
                                    let koreanMatch = bodyText.match(/(\d+)\s*개\s*남음/i) ||
                                        bodyText.match(/재고\s*[:\s]*(\d+)/i);
                                    if (koreanMatch) {
                                        stock = parseInt(koreanMatch[1], 10);
                                        this.log(`      ✅ 재고: ${stock}개 (한국어 패턴)`);
                                    }
                                    // 4. 품절 확인
                                    else if (bodyText.toLowerCase().includes('sold out') ||
                                        bodyText.includes('품절') ||
                                        bodyText.toLowerCase().includes('out of stock')) {
                                        stock = 'out_of_stock';
                                        this.log(`      ✅ 재고: 품절`);
                                    }
                                    // 5. DOM 요소에서 재고 검색
                                    else {
                                        const stockSelectors = [
                                            '[class*="quantity"]',
                                            '[class*="stock"]',
                                            '[class*="available"]',
                                            '[class*="inventory"]',
                                            '[data-spm*="quantity"]',
                                            '.product-quantity',
                                            '#quantity',
                                            '[id*="quantity"]'
                                        ];

                                        let found = false;
                                        for (const sel of stockSelectors) {
                                            const elements = document.querySelectorAll(sel);
                                            this.log(`        셀렉터 "${sel}": ${elements.length}개 요소`);

                                            for (const stockEl of elements) {
                                                const stockText = stockEl.textContent.trim();
                                                if (stockText.length > 0 && stockText.length < 100) {
                                                    this.log(`          텍스트: "${stockText}"`);
                                                    const numMatch = stockText.match(/(\d+)/);
                                                    if (numMatch) {
                                                        const num = parseInt(numMatch[1], 10);
                                                        if (num > 0 && num < 100000) {
                                                            stock = num;
                                                            this.log(`      ✅ 재고: ${stock}개 (셀렉터: ${sel})`);
                                                            found = true;
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            if (found) break;
                                        }

                                        if (stock === null) {
                                            stock = 'in_stock';
                                            this.log(`      ⚠️ 재고: 정보 없음 (기본값: in_stock)`);
                                            this.log(`      📋 body 텍스트 샘플: "${bodyText.substring(0, 200)}..."`);
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            this.log(`      ✗ 오류: ${e.message}`);
                        }

                        const optValue = {
                            text,
                            value,
                            selected: wasSelected,
                            image: imageUrl
                        };

                        if (price !== null) {
                            optValue.price = price;
                            optValue.priceType = 'absolute';
                            optValue.priceText = priceText;
                        }

                        if (stock !== null) {
                            optValue.stock = stock;
                        }

                        data.values.push(optValue);
                    }
                }

                if (data.values.length >= 2) {
                    opts.push(data);
                    this.log(`  ✅ "${data.name}" (${data.values.length}개, 가격+재고 수집됨)`);
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

    async extractDetailedDescription(platform) {
        this.log('\n========== 상세 설명 추출 시작 ==========');
        this.log(`플랫폼: ${platform}`);

        const d = { text: '', html: '', images: [] };

        try {
            // 0. "더보기" 버튼 클릭 (공통)
            const expandSelectors = [
                'button[class*="expand"]',
                'button[class*="more"]',
                'div[class*="expand"]',
                '.view-more-btn',
                '#product-description-expand'
            ];

            const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
            const textExpanders = buttons.filter(b => {
                const t = b.textContent.trim().toLowerCase();
                return t === 'view more' || t === 'show more' || t === '더보기' || t === '펼치기' || t.includes('description');
            });

            const allExpanders = [...document.querySelectorAll(expandSelectors.join(',')), ...textExpanders];

            for (const btn of allExpanders) {
                if (btn && btn.offsetParent !== null) {
                    try {
                        this.log(`  설명 "더보기" 클릭: ${btn.textContent.trim().substring(0, 20)}...`);
                        btn.click();
                        await new Promise(r => setTimeout(r, 500));
                    } catch (e) { }
                }
            }

            // 1. 설명 영역 찾기
            let descEl = null;

            // 1-1. AliExpress Shadow DOM 처리 (최우선!)
            // 1-1. AliExpress Shadow DOM 처리 (Deep Search)
            if (platform === 'aliexpress') {
                this.log('\n🔍 AliExpress Shadow DOM 확인 (Deep Search)...');

                let shadowRoots = [];

                // 1. 전체 문서에서 Shadow Root를 가진 요소 탐색
                // 성능을 위해 주요 컨테이너 내부만 탐색하되, 없으면 body 전체 탐색
                const mainContainer = document.querySelector('.pdp-body') || document.querySelector('#root') || document.body;

                // TreeWalker를 사용하여 효율적으로 탐색
                const walker = document.createTreeWalker(mainContainer, NodeFilter.SHOW_ELEMENT);
                let currentNode = walker.currentNode;
                while (currentNode) {
                    if (currentNode.shadowRoot) {
                        this.log(`  Shadow Root 발견: <${currentNode.tagName.toLowerCase()}>`);
                        shadowRoots.push(currentNode.shadowRoot);
                    }
                    currentNode = walker.nextNode();
                }

                // 2. 발견된 Shadow Root 내부 탐색
                for (const root of shadowRoots) {
                    // 2-1. 우선순위 높은 선택자
                    const target = root.querySelector('.detail-desc-decorate-richtext, .detailmodule_html, #product-description, [name="description"]');
                    if (target && target.textContent.trim().length > 50) {
                        descEl = target;
                        this.log(`  ✅ Shadow DOM 내부에서 핵심 요소 발견! (${target.className || target.id})`);
                        break;
                    }

                    // 2-2. 텍스트가 많은 요소 찾기 (Fallback)
                    const divs = root.querySelectorAll('div, p, span');
                    let bestTextDiv = null;
                    let maxLen = 0;

                    for (const div of divs) {
                        const len = div.textContent.trim().length;
                        if (len > 200 && len > maxLen) {
                            // 너무 상위 요소가 아닌지 확인 (직계 자식 텍스트 비중 확인 등은 복잡하므로 간단히 children 수로 체크)
                            if (div.children.length < 20) {
                                maxLen = len;
                                bestTextDiv = div;
                            }
                        }
                    }

                    if (bestTextDiv) {
                        descEl = bestTextDiv;
                        this.log(`  ✅ Shadow DOM 내부에서 텍스트 블록 발견! (${maxLen}자)`);
                        break;
                    }

                    // 2-3. 이미지가 많은 요소 찾기 (이미지 위주의 설명일 경우)
                    const imgs = root.querySelectorAll('img');
                    if (imgs.length > 3) {
                        // 이미지를 포함하는 최상위 컨테이너 찾기 (root의 직계 자식 중 하나일 가능성 높음)
                        descEl = root.querySelector('div') || root;
                        this.log(`  ✅ Shadow DOM 내부에서 이미지 그룹 발견! (${imgs.length}개)`);
                        break;
                    }
                }

                if (!descEl) {
                    this.log('  ✗ Shadow DOM에서 유의미한 콘텐츠를 찾지 못함');
                }
            }

            // 2. 헤더 기반 검색 ("개요", "설명", "Description", "Overview")
            if (!descEl) {
                // 2-1. "개요" + "신고하기" 패턴 검색 (사용자 요청)
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
                                this.log('  ✓ "개요" + "신고하기" 패턴으로 설명 영역 발견');
                                break;
                            }
                        }
                    }
                }
            }

            if (!descEl) {
                // 2-2. "설명"으로 시작하는 큰 텍스트 블록 검색 (Fallback)
                const divs = document.querySelectorAll('div');
                for (const div of divs) {
                    if (div.textContent.trim().startsWith('설명') && div.textContent.length > 100) {
                        descEl = div;
                    }
                }
            }

            if (!descEl) {
                // 2-3. 일반적인 헤더 검색 Fallback
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

            // 3. 데이터 추출
            if (descEl) {
                this.log(`  설명 요소 발견: ${descEl.tagName}, 클래스: ${descEl.className}`);

                // Iframe 처리
                const iframe = descEl.querySelector('iframe') || (descEl.tagName === 'IFRAME' ? descEl : null);
                if (iframe) {
                    this.log(`  iframe 발견:`);
                    this.log(`    - src: ${iframe.src}`);
                    this.log(`    - width: ${iframe.width}, height: ${iframe.height}`);
                    this.log(`    - loaded: ${iframe.contentDocument !== null}`);

                    // iframe이 로드될 때까지 대기
                    if (!iframe.contentDocument && iframe.src) {
                        this.log('  iframe 로딩 대기 중...');
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }

                    try {
                        // 1차 시도: 직접 접근
                        try {
                            const doc = iframe.contentDocument || iframe.contentWindow?.document;
                            this.log(`  직접 접근 시도: doc=${!!doc}, body=${!!doc?.body}`);

                            if (doc && doc.body) {
                                const bodyContent = doc.body.innerHTML;
                                this.log(`  iframe body 내용 길이: ${bodyContent.length}`);

                                if (bodyContent.length > 50) {
                                    descEl = doc.body;
                                    this.log('  ✓ iframe 내부 문서 직접 접근 성공');
                                } else {
                                    throw new Error('iframe body 내용이 너무 짧음');
                                }
                            } else {
                                throw new Error('iframe document 또는 body 없음');
                            }
                        } catch (directAccessError) {
                            this.log(`  직접 접근 실패: ${directAccessError.message}`);

                            // 2차 시도: fetch
                            if (iframe.src && iframe.src.startsWith('http')) {
                                try {
                                    this.log(`  fetch 시도: ${iframe.src}`);
                                    const response = await fetch(iframe.src);
                                    this.log(`  fetch 응답: ${response.status} ${response.statusText}`);

                                    if (response.ok) {
                                        const text = await response.text();
                                        this.log(`  fetch 받은 내용 길이: ${text.length}`);

                                        if (text && text.length > 100) {
                                            const parser = new DOMParser();
                                            const doc = parser.parseFromString(text, 'text/html');
                                            if (doc.body) {
                                                descEl = doc.body;
                                                this.log('  ✓ iframe 소스 fetch 성공');
                                            }
                                        }
                                    } else {
                                        this.log(`  fetch 실패: ${response.status}`);
                                    }
                                } catch (fetchError) {
                                    this.log(`  fetch 오류: ${fetchError.message}`);
                                }
                            }
                        }
                    } catch (e) {
                        this.log(`  iframe 처리 중 오류: ${e.message}`);
                    }
                }
            }

            // 텍스트 및 HTML 정리
            if (descEl) {
                if (!d.text) d.text = descEl.textContent.trim().substring(0, 5000);
                d.html = descEl.innerHTML;
            }

        } catch (e) {
            this.log('상세 설명 추출 실패:', e);
        }
        return d;
    }

    extractProductLinks(rootElement = document) {
        const links = [];
        try {
            rootElement.querySelectorAll('a[href]').forEach(a => {
                const h = a.href;
                if (h && (h.includes('/item/') || h.includes('/product/') || h.includes('/goods/'))) {
                    links.push(h);
                }
            });
        } catch (e) { }
        return links;
    }

    detectProductCards() {
        const platform = this.detectPlatform(window.location.href);
        let cards = [];

        // 플랫폼별 상품 카드 선택자
        const selectors = {
            naver: ['li._2AdXdFKc', 'div.basicList_item__2XT81', 'ul.list_basis > li', '.product_item', 'li.baby-product'],
            coupang: ['li.baby-product', 'a.search-product-link', 'li.renew-badge'],
            aliexpress: ['.manhattan--container--1lP57Ag', '.search-card-item', '.list--gallery--34TropR > a', '.item-card'],
            generic: ['.product-item', '.product-card', '.item-card', 'li.item', '.goods_list li']
        };

        // 1. 플랫폼 전용 선택자 시도
        if (selectors[platform]) {
            for (const sel of selectors[platform]) {
                const elements = document.querySelectorAll(sel);
                if (elements.length > 0) {
                    cards = Array.from(elements);
                    this.log(`상품 카드 발견 (${platform}): ${sel}, ${cards.length}개`);
                    return cards;
                }
            }
        }

        // 2. 일반적인 선택자 시도
        for (const sel of selectors.generic) {
            const elements = document.querySelectorAll(sel);
            if (elements.length > 0) {
                cards = Array.from(elements);
                this.log(`상품 카드 발견 (Generic): ${sel}, ${cards.length}개`);
                return cards;
            }
        }

        // 3. Fallback: 링크와 이미지가 있는 리스트 아이템 검색
        if (cards.length === 0) {
            const candidates = document.querySelectorAll('li, div[class*="item"], div[class*="product"]');
            for (const el of candidates) {
                // 너무 큰 요소 제외
                if (el.offsetWidth > 500 || el.offsetHeight > 600) continue;
                if (el.offsetWidth < 100 || el.offsetHeight < 100) continue;

                if (el.querySelector('img') && el.querySelector('a')) {
                    cards.push(el);
                }
            }
            if (cards.length > 0) {
                this.log(`상품 카드 발견 (Fallback): ${cards.length}개`);
            }
        }

        return cards;
    }

    async extractSpecifications(platform) {
        const specs = {};
        try {
            // 0. "더보기" 버튼 클릭 (공통)
            const expandSelectors = [
                'button[class*="expand"]',
                'button[class*="more"]',
                'div[class*="expand"]',
                '.view-more-btn',
                '#product-description-expand'
            ];

            // 텍스트 기반 검색 ("View More", "Show More", "더보기")
            const buttons = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
            const textExpanders = buttons.filter(b => {
                const t = b.textContent.trim().toLowerCase();
                return t === 'view more' || t === 'show more' || t === '더보기' || t === '펼치기' || t.includes('more specifications');
            });

            const allExpanders = [...document.querySelectorAll(expandSelectors.join(',')), ...textExpanders];

            for (const btn of allExpanders) {
                if (btn && btn.offsetParent !== null) { // visible check
                    try {
                        this.log(`  "더보기" 버튼 클릭 시도: ${btn.textContent.trim().substring(0, 20)}...`);
                        btn.click();
                        await new Promise(r => setTimeout(r, 500)); // 렌더링 대기
                    } catch (e) { }
                }
            }

            // 1. AliExpress 전용 선택자
            if (platform === 'aliexpress') {
                const possibleSelectors = [
                    // 새로운 UI
                    '.specification--prop--3WzCgK9',
                    '[class*="specification--prop"]',
                    '[class*="specification--line"]',
                    // 기존 UI
                    '.product-prop',
                    '.do-entry-item',
                    'li[class*="property-item"]',
                    // 모바일/앱 UI
                    '.sku-property-item',
                    '.prop-item'
                ];

                let foundItems = [];

                // 1. Main DOM 검색
                for (const sel of possibleSelectors) {
                    const items = document.querySelectorAll(sel);
                    if (items.length > 0) {
                        foundItems = Array.from(items);
                        break;
                    }
                }

                // 2. Shadow DOM 검색 (Main DOM에서 못 찾은 경우)
                if (foundItems.length === 0) {
                    this.log('  Main DOM에서 사양을 찾지 못함, Shadow DOM 확인...');
                    const shadowHost = document.querySelector('[data-pl="product-description"]') || document.querySelector('#product-description');
                    if (shadowHost) {
                        const children = shadowHost.querySelectorAll('*');
                        for (const child of children) {
                            if (child.shadowRoot) {
                                for (const sel of possibleSelectors) {
                                    const items = child.shadowRoot.querySelectorAll(sel);
                                    if (items.length > 0) {
                                        this.log(`  ✅ Shadow DOM 내부에서 사양 발견! (${items.length}개)`);
                                        foundItems = Array.from(items);
                                        break;
                                    }
                                }
                                if (foundItems.length > 0) break;
                            }
                        }
                    }
                }

                foundItems.forEach(item => {
                    const labelEl = item.querySelector('.title, .label, [class*="title"], [class*="label"], [class*="key"]');
                    const valueEl = item.querySelector('.value, [class*="value"], [class*="desc"]');

                    if (labelEl && valueEl) {
                        const key = labelEl.textContent.replace(/[:：]/g, '').trim();
                        const val = valueEl.textContent.trim();
                        if (key && val) {
                            specs[key] = val;
                        }
                    }
                });
            }

            // 2. 공통/기타 플랫폼 (네이버, 쿠팡 등) 또는 알리익스프레스 Fallback
            if (Object.keys(specs).length === 0) {
                // 테이블 구조 (tr > th+td)
                const rows = document.querySelectorAll('table tr, .spec-row, .detail-item, .product-info-item');
                rows.forEach(row => {
                    const th = row.querySelector('th, .label, .key, dt');
                    const td = row.querySelector('td, .value, dd');
                    if (th && td) {
                        const key = th.textContent.replace(/[:：]/g, '').trim();
                        const val = td.textContent.trim();
                        if (key && val) {
                            specs[key] = val;
                        }
                    }
                });
            }

            // 3. "상품 정보" 섹션 찾기 (헤더 기반 검색)
            if (Object.keys(specs).length === 0) {
                const headers = document.querySelectorAll('h3, h4, .section-title, .title');
                for (const h of headers) {
                    if (h.textContent.includes('상품 정보') || h.textContent.includes('Specifications') || h.textContent.includes('Item specifics')) {
                        // 헤더 다음의 요소에서 사양 추출 시도
                        let next = h.nextElementSibling;
                        while (next && next.tagName !== 'H3' && next.tagName !== 'H4') {
                            const items = next.querySelectorAll('li, .item, tr, div[class*="row"]');
                            if (items.length > 0) {
                                items.forEach(item => {
                                    const text = item.textContent.trim();
                                    const parts = text.split(/[:：]/);
                                    if (parts.length >= 2) {
                                        const key = parts[0].trim();
                                        const val = parts.slice(1).join(':').trim();
                                        if (key && val && key.length < 50) {
                                            specs[key] = val;
                                        }
                                    }
                                });
                                break;
                            }
                            next = next.nextElementSibling;
                        }
                    }
                }
            }

        } catch (e) {
            this.log('사양 추출 실패:', e);
        }
        return Object.keys(specs).length > 0 ? specs : null;
    }

    extractStock(platform) {
        let stock = null;
        try {
            if (platform === 'aliexpress') {
                // 스크립트 데이터 확인
                if (window.runParams && window.runParams.totalAvailQuantity) {
                    return parseInt(window.runParams.totalAvailQuantity);
                }
                // DOM 확인
                const stockEl = document.querySelector('.product-quantity-tip, .quantity-available');
                if (stockEl) {
                    const match = stockEl.textContent.match(/(\d+)/);
                    if (match) return parseInt(match[1]);
                }
            }

            // 공통 로직
            const stockTexts = document.body.innerText.match(/(\d+)\s*(?:개 남음|in stock|available)/i);
            if (stockTexts) {
                return parseInt(stockTexts[1]);
            }
        } catch (e) {
            this.log('재고 추출 실패:', e);
        }
        return stock;
    }

    extractCategory(sels) {
        if (!sels) return [];
        const categories = [];
        try {
            for (const s of sels) {
                const els = document.querySelectorAll(`${s} a, ${s} span, ${s} li`);
                if (els.length > 0) {
                    els.forEach(el => {
                        const t = el.textContent.trim();
                        if (t && t !== '>' && t !== '/') categories.push(t);
                    });
                    break;
                }
            }
        } catch (e) {
            this.log('카테고리 추출 실패:', e);
        }
        return categories;
    }

    getMetaTag(name) {
        try {
            const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
            return el ? el.content : '';
        } catch (e) {
            return '';
        }
    }
}

// 전역 객체로 내보내기
window.ProductParser = ProductParser;
window.productParser = new ProductParser();
console.log('✅ ProductParser 로드 완료');
