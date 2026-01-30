/**
 * 쿠팡 파서
 * 쿠팡 상품 페이지에서 정보 추출
 */

if (typeof CoupangParser === 'undefined') {
    class CoupangParser extends BaseParser {
        constructor() {
            super('coupang');
        }

        getSelectors() {
            return {
                name: '.prod-buy-header__title, h1.prod-buy-header__title',
                name: '.prod-buy-header__title, h1.prod-buy-header__title',
                price: [
                    '.total-price strong',
                    '.price-value',
                    '.prod-sale-price',
                    '.prod-price .total-price',
                    '.prod-price .price-val',
                    'span.total-price',
                    'strong.price-value'
                ],
                images: '.prod-image__main img, .product-image-slider img',
                stock: '.prod-soldout-message, .out-of-stock',
                description: '.prod-description, #prod-description',
                category: '.breadcrumb, .prod-breadcrumb'
            };
        }

        async extractName() {
            const selectors = [
                '.prod-buy-header__title',
                'h1.prod-buy-header__title',
                '.product-title h1'
            ];

            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }

            return '상품명을 찾을 수 없습니다';
        }



        async extractOptions() {
            const options = [];

            // 쿠팡 옵션은 select 또는 버튼 형태
            const optionSelects = document.querySelectorAll('.prod-option__item select, select[name*="option"]');

            optionSelects.forEach(select => {
                const name = select.previousElementSibling?.textContent.trim() || '옵션';
                const values = [];

                select.querySelectorAll('option').forEach(opt => {
                    const value = opt.textContent.trim();
                    if (value && !value.includes('선택') && opt.value) {
                        values.push({
                            value,
                            price: 0,
                            stock: opt.disabled ? 'out_of_stock' : 'in_stock'
                        });
                    }
                });

                if (values.length > 0) {
                    options.push({ name, values });
                }
            });

            // 버튼 형태 옵션
            const optionButtons = document.querySelectorAll('.prod-option__item .option-btn-group');
            optionButtons.forEach(group => {
                const name = group.closest('.prod-option__item')?.querySelector('.prod-option__title')?.textContent.trim() || '옵션';
                const values = [];

                group.querySelectorAll('button').forEach(btn => {
                    const value = btn.textContent.trim();
                    const disabled = btn.disabled || btn.classList.contains('disabled');

                    if (value) {
                        values.push({
                            value,
                            price: 0,
                            stock: disabled ? 'out_of_stock' : 'in_stock'
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
                isRocket: false
            };

            // 로켓배송 확인
            const rocketBadge = document.querySelector('.rocket-badge, .badge-rocket');
            if (rocketBadge) {
                shipping.isRocket = true;
                shipping.type = 'rocket';
                shipping.fee = 0;
            }

            // 배송비 정보
            const shippingEl = document.querySelector('.prod-shipping-fee, .shipping-fee-message');
            if (shippingEl) {
                const text = shippingEl.textContent;

                if (text.includes('무료배송') || text.includes('무료')) {
                    shipping.fee = 0;
                    shipping.type = 'free';
                } else {
                    const feeMatch = text.match(/(\d{1,3}(?:,\d{3})*)/);
                    if (feeMatch) {
                        shipping.fee = parseInt(feeMatch[1].replace(/,/g, ''));
                    }
                }
            }

            return shipping;
        }

        async extractSpecs() {
            const specs = {};
            const specTables = document.querySelectorAll('.prod-description__spec-table, .product-attribute table');

            specTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = row.querySelectorAll('th, td');
                    if (cells.length >= 2) {
                        const key = cells[0].textContent.trim();
                        const value = cells[1].textContent.trim();
                        if (key && value) {
                            specs[key] = value;
                        }
                    }
                });
            });

            return specs;
        }

        async extractStock() {
            // 품절 메시지 확인
            const soldoutEl = document.querySelector('.prod-soldout-message, .out-of-stock, .sold-out');
            if (soldoutEl) {
                return 'out_of_stock';
            }

            // 구매 버튼 상태 확인
            const buyButton = document.querySelector('.prod-buy-button, button[name="buy"]');
            if (buyButton && buyButton.disabled) {
                return 'out_of_stock';
            }

            return 'in_stock';
        }

        async extractPlatformSpecificData() {
            const metadata = {
                reviewCount: 0,
                rating: 0,
                seller: '',
                isRocket: false,
                rocketFresh: false
            };

            // 리뷰 수 및 평점
            const reviewEl = document.querySelector('.rating-total-count, .prod-number-of-reviews');
            if (reviewEl) {
                const reviewText = reviewEl.textContent.replace(/[^\d]/g, '');
                metadata.reviewCount = parseInt(reviewText) || 0;
            }

            const ratingEl = document.querySelector('.rating-star-num, .prod-rating__star');
            if (ratingEl) {
                metadata.rating = parseFloat(ratingEl.textContent) || 0;
            }

            // 판매자
            const sellerEl = document.querySelector('.prod-seller-name, .seller-name');
            if (sellerEl) {
                metadata.seller = sellerEl.textContent.trim();
            }

            // 로켓배송
            metadata.isRocket = !!document.querySelector('.rocket-badge, .badge-rocket');

            // 로켓프레시
            metadata.rocketFresh = !!document.querySelector('.rocket-fresh-badge');

            return metadata;
        }
    }

    window.CoupangParser = CoupangParser;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CoupangParser;
}
