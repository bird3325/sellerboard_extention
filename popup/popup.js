/**
 * 팝업 로직
 */

document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadRecentProducts();
    setupEventListeners();
});

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
    // 현재 페이지 수집
    document.getElementById('collect-current-btn')?.addEventListener('click', async () => {
        const btn = document.getElementById('collect-current-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="icon">⏳</span><span class="label">수집 중...</span>';

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            chrome.tabs.sendMessage(tab.id, { action: 'collectProduct' }, (response) => {
                if (chrome.runtime.lastError) {
                    btn.innerHTML = '<span class="icon">✗</span><span class="label">이 페이지는 지원되지 않습니다</span>';
                    setTimeout(() => {
                        btn.innerHTML = '<span class="icon">📦</span><span class="label">현재 페이지 수집</span>';
                        btn.disabled = false;
                    }, 2000);
                    return;
                }

                if (response?.success) {
                    chrome.runtime.sendMessage({
                        action: 'saveProduct',
                        data: response.data
                    }, () => {
                        btn.innerHTML = '<span class="icon">✓</span><span class="label">수집 완료!</span>';
                        loadStats();
                        loadRecentProducts();

                        setTimeout(() => {
                            btn.innerHTML = '<span class="icon">📦</span><span class="label">현재 페이지 수집</span>';
                            btn.disabled = false;
                        }, 2000);
                    });
                } else {
                    throw new Error(response?.error || '수집 실패');
                }
            });
        } catch (error) {
            console.error('수집 오류:', error);
            btn.innerHTML = '<span class="icon">✗</span><span class="label">수집 실패</span>';
            setTimeout(() => {
                btn.innerHTML = '<span class="icon">📦</span><span class="label">현재 페이지 수집</span>';
                btn.disabled = false;
            }, 2000);
        }
    });

    // 대시보드 열기
    document.getElementById('open-dashboard-btn')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openDashboard' });
    });

    // 설정
    document.getElementById('settings-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        alert('설정 기능은 곧 추가됩니다.');
    });

    // 도움말
    document.getElementById('help-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({
            url: 'https://github.com/sellerboard/help'
        });
    });
}

/**
 * 통계 로드
 */
function loadStats() {
    chrome.runtime.sendMessage({ action: 'getStats' }, (response) => {
        if (response) {
            document.getElementById('stat-today').textContent = response.today || 0;
            document.getElementById('stat-total').textContent = response.total || 0;
        }
    });
}

/**
 * 최근 수집 상품 로드
 */
async function loadRecentProducts() {
    const result = await chrome.storage.local.get(['products']);
    const products = result.products || [];

    const recentList = document.getElementById('recent-products');

    if (products.length === 0) {
        recentList.innerHTML = '<div class="empty-state">아직 수집한 상품이 없습니다</div>';
        return;
    }

    const recentProducts = products
        .sort((a, b) => new Date(b.collectedAt) - new Date(a.collectedAt))
        .slice(0, 5);

    recentList.innerHTML = recentProducts.map(product => `
    <div class="recent-item" data-url="${product.url}">
      <img 
        src="${product.images && product.images[0] ? product.images[0] : ''}" 
        alt="${product.name}"
        class="recent-item-image"
        onerror="this.style.display='none'"
      >
      <div class="recent-item-info">
        <div class="recent-item-name" title="${product.name}">${product.name || '상품명 없음'}</div>
        <div class="recent-item-meta">
          <span class="recent-item-time">${formatTime(product.collectedAt)}</span>
          <span class="recent-item-price">${formatPrice(product.price)}</span>
        </div>
      </div>
    </div>
  `).join('');

    recentList.querySelectorAll('.recent-item').forEach(item => {
        item.addEventListener('click', () => {
            const url = item.dataset.url;
            chrome.tabs.create({ url });
        });
    });
}

/**
 * 시간 포맷팅
 */
function formatTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    if (diffDays < 7) return `${diffDays}일 전`;

    return date.toLocaleDateString('ko-KR');
}

/**
 * 가격 포맷팅
 */
function formatPrice(price) {
    if (!price) return '-';
    return new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: 'KRW'
    }).format(price);
}
