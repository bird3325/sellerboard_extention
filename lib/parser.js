/**
 * 범용 상품 데이터 파싱 유틸리티
 */

class ProductParser {
    constructor() {
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
                images: ['[class*="images-view"] img'],
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

    detectPlatform(url) {
        const h = new URL(url).hostname.toLowerCase();
        if (h.includes('smartstore.naver') || h.includes('shopping.naver')) return 'naver';
        if (h.includes('coupang.com')) return 'coupang';
        if (h.includes('aliexpress')) return 'aliexpress';
        return 'generic';
    }

    async extractProductData(url = window.location.href) {
        console.log('=== 상품 데이터 추출 시작 ===');
        const platform = this.detectPlatform(url);
        const sel = this.platformSelectors[platform];
        const name = this.extractText(sel.name) || this.extractNameFromTitle();
        const price = this.extractPrice(sel.price) || this.extractPriceFromPage();
        const images = this.extractAllImages(sel.images);
        const options = await this.extractOptions();
        const description = await this.extractDetailedDescription(platform);
        const specs = await this.extractSpecifications(platform);

        console.log(`추출 완료 - 이미지:${images.length}, 옵션:${options.length}`);
        return {
            url,
            platform,
            name: name || '제목 없음',
            price,
            images,
            description,
            options,
            specs,
            stock: this.extractStock(),
            category: this.extractCategory(sel.category),
            collectedAt: new Date().toISOString(),
            metadata: {
                title: document.title,
                metaDescription: this.getMetaTag('description'),
                ogImage: this.getMetaTag('og:image')
            }
        };
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

    extractAllImages(sels) {
        const images = [];
        const seen = new Set();

        const addImg = (src) => {
            if (src && !seen.has(src) && !src.includes('data:image')) {
                seen.add(src);
                images.push(src);
            }
        };

        if (sels) {
            sels.forEach(s => {
                document.querySelectorAll(s).forEach(img => addImg(img.src));
            });
        }

        document.querySelectorAll('meta[property="og:image"]').forEach(m => addImg(m.content));

        if (images.length === 0) {
            document.querySelectorAll('img').forEach(img => {
                if (img.width > 200 && img.height > 200) addImg(img.src);
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

        return opts;
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
                if (t) data.values.push({ text: t, value: opt.value });
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
            const n = inp.name || 'opt';
            if (!grouped[n]) grouped[n] = { name: n.replace(/[_-]/g, ' '), type: inp.type, values: [] };
            const label = document.querySelector(`label[for="${inp.id}"]`);
            const t = label ? label.textContent.trim() : inp.value;
            if (t) grouped[n].values.push({ text: t, value: inp.value });
        });
        Object.values(grouped).forEach(g => {
            if (g.values.length > 0) opts.push(g);
        });
        return opts;
    }

    async extractSkuOptionsAsync() {
        const opts = [];
        const skuProps = document.querySelectorAll('[class*="sku-item--property"], [class*="sku-property"], [class*="sku-property-item"]');
        console.log(`🔍 SKU 옵션 (동적 가격): ${skuProps.length}개 속성`);

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
            console.log(`  "${optName}": ${skuItems.length}개`);

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

                        try {
                            // 옵션 클릭
                            if (!wasSelected) {
                                console.log(`    [${i + 1}/${skuItems.length}] "${text}" 클릭...`);
                                item.click();
                                await new Promise(resolve => setTimeout(resolve, 600));
                            }

                            // 가격 읽기
                            const priceEl = document.querySelector(priceSelector);
                            if (priceEl) {
                                priceText = priceEl.textContent.trim();
                                console.log(`      가격 텍스트: "${priceText}"`);

                                // 가격 파싱 (US $19.01, $19.01, 19.01 등)
                                const priceMatch = priceText.match(/(?:US\s*)?\$?\s*([\d,]+\.?\d*)/);
                                if (priceMatch) {
                                    price = parseFloat(priceMatch[1].replace(/,/g, ''));
                                    console.log(`      ✓ 가격: ${price}`);
                                }
                            } else {
                                console.log(`      ⚠️ 가격 요소 없음`);
                            }
                        } catch (e) {
                            console.log(`      ✗ 오류: ${e.message}`);
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

                        data.values.push(optValue);
                    }
                }

                if (data.values.length >= 2) {
                    opts.push(data);
                    console.log(`  ✅ "${data.name}" (${data.values.length}개, 가격 수집됨)`);
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
        console.log('\n========== 상세 설명 추출 시작 ==========');
        console.log(`플랫폼: ${platform}`);

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
                        console.log(`  설명 "더보기" 클릭: ${btn.textContent.trim().substring(0, 20)}...`);
                        btn.click();
                        await new Promise(r => setTimeout(r, 500));
                    } catch (e) { }
                }
            }

            // 1. 설명 영역 찾기
            let descEl = null;

            // 1-1. AliExpress Shadow DOM 처리 (최우선!)
            if (platform === 'aliexpress') {
                console.log('\n🔍 AliExpress Shadow DOM 확인...');

                // Shadow host 찾기
                const shadowHost = document.querySelector('[data-pl="product-description"]');
                if (shadowHost) {
                    console.log('  Shadow host 발견:', shadowHost.tagName);

                    // Shadow host의 자식 중 shadowRoot가 있는 요소 찾기
                    const children = shadowHost.querySelectorAll('*');
                    for (const child of children) {
                        if (child.shadowRoot) {
                            console.log('  ✓ Shadow root 발견!');

                            // Shadow DOM 내부에서 description 찾기
                            const shadowDesc = child.shadowRoot.querySelector('.detail-desc-decorate-richtext') ||
                                child.shadowRoot.querySelector('.detailmodule_html') ||
                                child.shadowRoot.querySelector('#product-description');

                            if (shadowDesc && shadowDesc.textContent.trim().length > 50) {
                                descEl = shadowDesc;
                                console.log(`  ✅ Shadow DOM 내부에서 발견! (${shadowDesc.textContent.trim().length}자)`);
                                break;
                            }
                        }
                    }
                }

                if (!descEl) {
                    console.log('  ✗ Shadow DOM에서 찾지 못함, fallback 시도...');
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
                                console.log('  ✓ "개요" + "신고하기" 패턴으로 설명 영역 발견');
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
                console.log(`  설명 요소 발견: ${descEl.tagName}, 클래스: ${descEl.className}`);

                // Iframe 처리
                const iframe = descEl.querySelector('iframe') || (descEl.tagName === 'IFRAME' ? descEl : null);
                if (iframe) {
                    console.log(`  iframe 발견:`);
                    console.log(`    - src: ${iframe.src}`);
                    console.log(`    - width: ${iframe.width}, height: ${iframe.height}`);
                    console.log(`    - loaded: ${iframe.contentDocument !== null}`);

                    // iframe이 로드될 때까지 대기
                    if (!iframe.contentDocument && iframe.src) {
                        console.log('  iframe 로딩 대기 중...');
                        await new Promise(resolve => setTimeout(resolve, 1500));
                    }

                    try {
                        // 1차 시도: 직접 접근
                        try {
                            const doc = iframe.contentDocument || iframe.contentWindow?.document;
                            console.log(`  직접 접근 시도: doc=${!!doc}, body=${!!doc?.body}`);

                            if (doc && doc.body) {
                                const bodyContent = doc.body.innerHTML;
                                console.log(`  iframe body 내용 길이: ${bodyContent.length}`);

                                if (bodyContent.length > 50) {
                                    descEl = doc.body;
                                    console.log('  ✓ iframe 내부 문서 직접 접근 성공');
                                } else {
                                    throw new Error('iframe body 내용이 너무 짧음');
                                }
                            } else {
                                throw new Error('iframe document 또는 body 없음');
                            }
                        } catch (directAccessError) {
                            console.log(`  직접 접근 실패: ${directAccessError.message}`);

                            // 2차 시도: fetch
                            if (iframe.src && iframe.src.startsWith('http')) {
                                try {
                                    console.log(`  fetch 시도: ${iframe.src}`);
                                    const response = await fetch(iframe.src);
                                    console.log(`  fetch 응답: ${response.status} ${response.statusText}`);

                                    if (response.ok) {
                                        const text = await response.text();
                                        console.log(`  fetch 받은 내용 길이: ${text.length}`);

                                        if (text && text.length > 100) {
                                            const parser = new DOMParser();
                                            const doc = parser.parseFromString(text, 'text/html');
                                            if (doc.body) {
                                                descEl = doc.body;
                                                console.log('  ✓ iframe 소스 fetch 성공');
                                            }
                                        }
                                    } else {
                                        console.log(`  fetch 실패: ${response.status}`);
                                    }
                                } catch (fetchError) {
                                    console.log(`  fetch 오류: ${fetchError.message}`);
                                }
                            }

                            // 3차 시도: iframe src를 description에 포함
                            if (iframe.src && !descEl.innerHTML.includes('iframe')) {
                                console.log('  ⚠️ iframe 내용 추출 실패, src URL을 저장');
                                d.text = `iframe URL: ${iframe.src}`;
                                d.iframeUrl = iframe.src;
                            }
                        }
                    } catch (e) {
                        console.error(`  iframe 처리 중 예외: ${e.message}`, e);
                    }
                }

                // 텍스트 추출
                if (!d.text) {
                    d.text = descEl.textContent.trim().substring(0, 5000);
                }

                // HTML 정제
                let htmlContent = descEl.innerHTML;
                htmlContent = htmlContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
                htmlContent = htmlContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
                d.html = htmlContent.substring(0, 20000);

                // 이미지 추출
                descEl.querySelectorAll('img').forEach(img => {
                    const src = img.src || img.dataset.src || img.getAttribute('data-src');
                    if (src && src.startsWith('http') && !d.images.includes(src)) {
                        // naturalWidth/naturalHeight 사용 (더 정확)
                        const w = img.naturalWidth || img.width;
                        const h = img.naturalHeight || img.height;
                        if (w > 50 && h > 50) {
                            d.images.push(src);
                        }
                    }
                });
                console.log(`  ✓ 설명 추출 완료: 텍스트 ${d.text.length}자, HTML ${d.html.length}자, 이미지 ${d.images.length}개`);
            } else {
                console.log('  설명 요소를 찾지 못함');
                // 메타 태그 Fallback
                d.text = this.getMetaTag('description') || '';
            }

        } catch (e) {
            console.error('상세 설명 추출 실패:', e);
        }

        console.log('\n========== 최종 결과 ==========');
        console.log(`텍스트 길이: ${d.text.length}자`);
        console.log(`HTML 길이: ${d.html.length}자`);
        console.log(`이미지 개수: ${d.images.length}개`);
        if (d.text.length > 0) {
            console.log(`텍스트 미리보기: ${d.text.substring(0, 200)}...`);
        }
        console.log('===================================\n');

        return d;
    }

