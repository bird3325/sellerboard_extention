/**
 * 대시보드 로직
 */

let currentView = 'products';
let allProducts = [];
let filteredProducts = [];
let currentPage = 1;
const itemsPerPage = 20;

document.addEventListener('DOMContentLoaded', () => {
    initSidebarToggle();
    loadProducts();
    setupNavigation();
    setupEventListeners();
});

/**
 * 사이드바 토글 초기화
 */
function initSidebarToggle() {
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');

    if (!sidebar || !sidebarToggle) return;

    // 저장된 사이드바 상태 복원
    const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (sidebarCollapsed) {
        sidebar.classList.add('collapsed');
    }

    // 토글 버튼 클릭 이벤트
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebarCollapsed', isCollapsed);
    });
}

/**
 * 네비게이션 설정
 */
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();

            // 활성화 상태 업데이트
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // 뷰 전환
            const view = item.dataset.view;
            switchView(view);
        });
    });
}

/**
 * 뷰 전환
 */
function switchView(view) {
    currentView = view;

    // 모든 뷰 숨기기
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

    // 선택된 뷰 표시
    document.getElementById(`view-${view}`)?.classList.add('active');

    // 헤더 업데이트
    const titles = {
        products: '상품 목록',
        stats: '통계',
        profiles: '프로필',
        schedules: '스케줄',
        export: '내보내기',
        settings: '설정'
    };

    document.getElementById('page-title').textContent = titles[view] || '셀러보드';
    document.getElementById('breadcrumb-current').textContent = titles[view] || view;

    // 뷰별 데이터 로드
    if (view === 'stats') {
        loadStats();
    } else if (view === 'profiles') {
        loadProfiles();
    } else if (view === 'schedules') {
        loadSchedules();
    } else if (view === 'settings') {
        console.log('Switching to settings view');
        if (typeof SettingsManager !== 'undefined') {
            console.log('Initializing SettingsManager');
            SettingsManager.init();
        } else {
            console.error('SettingsManager is not defined');
        }
    }
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 검색
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        filterProducts();
    });

    // 플랫폼 필터
    document.getElementById('platform-filter')?.addEventListener('change', () => {
        filterProducts();
    });

    // 정렬
    document.getElementById('sort-select')?.addEventListener('change', () => {
        filterProducts();
    });

    // 새로고침
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
        loadProducts();
    });

    // 전체 선택
    document.getElementById('select-all')?.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.product-checkbox');
        checkboxes.forEach(cb => cb.checked = e.target.checked);
    });

    // 내보내기
    document.querySelectorAll('.export-card').forEach(card => {
        const btn = card.querySelector('.btn-primary, .btn-secondary');
        if (btn && !btn.disabled) {
            btn.addEventListener('click', () => {
                const format = card.dataset.format;
                exportData(format);
            });
        }
    });

    // 상품 클릭 이벤트 위임
    setupProductClickDelegation();
}

/**
 * 상품 로드
 */
async function loadProducts() {
    const result = await chrome.storage.local.get(['products']);
    allProducts = result.products || [];
    filterProducts();
}

/**
 * 상품 필터링
 */
function filterProducts() {
    const searchQuery = document.getElementById('search-input')?.value.toLowerCase() || '';
    const platformFilter = document.getElementById('platform-filter')?.value || '';
    const sortValue = document.getElementById('sort-select')?.value || 'collectedAt-desc';

    // 필터링
    filteredProducts = allProducts.filter(product => {
        const matchesSearch = !searchQuery ||
            product.name?.toLowerCase().includes(searchQuery) ||
            product.description?.toLowerCase().includes(searchQuery);

        const matchesPlatform = !platformFilter || product.platform === platformFilter;

        return matchesSearch && matchesPlatform;
    });

    // 정렬
    const [sortBy, sortOrder] = sortValue.split('-');
    filteredProducts.sort((a, b) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];

        if (sortBy === 'collectedAt') {
            aVal = new Date(aVal).getTime();
            bVal = new Date(bVal).getTime();
        }

        if (sortOrder === 'asc') {
            return aVal > bVal ? 1 : -1;
        } else {
            return aVal < bVal ? 1 : -1;
        }
    });

    renderProducts();
}

/**
 * 상품 렌더링
 */
