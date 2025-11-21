/**
 * 상품 상세 페이지 로직
 */

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = parseInt(urlParams.get('id'));

    if (productId) {
        loadProductDetail(productId);
    } else {
        alert('잘못된 접근입니다.');
        window.location.href = 'dashboard.html';
    }

    setupEventListeners();
});

let currentProduct = null;

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 뒤로가기
    document.getElementById('back-btn').addEventListener('click', () => {
        window.location.href = 'dashboard.html';
    });

    // 원본 보기
    document.getElementById('open-link-btn').addEventListener('click', () => {
        if (currentProduct && currentProduct.url) {
            chrome.tabs.create({ url: currentProduct.url });
        }
    });

    // 삭제
    document.getElementById('delete-btn').addEventListener('click', async () => {
        if (!currentProduct) return;

        if (confirm('정말 이 상품을 삭제하시겠습니까?')) {
            const result = await chrome.storage.local.get(['products']);
            const products = result.products || [];
            const filtered = products.filter(p => p.id !== currentProduct.id);

            await chrome.storage.local.set({ products: filtered });
            alert('삭제되었습니다.');
            window.location.href = 'dashboard.html';
        }
    });
}

/**
 * 상품 상세 정보 로드
 */
async function loadProductDetail(id) {
    try {
        const result = await chrome.storage.local.get(['products']);
        const products = result.products || [];
        currentProduct = products.find(p => p.id === id);

        if (!currentProduct) {
            alert('상품을 찾을 수 없습니다.');
            window.location.href = 'dashboard.html';
            return;
        }

        renderProductDetail(currentProduct);
    } catch (error) {
        console.error('상품 로드 오류:', error);
        alert('데이터를 불러오는 중 오류가 발생했습니다.');
    }
}

/**
 * 상품 상세 정보 렌더링
 */
function renderProductDetail(product) {
    const container = document.getElementById('detail-container');
    container.innerHTML = `
        <div class="product-header">
            <h1 class="product-title">${product.name}</h1>
        </div>

        <div class="product-detail-grid">
            <!--이미지 갤러리-->
            <div class="image-gallery">
                <div class="main-image-container">
                    <img src="${product.images && product.images[0] ? product.images[0] : ''}" 
                         alt="${product.name}" 
                         class="main-image" 
                         id="main-image"
                         onerror="this.style.display='none'">
                </div>
                <div class="thumbnail-list" id="thumbnail-list">
                    ${renderThumbnails(product.images)}
                </div>
            </div>

            <!--상품 정보-->
            <div class="product-info">
                <div class="product-info-card">
                    <div class="info-header">
                        <span class="info-platform">${getPlatformName(product.platform)}</span>
                        <div class="info-price">${formatPrice(product.price)}</div>
                    </div>

                    <div class="info-grid">
                        <div class="info-item">
                            <label>수집 일시</label>
                            <div>${formatDate(product.collectedAt)}</div>
                        </div>
                        <div class="info-item">
                            <label>카테고리</label>
                            <div>${product.category || '-'}</div>
                        </div>
                        <div class="info-item">
                            <label>재고 상태</label>
                            <div>${formatStock(product.stock)}</div>
                        </div>
                    </div>

                    <!-- 옵션 섹션 -->
                    ${renderOptions(product.options)}

                    <!-- 사양 섹션 -->
                    ${renderSpecs(product.specs)}
                </div>
            </div>
        </div>

        <!--상세 설명-->
            <div class="description-section">
                <h3 class="section-title">상세 설명</h3>
                <div class="description-content">
                    ${product.description ? (product.description.html || product.description.text || '설명 없음') : '설명 없음'}
                </div>
            </div>
        `;

    // 썸네일 클릭 이벤트 연결
    setupThumbnailEvents();
}

/**
 * 썸네일 렌더링
 */
function renderThumbnails(images) {
    if (!images || images.length === 0) return '';

    return images.map((img, index) => `
        <img src="${img}"
             class="thumbnail ${index === 0 ? 'active' : ''}"
             data-src="${img}"
             onerror="this.style.display='none'">
            `).join('');
}

