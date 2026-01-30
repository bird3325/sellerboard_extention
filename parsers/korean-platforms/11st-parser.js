/**
 * 11번가 파서
 * 11번가 상품 페이지에서 정보 추출
 */

if (typeof ElevenStParser === 'undefined') {
    class ElevenStParser extends BaseParser {
        constructor() {
            super('11st');
        }

        getSelectors() {
            return {
                name: '.info_tit, .c_prd_tit h1',
                name: '.info_tit, .c_prd_tit h1',
                price: [
                    '.selling_price',
                    '.price_detail strong',
                    'strong.price',
                    '.c_prd_price strong',
                    '.final_price',
                    '.price_wrap strong'
                ],
                images: '.img_prd img, .slick-slide img',
                stock: '.sold_out, .c_stock_out',
                description: '.c_product_info, .goods_info_detail',
                category: '.c_location, .s_location'
            };
        }

        async extractName() {
            const selectors = [
                '.info_tit',
                '.c_prd_tit h1',
                'h1.c_prd_tit',
                '.prd_name'
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

            // 11번가 옵션
            const optionGroups = document.querySelectorAll('.c_opt_box, .option_wrap');

            optionGroups.forEach(group => {
                const nameEl = group.querySelector('.c_opt_tit, .option_title');
                const name = nameEl ? nameEl.textContent.trim() : '옵션';

                const selectEl = group.querySelector('select');
                if (!selectEl) return;

                const values = [];
                selectEl.querySelectorAll('option').forEach(opt => {
                    const value = opt.textContent.trim();
                    if (value && !value.includes('선택') && opt.value) {
                        // 추가 가격 처리
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
                is11Street: false
            };

            const shippingEl = document.querySelector('.c_delvry_txt, .delivery_info');
            if (shippingEl) {
                const text = shippingEl.textContent;

                // 11번가 배송
                if (text.includes('11번가배송') || text.includes('11ST배송')) {
                    shipping.is11Street = true;
                    shipping.type = '11st';
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

                const thresholdMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s*원\s*이상/);
                if (thresholdMatch) {
                    shipping.freeThreshold = parseInt(thresholdMatch[1].replace(/,/g, ''));
                }
            }

            return shipping;
        }

        async extractSpecs() {
            const specs = {};
            const specTables = document.querySelectorAll('.c_product_info table, .spec_table');

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

        async extractPlatformSpecificData() {
            const metadata = {
                reviewCount: 0,
                rating: 0,
                seller: '',
                is11Street: false,
                powerSeller: false
            };

            // 리뷰 수
            const reviewEl = document.querySelector('.c_prd_review_cnt, .review_count');
            if (reviewEl) {
                const reviewText = reviewEl.textContent.replace(/[^\d]/g, '');
                metadata.reviewCount = parseInt(reviewText) || 0;
            }

            // 평점
            const ratingEl = document.querySelector('.c_prd_review_score, .rating_value');
            if (ratingEl) {
                metadata.rating = parseFloat(ratingEl.textContent) || 0;
            }

            // 판매자
            const sellerEl = document.querySelector('.c_seller_name, .shop_name');
            if (sellerEl) {
                metadata.seller = sellerEl.textContent.trim();
            }

            // 11번가 배송
            metadata.is11Street = !!document.querySelector('.c_11st_delivery, .badge-11st');

            // 파워딜러
            metadata.powerSeller = !!document.querySelector('.power_seller, .icon-power');

            return metadata;
        }
    }

    window.ElevenStParser = ElevenStParser;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ElevenStParser;
}
