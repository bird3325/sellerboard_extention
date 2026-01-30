/**
 * 네이버 스마트스토어 파서
 * 네이버 스마트스토어 상품 페이지에서 정보 추출
 */

if (typeof NaverParser === 'undefined') {
    class NaverParser extends BaseParser {
        constructor() {
            super('naver');
        }

        getSelectors() {
            return {
                name: '.se-module.se-module-text h3, ._22kNQuEXmb h1, #content .detailInfoWrapper h3',
                name: '.se-module.se-module-text h3, ._22kNQuEXmb h1, #content .detailInfoWrapper h3',
                price: [
                    '._1LY7DqCnwR',
                    '.lowestPrice em',
                    '#content .price_area strong',
                    '.price_area strong.price',
                    '.product_price .price',
                    'strong.price'
                ],
                images: '.se-component-image img, ._2X57Mx4z8B img, .img_area img',
                stock: '.se-module.se-module-text:contains("재고"), .stock_area',
                description: '.se-main-container, ._productTableWrap, .productDescription',
                category: '.sc-dTdPqK, .category_path, #categoryPath'
            };
        }

        async extractName() {
            // 여러 선택자 시도
            const selectors = [
                '._22kNQuEXmb h3',
                '._22kNQuEXmb',
                '.se-module.se-module-text h3',
                'h3[class*="title"]',
                '.detailInfoWrapper h3'
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
            const optionGroups = document.querySelectorAll('.se-option-group, ._2Xz3GO5dJ1, .option_box');

            optionGroups.forEach(group => {
                const nameEl = group.querySelector('.option-title, ._23PJWKcqFJ, .option_name');
                const name = nameEl ? nameEl.textContent.trim() : '옵션';

                const values = [];
                const valueEls = group.querySelectorAl('option, .option-item, .option_value');

                valueEls.forEach(el => {
                    const value = el.textContent.trim();
                    if (value && value !== '선택') {
                        values.push({
                            value,
                            price: 0,
                            stock: 'in_stock'
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

            const shippingEl = document.querySelector('.shipping_area, ._3C80hJzaTi, .delivery_area');
            if (shippingEl) {
                const text = shippingEl.textContent;

                // 무료배송 확인
                if (text.includes('무료배송')) {
                    shipping.fee = 0;
                    shipping.type = 'free';
                }
                // 배송비 추출
                else {
                    const feeMatch = text.match(/(\d{1,3}(?:,\d{3})*)/);
                    if (feeMatch) {
                        shipping.fee = parseInt(feeMatch[1].replace(/,/g, ''));
                    }
                }

                // 무료배송 조건 추출
                const thresholdMatch = text.match(/(\d{1,3}(?:,\d{3})*)\s*원\s*이상/);
                if (thresholdMatch) {
                    shipping.freeThreshold = parseInt(thresholdMatch[1].replace(/,/g, ''));
                }
            }

            return shipping;
        }

        async extractSpecs() {
            const specs = {};
            const specTables = document.querySelectorAll('.productDetailInfoTable, .spec_table, ._productDetailInfoTable');

            specTables.forEach(table => {
                const rows = table.querySelectorAll('tr');
                rows.forEach(row => {
                    const th = row.querySelector('th');
                    const td = row.querySelector('td');

                    if (th && td) {
                        const key = th.textContent.trim();
                        const value = td.textContent.trim();
                        specs[key] = value;
                    }
                });
            });

            return specs;
        }

        async extractPlatformSpecificData() {
            const metadata = {
                reviewCount: 0,
                likeCount: 0,
                seller: '',
                deliveryType: 'standard'
            };

            // 리뷰 수
            const reviewEl = document.querySelector('.reviewCount, ._15NU42F3kT, .review_count');
            if (reviewEl) {
                const reviewText = reviewEl.textContent.replace(/[^\d]/g, '');
                metadata.reviewCount = parseInt(reviewText) || 0;
            }

            // 찜하기 수
            const likeEl = document.querySelector('.likeCount, ._2TeOBU9wCB, .wish_count');
            if (likeEl) {
                const likeText = likeEl.textContent.replace(/[^\d]/g, '');
                metadata.likeCount = parseInt(likeText) || 0;
            }

            // 판매자 정보
            const sellerEl = document.querySelector('.seller_name, ._1j3F6kTWoS, .store_name');
            if (sellerEl) {
                metadata.seller = sellerEl.textContent.trim();
            }

            return metadata;
        }
    }

    window.NaverParser = NaverParser;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NaverParser;
}
