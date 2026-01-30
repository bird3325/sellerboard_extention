/**
 * 옥션 파서
 * 옥션 상품 페이지에서 정보 추출
 * G마켓과 옥션은 동일한 이베이코리아 계열이므로 많은 부분 공유
 */

if (typeof AuctionParser === 'undefined') {
    class AuctionParser extends BaseParser {
        constructor() {
            super('auction');
        }

        getSelectors() {
            return {
                name: '.itemtit, .prod_title',
                name: '.itemtit, .prod_title',
                price: [
                    '.price_real',
                    '.price strong',
                    'strong.price',
                    '.now_price strong',
                    '.item_topinfo_price strong'
                ],
                images: '.item_photo_view img, .thumb_image img',
                stock: '.soldout-layer, .item-soldout',
                description: '.item_section, .prod_detail',
                category: '.item-topinfo_path, .category_path'
            };
        }

        async extractName() {
            const selectors = [
                '.itemtit',
                'h1.itemtit',
                '.prod_title',
                '.item_title'
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

            // 옵션 select 박스
            const optionSelects = document.querySelectorAll('.option_box select, select[name*="option"]');

            optionSelects.forEach(select => {
                const label = select.closest('.option_box')?.querySelector('.option_title');
                const name = label ? label.textContent.trim() : '옵션';
                const values = [];

                select.querySelectorAll('option').forEach(opt => {
                    const value = opt.textContent.trim();
                    if (value && !value.includes('선택') && !value.includes('--') && opt.value) {
                        // G마켓과 동일한 가격 파싱 로직
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
                type: 'standard'
            };

            const shippingEl = document.querySelector('.delivery_fee_wrap, .delvry_info');
            if (shippingEl) {
                const text = shippingEl.textContent;

                if (text.includes('무료배송')) {
                    shipping.fee = 0;
                    shipping.type = 'free';
                } else {
                    const feeMatch = text.match(/(\d{1,3}(?:,\d{3})*)/);
                    if (feeMatch) {
                        shipping.fee = parseInt(feeMatch[1].replace(/,/g, ''));
                    }
                }

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
                powerSeller: false
            };

            // 리뷰 수
            const reviewEl = document.querySelector('.review-count, .review_total');
            if (reviewEl) {
                const reviewText = reviewEl.textContent.replace(/[^\d]/g, '');
                metadata.reviewCount = parseInt(reviewText) || 0;
            }

            // 평점
            const ratingEl = document.querySelector('.rating-score, .review_score');
            if (ratingEl) {
                metadata.rating = parseFloat(ratingEl.textContent) || 0;
            }

            // 판매자
            const sellerEl = document.querySelector('.seller-name, .shop_name');
            if (sellerEl) {
                metadata.seller = sellerEl.textContent.trim();
            }

            // 파워딜러
            metadata.powerSeller = !!document.querySelector('.power-dealer, .icon-power');

            return metadata;
        }
    }

    window.AuctionParser = AuctionParser;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuctionParser;
}