function renderProducts() {
    const tbody = document.getElementById('products-table-body');

    if (filteredProducts.length === 0) {
        tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <div class="empty-text">검색 결과가 없습니다</div>
          </div>
        </td>
      </tr>
    `;
        return;
    }

    // 페이지네이션
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    const pageProducts = filteredProducts.slice(start, end);

    tbody.innerHTML = pageProducts.map(product => `
    <tr>
      <td><input type="checkbox" class="product-checkbox" data-id="${product.id}"></td>
      <td>
        <img 
          src="${product.images && product.images[0] ? product.images[0] : ''}" 
          alt="${product.name}"
          class="product-image"
          onerror="this.style.display='none'"
        >
      </td>
      <td>
        <div class="product-name" data-id="${product.id}">${product.name || '상품명 없음'}</div>
      </td>
      <td>
        <span class="platform-badge">${getPlatformName(product.platform)}</span>
      </td>
      <td class="product-price">${formatPrice(product.price)}</td>
      <td class="product-date">${formatDate(product.collectedAt)}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn" onclick="openProduct('${product.url}')" title="열기">🔗</button>
          <button class="action-btn" onclick="deleteProduct(${product.id})" title="삭제">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');

    renderPagination();

    // 이벤트 리스너 재연결 (기존 리스너 제거 후 새로 추가 방지 위해 델리게이션 사용 권장하지만, 여기서는 간단히 추가)
    // 더 좋은 방법은 tbody에 이벤트 위임을 사용하는 것입니다.
}

// 이벤트 위임 설정 (setupEventListeners 함수 내에 추가해야 함)
function setupProductClickDelegation() {
    const tbody = document.getElementById('products-table-body');
    if (tbody) {
        tbody.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('product-name')) {
                const id = target.dataset.id;
                if (id) {
                    location.href = `detail.html?id=${id}`;
                }
            }
        });
    }
}

/**
 * 페이지네이션 렌더링
 */
function renderPagination() {
    const pagination = document.getElementById('pagination');
    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';

    // 이전 버튼
    html += `<button class="page-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">‹</button>`;

    // 페이지 번호
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 2 && i <= currentPage + 2)) {
            html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
        } else if (i === currentPage - 3 || i === currentPage + 3) {
            html += `<span>...</span>`;
        }
    }

    // 다음 버튼
    html += `<button class="page-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">›</button>`;

    pagination.innerHTML = html;
}

/**
 * 페이지 변경
 */
window.changePage = function (page) {
    currentPage = page;
    renderProducts();
};

/**
 * 통계 로드
 */
async function loadStats() {
    const result = await chrome.storage.local.get(['products']);
    const products = result.products || [];

    // 전체 상품 수
    document.getElementById('stat-total-products').textContent = products.length;

    // 오늘 수집한 상품
    const today = new Date().toDateString();
    const todayProducts = products.filter(p =>
        new Date(p.collectedAt).toDateString() === today
    );
    document.getElementById('stat-today-products').textContent = todayProducts.length;

    // 평균 가격
    const prices = products.filter(p => p.price).map(p => p.price);
    const avgPrice = prices.length > 0
        ? prices.reduce((a, b) => a + b, 0) / prices.length
        : 0;
    document.getElementById('stat-avg-price').textContent = formatPrice(avgPrice);

    // 플랫폼별 차트 (간단한 텍스트 표시)
    const platformCounts = {};
    products.forEach(p => {
        platformCounts[p.platform] = (platformCounts[p.platform] || 0) + 1;
    });

    const chartHtml = Object.entries(platformCounts)
        .map(([platform, count]) => `
      <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border);">
        <span>${getPlatformName(platform)}</span>
        <strong>${count}개</strong>
      </div>
    `).join('');

    document.getElementById('platform-chart').innerHTML = chartHtml || '<p>데이터 없음</p>';
}

/**
 * 프로필 로드
 */
async function loadProfiles() {
    // TODO: 프로필 데이터 로드 및 렌더링
    console.log('프로필 로드 (개발 예정)');
}

/**
 * 스케줄 로드
 */
async function loadSchedules() {
    // TODO: 스케줄 데이터 로드 및 렌더링
    console.log('스케줄 로드 (개발 예정)');
}

/**
 * 데이터 내보내기
 */
function exportData(format) {
    if (format === 'csv') {
        exportCSV();
    } else if (format === 'json') {
        exportJSON();
    }
}

/**
 * CSV 내보내기
 */
function exportCSV() {
    const headers = ['ID', '상품명', '플랫폼', '가격', 'URL', '수집일시'];
    const rows = allProducts.map(p => [
        p.id,
        `"${(p.name || '').replace(/"/g, '""')}"`,
        p.platform,
        p.price || 0,
        p.url,
        p.collectedAt
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    downloadFile(blob, 'sellerboard-products.csv');
}

/**
 * JSON 내보내기
 */
function exportJSON() {
    const json = JSON.stringify(allProducts, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    downloadFile(blob, 'sellerboard-products.json');
}

/**
 * 파일 다운로드
 */
function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * 상품 열기
 */
window.openProduct = function (url) {
    chrome.tabs.create({ url });
};

/**
 * 상품 삭제
 */
window.deleteProduct = async function (id) {
    if (!confirm('이 상품을 삭제하시겠습니까?')) return;

    const result = await chrome.storage.local.get(['products']);
    const products = result.products || [];
    const filtered = products.filter(p => p.id !== id);

    await chrome.storage.local.set({ products: filtered });
    loadProducts();
};

/**
 * 유틸리티 함수
 */
function getPlatformName(platform) {
    const names = {
        naver: '네이버',
        coupang: '쿠팡',
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
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR');
}
