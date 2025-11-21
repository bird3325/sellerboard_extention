/**
 * 범용 상품 데이터 파싱 유틸리티 (알리익스프레스 지원)
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
                description: ['[class*="product-description"]', '[class*="detail-desc"]', '[id*="description"]'],
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

    extractProductData(url = window.location.href) {
        console.log('=== 상품 데이터 추출 시작 ===');
        const platform = this.detectPlatform(url);
        const sel = this.platformSelectors[platform];
        let name = this.extractText(sel.name) || this.extractNameFromTitle();
        let price = this.extractPrice(sel.price) || this.extractPriceFromPage();
        const images = this.extractAllImages(sel.images);
        const options = this.extractOptions();
        const description = this.extractDetailedDescription(sel.description);
        console.log(`추출 완료 - 이미지:${images.length}, 옵션:${options.length}`);
        return {
            url, platform, name: name || '제목 없음', price, images, description, options,
            stock: this.extractStock(), category: this.extractCategory(sel.category),
            collectedAt: new Date().toISOString(),
            metadata: { title: document.title, metaDescription: this.getMetaTag('description'), ogImage: this.getMetaTag('og:image') }
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

    parsePrice(t) {
        if (!t) return null;
        const n = t.replace(/[^\d,]/g, '').replace(/,/g, '');
        const p = parseInt(n, 10);
        return (p >= 100 && p <= 100000000) ? p : null;
    }

    extractNameFromTitle() {
        let c = document.title.replace(/ \| .+$/, '').replace(/ - .+$/, '').trim();
        return c.length > 3 ? c : null;
    }

    extractAllImages(sels) {
        const imgs = [];
        const seen = new Set();
        if (sels) {
            for (const s of sels) {
                try {
                    document.querySelectorAll(s).forEach(img => {
                        const src = img.src || img.dataset.src;
                        if (src && src.startsWith('http') && !seen.has(src)) {
                            seen.add(src);
                            imgs.push(src);
                        }
                    });
                } catch (e) { }
            }
        }
        if (imgs.length < 5) {
            document.querySelectorAll('img').forEach(img => {
                if (img.width > 100 && img.height > 100) {
                    const src = img.src || img.dataset.src;
                    if (src && src.startsWith('http') && !seen.has(src)) {
                        seen.add(src);
                        imgs.push(src);
                    }
                }
            });
        }
        console.log(`✓ 이미지 ${imgs.length}개`);
        return imgs.slice(0, 20);
    }

    extractOptions() {
        console.log('=== 옵션 추출 (알리익스프레스 SKU) ===');
        const opts = [];
        opts.push(...this.extractSelectOptions());
        opts.push(...this.extractRadioOptions());
        opts.push(...this.extractSkuOptions());
        console.log(`✅ 총 ${opts.length}개 옵션`);
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
                if (t) data.values.push({ text: t, value: opt.value, price: this.extractOptPrice(t) });
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
            if (t) grouped[n].values.push({ text: t, value: inp.value, price: this.extractOptPrice(t) });
        });
        Object.values(grouped).forEach(g => {
            if (g.values.length > 0) opts.push(g);
        });
        return opts;
    }

    extractSkuOptions() {
        const opts = [];
        const skuProps = document.querySelectorAll('[class*="sku-item--property"], [class*="sku-property"]');
        console.log(`SKU property: ${skuProps.length}개`);

        skuProps.forEach(prop => {
            const titleEl = prop.querySelector('[class*="sku-item--title"], [class*="sku-title"]');
            let optName = '옵션';
            if (titleEl) {
                const titleText = titleEl.textContent.trim();
                const m = titleText.match(/^([^:：]+)/);
                if (m) optName = m[1].trim();
            }

            const skuItems = prop.querySelectorAll('[class*="sku-item--image"], [class*="sku-item--text"], [data-sku-col]');
            console.log(`  "${optName}": ${skuItems.length}개 항목`);

            if (skuItems.length >= 2) {
                const data = { name: optName, type: 'sku', values: [] };
                const seen = new Set();

                skuItems.forEach(item => {
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

                    const skuCol = item.getAttribute('data-sku-col');
                    const value = skuCol || text;
                    const selected = item.className.includes('selected');

                    if (text && !seen.has(text)) {
                        seen.add(text);
                        data.values.push({ text, value, selected, image: imageUrl, price: this.extractOptPrice(text) });
                    }
                });

                if (data.values.length >= 2) {
                    opts.push(data);
                    console.log(`  ✅ "${data.name}" (${data.values.length}개)`);
                    data.values.forEach(v => console.log(`     - ${v.text}${v.selected ? ' ★' : ''}`));
                }
            }
        });

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

    extractOptPrice(t) {
        const m = t.match(/[+\-]\s*(\d{1,3}(?:,\d{3})+)원?/);
        return m ? this.parsePrice(m[1]) : null;
    }

    extractDetailedDescription(sels) {
        const d = { text: '', html: '', images: [] };
        if (!sels) return d;

        console.log('상세 설명 추출...');

        // "더보기" 버튼 클릭 시도
        try {
            const moreButtons = [
                '[class*="show-more"]', '[class*="read-more"]', '[class*="view-more"]',
                'button[class*="expand"]', 'a[class*="expand"]',
                '[class*="desc"] button', '[class*="description"] button'
            ];

            for (const selector of moreButtons) {
                const btn = document.querySelector(selector);
                if (btn && btn.textContent) {
                    const btnText = btn.textContent.toLowerCase();
                    if (btnText.includes('more') || btnText.includes('더보기') || btnText.includes('더 보기')) {
                        console.log(`  더보기 버튼 클릭: ${selector}`);
                        btn.click();
                        const start = Date.now();
                        while (Date.now() - start < 500) { } //500ms 대기
                        break;
                    }
                }
            }
        } catch (e) {
            console.log('  더보기 클릭 실패:', e.message);
        }

        for (const s of sels) {
            try {
                const el = document.querySelector(s);
                if (el) {
                    d.text = el.textContent.trim().substring(0, 5000);
                    let htmlContent = el.innerHTML;
                    htmlContent = htmlContent.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
                    htmlContent = htmlContent.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
                    d.html = htmlContent.substring(0, 10000);

                    el.querySelectorAll('img').forEach(img => {
                        const src = img.src || img.dataset.src;
                        if (src && src.startsWith('http')) d.images.push(src);
                    });

                    console.log(`  ✓ ${d.text.length}자, HTML:${d.html.length}자, 이미지:${d.images.length}개`);
                    break;
                }
            } catch (e) { }
        }

        if (!d.text) d.text = this.getMetaTag('description') || '';
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
            if (h && (h.includes('/product/') || h.includes('/goods/') || h.includes('/detail/'))) {
                try {
                    const u = new URL(h);
                    if (u.hostname === window.location.hostname && !links.includes(h)) links.push(h);
                } catch (e) { }
            }
        });
        return links;
    }
}

const productParser = new ProductParser();
console.log('✅ ProductParser 로드 완료 (더보기 자동 클릭)');