    extractStock() {
        const t = document.body.innerText;
        if (t.includes('품절') || t.includes('sold out')) return 'out_of_stock';
        const m = t.match(/재고\s*[:\s]*(\d+)/);
        return m ? parseInt(m[1], 10) : 'in_stock';
    }

    extractCategory(sels) {
        if (!sels) return null;
        for (const s of sels) {
            try {
                const el = document.querySelector(s);
                if (el) return el.textContent.trim();
            } catch (e) { }
        }
        return null;
    }

    getMetaTag(n) {
        const m = document.querySelector(`meta[name="${n}"], meta[property="${n}"]`);
        return m ? m.content : null;
    }

    extractProductLinks() {
        const links = [];
        document.querySelectorAll('a[href]').forEach(a => {
            const h = a.href;
        });
        return links;
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
                        console.log(`  "더보기" 버튼 클릭 시도: ${btn.textContent.trim().substring(0, 20)}...`);
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
                for (const sel of possibleSelectors) {
                    const items = document.querySelectorAll(sel);
                    if (items.length > 0) {
                        foundItems = items;
                        break;
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
            console.error('사양 추출 실패:', e);
        }
        return Object.keys(specs).length > 0 ? specs : null;
    }
}

// 전역 객체로 내보내기
window.ProductParser = ProductParser;
console.log('✅ ProductParser 로드 완료');
