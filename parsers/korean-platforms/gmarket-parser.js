/**
 * G마켓 파서
 * G마켓 상품 페이지에서 정보 추출
 */

if (typeof GmarketParser === 'undefined') {
    class GmarketParser extends BaseParser {
        constructor() {
            super('gmarket');
        }

        getSelectors() {
            return {
                name: '.itemtit, .item_tit, h1.itemtit',
                name: '.itemtit, .item_tit, h1.itemtit',
                price: [
                    '.price_innerwrap .price strong',
                    '.price_real',
                    'strong.price',
                    '.item-topinfo_price strong',
                    '.price_info .price strong'
                ],
                images: '.item_photo_view img, .thumb_image img',
                stock: '.soldout-layer, .item-soldout',
                description: '.item_section, .item_info_section',
                category: '.item-topinfo_path, .breadcrumb'
            };
        }

        async extractName() {
            const selectors = [
                '.itemtit',
                'h1.itemtit',
                '.item_tit',
                '.item-topinfo_title'
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

            // G마켓 옵션은 주로 select 형태
            const optionSelects = document.querySelectorAll('.option_box select, select[id*="option"]');

            optionSelects.forEach(select => {
                const label = select.previousElementSibling;
                const name = label ? label.textContent.trim() : '옵션';
                const values = [];

                select.querySelectorAll('option').forEach(opt => {
                    const value = opt.textContent.trim();
                    if (value && !value.includes('선택') && !value.includes('--') && opt.value) {
                        // 가격 추가 정보 파싱
                        let addPrice = 0;
                        const priceMatch = value.match(/\(([+\-])\s*(\d{1,3}(?:,\d{3})*)/);
                        if (priceMatch) {
                            addPrice = parseInt(priceMatch[2].replace(/,/g, ''));
                            if (priceMatch[1] === '-') addPrice = -addPrice;
                        }

                        values.push({
                            value: value.replace(/\s*\([+\-].*?\)\s*$/, ''),
                            price: addPrice,
                            stock: opt.disabled ? 'out_of_stock' : 'in_stock'
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
                isSmileFresh: false
            };

            const shippingEl = document.querySelector('.item-topinfo_delivery, .delivery_fee_wrap');
            if (shippingEl) {
                const text = shippingEl.textContent;

                // 스마일배송/스마일프레시
                if (text.includes('스마일배송') || text.includes('스마일프레시')) {
                    shipping.isSmileFresh = true;
                    shipping.type = 'smile';
                }

                if (text.includes('무료배송')) {
                    shipping.fee = 0;
                    shipping.type = 'free';
                } else {
                    const feeMatch = text.match(/(\d{1,3}(?:,\d{3})*)/);
                    if (feeMatch) {
                        shipping.fee = parseInt(feeMatch[1].replace(/,/g, ''));
                    }
                }

                // 무료배송 조건
                const thresholdMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s*원\s*이상/);
                if (thresholdMatch) {
                    shipping.freeThreshold = parseInt(thresholdMatch[1].replace(/,/g, ''));
                }
            }

            return shipping;
        }

        async extractSpecs() {
            const specs = {};
            const specTables = document.querySelectorAll('.item_spec table, .spec_table');

            specTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const th = row.querySelector('th');
                    const td = row.querySelector('td');

                    if (th && td) {
                        const key = th.textContent.trim();
                        const value = td.textContent.trim();
                        if (key && value) {
                            specs[key] = value;
                        }
                    }
                });
            });

            return specs;
        }

        async extractPlatformSpecificData() {
            const metadata = {
                reviewCount: 0,
                rating: 0,
                seller: '',
                isSmileFresh: false,
                powerSeller: false
            };

            // 리뷰 수
            const reviewEl = document.querySelector('.item_photo_review_count, .review-count');
            if (reviewEl) {
                const reviewText = reviewEl.textContent.replace(/[^\d]/g, '');
                metadata.reviewCount = parseInt(reviewText) || 0;
            }

            // 평점
            const ratingEl = document.querySelector('.item_review_score, .rating-score');
            if (ratingEl) {
                metadata.rating = parseFloat(ratingEl.textContent) || 0;
            }

            // 판매자
            const sellerEl = document.querySelector('.item-topinfo_seller, .seller-name');
            if (sellerEl) {
                metadata.seller = sellerEl.textContent.trim();
            }

            // 파워딜러
            metadata.powerSeller = !!document.querySelector('.power-dealer-badge, .icon-power');

            // 스마일배송
            metadata.isSmileFresh = !!document.querySelector('.smile-delivery, .smile-fresh');

            return metadata;
        }
    }

    window.GmarketParser = GmarketParser;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GmarketParser;
}