function renderOptions(options) {
    if (!options || options.length === 0) return '';

    let html = `
        <div class="options-section">
            <h3 class="section-title">옵션 목록 (${countTotalOptions(options)}개)</h3>
            <table class="options-table">
                <thead>
                    <tr>
                        <th>옵션명</th>
                        <th>값</th>
                        <th>가격</th>
                        <th>재고</th>
                        <th>이미지</th>
                    </tr>
                </thead>
                <tbody>
    `;

    options.forEach(optGroup => {
        optGroup.values.forEach(val => {
            html += `
                <tr>
                    <td>${optGroup.name}</td>
                    <td>${val.text || val.value}</td>
                    <td>${formatOptionPrice(val)}</td>
                    <td>${formatStock(val.stock)}</td>
                    <td>
                        ${val.image ? `<img src="${val.image}" class="option-image" onerror="this.style.display='none'">` : '-'}
                    </td>
                </tr>
            `;
        });
    });

    html += `
                </tbody>
            </table>
        </div>
            `;

    return html;
}

function renderSpecs(specs) {
    if (!specs || Object.keys(specs).length === 0) return '';

    let html = `
        <div class="specs-section" style="margin-top: 20px; border-top: 1px solid #eee; padding-top: 20px;">
            <h3 class="section-title">제품 사양</h3>
            <table class="specs-table" style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                <tbody>
    `;

    for (const [key, value] of Object.entries(specs)) {
        html += `
            <tr>
                <th style="text-align: left; padding: 8px; color: #666; width: 40%; border-bottom: 1px solid #f5f5f5;">${key}</th>
                <td style="padding: 8px; border-bottom: 1px solid #f5f5f5;">${value}</td>
            </tr>
        `;
    }

    html += `
                </tbody>
            </table>
        </div >
            `;
    return html;
}

/**
 * 메인 이미지 변경
 */
function changeMainImage(src, el) {
    const mainImage = document.getElementById('main-image');
    if (mainImage) {
        mainImage.src = src;
    }
    document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
    if (el) {
        el.classList.add('active');
    }
}

/**
 * 썸네일 이벤트 설정
 */
function setupThumbnailEvents() {
    const thumbnails = document.querySelectorAll('.thumbnail');
    thumbnails.forEach(thumb => {
        thumb.addEventListener('click', function () {
            const src = this.getAttribute('data-src') || this.src;
            changeMainImage(src, this);
        });
    });
}

/**
 * 유틸리티 함수들
 */
function getPlatformName(platform) {
    const names = {
        naver: '네이버',
        coupang: '쿠팡',
        aliexpress: '알리익스프레스',
        cafe24: '카페24',
        godo: '고도몰',
        generic: '기타'
    };
    return names[platform] || platform;
}

const EXCHANGE_RATE = 1450; // 환율 설정 (1달러 = 1450원)

function formatPrice(price) {
    if (!price) return '-';

    // 달러 표시
    const usd = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(price);

    // 원화 환산 표시
    const krw = new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: 'KRW'
    }).format(price * EXCHANGE_RATE);

    return `${usd} <span style="color: #888; font-size: 0.9em;">(${krw})</span>`;
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleString('ko-KR');
}

function formatOptionPrice(val) {
    if (val.price !== undefined) {
        return formatPrice(val.price);
    }
    if (val.priceAdjustment) {
        const sign = val.priceAdjustment > 0 ? '+' : '';
        return `${sign}${formatPrice(Math.abs(val.priceAdjustment))}`;
    }
    return '-';
}

function formatStock(stock) {
    if (stock === 'out_of_stock') return '<span style="color: var(--danger)">품절</span>';
    if (stock === 'in_stock') return '<span style="color: var(--success)">재고 있음</span>';
    if (typeof stock === 'number') return `${stock} 개`;
    return '-';
}

function countTotalOptions(options) {
    if (!options) return 0;
    return options.reduce((acc, group) => acc + group.values.length, 0);
}
