/**
 * 1688 파서
 * 1688.com (도매 플랫폼) 상품 페이지에서 정보 추출
 * 중국어 처리 및 도매가 특성 반영
 */

if (typeof China1688Parser === 'undefined') {
    class China1688Parser extends BaseParser {
        constructor() {
            super('1688');
        }

        getSelectors() {
            return {
                name: '.d-title, .detail-title h1',
                price: '.price-original, .price-now',
                images: '.vertical-img img, .main-image img',
                stock: '.amount-box, .quantity-info',
                description: '.detail-desc, .description-content',
                category: '.breadcrumb, .location-info'
            };
        }

        async extractSearchResults(filters = {}) {
            // limit 적용
            const limit = filters.limit || 1000;
            const items = [];
            const seenIds = new Set();

            // 1688 Selectors
            const selectors = [
                '.sm-offer-item',
                '.offer-list-row li',
                '.common-offer-card',
                '.waterfall-item'
            ];

            let cards = [];
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    cards = Array.from(els);
                    break;
                }
            }

            for (const card of cards) {
                if (items.length >= limit) break;
                try {
                    // Link
                    const linkEl = card.querySelector('a[href*="detail.1688.com"]');
                    if (!linkEl) continue;

                    let href = linkEl.href;
                    if (!href) continue;

                    // ID extraction
                    const idMatch = href.match(/offer\/(\d+)\.html/);
                    const id = idMatch ? idMatch[1] : href;

                    if (seenIds.has(id)) continue;
                    seenIds.add(id);

                    // Title
                    const titleEl = card.querySelector('.title a, .title');
                    const name = titleEl ? titleEl.getAttribute('title') || titleEl.textContent.trim() : '';

                    // Price
                    const priceEl = card.querySelector('.price, .c-price');
                    let price = 0;
                    if (priceEl) {
                        price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, '')) || 0;
                    }

                    // Image
                    const imgEl = card.querySelector('.img-container img, .main-img img');
                    let imageUrl = '';
                    if (imgEl) {
                        imageUrl = imgEl.src || imgEl.dataset.src || '';
                    }

                    // Sales
                    const salesEl = card.querySelector('.month-sold, .sale-quantity');
                    const salesText = salesEl ? salesEl.textContent : '';

                    if (name) {
                        items.push({
                            id,
                            name,
                            price,
                            imageUrl,
                            detailUrl: href,
                            platform: '1688',
                            salesText
                        });
                    }
                } catch (e) { }
            }

            return items;
        }

        async extractName() {
            await this.wait(1000);

            const selectors = [
                '.d-title',
                '.detail-title h1',
                'h1.title',
                '.goods-title'
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
            const selectors = [
                '.price-original',
                '.price-now',
                '.price-text',
                '.price-range'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    const priceText = element.textContent.trim();
                    const price = this.parsePrice(priceText);
                    if (price > 0) return price;
                }
            }

            // 가격 범위 처리 (예: ¥10.00 - ¥50.00)
            const priceRangeEl = document.querySelector('.price-range, .unit-price-range');
            if (priceRangeEl) {
                const text = priceRangeEl.textContent;
                const match = text.match(/(\d+\.?\d*)/);
                if (match) {
                    return parseFloat(match[1]);
                }
            }

            return 0;
        }

        async extractOptions() {
            const options = [];

            // SKU 속성
            const skuGroups = document.querySelectorAll('.sku-item-wrapper, .sku-property');

            skuGroups.forEach(group => {
                const nameEl = group.querySelector('.sku-title, dt');
                const name = nameEl ? nameEl.textContent.trim() : '规格';

                const values = [];
                const valueEls = group.querySelectorAll('.sku-item, dd');

                valueEls.forEach(el => {
                    const value = el.getAttribute('title') || el.textContent.trim();
                    const disabled = el.classList.contains('disabled');

                    // 가격 추가 정보 (있을 경우)
                    const priceEl = el.querySelector('.sku-price');
                    const addPrice = priceEl ? this.parsePrice(priceEl.textContent) : 0;

                    if (value) {
                        values.push({
                            value,
                            price: addPrice,
                            stock: disabled ? 'out_of_stock' : 'in_stock',
                            imageUrl: el.querySelector('img')?.src || null
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
                region: '', // 지역별 배송비
                moq: 1  // Minimum Order Quantity (최소 주문 수량)
            };

            // 배송비 정보
            const shippingEl = document.querySelector('.logistics-info, .delivery-fee');
            if (shippingEl) {
                const text = shippingEl.textContent;

                if (text.includes('包邮') || text.includes('免运费')) {
                    shipping.fee = 0;
                    shipping.type = 'free';
                } else {
                    const feeMatch = text.match(/¥?\s*(\d+\.?\d*)/);
                    if (feeMatch) {
                        shipping.fee = parseFloat(feeMatch[1]);
                    }
                }

                // 지역 정보
                const regionMatch = text.match(/(.*?)(?:¥|免运费|包邮)/);
                if (regionMatch) {
                    shipping.region = regionMatch[1].trim();
                }
            }

            // MOQ (최소 주문 수량) - 1688의 특징
            const moqEl = document.querySelector('.moq-info, .min-order-quantity');
            if (moqEl) {
                const moqMatch = moqEl.textContent.match(/(\d+)/);
                if (moqMatch) {
                    shipping.moq = parseInt(moqMatch[1]);
                }
            }

            return shipping;
        }

        async extractSpecs() {
            const specs = {};

            // 상품 속성
            const specItems = document.querySelectorAll('.obj-content tr, .product-property-item');
            specItems.forEach(item => {
                const cells = item.querySelectorAll('td, dt, dd');
                if (cells.length >= 2) {
                    const key = cells[0].textContent.trim();
                    const value = cells[1].textContent.trim();
                    if (key && value) {
                        specs[key] = value;
                    }
                }
            });

            return specs;
        }

        async extractStock() {
            const stockEl = document.querySelector('.amount-box, .stock-info');
            if (stockEl) {
                const text = stockEl.textContent;

                if (text.includes('无货') || text.includes('缺货')) {
                    return 'out_of_stock';
                }

                // 재고 수량 표시
                const match = text.match(/(\d+)/);
                if (match) {
                    const stock = parseInt(match[1]);
                    return stock > 0 ? 'in_stock' : 'out_of_stock';
                }
            }

            return 'in_stock';
        }

        async extractPlatformSpecificData() {
            const metadata = {
                reviewCount: 0,
                repeatPurchaseRate: 0, // 复购率
                seller: '',
                companyName: '',
                factoryDirect: false,  // 工厂直销
                moq: 1,  // 최소 주문 수량
                priceRange: '',  // 가격 범위
                currency: 'CNY'
            };

            // 복구율 (재구매율)
            const repeatEl = document.querySelector('.repeat-rate, .repurchase-rate');
            if (repeatEl) {
                const match = repeatEl.textContent.match(/(\d+\.?\d*)%/);
                if (match) {
                    metadata.repeatPurchaseRate = parseFloat(match[1]);
                }
            }

            // 판매자/공장 정보
            const sellerEl = document.querySelector('.shop-name, .company-name');
            if (sellerEl) {
                metadata.seller = sellerEl.textContent.trim();
                metadata.companyName = metadata.seller;
            }

            // 공장 직판 여부
            metadata.factoryDirect = !!document.querySelector('.factory-badge, .direct-factory');

            // MOQ
            const moqEl = document.querySelector('.moq-info, .min-order');
            if (moqEl) {
                const match = moqEl.textContent.match(/(\d+)/);
                if (match) {
                    metadata.moq = parseInt(match[1]);
                }
            }

            // 가격 범위
            const priceRangeEl = document.querySelector('.price-range, .price-ladder');
            if (priceRangeEl) {
                metadata.priceRange = priceRangeEl.textContent.trim();
            }

            return metadata;
        }
    }

    window.China1688Parser = China1688Parser;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = China1688Parser;
}
